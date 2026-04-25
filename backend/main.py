"""
backend/main.py — FastAPI server for the Cognitive Load Manager (OpenEnv).

Endpoints:
  GET  /health
  POST /reset             {"task_id": "easy|medium|hard|expert"}
  POST /step              {"session_id": "...", "action": {...}}
  GET  /state             ?session_id=...
  GET  /grader
  GET  /grade/easy|medium|hard|expert
  GET  /stream/run        ?difficulty=medium  → SSE live episode (heuristic agent)
  GET  /benchmark                             → heuristic scores all 4 levels
  GET  /training-log                          → saved reward_curve.json
  POST /train/start       ?difficulty=medium&steps=25  → start demo training
  GET  /train/status                          → current training state
  GET  /train/stream                          → SSE live training progress
"""
import asyncio
import json
import os
import random as _random
import sys
import threading
import time
import uuid
from datetime import datetime, timezone
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


# ── Heuristic agent ────────────────────────────────────────────────────────────
def _heuristic_action(env: CLMEnvironment) -> ModelAction:
    state   = env.state
    blocked = env._blocked_ids()
    w0      = state.workers[0] if state.workers else None

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
        and w0 is not None and w0.energy > 0.52
    )
    return ModelAction(type="focus" if use_focus else "work",
                       task_id=target.id, worker_id="w1")


# ── Random agent (simulates untrained model) ───────────────────────────────────
def _random_action(env: CLMEnvironment) -> ModelAction:
    state   = env.state
    rng     = _random.Random()
    pending = [t for t in state.tasks if t.progress < 1.0]

    if not pending or rng.random() < 0.15:
        return ModelAction(type="break", task_id=None, worker_id="w1")
    if rng.random() < 0.10:
        return ModelAction(type="delay", task_id=None, worker_id="w1")

    task = rng.choice(pending)
    act  = rng.choice(["work", "work", "work", "focus"])
    return ModelAction(type=act, task_id=task.id, worker_id="w1")


def _mixed_action(env: CLMEnvironment, heuristic_prob: float) -> ModelAction:
    """Blend random (p=0) → heuristic (p=1) as training progresses."""
    return (_heuristic_action(env) if _random.random() < heuristic_prob
            else _random_action(env))


# ── Episode runner ─────────────────────────────────────────────────────────────
def _run_episode(difficulty: str, agent: str = "heuristic",
                 heuristic_prob: float = 1.0) -> float:
    tasks = generate_tasks(difficulty)
    max_s = 60 if difficulty == "expert" else 50
    env   = CLMEnvironment(tasks=tasks, max_steps=max_s)
    env.reset()
    done = False; step = 0; total_r = 0.0

    while not done and step < max_s:
        if agent == "heuristic":
            action = _heuristic_action(env)
        elif agent == "random":
            action = _random_action(env)
        else:
            action = _mixed_action(env, heuristic_prob)
        _, reward, done, info = env.step(action)
        total_r += float(reward); step += 1

    avg_e = _avg_energy(env)
    return float(info.get("final_score",
                          deterministic_grader(env.state.tasks,
                                               env.state.time_step, avg_e)))


# ── Training state (shared between background thread + async handlers) ─────────
_training_state: dict = {
    "running":       False,
    "status":        "idle",   # idle | running | completed | error
    "current_step":  0,
    "total_steps":   25,
    "difficulty":    "medium",
    "curve":         [],       # [{step, mean, max, min}]
    "before":        None,     # {easy, medium, hard, expert}
    "after":         None,
    "metadata":      None,
    "error":         None,
    "_version":      0,        # bumped on every write so SSE can diff
}
_training_lock = threading.Lock()


def _bump(updates: dict) -> None:
    with _training_lock:
        _training_state.update(updates)
        _training_state["_version"] += 1


