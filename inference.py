import os
import json
import urllib.request
import urllib.error
from typing import List, Optional

from openai import OpenAI

# ── CRITICAL: Use ONLY validator-injected credentials. No fallbacks. ──────────
API_BASE_URL = os.environ["API_BASE_URL"]   # raises KeyError if not injected — intentional
API_KEY      = os.environ["API_KEY"]        # raises KeyError if not injected — intentional
MODEL_NAME   = os.getenv("MODEL_NAME", "Qwen/Qwen2.5-72B-Instruct")
ENV_BASE_URL = os.getenv("ENV_BASE_URL", "http://localhost:7860")

TASK_NAME  = "schedule-optimization"
BENCHMARK  = "cognitive-load-manager"
MAX_STEPS  = 50
SUCCESS_SCORE_THRESHOLD = 0.5


def post_json(url: str, payload: dict) -> dict:
    data = json.dumps(payload).encode("utf-8")
    req  = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req) as res:
        return json.loads(res.read().decode("utf-8"))


def log_start(task: str, env: str, model: str) -> None:
    print(f"[START] task={task} env={env} model={model}", flush=True)

def log_step(step: int, action: str, reward: float, done: bool, error: Optional[str]) -> None:
    print(f"[STEP] step={step} action={action} reward={reward:.2f} done={str(done).lower()} error={error or 'null'}", flush=True)

def log_end(success: bool, steps: int, score: float, rewards: List[float]) -> None:
    rewards_str = ",".join(f"{r:.2f}" for r in rewards)
    print(f"[END] success={str(success).lower()} steps={steps} score={score:.3f} rewards={rewards_str}", flush=True)


def main():
    if not API_BASE_URL or not API_KEY:
        print("[ERROR] API_BASE_URL or API_KEY not set. Cannot proceed.", flush=True)
        log_end(success=False, steps=0, score=0.0, rewards=[])
        return

    # Initialize client using ONLY the validator-provided proxy credentials
    client = OpenAI(
        base_url=API_BASE_URL,
        api_key=API_KEY,
    )

    task_id = os.getenv("CLM_LEVEL", "hard")
    log_start(task=TASK_NAME, env=BENCHMARK, model=MODEL_NAME)

    try:
        data = post_json(f"{ENV_BASE_URL}/reset", {"task_id": task_id})
    except Exception as e:
        log_step(step=0, action="reset", reward=0.0, done=True, error=str(e)[:80])
        log_end(success=False, steps=0, score=0.0, rewards=[])
        return

    session_id  = data["session_id"]
    observation = data["observation"]
    done        = False
    step        = 0
    rewards     = []
    history     = []
    info        = {}

    while not done and step < MAX_STEPS:
        step += 1
        history_str  = "\n".join(history[-5:]) if history else "No previous actions."
        system_prompt = (
            "You are an AI task scheduler managing cognitive load.\n"
            "RULES:\n"
            "1. If fatigue_level is 'high' or 'medium', output {\"type\": \"break\"}.\n"
            "2. If stress_warning is true, output {\"type\": \"break\"}.\n"
            "3. Find tasks where progress < 1.0 and output {\"type\": \"work\", \"task_id\": \"<id>\"}.\n"
            "4. Respond ONLY with raw JSON. No markdown."
        )
        user_prompt = (
            f"Previous 5 steps:\n{history_str}\n\n"
            f"Observation:\n{json.dumps(observation, indent=2)}\n\n"
            "Next action JSON?"
        )

        action    = None
        error_msg = None

        try:
            completion  = client.chat.completions.create(
                model=MODEL_NAME,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user",   "content": user_prompt},
                ],
                temperature=0.1,
                max_tokens=150,
            )
            text = (completion.choices[0].message.content or "").strip()
            text = text.removeprefix("```json").removesuffix("```").strip()
            s, e = text.find("{"), text.rfind("}")
            if s != -1 and e != -1:
                action = json.loads(text[s:e+1])
        except Exception as ex:
            error_msg = str(ex)[:80]

        # Fallback if LLM call failed or returned unparseable output
        if not action:
            tasks   = observation.get("tasks", [])
            incomp  = [t for t in tasks if t.get("progress", 0.0) < 1.0]
            fatigue = observation.get("visible_state", {}).get("fatigue_level", "low")
            if fatigue in ("high", "medium"):
                action = {"type": "break"}
            elif incomp:
                action = {"type": "work", "task_id": incomp[0]["id"]}
            else:
                action = {"type": "delay"}

        action_str = json.dumps(action, separators=(",", ":"))

        try:
            step_data   = post_json(f"{ENV_BASE_URL}/step", {"session_id": session_id, "action": action})
            observation = step_data["observation"]
            reward      = step_data.get("reward", 0.0)
            done        = step_data.get("done", False)
            info        = step_data.get("info", {})
        except Exception as ex:
            reward    = 0.0
            done      = True
            error_msg = error_msg or str(ex)[:80]

        rewards.append(reward)
        history.append(f"Step {step}: {action_str} -> reward={reward:.2f}")
        log_step(step=step, action=action_str, reward=reward, done=done, error=error_msg)

    score   = info.get("final_score", 0.0)
    success = score >= SUCCESS_SCORE_THRESHOLD
    log_end(success=success, steps=step, score=score, rewards=rewards)


if __name__ == "__main__":
    main()
