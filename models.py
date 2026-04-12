from pydantic import BaseModel, Field
from typing import List, Optional, Literal, Tuple, Dict, Any

# ==========================================
# TASK TYPES — makes this clearly real-world
# ==========================================
TaskType = Literal["email", "meeting", "code_review", "report", "call"]
Priority  = Literal["critical", "high", "normal", "low"]

PRIORITY_WEIGHT    = {"critical": 1.5, "high": 1.2, "normal": 1.0, "low": 0.7}
TASK_ENERGY_COST   = {"email": 0.08, "meeting": 0.18, "code_review": 0.20, "report": 0.14, "call": 0.11}
TASK_PROGRESS_RATE = {"email": 0.35, "meeting": 0.30, "code_review": 0.20, "report": 0.22, "call": 0.28}

# ==========================================
# OPENENV SCHEMAS
# ==========================================
class Task(BaseModel):
    id: str
    difficulty: str
    task_type: TaskType = "report"
    priority:  Priority  = "normal"
    progress:  float     = 0.0
    deadline:  Optional[int] = None
    depends_on: Optional[str] = None    # must complete parent task first
    is_interrupted: bool = False         # injected mid-episode

class VisibleState(BaseModel):
    fatigue_level:      str        # "low" | "medium" | "high"
    stress_warning:     bool
    energy_level:       float = 1.0
    stress_level:       float = 0.0
    focus_mode:         bool  = False
    upcoming_deadlines: List[str] = []  # task ids with deadline ≤ 5 steps away
    blocked_tasks:      List[str] = []  # task ids blocked by unfinished dependencies

class Observation(BaseModel):
    tasks:        List[Task]
    visible_state: VisibleState
    time_step:    int

class Action(BaseModel):
    type: Literal["work", "break", "switch", "delay", "focus"]
    # work   — normal work on task_id
    # break  — rest; recover energy + reduce stress
    # switch — change active task (small context-switch cost)
    # delay  — do nothing; slight stress relief
    # focus  — deep-work mode: 2× progress, 2× energy cost
    task_id: Optional[str] = None

class EnvState(BaseModel):
    energy:             float = 1.0
    stress:             float = 0.0
    fatigue:            float = 0.0
    time_step:          int   = 0
    current_task_id:    Optional[str] = None
    tasks:              List[Task] = []
    focus_mode:         bool  = False
    interruption_count: int   = 0
    milestone_rewards:  Dict[str, float] = {}


# ==========================================
# TASK GENERATION
# ==========================================
def generate_tasks(level: str) -> list[Task]:
    if level == "easy":
        # 2 simple tasks, no deadlines — learn basics
        return [
            Task(id="e1", difficulty="easy", task_type="email",  priority="normal", deadline=None),
            Task(id="e2", difficulty="easy", task_type="report", priority="normal", deadline=None),
        ]

    elif level == "medium":
        # 5 mixed tasks with deadlines and priorities
        return [
            Task(id="m1", difficulty="medium", task_type="email",      priority="critical", deadline=14),
            Task(id="m2", difficulty="medium", task_type="meeting",     priority="high",     deadline=20),
            Task(id="m3", difficulty="medium", task_type="code_review", priority="normal",   deadline=28),
            Task(id="m4", difficulty="medium", task_type="report",      priority="high",     deadline=35),
            Task(id="m5", difficulty="medium", task_type="call",        priority="low",      deadline=45),
        ]

    elif level == "hard":
        # 8 tasks with task dependencies + 2 mid-episode interruptions
        return [
            Task(id="h1", difficulty="hard", task_type="email",       priority="critical", deadline=12),
            Task(id="h2", difficulty="hard", task_type="code_review",  priority="high",     deadline=16),
            Task(id="h3", difficulty="hard", task_type="meeting",      priority="critical", deadline=20, depends_on="h1"),
            Task(id="h4", difficulty="hard", task_type="report",       priority="high",     deadline=24),
            Task(id="h5", difficulty="hard", task_type="call",         priority="normal",   deadline=28, depends_on="h2"),
            Task(id="h6", difficulty="hard", task_type="email",        priority="high",     deadline=32),
            Task(id="h7", difficulty="hard", task_type="code_review",  priority="critical", deadline=38, depends_on="h4"),
            Task(id="h8", difficulty="hard", task_type="report",       priority="normal",   deadline=46),
        ]

    elif level == "expert":
        # 10 tasks, deep dependencies, 3 mid-episode interruptions
        return [
            Task(id="x1",  difficulty="expert", task_type="email",       priority="critical", deadline=8),
            Task(id="x2",  difficulty="expert", task_type="code_review",  priority="high",     deadline=12),
            Task(id="x3",  difficulty="expert", task_type="meeting",      priority="critical", deadline=14, depends_on="x1"),
            Task(id="x4",  difficulty="expert", task_type="report",       priority="high",     deadline=18, depends_on="x2"),
            Task(id="x5",  difficulty="expert", task_type="call",         priority="normal",   deadline=22, depends_on="x3"),
            Task(id="x6",  difficulty="expert", task_type="code_review",  priority="critical", deadline=24),
            Task(id="x7",  difficulty="expert", task_type="email",        priority="high",     deadline=28, depends_on="x4"),
            Task(id="x8",  difficulty="expert", task_type="report",       priority="normal",   deadline=33, depends_on="x6"),
            Task(id="x9",  difficulty="expert", task_type="meeting",      priority="critical", deadline=36, depends_on="x5"),
            Task(id="x10", difficulty="expert", task_type="call",         priority="high",     deadline=44),
        ]

    return []