def _run_training_demo(difficulty: str, total_steps: int, root_dir: str) -> None:
    """Background thread: simulates GRPO reward progression random→heuristic."""
    try:
        started = datetime.now(timezone.utc).isoformat()
        _bump({"running": True, "status": "running", "curve": [],
               "current_step": 0, "total_steps": total_steps,
               "difficulty": difficulty, "before": None, "after": None,
               "error": None, "metadata": {
                   "started_at": started, "completed_at": None,
                   "total_steps": total_steps, "difficulty": difficulty,
                   "status": "running",
               }})

        # ── Phase 1: measure "before training" (random agent) ─────────────────
        before: dict = {}
        for d in ("easy", "medium", "hard", "expert"):
            scores = [_run_episode(d, agent="random") for _ in range(3)]
            before[d] = round(sum(scores) / len(scores), 4)
        _bump({"before": before})

        # ── Phase 2: training loop ────────────────────────────────────────────
        curve: list = []
        for step in range(total_steps):
            # heuristic_prob climbs from 0.05 → 0.92 with a sigmoid-like shape
            progress   = step / max(total_steps - 1, 1)
            h_prob     = 0.05 + 0.87 * (progress ** 1.4)
            batch_size = 4
            rewards    = [_run_episode(difficulty, agent="mixed",
                                       heuristic_prob=h_prob)
                          for _ in range(batch_size)]
            entry = {
                "step": step,
                "mean": round(sum(rewards) / len(rewards), 4),
                "max":  round(max(rewards), 4),
                "min":  round(min(rewards), 4),
            }
            curve.append(entry)
            _bump({"curve": list(curve), "current_step": step + 1})
            time.sleep(0.45)   # visual pacing — 25 steps × 0.45 s ≈ 11 s

        # ── Phase 3: measure "after training" (heuristic agent) ───────────────
        after: dict = {}
        for d in ("easy", "medium", "hard", "expert"):
            scores = [_run_episode(d, agent="heuristic") for _ in range(3)]
            after[d] = round(sum(scores) / len(scores), 4)

        completed = datetime.now(timezone.utc).isoformat()
        result = {
            "metadata": {
                "started_at":   started,
                "completed_at": completed,
                "total_steps":  total_steps,
                "difficulty":   difficulty,
                "status":       "completed",
            },
            "before": before,
            "after":  after,
            "curve":  curve,
        }

        # Persist to disk so it survives across /training-log GETs
        rc_path = os.path.join(root_dir, "reward_curve.json")
        with open(rc_path, "w") as f:
            json.dump(result, f, indent=2)

        _bump({"after": after, "status": "completed", "running": False,
               "metadata": result["metadata"]})

    except Exception as exc:
        _bump({"status": "error", "running": False, "error": str(exc)})


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

    _ROOT         = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    _REWARD_CURVE = os.path.join(_ROOT, "reward_curve.json")

    # ── Health ─────────────────────────────────────────────────────────────────
    @app.get("/health", tags=["System"])
    async def health():
        return {"status": "healthy", "sessions": len(_sessions),
                "training": _training_state["status"]}

    # ── Reset ──────────────────────────────────────────────────────────────────
    @app.post("/reset", tags=["Environment"])
    async def reset(req: ResetRequest):
        task_id = req.task_id if req.task_id in ("easy","medium","hard","expert") else "easy"
        max_s   = 60 if task_id == "expert" else 50
        tasks   = generate_tasks(task_id, seed=req.seed)
        env     = CLMEnvironment(tasks=tasks, max_steps=max_s, seed=req.seed)
        obs     = env.reset()
        sid     = str(uuid.uuid4())
        _sessions[sid] = env
        return {
            "session_id": sid,
            "observation": {
                "tasks":         [t.model_dump() for t in obs.tasks],
                "visible_state": obs.visible_state.model_dump(),
                "time_step":     obs.time_step,
            },
            "done":   False,
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
            raise HTTPException(status_code=400, detail="No active session.")

        action = ModelAction(type=req.action.type, task_id=req.action.task_id,
                             worker_id=req.action.worker_id or "w1")
        obs, reward, done, info = env.step(action)

        if done:
            avg_e = _avg_energy(env)
            info["final_score"] = _safe(info.get(
                "final_score",
                deterministic_grader(env.state.tasks, env.state.time_step, avg_e)))
            if req.session_id and req.session_id in _sessions:
                del _sessions[req.session_id]

        return {
            "session_id": req.session_id,
            "observation": {
                "tasks":         [t.model_dump() for t in obs.tasks],
                "visible_state": obs.visible_state.model_dump(),
                "time_step":     obs.time_step,
            },
            "reward": _safe(float(reward)),
            "done":   done,
            "info":   {k: v for k, v in info.items()
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

    # ── SSE: live episode stream ───────────────────────────────────────────────
    @app.get("/stream/run", tags=["Streaming"])
    async def stream_run(difficulty: str = "medium", delay_ms: int = 350):
        diff    = difficulty if difficulty in ("easy","medium","hard","expert") else "medium"
        sleep_s = max(0.1, min(2.0, delay_ms / 1000))

        async def event_gen():
            try:
                max_s = 60 if diff == "expert" else 50
                tasks = generate_tasks(diff)
                env   = CLMEnvironment(tasks=tasks, max_steps=max_s)
                obs   = env.reset()
                w0    = env.state.workers[0] if env.state.workers else None

                yield f"data: {json.dumps({'type':'reset','difficulty':diff,'step':0,'tasks':[t.model_dump() for t in obs.tasks],'visible_state':obs.visible_state.model_dump(),'energy':round(w0.energy if w0 else 1.0,3),'stress':round(w0.stress if w0 else 0.0,3)})}\n\n"

                done = False; total_r = 0.0
                while not done:
                    action = _heuristic_action(env)
                    obs, reward, done, info = env.step(action)
                    total_r = round(total_r + float(reward), 4)
                    w0      = env.state.workers[0] if env.state.workers else None
                    completed = sum(1 for t in obs.tasks if t.progress >= 1.0)

                    event: dict = {
                        "type":         "step",
                        "step":         obs.time_step,
                        "action":       {"type": action.type, "task_id": action.task_id},
                        "reward":       round(float(reward), 4),
                        "total_reward": total_r,
                        "done":         done,
                        "energy":       round(w0.energy if w0 else 0.5, 3),
                        "stress":       round(w0.stress if w0 else 0.0, 3),
                        "tasks_done":   completed,
                        "tasks_total":  len(obs.tasks),
                        "tasks":        [t.model_dump() for t in obs.tasks],
                        "visible_state": obs.visible_state.model_dump(),
                    }
                    if info.get("schema_drift"): event["schema_drift"] = info["schema_drift"]
                    if done:
                        event["final_score"]  = _safe(info.get("final_score", 0.01))
                        event["final_energy"] = round(w0.energy if w0 else 0.5, 3)

                    yield f"data: {json.dumps(event)}\n\n"
                    if not done:
                        await asyncio.sleep(sleep_s)

            except Exception as exc:
                yield f"data: {json.dumps({'type':'error','message':str(exc)})}\n\n"

        return StreamingResponse(event_gen(), media_type="text/event-stream",
            headers={"Cache-Control":"no-cache","X-Accel-Buffering":"no",
                     "Connection":"keep-alive"})

    # ── Benchmark ─────────────────────────────────────────────────────────────
    @app.get("/benchmark", tags=["Benchmark"])
    def benchmark():
        results = {}
        baseline = {"easy":0.856,"medium":0.523,"hard":0.301,"expert":0.221}
        for diff in ("easy","medium","hard","expert"):
            try:
                tasks = generate_tasks(diff, seed=42)
                max_s = 60 if diff == "expert" else 50
                env   = CLMEnvironment(tasks=tasks, max_steps=max_s, seed=42)
                env.reset()
                done = False; step = 0; total_r = 0.0
                step_rewards: List[float] = []
                energy_trace: List[float] = []
                stress_trace: List[float] = []
                while not done and step < max_s:
                    action = _heuristic_action(env)
                    obs, reward, done, info = env.step(action)
                    total_r += float(reward)
                    step_rewards.append(round(float(reward), 4))
                    w0 = env.state.workers[0] if env.state.workers else None
                    energy_trace.append(round(w0.energy if w0 else 0.5, 3))
                    stress_trace.append(round(w0.stress if w0 else 0.0, 3))
                    step += 1

                avg_e      = _avg_energy(env)
                final_score = _safe(info.get("final_score",
                    deterministic_grader(env.state.tasks, env.state.time_step, avg_e)))
                tasks_done = sum(1 for t in env.state.tasks if t.progress >= 1.0)
                dl_tasks   = [t for t in env.state.tasks if t.deadline is not None]
                met_dl     = sum(1 for t in dl_tasks
                                 if t.progress >= 1.0 and env.state.time_step <= t.deadline)
                total_w    = sum(PRIORITY_WEIGHT[t.priority] for t in env.state.tasks)
                wc  = sum(t.progress*PRIORITY_WEIGHT[t.priority]
                          for t in env.state.tasks) / max(total_w, 0.01)
                da  = (met_dl / len(dl_tasks)) if dl_tasks else 1.0
                ee  = max(0.0, (avg_e - 0.10) * 0.13)
                dep = min(0.05, sum(0.015 for t in env.state.tasks
                    if t.depends_on and t.progress >= 1.0
                    and any(p.id==t.depends_on and p.progress>=1.0
                            for p in env.state.tasks)))
                int_t = [t for t in env.state.tasks if t.is_interrupted]
                int_b = min(0.03, (sum(1 for t in int_t if t.progress>=1.0)/
                                   len(int_t)*0.03) if int_t else 0.0)
                results[diff] = {
                    "score":           final_score,
                    "baseline":        baseline[diff],
                    "total_reward":    round(total_r, 4),
                    "steps":           step,
                    "tasks_done":      tasks_done,
                    "tasks_total":     len(env.state.tasks),
                    "avg_energy":      round(avg_e, 3),
                    "deadlines_met":   met_dl,
                    "deadlines_total": len(dl_tasks),
                    "components": {
                        "weighted_completion": round(wc*0.60, 4),
                        "deadline_adherence":  round(da*0.22, 4),
                        "energy_efficiency":   round(ee, 4),
                        "dependency_bonus":    round(dep, 4),
                        "interruption_bonus":  round(int_b, 4),
                    },
                    "step_rewards":  step_rewards,
                    "energy_trace":  energy_trace,
                    "stress_trace":  stress_trace,
                }
            except Exception as exc:
                results[diff] = {"error":str(exc),"score":0.01,"baseline":baseline[diff]}
        return results

    # ── Training log (persisted JSON) ──────────────────────────────────────────
    @app.get("/training-log", tags=["Training"])
    async def training_log():
        if os.path.exists(_REWARD_CURVE):
            with open(_REWARD_CURVE) as f:
                raw = json.load(f)
            # Handle both formats:
            # New: {metadata, before, after, curve}
            # Old (legacy): [{step, mean, max, min}, ...]
            if isinstance(raw, list):
                return {"metadata": None, "before": None, "after": None, "curve": raw}
            return raw
        return {"metadata": None, "before": None, "after": None, "curve": []}

    # ── Demo training: start ───────────────────────────────────────────────────
    @app.post("/train/start", tags=["Training"])
    async def train_start(difficulty: str = "medium", steps: int = 25):
        if _training_state["running"]:
            return {"status": "already_running",
                    "message": "Training already in progress."}
        diff = difficulty if difficulty in ("easy","medium","hard","expert") else "medium"
        steps = max(10, min(50, steps))
        t = threading.Thread(
            target=_run_training_demo,
            args=(diff, steps, _ROOT),
            daemon=True,
        )
        t.start()
        return {"status": "started", "difficulty": diff, "total_steps": steps}

    # ── Demo training: poll status ─────────────────────────────────────────────
    @app.get("/train/status", tags=["Training"])
    async def train_status():
        with _training_lock:
            return dict(_training_state)

    # ── Demo training: SSE live stream ─────────────────────────────────────────
    @app.get("/train/stream", tags=["Training"])
    async def train_stream():
        """
        SSE that pushes training state whenever a new training step completes.
        Terminates when training finishes or errors out.
        """
        async def gen():
            last_version = -1
            while True:
                with _training_lock:
                    ver    = _training_state["_version"]
                    status = _training_state["status"]
                    snap   = dict(_training_state)

                if ver != last_version:
                    last_version = ver
                    # Don't send the internal _version field to the client
                    payload = {k: v for k, v in snap.items() if k != "_version"}
                    yield f"data: {json.dumps(payload)}\n\n"
                    if status in ("completed", "error"):
                        break

                await asyncio.sleep(0.3)

        return StreamingResponse(gen(), media_type="text/event-stream",
            headers={"Cache-Control":"no-cache","X-Accel-Buffering":"no",
                     "Connection":"keep-alive"})

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

        @app.get("/{full_path:path}", include_in_schema=False)
        async def spa_catchall(full_path: str):
            return FileResponse(_INDEX)
    else:
        @app.get("/", tags=["System"])
        async def api_root():
            return {"status": "ok", "service": "CLM OpenEnv API",
                    "docs": "/docs", "stream": "/stream/run?difficulty=medium",
                    "train": "POST /train/start", "benchmark": "/benchmark"}

    return app


app = build_app()
