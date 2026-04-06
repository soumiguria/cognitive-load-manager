import os
import requests
import json
from dotenv import load_dotenv

load_dotenv()

API_BASE_URL = os.getenv("API_BASE_URL", "http://localhost:8000")
HF_ROUTER_URL = os.getenv(
    "HF_ROUTER_URL", 
    "https://api-inference.huggingface.co/models/meta-llama/Meta-Llama-3-70B-Instruct"
)
HF_TOKEN = os.getenv("HF_TOKEN")

def call_hf_router(prompt: str) -> dict:
    if not HF_TOKEN:
        return None
        
    headers = {
        "Authorization": f"Bearer {HF_TOKEN}",
        "Content-Type": "application/json"
    }
    
    payload = {
        "inputs": prompt,
        "parameters": {
            "max_new_tokens": 150,
            "temperature": 0.1,
            "return_full_text": False
        }
    }
    
    try:
        response = requests.post(HF_ROUTER_URL, headers=headers, json=payload)
        if response.status_code == 200:
            result = response.json()
            if isinstance(result, list) and len(result) > 0:
                text = result[0].get("generated_text", "")
                
                # Extract JSON block
                start_idx = text.find("{")
                end_idx = text.rfind("}")
                if start_idx != -1 and end_idx != -1:
                    json_str = text[start_idx:end_idx+1]
                    return json.loads(json_str)
        return None
    except Exception as e:
        print(f"Error calling HF Router: {e}")
        return None

def run_level(level: str):
    print(f"\n{'='*40}")
    print(f"--- Running Level: {level.upper()} ---")
    print(f"{'='*40}")
    
    # 1. Reset Environment
    res = requests.post(f"{API_BASE_URL}/reset", json={"level": level})
    if res.status_code != 200:
        print(f"Failed to reset: {res.text}")
        return
        
    data = res.json()
    session_id = data["session_id"]
    observation = data["observation"]
    
    done = False
    step = 0
    total_reward = 0.0
    info = {}
    
    while not done:
        step += 1
        print(f"\nStep {step}")
        
        # 2. Call LLM for next action
        prompt = f"""<|begin_of_text|><|start_header_id|>system<|end_header_id|>
You are an AI agent managing tasks with deadlines under cognitive load.
Your goals: Complete all tasks efficiently, avoiding burnout and minimizing stress.
Respond ONLY with a valid JSON object representing your chosen action, with no extra text surrounding it.
<|eot_id|><|start_header_id|>user<|end_header_id|>
Current Observation:
{json.dumps(observation, indent=2)}

Available Actions:
- {{"type": "work", "task_id": "<id>"}} - work on a specific task
- {{"type": "break"}} - increases energy, decreases stress
- {{"type": "switch", "task_id": "<id>"}} - switch focus without working
- {{"type": "delay"}} - delays actions slightly reducing stress
<|eot_id|><|start_header_id|>assistant<|end_header_id|>"""

        action = call_hf_router(prompt)

        # Fallback heuristic logic if HF router fails or no token
        if not action:
            tasks = observation.get("tasks", [])
            incomp = [t for t in tasks if t.get("progress", 0.0) < 1.0]
            if observation.get("visible_state", {}).get("fatigue_level") == "high":
                action = {"type": "break"}
            elif incomp:
                action = {"type": "work", "task_id": incomp[0]["id"]}
            else:
                action = {"type": "delay"}
            
        print(f"Agent Action: {action}")
        
        # 3. Step Environment
        res = requests.post(f"{API_BASE_URL}/step", json={
            "session_id": session_id,
            "action": action
        })
        
        if res.status_code != 200:
            print(f"Failed to step: {res.text}")
            break
            
        step_data = res.json()
        observation = step_data["observation"]
        reward = step_data["reward"]
        done = step_data["done"]
        info = step_data["info"]
        
        total_reward += reward
        print(f"Reward: {reward:.2f}")

    print("\n--- Episode Finished ---")
    print(f"Total Reward: {total_reward:.2f}")
    if "final_score" in info:
        print(f"Final Score (Grader): {info['final_score']:.2f}")
        
    # Get final state
    state_res = requests.get(f"{API_BASE_URL}/state", params={"session_id": session_id})
    if state_res.status_code == 200:
        st = state_res.json()
        print(f"Final Energy: {st.get('energy', 0):.2f}, Final Stress: {st.get('stress', 0):.2f}")

if __name__ == "__main__":
    if not HF_TOKEN:
         print("Warning: HF_TOKEN not set. Using fallback heuristic agent.")
         
    for level in ["easy", "medium", "hard"]:
        run_level(level)
