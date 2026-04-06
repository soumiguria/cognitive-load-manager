import React, { useState, useEffect, useRef } from 'react';
import { RefreshCw, Briefcase, Coffee, Clock } from 'lucide-react';

const API_BASE = 'http://localhost:8000';

export default function Dashboard() {
  const [level, setLevel] = useState('medium');
  const [sessionId, setSessionId] = useState(null);
  const [obs, setObs] = useState(null);
  const [stateData, setStateData] = useState(null);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const scrollRef = useRef(null);

  const fetchState = async (sid) => {
    try {
      const res = await fetch(`${API_BASE}/state?session_id=${sid}`);
      if (res.ok) {
        const data = await res.json();
        setStateData(data);
      }
    } catch(e) { console.error("State fetch error", e); }
  };

  const handleReset = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ level })
      });
      const data = await res.json();
      setSessionId(data.session_id);
      setObs(data.observation);
      setLogs([{ type: 'system', msg: `Environment reset: ${level} level` }]);
      await fetchState(data.session_id);
    } catch (err) {
      setError(err.message || "Failed to connect to backend");
    } finally {
      setLoading(false);
    }
  };

  const handleAction = async (actionType, taskId = null) => {
    if (!sessionId) return;
    setLoading(true);
    
    const action = { type: actionType };
    if (taskId) action.task_id = taskId;

    try {
      const res = await fetch(`${API_BASE}/step`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId, action })
      });
      const data = await res.json();
      setObs(data.observation);
      
      let logMsg = `Action: ${actionType}${taskId ? ' ('+taskId+')' : ''} | Reward: ${data.reward.toFixed(2)}`;
      if (data.done) {
        logMsg += ` | DONE. Final Score: ${data.info?.final_score?.toFixed(2) || 'N/A'}`;
      }
      
      setLogs(prev => [...prev, { type: 'action', msg: logMsg, reward: data.reward }]);
      await fetchState(sessionId);
      
      setTimeout(() => {
        if(scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }, 50);
      
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    handleReset();
  }, [level]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 space-y-6">
        <div className="bg-slate-800 p-4 rounded-xl border border-slate-700 flex items-center gap-4">
          <select 
            value={level} 
            onChange={e => setLevel(e.target.value)}
            className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
          >
            <option value="easy">Easy</option>
            <option value="medium">Medium</option>
            <option value="hard">Hard</option>
          </select>
          <button 
            onClick={handleReset} 
            disabled={loading}
            className="flex items-center gap-2 bg-slate-700 hover:bg-slate-600 transition-colors px-4 py-2 rounded-lg text-sm font-medium"
          >
            <RefreshCw size={16} className={loading ? "animate-spin" : ""} /> Reset Env
          </button>
          <div className="ml-auto text-sm text-slate-400">
             Time Step: <span className="font-mono text-white bg-slate-900 px-2 py-1 rounded">{obs?.time_step || 0}</span>
          </div>
          {error && <span className="text-red-400 text-sm ml-4">{error}</span>}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="bg-slate-800 p-5 rounded-xl border border-slate-700 hover:border-slate-600 transition-colors">
            <div className="flex justify-between items-center mb-2">
              <span className="text-slate-400 text-sm">Energy</span>
              <span className="font-bold">{stateData ? (stateData.energy * 100).toFixed(0) : 0}%</span>
            </div>
            <div className="w-full bg-slate-900 rounded-full h-3">
              <div 
                className={`h-3 rounded-full transition-all duration-500 ease-out ${stateData?.energy > 0.5 ? 'bg-emerald-500' : stateData?.energy > 0.2 ? 'bg-amber-500' : 'bg-red-500'}`} 
                style={{ width: `${stateData ? stateData.energy * 100 : 0}%` }}
              ></div>
            </div>
            <div className="mt-3 text-xs text-slate-500 text-right">
              Obs: <span className="text-slate-300 capitalize">{obs?.visible_state?.fatigue_level || 'N/A'}</span>
            </div>
          </div>
          
          <div className="bg-slate-800 p-5 rounded-xl border border-slate-700 hover:border-slate-600 transition-colors">
            <div className="flex justify-between items-center mb-2">
              <span className="text-slate-400 text-sm">Stress</span>
              <span className="font-bold">{stateData ? (stateData.stress * 100).toFixed(0) : 0}%</span>
            </div>
            <div className="w-full bg-slate-900 rounded-full h-3">
              <div 
                className={`h-3 rounded-full transition-all duration-500 ease-out ${stateData?.stress > 0.7 ? 'bg-red-500 w-full animate-pulse' : stateData?.stress > 0.4 ? 'bg-amber-500' : 'bg-emerald-500'}`} 
                style={{ width: `${stateData ? stateData.stress * 100 : 0}%` }}
              ></div>
            </div>
            <div className="mt-3 text-xs text-slate-500 text-right">
              Warning: {obs?.visible_state?.stress_warning ? <span className="text-red-400 font-bold">YES</span> : <span className="text-emerald-400">NO</span>}
            </div>
          </div>
        </div>

        <div className="bg-slate-800 p-5 rounded-xl border border-slate-700">
          <h3 className="text-slate-400 text-sm mb-4">Environment Actions</h3>
          <div className="flex gap-4">
             <button disabled={loading} onClick={() => handleAction('break')} className="flex-1 flex flex-col items-center justify-center p-4 rounded-xl bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/30 text-indigo-400 transition-all hover:scale-105 active:scale-95">
               <Coffee size={24} className="mb-2" />
               <span className="text-sm font-medium">Take Break</span>
             </button>
             <button disabled={loading} onClick={() => handleAction('delay')} className="flex-1 flex flex-col items-center justify-center p-4 rounded-xl bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 transition-all hover:scale-105 active:scale-95">
               <Clock size={24} className="mb-2" />
               <span className="text-sm font-medium">Delay / Idle</span>
             </button>
          </div>
        </div>

        <div className="space-y-4">
          <h2 className="text-lg font-bold flex items-center gap-2 px-1">
            <Briefcase size={20} className="text-indigo-400" /> Active Tasks
          </h2>
          <div className="space-y-3">
            {obs?.tasks?.map(t => {
              const isCurrent = stateData?.current_task_id === t.id;
              const isDone = t.progress >= 1.0;
              const isLate = !isDone && t.deadline && obs.time_step > t.deadline;
              const isUrgent = !isDone && t.deadline && (t.deadline - obs.time_step <= 3) && (t.deadline - obs.time_step >= 0);

              return (
                <div key={t.id} className={`p-4 rounded-xl border transition-all ${isCurrent && !isDone ? 'bg-indigo-900/40 border-indigo-500/50 shadow-[0_0_15px_rgba(99,102,241,0.15)]' : 'bg-slate-800 border-slate-700 hover:border-slate-500'} ${isDone ? 'opacity-50' : ''}`}>
                  <div className="flex justify-between items-start mb-3">
                    <div>
                      <h4 className="font-semibold flex items-center gap-2">
                         {t.id} 
                         {isDone && <span className="text-xs bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded-full">Done</span>}
                         {isLate && <span className="text-xs bg-red-500/20 text-red-400 px-2 py-0.5 rounded-full">Late</span>}
                         {isUrgent && <span className="text-xs bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded-full">Urgent</span>}
                      </h4>
                      <div className="text-xs text-slate-400 mt-1 flex gap-3">
                        <span>Diff: <span className="capitalize text-slate-300">{t.difficulty}</span></span>
                        {t.deadline && <span>Deadline: <span className="font-mono text-slate-300">{t.deadline}</span></span>}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button 
                        onClick={() => handleAction('work', t.id)}
                        disabled={loading || isDone}
                        className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:hover:bg-indigo-600 rounded text-sm font-medium transition-colors shadow-sm"
                      >
                        Work
                      </button>
                      {!isCurrent && (
                        <button 
                          onClick={() => handleAction('switch', t.id)}
                          disabled={loading || isDone}
                          className="px-4 py-1.5 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 disabled:hover:bg-slate-700 rounded text-sm font-medium transition-colors shadow-sm"
                        >
                          Switch
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="w-full bg-slate-900 mb-1 rounded-full h-2 overflow-hidden shadow-inner">
                    <div 
                      className={`h-2 rounded-full transition-all duration-300 ease-out ${isDone ? 'bg-emerald-500' : 'bg-indigo-500'}`} 
                      style={{ width: `${Math.min(100, t.progress * 100)}%` }}
                    ></div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="bg-slate-800 rounded-xl border border-slate-700 flex flex-col h-[calc(100vh-6rem)] sticky top-6 shadow-xl">
        <div className="p-4 border-b border-slate-700 bg-slate-900/50 rounded-t-xl">
          <h3 className="font-bold text-slate-200">Activity Log</h3>
        </div>
        <div className="p-4 overflow-y-auto flex-1 space-y-3 font-mono text-xs" ref={scrollRef}>
          {logs.length === 0 && <div className="text-slate-500 text-center mt-10">No activity yet.</div>}
          {logs.map((log, i) => (
            <div key={i} className={`p-2.5 rounded border ${log.type === 'system' ? 'text-slate-400 border-slate-700/50 bg-slate-800/50' : log.reward > 0 ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' : log.reward < 0 ? 'text-red-400 bg-red-500/10 border-red-500/20' : 'text-slate-300 border-slate-700 bg-slate-800/80'}`}>
              <span className="opacity-40 mr-2">[{i.toString().padStart(3, '0')}]</span>
              {log.msg}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
