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

from models import (
    Action as ModelAction,
    Observation as ModelObservation,
    generate_tasks,
    deterministic_grader,
    CLMEnvironment,
)

_SCORE_MIN = 0.01
_SCORE_MAX = 0.99


def _safe_score(raw: float) -> float:
    """Clamp to strictly open interval (0, 1). Never returns 0.0 or 1.0."""
    try:
        s = float(raw)
    except (TypeError, ValueError):
        return _SCORE_MIN
    return round(max(_SCORE_MIN, min(_SCORE_MAX, s)), 4)


def _grade_task(difficulty: str) -> dict:
    """Run heuristic agent to episode completion and score the final state."""
    try:
        from grader.clm_graders import EasyGrader, MediumGrader, HardGrader
        grader_map = {"easy": EasyGrader, "medium": MediumGrader, "hard": HardGrader}
        g = grader_map.get(difficulty, EasyGrader)()
        score, done, msg = g.grade()
        score = _safe_score(score)
    except Exception:
        score = _SCORE_MIN
        msg = f"Grader error for {difficulty}"
    return {
        "task_id": difficulty,
        "reward": score,
        "score": score,
        "done": False,
        "grader_message": msg,
    }


# ── OpenEnv-compatible Action / Observation / State models ──────────────────

class CLMAction(OEAction):
    type: str = Field(description="Action type: work, break, switch, or delay")
    task_id: Optional[str] = Field(default=None, description="Task ID to act on")
    model_config = {"extra": "allow"}


class CLMObservation(OEObservation):
    tasks: List[Dict[str, Any]] = Field(default_factory=list)
    visible_state: Dict[str, Any] = Field(default_factory=dict)
    time_step: int = Field(default=0)
    model_config = {"extra": "allow"}


class CLMState(OEState):
    energy: float = Field(default=1.0)
    stress: float = Field(default=0.0)
    fatigue: float = Field(default=0.0)
    current_task_id: Optional[str] = Field(default=None)
    tasks: List[Dict[str, Any]] = Field(default_factory=list)
    model_config = {"extra": "allow"}


class CLMEnvWrapper(Environment):
    SUPPORTS_CONCURRENT_SESSIONS = True

    def __init__(self):
        super().__init__()
        tasks = generate_tasks("easy")
        self._env = CLMEnvironment(tasks=tasks, max_steps=50)
        self._final_score: float = _SCORE_MIN

    def _to_oe_obs(self, obs: ModelObservation, done: bool = False,
                   reward: Optional[float] = None, info: Optional[dict] = None) -> CLMObservation:
        return CLMObservation(
            tasks=[t.model_dump() for t in obs.tasks],
            visible_state=obs.visible_state.model_dump(),
            time_step=obs.time_step,
            done=done,
            reward=reward,
            metadata=info or {},
        )

    def reset(self, seed: Optional[int] = None, episode_id: Optional[str] = None,
              task_id: str = "easy", **kwargs) -> CLMObservation:
        if task_id not in ("easy", "medium", "hard"):
            task_id = "easy"
        tasks = generate_tasks(task_id)
        self._env = CLMEnvironment(tasks=tasks, max_steps=50)
        self._final_score = _SCORE_MIN
        obs = self._env.reset()
        return self._to_oe_obs(obs)

    def step(self, action: CLMAction, timeout_s: Optional[float] = None, **kwargs) -> CLMObservation:
        model_action = ModelAction(type=action.type, task_id=action.task_id)
        obs, reward, done, info = self._env.step(model_action)

        if done:
            raw_score = deterministic_grader(
                self._env.state.tasks,
                self._env.state.time_step,
                self._env.state.energy,
            )
            self._final_score = _safe_score(raw_score)
            info["final_score"] = self._final_score
        safe_reward = _safe_score(float(reward))
        return self._to_oe_obs(obs, done=done, reward=safe_reward, info=info)

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


# ── Build FastAPI app ────────────────────────────────────────────────────────

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

    # ── Grade endpoints (required by hackathon Phase 2 validator) ────────────
    # Validator calls GET /grader and GET /grade/{task_id} to score each task.
    # Scores must be strictly in (0.01, 0.99) — never 0.0 or 1.0.

    @_app.get("/grader", tags=["Grader"])
    async def get_grader_score():
        """General grader endpoint — returns score for 'easy' difficulty."""
        return _grade_task("easy")

    @_app.get("/grade/easy", tags=["Grader"])
    async def grade_easy():
        """Grade the 'easy' task (2 tasks, no deadlines)."""
        return _grade_task("easy")

    @_app.get("/grade/medium", tags=["Grader"])
    async def grade_medium():
        """Grade the 'medium' task (5 tasks with deadlines)."""
        return _grade_task("medium")

    @_app.get("/grade/hard", tags=["Grader"])
    async def grade_hard():
        """Grade the 'hard' task (8 tasks with tight deadlines)."""
        return _grade_task("hard")

    return _app


app = build_app()
