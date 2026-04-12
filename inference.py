#!/usr/bin/env python3
"""
inference.py — LLM Agent for Cognitive Load Manager v2.0
Runs ALL 4 tasks (easy, medium, hard, expert) — validator sees 4 graded tasks.
Always calls LLM via OpenAI client on every step.
"""

import os, sys, json
from typing import List, Optional, Dict

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

API_BASE_URL = os.getenv("API_BASE_URL", "https://router.huggingface.co/v1")
MODEL_NAME   = os.getenv("MODEL_NAME",   "Qwen/Qwen2.5-72B-Instruct")
API_KEY      = os.getenv("HF_TOKEN") or os.getenv("API_KEY")

BENCHMARK             = "cognitive-load-manager"
TASK_NAME             = "schedule-optimization"
SUCCESS_SCORE_THRESHOLD = 0.50

from openai import OpenAI
client = OpenAI(base_url=API_BASE_URL, api_key=API_KEY or "missing")

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from models import Action, CLMEnvironment, generate_tasks, deterministic_grader


# ── Logging ───────────────────────────────────────────────────────────────────
def log_start(task, env, model):
    print(f"[START] task={task} env={env} model={model}", flush=True)

def log_step(step, action, reward, done, error):
    print(
        f"[STEP] step={step} action={action} reward={reward:.2f} "
        f"done={str(done).lower()} error={error or 'null'}",
        flush=True,
    )

def log_end(success, steps, score, rewards):
    print(
        f"[END] success={str(success).lower()} steps={steps} "
        f"score={score:.3f} rewards={','.join(f'{r:.2f}' for r in rewards)}",
        flush=True,
    )


# ── LLM Action ────────────────────────────────────────────────────────────────
def get_llm_action(obs: dict, history: List[str]) -> Optional[Dict]:
    hist_str = "\n".join(history[-5:]) if history else "No previous steps."

    system = (
        "You are an AI productivity assistant managing human cognitive load.\n"
        "Respond with ONLY a JSON object — no markdown, no explanation.\n\n"
        'FORMAT: {"type": "<action>", "task_id": "<id or null>"}\n\n'
        "ACTIONS:\n"
        '  "work"  — normal work on task_id (required)\n'
        '  "focus" — deep-work: 2x progress, 2x energy cost on task_id (required)\n'
        '  "break" — rest to recover energy (task_id: null)\n'
        '  "switch"— change to a different task_id (required)\n'
        '  "delay" — wait one step (task_id: null)\n\n'
        "STRATEGY:\n"
        "1. NEVER work on a task listed in blocked_tasks (unmet dependency).\n"
        "2. If energy < 0.35 OR stress_warning → take a break.\n"
        "3. Use 'focus' on critical tasks with upcoming_deadlines.\n"
        "4. Otherwise work on the highest-priority (critical > high > normal > low) "
        "   incomplete task with the nearest deadline.\n"
        "5. If an interrupted task appears, treat it as critical.\n"
    )

    user = (
        f"Recent steps:\n{hist_str}\n\n"
        f"Observation:\n{json.dumps(obs, indent=2)}\n\n"
        "What is your next action JSON?"
    )

    completion = client.chat.completions.create(
        model=MODEL_NAME,
        messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
        temperature=0.1,
        max_tokens=150,
    )
    text = (completion.choices[0].message.content or "").strip()
    for fence in ("```json", "```"):
        if text.startswith(fence): text = text[len(fence):]
    if text.endswith("```"): text = text[:-3]
    text = text.strip()
    s, e = text.find("{"), text.rfind("}")
    if s != -1 and e != -1:
        return json.loads(text[s:e+1])
    return None


def heuristic_fallback(obs: dict) -> Dict:
    """Fallback used ONLY when LLM response is unparseable."""
    vs      = obs.get("visible_state", {})
    blocked = set(vs.get("blocked_tasks", []))
    tasks   = [t for t in obs.get("tasks", [])
               if t.get("progress", 0.0) < 1.0 and t["id"] not in blocked]
    # FIX 6: observation is now partially observable — use categorical labels
    fatigue = vs.get("fatigue_level", "low")
    if fatigue == "high" or vs.get("stress_warning", False):
        return {"type": "break", "task_id": None}
    if tasks:
        # Sort: critical > high > normal > low, then nearest deadline
        pmap = {"critical": 0, "high": 1, "normal": 2, "low": 3}
        tasks.sort(key=lambda t: (pmap.get(t.get("priority", "normal"), 2),
                                  t.get("deadline") or 9999))
        t = tasks[0]
        fatigue_ok = vs.get("fatigue_level", "low") != "high"
        atype = "focus" if t.get("priority") == "critical" and fatigue_ok else "work"
        return {"type": atype, "task_id": t["id"]}
    return {"type": "delay", "task_id": None}


# ── Single task runner ────────────────────────────────────────────────────────
def run_task(level: str) -> float:
    max_steps = 60 if level == "expert" else 50
    log_start(task=TASK_NAME, env=BENCHMARK, model=MODEL_NAME)

    tasks = generate_tasks(level)
    env   = CLMEnvironment(tasks=tasks, max_steps=max_steps)
    obs   = env.reset()

    done, step, rewards, history, info = False, 0, [], [], {}

    while not done and step < max_steps:
        step += 1
        obs_dict = {
            "tasks":         [t.model_dump() for t in obs.tasks],
            "visible_state": obs.visible_state.model_dump(),
            "time_step":     obs.time_step,
        }

        action_dict: Optional[Dict] = None
        error_msg:   Optional[str]  = None

        try:
            action_dict = get_llm_action(obs_dict, history)
        except Exception as ex:
            error_msg = str(ex)[:80]

        if not action_dict:
            action_dict = heuristic_fallback(obs_dict)

        if action_dict.get("type") not in {"work", "break", "switch", "delay", "focus"}:
            action_dict = {"type": "delay", "task_id": None}

        action_str = json.dumps(action_dict, separators=(",", ":"))

        try:
            action = Action(type=action_dict["type"], task_id=action_dict.get("task_id"))
            obs, reward, done, info = env.step(action)
            reward = float(reward)
        except Exception as ex:
            reward, done, error_msg = 0.01, True, error_msg or str(ex)[:80]

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


# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    levels     = ["easy", "medium", "hard", "expert"]
    all_scores = {}
    for level in levels:
        try:
            all_scores[level] = run_task(level)
        except Exception as ex:
            print(f"[ERROR] task={level} error={str(ex)[:80]}", flush=True)
            all_scores[level] = 0.01

    avg = max(0.01, min(0.99, sum(all_scores.values()) / len(all_scores)))
    print(f"[SUMMARY] scores={json.dumps(all_scores)} average={avg:.3f}", flush=True)


if __name__ == "__main__":
    main()
