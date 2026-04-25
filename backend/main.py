"""
backend/main.py — FastAPI server for the Cognitive Load Manager (OpenEnv).

Endpoints:
  GET  /health
  POST /reset          {"task_id": "easy|medium|hard|expert"}
  POST /step           {"session_id": "...", "action": {...}}
  GET  /state          ?session_id=...
  GET  /grader
  GET  /grade/easy|medium|hard|expert
  GET  /stream/run     ?difficulty=medium  → SSE real-time episode stream
  GET  /benchmark                          → run heuristic on all 4 levels
  GET  /training-log                       → reward_curve.json contents
"""
import asyncio
import json
import os
import sys
import uuid
from typing import Dict, Optional, List

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from models import (
    Action as ModelAction,
    generate_tasks,
    deterministic_grader,
    CLMEnvironment,
    PRIORITY_WEIGHT,
)

_SCORE_MIN = 0.01
_SCORE_MAX = 0.99


def _safe(raw: float) -> float:
    try:
        return round(max(_SCORE_MIN, min(_SCORE_MAX, float(raw))), 4)
    except Exception:
        return _SCORE_MIN


# ── Session store ──────────────────────────────────────────────────────────────
_sessions: Dict[str, CLMEnvironment] = {}


def _get_session(session_id: str) -> CLMEnvironment:
    env = _sessions.get(session_id)
    if env is None:
        raise HTTPException(status_code=404, detail=f"Session '{session_id}' not found.")
    return env


def _avg_energy(env: CLMEnvironment) -> float:
    workers = env.state.workers
    return sum(w.energy for w in workers) / len(workers) if workers else 0.5


# ── Heuristic agent (used for /stream/run and /benchmark) ─────────────────────
def _heuristic_action(env: CLMEnvironment) -> ModelAction:
    """
    Competent heuristic: breaks when exhausted, prioritises by weight then
    earliest deadline, uses focus mode for critical near-deadline tasks.
    Uses workers[0] for energy/stress (correcting the grader's attribute bug).
    """
    state = env.state
    blocked = env._blocked_ids()
    w0 = state.workers[0] if state.workers else None

    if w0 and (w0.energy < 0.28 or w0.stress > 0.72):
        return ModelAction(type="break", task_id=None, worker_id="w1")

    pending = [t for t in state.tasks if t.progress < 1.0 and t.id not in blocked]
    if not pending:
        return ModelAction(type="delay", task_id=None, worker_id="w1")

    pending.sort(key=lambda t: (
        -PRIORITY_WEIGHT[t.priority],
        t.deadline if t.deadline is not None else 9999,
    ))
    target = pending[0]

    use_focus = (
        target.priority == "critical"
        and target.deadline is not None
        and (target.deadline - state.time_step) <= 10
        and w0 is not None
        and w0.energy > 0.52
    )
    return ModelAction(
        type="focus" if use_focus else "work",
        task_id=target.id,
        worker_id="w1",
    )


# ── Request / Response models ──────────────────────────────────────────────────
class ResetRequest(BaseModel):
    task_id: str = Field(default="medium")
    seed: Optional[int] = Field(default=None)

    def __init__(self, **data):
        if "task" in data and "task_id" not in data:
            data["task_id"] = data.pop("task")
        super().__init__(**data)


class ActionPayload(BaseModel):
    type: str
    task_id: Optional[str] = None
    worker_id: Optional[str] = None


class StepRequest(BaseModel):
    session_id: Optional[str] = None
    action: ActionPayload


# ── Grader helpers ─────────────────────────────────────────────────────────────
def _run_grader_episode(difficulty: str) -> dict:
    try:
        from grader.clm_graders import EasyGrader, MediumGrader, HardGrader, ExpertGrader
        cls = {"easy": EasyGrader, "medium": MediumGrader,
               "hard": HardGrader, "expert": ExpertGrader}.get(difficulty, EasyGrader)
        score, done, msg = cls().grade()
        score = _safe(score)
    except Exception as ex:
        score = _SCORE_MIN
        msg = f"Grader error: {ex}"
    return {"task_id": difficulty, "reward": score, "score": score,
            "done": False, "grader_message": msg}


