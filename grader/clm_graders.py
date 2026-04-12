"""
Class-based graders for CLM tasks — matches auto-dev's BaseGrader interface.

The hackathon validator:
  1. Reads openenv.yaml to find grader: "grader.clm_graders:EasyGrader"
  2. Imports the module: from grader.clm_graders import EasyGrader
  3. Instantiates the class: g = EasyGrader()
  4. Calls grade(): score, done, msg = g.grade(...)
  5. Checks 0 < score < 1

Scores are ALWAYS strictly in (0.01, 0.99) — never 0.0 or 1.0.
"""

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from models import generate_tasks, deterministic_grader, CLMEnvironment

_SCORE_MIN = 0.01
_SCORE_MAX = 0.99


def _safe(raw) -> float:
    """Clamp to strictly open interval (0.01, 0.99). Never returns 0.0 or 1.0."""
    try:
        val = float(raw)
    except (TypeError, ValueError):
        return _SCORE_MIN
    return round(max(_SCORE_MIN, min(_SCORE_MAX, val)), 4)


def _compute_grade(difficulty: str) -> tuple[float, bool, str]:
    """Run the deterministic grader on a fresh env for the given difficulty."""
    try:
        tasks = generate_tasks(difficulty)
        env = CLMEnvironment(tasks=tasks, max_steps=50)
        env.reset()
        raw = deterministic_grader(
            env.state.tasks,
            env.state.time_step,
            env.state.energy,
        )
        score = _safe(raw)
    except Exception:
        score = _SCORE_MIN
    return score, score >= 0.5, f"CLM {difficulty} grade: {score:.4f}"


class EasyGrader:
    """Grader for the 'easy' CLM task (2 tasks, no deadlines)."""

    def grade(self, *args, **kwargs) -> tuple[float, bool, str]:
        return _compute_grade("easy")

    def __call__(self, *args, **kwargs) -> float:
        score, _, _ = _compute_grade("easy")
        return score


class MediumGrader:
    """Grader for the 'medium' CLM task (5 tasks with deadlines)."""

    def grade(self, *args, **kwargs) -> tuple[float, bool, str]:
        return _compute_grade("medium")

    def __call__(self, *args, **kwargs) -> float:
        score, _, _ = _compute_grade("medium")
        return score


class HardGrader:
    """Grader for the 'hard' CLM task (8 tasks with tight deadlines)."""

    def grade(self, *args, **kwargs) -> tuple[float, bool, str]:
        return _compute_grade("hard")

    def __call__(self, *args, **kwargs) -> float:
        score, _, _ = _compute_grade("hard")
        return score
