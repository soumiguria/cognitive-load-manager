from pydantic import BaseModel, Field
from typing import List, Optional, Literal, Tuple, Dict, Any
import random

# ==========================================
# TASK TYPES
# ==========================================
TaskType = Literal["email", "meeting", "code_review", "report", "call"]
Priority  = Literal["critical", "high", "normal", "low"]

PRIORITY_WEIGHT    = {"critical": 1.5, "high": 1.2, "normal": 1.0, "low": 0.7}
TASK_ENERGY_COST   = {"email": 0.08, "meeting": 0.18, "code_review": 0.20, "report": 0.14, "call": 0.11}
TASK_PROGRESS_RATE = {"email": 0.35, "meeting": 0.30, "code_review": 0.20, "report": 0.22, "call": 0.28}
COGNITIVE_BUCKETS  = {"email": "social", "meeting": "social", "code_review": "analytical", "report": "analytical", "call": "social"}

ALL_TASK_TYPES: list[TaskType] = ["email", "meeting", "code_review", "report", "call"]
ALL_PRIORITIES: list[Priority] = ["critical", "high", "normal", "low"]

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
    depends_on: Optional[str] = None
    is_interrupted: bool = False

class WorkerState(BaseModel):
    id: str
    energy: float = 1.0
    stress: float = 0.0
    current_task_id: Optional[str] = None
    expertise: str = "analytical"

class VisibleWorker(BaseModel):
    id: str
    fatigue_level: str
    stress_level: str
    stress_warning: bool
    expertise: str
    current_task_id: Optional[str] = None

class VisibleState(BaseModel):
    """
    Partial observability for the Oracle Manager.
    """
    workers:            List[VisibleWorker] = []
    focus_mode:         bool  = False
    upcoming_deadlines: List[str] = []
    blocked_tasks:      List[str] = []

class Observation(BaseModel):
    tasks:        List[Task]
    visible_state: VisibleState
    time_step:    int

class Action(BaseModel):
    type: Literal["work", "break", "switch", "delay", "focus"]
    task_id: Optional[str] = None
    worker_id: Optional[str] = None

class EnvState(BaseModel):
    workers:                 List[WorkerState] = []
    time_step:               int   = 0
    tasks:                   List[Task] = []
    focus_mode:              bool  = False
    interruption_count:      int   = 0
    milestone_rewards:       Dict[str, float] = {}
    next_interrupt_eligible: int  = 999
    interrupt_budget:        int  = 0
    server_outage_active:    bool  = False


