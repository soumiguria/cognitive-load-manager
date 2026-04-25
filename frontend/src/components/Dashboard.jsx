// import React, { useState, useEffect, useRef } from 'react';
// import { RefreshCw, Briefcase, Coffee, Clock } from 'lucide-react';

// const API_BASE = 'http://localhost:8000';

// export default function Dashboard() {
//   const [level, setLevel] = useState('medium');
//   const [sessionId, setSessionId] = useState(null);
//   const [obs, setObs] = useState(null);
//   const [stateData, setStateData] = useState(null);
//   const [logs, setLogs] = useState([]);
//   const [loading, setLoading] = useState(false);
//   const [error, setError] = useState(null);
//   const scrollRef = useRef(null);

//   const fetchState = async (sid) => {
//     try {
//       const res = await fetch(`${API_BASE}/state?session_id=${sid}`);
//       if (res.ok) {
//         const data = await res.json();
//         setStateData(data);
//       }
//     } catch(e) { console.error("State fetch error", e); }
//   };

//   const handleReset = async () => {
//     setLoading(true);
//     setError(null);
//     try {
//       const res = await fetch(`${API_BASE}/reset`, {
//         method: 'POST',
//         headers: { 'Content-Type': 'application/json' },
//         body: JSON.stringify({ level })
//       });
//       const data = await res.json();
//       setSessionId(data.session_id);
//       setObs(data.observation);
//       setLogs([{ type: 'system', msg: `Environment reset: ${level} level` }]);
//       await fetchState(data.session_id);
//     } catch (err) {
//       setError(err.message || "Failed to connect to backend");
//     } finally {
//       setLoading(false);
//     }
//   };

//   const handleAction = async (actionType, taskId = null) => {
//     if (!sessionId) return;
//     setLoading(true);

//     const action = { type: actionType };
//     if (taskId) action.task_id = taskId;

//     try {
//       const res = await fetch(`${API_BASE}/step`, {
//         method: 'POST',
//         headers: { 'Content-Type': 'application/json' },
//         body: JSON.stringify({ session_id: sessionId, action })
//       });
//       const data = await res.json();
//       setObs(data.observation);

//       let logMsg = `Action: ${actionType}${taskId ? ' ('+taskId+')' : ''} | Reward: ${data.reward.toFixed(2)}`;
//       if (data.done) {
//         logMsg += ` | DONE. Final Score: ${data.info?.final_score?.toFixed(2) || 'N/A'}`;
//       }

//       setLogs(prev => [...prev, { type: 'action', msg: logMsg, reward: data.reward }]);
//       await fetchState(sessionId);

//       setTimeout(() => {
//         if(scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
//       }, 50);

//     } catch (err) {
//       setError(err.message);
//     } finally {
//       setLoading(false);
//     }
//   };

//   useEffect(() => {
//     handleReset();
//   }, [level]);

//   return (
//     <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
//       <div className="lg:col-span-2 space-y-6">
//         <div className="bg-slate-800 p-4 rounded-xl border border-slate-700 flex items-center gap-4">
//           <select 
//             value={level} 
//             onChange={e => setLevel(e.target.value)}
//             className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
//           >
//             <option value="easy">Easy</option>
//             <option value="medium">Medium</option>
//             <option value="hard">Hard</option>
//           </select>
//           <button 
//             onClick={handleReset} 
//             disabled={loading}
//             className="flex items-center gap-2 bg-slate-700 hover:bg-slate-600 transition-colors px-4 py-2 rounded-lg text-sm font-medium"
//           >
//             <RefreshCw size={16} className={loading ? "animate-spin" : ""} /> Reset Env
//           </button>
//           <div className="ml-auto text-sm text-slate-400">
//              Time Step: <span className="font-mono text-white bg-slate-900 px-2 py-1 rounded">{obs?.time_step || 0}</span>
//           </div>
//           {error && <span className="text-red-400 text-sm ml-4">{error}</span>}
//         </div>

