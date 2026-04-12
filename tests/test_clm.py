"""
tests/test_clm.py — unit tests for the Cognitive Load Manager environment.

Run with:  pytest tests/test_clm.py -v
"""
import sys, os, pytest
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from models import (
    Action, Task, EnvState, CLMEnvironment,
    generate_tasks, deterministic_grader, grader,
    PRIORITY_WEIGHT,
)
from grader.clm_graders import (
    EasyGrader, MediumGrader, HardGrader, ExpertGrader, _from_trajectory,
)


# ─────────────────────────────────────────────────────────────────────────────
# FIX 2 — Procedural generation
# ─────────────────────────────────────────────────────────────────────────────
class TestProceduralGeneration:
    def test_seed_produces_same_tasks(self):
        a = generate_tasks("medium", seed=7)
        b = generate_tasks("medium", seed=7)
        assert [t.model_dump() for t in a] == [t.model_dump() for t in b]

    def test_different_seeds_differ(self):
        results = set()
        for s in range(20):
            tasks = generate_tasks("medium", seed=s)
            results.add(tuple(t.deadline for t in tasks))
        assert len(results) > 1, "All seeds produced identical deadlines"

    def test_task_counts(self):
        assert len(generate_tasks("easy"))   == 2
        assert len(generate_tasks("medium")) == 5
        assert len(generate_tasks("hard"))   == 8
        assert len(generate_tasks("expert")) == 10

    def test_deadlines_positive_and_bounded(self):
        """Jitter can reorder adjacent deadlines, but all must be positive and sane."""
        base_deadlines = {"medium": [14, 20, 28, 35, 45], "hard": [12, 16, 20, 24, 28, 32, 38, 46]}
        for level, bases in base_deadlines.items():
            for seed in range(20):
                tasks = generate_tasks(level, seed=seed)
                for t in tasks:
                    if t.deadline is not None:
                        assert t.deadline >= 1, f"Deadline must be >= 1, got {t.deadline}"
                        # Should be within ±5 of the nearest base (generous bound)
                        nearest = min(bases, key=lambda b: abs(b - t.deadline))
                        assert abs(t.deadline - nearest) <= 5, \
                            f"Deadline {t.deadline} too far from base {nearest}"


# ─────────────────────────────────────────────────────────────────────────────
# FIX 1 — Grader trajectory bug
# ─────────────────────────────────────────────────────────────────────────────
class TestGraderTrajectoryBug:
    def test_empty_trajectory_returns_min(self):
        assert grader({}) == 0.01

    def test_missing_tasks_returns_min(self):
        assert grader({"time_step": 50, "energy": 0.8}) == 0.01

    def test_empty_tasks_list_returns_min(self):
        assert grader({"tasks": [], "time_step": 50, "energy": 0.8}) == 0.01

    def test_grader_class_empty_trajectory(self):
        for cls in [EasyGrader, MediumGrader, HardGrader, ExpertGrader]:
            score = cls()(trajectory={})
            assert score == 0.01, f"{cls.__name__} returned {score} for empty trajectory"

    def test_from_trajectory_empty(self):
        score, success, msg = _from_trajectory({}, "easy")
        assert score == 0.01
        assert success is False
        assert "empty trajectory" in msg

    def test_real_trajectory_scores_above_min(self):
        """A trajectory with completed tasks should score > 0.01."""
        tasks = generate_tasks("easy", seed=1)
        for t in tasks:
            t.progress = 1.0
        traj = {"tasks": [t.model_dump() for t in tasks], "time_step": 20, "energy": 0.7}
        assert grader(traj) > 0.01


# ─────────────────────────────────────────────────────────────────────────────
# Environment basics
# ─────────────────────────────────────────────────────────────────────────────
class TestReset:
    def test_reset_produces_clean_state(self):
        env = CLMEnvironment(tasks=generate_tasks("easy", seed=0), max_steps=50)
        obs = env.reset()
        assert env.state.energy == 1.0
        assert env.state.stress == 0.0
        assert env.state.time_step == 0
        assert all(t.progress == 0.0 for t in env.state.tasks)

    def test_reset_after_episode_clears_state(self):
        env = CLMEnvironment(tasks=generate_tasks("easy", seed=0), max_steps=50)
        env.reset()
        for _ in range(10):
            env.step(Action(type="work", task_id="e1"))
        env.reset()
        assert env.state.time_step == 0
        assert env.state.energy == 1.0


# ─────────────────────────────────────────────────────────────────────────────
# Blocked-task penalty (Fix 3 indirectly — env mechanics)
# ─────────────────────────────────────────────────────────────────────────────
class TestBlockedTaskPenalty:
    def test_working_on_blocked_task_gives_penalty(self):
        tasks = generate_tasks("hard", seed=0)
        env   = CLMEnvironment(tasks=tasks, max_steps=50)
        env.reset()

        # h3 depends on h1 — h1 not done yet, so h3 is blocked
        blocked = env._blocked_ids()
        assert "h3" in blocked, "h3 should be blocked at episode start"

        _, reward, _, _ = env.step(Action(type="work", task_id="h3"))
        assert reward <= -0.15, f"Expected penalty for blocked task, got {reward}"


