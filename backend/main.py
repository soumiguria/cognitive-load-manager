import os
import sys
from typing import Any, Dict, List, Optional

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import Field

from openenv.core.env_server.interfaces import Environment
from openenv.core.env_server.types import (
    Action as OEAction,
    Observation as OEObservation,
    State as OEState,
    EnvironmentMetadata,
)
from openenv.core.env_server.http_server import HTTPEnvServer

from models import (
    Action as ModelAction,
    Observation as ModelObservation,
    generate_tasks,
    deterministic_grader,
    CLMEnvironment,
)


# ── OpenEnv-compatible Action / Observation / State models ──────────────────

class CLMAction(OEAction):
    """Action for the Cognitive Load Manager environment."""
    type: str = Field(description="Action type: work, break, switch, or delay")
    task_id: Optional[str] = Field(default=None, description="Task ID to act on")

    model_config = {"extra": "allow"}


class CLMObservation(OEObservation):
    """Observation from the Cognitive Load Manager environment."""
    tasks: List[Dict[str, Any]] = Field(default_factory=list)
    visible_state: Dict[str, Any] = Field(default_factory=dict)
    time_step: int = Field(default=0)

    model_config = {"extra": "allow"}


class CLMState(OEState):
    """State for the Cognitive Load Manager environment."""
    energy: float = Field(default=1.0)
    stress: float = Field(default=0.0)
    fatigue: float = Field(default=0.0)
    current_task_id: Optional[str] = Field(default=None)
    tasks: List[Dict[str, Any]] = Field(default_factory=list)

    model_config = {"extra": "allow"}


# ── OpenEnv Environment wrapper ─────────────────────────────────────────────

class CLMEnvWrapper(Environment):
    """
    Cognitive Load Manager wrapped as an OpenEnv-compliant environment.

    Three difficulty levels via the task_id reset parameter:
      - easy:   2 tasks, no deadlines
      - medium: 5 tasks with deadlines
      - hard:   8 tasks with tight deadlines
    """

    SUPPORTS_CONCURRENT_SESSIONS = True

    def __init__(self):
        super().__init__()
        level = os.getenv("CLM_LEVEL", "easy")
        tasks = generate_tasks(level)
        self._env = CLMEnvironment(tasks=tasks, max_steps=50)
        self._final_score: float = 0.0

    def _to_oe_obs(self, obs: ModelObservation, done: bool = False, reward: Optional[float] = None, info: Optional[dict] = None) -> CLMObservation:
        return CLMObservation(
            tasks=[t.model_dump() for t in obs.tasks],
            visible_state=obs.visible_state.model_dump(),
            time_step=obs.time_step,
            done=done,
            reward=reward,
            metadata=info or {},
        )

    def reset(self, seed: Optional[int] = None, episode_id: Optional[str] = None, task_id: str = "easy", **kwargs) -> CLMObservation:
        if task_id not in ("easy", "medium", "hard"):
            task_id = "easy"
        tasks = generate_tasks(task_id)
        self._env = CLMEnvironment(tasks=tasks, max_steps=50)
        self._final_score = 0.0
        obs = self._env.reset()
        return self._to_oe_obs(obs)

    def step(self, action: CLMAction, timeout_s: Optional[float] = None, **kwargs) -> CLMObservation:
        model_action = ModelAction(type=action.type, task_id=action.task_id)
        obs, reward, done, info = self._env.step(model_action)
        if done:
            self._final_score = deterministic_grader(
                self._env.state.tasks,
                self._env.state.time_step,
                self._env.state.energy,
            )
            info["final_score"] = self._final_score
        return self._to_oe_obs(obs, done=done, reward=float(reward), info=info)

    @property
    def state(self) -> CLMState:
        raw = self._env.state_dict()
        return CLMState(
            energy=raw.get("energy", 1.0),
            stress=raw.get("stress", 0.0),
            fatigue=raw.get("fatigue", 0.0),
            current_task_id=raw.get("current_task_id"),
            tasks=raw.get("tasks", []),
            step_count=raw.get("time_step", 0),
        )

    def get_metadata(self) -> EnvironmentMetadata:
        return EnvironmentMetadata(
            name="cognitive-load-manager",
            description=(
                "Cognitive Load Manager (CLM) simulates human cognitive load "
                "(energy, stress, fatigue) while managing tasks with deadlines. "
                "Three difficulty levels: easy (2 tasks, no deadlines), "
                "medium (5 tasks with deadlines), hard (8 tasks with tight deadlines)."
            ),
            version="1.0.0",
            author="Team Innovators",
        )

    def close(self) -> None:
        pass


# ── Build FastAPI app via OpenEnv HTTPEnvServer ──────────────────────────────

def build_app() -> FastAPI:
    server = HTTPEnvServer(
        env=CLMEnvWrapper,
        action_cls=CLMAction,
        observation_cls=CLMObservation,
        max_concurrent_envs=10,
    )

    _app = FastAPI(
        title="Cognitive Load Manager (CLM) Environment API",
        version="1.0.0",
        description=(
            "OpenEnv-compliant environment for the Meta PyTorch Hackathon. "
            "Simulates cognitive load management with three difficulty levels."
        ),
    )

    _app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    server.register_routes(_app)
    return _app


app = build_app()
