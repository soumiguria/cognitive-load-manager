import requests
import json
import re
import os
import time
from typing import List

# IMPORTANT: You need `trl`, `transformers`, and `datasets` to run this locally.
# pip install trl transformers datasets torch
try:
    from trl import GRPOTrainer, GRPOConfig
    from transformers import AutoModelForCausalLM, AutoTokenizer
    from datasets import Dataset
except ImportError:
    print("Dependencies missing! Ensure `trl` and `transformers` are installed.")

CLM_SERVER = "http://localhost:7860"

# ==========================================
# PROMPT CONSTRUCTION
# ==========================================

def format_tasks(tasks: list) -> str:
    lines = []
    for t in tasks:
        diff = t.get("difficulty", "medium")
        p = t.get("progress", 0.0)
        pri = t.get("priority", "normal")
        dead = t.get("deadline", "None")
        deps = t.get("depends_on", "None")
        lines.append(
            f"- [{t['id']}] {t['task_type']} | Pri: {pri} | Dead: {dead} "
            f"| Prog: {p:.2f} | Dep: {deps}"
        )
    return "\n".join(lines)


def manager_agent(state: dict) -> str:
    """Multi-Agent Oracle Manager: inspects worker states and issues guidance."""
    workers = state.get("workers", [])
    advice = []

    for w in workers:
        wid = w.get("id", "?")
        if w.get("fatigue_level") == "high":
            advice.append(
                f"Worker {wid} is burning out! MANDATORY: assign a 'break' to recover energy."
            )
        if w.get("stress_level") == "critical":
            advice.append(
                f"Worker {wid} stress is CRITICAL — delay non-critical tasks or use focus mode fast."
            )

    if state.get("upcoming_deadlines"):
        advice.append(
            f"Deadlines imminent: {state['upcoming_deadlines']} — prioritise these NOW."
        )
    if state.get("blocked_tasks"):
        advice.append(
            f"Blocked tasks (skip these): {state['blocked_tasks']}."
        )

    return " ".join(advice) if advice else "State is stable. Maintain a steady work pace."


def build_prompt(observation: dict) -> str:
    """Convert a CLM observation dict into an LLM prompt for the Worker Agent."""
    tasks = observation.get("tasks", [])
    state = observation.get("visible_state", {})
    workers = state.get("workers", [])

    # Pick first worker's summary for the prompt headline
    first_w = workers[0] if workers else {}
    manager_advice = manager_agent(state)

    return f"""You are a productivity AI acting as a worker managed by an Oracle Manager.

Current State:
- Energy Level: {first_w.get('fatigue_level', 'unknown')}
- Stress Level: {first_w.get('stress_level', 'unknown')}
- Focus Mode: {state.get('focus_mode', False)}
- Blocked Tasks: {state.get('blocked_tasks', [])}
- Time Step: {observation.get('time_step', 0)}

MANAGER DIRECTIVE: {manager_advice}

Tasks:
{format_tasks(tasks)}

Choose ONE action.
Available actions:
- work <task_id>: Normal work on task
- focus <task_id>: Deep work (2x progress, 2x energy cost)
- break: Rest to recover energy
- switch <task_id>: Switch focus to another task
- delay: Wait one step

Respond strictly with JSON only: {{"type": "work", "task_id": "m1"}}
"""


def parse_action(response: str) -> dict:
    default_act = {"type": "delay"}
    try:
        match = re.search(r"\{[^{}]*\}", response)
        if match:
            parsed = json.loads(match.group(0))
            if "type" in parsed:
                return parsed
        return default_act
    except Exception:
        return default_act


# ==========================================
# REAL REWARD FUNCTION
# ==========================================

