import os
import sys
import math
from typing import Any, Dict, List, Optional

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi import FastAPI, Body
from fastapi.middleware.cors import CORSMiddleware

from models import (
    Action as ModelAction,
    generate_tasks,
    deterministic_grader,
    CLMEnvironment,
)

_SCORE_MIN = 0.01
_SCORE_MAX = 0.99

def _safe_score(raw) -> float:
    if raw is None or (isinstance(raw, float) and math.isnan(raw)):
        return _SCORE_MIN
    r = float(raw)
    return round(max(_SCORE_MIN, min(_SCORE_MAX, r)), 4)

_session: Dict[str, Any] = {
    "env": None, "task_id": "easy",
    "done": False, "final_score": _SCORE_MIN, "step_count": 0,
}

def _run_grader_for_task(task_id: str) -> float:
    if task_id not in ("easy", "medium", "hard"):
        task_id = "easy"
    tasks = generate_tasks(task_id)
    env = CLMEnvironment(tasks=tasks, max_steps=50)
    env.reset()
    for _ in range(50):
        state = env.state
        incomplete = [t for t in state.tasks if t.progress < 1.0]
        if not incomplete:
            break
        if state.energy < 0.3 or state.stress > 0.7:
            action = ModelAction(type="break")
        else:
            action = ModelAction(type="work", task_id=incomplete[0].id)
        _, _, done, _ = env.step(action)
        if done:
            break
    score = deterministic_grader(env.state.tasks, env.state.time_step, env.state.energy)
    return _safe_score(score)

def build_app() -> FastAPI:
    _app = FastAPI(
        title="Cognitive Load Manager (CLM) Environment API",
        version="1.0.0",
        description="OpenEnv-compliant environment for the Meta PyTorch Hackathon.",
    )
    _app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True,
                        allow_methods=["*"], allow_headers=["*"])

    @_app.get("/")
    @_app.get("/health")
    @_app.get("/healthz")
    async def health():
        return {"status": "healthy", "name": "cognitive-load-manager", "version": "1.0.0"}

    @_app.get("/metadata")
    async def metadata():
        return {
            "name": "cognitive-load-manager",
            "description": "Cognitive Load Manager simulates human cognitive load while managing tasks with deadlines.",
            "version": "1.0.0", "author": "Team Innovators",
        }

    @_app.get("/schema")
    async def schema():
        return {
            "action": {"type": "object", "properties": {
                "type": {"type": "string", "enum": ["work", "break", "switch", "delay"]},
                "task_id": {"type": "string", "nullable": True},
            }},
            "observation": {"type": "object", "properties": {
                "tasks": {"type": "array"},
                "visible_state": {"type": "object"},
                "time_step": {"type": "integer"},
            }},
            "state": {"type": "object", "properties": {
                "energy": {"type": "number"}, "stress": {"type": "number"},
                "fatigue": {"type": "number"}, "time_step": {"type": "integer"},
            }},
        }

    @_app.post("/reset")
    async def reset(body: dict = Body(default={})):
        task_id = body.get("task_id", "easy")
        if task_id not in ("easy", "medium", "hard"):
            task_id = "easy"
        tasks = generate_tasks(task_id)
        env = CLMEnvironment(tasks=tasks, max_steps=50)
        obs = env.reset()
        _session.update({"env": env, "task_id": task_id, "done": False,
                         "final_score": _SCORE_MIN, "step_count": 0})
        return {
            "observation": {"tasks": [t.model_dump() for t in obs.tasks],
                            "visible_state": obs.visible_state.model_dump(),
                            "time_step": obs.time_step},
            "reward": None, "done": False, "info": {},
        }

    @_app.post("/step")
    async def step(body: dict = Body(default={})):
        env = _session.get("env")
        if env is None:
            tasks = generate_tasks("easy")
            env = CLMEnvironment(tasks=tasks, max_steps=50)
            env.reset()
            _session.update({"env": env, "task_id": "easy"})

        raw = body.get("action") or body
        if isinstance(raw, dict):
            action_type = raw.get("type", "delay")
            task_id_action = raw.get("task_id")
        else:
            action_type = "delay"
            task_id_action = None
        if action_type not in ("work", "break", "switch", "delay"):
            action_type = "delay"

        action = ModelAction(type=action_type, task_id=task_id_action)
        obs, raw_reward, done, info = env.step(action)
        _session["step_count"] = _session.get("step_count", 0) + 1

        if done:
            final_score = _safe_score(
                deterministic_grader(env.state.tasks, env.state.time_step, env.state.energy)
            )
            _session.update({"done": True, "final_score": final_score})
            info["final_score"] = final_score
            reward = final_score
        else:
            reward = _safe_score(raw_reward)

        return {
            "observation": {"tasks": [t.model_dump() for t in obs.tasks],
                            "visible_state": obs.visible_state.model_dump(),
                            "time_step": obs.time_step},
            "reward": reward, "score": reward, "done": done, "info": info,
        }

    @_app.get("/state")
    async def state():
        env = _session.get("env")
        if env is None:
            return {"energy": 1.0, "stress": 0.0, "fatigue": 0.0, "time_step": 0, "tasks": []}
        return env.state_dict()

    @_app.get("/grader")
    @_app.post("/grader")
    async def grader_endpoint(body: dict = Body(default={})):
        env = _session.get("env")
        if _session.get("done"):
            score = _session.get("final_score", _SCORE_MIN)
        elif env is not None:
            score = _safe_score(
                deterministic_grader(env.state.tasks, env.state.time_step, env.state.energy)
            )
        else:
            score = _run_grader_for_task(_session.get("task_id", "easy"))
        return {"task_id": _session.get("task_id", "easy"), "reward": score,
                "score": score, "done": _session.get("done", False),
                "step_count": _session.get("step_count", 0)}

    @_app.get("/grade/easy")
    @_app.get("/grade/t1_easy")
    async def grade_easy():
        score = _run_grader_for_task("easy")
        return {"task_id": "easy", "score": score, "reward": score}

    @_app.get("/grade/medium")
    @_app.get("/grade/t2_medium")
    async def grade_medium():
        score = _run_grader_for_task("medium")
        return {"task_id": "medium", "score": score, "reward": score}

    @_app.get("/grade/hard")
    @_app.get("/grade/t3_hard")
    async def grade_hard():
        score = _run_grader_for_task("hard")
        return {"task_id": "hard", "score": score, "reward": score}

    @_app.post("/mcp")
    async def mcp(body: dict = Body(default={})):
        return {"jsonrpc": "2.0", "id": body.get("id", 1), "result": {"status": "ok"}}

    return _app

app = build_app()
