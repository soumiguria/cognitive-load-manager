import os, sys
from typing import Dict, Any, Optional, List

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from models import (
    Action as ModelAction, Observation as ModelObservation,
    generate_tasks, deterministic_grader, CLMEnvironment,
)
from openenv.core.env_server.interfaces import Environment
from openenv.core.env_server.types import (
    Action as OEAction, Observation as OEObservation, State as OEState, EnvironmentMetadata,
)
from openenv.core.env_server.http_server import HTTPEnvServer

_SCORE_MIN = 0.01
_SCORE_MAX = 0.99

def _safe(raw: float) -> float:
    try:
        return round(max(_SCORE_MIN, min(_SCORE_MAX, float(raw))), 4)
    except Exception:
        return _SCORE_MIN

def _grade_task(difficulty: str) -> dict:
    """Run heuristic episode and score the final state."""
    try:
        from grader.clm_graders import EasyGrader, MediumGrader, HardGrader, ExpertGrader
        cls = {"easy": EasyGrader, "medium": MediumGrader,
               "hard": HardGrader, "expert": ExpertGrader}.get(difficulty, EasyGrader)
        score, done, msg = cls().grade()
        score = _safe(score)
    except Exception as ex:
        score = _SCORE_MIN
        msg   = f"Grader error: {ex}"
    return {"task_id": difficulty, "reward": score, "score": score,
            "done": False, "grader_message": msg}


class CLMAction(OEAction):
    type: str = Field(description="work | break | switch | delay | focus")
    task_id: Optional[str] = Field(default=None)
    model_config = {"extra": "allow"}

class CLMObservation(OEObservation):
    tasks:         List[Dict[str, Any]] = Field(default_factory=list)
    visible_state: Dict[str, Any]       = Field(default_factory=dict)
    time_step:     int                  = Field(default=0)
    model_config = {"extra": "allow"}

class CLMState(OEState):
    energy:          float                = Field(default=1.0)
    stress:          float                = Field(default=0.0)
    fatigue:         float                = Field(default=0.0)
    focus_mode:      bool                 = Field(default=False)
    current_task_id: Optional[str]        = Field(default=None)
    tasks:           List[Dict[str, Any]] = Field(default_factory=list)
    model_config = {"extra": "allow"}


class CLMEnvWrapper(Environment):
    SUPPORTS_CONCURRENT_SESSIONS = True

    def __init__(self):
        super().__init__()
        self._env = CLMEnvironment(tasks=generate_tasks("easy"), max_steps=50)
        self._final_score: float = _SCORE_MIN

    def _to_oe_obs(self, obs: ModelObservation, done=False,
                   reward=None, info=None) -> CLMObservation:
        return CLMObservation(
            tasks=[t.model_dump() for t in obs.tasks],
            visible_state=obs.visible_state.model_dump(),
            time_step=obs.time_step, done=done, reward=reward, metadata=info or {},
        )

    def reset(self, seed=None, episode_id=None, task_id: str = "easy", **kw) -> CLMObservation:
        if task_id not in ("easy", "medium", "hard", "expert"):
            task_id = "easy"
        max_s = 60 if task_id == "expert" else 50
        self._env = CLMEnvironment(tasks=generate_tasks(task_id), max_steps=max_s)
        self._final_score = _SCORE_MIN
        return self._to_oe_obs(self._env.reset())

    def step(self, action: CLMAction, timeout_s=None, **kw) -> CLMObservation:
        ma = ModelAction(type=action.type, task_id=action.task_id)
        obs, reward, done, info = self._env.step(ma)
        if done:
            self._final_score = _safe(info.get("final_score",
                deterministic_grader(self._env.state.tasks,
                                     self._env.state.time_step, self._env.state.energy)))
            info["final_score"] = self._final_score
        return self._to_oe_obs(obs, done=done, reward=_safe(float(reward)), info=info)

    @property
    def state(self):
        raw = self._env.state_dict()
        return CLMState(
            energy=raw.get("energy", 1.0), stress=raw.get("stress", 0.0),
            fatigue=raw.get("fatigue", 0.0), focus_mode=raw.get("focus_mode", False),
            current_task_id=raw.get("current_task_id"),
            tasks=raw.get("tasks", []), step_count=raw.get("time_step", 0),
        )

    def get_metadata(self):
        return EnvironmentMetadata(
            name="cognitive-load-manager",
            description="CLM v2.0 — real-world productivity scheduling with task types, dependencies, interruptions, and focus mode",
            version="2.0.0", author="CLM Team",
        )

    def close(self): pass


def build_app() -> FastAPI:
    server = HTTPEnvServer(
        env=CLMEnvWrapper, action_cls=CLMAction, observation_cls=CLMObservation, max_concurrent_envs=10,
    )
    app = FastAPI(
        title="Cognitive Load Manager v2.0 — OpenEnv API",
        version="2.0.0",
        description=(
            "OpenEnv-compliant productivity simulation. "
            "Agent manages energy/stress/fatigue across heterogeneous task types "
            "with priorities, deadlines, dependencies, interruptions, and focus mode."
        ),
    )
    app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True,
                       allow_methods=["*"], allow_headers=["*"])
    server.register_routes(app)

    @app.get("/grader",        tags=["Grader"]) 
    async def get_grader():   return _grade_task("easy")

    @app.get("/grade/easy",    tags=["Grader"])
    async def grade_easy():   return _grade_task("easy")

    @app.get("/grade/medium",  tags=["Grader"])
    async def grade_medium(): return _grade_task("medium")

    @app.get("/grade/hard",    tags=["Grader"])
    async def grade_hard():   return _grade_task("hard")

    @app.get("/grade/expert",  tags=["Grader"])
    async def grade_expert(): return _grade_task("expert")

    return app


app = build_app()
