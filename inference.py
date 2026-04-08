#!/usr/bin/env python3

import os
import json
import urllib.request
import urllib.error
from typing import List, Optional
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
# The hackathon validator INJECTS API_BASE_URL and API_KEY into the environment.
# We MUST use those values directly — never override them with HF_TOKEN or defaults.
API_BASE_URL = os.environ.get("API_BASE_URL", "https://router.huggingface.co/v1")
API_KEY = os.environ.get("API_KEY") or os.environ.get("HF_TOKEN")
if not API_KEY:
    raise RuntimeError("API_KEY not set — must use provided key")

print("DEBUG BASE URL:", API_BASE_URL, flush=True)
print("DEBUG MODEL:", MODEL_NAME, flush=True)


# ── CLIENT ─────────────────────────────────────────────────────
client = OpenAI(base_url=API_BASE_URL, api_key=API_KEY)


# ── CONFIG ─────────────────────────────────────────────────────
TASK_NAME = "schedule-optimization"
BENCHMARK = "cognitive-load-manager"
SUCCESS_SCORE_THRESHOLD = 0.5
MAX_STEPS = 50


# ── HTTP ───────────────────────────────────────────────────────
def post_json(url: str, payload: dict) -> dict:
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url, data=data, headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=30) as res:
        return json.loads(res.read().decode("utf-8"))


# ── LOGGING ────────────────────────────────────────────────────
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


# ── MAIN ───────────────────────────────────────────────────────
def main():

    task_id = os.environ.get("CLM_LEVEL", "hard")

    log_start(task=TASK_NAME, env=BENCHMARK, model=MODEL_NAME)

    data = post_json(f"{ENV_BASE_URL}/reset", {"task_id": task_id})
    session_id = data["session_id"]
    observation = data["observation"]

    done = False
    step = 0
    rewards = []
    history = []

    while not done and step < MAX_STEPS:
        step += 1

        # ── LLM CALL (STRICT, NO TRY/CATCH) ──
        completion = client.chat.completions.create(
            model=MODEL_NAME,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are an AI task scheduler managing human cognitive load.\n"
                        "RULES:\n"
                        "1. If fatigue_level is 'high' or 'medium' OR stress_warning true → break\n"
                        "2. Otherwise pick earliest deadline incomplete task\n"
                        "Return ONLY JSON."
                    ),
                },
                {
                    "role": "user",
                    "content": json.dumps(observation),
                },
            ],
            temperature=0.1,
            max_tokens=120,
        )

        action_text = (completion.choices[0].message.content or "").strip()

        # extract json safely
        s = action_text.find("{")
        e = action_text.rfind("}")
        if s != -1 and e != -1:
            try:
                action = json.loads(action_text[s:e+1])
            except:
                action = {"type": "delay"}
        else:
            action = {"type": "delay"}

        action_str = json.dumps(action)

        # ── ENV STEP ──
        try:
            step_data = post_json(
                f"{ENV_BASE_URL}/step",
                {"session_id": session_id, "action": action},
            )
            observation = step_data["observation"]
            reward = float(step_data.get("reward", 0.0))
            done = bool(step_data.get("done", False))
        except Exception as e:
            log_step(step, action_str, 0.0, True, str(e))
            break

        rewards.append(reward)
        history.append(action_str)

        log_step(step, action_str, reward, done, None)

    score = sum(rewards) / len(rewards) if rewards else 0.0
    success = score >= SUCCESS_SCORE_THRESHOLD

    log_end(success, step, score, rewards)


if __name__ == "__main__":
    main()