# ── App factory ────────────────────────────────────────────────────────────────
def build_app() -> FastAPI:
    app = FastAPI(
        title="Cognitive Load Manager — OpenEnv API",
        version="2.0.0",
        description="Multi-agent RL environment for cognitive load scheduling.",
    )
    app.add_middleware(
        CORSMiddleware, allow_origins=["*"], allow_credentials=True,
        allow_methods=["*"], allow_headers=["*"],
    )

    # ── Health ─────────────────────────────────────────────────────────────────
    @app.get("/health", tags=["System"])
    async def health():
        return {"status": "healthy", "sessions": len(_sessions)}

    # ── Reset ──────────────────────────────────────────────────────────────────
    @app.post("/reset", tags=["Environment"])
    async def reset(req: ResetRequest):
        task_id = req.task_id if req.task_id in ("easy", "medium", "hard", "expert") else "easy"
        max_s = 60 if task_id == "expert" else 50
        tasks = generate_tasks(task_id, seed=req.seed)
        env = CLMEnvironment(tasks=tasks, max_steps=max_s, seed=req.seed)
        obs = env.reset()
        session_id = str(uuid.uuid4())
        _sessions[session_id] = env
        return {
            "session_id": session_id,
            "observation": {
                "tasks": [t.model_dump() for t in obs.tasks],
                "visible_state": obs.visible_state.model_dump(),
                "time_step": obs.time_step,
            },
            "done": False,
            "reward": 0.0,
        }

    # ── Step ───────────────────────────────────────────────────────────────────
    @app.post("/step", tags=["Environment"])
    async def step(req: StepRequest):
        if req.session_id:
            env = _get_session(req.session_id)
        elif _sessions:
            env = list(_sessions.values())[-1]
        else:
            raise HTTPException(status_code=400, detail="No active session. Call /reset first.")

        action = ModelAction(
            type=req.action.type,
            task_id=req.action.task_id,
            worker_id=req.action.worker_id or "w1",
        )
        obs, reward, done, info = env.step(action)

        if done:
            avg_e = _avg_energy(env)
            info["final_score"] = _safe(info.get(
                "final_score",
                deterministic_grader(env.state.tasks, env.state.time_step, avg_e),
            ))
            if req.session_id and req.session_id in _sessions:
                del _sessions[req.session_id]

        return {
            "session_id": req.session_id,
            "observation": {
                "tasks": [t.model_dump() for t in obs.tasks],
                "visible_state": obs.visible_state.model_dump(),
                "time_step": obs.time_step,
            },
            "reward": _safe(float(reward)),
            "done": done,
            "info": {k: v for k, v in info.items()
                     if k in ("final_score", "schema_drift", "time_step")},
        }

    # ── State ──────────────────────────────────────────────────────────────────
    @app.get("/state", tags=["Environment"])
    async def state(session_id: Optional[str] = None):
        if session_id:
            env = _get_session(session_id)
        elif _sessions:
            env = list(_sessions.values())[-1]
        else:
            raise HTTPException(status_code=400, detail="No active session.")
        return {"state": env.state_dict(), "session_id": session_id}

    # ── Graders ────────────────────────────────────────────────────────────────
    @app.get("/grader",       tags=["Grader"])
    async def grader():       return _run_grader_episode("easy")

    @app.get("/grade/easy",   tags=["Grader"])
    async def grade_easy():   return _run_grader_episode("easy")

    @app.get("/grade/medium", tags=["Grader"])
    async def grade_medium(): return _run_grader_episode("medium")

    @app.get("/grade/hard",   tags=["Grader"])
    async def grade_hard():   return _run_grader_episode("hard")

    @app.get("/grade/expert", tags=["Grader"])
    async def grade_expert(): return _run_grader_episode("expert")

    # ── SSE: real-time episode streaming ──────────────────────────────────────
    @app.get("/stream/run", tags=["Streaming"])
    async def stream_run(difficulty: str = "medium", delay_ms: int = 380):
        """
        Server-Sent Events stream that plays a full heuristic episode.
        Each SSE message is a JSON object with type 'reset' | 'step' | 'done' | 'error'.
        """
        diff = difficulty if difficulty in ("easy", "medium", "hard", "expert") else "medium"
        sleep_s = max(0.1, min(2.0, delay_ms / 1000))

        async def event_gen():
            try:
                max_s = 60 if diff == "expert" else 50
                tasks = generate_tasks(diff)
                env = CLMEnvironment(tasks=tasks, max_steps=max_s)
                obs = env.reset()
                w0 = env.state.workers[0] if env.state.workers else None

                init = {
                    "type": "reset",
                    "difficulty": diff,
                    "step": 0,
                    "tasks": [t.model_dump() for t in obs.tasks],
                    "visible_state": obs.visible_state.model_dump(),
                    "energy": round(w0.energy if w0 else 1.0, 3),
                    "stress": round(w0.stress if w0 else 0.0, 3),
                }
                yield f"data: {json.dumps(init)}\n\n"

                done = False
                total_reward = 0.0

                while not done:
                    action = _heuristic_action(env)
                    obs, reward, done, info = env.step(action)
                    total_reward = round(total_reward + float(reward), 4)
                    w0 = env.state.workers[0] if env.state.workers else None
                    completed = sum(1 for t in obs.tasks if t.progress >= 1.0)

                    event: dict = {
                        "type": "step",
                        "step": obs.time_step,
                        "action": {"type": action.type, "task_id": action.task_id},
                        "reward": round(float(reward), 4),
                        "total_reward": total_reward,
                        "done": done,
                        "energy": round(w0.energy if w0 else 0.5, 3),
                        "stress": round(w0.stress if w0 else 0.0, 3),
                        "tasks_done": completed,
                        "tasks_total": len(obs.tasks),
                        "tasks": [t.model_dump() for t in obs.tasks],
                        "visible_state": obs.visible_state.model_dump(),
                    }
                    drift = info.get("schema_drift")
                    if drift:
                        event["schema_drift"] = drift
                    if done:
                        event["final_score"] = _safe(info.get("final_score", 0.01))
                        event["final_energy"] = round(w0.energy if w0 else 0.5, 3)

                    yield f"data: {json.dumps(event)}\n\n"

                    if not done:
                        await asyncio.sleep(sleep_s)

            except Exception as exc:
                yield f"data: {json.dumps({'type': 'error', 'message': str(exc)})}\n\n"

        return StreamingResponse(
            event_gen(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "X-Accel-Buffering": "no",   # disable nginx buffering on HF Spaces
                "Connection": "keep-alive",
            },
        )

    # ── Benchmark: run heuristic on all 4 difficulties ────────────────────────
    @app.get("/benchmark", tags=["Benchmark"])
    def benchmark():
        """
        Runs the heuristic agent on all 4 difficulty levels (seed=42 for
        reproducibility) and returns comprehensive per-difficulty stats.
        """
        results = {}
        baseline = {"easy": 0.856, "medium": 0.523, "hard": 0.301, "expert": 0.221}

        for diff in ("easy", "medium", "hard", "expert"):
            try:
                tasks = generate_tasks(diff, seed=42)
                max_s = 60 if diff == "expert" else 50
                env = CLMEnvironment(tasks=tasks, max_steps=max_s, seed=42)
                env.reset()
                done, step = False, 0
                total_reward = 0.0
                step_rewards: List[float] = []
                energy_trace: List[float] = []
                stress_trace: List[float] = []

                while not done and step < max_s:
                    action = _heuristic_action(env)
                    obs, reward, done, info = env.step(action)
                    total_reward += float(reward)
                    step_rewards.append(round(float(reward), 4))
                    w0 = env.state.workers[0] if env.state.workers else None
                    energy_trace.append(round(w0.energy if w0 else 0.5, 3))
                    stress_trace.append(round(w0.stress if w0 else 0.0, 3))
                    step += 1

                avg_e = _avg_energy(env)
                final_score = _safe(info.get(
                    "final_score",
                    deterministic_grader(env.state.tasks, env.state.time_step, avg_e),
                ))
                tasks_done = sum(1 for t in env.state.tasks if t.progress >= 1.0)
                dl_tasks = [t for t in env.state.tasks if t.deadline is not None]
                met_dl = sum(
                    1 for t in dl_tasks
                    if t.progress >= 1.0 and env.state.time_step <= t.deadline
                )
                # Scoring component breakdown (from deterministic_grader formula)
                total_w = sum(PRIORITY_WEIGHT[t.priority] for t in env.state.tasks)
                wc = sum(t.progress * PRIORITY_WEIGHT[t.priority]
                         for t in env.state.tasks) / max(total_w, 0.01)
                da = (met_dl / len(dl_tasks)) if dl_tasks else 1.0
                ee = max(0.0, (avg_e - 0.10) * 0.13)
                dep_b = min(0.05, sum(
                    0.015 for t in env.state.tasks
                    if t.depends_on and t.progress >= 1.0
                    and any(p.id == t.depends_on and p.progress >= 1.0
                            for p in env.state.tasks)
                ))
                int_t = [t for t in env.state.tasks if t.is_interrupted]
                int_b = min(0.03, (sum(1 for t in int_t if t.progress >= 1.0) /
                                   len(int_t) * 0.03) if int_t else 0.0)

                results[diff] = {
                    "score": final_score,
                    "baseline": baseline[diff],
                    "total_reward": round(total_reward, 4),
                    "steps": step,
                    "tasks_done": tasks_done,
                    "tasks_total": len(env.state.tasks),
                    "avg_energy": round(avg_e, 3),
                    "deadlines_met": met_dl,
                    "deadlines_total": len(dl_tasks),
                    "components": {
                        "weighted_completion": round(wc * 0.60, 4),
                        "deadline_adherence":  round(da * 0.22, 4),
                        "energy_efficiency":   round(ee, 4),
                        "dependency_bonus":    round(dep_b, 4),
                        "interruption_bonus":  round(int_b, 4),
                    },
                    "step_rewards": step_rewards,
                    "energy_trace": energy_trace,
                    "stress_trace": stress_trace,
                }
            except Exception as exc:
                results[diff] = {"error": str(exc), "score": 0.01, "baseline": baseline[diff]}

        return results

    # ── Training log ───────────────────────────────────────────────────────────
    _ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    _REWARD_CURVE = os.path.join(_ROOT, "reward_curve.json")

    @app.get("/training-log", tags=["Training"])
    async def training_log():
        if os.path.exists(_REWARD_CURVE):
            with open(_REWARD_CURVE) as f:
                return json.load(f)
        return []

    # ── React SPA static serving ───────────────────────────────────────────────
    _DIST   = os.path.join(_ROOT, "frontend", "dist")
    _ASSETS = os.path.join(_DIST, "assets")

    if os.path.isdir(_ASSETS):
        app.mount("/assets", StaticFiles(directory=_ASSETS), name="assets")

    if os.path.isdir(_DIST):
        _INDEX = os.path.join(_DIST, "index.html")

        @app.get("/", include_in_schema=False)
        async def spa_root():
            return FileResponse(_INDEX)

        # Catch-all: any unknown path returns the SPA so React Router works
        @app.get("/{full_path:path}", include_in_schema=False)
        async def spa_catchall(full_path: str):
            return FileResponse(_INDEX)
    else:
        @app.get("/", tags=["System"])
        async def api_root():
            return {
                "status": "ok",
                "service": "CLM OpenEnv API",
                "docs": "/docs",
                "health": "/health",
                "stream": "/stream/run?difficulty=medium",
                "benchmark": "/benchmark",
            }

    return app


app = build_app()