//         <div className="grid grid-cols-2 gap-4">
//           <div className="bg-slate-800 p-5 rounded-xl border border-slate-700 hover:border-slate-600 transition-colors">
//             <div className="flex justify-between items-center mb-2">
//               <span className="text-slate-400 text-sm">Energy</span>
//               <span className="font-bold">{stateData ? (stateData.energy * 100).toFixed(0) : 0}%</span>
//             </div>
//             <div className="w-full bg-slate-900 rounded-full h-3">
//               <div 
//                 className={`h-3 rounded-full transition-all duration-500 ease-out ${stateData?.energy > 0.5 ? 'bg-emerald-500' : stateData?.energy > 0.2 ? 'bg-amber-500' : 'bg-red-500'}`} 
//                 style={{ width: `${stateData ? stateData.energy * 100 : 0}%` }}
//               ></div>
//             </div>
//             <div className="mt-3 text-xs text-slate-500 text-right">
//               Obs: <span className="text-slate-300 capitalize">{obs?.visible_state?.fatigue_level || 'N/A'}</span>
//             </div>
//           </div>

//           <div className="bg-slate-800 p-5 rounded-xl border border-slate-700 hover:border-slate-600 transition-colors">
//             <div className="flex justify-between items-center mb-2">
//               <span className="text-slate-400 text-sm">Stress</span>
//               <span className="font-bold">{stateData ? (stateData.stress * 100).toFixed(0) : 0}%</span>
//             </div>
//             <div className="w-full bg-slate-900 rounded-full h-3">
//               <div 
//                 className={`h-3 rounded-full transition-all duration-500 ease-out ${stateData?.stress > 0.7 ? 'bg-red-500 w-full animate-pulse' : stateData?.stress > 0.4 ? 'bg-amber-500' : 'bg-emerald-500'}`} 
//                 style={{ width: `${stateData ? stateData.stress * 100 : 0}%` }}
//               ></div>
//             </div>
//             <div className="mt-3 text-xs text-slate-500 text-right">
//               Warning: {obs?.visible_state?.stress_warning ? <span className="text-red-400 font-bold">YES</span> : <span className="text-emerald-400">NO</span>}
//             </div>
//           </div>
//         </div>

//         <div className="bg-slate-800 p-5 rounded-xl border border-slate-700">
//           <h3 className="text-slate-400 text-sm mb-4">Environment Actions</h3>
//           <div className="flex gap-4">
//              <button disabled={loading} onClick={() => handleAction('break')} className="flex-1 flex flex-col items-center justify-center p-4 rounded-xl bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/30 text-indigo-400 transition-all hover:scale-105 active:scale-95">
//                <Coffee size={24} className="mb-2" />
//                <span className="text-sm font-medium">Take Break</span>
//              </button>
//              <button disabled={loading} onClick={() => handleAction('delay')} className="flex-1 flex flex-col items-center justify-center p-4 rounded-xl bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 transition-all hover:scale-105 active:scale-95">
//                <Clock size={24} className="mb-2" />
//                <span className="text-sm font-medium">Delay / Idle</span>
//              </button>
//           </div>
//         </div>

//         <div className="space-y-4">
//           <h2 className="text-lg font-bold flex items-center gap-2 px-1">
//             <Briefcase size={20} className="text-indigo-400" /> Active Tasks
//           </h2>
//           <div className="space-y-3">
//             {obs?.tasks?.map(t => {
//               const isCurrent = stateData?.current_task_id === t.id;
//               const isDone = t.progress >= 1.0;
//               const isLate = !isDone && t.deadline && obs.time_step > t.deadline;
//               const isUrgent = !isDone && t.deadline && (t.deadline - obs.time_step <= 3) && (t.deadline - obs.time_step >= 0);

