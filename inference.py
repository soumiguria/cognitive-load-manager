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
        "You are an Oracle Manager AI coordinating 3 Full-Time Employees (FTEs).\n"
        "Respond with ONLY a JSON object — no markdown, no explanation.\n\n"
        'FORMAT: {"type": "<action>", "task_id": "<id or null>", "worker_id": "<w1/w2/w3>"}\n\n'
        "ACTIONS:\n"
        '  "work"  — normal work on task_id by worker_id\n'
        '  "focus" — deep-work: 2x progress, 2x energy cost\n'
        '  "break" — rest to recover energy for worker_id\n'
        '  "switch"— change to a different task_id\n'
        '  "delay" — push task to tomorrow (incurs penalty)\n\n'
        "STRATEGY:\n"
        "1. Match task types to worker expertise (analytical vs social).\n"
        "2. If a worker's energy < 0.35 OR stress_warning -> assign them a 'break'.\n"
        "3. Avoid assigning identical task types consecutively to the same worker to prevent context fatigue.\n"
        "4. Prioritize critical tasks for your most rested workers.\n"
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
    """Oracle Manager fallback heuristic routing to 3 FTEs."""
    vs      = obs.get("visible_state", {})
    blocked = set(vs.get("blocked_tasks", []))
    tasks   = [t for t in obs.get("tasks", []) if t.get("progress", 0.0) < 1.0 and t["id"] not in blocked]
    
    workers = vs.get("workers", [])
    if not workers:
        return {"type": "delay", "task_id": None, "worker_id": "w1"}

    # Find the most rested worker
    workers.sort(key=lambda w: (1 if w.get("fatigue_level") == "high" else 0, w.get("stress_warning", False)))
    best_worker = workers[0]
    wid = best_worker["id"]

    if best_worker.get("fatigue_level") == "high" or best_worker.get("stress_warning"):
        return {"type": "break", "task_id": None, "worker_id": wid}

    if tasks:
        # Match task to worker expertise
        w_exp = best_worker.get("expertise", "analytical")
        # simplistic bucket mapping
        def exp_match(t):
            tt = t.get("task_type", "")
            bucket = "social" if tt in ("email", "meeting", "call") else "analytical"
            return 0 if bucket == w_exp else 1

        pmap = {"critical": 0, "high": 1, "normal": 2, "low": 3}
        tasks.sort(key=lambda t: (pmap.get(t.get("priority", "normal"), 2), exp_match(t), t.get("deadline") or 9999))
        t = tasks[0]
        atype = "focus" if t.get("priority") == "critical" else "work"
        return {"type": atype, "task_id": t["id"], "worker_id": wid}
        
    return {"type": "delay", "task_id": None, "worker_id": wid}


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
            action = Action(
                type=action_dict["type"], 
                task_id=action_dict.get("task_id"),
                worker_id=action_dict.get("worker_id", "w1")
            )
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
