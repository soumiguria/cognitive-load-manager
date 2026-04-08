import uuid
from typing import Dict, Any, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from models import Action, Observation, generate_tasks, deterministic_grader, CLMEnvironment

app = FastAPI(title="Cognitive Load Manager (CLM) Environment API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory session store
sessions: Dict[str, CLMEnvironment] = {}

class ResetRequest(BaseModel):
    level: str = "easy"  # easy, medium, hard
    session_id: Optional[str] = None

class ResetResponse(BaseModel):
    session_id: str
    observation: Observation

class StepRequest(BaseModel):
    session_id: str = "default"
    action: Optional[Action] = None

class StepResponse(BaseModel):
    observation: Observation
    reward: float
    done: bool
    info: Dict[str, Any]

@app.get("/")
def read_root():
    routes = []
    for route in app.routes:
        route_info = {"path": route.path, "name": getattr(route, "name", "")}
        if hasattr(route, "methods"):
            route_info["methods"] = list(route.methods)
        routes.append(route_info)
    return {
        "message": "Cognitive Load Manager is running 🚀",
        "routes": routes
    }

@app.post("/reset", response_model=ResetResponse)
def reset_env(req: Optional[ResetRequest] = None):
    if req is None:
        req = ResetRequest()
        
    if req.level not in ["easy", "medium", "hard"]:
        raise HTTPException(status_code=400, detail="Invalid level")
        
    tasks = generate_tasks(req.level)
    env = CLMEnvironment(tasks=tasks, max_steps=50) # Max 50 steps
    obs = env.reset()
    
    sess_id = req.session_id or str(uuid.uuid4())
    sessions[sess_id] = env
    
    return ResetResponse(session_id=sess_id, observation=obs)

@app.post("/step", response_model=StepResponse)
def step_env(req: Optional[StepRequest] = None):
    if req is None:
        req = StepRequest()
    if req.action is None:
        req.action = Action(type="work")
        
    if req.session_id not in sessions:
        tasks = generate_tasks("easy")
        env = CLMEnvironment(tasks=tasks, max_steps=50)
        env.reset()
        sessions[req.session_id] = env
        
    env = sessions[req.session_id]
    obs, reward, done, info = env.step(req.action)
    
    if done:
        score = deterministic_grader(env.state.tasks, env.state.time_step, env.state.energy)
        info["final_score"] = score
        
    return StepResponse(observation=obs, reward=reward, done=done, info=info)

@app.get("/state")
def get_state(session_id: Optional[str] = "default"):
    if session_id is None:
        session_id = "default"
        
    if session_id not in sessions:
        tasks = generate_tasks("easy")
        env = CLMEnvironment(tasks=tasks, max_steps=50)
        env.reset()
        sessions[session_id] = env
        
    return sessions[session_id].state_dict()
