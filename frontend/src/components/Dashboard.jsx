import React, { useState, useEffect, useRef } from 'react';

// Empty string = relative URLs → works on HuggingFace Spaces and local dev behind a proxy.
// Set VITE_API_URL in .env.local only when the frontend is served separately from the backend.
const API_BASE = import.meta.env.VITE_API_URL || '';

// ─── tiny helpers ─────────────────────────────────────────────────────────────

function StatCard({ label, value, color }) {
  return (
    <div style={{
      background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12,
      padding: '14px 16px', textAlign: 'center',
    }}>
      <div style={{ fontSize: 10, color: '#94a3b8', textTransform: 'uppercase',
        letterSpacing: '0.08em', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color }}>{value}</div>
    </div>
  );
}

function SectionHeader({ children }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8',
      textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>
      {children}
    </div>
  );
}

function RewardChart({ data, width = 300 }) {
  if (!data.length) return null;
  const H = 160;
  const W = Math.max(data.length * 24, width);
  const vals = data.map(d => d.mean ?? d.reward ?? 0);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const span = hi === lo ? 1 : hi - lo;
  const toY = v => H - 16 - ((v - lo) / span) * (H - 32);

  return (
    <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none"
      style={{ display: 'block' }}>
      <line x1="0" y1={H / 2} x2={W} y2={H / 2} stroke="#f1f5f9" strokeWidth="1" />
      {vals.map((v, i) => {
        const x = i * 24 + 12;
        const y = toY(v);
        const prev = i > 0 ? toY(vals[i - 1]) : null;
        return (
          <g key={i}>
            {prev !== null && (
              <line x1={(i - 1) * 24 + 12} y1={prev} x2={x} y2={y}
                stroke={v >= 0 ? '#6366f1' : '#ef4444'} strokeWidth="2" />
            )}
            <circle cx={x} cy={y} r="3" fill={v >= 0 ? '#6366f1' : '#ef4444'} />
          </g>
        );
      })}
    </svg>
  );
}

// ─── Training Log panel ───────────────────────────────────────────────────────