# ==========================================
# FIX 2 — PROCEDURAL TASK GENERATION
# Seed-based so episodes are reproducible on request but vary by default.
# Deadlines jitter +-3 steps; task types and secondary priorities randomised.
# ==========================================
def generate_tasks(level: str, seed: Optional[int] = None) -> list[Task]:
    """
    Generate tasks for the given difficulty level.
    Pass seed=None for a random seed (default for live play),
    or an explicit int for reproducible evaluation runs.
    """
    rng = random.Random(seed)

    def _jitter(base: int, lo: int = -3, hi: int = 3) -> int:
        return max(1, base + rng.randint(lo, hi))

    def _p(pool: list) -> str:
        return rng.choice(pool)

    if level == "easy":
        return [
            Task(id="e1", difficulty="easy",
                 task_type=_p(["email", "report"]),
                 priority=_p(["normal", "high"]),
                 deadline=None),
            Task(id="e2", difficulty="easy",
                 task_type=_p(["report", "code_review"]),
                 priority=_p(["normal", "low"]),
                 deadline=None),
        ]

    elif level == "medium":
        return [
            Task(id="m1", difficulty="medium",
                 task_type=_p(["email", "call"]),
                 priority="critical",
                 deadline=_jitter(14)),
            Task(id="m2", difficulty="medium",
                 task_type=_p(["meeting", "code_review"]),
                 priority=_p(["high", "normal"]),
                 deadline=_jitter(20)),
            Task(id="m3", difficulty="medium",
                 task_type=_p(["code_review", "report"]),
                 priority=_p(["normal", "high"]),
                 deadline=_jitter(28)),
            Task(id="m4", difficulty="medium",
                 task_type=_p(["report", "meeting"]),
                 priority=_p(["high", "normal"]),
                 deadline=_jitter(35)),
            Task(id="m5", difficulty="medium",
                 task_type=_p(["call", "email"]),
                 priority=_p(["low", "normal"]),
                 deadline=_jitter(45)),
        ]

    elif level == "hard":
        return [
            Task(id="h1", difficulty="hard",
                 task_type=_p(["email", "call"]),
                 priority="critical",
                 deadline=_jitter(12)),
            Task(id="h2", difficulty="hard",
                 task_type=_p(["code_review", "report"]),
                 priority=_p(["high", "normal"]),
                 deadline=_jitter(16)),
            Task(id="h3", difficulty="hard",
                 task_type=_p(["meeting", "call"]),
                 priority="critical",
                 deadline=_jitter(20),
                 depends_on="h1"),
            Task(id="h4", difficulty="hard",
                 task_type=_p(["report", "code_review"]),
                 priority=_p(["high", "normal"]),
                 deadline=_jitter(24)),
            Task(id="h5", difficulty="hard",
                 task_type=_p(["call", "meeting"]),
                 priority=_p(["normal", "high"]),
                 deadline=_jitter(28),
                 depends_on="h2"),
            Task(id="h6", difficulty="hard",
                 task_type=_p(["email", "report"]),
                 priority=_p(["high", "normal"]),
                 deadline=_jitter(32)),
            Task(id="h7", difficulty="hard",
                 task_type=_p(["code_review", "meeting"]),
                 priority="critical",
                 deadline=_jitter(38),
                 depends_on="h4"),
            Task(id="h8", difficulty="hard",
                 task_type=_p(["report", "email"]),
                 priority=_p(["normal", "low"]),
                 deadline=_jitter(46)),
        ]

    elif level == "expert":
        return [
            Task(id="x1",  difficulty="expert",
                 task_type=_p(["email", "call"]),
                 priority="critical",
                 deadline=_jitter(8)),
            Task(id="x2",  difficulty="expert",
                 task_type=_p(["code_review", "report"]),
                 priority=_p(["high", "critical"]),
                 deadline=_jitter(12)),
            Task(id="x3",  difficulty="expert",
                 task_type=_p(["meeting", "call"]),
                 priority="critical",
                 deadline=_jitter(14),
                 depends_on="x1"),
            Task(id="x4",  difficulty="expert",
                 task_type=_p(["report", "code_review"]),
                 priority=_p(["high", "normal"]),
                 deadline=_jitter(18),
                 depends_on="x2"),
            Task(id="x5",  difficulty="expert",
                 task_type=_p(["call", "meeting"]),
                 priority=_p(["normal", "high"]),
                 deadline=_jitter(22),
                 depends_on="x3"),
            Task(id="x6",  difficulty="expert",
                 task_type=_p(["code_review", "email"]),
                 priority="critical",
                 deadline=_jitter(24)),
            Task(id="x7",  difficulty="expert",
                 task_type=_p(["email", "report"]),
                 priority=_p(["high", "normal"]),
                 deadline=_jitter(28),
                 depends_on="x4"),
            Task(id="x8",  difficulty="expert",
                 task_type=_p(["report", "call"]),
                 priority=_p(["normal", "high"]),
                 deadline=_jitter(33),
                 depends_on="x6"),
            Task(id="x9",  difficulty="expert",
                 task_type=_p(["meeting", "code_review"]),
                 priority="critical",
                 deadline=_jitter(36),
                 depends_on="x5"),
            Task(id="x10", difficulty="expert",
                 task_type=_p(["call", "email"]),
                 priority=_p(["high", "normal"]),
                 deadline=_jitter(44)),
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
    if not trajectory or not trajectory.get("tasks"):
        return 0.01

    raw_tasks = trajectory["tasks"]
    ts  = trajectory.get("time_step", 50)
    # Average energy across workers for grading purposes
    workers = trajectory.get("workers", [])
    eng = sum(w.get("energy", 0.5) for w in workers) / max(1, len(workers)) if workers else 0.5
    
    task_objs = [Task(**t) if isinstance(t, dict) else t for t in raw_tasks]
    return deterministic_grader(task_objs, ts, eng)


def deterministic_grader(tasks: list[Task], time_step: int, final_energy: float) -> float:
    """
    Scores the ACTUAL final task state. Always returns a value in (0.01, 0.99).

    Formula:
      weighted_completion  x 0.60
      deadline_adherence   x 0.22
      energy_efficiency    x 0.10
      dependency_bonus     x 0.05
      interruption_bonus   x 0.03
    """
    if not tasks:
        return 0.01

    total_weight = sum(PRIORITY_WEIGHT[t.priority] for t in tasks)

    # Weighted completion (partial progress counts)
    wc = sum(t.progress * PRIORITY_WEIGHT[t.priority] for t in tasks) / max(total_weight, 0.01)

    # Deadline adherence
    completable  = [t for t in tasks if t.deadline is not None]
    met_deadline = sum(
        1 for t in completable
        if t.progress >= 1.0 and time_step <= t.deadline
    )
    da = (met_deadline / len(completable)) if completable else 1.0

    # Energy efficiency
    ee = max(0.0, (final_energy - 0.10) * 0.13)

    # Dependency ordering bonus
    dep_bonus = 0.0
    for t in tasks:
        if t.depends_on and t.progress >= 1.0:
            parent = next((p for p in tasks if p.id == t.depends_on), None)
            if parent and parent.progress >= 1.0:
                dep_bonus += 0.015
    dep_bonus = min(0.05, dep_bonus)

    # Interruption handling bonus
    interrupted = [t for t in tasks if t.is_interrupted]
    int_bonus = 0.0
    if interrupted:
        handled   = sum(1 for t in interrupted if t.progress >= 1.0)
        int_bonus = min(0.03, (handled / len(interrupted)) * 0.03)

    raw = wc * 0.60 + da * 0.22 + ee + dep_bonus + int_bonus
    return round(max(0.01, min(0.99, raw)), 4)


# ==========================================
# FIX 3 — STOCHASTIC INTERRUPTION CONFIG
# Interruptions fire with a per-step probability once an eligibility
# window opens, with a cooldown to prevent back-to-back fires.
# budget = max number of interrupts for the difficulty level.
# ==========================================
_INTERRUPT_CONFIG = {
    #           prob_per_step  eligible_from  cooldown_steps  budget
    "hard":   (0.18,          10,             8,              2),
    "expert": (0.22,           6,             7,              3),
}

DRIFT_EVENTS = [
    {
        "name": "server_outage",
        "trigger_step": 10,
        "effect": "code_review energy cost doubles",
        "announcement": "URGENT: Production server down, all code reviews now critical"
    },
    {
        "name": "urgent_interrupt", 
        "trigger_step": 20,
        "effect": "Investor call added mid-episode",
        "announcement": "Urgent interrupt — investor call added mid-episode"
    },
    {
        "name": "deadline_crunch",
        "trigger_step": 35, 
        "effect": "All deadlines reduced by 5 steps",
        "announcement": "Client moved deadline up. All deliverables due earlier."
    }
]

class CLMEnvironment:
    def __init__(self, tasks: list[Task], max_steps: int = 50,
                 seed: Optional[int] = None):
        self.max_steps     = max_steps
        self.initial_tasks = tasks
        self.difficulty    = tasks[0].difficulty if tasks else "easy"
        self._rng          = random.Random(seed)
        cfg = _INTERRUPT_CONFIG.get(self.difficulty, (0.0, 999, 999, 0))
        self._interrupt_prob, eligible_from, self._cooldown, budget = cfg
        self.state = EnvState(
            tasks=[t.model_copy() for t in tasks],
            workers=self._init_workers(),
            next_interrupt_eligible=eligible_from,
            interrupt_budget=budget,
        )

    def _init_workers(self) -> List[WorkerState]:
        return [
            WorkerState(id="w1", expertise="analytical"),
            WorkerState(id="w2", expertise="social"),
            WorkerState(id="w3", expertise="analytical")
        ]

    def reset(self) -> Observation:
        cfg = _INTERRUPT_CONFIG.get(self.difficulty, (0.0, 999, 999, 0))
        _, eligible_from, _, budget = cfg
        self.state = EnvState(
            tasks=[t.model_copy() for t in self.initial_tasks],
            workers=self._init_workers(),
            next_interrupt_eligible=eligible_from,
            interrupt_budget=budget,
        )
        return self._get_observation()

    def _blocked_ids(self) -> set[str]:
        done_ids = {t.id for t in self.state.tasks if t.progress >= 1.0}
        return {t.id for t in self.state.tasks if t.depends_on and t.depends_on not in done_ids}

    def apply_schema_drift(self, step: int) -> Optional[dict]:
        for event in DRIFT_EVENTS:
            if step == event["trigger_step"]:
                if event["name"] == "deadline_crunch":
                    for t in self.state.tasks:
                        if t.deadline:
                            t.deadline = max(step + 1, t.deadline - 5)
                elif event["name"] == "urgent_interrupt":
                    self.state.tasks.append(Task(
                        id=f"drift_{step}", difficulty=self.difficulty,
                        task_type="call", priority="critical",
                        deadline=step + 10, is_interrupted=True,
                    ))
                elif event["name"] == "server_outage":
                    self.state.server_outage_active = True
                return {
                     "title": event["name"],
                     "message": event["announcement"],
                     "step": step
                }
        return None

    def _upcoming_ids(self, window: int = 5) -> list[str]:
        return [
            t.id for t in self.state.tasks
            if t.deadline and 0 < (t.deadline - self.state.time_step) <= window and t.progress < 1.0
        ]

    def _get_observation(self) -> Observation:
        vis_workers = []
        for w in self.state.workers:
            e = w.energy
            s = w.stress
            fatigue_label = "high" if e < 0.30 else ("medium" if e < 0.60 else "low")
            stress_label  = "critical" if s > 0.75 else ("elevated" if s > 0.45 else "calm")
            vis_workers.append(VisibleWorker(
                id=w.id, fatigue_level=fatigue_label, stress_level=stress_label,
                stress_warning=s > 0.65, expertise=w.expertise, current_task_id=w.current_task_id
            ))

        vs = VisibleState(
            workers=vis_workers,
            focus_mode=self.state.focus_mode,
            upcoming_deadlines=self._upcoming_ids(),
            blocked_tasks=list(self._blocked_ids()),
        )
        return Observation(tasks=self.state.tasks, visible_state=vs, time_step=self.state.time_step)

    def step(self, action: Action) -> Tuple[Observation, float, bool, dict]:
        reward  = 0.0
        blocked = self._blocked_ids()
        
        # Oracle manager assigns action to specific worker
        worker = next((w for w in self.state.workers if w.id == action.worker_id), self.state.workers[0])

        if (self.state.interrupt_budget > 0
                and self.state.time_step >= self.state.next_interrupt_eligible
                and self._rng.random() < self._interrupt_prob):
            _inject_interruption(self.state, self.state.time_step)
            self.state.interrupt_budget -= 1
            self.state.next_interrupt_eligible = self.state.time_step + self._cooldown
            reward -= 0.05

        if action.type in ("work", "focus"):
            is_focus = (action.type == "focus")

            if action.task_id:
                if action.task_id in blocked:
                    reward -= 0.15
                else:
                    if worker.current_task_id and worker.current_task_id != action.task_id:
                        # Context switching penalty logic
                        old_t = next((t for t in self.state.tasks if t.id == worker.current_task_id), None)
                        new_t = next((t for t in self.state.tasks if t.id == action.task_id), None)
                        if old_t and new_t:
                            # If similar task type, HIGH penalty. If dissimilar, LOW penalty.
                            if COGNITIVE_BUCKETS.get(old_t.task_type) == COGNITIVE_BUCKETS.get(new_t.task_type):
                                reward -= 0.15  # Penalty for monotony
                                worker.stress = min(1.0, worker.stress + 0.05)
                            else:
                                reward -= 0.05  # Refreshing context switch
                    worker.current_task_id = action.task_id
                    self.state.focus_mode  = is_focus

            task = next((t for t in self.state.tasks if t.id == worker.current_task_id), None)

            if task and task.progress < 1.0 and task.id not in blocked:
                ecost      = TASK_ENERGY_COST.get(task.task_type, 0.14) * (2.0 if is_focus else 1.0)
                if self.state.server_outage_active and task.task_type == "code_review":
                    ecost *= 2.0
                base_rate  = TASK_PROGRESS_RATE.get(task.task_type, 0.22)
                efficiency = max(0.15, worker.energy) * (1.0 - worker.stress * 0.45)
                progress   = base_rate * (2.0 if is_focus else 1.0) * efficiency
                pw         = PRIORITY_WEIGHT[task.priority]

                worker.energy = max(0.0, worker.energy - ecost)
                old_p      = task.progress
                task.progress = min(1.0, task.progress + progress)

                reward += 0.10 * (task.progress - old_p) * pw

                for ms, bonus in [(0.25, 0.04), (0.50, 0.07), (0.75, 0.09), (1.00, 0.18)]:
                    key = f"{task.id}@{ms}"
                    if task.progress >= ms and key not in self.state.milestone_rewards:
                        self.state.milestone_rewards[key] = bonus
                        reward += bonus * pw
            else:
                worker.energy = max(0.0, worker.energy - 0.04)

        elif action.type == "break":
            self.state.focus_mode = False
            worker.energy = min(1.0, worker.energy + 0.22)
            worker.stress = max(0.0, worker.stress - 0.18)
            reward += 0.03

        elif action.type == "switch":
            self.state.focus_mode = False
            if action.task_id and action.task_id not in blocked:
                worker.current_task_id = action.task_id
            reward -= 0.07

        elif action.type == "delay":
            # Pushing to tomorrow: Moderate penalty (not extreme)
            worker.stress = min(1.0, worker.stress + 0.05)
            reward -= 0.05

        self.state.time_step += 1

        # Stress dynamics for all workers
        for t in (tt for tt in self.state.tasks if tt.progress < 1.0):
            if t.deadline:
                ttd = t.deadline - self.state.time_step
                pw  = PRIORITY_WEIGHT[t.priority]
                if 0 <= ttd <= 3:
                    for w in self.state.workers:
                        w.stress = min(1.0, w.stress + 0.06 * pw)
                elif ttd < 0:
                    for w in self.state.workers:
                        w.stress = min(1.0, w.stress + 0.12 * pw)

        # Episode termination
        all_done = all(t.progress >= 1.0 for t in self.state.tasks)
        # Burnout condition: ANY worker hits 0 energy
        burnout  = any(w.energy < 0.07 for w in self.state.workers)
        timeout  = self.state.time_step >= self.max_steps
        done     = all_done or burnout or timeout

        if any(w.stress > 0.80 for w in self.state.workers):
            reward -= 0.07

        if done:
            if burnout:
                reward -= 1.0
            elif all_done:
                missed = any(t.deadline and self.state.time_step > t.deadline for t in self.state.tasks)
                reward += 0.5 if missed else 1.0

        reward = max(-1.0, min(1.0, float(reward)))
        info   = self.state.model_dump()
        
        drift = self.apply_schema_drift(self.state.time_step)
        if drift:
            info["schema_drift"] = drift

        if done:
            eng = sum(w.energy for w in self.state.workers) / max(1, len(self.state.workers))
            info["final_score"] = deterministic_grader(
                self.state.tasks, self.state.time_step, eng
            )
        return self._get_observation(), reward, done, info

    def state_dict(self) -> dict:
        return self.state.model_dump()
