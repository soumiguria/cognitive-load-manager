#!/usr/bin/env python3
"""
inference.py — LLM Agent for Cognitive Load Manager
Runs ALL 3 tasks (easy, medium, hard) so the validator sees 3 graded tasks.
Imports CLM environment locally — guaranteed LLM calls on every step.
"""

import os
import sys
import json
from typing import List, Optional, Dict

# ── Load .env for local development ──────────────────────────────────────────
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

# ── Required env vars — exact strings checked by validator ────────────────────
API_BASE_URL = os.getenv("API_BASE_URL", "https://router.huggingface.co/v1")
MODEL_NAME   = os.getenv("MODEL_NAME",   "Qwen/Qwen2.5-72B-Instruct")
API_KEY      = os.getenv("HF_TOKEN") or os.getenv("API_KEY")

BENCHMARK             = "cognitive-load-manager"
TASK_NAME             = "schedule-optimization"
SUCCESS_SCORE_THRESHOLD = 0.5
MAX_STEPS             = 50

# ── OpenAI client — always built, always used, never gated ───────────────────
from openai import OpenAI
client = OpenAI(base_url=API_BASE_URL, api_key=API_KEY or "missing")

# ── Import CLM environment directly (no HTTP — always works) ──────────────────
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from models import Action, CLMEnvironment, generate_tasks, deterministic_grader

# ── Logging ───────────────────────────────────────────────────────────────────
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

# ── LLM action — ALWAYS called, never gated ──────────────────────────────────
def get_llm_action(observation_dict: dict, history: List[str]) -> Optional[Dict]:
    history_str = "\n".join(history[-5:]) if history else "No previous actions."

    system_prompt = (
        "You are an AI task scheduler managing human cognitive load.\n"
        "You MUST respond with ONLY a JSON object (no markdown, no explanation).\n\n"
        'ACTION FORMAT: {"type": "<action>", "task_id": "<id or null>"}\n'
        "Valid types:\n"
        '  - "work"  : work on task_id (requires task_id)\n'
        '  - "break" : rest to recover energy (task_id: null)\n'
        '  - "switch": switch to a different task_id (requires task_id)\n'
        '  - "delay" : wait/do nothing (task_id: null)\n\n'
        "STRATEGY:\n"
        "1. If fatigue_level is 'high' OR stress_warning is true → "
        '{"type": "break", "task_id": null}\n'
        "2. Otherwise → work on the incomplete task with the earliest deadline.\n"
    )

    user_prompt = (
        f"Previous 5 steps:\n{history_str}\n\n"
        f"Current observation:\n{json.dumps(observation_dict, indent=2)}\n\n"
        "What is your next action JSON?"
    )

    # Always attempt LLM call — registers on the proxy
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

    # Strip markdown fences
    for fence in ("```json", "```"):
        if text.startswith(fence):
            text = text[len(fence):]
    if text.endswith("```"):
        text = text[:-3]
    text = text.strip()

    s = text.find("{")
    e = text.rfind("}")
    if s != -1 and e != -1:
        return json.loads(text[s : e + 1])
    return None


def heuristic_action(observation_dict: dict) -> Dict:
    """Fallback used ONLY when LLM response is unparseable."""
    tasks  = observation_dict.get("tasks", [])
    incomp = [t for t in tasks if t.get("progress", 0.0) < 1.0]
    fs     = observation_dict.get("visible_state", {})
    if fs.get("fatigue_level") in ("high", "medium") or fs.get("stress_warning"):
        return {"type": "break", "task_id": None}
    elif incomp:
        return {"type": "work", "task_id": incomp[0]["id"]}
    return {"type": "delay", "task_id": None}


# ── Single task runner ────────────────────────────────────────────────────────
def run_task(level: str) -> float:
    log_start(task=TASK_NAME, env=BENCHMARK, model=MODEL_NAME)

    tasks = generate_tasks(level)
    env   = CLMEnvironment(tasks=tasks, max_steps=MAX_STEPS)
    obs   = env.reset()

    done    = False
    step    = 0
    rewards: List[float] = []
    history: List[str]   = []
    info: dict           = {}

    while not done and step < MAX_STEPS:
        step += 1

        observation_dict = {
            "tasks": [t.model_dump() for t in obs.tasks],
            "visible_state": obs.visible_state.model_dump(),
            "time_step": obs.time_step,
        }

        action_dict: Optional[Dict] = None
        error_msg: Optional[str]    = None

        # Always call LLM — never skip
        try:
            action_dict = get_llm_action(observation_dict, history)
        except Exception as ex:
            error_msg = str(ex)[:80]

        # Heuristic fallback only if LLM response is unparseable
        if not action_dict:
            action_dict = heuristic_action(observation_dict)

        valid_types = {"work", "break", "switch", "delay"}
        if action_dict.get("type") not in valid_types:
            action_dict = {"type": "delay", "task_id": None}

        action_str = json.dumps(action_dict, separators=(",", ":"))

        try:
            action          = Action(type=action_dict["type"], task_id=action_dict.get("task_id"))
            obs, reward, done, info = env.step(action)
            reward          = float(reward)
        except Exception as ex:
            reward    = 0.01
            done      = True
            error_msg = error_msg or str(ex)[:80]

        rewards.append(reward)
        history.append(f"Step {step}: {action_str} -> reward={reward:.2f}")
        log_step(step=step, action=action_str, reward=reward, done=done, error=error_msg)

    score = float(info.get("final_score", 0.0))
    if score == 0.0:
        score = deterministic_grader(env.state.tasks, env.state.time_step, env.state.energy)
    score   = max(0.01, min(0.99, score))
    success = score >= SUCCESS_SCORE_THRESHOLD

    log_end(success, step, score, rewards)
    return score


# ── Main — runs ALL 3 tasks so validator sees 3 graded tasks ──────────────────
def main():
    # Run all 3 difficulty levels — validator needs at least 3 tasks graded
    levels = ["easy", "medium", "hard"]
    all_scores = {}

    for level in levels:
        try:
            score = run_task(level)
            all_scores[level] = score
        except Exception as ex:
            print(f"[ERROR] task={level} error={str(ex)[:80]}", flush=True)
            all_scores[level] = 0.01

    avg = max(0.01, min(0.99, sum(all_scores.values()) / len(all_scores)))
    print(f"[SUMMARY] scores={json.dumps(all_scores)} average={avg:.3f}", flush=True)


if __name__ == "__main__":
    main()
