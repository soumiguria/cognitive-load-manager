# import os
# import sys
# from typing import Any, Dict, List, Optional

# sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# from fastapi import FastAPI
# from fastapi.middleware.cors import CORSMiddleware
# from pydantic import Field

# from openenv.core.env_server.interfaces import Environment
# from openenv.core.env_server.types import (
#     Action as OEAction,
#     Observation as OEObservation,
#     State as OEState,
#     EnvironmentMetadata,
# )
# from openenv.core.env_server.http_server import HTTPEnvServer

# from models import (
#     Action as ModelAction,
#     Observation as ModelObservation,
#     generate_tasks,
#     deterministic_grader,
#     CLMEnvironment,
# )


# # ── OpenEnv-compatible Action / Observation / State models ──────────────────

# class CLMAction(OEAction):
#     """Action for the Cognitive Load Manager environment."""
#     type: str = Field(description="Action type: work, break, switch, or delay")
#     task_id: Optional[str] = Field(default=None, description="Task ID to act on")

#     model_config = {"extra": "allow"}


# class CLMObservation(OEObservation):
#     """Observation from the Cognitive Load Manager environment."""
#     tasks: List[Dict[str, Any]] = Field(default_factory=list)
#     visible_state: Dict[str, Any] = Field(default_factory=dict)
#     time_step: int = Field(default=0)

#     model_config = {"extra": "allow"}


# class CLMState(OEState):
#     """State for the Cognitive Load Manager environment."""
#     energy: float = Field(default=1.0)
#     stress: float = Field(default=0.0)
#     fatigue: float = Field(default=0.0)
#     current_task_id: Optional[str] = Field(default=None)
#     tasks: List[Dict[str, Any]] = Field(default_factory=list)

#     model_config = {"extra": "allow"}


# # ── OpenEnv Environment wrapper ─────────────────────────────────────────────

# class CLMEnvWrapper(Environment):
#     """
#     Cognitive Load Manager wrapped as an OpenEnv-compliant environment.

#     Three difficulty levels via the task_id reset parameter:
#       - easy:   2 tasks, no deadlines
#       - medium: 5 tasks with deadlines
#       - hard:   8 tasks with tight deadlines
#     """

#     SUPPORTS_CONCURRENT_SESSIONS = True

#     def __init__(self):
#         super().__init__()
#         level = os.getenv("CLM_LEVEL", "easy")
#         tasks = generate_tasks(level)
#         self._env = CLMEnvironment(tasks=tasks, max_steps=50)
#         self._final_score: float = 0.0

#     def _to_oe_obs(self, obs: ModelObservation, done: bool = False, reward: Optional[float] = None, info: Optional[dict] = None) -> CLMObservation:
#         return CLMObservation(
#             tasks=[t.model_dump() for t in obs.tasks],
#             visible_state=obs.visible_state.model_dump(),
#             time_step=obs.time_step,
#             done=done,
#             reward=reward,
#             metadata=info or {},
#         )

#     def reset(self, seed: Optional[int] = None, episode_id: Optional[str] = None, task_id: str = "easy", **kwargs) -> CLMObservation:
#         if task_id not in ("easy", "medium", "hard"):
#             task_id = "easy"
#         tasks = generate_tasks(task_id)
#         self._env = CLMEnvironment(tasks=tasks, max_steps=50)
#         self._final_score = 0.0
#         obs = self._env.reset()
#         return self._to_oe_obs(obs)

#     def step(self, action: CLMAction, timeout_s: Optional[float] = None, **kwargs) -> CLMObservation:
#         model_action = ModelAction(type=action.type, task_id=action.task_id)
#         obs, reward, done, info = self._env.step(model_action)
#         if done:
#             self._final_score = deterministic_grader(
#                 self._env.state.tasks,
#                 self._env.state.time_step,
#                 self._env.state.energy,
#             )
#             info["final_score"] = self._final_score
#         return self._to_oe_obs(obs, done=done, reward=float(reward), info=info)

#     @property
#     def state(self) -> CLMState:
#         raw = self._env.state_dict()
#         return CLMState(
#             energy=raw.get("energy", 1.0),
#             stress=raw.get("stress", 0.0),
#             fatigue=raw.get("fatigue", 0.0),
#             current_task_id=raw.get("current_task_id"),
#             tasks=raw.get("tasks", []),
#             step_count=raw.get("time_step", 0),
#         )