def _inject_interruption(state: EnvState, step: int) -> None:
    """Inject an urgent email task mid-episode (hard/expert levels)."""
    iid = f"int{state.interruption_count + 1}"
    state.tasks.append(Task(
        id=iid, difficulty=state.tasks[0].difficulty,
        task_type="email", priority="critical",
        deadline=step + 8, is_interrupted=True,
    ))
    state.interruption_count += 1


# ==========================================
# GRADER
# ==========================================
def grader(trajectory: dict) -> float:
    """OpenEnv single-argument grader."""
    raw_tasks = trajectory.get("tasks", [])
    ts  = trajectory.get("time_step", 50)
    eng = trajectory.get("energy", 0.5)
    task_objs = [Task(**t) if isinstance(t, dict) else t for t in raw_tasks]
    return deterministic_grader(task_objs, ts, eng)


def deterministic_grader(tasks: list[Task], time_step: int, final_energy: float) -> float:
    """
    Additive grader producing strictly different scores per difficulty:
      easy   ≈ 0.70–0.80  (completes all tasks, no deadlines)
      medium ≈ 0.38–0.55  (completes 2–3/5 with deadlines)
      hard   ≈ 0.18–0.30  (completes 2–3/10 with dependencies)
      expert ≈ 0.06–0.15  (completes 1–2/13 with interruptions)

    Score formula (additive — no harsh subtractive penalties):
      weighted_completion  × 0.60   (primary driver)
    + deadline_adherence   × 0.22   (fraction of tasks meeting deadline)
    + energy_efficiency    × 0.10   (reward for not burning out)
    + dependency_bonus     × 0.05   (rewarded correct sequencing)
    + interruption_bonus   × 0.03   (handled urgent tasks)

    Always returns value in (0.01, 0.99).
    """
    if not tasks:
        return 0.01

    total_weight = sum(PRIORITY_WEIGHT[t.priority] for t in tasks)

    # ── Weighted completion (partial progress counts) ──────────────────────────
    wc = sum(t.progress * PRIORITY_WEIGHT[t.priority] for t in tasks) / max(total_weight, 0.01)

    # ── Deadline adherence (fraction of COMPLETABLE tasks that met deadline) ───
    completable   = [t for t in tasks if t.deadline is not None]
    met_deadline  = sum(
        1 for t in completable
        if t.progress >= 1.0 and time_step <= t.deadline
    )
    da = (met_deadline / len(completable)) if completable else 1.0

    # ── Energy efficiency ─────────────────────────────────────────────────────
    ee = max(0.0, (final_energy - 0.10) * 0.13)

    # ── Dependency ordering bonus ──────────────────────────────────────────────
    dep_bonus = 0.0
    for t in tasks:
        if t.depends_on and t.progress >= 1.0:
            parent = next((p for p in tasks if p.id == t.depends_on), None)
            if parent and parent.progress >= 1.0:
                dep_bonus += 0.015
    dep_bonus = min(0.05, dep_bonus)

    # ── Interruption handling bonus ────────────────────────────────────────────
    interrupted = [t for t in tasks if t.is_interrupted]
    int_bonus = 0.0
    if interrupted:
        handled  = sum(1 for t in interrupted if t.progress >= 1.0)
        int_bonus = min(0.03, (handled / len(interrupted)) * 0.03)

    raw = wc * 0.60 + da * 0.22 + ee + dep_bonus + int_bonus
    return round(max(0.01, min(0.99, raw)), 4)


