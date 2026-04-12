"""
Class-based graders for CLM tasks.

FIX 1: _from_trajectory no longer falls back to running a heuristic episode
when the trajectory is empty or missing. It returns 0.01 immediately.
The grader MUST score the actual agent, not a proxy.

Graders produce scores strictly in (0.01, 0.99).
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


def _from_trajectory(trajectory: dict, difficulty: str) -> tuple:
    """
    Score a completed agent trajectory.

    FIX 1: If trajectory is empty or has no tasks, return 0.01 immediately.
    We must never rerun a heuristic episode here — that would score the
    heuristic agent, not the LLM agent under evaluation.
    """
    if not trajectory or not trajectory.get("tasks"):
        return _MIN, False, f"CLM {difficulty} | score=0.0100 | empty trajectory"

    raw_tasks = trajectory["tasks"]
    ts  = trajectory.get("time_step", 50)
    eng = trajectory.get("energy", 0.5)
    task_objs = [Task(**t) if isinstance(t, dict) else t for t in raw_tasks]
    raw   = deterministic_grader(task_objs, ts, eng)
    score = _safe(raw)
    comp  = sum(1 for t in task_objs if t.progress >= 1.0)
    msg   = f"CLM {difficulty} | score={score:.4f} | completed={comp}/{len(task_objs)}"
    return score, score >= 0.5, msg


def _run_heuristic_baseline(difficulty: str) -> tuple:
    """
    Run a heuristic agent to produce a BASELINE reference score only.
    This is used for reporting / README baseline numbers — NEVER for
    grading an LLM agent's actual trajectory.
    """
    try:
        tasks  = generate_tasks(difficulty, seed=42)   # fixed seed for reproducibility
        max_s  = 60 if difficulty == "expert" else 50
        env    = CLMEnvironment(tasks=tasks, max_steps=max_s, seed=42)
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
            f"CLM {difficulty} baseline | score={score:.4f} | "
            f"steps={step} energy={env.state.energy:.2f} "
            f"completed={comp}/{len(env.state.tasks)}"
        )
        return score, score >= 0.5, msg
    except Exception as e:
        return _MIN, False, f"Baseline error: {e}"


def _heuristic_action(env: CLMEnvironment) -> Action:
    """
    Competent heuristic agent:
    - Takes breaks when fatigued or stressed
    - Prioritises: critical > high > normal > low, then earliest deadline
    - Respects task dependencies
    - Uses focus mode on critical tasks near their deadline
    """
    state   = env.state
    blocked = env._blocked_ids()

    if state.energy < 0.30 or state.stress > 0.70:
        return Action(type="break", task_id=None)

    pending = [t for t in state.tasks if t.progress < 1.0 and t.id not in blocked]
    if not pending:
        return Action(type="delay", task_id=None)

    pending.sort(key=lambda t: (
        -PRIORITY_WEIGHT[t.priority],
        t.deadline if t.deadline is not None else 9999
    ))
    target = pending[0]

    use_focus = (
        target.priority == "critical"
        and target.deadline is not None
        and (target.deadline - state.time_step) <= 10
        and state.energy > 0.55
    )
    return Action(type="focus" if use_focus else "work", task_id=target.id)


# ==========================================
# PUBLIC GRADER CLASSES
# ==========================================
class EasyGrader:
    """Easy: 2 tasks (email + report), no deadlines. Expected score: ~0.72–0.82."""
    def grade(self, trajectory=None, *a, **kw):
        return _from_trajectory(trajectory or {}, "easy")
    def __call__(self, trajectory=None, *a, **kw):
        return _from_trajectory(trajectory or {}, "easy")[0]

class MediumGrader:
    """Medium: 5 tasks, mixed priorities and deadlines. Expected: ~0.38–0.52."""
    def grade(self, trajectory=None, *a, **kw):
        return _from_trajectory(trajectory or {}, "medium")
    def __call__(self, trajectory=None, *a, **kw):
        return _from_trajectory(trajectory or {}, "medium")[0]

class HardGrader:
    """Hard: 8 tasks, dependencies, tight deadlines, stochastic interruptions. Expected: ~0.15–0.28."""
    def grade(self, trajectory=None, *a, **kw):
        return _from_trajectory(trajectory or {}, "hard")
    def __call__(self, trajectory=None, *a, **kw):
        return _from_trajectory(trajectory or {}, "hard")[0]

class ExpertGrader:
    """Expert: 10 tasks, deep dependencies, 3 stochastic interruptions. Expected: ~0.05–0.15."""
    def grade(self, trajectory=None, *a, **kw):
        return _from_trajectory(trajectory or {}, "expert")
    def __call__(self, trajectory=None, *a, **kw):
        return _from_trajectory(trajectory or {}, "expert")[0]
