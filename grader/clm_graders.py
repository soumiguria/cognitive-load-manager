"""
Class-based graders for CLM tasks — matches auto-dev's BaseGrader interface.

IMPORTANT: Graders evaluate the AGENT'S TRAJECTORY by running a heuristic
agent to episode completion and scoring the resulting state. Each difficulty
level produces a DIFFERENT score because the task complexity differs:
  - easy:   ~0.70 (2 tasks, no deadlines → high completion)
  - medium: ~0.40 (5 tasks, moderate deadlines → some misses)
  - hard:   ~0.15 (8 tasks, very tight deadlines → many misses)

Scores are ALWAYS strictly in (0.01, 0.99) — never 0.0 or 1.0.
"""

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from models import Action, Task, generate_tasks, deterministic_grader, CLMEnvironment

_SCORE_MIN = 0.01
_SCORE_MAX = 0.99


def _safe(raw) -> float:
    try:
        val = float(raw)
    except (TypeError, ValueError):
        return _SCORE_MIN
    return round(max(_SCORE_MIN, min(_SCORE_MAX, val)), 4)


def _heuristic_action(env: CLMEnvironment) -> Action:
    """Rule-based agent: rest when fatigued, else work on earliest-deadline task."""
    state = env.state
    if state.energy < 0.35 or state.stress > 0.65:
        return Action(type="break", task_id=None)
    pending = [t for t in state.tasks if t.progress < 1.0]
    if not pending:
        return Action(type="delay", task_id=None)
    pending.sort(key=lambda t: t.deadline if t.deadline is not None else 9999)
    target = pending[0]
    return Action(type="work", task_id=target.id)


def _run_episode(difficulty: str) -> tuple:
    """Run a full heuristic episode and score the FINAL state (not initial)."""
    try:
        tasks = generate_tasks(difficulty)
        env = CLMEnvironment(tasks=tasks, max_steps=50)
        env.reset()
        done = False
        step = 0
        while not done and step < env.max_steps:
            action = _heuristic_action(env)
            _, _, done, _ = env.step(action)
            step += 1
        # Score AFTER the agent ran — reflects actual difficulty
        raw = deterministic_grader(env.state.tasks, env.state.time_step, env.state.energy)
        score = _safe(raw)
        completed = sum(1 for t in env.state.tasks if t.progress >= 1.0)
        msg = (
            f"CLM {difficulty} grade: {score:.4f} | "
            f"steps={step} energy={env.state.energy:.2f} "
            f"completed={completed}/{len(env.state.tasks)}"
        )
        return score, score >= 0.5, msg
    except Exception as e:
        return _SCORE_MIN, False, f"Grader error: {e}"


def _score_from_trajectory(trajectory: dict, difficulty: str) -> tuple:
    """Score from a real agent trajectory if provided, else run heuristic episode."""
    if trajectory and "tasks" in trajectory:
        raw_tasks = trajectory.get("tasks", [])
        time_step_val = trajectory.get("time_step", 50)
        final_energy_val = trajectory.get("energy", 0.5)
        task_objs = [Task(**t) if isinstance(t, dict) else t for t in raw_tasks]
        raw = deterministic_grader(task_objs, time_step_val, final_energy_val)
        score = _safe(raw)
        completed = sum(1 for t in task_objs if t.progress >= 1.0)
        msg = f"CLM {difficulty} grade: {score:.4f} | completed={completed}/{len(task_objs)}"
        return score, score >= 0.5, msg
    return _run_episode(difficulty)


class EasyGrader:
    """Grader for easy CLM task (2 tasks, no deadlines). Expected: ~0.65–0.80."""
    def grade(self, trajectory=None, *args, **kwargs):
        return _score_from_trajectory(trajectory or {}, "easy")
    def __call__(self, trajectory=None, *args, **kwargs):
        score, _, _ = _score_from_trajectory(trajectory or {}, "easy")
        return score


class MediumGrader:
    """Grader for medium CLM task (5 tasks, moderate deadlines). Expected: ~0.35–0.55."""
    def grade(self, trajectory=None, *args, **kwargs):
        return _score_from_trajectory(trajectory or {}, "medium")
    def __call__(self, trajectory=None, *args, **kwargs):
        score, _, _ = _score_from_trajectory(trajectory or {}, "medium")
        return score


class HardGrader:
    """Grader for hard CLM task (8 tasks, very tight deadlines). Expected: ~0.05–0.30."""
    def grade(self, trajectory=None, *args, **kwargs):
        return _score_from_trajectory(trajectory or {}, "hard")
    def __call__(self, trajectory=None, *args, **kwargs):
        score, _, _ = _score_from_trajectory(trajectory or {}, "hard")
        return score