# ==========================================
# OPENENV ENVIRONMENT
# ==========================================
class CLMEnvironment:
    _INTERRUPT_STEPS = {
        "hard":   [15, 32],
        "expert": [7, 18, 32],
    }

    def __init__(self, tasks: list[Task], max_steps: int = 50):
        self.max_steps     = max_steps
        self.initial_tasks = tasks
        self.difficulty    = tasks[0].difficulty if tasks else "easy"
        self.state         = EnvState(tasks=[t.model_copy() for t in tasks])

    def reset(self) -> Observation:
        self.state = EnvState(tasks=[t.model_copy() for t in self.initial_tasks])
        return self._get_observation()

    def _blocked_ids(self) -> set[str]:
        done_ids = {t.id for t in self.state.tasks if t.progress >= 1.0}
        return {t.id for t in self.state.tasks if t.depends_on and t.depends_on not in done_ids}

    def _upcoming_ids(self, window: int = 5) -> list[str]:
        return [
            t.id for t in self.state.tasks
            if t.deadline and 0 < (t.deadline - self.state.time_step) <= window and t.progress < 1.0
        ]

    def _get_observation(self) -> Observation:
        e = self.state.energy
        fl = "high" if e < 0.30 else ("medium" if e < 0.60 else "low")
        vs = VisibleState(
            fatigue_level=fl,
            stress_warning=self.state.stress > 0.65,
            energy_level=round(e, 3),
            stress_level=round(self.state.stress, 3),
            focus_mode=self.state.focus_mode,
            upcoming_deadlines=self._upcoming_ids(),
            blocked_tasks=list(self._blocked_ids()),
        )
        return Observation(tasks=self.state.tasks, visible_state=vs, time_step=self.state.time_step)

    def step(self, action: Action) -> Tuple[Observation, float, bool, dict]:
        reward  = 0.0
        blocked = self._blocked_ids()

        # ── Inject interruptions ───────────────────────────────────────────────
        int_steps = self._INTERRUPT_STEPS.get(self.difficulty, [])
        if (self.state.time_step in int_steps
                and self.state.interruption_count < len(int_steps)):
            _inject_interruption(self.state, self.state.time_step)
            reward -= 0.05

        # ── Action processing ──────────────────────────────────────────────────
        if action.type in ("work", "focus"):
            is_focus = (action.type == "focus")

            if action.task_id:
                if action.task_id in blocked:
                    reward -= 0.15    # tried to work on blocked task
                else:
                    if self.state.current_task_id and self.state.current_task_id != action.task_id:
                        reward -= 0.07  # context-switch cost
                    self.state.current_task_id = action.task_id
                    self.state.focus_mode      = is_focus

            task = next((t for t in self.state.tasks if t.id == self.state.current_task_id), None)

            if task and task.progress < 1.0 and task.id not in blocked:
                ecost      = TASK_ENERGY_COST.get(task.task_type, 0.14) * (2.0 if is_focus else 1.0)
                base_rate  = TASK_PROGRESS_RATE.get(task.task_type, 0.22)
                efficiency = max(0.15, self.state.energy) * (1.0 - self.state.stress * 0.45)
                progress   = base_rate * (2.0 if is_focus else 1.0) * efficiency
                pw         = PRIORITY_WEIGHT[task.priority]

                self.state.energy = max(0.0, self.state.energy - ecost)
                old_p      = task.progress
                task.progress = min(1.0, task.progress + progress)

                reward += 0.10 * (task.progress - old_p) * pw

                # Milestone rewards
                for ms, bonus in [(0.25, 0.04), (0.50, 0.07), (0.75, 0.09), (1.00, 0.18)]:
                    key = f"{task.id}@{ms}"
                    if task.progress >= ms and key not in self.state.milestone_rewards:
                        self.state.milestone_rewards[key] = bonus
                        reward += bonus * pw
            else:
                self.state.energy = max(0.0, self.state.energy - 0.04)

        elif action.type == "break":
            self.state.focus_mode = False
            self.state.energy     = min(1.0, self.state.energy + 0.22)
            self.state.stress     = max(0.0, self.state.stress - 0.18)
            reward += 0.03

        elif action.type == "switch":
            self.state.focus_mode = False
            if action.task_id and action.task_id not in blocked:
                self.state.current_task_id = action.task_id
            reward -= 0.07

        elif action.type == "delay":
            self.state.stress = max(0.0, self.state.stress - 0.04)

        self.state.time_step += 1

        # ── Stress dynamics ────────────────────────────────────────────────────
        for t in (tt for tt in self.state.tasks if tt.progress < 1.0):
            if t.deadline:
                ttd = t.deadline - self.state.time_step
                pw  = PRIORITY_WEIGHT[t.priority]
                if 0 <= ttd <= 3:
                    self.state.stress = min(1.0, self.state.stress + 0.06 * pw)
                elif ttd < 0:
                    self.state.stress = min(1.0, self.state.stress + 0.12 * pw)

        # ── Episode termination ────────────────────────────────────────────────
        all_done = all(t.progress >= 1.0 for t in self.state.tasks)
        burnout  = self.state.energy < 0.07
        timeout  = self.state.time_step >= self.max_steps
        done     = all_done or burnout or timeout

        if self.state.stress > 0.80:
            reward -= 0.07

        if done:
            if burnout:
                reward -= 1.0
            elif all_done:
                missed = any(t.deadline and self.state.time_step > t.deadline for t in self.state.tasks)
                reward += 0.5 if missed else 1.0

        reward = max(-1.0, min(1.0, float(reward)))
        info   = self.state.model_dump()
        if done:
            info["final_score"] = deterministic_grader(
                self.state.tasks, self.state.time_step, self.state.energy
            )
        return self._get_observation(), reward, done, info

    def state_dict(self) -> dict:
        return self.state.model_dump()
