from pydantic import BaseModel
from typing import List, Optional, Literal, Tuple, Dict, Any

# ==========================================
# OPENENV SCHEMAS
# ==========================================
class Task(BaseModel):
    id: str
    difficulty: str
    progress: float = 0.0
    deadline: Optional[int] = None

class VisibleState(BaseModel):
    fatigue_level: str
    stress_warning: bool

class Observation(BaseModel):
    tasks: List[Task]
    visible_state: VisibleState
    time_step: int

class Action(BaseModel):
    type: Literal["work", "break", "switch", "delay"]
    task_id: Optional[str] = None

class EnvState(BaseModel):
    energy: float = 1.0
    stress: float = 0.0
    fatigue: float = 0.0
    time_step: int = 0
    current_task_id: Optional[str] = None
    tasks: List[Task] = []


# ==========================================
# ENV HELPER METHODS
# ==========================================
def generate_tasks(level: str) -> list[Task]:
    if level == "easy":
        return [
            Task(id="easy-1", difficulty="easy", progress=0.0, deadline=None),
            Task(id="easy-2", difficulty="easy", progress=0.0, deadline=None)
        ]
    elif level == "medium":
        return [
            Task(id="med-1", difficulty="medium", progress=0.0, deadline=15),
            Task(id="med-2", difficulty="medium", progress=0.0, deadline=20),
            Task(id="med-3", difficulty="medium", progress=0.0, deadline=25),
            Task(id="med-4", difficulty="medium", progress=0.0, deadline=30),
            Task(id="med-5", difficulty="medium", progress=0.0, deadline=35)
        ]
    elif level == "hard":
        return [
            Task(id="hard-1", difficulty="hard", progress=0.0, deadline=10),
            Task(id="hard-2", difficulty="hard", progress=0.0, deadline=12),
            Task(id="hard-3", difficulty="hard", progress=0.0, deadline=15),
            Task(id="hard-4", difficulty="hard", progress=0.0, deadline=18),
            Task(id="hard-5", difficulty="hard", progress=0.0, deadline=22),
            Task(id="hard-6", difficulty="hard", progress=0.0, deadline=25),
            Task(id="hard-7", difficulty="hard", progress=0.0, deadline=28),
            Task(id="hard-8", difficulty="hard", progress=0.0, deadline=35)
        ]
    return []

def deterministic_grader(tasks: list[Task], time_step: int, final_energy: float) -> float:
    """
    A deterministic grader returning 0.0-1.0 based on:
    - completion rate
    - deadline adherence 
    - energy efficiency
    """
    if not tasks:
        return 0.0
        
    completion_rate = sum(t.progress for t in tasks) / len(tasks)
    
    # penalty for missed deadlines
    missed_deadlines = 0
    for t in tasks:
        if t.deadline and time_step > t.deadline and t.progress < 1.0:
            missed_deadlines += 1
            
    deadline_penalty = min(0.3, missed_deadlines * 0.1)
    
    # energy efficiency
    energy_score = max(0.0, (final_energy - 0.1) * 0.2)
    
    score = completion_rate * 0.8 - deadline_penalty + energy_score
    return max(0.0, min(1.0, score))


# ==========================================
# OPENENV ENVIRONMENT IMPLEMENTATION
# ==========================================
class CLMEnvironment:
    def __init__(self, tasks: list[Task], max_steps: int = 50):
        self.max_steps = max_steps
        self.initial_tasks = tasks
        self.state = EnvState(tasks=[t.model_copy() for t in tasks])

    def reset(self) -> Observation:
        self.state = EnvState(tasks=[t.model_copy() for t in self.initial_tasks])
        return self._get_observation()

    def _get_observation(self) -> Observation:
        fatigue_level = "low"
        if self.state.energy < 0.3:
            fatigue_level = "high"
        elif self.state.energy < 0.6:
            fatigue_level = "medium"

        stress_warning = self.state.stress > 0.7

        visible_state = VisibleState(
            fatigue_level=fatigue_level,
            stress_warning=stress_warning
        )

        return Observation(
            tasks=self.state.tasks,
            visible_state=visible_state,
            time_step=self.state.time_step
        )
        
    def step(self, action: Action) -> Tuple[Observation, float, bool, dict]:
        reward = 0.0
        
        # Process Action
        if action.type == "work":
            self.state.energy = max(0.0, self.state.energy - 0.15)  # Working reduces energy
            
            if action.task_id:
                if self.state.current_task_id and self.state.current_task_id != action.task_id:
                    reward -= 0.1  # Unnecessary switching penalty
                self.state.current_task_id = action.task_id
                
            task = next((t for t in self.state.tasks if t.id == self.state.current_task_id), None)
            
            if task and task.progress < 1.0:
                # low energy -> reduced efficiency
                efficiency = self.state.energy if self.state.energy < 0.3 else 1.0
                progress_made = 0.25 * efficiency * (1.0 - self.state.stress)
                task.progress = min(1.0, task.progress + progress_made)
                reward += 0.1  # Progress made
                
        elif action.type == "break":
            self.state.energy = min(1.0, self.state.energy + 0.2)
            self.state.stress = max(0.0, self.state.stress - 0.15)
            
        elif action.type == "switch":
            if action.task_id:
                self.state.current_task_id = action.task_id
                reward -= 0.1
                
        elif action.type == "delay":
            self.state.stress = max(0.0, self.state.stress - 0.05)
            
        self.state.time_step += 1
        
        # Stress mechanics
        pending_tasks = [t for t in self.state.tasks if t.progress < 1.0]
        for t in pending_tasks:
            if t.deadline:
                time_to_deadline = t.deadline - self.state.time_step
                if 0 <= time_to_deadline <= 3:
                    self.state.stress = min(1.0, self.state.stress + 0.1)  # stress increases as deadlines approach
                elif time_to_deadline < 0:
                    self.state.stress = min(1.0, self.state.stress + 0.2)
                    
        # State transitions
        all_completed = all(t.progress >= 1.0 for t in self.state.tasks)
        burnout = self.state.energy < 0.1
        timeout = self.state.time_step >= self.max_steps
        
        done = all_completed or burnout or timeout
        
        if self.state.stress > 0.8:
            reward -= 0.1  # high stress penalty
            
        if done:
            if burnout:
                reward -= 1.0
            elif all_completed:
                late = any(t.deadline and self.state.time_step > t.deadline for t in self.state.tasks)
                if late:
                    reward += 0.5
                else:
                    reward += 1.0
                    
        reward = max(0.0, min(0.99, float(reward)))
                    
        return self._get_observation(), reward, done, self.state.model_dump()
        
    def state_dict(self) -> dict:
        return self.state.model_dump()