//               return (
//                 <div key={t.id} className={`p-4 rounded-xl border transition-all ${isCurrent && !isDone ? 'bg-indigo-900/40 border-indigo-500/50 shadow-[0_0_15px_rgba(99,102,241,0.15)]' : 'bg-slate-800 border-slate-700 hover:border-slate-500'} ${isDone ? 'opacity-50' : ''}`}>
//                   <div className="flex justify-between items-start mb-3">
//                     <div>
//                       <h4 className="font-semibold flex items-center gap-2">
//                          {t.id} 
//                          {isDone && <span className="text-xs bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded-full">Done</span>}
//                          {isLate && <span className="text-xs bg-red-500/20 text-red-400 px-2 py-0.5 rounded-full">Late</span>}
//                          {isUrgent && <span className="text-xs bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded-full">Urgent</span>}
//                       </h4>
//                       <div className="text-xs text-slate-400 mt-1 flex gap-3">
//                         <span>Diff: <span className="capitalize text-slate-300">{t.difficulty}</span></span>
//                         {t.deadline && <span>Deadline: <span className="font-mono text-slate-300">{t.deadline}</span></span>}
//                       </div>
//                     </div>
//                     <div className="flex gap-2">
//                       <button 
//                         onClick={() => handleAction('work', t.id)}
//                         disabled={loading || isDone}
//                         className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:hover:bg-indigo-600 rounded text-sm font-medium transition-colors shadow-sm"
//                       >
//                         Work
//                       </button>
//                       {!isCurrent && (
//                         <button 
//                           onClick={() => handleAction('switch', t.id)}
//                           disabled={loading || isDone}
//                           className="px-4 py-1.5 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 disabled:hover:bg-slate-700 rounded text-sm font-medium transition-colors shadow-sm"
//                         >
//                           Switch
//                         </button>
//                       )}
//                     </div>
//                   </div>
//                   <div className="w-full bg-slate-900 mb-1 rounded-full h-2 overflow-hidden shadow-inner">
//                     <div 
//                       className={`h-2 rounded-full transition-all duration-300 ease-out ${isDone ? 'bg-emerald-500' : 'bg-indigo-500'}`} 
//                       style={{ width: `${Math.min(100, t.progress * 100)}%` }}
//                     ></div>
//                   </div>
//                 </div>
//               );
//             })}
//           </div>
//         </div>
//       </div>

//       <div className="bg-slate-800 rounded-xl border border-slate-700 flex flex-col h-[calc(100vh-6rem)] sticky top-6 shadow-xl">
//         <div className="p-4 border-b border-slate-700 bg-slate-900/50 rounded-t-xl">
//           <h3 className="font-bold text-slate-200">Activity Log</h3>
//         </div>
//         <div className="p-4 overflow-y-auto flex-1 space-y-3 font-mono text-xs" ref={scrollRef}>
//           {logs.length === 0 && <div className="text-slate-500 text-center mt-10">No activity yet.</div>}
//           {logs.map((log, i) => (
//             <div key={i} className={`p-2.5 rounded border ${log.type === 'system' ? 'text-slate-400 border-slate-700/50 bg-slate-800/50' : log.reward > 0 ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' : log.reward < 0 ? 'text-red-400 bg-red-500/10 border-red-500/20' : 'text-slate-300 border-slate-700 bg-slate-800/80'}`}>
//               <span className="opacity-40 mr-2">[{i.toString().padStart(3, '0')}]</span>
//               {log.msg}
//             </div>
//           ))}
//         </div>
//       </div>
//     </div>
//   );
// }


import React, { useState, useEffect, useRef, useCallback } from 'react';

const API_BASE = 'http://localhost:7860';

/* ── helpers ─────────────────────────────────────────────── */
const fmt2 = n => (+(n ?? 0)).toFixed(2);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/* ── seed data (shown before backend connects) ───────────── */
/* ── empty starting constants ───────────── */
const SEED_TASKS = [];
const SEED_TRAINED = [0.30, 0.31, 0.35, 0.39, 0.45, 0.51, 0.60, 0.66, 0.73, 0.78, 0.82, 0.85, 0.86, 0.87, 0.88];
const SEED_EPISODE = 15;
const AGENT_MSGS = [
  { from: 'manager', text: 'Simulating multi-agent layer. Manager checks stress levels and issues system prompts dynamically to keep the LLM worker aligned.' },
  { from: 'env', text: 'This demo environment is connected to the fully functional FastAPI backend. You can manually execute steps.' }
];
const DRIFT_EVENTS = [];
const ACTION_LOG = [];

/* ── priority badge colours ──────────────────────────────── */
const PRIORITY_STYLE = {
  critical: { bg: '#fef2f2', color: '#dc2626', border: '#fecaca' },
  high: { bg: '#fff7ed', color: '#c2410c', border: '#fed7aa' },
  blocked: { bg: '#f1f5f9', color: '#64748b', border: '#cbd5e1' },
  normal: { bg: '#f0fdf4', color: '#15803d', border: '#bbf7d0' },
  medium: { bg: '#fff7ed', color: '#b45309', border: '#fde68a' },
};

const PROGRESS_COLOR = {
  critical: '#dc2626', high: '#f97316', blocked: '#94a3b8', normal: '#22c55e', medium: '#f59e0b',
};

