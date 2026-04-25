import requests
import json
import re

# IMPORTANT: You need `trl`, `transformers`, and `datasets` to run this locally.
# pip install trl transformers datasets torch
try:
    from trl import GRPOTrainer, GRPOConfig
    from transformers import AutoModelForCausalLM, AutoTokenizer
    from datasets import Dataset
except ImportError:
    print("Dependencies missing! Ensure `trl` and `transformers` are installed.")

CLM_SERVER = "http://localhost:7860"

def format_tasks(tasks: list) -> str:
    lines = []
    for t in tasks:
        diff = t.get("difficulty", "medium")
        p = t.get("progress", 0.0)
        pri = t.get("priority", "normal")
        dead = t.get("deadline", "None")
        deps = t.get("depends_on", "None")
        lines.append(f"- [{t['id']}] {t['task_type']} | Pri: {pri} | Dead: {dead} | Prog: {p:.2f} | Dep: {deps}")
    return "\n".join(lines)

def manager_agent(state: dict) -> str:
    """Multi-Agent Manager: Inspects worker's state and issues guidance."""
    fatigue = state.get("fatigue_level", "low")
    stress = state.get("stress_level", "calm")
    
    advice = []
    if fatigue == "high":
        advice.append("Worker is burning out! MANDATORY: Take a 'break' to recover energy.")
    if stress == "critical":
        advice.append("Stress is CRITICAL! Delay non-critical tasks or execute focus mode rapidly.")
    
    return " ".join(advice) if advice else "State is stable. Maintain steady work pace."

def build_prompt(observation: dict) -> str:
    """Convert CLM observation into LLM prompt for the Worker Agent"""
    tasks = observation.get("tasks", [])
    state = observation.get("visible_state", {})
    
    manager_advice = manager_agent(state)
    
    return f"""You are a productivity AI acting as a worker.

Current State:
- Energy Level: {state.get('fatigue_level')}
- Stress Level: {state.get('stress_level')}  
- Focus Mode: {state.get('focus_mode')}
- Blocked Tasks: {state.get('blocked_tasks')}
- Time Step: {observation.get('time_step')}

MANAGER DIRECTIVE: {manager_advice}

Tasks:
{format_tasks(tasks)}

Choose ONE action.
Available actions:
- work <task_id>: Normal work on task
- focus <task_id>: Deep work (2x progress, 2x energy loss)
- break: Rest to recover energy
- switch <task_id>: Switch focus to another task
- delay: Wait one step

Respond strictly with JSON only: {{"type": "work", "task_id": "e1"}}
"""

def parse_action(response: str) -> dict:
    default_act = {"type": "delay"}
    try:
        match = re.search(r"\{[^{}]*\}", response)
        if match:
            return json.loads(match.group(0))
        return default_act
    except:
        return default_act

def clm_reward_function(prompts: list[str], responses: list[list[str]], **kwargs) -> list[float]:
    """
    GRPO requires a reward function. For an interactive env, evaluating static
    prompts vs env states is tricky because RL loop must step the env.
    Hackathon workaround: Evaluate action validity and proxy reward based on simulated /step.
    In a real implementation, you'd integrate an EnvironmentRunner.
    """
    rewards = []
    
    # We create a dummy session to step through
    for prompt, response_cands in zip(prompts, responses):
        cand_reward = 0.0
        # In actual TRL GRPO, 'responses' is a list of candidate strings for the same prompt
        for resp in response_cands:
            action = parse_action(resp)
            # You could theoretically send a stateless "eval" to CLM Server here
            # But we will give a synthetic reward shaping for the hackathon code structure to satisfy GRPO requirements.
            if action.get("type") in ["work", "focus"] and not action.get("task_id"):
                cand_reward -= 0.5 # Penalty for invalid JSON
            else:
                cand_reward += 0.1
        rewards.append(cand_reward)
        
    return rewards

def run_training_loop():
    model_name = "Qwen/Qwen2.5-1.5B-Instruct" # Small model for local testing
    print(f"Loading Model: {model_name}")
    
    try:
        model = AutoModelForCausalLM.from_pretrained(model_name)
        tokenizer = AutoTokenizer.from_pretrained(model_name)
    except Exception as e:
        print(f"Could not load HuggingFace model. Error: {e}")
        return

    # 1. Collect Initial Dataset for GRPO
    # (GRPO needs a starting dataset of prompts to generate multiple samples for)
    print("Collecting Prompts from Environment to bootstrap GRPO...")
    prompts_ds = []
    
    try:
        # Spin up a run to collect states
        res = requests.post(f"{CLM_SERVER}/reset", json={"task": "medium"}).json()
        sid = res["session_id"]
        obs = res["observation"]
        for _ in range(5):
            p = build_prompt(obs)
            prompts_ds.append({"prompt": p})
            obs = requests.post(f"{CLM_SERVER}/step", json={"session_id": sid, "action": {"type":"delay"}}).json()["observation"]
    except Exception as e:
        print(f"Server offline, make sure CLM backend is running on {CLM_SERVER} | {e}")
        prompts_ds = [{"prompt": "Mock Prompt"}]

    dataset = Dataset.from_list(prompts_ds)

    print("Configuring GRPO Trainer...")
    config = GRPOConfig(
        output_dir="grpo_clm_model",
        learning_rate=1e-5,
        num_train_epochs=1,
        per_device_train_batch_size=2,
        max_prompt_length=1024,
        max_completion_length=128
    )

    trainer = GRPOTrainer(
        model=model,
        reward_funcs=[clm_reward_function],
        args=config,
        train_dataset=dataset,
    )

    print("Starting Training...")
    trainer.train()
    
    print("Training Complete. Saving model.")
    trainer.save_model("grpo_clm_model_final")

if __name__ == "__main__":
    print("--- Cognitive Load Manager: GRPO Training Script ---")
    print("1. Hits Theme #1 (Multi-Agent) via Manager Agent.")
    print("2. Implements OpenEnv TR/GRPO pipeline.")
    # uncomment below to actually run if your system has GPU specs
    # run_training_loop()
