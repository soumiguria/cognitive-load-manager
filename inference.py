import os
import json
import urllib.request
import urllib.error
from typing import List, Optional

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

from openai import OpenAI

# ── Credentials ───────────────────────────────────────────────────────────────
# HF Spaces auto-inject HF_TOKEN; validator injects API_BASE_URL + API_KEY.
# Try HF_TOKEN first — same pattern as the accepted reference repo.
API_BASE_URL = os.getenv("API_BASE_URL", "https://router.huggingface.co/v1")
MODEL_NAME   = os.getenv("MODEL_NAME",   "Qwen/Qwen2.5-72B-Instruct")
HF_TOKEN     = os.getenv("HF_TOKEN")                          # auto-injected by HF Space
API_KEY      = os.getenv("HF_TOKEN") or os.getenv("API_KEY")  # HF_TOKEN takes priority
ENV_BASE_URL = os.getenv(
    "ENV_BASE_URL",
    "https://anonymousdevil-cognitive-load-manager.hf.space",  # your HF Space fallback
)

TASK_NAME               = "schedule-optimization"
BENCHMARK               = "cognitive-load-manager"
MAX_STEPS               = 50
SUCCESS_SCORE_THRESHOLD = 0.5


# ── HTTP helper ───────────────────────────────────────────────────────────────

def post_json(url: str, payload: dict) -> dict:
    data = json.dumps(payload).encode("utf-8")
    req  = urllib.request.Request(
        url, data=data, headers={"Content-Type": "application/json"}
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            return json.loads(res.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        raise Exception(f"HTTP {e.code}: {e.read().decode('utf-8')[:200]}")


# ── Structured logging (required format) ─────────────────────────────────────

def log_start(task: str, env: str, model: str) -> None:
    print(f"[START] task={task} env={env} model={model}", flush=True)

def log_step(step: int, action: str, reward: float,
             done: bool, error: Optional[str]) -> None:
    print(
        f"[STEP] step={step} action={action} reward={reward:.2f} "
        f"done={str(done).lower()} error={error or 'null'}",
        flush=True,
    )

def log_end(success: bool, steps: int, score: float,
            rewards: List[float]) -> None:
    rewards_str = ",".join(f"{r:.2f}" for r in rewards)
    print(
        f"[END] success={str(success).lower()} steps={steps} "
        f"score={score:.3f} rewards={rewards_str}",
        flush=True,
    )


# ── Agent ─────────────────────────────────────────────────────────────────────

def main():
    if not API_KEY:
        print("[ERROR] Neither HF_TOKEN nor API_KEY is set. Cannot proceed.", flush=True)
        log_end(success=False, steps=0, score=0.0, rewards=[])
        return

    # Build OpenAI-compatible client pointing at the validator-injected proxy
    client = OpenAI(base_url=API_BASE_URL, api_key=API_KEY)

    task_id = os.getenv("CLM_LEVEL", "hard")
    log_start(task=TASK_NAME, env=BENCHMARK, model=MODEL_NAME)

    # ── 1. Reset environment ──────────────────────────────────────────────────
    # openenv-core ResetResponse: { "observation": {...}, "reward": null, "done": false }
    # There is NO session_id — do not look for one.
    # task_id is passed as an extra field (ResetRequest allows extra="allow").
    try:
        reset_data  = post_json(f"{ENV_BASE_URL}/reset", {"task_id": task_id})
        observation = reset_data["observation"]
    except Exception as e:
        log_step(step=0, action="reset", reward=0.0, done=True, error=str(e)[:80])
        log_end(success=False, steps=0, score=0.0, rewards=[])
        return

    done    = False
    step    = 0
    rewards: List[float] = []
    history: List[str]   = []
    info: dict           = {}

    # ── 2. Agent loop ─────────────────────────────────────────────────────────
    while not done and step < MAX_STEPS:
        step += 1
        history_str = "\n".join(history[-5:]) if history else "No previous actions."

        system_prompt = (
            "You are an AI task scheduler managing cognitive load.\n"
            "CRITICAL RULES:\n"
            "1. If fatigue_level is 'high' or 'medium', output {\"type\": \"break\"}.\n"
            "2. If stress_warning is true, output {\"type\": \"break\"}.\n"
            "3. Otherwise find tasks where progress < 1.0 and output "
            "{\"type\": \"work\", \"task_id\": \"<id>\"}.\n"
            "4. Respond ONLY with raw JSON. No markdown blocks."
        )
        user_prompt = (
            f"Previous 5 steps:\n{history_str}\n\n"
            f"Current observation:\n{json.dumps(observation, indent=2)}\n\n"
            "What is your next action JSON?"
        )

        action: Optional[dict] = None
        error_msg: Optional[str] = None

        # ── LLM call through the validator proxy ──────────────────────────────
        try:
            completion = client.chat.completions.create(
                model=MODEL_NAME,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user",   "content": user_prompt},
                ],
                temperature=0.1,
                max_tokens=150,
            )
            text = (completion.choices[0].message.content or "").strip()
            if text.startswith("```json"):
                text = text[7:]
            if text.startswith("```"):
                text = text[3:]
            if text.endswith("```"):
                text = text[:-3]
            text = text.strip()
            s, e = text.find("{"), text.rfind("}")
            if s != -1 and e != -1:
                action = json.loads(text[s : e + 1])
        except Exception as ex:
            error_msg = str(ex)[:80]

        # ── Heuristic fallback (only if LLM call failed / unparseable) ────────
        if not action:
            tasks  = observation.get("tasks", [])
            incomp = [t for t in tasks if t.get("progress", 0.0) < 1.0]
            fs     = observation.get("visible_state", {})
            if fs.get("fatigue_level") in ("high", "medium") or fs.get("stress_warning"):
                action = {"type": "break"}
            elif incomp:
                action = {"type": "work", "task_id": incomp[0]["id"]}
            else:
                action = {"type": "delay"}

        action_str = json.dumps(action, separators=(",", ":"))

        # ── Step the environment ──────────────────────────────────────────────
        # openenv-core StepRequest: { "action": {...} }  — no session_id needed.
        # openenv-core StepResponse: { "observation": {...}, "reward": float, "done": bool }
        try:
            step_data   = post_json(f"{ENV_BASE_URL}/step", {"action": action})
            observation = step_data["observation"]
            reward      = float(step_data.get("reward") or 0.0)
            done        = bool(step_data.get("done", False))
            info        = step_data.get("info", {})
        except Exception as ex:
            reward    = 0.0
            done      = True
            error_msg = error_msg or str(ex)[:80]

        rewards.append(reward)
        history.append(f"Step {step}: {action_str} -> reward={reward:.2f}")
        log_step(step=step, action=action_str, reward=reward,
                 done=done, error=error_msg)

    # ── 3. Final scoring ──────────────────────────────────────────────────────
    score   = float(info.get("final_score", 0.0))
    success = score >= SUCCESS_SCORE_THRESHOLD
    log_end(success=success, steps=step, score=score, rewards=rewards)


if __name__ == "__main__":
    main()
