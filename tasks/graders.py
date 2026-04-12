from typing import Dict, Callable

# ─────────────────────────────────────────────────────────────────────────────
# GRADER REGISTRY — required by the OpenEnv hackathon validator.
#
# Each grader takes (action: str, signals: dict) -> float and must return a
# score STRICTLY between 0 and 1 (not 0.0, not 1.0).
#
# action:  one of "work" | "break" | "switch" | "delay"
# signals: dict with keys like energy, stress, fatigue, progress, deadline_gap
# ─────────────────────────────────────────────────────────────────────────────

GRADER_REGISTRY: Dict[str, Callable[[str, dict], float]] = {}


def register_grader(task_id: str):
    def decorator(func: Callable[[str, dict], float]):
        GRADER_REGISTRY[task_id] = func
        return func
    return decorator


def _clamp(value: float) -> float:
    """Clamp to strictly (0, 1) as required by the validator."""
    return round(min(max(float(value), 0.01), 0.99), 4)


def grade_action(task_id: str, action: str, signals: dict) -> float:
    """
    Grade a single action for a given task.
    Falls back to 0.5 if the task has no registered grader.
    """
    action = action.lower().strip()
    if action not in ("work", "break", "switch", "delay"):
        for a in ("work", "break", "switch", "delay"):
            if a in action:
                action = a
                break
        else:
            return 0.05

    grader_func = GRADER_REGISTRY.get(task_id)
    if not grader_func:
        return 0.5

    return _clamp(grader_func(action, signals))


# ── Task: easy ────────────────────────────────────────────────────────────────
# 2 tasks, no deadlines. Agent should work efficiently without burning out.
@register_grader("easy")
def _grade_easy(action: str, signals: dict) -> float:
    energy = signals.get("energy", 0.7)
    progress = signals.get("progress", 0.0)
    stress = signals.get("stress", 0.0)

    if action == "work":
        # Working is good when energy is healthy
        if energy >= 0.4:
            return _clamp(0.55 + energy * 0.40 + progress * 0.10)
        else:
            # Low energy — working now is suboptimal
            return _clamp(0.20 + energy * 0.25)

    elif action == "break":
        # Breaks are valuable when energy is low, costly when energy is fine
        if energy < 0.4:
            return _clamp(0.70 + (0.4 - energy) * 0.70)
        else:
            return _clamp(0.20 + energy * 0.10)

    elif action == "switch":
        # Unnecessary context-switching in easy mode is mildly penalised
        return _clamp(0.25 + progress * 0.20)

    else:  # delay
        return _clamp(0.15 + (1.0 - stress) * 0.15)


# ── Task: medium ──────────────────────────────────────────────────────────────
# 5 medium tasks with moderate deadlines. Agent must balance speed and energy.
@register_grader("medium")
def _grade_medium(action: str, signals: dict) -> float:
    energy = signals.get("energy", 0.7)
    stress = signals.get("stress", 0.2)
    deadline_gap = signals.get("deadline_gap", 10)   # steps until nearest deadline
    progress = signals.get("progress", 0.0)

    urgency = max(0.0, 1.0 - deadline_gap / 20.0)   # 0 = no urgency, 1 = critical

    if action == "work":
        if energy >= 0.3:
            return _clamp(0.50 + urgency * 0.35 + energy * 0.20)
        else:
            # Working on empty is risky but may be necessary near deadline
            return _clamp(0.25 + urgency * 0.35)

    elif action == "break":
        if energy < 0.35 and urgency < 0.6:
            return _clamp(0.65 + (0.35 - energy) * 0.80)
        elif urgency >= 0.6:
            # Break during urgency is a costly choice
            return _clamp(0.15 + energy * 0.10)
        else:
            return _clamp(0.30 + (1.0 - urgency) * 0.25)

    elif action == "switch":
        # Switching can be okay if current task is blocked / done
        return _clamp(0.30 + (1.0 - urgency) * 0.20 + progress * 0.15)

    else:  # delay
        return _clamp(0.12 + (1.0 - urgency) * 0.20)


# ── Task: hard ────────────────────────────────────────────────────────────────
# 8 hard tasks with tight deadlines and hidden fatigue mechanics.
# Agent must manage stress and avoid interruptions.
@register_grader("hard")
def _grade_hard(action: str, signals: dict) -> float:
    energy = signals.get("energy", 0.6)
    stress = signals.get("stress", 0.3)
    deadline_gap = signals.get("deadline_gap", 5)
    fatigue = signals.get("fatigue", 0.2)

    urgency = max(0.0, 1.0 - deadline_gap / 12.0)
    overloaded = stress > 0.7 or fatigue > 0.6

    if action == "work":
        if overloaded:
            # Grinding while overloaded leads to burnout — penalise
            return _clamp(0.20 + urgency * 0.25 - stress * 0.10)
        elif energy >= 0.25:
            return _clamp(0.52 + urgency * 0.38 + energy * 0.15 - fatigue * 0.10)
        else:
            return _clamp(0.18 + urgency * 0.30)

    elif action == "break":
        if overloaded:
            return _clamp(0.72 + stress * 0.25)
        elif energy < 0.3:
            return _clamp(0.65 + (0.3 - energy) * 0.90)
        elif urgency > 0.75:
            return _clamp(0.14 + energy * 0.08)
        else:
            return _clamp(0.35 + (1.0 - urgency) * 0.30)

    elif action == "switch":
        # Switching in hard mode is costly due to context cost
        if urgency < 0.4 and not overloaded:
            return _clamp(0.35 + energy * 0.15)
        else:
            return _clamp(0.12 + (1.0 - urgency) * 0.12)

    else:  # delay
        if overloaded and urgency < 0.5:
            return _clamp(0.55 + stress * 0.25)
        else:
            return _clamp(0.10 + (1.0 - urgency) * 0.15)