def clm_reward_function(completions: List[str], **kwargs) -> List[float]:
    """
    REAL reward function — actually plays episodes in the CLM environment.

    Each completion is an action string the LLM chose.  We reset the env,
    step it with that action, and return the real reward the environment gives.

    This is what makes training meaningful: the LLM learns to pick actions
    that score well in the real cognitive-load simulation.
    """
    rewards = []

    for completion in completions:
        try:
            # Start a fresh episode with a medium-difficulty task set
            reset_resp = requests.post(
                f"{CLM_SERVER}/reset",
                json={"task_id": "medium"},
                timeout=10,
            ).json()

            # Extract observation for context (not used here but good for logging)
            obs = reset_resp.get("observation", reset_resp)

            # Parse the LLM's action from its text output
            action = parse_action(completion)

            # Ensure work/focus actions have a task_id — default to first available
            if action.get("type") in ("work", "focus") and not action.get("task_id"):
                tasks = obs.get("tasks", [])
                if tasks:
                    action["task_id"] = tasks[0]["id"]

            # Step the environment with the parsed action
            step_resp = requests.post(
                f"{CLM_SERVER}/step",
                json={"action": action},
                timeout=10,
            ).json()

            # The real reward from the environment physics
            real_reward = float(step_resp.get("reward", 0.0))
            rewards.append(real_reward)

        except requests.exceptions.ConnectionError:
            # Server not running — apply a strong penalty so training fails loudly
            print(
                f"[CLM] ERROR: Cannot reach {CLM_SERVER}. "
                "Start the server with: uvicorn server.app:app --port 7860 --reload"
            )
            rewards.append(-1.0)
        except Exception as e:
            print(f"[CLM] Env error during reward: {e}")
            rewards.append(-0.1)

    return rewards


# ==========================================
# DATASET COLLECTION
# ==========================================

def collect_prompts(n: int = 50, difficulty: str = "medium") -> List[dict]:
    """
    Collect real environment observations as training prompts.

    Each prompt is a fresh episode state. Running n resets gives the LLM
    diverse starting conditions (random seeds) to learn from.
    """
    prompts = []
    print(f"[CLM] Collecting {n} prompts from environment (difficulty={difficulty})...")

    for i in range(n):
        try:
            resp = requests.post(
                f"{CLM_SERVER}/reset",
                json={"task_id": difficulty},
                timeout=10,
            ).json()
            obs = resp.get("observation", resp)
            prompt = build_prompt(obs)
            prompts.append({"prompt": prompt})
        except requests.exceptions.ConnectionError:
            print(
                f"[CLM] Server offline at {CLM_SERVER} — "
                "using fallback prompts. Real training requires the server."
            )
            # Provide a minimal fallback so the training loop doesn't crash
            fallback_obs = {
                "tasks": [
                    {"id": "m1", "task_type": "email", "priority": "critical",
                     "progress": 0.0, "deadline": 14, "depends_on": None},
                    {"id": "m2", "task_type": "code_review", "priority": "high",
                     "progress": 0.0, "deadline": 20, "depends_on": None},
                ],
                "visible_state": {
                    "workers": [{"id": "w1", "fatigue_level": "low",
                                 "stress_level": "calm", "expertise": "analytical"}],
                    "focus_mode": False,
                    "upcoming_deadlines": [],
                    "blocked_tasks": [],
                },
                "time_step": 0,
            }
            prompts.append({"prompt": build_prompt(fallback_obs)})
        except Exception as e:
            print(f"[CLM] Prompt collection error at step {i}: {e}")
            continue

    print(f"[CLM] Collected {len(prompts)} prompts.")
    return prompts if prompts else [{"prompt": build_prompt({})}]


# ==========================================
# REWARD CURVE LOGGING
# ==========================================

_reward_log: list[dict] = []


def log_reward(step: int, rewards: list[float]) -> None:
    """Record per-step reward stats so we can plot a learning curve later."""
    entry = {
        "step": step,
        "mean": sum(rewards) / len(rewards) if rewards else 0.0,
        "max": max(rewards) if rewards else 0.0,
        "min": min(rewards) if rewards else 0.0,
    }
    _reward_log.append(entry)
    print(
        f"[CLM] Step {step:>4} | "
        f"mean_reward={entry['mean']:+.4f} | "
        f"max={entry['max']:+.4f} | "
        f"min={entry['min']:+.4f}"
    )


def save_reward_curve(path: str = "reward_curve.json") -> None:
    with open(path, "w") as f:
        json.dump(_reward_log, f, indent=2)
    print(f"[CLM] Reward curve saved to {path}")


