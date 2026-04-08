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


# ── HTTP Helper ──────────────────────────────────────────────────────────────
def post_json(url: str, payload: dict) -> dict:
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url, data=data, headers={"Content-Type": "application/json"}
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            return json.loads(res.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        raise Exception(f"HTTP Error {e.code}: {e.read().decode('utf-8')}")
    except urllib.error.URLError as e:
        raise Exception(f"URL Error: {e.reason}")


# ── ENV ───────────────────────────────────────────────────────────────────────
# IMPORTANT: Use the injected API_BASE_URL and API_KEY from the validator.
# Do NOT hardcode fallbacks that bypass the LiteLLM proxy.
API_BASE_URL = os.environ["API_BASE_URL"]
API_KEY      = os.environ["API_KEY"]
MODEL_NAME   = os.environ.get("MODEL_NAME", "Qwen/Qwen2.5-72B-Instruct")
ENV_BASE_URL = os.environ.get("ENV_BASE_URL", "http://localhost:7860")


# ── CONFIG ───────────────────────────────────────────────────────────────────
TASK_NAME               = "schedule-optimization"
BENCHMARK               = "cognitive-load-manager"
SUCCESS_SCORE_THRESHOLD = 0.5
MAX_STEPS               = 50


# ── LOGGING ──────────────────────────────────────────────────────────────────
def log_start(task: str, env: str, model: str) -> None:
    print(f"[START] task={task} env={env} model={model}", flush=True)

def log_step(step: int, action: str, reward: float, done: bool, error: Optional[str]) -> None:
    print(
        f"[STEP] step={step} action={action} reward={reward:.2f} done={str(done).lower()} error={error if error else 'null'}",
        flush=True,
    )

def log_end(success: bool, steps: int, score: float, rewards: List[float]) -> None:
    print(
        f"[END] success={str(success).lower()} steps={steps} score={score:.3f} rewards={','.join(f'{r:.2f}' for r in rewards)}",
        flush=True,
    )


# ── FALLBACK HEURISTIC ────────────────────────────────────────────────────────
def heuristic_action(observation: dict) -> dict:
    """Rule-based fallback when LLM call fails or returns unparseable output."""
    visible        = observation.get("visible_state", {})
    fatigue        = visible.get("fatigue_level", "low")
    stress_warning = visible.get("stress_warning", False)

    if fatigue in ("high", "medium") or stress_warning:
        return {"type": "break"}

    tasks      = observation.get("tasks", [])
    incomplete = [t for t in tasks if t.get("progress", 0.0) < 1.0]
    incomplete.sort(key=lambda t: (t.get("deadline") is None, t.get("deadline", 9999)))

    if incomplete:
        return {"type": "work", "task_id": incomplete[0]["id"]}
    return {"type": "delay"}


# ── MAIN ─────────────────────────────────────────────────────────────────────
def main() -> None:
    # Initialize client with the injected proxy credentials — no fallbacks
    client  = OpenAI(base_url=API_BASE_URL, api_key=API_KEY)
    task_id = os.environ.get("CLM_LEVEL", "hard")

    log_start(task=TASK_NAME, env=BENCHMARK, model=MODEL_NAME)

    # Reset environment
    try:
        data = post_json(f"{ENV_BASE_URL}/reset", {"task_id": task_id})
    except Exception as e:
        log_step(step=0, action="reset", reward=0.0, done=True, error=str(e)[:80])
        log_end(success=False, steps=0, score=0.0, rewards=[])
        return

    session_id  = data["session_id"]
    observation = data["observation"]

    done: bool           = False
    step: int            = 0
    rewards: List[float] = []
    history: List[str]   = []
    info: dict           = {}

    while not done and step < MAX_STEPS:
        step += 1
        action: Optional[dict] = None
        error_msg: Optional[str] = None

        # LLM call — always goes through the injected API_BASE_URL proxy
        try:
            history_str   = "\n".join(history[-5:]) if history else "No previous actions."
            system_prompt = (
                "You are an AI task scheduler managing human cognitive load.\n"
                "RULES:\n"
                "1. If fatigue_level is 'high' or 'medium', or stress_warning is true → output {\"type\": \"break\"}\n"
                "2. Otherwise work on the incomplete task with the earliest deadline.\n"
                "3. Respond ONLY with raw JSON — no markdown, no explanation.\n"
                "Valid actions: {\"type\": \"work\", \"task_id\": \"<id>\"} | {\"type\": \"break\"} | "
                "{\"type\": \"delay\"} | {\"type\": \"switch\", \"task_id\": \"<id>\"}"
            )
            user_prompt = (
                f"Previous 5 steps:\n{history_str}\n\n"
                f"Current observation:\n{json.dumps(observation, indent=2)}\n\n"
                "What is your next action JSON?"
            )

            completion  = client.chat.completions.create(
                model=MODEL_NAME,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user",   "content": user_prompt},
                ],
                temperature=0.1,
                max_tokens=150,
            )
            action_text = (completion.choices[0].message.content or "").strip()

            # Strip accidental markdown fences
            for fence in ("```json", "```"):
                if action_text.startswith(fence):
                    action_text = action_text[len(fence):]
            if action_text.endswith("```"):
                action_text = action_text[:-3]
            action_text = action_text.strip()

            s = action_text.find("{")
            e = action_text.rfind("}")
            if s != -1 and e != -1:
                action = json.loads(action_text[s: e + 1])

        except Exception as exc:
            error_msg = str(exc)[:80]

        # Fallback if LLM gave no valid action
        if not action:
            action = heuristic_action(observation)

        action_str = json.dumps(action, separators=(",", ":"))

        # Step the environment
        try:
            step_data   = post_json(
                f"{ENV_BASE_URL}/step",
                {"session_id": session_id, "action": action},
            )
            observation = step_data["observation"]
            reward      = float(step_data.get("reward", 0.0))
            done        = bool(step_data.get("done", False))
            info        = step_data.get("info", {})
        except Exception as exc:
            reward    = 0.0
            done      = True
            error_msg = error_msg or str(exc)[:80]

        rewards.append(reward)
        history.append(f"Step {step} Action: {action_str} -> Reward: {reward:.2f}")
        log_step(step=step, action=action_str, reward=reward, done=done, error=error_msg)

    score   = float(info.get("final_score", 0.0))
    success = score >= SUCCESS_SCORE_THRESHOLD
    log_end(success=success, steps=step, score=score, rewards=rewards)


if __name__ == "__main__":
    main()