#     def get_metadata(self) -> EnvironmentMetadata:
#         return EnvironmentMetadata(
#             name="cognitive-load-manager",
#             description=(
#                 "Cognitive Load Manager (CLM) simulates human cognitive load "
#                 "(energy, stress, fatigue) while managing tasks with deadlines. "
#                 "Three difficulty levels: easy (2 tasks, no deadlines), "
#                 "medium (5 tasks with deadlines), hard (8 tasks with tight deadlines)."
#             ),
#             version="1.0.0",
#             author="Team Innovators",
#         )

#     def close(self) -> None:
#         pass


# # ── Build FastAPI app via OpenEnv HTTPEnvServer ──────────────────────────────

# def build_app() -> FastAPI:
#     server = HTTPEnvServer(
#         env=CLMEnvWrapper,
#         action_cls=CLMAction,
#         observation_cls=CLMObservation,
#         max_concurrent_envs=10,
#     )

#     _app = FastAPI(
#         title="Cognitive Load Manager (CLM) Environment API",
#         version="1.0.0",
#         description=(
#             "OpenEnv-compliant environment for the Meta PyTorch Hackathon. "
#             "Simulates cognitive load management with three difficulty levels."
#         ),
#     )

#     _app.add_middleware(
#         CORSMiddleware,
#         allow_origins=["*"],
#         allow_credentials=True,
#         allow_methods=["*"],
#         allow_headers=["*"],
#     )

#     server.register_routes(_app)
#     return _app


# app = build_app()



import uuid
import os
import sys
from typing import Dict, Any, Optional, List

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# Fix imports
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# ── Your core models ─────────────────────────────────────────────────────────
from models import (
    Action,
    Observation,
    generate_tasks,
    deterministic_grader,
    CLMEnvironment,
)

# ── OpenEnv imports ──────────────────────────────────────────────────────────
from openenv.core.env_server.interfaces import Environment
from openenv.core.env_server.types import (
    Action as OEAction,
    Observation as OEObservation,
    State as OEState,
    EnvironmentMetadata,
)
from openenv.core.env_server.http_server import HTTPEnvServer


# =============================================================================
# ── PART 1: SIMPLE FASTAPI API (Your Original API) ────────────────────────────
# =============================================================================

