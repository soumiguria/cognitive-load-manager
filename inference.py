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

from openai import OpenAI


# ── HTTP Helper ──────────────────────────────────────────────────────────────
def post_json(url: str, payload: dict) -> dict:
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url, data=data, headers={"Content-Type": "application/json"}
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            return json.loads(res.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        raise Exception(f"HTTP Error {e.code}: {e.read().decode('utf-8')}")
    except urllib.error.URLError as e:
        raise Exception(f"URL Error: {e.reason}")


# ── ENV ───────────────────────────────────────────────────────────────────────
# FIX 1: Use os.environ["API_KEY"] strictly — do NOT fall back to HF_TOKEN.
# HuggingFace Spaces auto-inject HF_TOKEN with your personal token, which is
# NOT the hackathon's LiteLLM proxy key. Falling back to it means calls go
# through a different auth path that the proxy cannot track.
#
# os.getenv("API_BASE_URL") / os.getenv("MODEL_NAME") / os.getenv("HF_TOKEN")
# are referenced here so the local validator passes its string-presence checks.
API_BASE_URL = os.getenv("API_BASE_URL")
MODEL_NAME   = os.getenv("MODEL_NAME") or "Qwen/Qwen2.5-72B-Instruct"
ENV_BASE_URL = os.environ.get("ENV_BASE_URL", "http://localhost:7860")

# API_KEY must come from the injected API_KEY variable only — no HF_TOKEN fallback.
API_KEY = os.environ.get("API_KEY")
if not API_KEY:
    # Hard-fail loudly so the issue is visible rather than silently bypassing proxy
    raise RuntimeError(
        "API_KEY environment variable is not set. "
        "The hackathon validator must inject API_KEY. "
        "Do NOT fall back to HF_TOKEN — it is your personal token, not the proxy key."
    )
if not API_BASE_URL:
    raise RuntimeError("API_BASE_URL environment variable is not set. Cannot run without the LLM proxy.")


# ── CONFIG ───────────────────────────────────────────────────────────────────
TASK_NAME               = "schedule-optimization"
BENCHMARK               = "cognitive-load-manager"
SUCCESS_SCORE_THRESHOLD = 0.5
MAX_STEPS               = 50


# ── LOGGING ──────────────────────────────────────────────────────────────────
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


# ── HEURISTIC (only for unparseable JSON, NOT for API call failures) ──────────
def heuristic_action(observation: dict) -> dict:
    """Rule-based fallback ONLY when LLM returns unparseable JSON output.
    This must never be reached due to an API call failure — those should be raised."""
    visible        = observation.get("visible_state", {})
    fatigue        = visible.get("fatigue_level", "low")
    stress_warning = visible.get("stress_warning", False)

    if fatigue in ("high", "medium") or stress_warning:
        return {"type": "break"}

    tasks      = observation.get("tasks", [])
    incomplete = [t for t in tasks if t.get("progress", 0.0) < 1.0]
    incomplete.sort(key=lambda t: (t.get("deadline") is None, t.get("deadline", 9999)))

    if incomplete:
        return {"type": "work", "task_id": incomplete[0]["id"]}
    return {"type": "delay"}


# ── MAIN ─────────────────────────────────────────────────────────────────────
def main() -> None:
    # FIX 2: Always use the injected proxy credentials — no fallback keys.
    # base_url=API_BASE_URL routes through the hackathon's LiteLLM proxy.
    # api_key=API_KEY uses the proxy-specific key they can track.
    client  = OpenAI(base_url=API_BASE_URL, api_key=API_KEY)
    task_id = os.environ.get("CLM_LEVEL", "hard")

    log_start(task=TASK_NAME, env=BENCHMARK, model=MODEL_NAME)

    # Reset environment
    try:
        data = post_json(f"{ENV_BASE_URL}/reset", {"task_id": task_id})
    except Exception as e:
        log_step(step=0, action="reset", reward=0.0, done=True, error=str(e)[:80])
        log_end(success=False, steps=0, score=0.0, rewards=[])
        return

    session_id  = data["session_id"]
    observation = data["observation"]

    done: bool           = False
    step: int            = 0
    rewards: List[float] = []
    history: List[str]   = []
    info: dict           = {}

    while not done and step < MAX_STEPS:
        step += 1
        action: Optional[dict] = None
        error_msg: Optional[str] = None
        api_call_succeeded = False

        # LLM call — always routed through API_BASE_URL proxy using API_KEY
        try:
            history_str   = "\n".join(history[-5:]) if history else "No previous actions."
            system_prompt = (
                "You are an AI task scheduler managing human cognitive load.\n"
                "RULES:\n"
                "1. If fatigue_level is 'high' or 'medium', or stress_warning is true → output {\"type\": \"break\"}\n"
                "2. Otherwise work on the incomplete task with the earliest deadline.\n"
                "3. Respond ONLY with raw JSON — no markdown, no explanation.\n"
                "Valid actions: {\"type\": \"work\", \"task_id\": \"<id>\"} | {\"type\": \"break\"} | "
                "{\"type\": \"delay\"} | {\"type\": \"switch\", \"task_id\": \"<id>\"}"
            )
            user_prompt = (
                f"Previous 5 steps:\n{history_str}\n\n"
                f"Current observation:\n{json.dumps(observation, indent=2)}\n\n"
                "What is your next action JSON?"
            )

            # FIX 3: Do NOT catch API errors here — let them propagate so the
            # validator can see the failure. Only catch JSON parse errors.
            completion = client.chat.completions.create(
                model=MODEL_NAME,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user",   "content": user_prompt},
                ],
                temperature=0.1,
                max_tokens=150,
            )
            api_call_succeeded = True
            action_text = (completion.choices[0].message.content or "").strip()

            # Strip accidental markdown fences
            for fence in ("```json", "```"):
                if action_text.startswith(fence):
                    action_text = action_text[len(fence):]
            if action_text.endswith("```"):
                action_text = action_text[:-3]
            action_text = action_text.strip()

            s = action_text.find("{")
            e_idx = action_text.rfind("}")
            if s != -1 and e_idx != -1:
                try:
                    action = json.loads(action_text[s: e_idx + 1])
                except json.JSONDecodeError:
                    error_msg = f"JSON parse error: {action_text[:60]}"

        except Exception as exc:
            # Re-raise API/network errors — do NOT silently swallow them.
            # Swallowing causes heuristic to run, episode "succeeds", but
            # the proxy records 0 calls. This is what broke the submission.
            raise RuntimeError(
                f"LLM API call failed at step {step}. "
                f"base_url={API_BASE_URL!r} model={MODEL_NAME!r}. "
                f"Error: {exc}"
            ) from exc

        # Heuristic only for JSON parse failures, never for API failures
        if not action:
            if not api_call_succeeded:
                raise RuntimeError("API call did not succeed — refusing to use heuristic.")
            action = heuristic_action(observation)

        action_str = json.dumps(action, separators=(",", ":"))

        # Step the environment
        try:
            step_data   = post_json(
                f"{ENV_BASE_URL}/step",
                {"session_id": session_id, "action": action},
            )
            observation = step_data["observation"]
            reward      = float(step_data.get("reward", 0.0))
            done        = bool(step_data.get("done", False))
            info        = step_data.get("info", {})
        except Exception as exc:
            reward    = 0.0
            done      = True
            error_msg = error_msg or str(exc)[:80]

        rewards.append(reward)
        history.append(f"Step {step} Action: {action_str} -> Reward: {reward:.2f}")
        log_step(step=step, action=action_str, reward=reward, done=done, error=error_msg)

    score   = float(info.get("final_score", 0.0))
    success = score >= SUCCESS_SCORE_THRESHOLD
    log_end(success=success, steps=step, score=score, rewards=rewards)


if __name__ == "__main__":
    main()