# ─────────────────────────────────────────────────────────────────────────────
# FIX 3 — Stochastic interruptions
# ─────────────────────────────────────────────────────────────────────────────
class TestStochasticInterruptions:
    def test_hard_eventually_interrupts(self):
        """Over many seeds, at least one hard episode should fire an interruption."""
        fired = False
        for seed in range(50):
            tasks = generate_tasks("hard", seed=seed)
            env   = CLMEnvironment(tasks=tasks, max_steps=50, seed=seed)
            env.reset()
            done = False
            while not done:
                _, _, done, _ = env.step(Action(type="work", task_id=tasks[0].id))
            if env.state.interruption_count > 0:
                fired = True
                break
        assert fired, "Expected at least one interruption across 50 hard seeds"

    def test_interruptions_respect_budget(self):
        """Hard episodes should never exceed budget=2 interruptions."""
        for seed in range(30):
            tasks = generate_tasks("hard", seed=seed)
            env   = CLMEnvironment(tasks=tasks, max_steps=50, seed=seed)
            env.reset()
            done = False
            while not done:
                _, _, done, _ = env.step(Action(type="work", task_id=tasks[0].id))
            assert env.state.interruption_count <= 2, \
                f"Seed {seed}: got {env.state.interruption_count} interruptions, max is 2"

    def test_no_interruptions_on_easy(self):
        for seed in range(10):
            tasks = generate_tasks("easy", seed=seed)
            env   = CLMEnvironment(tasks=tasks, max_steps=50, seed=seed)
            env.reset()
            done = False
            while not done:
                _, _, done, _ = env.step(Action(type="break"))
            assert env.state.interruption_count == 0


# ─────────────────────────────────────────────────────────────────────────────
# Burnout terminates episode
# ─────────────────────────────────────────────────────────────────────────────
class TestBurnout:
    def test_burnout_terminates_episode(self):
        tasks = generate_tasks("easy", seed=0)
        env   = CLMEnvironment(tasks=tasks, max_steps=200)
        env.reset()
        env.state.energy = 0.08   # just above burnout threshold
        done = False
        for _ in range(5):
            _, _, done, info = env.step(Action(type="work", task_id="e1"))
            if done:
                break
        assert done, "Episode should terminate on burnout"

    def test_burnout_applies_penalty(self):
        tasks = generate_tasks("easy", seed=0)
        env   = CLMEnvironment(tasks=tasks, max_steps=200)
        env.reset()
        env.state.energy = 0.08
        rewards = []
        done = False
        for _ in range(5):
            _, r, done, _ = env.step(Action(type="work", task_id="e1"))
            rewards.append(r)
            if done:
                break
        assert any(r <= -0.5 for r in rewards), "Burnout should produce a large negative reward"


# ─────────────────────────────────────────────────────────────────────────────
# Grader score bounds
# ─────────────────────────────────────────────────────────────────────────────
class TestGraderBounds:
    def test_grader_always_in_bounds(self):
        for level in ["easy", "medium", "hard", "expert"]:
            for seed in range(10):
                tasks = generate_tasks(level, seed=seed)
                for frac in [0.0, 0.3, 0.7, 1.0]:
                    for t in tasks:
                        t.progress = frac
                    score = deterministic_grader(tasks, time_step=30, final_energy=0.5)
                    assert 0.01 <= score <= 0.99, \
                        f"Score {score} out of bounds for {level} seed={seed} progress={frac}"

    def test_grader_higher_completion_scores_higher(self):
        tasks_low  = generate_tasks("medium", seed=1)
        tasks_high = generate_tasks("medium", seed=1)
        for t in tasks_low:  t.progress = 0.0
        for t in tasks_high: t.progress = 1.0
        assert deterministic_grader(tasks_high, 30, 0.7) > \
               deterministic_grader(tasks_low,  30, 0.7)


# ─────────────────────────────────────────────────────────────────────────────
# FIX 6 — Partial observability
# ─────────────────────────────────────────────────────────────────────────────
class TestPartialObservability:
    def test_observation_has_no_raw_floats(self):
        env = CLMEnvironment(tasks=generate_tasks("easy", seed=0))
        obs = env.reset()
        vs  = obs.visible_state
        # energy_level and stress float must NOT appear in visible state
        assert not hasattr(vs, "energy_level"), "energy_level float should not be in observation"
        assert isinstance(vs.fatigue_level, str)
        assert isinstance(vs.stress_level, str)

    def test_fatigue_levels_are_valid(self):
        env = CLMEnvironment(tasks=generate_tasks("easy", seed=0))
        env.reset()
        env.state.energy = 0.1   # should be "high" fatigue
        obs = env._get_observation()
        assert obs.visible_state.fatigue_level == "high"
        env.state.energy = 0.5   # "medium"
        assert env._get_observation().visible_state.fatigue_level == "medium"
        env.state.energy = 0.9   # "low"
        assert env._get_observation().visible_state.fatigue_level == "low"

    def test_stress_levels_are_valid(self):
        env = CLMEnvironment(tasks=generate_tasks("easy", seed=0))
        env.reset()
        env.state.stress = 0.8
        assert env._get_observation().visible_state.stress_level == "critical"
        env.state.stress = 0.5
        assert env._get_observation().visible_state.stress_level == "elevated"
        env.state.stress = 0.1
        assert env._get_observation().visible_state.stress_level == "calm"
