import React, { useState, useEffect, useRef } from 'react';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:7860';

export default function Dashboard() {
  const [level, setLevel] = useState('medium');
  const [sessionId, setSessionId] = useState(null);
  const [obs, setObs] = useState(null);
  const [stateData, setStateData] = useState(null);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [rewardHistory, setRewardHistory] = useState([]);
  const scrollRef = useRef(null);

  const fetchState = async (sid) => {
    try {
      const res = await fetch(`${API_BASE}/state?session_id=${sid}`);
      if (res.ok) setStateData(await res.json());
    } catch(e) { console.error(e); }
  };

  const handleReset = async () => {
    setLoading(true);
    setError(null);
    setRewardHistory([]);
    try {
      const res = await fetch(`${API_BASE}/reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task_id: level })
      });
      const data = await res.json();
      setSessionId(data.session_id);
      setObs(data.observation);
      setLogs([{ type: 'system', msg: `Episode started: ${level}` }]);
      await fetchState(data.session_id);
    } catch (err) {
      setError('Cannot reach backend at ' + API_BASE);
    } finally { setLoading(false); }
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
      setRewardHistory(prev => [...prev, {
        step: prev.length + 1,
        reward: data.reward
      }]);
      setLogs(prev => [...prev, {
        type: data.reward >= 0 ? 'positive' : 'negative',
        msg: `${actionType}${taskId ? ' '+taskId : ''} → reward: ${data.reward?.toFixed(3)}`,
        reward: data.reward
      }]);
      if (data.done) {
        setLogs(prev => [...prev, {
          type: 'system',
          msg: `DONE. Final score: ${data.info?.final_score?.toFixed(3) || 'N/A'}`
        }]);
      }
      await fetchState(sessionId);
      setTimeout(() => {
        if(scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }, 50);
    } catch (err) {
      setError(err.message);
    } finally { setLoading(false); }
  };

  const workers = obs?.visible_state?.workers || [];
  const tasks = obs?.tasks || [];
  const firstWorker = workers[0] || {};

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', fontFamily: 'system-ui, sans-serif', padding: 24 }}>
      
      {/* HEADER */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#0f172a', margin: 0 }}>
            🧠 StressTest — Cognitive Load Manager
          </h1>
          <p style={{ fontSize: 12, color: '#64748b', margin: '4px 0 0' }}>
            Multi-Agent RL Environment · Meta OpenEnv Hackathon
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select value={level} onChange={e => setLevel(e.target.value)}
            style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: '6px 10px', fontSize: 13 }}>
            <option value="easy">Easy</option>
            <option value="medium">Medium</option>
            <option value="hard">Hard</option>
            <option value="expert">Expert</option>
          </select>
          <button onClick={handleReset} disabled={loading}
            style={{ background: '#6366f1', color: '#fff', border: 'none', borderRadius: 8,
              padding: '8px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            {loading ? 'Loading...' : sessionId ? '↺ Reset' : '▶ Start'}
          </button>
        </div>
      </div>

      {error && (
        <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8,
          padding: '10px 14px', marginBottom: 16, fontSize: 13, color: '#dc2626' }}>
          ⚠️ {error}
        </div>
      )}

      {/* WORKER METRICS */}
      {workers.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
          {[
            { label: 'Fatigue', value: firstWorker.fatigue_level || '—',
              color: firstWorker.fatigue_level === 'high' ? '#ef4444' : firstWorker.fatigue_level === 'medium' ? '#f59e0b' : '#22c55e' },
            { label: 'Stress', value: firstWorker.stress_level || '—',
              color: firstWorker.stress_level === 'critical' ? '#ef4444' : firstWorker.stress_level === 'elevated' ? '#f59e0b' : '#22c55e' },
            { label: 'Step', value: obs?.time_step ?? '—', color: '#6366f1' },
            { label: 'Tasks Done', value: tasks.filter(t => t.progress >= 1.0).length + '/' + tasks.length, color: '#0ea5e9' },
          ].map(m => (
            <div key={m.label} style={{ background: '#fff', border: '1px solid #e2e8f0',
              borderRadius: 12, padding: '14px 16px', textAlign: 'center' }}>
              <div style={{ fontSize: 10, color: '#94a3b8', textTransform: 'uppercase',
                letterSpacing: '0.08em', marginBottom: 6 }}>{m.label}</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: m.color }}>{m.value}</div>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        
        {/* TASK LIST */}
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase',
            letterSpacing: '0.08em', marginBottom: 12 }}>Task Queue</div>
          {tasks.length === 0 && (
            <div style={{ color: '#cbd5e1', fontSize: 13, textAlign: 'center', padding: 20 }}>
              Press Start to begin episode
            </div>
          )}
          {tasks.map(task => (
            <div key={task.id} style={{ display: 'flex', alignItems: 'center', gap: 10,
              padding: '8px 0', borderBottom: '1px solid #f1f5f9' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: '#0f172a' }}>
                  {task.task_type} <span style={{ fontSize: 10, color: '#94a3b8' }}>#{task.id}</span>
                </div>
                <div style={{ fontSize: 11, color: '#94a3b8' }}>
                  deadline: {task.deadline ?? '—'} · {task.depends_on ? `depends: ${task.depends_on}` : 'no dep'}
                </div>
                <div style={{ height: 3, background: '#f1f5f9', borderRadius: 99, marginTop: 4, overflow: 'hidden' }}>
                  <div style={{ width: `${task.progress * 100}%`, height: '100%',
                    background: task.progress >= 1 ? '#22c55e' : '#6366f1', borderRadius: 99 }} />
                </div>
              </div>
              <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 99, fontWeight: 600,
                background: task.priority === 'critical' ? '#fef2f2' : task.priority === 'high' ? '#fffbeb' : '#f0fdf4',
                color: task.priority === 'critical' ? '#dc2626' : task.priority === 'high' ? '#d97706' : '#16a34a' }}>
                {task.priority}
              </span>
              <div style={{ display: 'flex', gap: 4 }}>
                {sessionId && task.progress < 1.0 && (
                  <>
                    <button onClick={() => handleAction('work', task.id)}
                      style={{ fontSize: 10, padding: '3px 8px', borderRadius: 6, border: '1px solid #e2e8f0',
                        background: '#f8fafc', cursor: 'pointer' }}>work</button>
                    <button onClick={() => handleAction('focus', task.id)}
                      style={{ fontSize: 10, padding: '3px 8px', borderRadius: 6, border: '1px solid #6366f1',
                        background: '#eef2ff', color: '#6366f1', cursor: 'pointer' }}>focus</button>
                  </>
                )}
              </div>
            </div>
          ))}
          {sessionId && (
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button onClick={() => handleAction('break')}
                style={{ flex: 1, padding: '8px', borderRadius: 8, border: '1px solid #e2e8f0',
                  background: '#f0fdf4', color: '#16a34a', fontWeight: 600, cursor: 'pointer', fontSize: 13 }}>
                ☕ Break
              </button>
              <button onClick={() => handleAction('delay')}
                style={{ flex: 1, padding: '8px', borderRadius: 8, border: '1px solid #e2e8f0',
                  background: '#f8fafc', color: '#64748b', fontWeight: 600, cursor: 'pointer', fontSize: 13 }}>
                ⏸ Delay
              </button>
            </div>
          )}
        </div>

        {/* REWARD CURVE */}
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase',
            letterSpacing: '0.08em', marginBottom: 12 }}>Reward Per Step</div>
          {rewardHistory.length === 0 ? (
            <div style={{ color: '#cbd5e1', fontSize: 13, textAlign: 'center', padding: 40 }}>
              Rewards will appear here as the agent acts
            </div>
          ) : (
            <div style={{ position: 'relative', height: 180 }}>
              <svg width="100%" height="180" viewBox={`0 0 ${Math.max(rewardHistory.length * 20, 300)} 180`}
                preserveAspectRatio="none">
                <line x1="0" y1="90" x2="10000" y2="90" stroke="#f1f5f9" strokeWidth="1" />
                {rewardHistory.map((d, i) => {
                  const x = i * 20 + 10;
                  const y = 90 - (d.reward * 70);
                  const prev = rewardHistory[i - 1];
                  return (
                    <g key={i}>
                      {prev && (
                        <line x1={(i-1)*20+10} y1={90-(prev.reward*70)} x2={x} y2={y}
                          stroke={d.reward >= 0 ? '#6366f1' : '#ef4444'} strokeWidth="2" />
                      )}
                      <circle cx={x} cy={y} r="3"
                        fill={d.reward >= 0 ? '#6366f1' : '#ef4444'} />
                    </g>
                  );
                })}
              </svg>
            </div>
          )}
          {rewardHistory.length > 0 && (
            <div style={{ display: 'flex', gap: 16, marginTop: 8 }}>
              {[
                { label: 'Total', val: rewardHistory.reduce((s,d) => s+d.reward, 0).toFixed(3) },
                { label: 'Mean', val: (rewardHistory.reduce((s,d) => s+d.reward, 0)/rewardHistory.length).toFixed(3) },
                { label: 'Steps', val: rewardHistory.length },
              ].map(s => (
                <div key={s.label} style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 10, color: '#94a3b8' }}>{s.label}</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>{s.val}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ACTION LOG */}
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase',
          letterSpacing: '0.08em', marginBottom: 10 }}>Action Log</div>
        <div ref={scrollRef} style={{ height: 120, overflowY: 'auto', fontFamily: 'monospace', fontSize: 12 }}>
          {logs.length === 0 && (
            <span style={{ color: '#cbd5e1' }}>No actions yet...</span>
          )}
          {logs.map((log, i) => (
            <div key={i} style={{ padding: '2px 0',
              color: log.type === 'positive' ? '#16a34a' : log.type === 'negative' ? '#dc2626' : '#64748b' }}>
              [{i}] {log.msg}
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}
