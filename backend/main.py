"""
backend/main.py — Standalone FastAPI server for the Cognitive Load Manager.

Endpoints (matching openenv.yaml contract):
  GET  /health
  POST /reset      {"task_id": "easy|medium|hard|expert"}
  POST /step       {"session_id": "...", "action": {...}}
  GET  /state      ?session_id=...
  GET  /grader
  GET  /grade/easy|medium|hard|expert

No openenv-core dependency — works on Python 3.9+.
"""
import json
import os
import sys
import uuid
from typing import Dict, Any, Optional, List

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
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


# ==========================================
# SESSION STORE
# Each session_id maps to a live CLMEnvironment.
# ==========================================
_sessions: Dict[str, CLMEnvironment] = {}


def _get_session(session_id: str) -> CLMEnvironment:
    env = _sessions.get(session_id)
    if env is None:
        raise HTTPException(status_code=404, detail=f"Session '{session_id}' not found. Call /reset first.")
    return env


def _avg_energy(env: CLMEnvironment) -> float:
    workers = env.state.workers
    return sum(w.energy for w in workers) / len(workers) if workers else 0.5


# ==========================================
# REQUEST / RESPONSE MODELS
# ==========================================

class ResetRequest(BaseModel):
    task_id: str = Field(default="medium", description="easy | medium | hard | expert")
    seed: Optional[int] = Field(default=None)

    # Accept 'task' as an alias for 'task_id' (backwards compat with old training_loop)
    class Config:
        populate_by_name = True

    def __init__(self, **data):
        # Map legacy 'task' key → 'task_id'
        if "task" in data and "task_id" not in data:
            data["task_id"] = data.pop("task")
        super().__init__(**data)


class ActionPayload(BaseModel):
    type: str = Field(description="work | focus | break | switch | delay")
    task_id: Optional[str] = Field(default=None)
    worker_id: Optional[str] = Field(default=None)


class StepRequest(BaseModel):
    session_id: Optional[str] = Field(default=None)
    action: ActionPayload


# ==========================================
# GRADER HELPERS
# ==========================================

def _run_grader_episode(difficulty: str) -> dict:
    """Run a heuristic episode and grade the final state (for /grade/* endpoints)."""
    try:
        from grader.clm_graders import EasyGrader, MediumGrader, HardGrader, ExpertGrader
        cls = {"easy": EasyGrader, "medium": MediumGrader,
               "hard": HardGrader, "expert": ExpertGrader}.get(difficulty, EasyGrader)
        score, done, msg = cls().grade()
        score = _safe(score)
    except Exception as ex:
        score = _SCORE_MIN
        msg = f"Grader error: {ex}"
    return {"task_id": difficulty, "reward": score, "score": score, "done": False,
            "grader_message": msg}


# ==========================================
# APP FACTORY
# ==========================================

def build_app() -> FastAPI:
    app = FastAPI(
        title="Cognitive Load Manager v2.0 — OpenEnv API",
        version="2.0.0",
        description=(
            "OpenEnv-compliant productivity simulation. "
            "Agent manages energy/stress/fatigue across heterogeneous task types "
            "with priorities, deadlines, dependencies, interruptions, and focus mode."
        ),
    )
    app.add_middleware(
        CORSMiddleware, allow_origins=["*"], allow_credentials=True,
        allow_methods=["*"], allow_headers=["*"],
    )

    # ------------------------------------------------------------------
    # Health
    # ------------------------------------------------------------------
    @app.get("/health", tags=["System"])
    async def health():
        return {"status": "healthy", "sessions": len(_sessions)}

    # ------------------------------------------------------------------
    # Reset — start a new episode, return observation + session_id
    # ------------------------------------------------------------------
    @app.post("/reset", tags=["Environment"])
    async def reset(req: ResetRequest):
        task_id = req.task_id
        if task_id not in ("easy", "medium", "hard", "expert"):
            task_id = "easy"

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

    # ------------------------------------------------------------------
    # Step — advance the environment one timestep
    # ------------------------------------------------------------------
    @app.post("/step", tags=["Environment"])
    async def step(req: StepRequest):
        # Support both session_id-based and single-global-env modes
        if req.session_id:
            env = _get_session(req.session_id)
        elif _sessions:
            # Fallback: use the most recently created session
            env = list(_sessions.values())[-1]
        else:
            raise HTTPException(
                status_code=400,
                detail="No active session. Call /reset first.",
            )

        action = ModelAction(
            type=req.action.type,
            task_id=req.action.task_id,
            worker_id=req.action.worker_id or "w1",
        )
        obs, reward, done, info = env.step(action)

        if done:
            avg_energy = _avg_energy(env)
            final_score = _safe(info.get("final_score",
                deterministic_grader(env.state.tasks, env.state.time_step, avg_energy)))
            info["final_score"] = final_score
            # Clean up finished session
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

    # ------------------------------------------------------------------
    # State — inspect current env state without stepping
    # ------------------------------------------------------------------
    @app.get("/state", tags=["Environment"])
    async def state(session_id: Optional[str] = None):
        if session_id:
            env = _get_session(session_id)
        elif _sessions:
            env = list(_sessions.values())[-1]
        else:
            raise HTTPException(status_code=400, detail="No active session.")
        return {"state": env.state_dict(), "session_id": session_id}

    # ------------------------------------------------------------------
    # Grader endpoints
    # ------------------------------------------------------------------
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

    # ------------------------------------------------------------------
    # Training log — serves reward_curve.json if it exists
    # ------------------------------------------------------------------
    _ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    _REWARD_CURVE = os.path.join(_ROOT, "reward_curve.json")

    @app.get("/training-log", tags=["Training"])
    async def training_log():
        if os.path.exists(_REWARD_CURVE):
            with open(_REWARD_CURVE) as f:
                return json.load(f)
        return []

    # ------------------------------------------------------------------
    # React SPA — serve built frontend at / and /assets/*
    # Only active when frontend/dist is present (i.e. inside Docker)
    # ------------------------------------------------------------------
    _DIST = os.path.join(_ROOT, "frontend", "dist")
    _ASSETS = os.path.join(_DIST, "assets")

    if os.path.isdir(_ASSETS):
        app.mount("/assets", StaticFiles(directory=_ASSETS), name="assets")

    if os.path.isdir(_DIST):
        @app.get("/", include_in_schema=False)
        async def serve_spa():
            return FileResponse(os.path.join(_DIST, "index.html"))
    else:
        @app.get("/", tags=["System"])
        async def api_root():
            return {
                "status": "ok",
                "service": "Cognitive Load Manager — OpenEnv API",
                "docs": "/docs",
                "health": "/health",
            }

    return app


app = build_app()