function TrainingLog() {
  const [data, setData] = useState(null);

  useEffect(() => {
    fetch(`${API_BASE}/training-log`)
      .then(r => r.ok ? r.json() : [])
      .then(setData)
      .catch(() => setData([]));
  }, []);

  const cardStyle = {
    background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 16,
    marginBottom: 16,
  };

  if (data === null) {
    return (
      <div style={cardStyle}>
        <SectionHeader>Training Log — Last Run</SectionHeader>
        <div style={{ color: '#94a3b8', fontSize: 13, textAlign: 'center', padding: 24 }}>
          Loading…
        </div>
      </div>
    );
  }

  if (!data.length) {
    return (
      <div style={cardStyle}>
        <SectionHeader>Training Log — Last Run</SectionHeader>
        <div style={{ color: '#94a3b8', fontSize: 13, textAlign: 'center', padding: 24 }}>
          No training data yet. Run&nbsp;
          <code style={{ background: '#f1f5f9', padding: '1px 6px', borderRadius: 4, fontSize: 12 }}>
            python training_loop.py --train
          </code>
          &nbsp;to generate reward curves.
        </div>
      </div>
    );
  }

  const means = data.map(d => d.mean);
  const total = data.length;
  const finalMean = means[means.length - 1];
  const peakMean = Math.max(...means);
  const loMean = Math.min(...means);

  return (
    <div style={cardStyle}>
      <SectionHeader>Training Log — Last Run ({total} steps)</SectionHeader>

      {/* Summary stats */}
      <div style={{ display: 'flex', gap: 24, marginBottom: 12 }}>
        {[
          { label: 'Final Mean', val: finalMean.toFixed(4), color: '#6366f1' },
          { label: 'Peak Mean',  val: peakMean.toFixed(4),  color: '#22c55e' },
          { label: 'Min Mean',   val: loMean.toFixed(4),    color: '#ef4444' },
          { label: 'Steps',      val: total,                color: '#0ea5e9' },
        ].map(s => (
          <div key={s.label} style={{ textAlign: 'center', minWidth: 64 }}>
            <div style={{ fontSize: 10, color: '#94a3b8', textTransform: 'uppercase' }}>{s.label}</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: s.color }}>{s.val}</div>
          </div>
        ))}
      </div>

      {/* Reward curve chart */}
      <div style={{ position: 'relative', overflow: 'hidden', borderRadius: 8,
        border: '1px solid #f1f5f9', background: '#fafafa' }}>
        <RewardChart data={data} width={600} />
      </div>

      {/* Step table — last 10 rows */}
      <div style={{ marginTop: 12, fontFamily: 'monospace', fontSize: 11, color: '#475569' }}>
        <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid #f1f5f9',
          paddingBottom: 4, marginBottom: 4, fontWeight: 700, color: '#94a3b8' }}>
          {['Step', 'Mean', 'Max', 'Min'].map(h => (
            <div key={h} style={{ flex: 1 }}>{h}</div>
          ))}
        </div>
        {data.slice(-10).map(d => (
          <div key={d.step} style={{ display: 'flex', gap: 0, padding: '2px 0',
            color: d.mean >= 0 ? '#16a34a' : '#dc2626' }}>
            <div style={{ flex: 1 }}>{d.step}</div>
            <div style={{ flex: 1 }}>{d.mean.toFixed(4)}</div>
            <div style={{ flex: 1 }}>{d.max?.toFixed(4) ?? '—'}</div>
            <div style={{ flex: 1 }}>{d.min?.toFixed(4) ?? '—'}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────

export default function Dashboard() {
  const [level, setLevel] = useState('medium');
  const [sessionId, setSessionId] = useState(null);
  const [obs, setObs] = useState(null);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [rewardHistory, setRewardHistory] = useState([]);
  const scrollRef = useRef(null);

  const fetchState = async (sid) => {
    try {
      const res = await fetch(`${API_BASE}/state?session_id=${sid}`);
      if (res.ok) await res.json();
    } catch (e) { console.error(e); }
  };

  const handleReset = async () => {
    setLoading(true);
    setError(null);
    setRewardHistory([]);
    try {
      const res = await fetch(`${API_BASE}/reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task_id: level }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setSessionId(data.session_id);
      setObs(data.observation);
      setLogs([{ type: 'system', msg: `Episode started: ${level}` }]);
      await fetchState(data.session_id);
    } catch (err) {
      setError(`Cannot reach backend at "${API_BASE || window.location.origin}" — ${err.message}`);
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
        body: JSON.stringify({ session_id: sessionId, action }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setObs(data.observation);
      setRewardHistory(prev => [...prev, { step: prev.length + 1, reward: data.reward }]);
      setLogs(prev => [...prev, {
        type: data.reward >= 0 ? 'positive' : 'negative',
        msg: `${actionType}${taskId ? ' ' + taskId : ''} → reward: ${data.reward?.toFixed(3)}`,
      }]);
      if (data.done) {
        setLogs(prev => [...prev, {
          type: 'system',
          msg: `DONE. Final score: ${data.info?.final_score?.toFixed(3) ?? 'N/A'}`,
        }]);
        setSessionId(null);
      }
      await fetchState(sessionId);
      setTimeout(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }, 50);
    } catch (err) {
      setError(err.message);
    } finally { setLoading(false); }
  };

  const workers = obs?.visible_state?.workers || [];
  const tasks   = obs?.tasks || [];
  const firstW  = workers[0] || {};

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc',
      fontFamily: 'system-ui, sans-serif', padding: 24 }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between',
        alignItems: 'center', marginBottom: 20 }}>
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
            style={{ border: '1px solid #e2e8f0', borderRadius: 8,
              padding: '6px 10px', fontSize: 13 }}>
            <option value="easy">Easy</option>
            <option value="medium">Medium</option>
            <option value="hard">Hard</option>
            <option value="expert">Expert</option>
          </select>
          <button onClick={handleReset} disabled={loading}
            style={{ background: '#6366f1', color: '#fff', border: 'none',
              borderRadius: 8, padding: '8px 18px', fontSize: 13, fontWeight: 600,
              cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1 }}>
            {loading ? 'Loading…' : sessionId ? '↺ Reset' : '▶ Start'}
          </button>
        </div>
      </div>

      {/* ── Error banner ── */}
      {error && (
        <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8,
          padding: '10px 14px', marginBottom: 16, fontSize: 13, color: '#dc2626' }}>
          ⚠️ {error}
        </div>
      )}

      {/* ── Worker metric cards ── */}
      {workers.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 12, marginBottom: 16 }}>
          <StatCard label="Fatigue" value={firstW.fatigue_level || '—'}
            color={firstW.fatigue_level === 'high' ? '#ef4444'
              : firstW.fatigue_level === 'medium' ? '#f59e0b' : '#22c55e'} />
          <StatCard label="Stress" value={firstW.stress_level || '—'}
            color={firstW.stress_level === 'critical' ? '#ef4444'
              : firstW.stress_level === 'elevated' ? '#f59e0b' : '#22c55e'} />
          <StatCard label="Step"       value={obs?.time_step ?? '—'} color="#6366f1" />
          <StatCard label="Tasks Done"
            value={`${tasks.filter(t => t.progress >= 1.0).length}/${tasks.length}`}
            color="#0ea5e9" />
        </div>
      )}

      {/* ── Task list + Step reward chart ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>

        {/* Task queue */}
        <div style={{ background: '#fff', border: '1px solid #e2e8f0',
          borderRadius: 12, padding: 16 }}>
          <SectionHeader>Task Queue</SectionHeader>
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
                  {task.task_type}&nbsp;
                  <span style={{ fontSize: 10, color: '#94a3b8' }}>#{task.id}</span>
                </div>
                <div style={{ fontSize: 11, color: '#94a3b8' }}>
                  deadline: {task.deadline ?? '—'} · {task.depends_on
                    ? `depends: ${task.depends_on}` : 'no dep'}
                </div>
                <div style={{ height: 3, background: '#f1f5f9', borderRadius: 99,
                  marginTop: 4, overflow: 'hidden' }}>
                  <div style={{ width: `${task.progress * 100}%`, height: '100%',
                    background: task.progress >= 1 ? '#22c55e' : '#6366f1',
                    borderRadius: 99 }} />
                </div>
              </div>
              <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 99,
                fontWeight: 600,
                background: task.priority === 'critical' ? '#fef2f2'
                  : task.priority === 'high' ? '#fffbeb' : '#f0fdf4',
                color: task.priority === 'critical' ? '#dc2626'
                  : task.priority === 'high' ? '#d97706' : '#16a34a' }}>
                {task.priority}
              </span>
              {sessionId && task.progress < 1.0 && (
                <div style={{ display: 'flex', gap: 4 }}>
                  <button onClick={() => handleAction('work', task.id)}
                    style={{ fontSize: 10, padding: '3px 8px', borderRadius: 6,
                      border: '1px solid #e2e8f0', background: '#f8fafc',
                      cursor: 'pointer' }}>work</button>
                  <button onClick={() => handleAction('focus', task.id)}
                    style={{ fontSize: 10, padding: '3px 8px', borderRadius: 6,
                      border: '1px solid #6366f1', background: '#eef2ff',
                      color: '#6366f1', cursor: 'pointer' }}>focus</button>
                </div>
              )}
            </div>
          ))}
          {sessionId && (
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button onClick={() => handleAction('break')}
                style={{ flex: 1, padding: 8, borderRadius: 8, border: '1px solid #e2e8f0',
                  background: '#f0fdf4', color: '#16a34a', fontWeight: 600,
                  cursor: 'pointer', fontSize: 13 }}>☕ Break</button>
              <button onClick={() => handleAction('delay')}
                style={{ flex: 1, padding: 8, borderRadius: 8, border: '1px solid #e2e8f0',
                  background: '#f8fafc', color: '#64748b', fontWeight: 600,
                  cursor: 'pointer', fontSize: 13 }}>⏸ Delay</button>
            </div>
          )}
        </div>

        {/* Step reward chart */}
        <div style={{ background: '#fff', border: '1px solid #e2e8f0',
          borderRadius: 12, padding: 16 }}>
          <SectionHeader>Reward Per Step</SectionHeader>
          {rewardHistory.length === 0 ? (
            <div style={{ color: '#cbd5e1', fontSize: 13, textAlign: 'center', padding: 40 }}>
              Rewards will appear here as the agent acts
            </div>
          ) : (
            <div style={{ overflow: 'hidden', borderRadius: 8,
              border: '1px solid #f1f5f9', background: '#fafafa' }}>
              <RewardChart data={rewardHistory} width={300} />
            </div>
          )}
          {rewardHistory.length > 0 && (
            <div style={{ display: 'flex', gap: 16, marginTop: 8 }}>
              {[
                { label: 'Total', val: rewardHistory.reduce((s, d) => s + d.reward, 0).toFixed(3) },
                { label: 'Mean',  val: (rewardHistory.reduce((s, d) => s + d.reward, 0) / rewardHistory.length).toFixed(3) },
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

      {/* ── Action log ── */}
      <div style={{ background: '#fff', border: '1px solid #e2e8f0',
        borderRadius: 12, padding: 16, marginBottom: 16 }}>
        <SectionHeader>Action Log</SectionHeader>
        <div ref={scrollRef} style={{ height: 120, overflowY: 'auto',
          fontFamily: 'monospace', fontSize: 12 }}>
          {logs.length === 0 && (
            <span style={{ color: '#cbd5e1' }}>No actions yet…</span>
          )}
          {logs.map((log, i) => (
            <div key={i} style={{ padding: '2px 0',
              color: log.type === 'positive' ? '#16a34a'
                : log.type === 'negative' ? '#dc2626' : '#64748b' }}>
              [{i}] {log.msg}
            </div>
          ))}
        </div>
      </div>

      {/* ── Training log (reward_curve.json from last GRPO run) ── */}
      <TrainingLog />

    </div>
  );
}