/* ── reward curve SVG ────────────────────────────────────── */
function RewardCurve({ trained = SEED_TRAINED, episode = SEED_EPISODE }) {
  const W = 560, H = 160, pL = 36, pB = 28, pR = 16, pT = 12;
  const cW = W - pL - pR, cH = H - pT - pB;
  const BASELINE = 0.30;
  const yS = v => pT + cH - clamp((v / 1.0) * cH, 0, cH);
  const xS = (i, len) => pL + (i / Math.max(len - 1, 1)) * cW;
  const pts = trained.map((v, i) => `${xS(i, trained.length)},${yS(v)}`).join(' ');
  const ticks = [0, 0.2, 0.4, 0.6, 0.8, 1.0];
  const epLabels = ['ep 1', `ep ${Math.round(episode / 2)}`, `ep ${episode}`];

  return (
    <div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block' }}>
        {/* grid lines */}
        {ticks.map(v => (
          <g key={v}>
            <line x1={pL} y1={yS(v)} x2={W - pR} y2={yS(v)} stroke="#e2e8f0" strokeWidth={1} />
            <text x={pL - 4} y={yS(v) + 3.5} fill="#94a3b8" fontSize={9} textAnchor="end">{v.toFixed(1)}</text>
          </g>
        ))}
        {/* baseline dashed */}
        <line x1={pL} y1={yS(BASELINE)} x2={W - pR} y2={yS(BASELINE)}
          stroke="#f87171" strokeWidth={1.5} strokeDasharray="5 4" />
        {/* baseline end label */}
        <circle cx={W - pR} cy={yS(BASELINE)} r={4} fill="#f87171" />

        {/* trained area */}
        {trained.length > 1 && <>
          <defs>
            <linearGradient id="tGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#22c55e" stopOpacity="0.18" />
              <stop offset="100%" stopColor="#22c55e" stopOpacity="0.02" />
            </linearGradient>
          </defs>
          <polygon
            points={`${pL},${yS(0)} ${pts} ${xS(trained.length - 1, trained.length)},${yS(0)}`}
            fill="url(#tGrad)" />
          <polyline points={pts} fill="none" stroke="#22c55e" strokeWidth={2.5}
            strokeLinecap="round" strokeLinejoin="round" />
          <circle cx={xS(trained.length - 1, trained.length)} cy={yS(trained[trained.length - 1])} r={5}
            fill="#22c55e" stroke="#fff" strokeWidth={2} />
        </>}

        {/* x axis labels */}
        {epLabels.map((label, i) => {
          const x = pL + (i / 2) * cW;
          return <text key={i} x={x} y={H - 4} fill="#94a3b8" fontSize={9} textAnchor="middle">{label}</text>;
        })}
      </svg>
      {/* legend */}
      <div style={{ display: 'flex', gap: 20, marginTop: 4, paddingLeft: pL }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#64748b' }}>
          <svg width={24} height={8}><line x1={0} y1={4} x2={24} y2={4} stroke="#f87171" strokeWidth={1.5} strokeDasharray="4 3" /></svg>
          Baseline (untrained)
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#64748b' }}>
          <svg width={24} height={8}><line x1={0} y1={4} x2={24} y2={4} stroke="#22c55e" strokeWidth={2.5} /></svg>
          GRPO trained agent
        </div>
      </div>
    </div>
  );
}

/* ── main dashboard ──────────────────────────────────────── */
export default function Dashboard() {
  const [level, setLevel] = useState('hard');
  const [targetWorker, setTargetWorker] = useState('w1');
  const [episode, setEpisode] = useState(SEED_EPISODE);
  const [step, setStep] = useState(0);
  const [maxStep, setMaxStep] = useState(50);
  const [workers, setWorkers] = useState([
    { id: 'w1', energy: 1.0, stress: 0.0, expertise: 'analytical' },
    { id: 'w2', energy: 1.0, stress: 0.0, expertise: 'social' },
    { id: 'w3', energy: 1.0, stress: 0.0, expertise: 'analytical' }
  ]);
  const [epReward, setEpReward] = useState(0.0);
  const [tasks, setTasks] = useState(SEED_TASKS);
  const [trained, setTrained] = useState(SEED_TRAINED);
  const [agentMsgs, setAgentMsgs] = useState(AGENT_MSGS);
  const [actionLog, setActionLog] = useState(ACTION_LOG);
  const [schemaDrifts, setSchemaDrifts] = useState(DRIFT_EVENTS);
  const [sessionId, setSessionId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [liveMode, setLiveMode] = useState(false);
  const [error, setError] = useState(null);
  const logRef = useRef(null);

  const doneTasks = tasks.filter(t => t.progress >= 1).length;
  const blockedCount = tasks.filter(t => t.priority === 'blocked').length;
  const overdueCount = tasks.filter(t => t.priority === 'critical' && t.progress < 1).length;

  /* ── backend integration ── */
  const handleReset = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch(`${API_BASE}/reset`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task_id: level }),
      });
      if (!res.ok) throw new Error('Server error');
      const data = await res.json();
      const obs = data.observation || data;
      setSessionId('active');
      setStep(obs.time_step ?? 0);
      setMaxStep(level === 'expert' ? 60 : 50);
      if (obs.workers) setWorkers(obs.workers);
      setEpReward(0.0);
      setEpisode(e => e + 1);
      setLiveMode(true);
      setAgentMsgs([{ from: 'env', text: `Episode reset · ${level} difficulty · Oracle Manager managing 3 FTEs` }]);
      setSchemaDrifts([]);
      setActionLog([]);
      if (obs.tasks) {
        setTasks(obs.tasks.map(t => ({
          id: t.id, name: t.task_type || t.id, deadline: t.deadline ? `step ${t.deadline}` : 'None',
          deps: t.depends_on ? `deps on ${t.depends_on}` : 'no deps', priority: t.priority || 'normal', progress: t.progress || 0, icon: '📋'
        })));
      }
    } catch (e) {
      setError('Backend offline');
      setLiveMode(false);
    } finally { setLoading(false); }
  }, [level]);

  const doAction = useCallback(async (type, taskId = null) => {
    if (!sessionId) { setError('Reset first'); return; }
    setLoading(true);
    const action = { type, worker_id: targetWorker, ...(taskId ? { task_id: taskId } : {}) };
    try {
      const res = await fetch(`${API_BASE}/step`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      const r = data.reward ?? 0;
      const obs = data.observation || data;
      const newStep = obs.time_step ?? step + 1;
      
      setStep(newStep);
      setEpReward(prev => +(prev + r).toFixed(3));
      
      if (obs.workers) setWorkers(obs.workers);
      
      if (obs.schema_drift) {
         setSchemaDrifts(prev => [...prev, obs.schema_drift]);
      }
      
      if (obs.tasks) {
        setTasks(obs.tasks.map(t => ({
          id: t.id, name: t.task_type || t.id, deadline: t.deadline ? `step ${t.deadline}` : 'None',
          deps: t.depends_on ? `deps on ${t.depends_on}` : 'no deps', priority: t.priority || 'normal', progress: t.progress || 0, icon: '📋'
        })));
      }
      
      const logEntry = {
        step: `s${newStep}`, action: type, detail: taskId ?? '—',
        reward: (r >= 0 ? '+' : '') + fmt2(r), pos: r >= 0
      };
      setActionLog(prev => [logEntry, ...prev].slice(0, 30));
      
      if (data.done) {
        const fs = obs.final_score ?? 0;
        setTrained(prev => [...prev, fs]);
        setAgentMsgs(prev => [...prev, { from: 'env', text: `Episode done · final score ${fmt2(fs)}` }]);
      }
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [sessionId, step, workers, targetWorker]);

  useEffect(() => {
    handleReset();
  }, [handleReset]);

  /* ── level badge colour ── */
  const LEVEL_STYLE = {
    easy: { bg: '#dcfce7', c: '#15803d' }, medium: { bg: '#fef3c7', c: '#b45309' },
    hard: { bg: '#fee2e2', c: '#dc2626' }, expert: { bg: '#f3e8ff', c: '#7c3aed' }
  };
  const lvl = LEVEL_STYLE[level] || LEVEL_STYLE.hard;

  return (
    <div style={{
      fontFamily: "'DM Sans', 'Helvetica Neue', Arial, sans-serif",
      background: '#f8fafc', minHeight: '100vh', padding: '0 0 32px 0',
      color: '#1e293b',
    }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet" />

      {/* ── TOP NAV ── */}
      <div style={{
        background: '#fff', borderBottom: '1px solid #e2e8f0',
        padding: '0 24px', height: 48, display: 'flex', alignItems: 'center', gap: 16,
        position: 'sticky', top: 0, zIndex: 10,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 20, height: 20, borderRadius: 6, background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontSize: 11 }}>🧠</span>
          </div>
          <span style={{ fontWeight: 700, fontSize: 15, color: '#0f172a', letterSpacing: '-0.02em' }}>StressTest</span>
        </div>

        <Pill color="#22c55e" label="Live" />
        <Pill color="#6366f1" label="Training" />
        <Pill color="#f59e0b" label={`Episode ${episode}`} />

        {error && <span style={{ fontSize: 11, color: '#ef4444', marginLeft: 4 }}>{error}</span>}

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
          <select value={targetWorker} onChange={e => setTargetWorker(e.target.value)}
            style={{
              fontSize: 12, border: '1px solid #e2e8f0', borderRadius: 6, padding: '4px 10px',
              background: '#f8fafc', color: '#1e293b', outline: 'none', cursor: 'pointer', fontWeight: 600
            }}>
            <option value="w1">🎯 Assign to Employee 1</option>
            <option value="w2">🎯 Assign to Employee 2</option>
            <option value="w3">🎯 Assign to Employee 3</option>
          </select>
          <select value={level} onChange={e => { setLevel(e.target.value) }}
            style={{
              fontSize: 12, border: '1px solid #e2e8f0', borderRadius: 6, padding: '4px 10px',
              background: '#fff', color: '#1e293b', outline: 'none', cursor: 'pointer'
            }}>
            {['easy', 'medium', 'hard', 'expert'].map(l => <option key={l}>{l}</option>)}
          </select>
          <button onClick={handleReset} disabled={loading} style={{
            fontSize: 12, border: '1px solid #e2e8f0', borderRadius: 6, padding: '4px 12px',
            background: loading ? '#f1f5f9' : '#fff', color: '#64748b', cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 5,
          }}>
            <span style={{ display: 'inline-block', animation: loading ? 'spin 1s linear infinite' : 'none' }}>↻</span> Reset
          </button>
          <span style={{ fontSize: 12, color: '#64748b' }}>
            Step <b style={{ color: '#0f172a', fontFamily: 'DM Mono,monospace' }}>{step} / {maxStep}</b>
          </span>
          <div style={{
            background: lvl.bg, color: lvl.c, fontSize: 11, fontWeight: 700,
            padding: '3px 10px', borderRadius: 6, letterSpacing: '0.04em', textTransform: 'capitalize',
          }}>{level}</div>
        </div>
      </div>

      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* ── ROW 1: 3 FTEs + overall stats ── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 14 }}>
          {(workers || []).map(w => {
             const wid = w?.id || 'w?';
             const wexp = w?.expertise || 'none';
             const weng = w?.energy ?? 0;
             const wstress = w?.stress ?? 0;
             return (
               <StatCard key={wid}
                 label={`Employee ${wid.replace('w','')} (${wexp.charAt(0).toUpperCase() + wexp.slice(1)})`}
                 value={`Energy: ${(weng * 100).toFixed(0)}%`}
                 sub={wstress > 0.65 ? 'Elevated Stress Level' : (weng < 0.35 ? 'High Fatigue' : `Stress: ${(wstress * 100).toFixed(0)}%`)}
                 bar={weng} barColor={weng > 0.5 ? '#22c55e' : weng > 0.25 ? '#f59e0b' : '#ef4444'}
               />
             );
          })}
          <StatCard
            label="Episode reward"
            value={(epReward >= 0 ? '+' : '') + epReward.toFixed(2)}
            valueColor={epReward >= 0 ? '#22c55e' : '#ef4444'}
            sub={`vs baseline 0.30`}
          />
          <StatCard
            label="Tasks done"
            value={`${doneTasks} / ${tasks.length}`}
            sub={`${blockedCount} blocked, ${overdueCount} overdue`}
            bar={doneTasks / Math.max(tasks.length, 1)} barColor="#6366f1"
          />
        </div>

        {/* ── ROW 2: task queue + reward curve ── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>

          {/* task queue */}
          <Card label="TASK QUEUE">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {tasks.map(t => {
                const ps = PRIORITY_STYLE[t.priority] || PRIORITY_STYLE.normal;
                const pc = PROGRESS_COLOR[t.priority] || '#6366f1';
                return (
                  <div key={t.id} style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '9px 4px', borderBottom: '1px solid #f1f5f9',
                  }}>
                    {/* icon */}
                    <div style={{
                      width: 30, height: 30, borderRadius: 8, background: '#f8fafc', border: '1px solid #e2e8f0',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0
                    }}>
                      {t.icon}
                    </div>
                    {/* name + sub */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {t.name}
                      </div>
                      <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 1 }}>
                        {t.deadline && <span>{t.deadline} · </span>}
                        {t.deps || ''}
                      </div>
                    </div>
                    {/* priority badge */}
                    <div style={{
                      background: ps.bg, color: ps.color, border: `1px solid ${ps.border}`,
                      fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 5,
                      flexShrink: 0, textTransform: 'capitalize',
                    }}>{t.priority}</div>
                    {/* progress bar + pct */}
                    <div style={{ width: 80, flexShrink: 0 }}>
                      <div style={{ height: 4, background: '#e2e8f0', borderRadius: 99, overflow: 'hidden', marginBottom: 3 }}>
                        <div style={{
                          width: `${clamp(t.progress * 100, 0, 100)}%`, height: '100%',
                          background: pc, borderRadius: 99, transition: 'width 0.4s ease'
                        }} />
                      </div>
                      <div style={{ fontSize: 10, color: '#94a3b8', textAlign: 'right' }}>
                        {(t.progress * 100).toFixed(0)}%
                      </div>
                    </div>
                    {/* action buttons */}
                    {t.priority !== 'blocked' && t.progress < 1 && (
                      <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                        <TinyBtn label="Work" onClick={() => doAction('work', t.id)} disabled={loading} color="#6366f1" />
                        <TinyBtn label="Focus" onClick={() => doAction('focus', t.id)} disabled={loading} color="#8b5cf6" />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {/* global actions */}
            <div style={{ display: 'flex', gap: 8, marginTop: 12, paddingTop: 12, borderTop: '1px solid #f1f5f9' }}>
              <TinyBtn label="☕ Break" onClick={() => doAction('break')} disabled={loading} color="#0891b2" wide />
              <TinyBtn label="⏸ Idle" onClick={() => doAction('delay')} disabled={loading} color="#64748b" wide />
            </div>
          </Card>

          {/* reward curve */}
          <Card label="REWARD CURVE — TRAINED VS BASELINE">
            <RewardCurve trained={trained} episode={episode} />
          </Card>
        </div>

        {/* ── ROW 3: multi-agent + schema drift + action log ── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>

          {/* multi-agent comms */}
          <Card label="MULTI-AGENT COMMUNICATION">
            {/* agent pills */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <AgentPill color="#6366f1" label="Manager agent" />
              <AgentPill color="#22c55e" label="Worker agent" />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {agentMsgs.map((m, i) => {
                const isManager = m.from === 'manager';
                const isEnv = m.from === 'env';
                return (
                  <div key={i} style={{
                    background: isManager ? '#eff6ff' : isEnv ? '#f8fafc' : '#f0fdf4',
                    border: `1px solid ${isManager ? '#bfdbfe' : isEnv ? '#e2e8f0' : '#bbf7d0'}`,
                    borderRadius: 8, padding: '8px 12px',
                  }}>
                    <div style={{
                      fontSize: 9, fontWeight: 700, color: isManager ? '#6366f1' : isEnv ? '#94a3b8' : '#22c55e',
                      marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.06em'
                    }}>
                      {isManager ? 'Manager → Worker' : isEnv ? 'Env → Both' : 'Worker → Env'}
                    </div>
                    <div style={{ fontSize: 11, color: '#334155', lineHeight: 1.5 }}>{m.text}</div>
                  </div>
                );
              })}
            </div>
          </Card>

          {/* schema drift + action log stacked */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Card label="SCHEMA DRIFT EVENTS">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {schemaDrifts.map((e, i) => (
                  <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    <div style={{
                      width: 10, height: 10, borderRadius: '50%', flexShrink: 0, marginTop: 3,
                      background: e.dot === 'green' ? '#22c55e' : e.dot === 'orange' ? '#f59e0b' : '#cbd5e1',
                    }} />
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: '#0f172a' }}>{e.title}</div>
                      <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 1 }}>triggered at step {e.step}</div>
                    </div>
                  </div>
                ))}
                {schemaDrifts.length === 0 && (
                  <div style={{ fontSize: 11, color: '#cbd5e1', textAlign: 'center', padding: '10px 0' }}>No drift events yet</div>
                )}
              </div>
            </Card>

            <Card label="STEP ACTION LOG" style={{ flex: 1 }}>
              <div ref={logRef} style={{ maxHeight: 200, overflowY: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <tbody>
                    {actionLog.map((row, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '5px 6px', fontSize: 10, fontFamily: 'DM Mono,monospace', color: '#94a3b8', width: 28 }}>{row.step}</td>
                        <td style={{
                          padding: '5px 6px', fontSize: 10, fontWeight: 600,
                          color: row.action === 'focus' ? '#6366f1' : row.action === 'work' ? '#0891b2' :
                            row.action === 'break' ? '#22c55e' : row.action === 'switch' ? '#f59e0b' : '#94a3b8',
                          width: 44
                        }}>{row.action}</td>
                        <td style={{ padding: '5px 6px', fontSize: 10, color: '#64748b', flex: 1 }}>{row.detail}</td>
                        <td style={{
                          padding: '5px 6px', fontSize: 10, fontFamily: 'DM Mono,monospace', fontWeight: 600,
                          color: row.pos ? '#22c55e' : '#ef4444', textAlign: 'right', width: 44
                        }}>{row.reward}</td>
                      </tr>
                    ))}
                    {actionLog.length === 0 && (
                      <tr><td colSpan={4} style={{ padding: '16px 0', textAlign: 'center', fontSize: 11, color: '#cbd5e1' }}>No actions yet</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width:4px; height:4px; }
        ::-webkit-scrollbar-track { background:#f1f5f9; }
        ::-webkit-scrollbar-thumb { background:#cbd5e1; border-radius:99px; }
      `}</style>
    </div>
  );
}

/* ── small atoms ─────────────────────────────────────────── */
function Pill({ color, label }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 5,
      fontSize: 12, color, fontWeight: 500,
    }}>
      <div style={{ width: 7, height: 7, borderRadius: '50%', background: color }} />
      {label}
    </div>
  );
}

function AgentPill({ color, label }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6,
      border: '1px solid #e2e8f0', borderRadius: 99,
      padding: '4px 10px', fontSize: 11, color: '#334155',
    }}>
      <div style={{ width: 8, height: 8, borderRadius: '50%', background: color }} />
      {label}
    </div>
  );
}

function TinyBtn({ label, onClick, disabled, color, wide }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      fontSize: 11, fontWeight: 600,
      padding: wide ? '5px 14px' : '4px 9px',
      background: `${color}10`,
      border: `1px solid ${color}30`,
      borderRadius: 6, color,
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.5 : 1,
      transition: 'all 0.15s',
      whiteSpace: 'nowrap',
    }}>{label}</button>
  );
}

function Card({ label, children, style = {} }) {
  return (
    <div style={{
      background: '#fff',
      border: '1px solid #e8ecf0',
      borderRadius: 12,
      padding: '16px 18px',
      ...style,
    }}>
      <div style={{
        fontSize: 10, fontWeight: 700, color: '#94a3b8',
        letterSpacing: '0.1em', textTransform: 'uppercase',
        marginBottom: 14,
      }}>{label}</div>
      {children}
    </div>
  );
}

function StatCard({ label, value, sub, bar, barColor, valueColor }) {
  return (
    <div style={{
      background: '#fff', border: '1px solid #e8ecf0', borderRadius: 12, padding: '16px 18px',
    }}>
      <div style={{
        fontSize: 10, fontWeight: 700, color: '#94a3b8', letterSpacing: '0.1em',
        textTransform: 'uppercase', marginBottom: 8
      }}>{label}</div>
      <div style={{
        fontSize: 28, fontWeight: 700, color: valueColor || '#0f172a',
        letterSpacing: '-0.03em', lineHeight: 1, marginBottom: 8, fontFamily: 'DM Mono,monospace'
      }}>
        {value}
      </div>
      {bar !== undefined && (
        <div style={{ height: 4, background: '#f1f5f9', borderRadius: 99, overflow: 'hidden', marginBottom: 6 }}>
          <div style={{
            width: `${clamp(bar * 100, 0, 100)}%`, height: '100%',
            background: barColor, borderRadius: 99, transition: 'width 0.5s ease'
          }} />
        </div>
      )}
      <div style={{ fontSize: 11, color: '#94a3b8' }}>{sub}</div>
    </div>
  );
}