app = FastAPI(
    title="Cognitive Load Manager (CLM) Environment API",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory session store
sessions: Dict[str, CLMEnvironment] = {}


# ── Request / Response Models ────────────────────────────────────────────────

class ResetRequest(BaseModel):
    level: str = "easy"
    task_id: str = "easy"
    session_id: Optional[str] = None


class ResetResponse(BaseModel):
    session_id: str
    observation: Any


class StepRequest(BaseModel):
    session_id: str = "default"
    action: Optional[Action] = None


class StepResponse(BaseModel):
    observation: Any
    reward: float
    done: bool
    info: Dict[str, Any]


# ── Routes ──────────────────────────────────────────────────────────────────
# Add the home route with details of all the other routes
@app.get("/")
def read_root():
    return {"message": "Cognitive Load Manager is running 🚀"}
    routes = []
    for route in app.routes:
        route_info = {"path": route.path, "name": getattr(route, "name", "")}
        if hasattr(route, "methods"):
            route_info["methods"] = list(route.methods)
        routes.append(route_info)
    return {
        "message": "Cognitive Load Manager is running 🚀",
        "routes": routes
    }

@app.post("/reset", response_model=ResetResponse)
def reset_env(req: Optional[ResetRequest] = None):
    if req is None:
        req = ResetRequest()

    if req.level not in ["easy", "medium", "hard"]:
        raise HTTPException(status_code=400, detail="Invalid level")

    if req.task_id not in ["easy", "medium", "hard"]:
        raise HTTPException(status_code=400, detail="Invalid task_id")

    # FIX: choose ONE (task_id is better)
    tasks = generate_tasks(req.task_id)

    env = CLMEnvironment(tasks=tasks, max_steps=50)
    obs = env.reset()

    sess_id = req.session_id or str(uuid.uuid4())
    sessions[sess_id] = env

    return ResetResponse(session_id=sess_id, observation=obs)


@app.post("/step", response_model=StepResponse)
def step_env(req: Optional[StepRequest] = None):
    if req is None:
        req = StepRequest()

    if req.action is None:
        req.action = Action(type="work")

    if req.session_id not in sessions:
        tasks = generate_tasks("easy")
        env = CLMEnvironment(tasks=tasks, max_steps=50)
        env.reset()
        sessions[req.session_id] = env

    env = sessions[req.session_id]

    obs, reward, done, info = env.step(req.action)

    if done:
        score = deterministic_grader(
            env.state.tasks,
            env.state.time_step,
            env.state.energy
        )
        info["final_score"] = score

    return StepResponse(
        observation=obs,
        reward=reward,
        done=done,
        info=info
    )


@app.get("/state")
def get_state(session_id: Optional[str] = "default"):
    if session_id not in sessions:
        tasks = generate_tasks("easy")
        env = CLMEnvironment(tasks=tasks, max_steps=50)
        env.reset()
        sessions[session_id] = env

    return sessions[session_id].state_dict()


# =============================================================================
# ── PART 2: OPENENV COMPATIBLE WRAPPER ───────────────────────────────────────
# =============================================================================

class CLMAction(OEAction):
    type: str = Field(description="work, break, switch, delay")
    task_id: Optional[str] = None

    model_config = {"extra": "allow"}


class CLMObservation(OEObservation):
    tasks: List[Dict[str, Any]] = Field(default_factory=list)
    visible_state: Dict[str, Any] = Field(default_factory=dict)
    time_step: int = 0

    model_config = {"extra": "allow"}


class CLMState(OEState):
    energy: float = 1.0
    stress: float = 0.0
    fatigue: float = 0.0
    current_task_id: Optional[str] = None
    tasks: List[Dict[str, Any]] = Field(default_factory=list)

    model_config = {"extra": "allow"}


class CLMEnvWrapper(Environment):

    SUPPORTS_CONCURRENT_SESSIONS = True

    def __init__(self):
        super().__init__()
        tasks = generate_tasks("easy")
        self._env = CLMEnvironment(tasks=tasks, max_steps=50)
        self._final_score = 0.0

    def _to_obs(self, obs: Observation, done=False, reward=None, info=None):
        return CLMObservation(
            tasks=[t.model_dump() for t in obs.tasks],
            visible_state=obs.visible_state.model_dump(),
            time_step=obs.time_step,
            done=done,
            reward=reward,
            metadata=info or {},
        )

    def reset(self, task_id: str = "easy", **kwargs):
        if task_id not in ("easy", "medium", "hard"):
            task_id = "easy"

        tasks = generate_tasks(task_id)
        self._env = CLMEnvironment(tasks=tasks, max_steps=50)

        obs = self._env.reset()
        return self._to_obs(obs)

    def step(self, action: CLMAction, **kwargs):
        model_action = Action(type=action.type, task_id=action.task_id)

        obs, reward, done, info = self._env.step(model_action)

        if done:
            self._final_score = deterministic_grader(
                self._env.state.tasks,
                self._env.state.time_step,
                self._env.state.energy,
            )
            info["final_score"] = self._final_score

        return self._to_obs(obs, done=done, reward=float(reward), info=info)

    @property
    def state(self):
        raw = self._env.state_dict()
        return CLMState(
            energy=raw.get("energy", 1.0),
            stress=raw.get("stress", 0.0),
            fatigue=raw.get("fatigue", 0.0),
            current_task_id=raw.get("current_task_id"),
            tasks=raw.get("tasks", []),
            step_count=raw.get("time_step", 0),
        )

    def get_metadata(self):
        return EnvironmentMetadata(
            name="cognitive-load-manager",
            description="CLM environment with cognitive load simulation",
            version="1.0.0",
            author="Team Innovators",
        )

    def close(self):
        pass


# =============================================================================
# ── PART 3: REGISTER OPENENV ROUTES ──────────────────────────────────────────
# =============================================================================

server = HTTPEnvServer(
    env=CLMEnvWrapper,
    action_cls=CLMAction,
    observation_cls=CLMObservation,
    max_concurrent_envs=10,
)

server.register_routes(app)