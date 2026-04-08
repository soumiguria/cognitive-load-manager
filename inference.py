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

# /// script
# requires-python = ">=3.11"
# dependencies = [
#     "openai",
# ]
# ///

from openai import OpenAI

def post_json(url: str, payload: dict) -> dict:
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req) as res:
            return json.loads(res.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        raise Exception(f"HTTP Error {e.code}: {e.read().decode('utf-8')}")

# ── Environment variables ────────────────────────────────────────────────────
# API_BASE_URL = os.getenv("API_BASE_URL", "https://router.huggingface.co/v1")
# HF_TOKEN = os.getenv("HF_TOKEN")

# API_KEY = HF_TOKEN or os.getenv("API_KEY")
# if not API_KEY:
#     raise ValueError("API_KEY environment variable is required")

API_BASE_URL = os.getenv("API_BASE_URL")
API_KEY = os.getenv("API_KEY")

if not API_BASE_URL:
    raise ValueError("API_BASE_URL must be set")

if not API_KEY:
    raise ValueError("API_KEY must be set")

MODEL_NAME = os.getenv("MODEL_NAME", "Qwen/Qwen2.5-72B-Instruct")
ENV_BASE_URL = os.getenv("ENV_BASE_URL", "http://localhost:7860")

TASK_NAME = "schedule-optimization"
BENCHMARK = "cognitive-load-manager"
SUCCESS_SCORE_THRESHOLD = 0.5
MAX_STEPS = 50

def log_start(task: str, env: str, model: str) -> None:
    print(f"[START] task={task} env={env} model={model}", flush=True)

def log_step(step: int, action: str, reward: float, done: bool, error: Optional[str]) -> None:
    error_val = error if error else "null"
    done_val = str(done).lower()
    print(
        f"[STEP] step={step} action={action} reward={reward:.2f} done={done_val} error={error_val}",
        flush=True,
    )

def log_end(success: bool, steps: int, score: float, rewards: List[float]) -> None:
    rewards_str = ",".join(f"{r:.2f}" for r in rewards)
    print(f"[END] success={str(success).lower()} steps={steps} score={score:.3f} rewards={rewards_str}", flush=True)

def main():
    # Always initialise the OpenAI client using the proxy URL and API key.
    # The hackathon validator requires ALL LLM calls to go through API_BASE_URL
    # with the provided API_KEY — never bypass this with hardcoded credentials.
    client = OpenAI(base_url=API_BASE_URL, api_key=API_KEY)

    task_id = os.getenv("CLM_LEVEL", "hard")

    log_start(task=TASK_NAME, env=BENCHMARK, model=MODEL_NAME)

    # 1. Reset Environment
    try:
        data = post_json(f"{ENV_BASE_URL}/reset", {"task_id": task_id})
    except Exception as e:
        log_step(step=0, action="reset", reward=0.0, done=True, error=str(e)[:50])
        log_end(success=False, steps=0, score=0.0, rewards=[])
        return

    session_id = data["session_id"]
    observation = data["observation"]

    done = False
    step = 0
    rewards = []
    history = []
    info = {}

    while not done and step < MAX_STEPS:
        step += 1

        # 2. Get next action from LLM via the hackathon proxy
        history_str = "\n".join(history[-5:]) if history else "No previous actions."
        system_prompt = """
You are an AI task scheduler managing cognitive load.
CRITICAL RULES:
1. If "fatigue_level" is "high" or "medium", output {"type": "break"}. Do NOT work until fatigue is "low".
2. If "stress_warning" is true, {"type": "break"} reduces stress safely.
3. Find tasks where "progress" < 1.0. Output {"type": "work", "task_id": "<id>"}. Do NOT work on 1.0 tasks.
4. Respond ONLY with raw JSON format. No markdown blocks.
Valid actions: {"type": "work", "task_id": "id"}, {"type": "break"}, {"type": "delay"}, {"type": "switch", "task_id": "id"}
"""
        user_prompt = f"""
Previous 5 Steps History:
{history_str}

Current Observation:
{json.dumps(observation, indent=2)}

What is your next action JSON?
"""
        action = None
        error_msg = None

        try:
            completion = client.chat.completions.create(
                model=MODEL_NAME,
                messages=[
                    {"role": "system", "content": system_prompt.strip()},
                    {"role": "user", "content": user_prompt.strip()}
                ],
                temperature=0.1,
                max_tokens=150
            )
            action_text = (completion.choices[0].message.content or "").strip()

            # Strip accidental markdown code fences
            if action_text.startswith("```json"):
                action_text = action_text[7:]
            if action_text.startswith("```"):
                action_text = action_text[3:]
            if action_text.endswith("```"):
                action_text = action_text[:-3]

            start_idx = action_text.find("{")
            end_idx = action_text.rfind("}")
            if start_idx != -1 and end_idx != -1:
                action = json.loads(action_text[start_idx:end_idx + 1])
        except Exception as e:
            error_msg = str(e)[:50]

        # Fallback heuristic only if LLM call failed / returned unparseable output
        if not action:
            tasks = observation.get("tasks", [])
            incomp = [t for t in tasks if t.get("progress", 0.0) < 1.0]
            if observation.get("visible_state", {}).get("fatigue_level") in ("high", "medium"):
                action = {"type": "break"}
            elif incomp:
                action = {"type": "work", "task_id": incomp[0]["id"]}
            else:
                action = {"type": "delay"}

        action_str = json.dumps(action).replace(" ", "")

        # 3. Step the environment
        try:
            step_data = post_json(f"{ENV_BASE_URL}/step", {
                "session_id": session_id,
                "action": action
            })
            observation = step_data["observation"]
            reward = step_data.get("reward", 0.0)
            done = step_data.get("done", False)
            info = step_data.get("info", {})
        except Exception as e:
            reward = 0.0
            done = True
            error_msg = error_msg or str(e)[:50]

        rewards.append(reward)
        history.append(f"Step {step} Action: {action_str} -> Reward: {reward}")
        log_step(step=step, action=action_str, reward=reward, done=done, error=error_msg)

    score = info.get("final_score", 0.0)
    success = score >= SUCCESS_SCORE_THRESHOLD
    log_end(success=success, steps=step, score=score, rewards=rewards)

if __name__ == "__main__":
    main()
