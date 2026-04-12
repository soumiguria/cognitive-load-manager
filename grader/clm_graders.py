"""
Class-based graders for CLM tasks — matches auto-dev's BaseGrader interface.

Graders run a heuristic agent to episode completion and score the FINAL state.
Each difficulty produces DIFFERENT scores (easy ~0.75, medium ~0.45, hard ~0.20, expert ~0.08).

Scores are ALWAYS strictly in (0.01, 0.99).
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from models import Action, Task, generate_tasks, deterministic_grader, CLMEnvironment, PRIORITY_WEIGHT

_MIN = 0.01
_MAX = 0.99


def _safe(raw) -> float:
    try:
        return round(max(_MIN, min(_MAX, float(raw))), 4)
    except Exception:
        return _MIN


def _heuristic_action(env: CLMEnvironment) -> Action:
    """
    Competent heuristic agent:
    - Enters focus mode on critical tasks with approaching deadlines
    - Takes breaks when fatigued or stressed
    - Prioritises: critical > high > normal > low, then earliest deadline
    - Respects task dependencies (never works on a blocked task)
    """
    state = env.state
    blocked = env._blocked_ids()

    # Rest condition
    if state.energy < 0.30 or state.stress > 0.70:
        return Action(type="break", task_id=None)

    pending = [t for t in state.tasks if t.progress < 1.0 and t.id not in blocked]
    if not pending:
        return Action(type="delay", task_id=None)

    # Sort by priority weight DESC then deadline ASC
    pending.sort(key=lambda t: (
        -PRIORITY_WEIGHT[t.priority],
        t.deadline if t.deadline is not None else 9999
    ))
    target = pending[0]

    # Use focus mode for critical tasks with deadline in ≤10 steps
    use_focus = (
        target.priority == "critical"
        and target.deadline is not None
        and (target.deadline - state.time_step) <= 10
        and state.energy > 0.55
    )

    if state.current_task_id == target.id:
        return Action(type="focus" if use_focus else "work", task_id=target.id)
    return Action(type="focus" if use_focus else "work", task_id=target.id)


def _run_episode(difficulty: str) -> tuple:
    try:
        tasks  = generate_tasks(difficulty)
        max_s  = 60 if difficulty == "expert" else 50
        env    = CLMEnvironment(tasks=tasks, max_steps=max_s)
        env.reset()
        done, step = False, 0
        while not done and step < max_s:
            action = _heuristic_action(env)
            _, _, done, _ = env.step(action)
            step += 1
        raw   = deterministic_grader(env.state.tasks, env.state.time_step, env.state.energy)
        score = _safe(raw)
        comp  = sum(1 for t in env.state.tasks if t.progress >= 1.0)
        msg   = (
            f"CLM {difficulty} | score={score:.4f} | "
            f"steps={step} energy={env.state.energy:.2f} "
            f"completed={comp}/{len(env.state.tasks)}"
        )
        return score, score >= 0.5, msg
    except Exception as e:
        return _MIN, False, f"Grader error: {e}"


def _from_trajectory(trajectory: dict, difficulty: str) -> tuple:
    if trajectory and "tasks" in trajectory:
        raw_tasks = trajectory.get("tasks", [])
        ts  = trajectory.get("time_step", 50)
        eng = trajectory.get("energy", 0.5)
        task_objs = [Task(**t) if isinstance(t, dict) else t for t in raw_tasks]
        raw   = deterministic_grader(task_objs, ts, eng)
        score = _safe(raw)
        comp  = sum(1 for t in task_objs if t.progress >= 1.0)
        msg   = f"CLM {difficulty} | score={score:.4f} | completed={comp}/{len(task_objs)}"
        return score, score >= 0.5, msg
    return _run_episode(difficulty)


class EasyGrader:
    """Easy: 2 tasks (email + report), no deadlines. Expected heuristic score: ~0.72–0.82."""
    def grade(self, trajectory=None, *a, **kw): return _from_trajectory(trajectory or {}, "easy")
    def __call__(self, trajectory=None, *a, **kw): return _from_trajectory(trajectory or {}, "easy")[0]

class MediumGrader:
    """Medium: 5 tasks with mixed priorities and deadlines. Expected: ~0.38–0.52."""
    def grade(self, trajectory=None, *a, **kw): return _from_trajectory(trajectory or {}, "medium")
    def __call__(self, trajectory=None, *a, **kw): return _from_trajectory(trajectory or {}, "medium")[0]

class HardGrader:
    """Hard: 8 tasks with dependencies and tight deadlines + interruptions. Expected: ~0.15–0.28."""
    def grade(self, trajectory=None, *a, **kw): return _from_trajectory(trajectory or {}, "hard")
    def __call__(self, trajectory=None, *a, **kw): return _from_trajectory(trajectory or {}, "hard")[0]

class ExpertGrader:
    """Expert: 10 tasks, deep dependencies, 3 mid-episode interruptions. Expected: ~0.05–0.15."""
    def grade(self, trajectory=None, *a, **kw): return _from_trajectory(trajectory or {}, "expert")
    def __call__(self, trajectory=None, *a, **kw): return _from_trajectory(trajectory or {}, "expert")[0]
