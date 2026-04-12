#!/usr/bin/env python3

import os
import json
import sys
import urllib.request
import urllib.error
from typing import List, Optional

# ── Load .env for local development ──────────────────────────────────────────
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass  # dotenv not available in validator — env vars are injected directly

from openai import OpenAI

# ── Credentials ───────────────────────────────────────────────────────────────
# The hackathon validator INJECTS API_BASE_URL and API_KEY into the environment.
# We MUST use those values directly — never override them with HF_TOKEN or defaults.
API_BASE_URL = os.getenv("API_BASE_URL", "https://router.huggingface.co/v1")
API_KEY = os.getenv("HF_TOKEN") or os.getenv("API_KEY")
if not API_KEY:
    print("WARNING: API_KEY not set. LLM calls will fail.", file=sys.stderr, flush=True)
    API_KEY = "missing"

MODEL_NAME = os.getenv("MODEL_NAME", "Qwen/Qwen2.5-72B-Instruct")
ENV_BASE_URL = os.getenv("ENV_BASE_URL", "https://huggingface.co/spaces/anonymousDevil/cognitive-load-manager")

print("DEBUG BASE URL:", API_BASE_URL, flush=True)
print("DEBUG MODEL:", MODEL_NAME, flush=True)
print("DEBUG ENV URL:", ENV_BASE_URL, flush=True)


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
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            return json.loads(res.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        raise Exception(f"HTTP {e.code}: {e.read().decode('utf-8')[:200]}")


# ── LOGGING ────────────────────────────────────────────────────
def log_start(task: str, env: str, model: str) -> None:
    print(f"[START] task={task} env={env} model={model}", flush=True)


def log_step(step: int, action: str, reward: float, done: bool, error: Optional[str]) -> None:
    print(
        f"[STEP] step={step} action={action} reward={reward:.2f} "
        f"done={str(done).lower()} error={error or 'null'}",
        flush=True,
    )


def log_end(success: bool, steps: int, score: float, rewards: List[float]) -> None:
    rewards_str = ",".join(f"{r:.2f}" for r in rewards)
    print(
        f"[END] success={str(success).lower()} steps={steps} "
        f"score={score:.3f} rewards={rewards_str}",
        flush=True,
    )


# ── MAIN ───────────────────────────────────────────────────────
def main():
    task_id = os.getenv("CLM_LEVEL", "hard")

    log_start(task=TASK_NAME, env=BENCHMARK, model=MODEL_NAME)

    # ── 1. Reset environment ─────────────────────────────────────
    try:
        data = post_json(f"{ENV_BASE_URL}/reset", {"task_id": task_id})
        session_id = data.get("session_id", "default")
        observation = data["observation"]
    except Exception as e:
        log_step(step=0, action="reset", reward=0.0, done=True, error=str(e)[:80])
        log_end(success=False, steps=0, score=0.0, rewards=[])
        return

    done = False
    step = 0
    rewards: List[float] = []
    history: List[str] = []
    info: dict = {}

    # ── 2. Agent loop ────────────────────────────────────────────
    while not done and step < MAX_STEPS:
        step += 1

        history_str = "\n".join(history[-5:]) if history else "No previous actions."

        system_prompt = (
            "You are an AI task scheduler managing human cognitive load.\n"
            "You MUST respond with ONLY a JSON object (no markdown, no explanation).\n\n"
            "ACTION FORMAT: {\"type\": \"<action>\", \"task_id\": \"<id or null>\"}\n"
            "Valid types:\n"
            "  - \"work\"  : work on task_id (requires task_id)\n"
            "  - \"break\" : rest to recover energy (task_id: null)\n"
            "  - \"switch\": switch to a different task_id (requires task_id)\n"
            "  - \"delay\" : wait/do nothing (task_id: null)\n\n"
            "STRATEGY:\n"
            "1. If fatigue_level is 'high' OR stress_warning is true → {\"type\": \"break\", \"task_id\": null}\n"
            "2. If fatigue_level is 'medium' and stress is manageable → {\"type\": \"work\", \"task_id\": \"<earliest deadline incomplete task>\"}\n"
            "3. Otherwise → {\"type\": \"work\", \"task_id\": \"<earliest deadline incomplete task>\"}\n"
            "4. Pick incomplete tasks (progress < 1.0) with the earliest deadline first.\n"
        )

        user_prompt = (
            f"Previous 5 steps:\n{history_str}\n\n"
            f"Current observation:\n{json.dumps(observation, indent=2)}\n\n"
            "What is your next action JSON?"
        )

        action: Optional[dict] = None
        error_msg: Optional[str] = None

        # ── LLM call through the validator proxy ─────────────────
        try:
            completion = client.chat.completions.create(
                model=MODEL_NAME,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                temperature=0.1,
                max_tokens=150,
            )
            text = (completion.choices[0].message.content or "").strip()

            # Strip markdown fences if present
            if text.startswith("```json"):
                text = text[7:]
            if text.startswith("```"):
                text = text[3:]
            if text.endswith("```"):
                text = text[:-3]
            text = text.strip()

            # Extract JSON
            s = text.find("{")
            e = text.rfind("}")
            if s != -1 and e != -1:
                action = json.loads(text[s : e + 1])
        except Exception as ex:
            error_msg = str(ex)[:80]

        # ── Heuristic fallback (only if LLM call failed / unparseable) ───
        if not action:
            tasks = observation.get("tasks", [])
            incomp = [t for t in tasks if t.get("progress", 0.0) < 1.0]
            fs = observation.get("visible_state", {})
            if fs.get("fatigue_level") in ("high", "medium") or fs.get("stress_warning"):
                action = {"type": "break"}
            elif incomp:
                action = {"type": "work", "task_id": incomp[0]["id"]}
            else:
                action = {"type": "delay"}

        # Validate action type
        valid_types = {"work", "break", "switch", "delay"}
        if action.get("type") not in valid_types:
            action = {"type": "delay"}

        action_str = json.dumps(action, separators=(",", ":"))

        # ── ENV STEP ─────────────────────────────────────────────
        try:
            step_data = post_json(
                f"{ENV_BASE_URL}/step",
                {"session_id": session_id, "action": action},
            )
            observation = step_data["observation"]
            reward = float(step_data.get("reward", 0.0))
            done = bool(step_data.get("done", False))
            info = step_data.get("info", {})
        except Exception as ex:
            reward = 0.0
            done = True
            error_msg = error_msg or str(ex)[:80]

        rewards.append(reward)
        history.append(f"Step {step}: {action_str} -> reward={reward:.2f}")

        log_step(step=step, action=action_str, reward=reward, done=done, error=error_msg)

    # ── 3. Final scoring ─────────────────────────────────────────
    score = float(info.get("final_score", 0.0))
    if score == 0.0 and rewards:
        score = sum(rewards) / len(rewards)
    success = score >= SUCCESS_SCORE_THRESHOLD

    log_end(success, step, score, rewards)


if __name__ == "__main__":
    main()