def plot_reward_curve(path: str = "reward_curve.json") -> None:
    """Print an ASCII reward curve from the saved log. Requires no extra libraries."""
    try:
        with open(path) as f:
            data = json.load(f)
    except FileNotFoundError:
        print("[CLM] No reward curve file found. Run training first.")
        return

    if not data:
        print("[CLM] Reward log is empty.")
        return

    means = [d["mean"] for d in data]
    lo, hi = min(means), max(means)
    span = hi - lo if hi != lo else 1.0
    width = 40

    print("\n[CLM] Reward Learning Curve (ASCII)")
    print(f"  min={lo:+.3f}  max={hi:+.3f}  steps={len(means)}")
    print("  " + "-" * (width + 4))
    for d in data:
        bar_len = int((d["mean"] - lo) / span * width)
        bar = "#" * bar_len
        print(f"  {d['step']:>4} | {bar:<{width}} | {d['mean']:+.4f}")
    print("  " + "-" * (width + 4))


# ==========================================
# TRAINING LOOP
# ==========================================

def run_training_loop():
    model_name = "Qwen/Qwen2.5-1.5B-Instruct"
    print(f"[CLM] Loading model: {model_name}")

    try:
        model = AutoModelForCausalLM.from_pretrained(model_name)
        tokenizer = AutoTokenizer.from_pretrained(model_name)
    except Exception as e:
        print(f"[CLM] Could not load HuggingFace model. Error: {e}")
        return

    # Collect real prompts from the live environment
    prompts_data = collect_prompts(n=50, difficulty="medium")
    dataset = Dataset.from_list(prompts_data)

    print("[CLM] Configuring GRPO Trainer...")
    config = GRPOConfig(
        output_dir="grpo_clm_model",
        learning_rate=1e-5,
        num_train_epochs=3,
        per_device_train_batch_size=2,
        max_prompt_length=1024,
        max_completion_length=128,
        logging_steps=1,
        save_steps=50,
    )

    # Wrap reward function to also log reward curves
    step_counter = [0]

    def tracked_reward(completions: List[str], **kwargs) -> List[float]:
        rewards = clm_reward_function(completions, **kwargs)
        log_reward(step_counter[0], rewards)
        step_counter[0] += 1
        return rewards

    trainer = GRPOTrainer(
        model=model,
        reward_funcs=[tracked_reward],
        args=config,
        train_dataset=dataset,
    )

    print("[CLM] Starting training...")
    start = time.time()
    trainer.train()
    elapsed = time.time() - start

    print(f"[CLM] Training complete in {elapsed:.1f}s. Saving model.")
    trainer.save_model("grpo_clm_model_final")

    save_reward_curve("reward_curve.json")
    plot_reward_curve("reward_curve.json")


if __name__ == "__main__":
    print("--- Cognitive Load Manager: GRPO Training Script ---")
    print("Theme #1 (Multi-Agent): Oracle Manager oversees 3 Worker Agents.")
    print("Theme #2 (OpenEnv):     Real env steps drive the reward signal.")
    print()
    print("Make sure the CLM server is running first:")
    print("  uvicorn server.app:app --port 7860 --reload")
    print()

    import sys
    if "--train" in sys.argv:
        run_training_loop()
    elif "--plot" in sys.argv:
        plot_reward_curve("reward_curve.json")
    elif "--test-reward" in sys.argv:
        # Quick sanity-check: fire one real reward call against the live server
        print("[CLM] Testing reward function against live server...")
        test_completions = [
            '{"type": "work", "task_id": "m1"}',
            '{"type": "break"}',
            '{"type": "focus", "task_id": "m1"}',
            'invalid json garbage',
        ]
        rewards = clm_reward_function(test_completions)
        for c, r in zip(test_completions, rewards):
            print(f"  action={c!r:50s}  reward={r:+.4f}")
    else:
        print("Usage:")
        print("  python training_loop.py --test-reward   # verify env connection")
        print("  python training_loop.py --train         # run full GRPO training")
        print("  python training_loop.py --plot          # show reward curve")
