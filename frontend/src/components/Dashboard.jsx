import React, { useState, useEffect, useRef, useCallback } from 'react'

const API = ''

// ── colour helpers ─────────────────────────────────────────────────────────────
const rewardColor  = r => r >= 0.1 ? '#16a34a' : r >= 0 ? '#65a30d' : r >= -0.1 ? '#f59e0b' : '#ef4444'
const rewardBg     = r => r >= 0.1 ? '#f0fdf4' : r >= 0 ? '#f7fee7' : r >= -0.1 ? '#fffbeb' : '#fef2f2'
const energyColor  = e => e > 0.6 ? '#22c55e' : e > 0.3 ? '#f59e0b' : '#ef4444'
const stressColor  = s => s < 0.4 ? '#22c55e' : s < 0.7 ? '#f59e0b' : '#ef4444'
const priColor     = { critical:'#dc2626', high:'#d97706', normal:'#16a34a', low:'#94a3b8' }
const priBg        = { critical:'#fef2f2', high:'#fffbeb', normal:'#f0fdf4', low:'#f8fafc' }
const ACTION_ICON  = { work:'⚙', focus:'🎯', break:'☕', switch:'🔄', delay:'⏸', default:'•' }
const ACTION_COLOR = { work:'#6366f1', focus:'#7c3aed', break:'#16a34a', switch:'#f59e0b', delay:'#94a3b8' }

// ── tiny bar ───────────────────────────────────────────────────────────────────
function StatBar({ label, value, color, max = 1 }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100))
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between',
        fontSize: 11, color: '#64748b', marginBottom: 3 }}>
        <span style={{ fontWeight: 600 }}>{label}</span>
        <span style={{ fontWeight: 700, color }}>{(value * 100).toFixed(0)}%</span>
      </div>
      <div style={{ height: 7, background: '#f1f5f9', borderRadius: 99 }}>
        <div style={{ height: 7, borderRadius: 99, width: `${pct}%`,
          background: color, transition: 'width .3s ease',
          boxShadow: `0 0 6px ${color}66` }} />
      </div>
    </div>
  )
}

// ── SVG reward chart ───────────────────────────────────────────────────────────
function RewardChart({ rewards, height = 120 }) {
  if (!rewards.length) return (
    <div style={{ height, display: 'flex', alignItems: 'center',
      justifyContent: 'center', color: '#cbd5e1', fontSize: 12 }}>
      Rewards appear as the agent acts
    </div>
  )
  const W   = Math.max(rewards.length * 22, 280)
  const lo  = Math.min(...rewards, 0)
  const hi  = Math.max(...rewards, 0.1)
  const sp  = hi === lo ? 1 : hi - lo
  const py  = v => (height - 14) - ((v - lo) / sp) * (height - 28) + 7
  const pts = rewards.map((v, i) => `${i * 22 + 11},${py(v)}`).join(' ')
  const zero = py(0)

  return (
    <svg width="100%" height={height} viewBox={`0 0 ${W} ${height}`}
      preserveAspectRatio="none" style={{ display: 'block' }}>
      {/* zero line */}
      <line x1="0" y1={zero} x2={W} y2={zero}
        stroke="#e2e8f0" strokeWidth="1.5" strokeDasharray="4 3" />
      {/* coloured bars */}
      {rewards.map((v, i) => {
        const x    = i * 22 + 4
        const barH = Math.abs(py(v) - zero)
        const y    = v >= 0 ? py(v) : zero
        return (
          <rect key={i} x={x} y={y} width="14" height={Math.max(barH, 2)}
            fill={v >= 0 ? '#6366f1' : '#ef4444'} opacity="0.75" rx="2" />
        )
      })}
      {/* line */}
      <polyline points={pts} fill="none"
        stroke="#6366f1" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {/* last dot */}
      {rewards.length > 0 && (
        <circle cx={(rewards.length - 1) * 22 + 11} cy={py(rewards[rewards.length - 1])}
          r="4" fill={rewardColor(rewards[rewards.length - 1])} />
      )}
    </svg>
  )
}

// ── Scoring formula reference bar (from images) ───────────────────────────────
const SCORE_COMPONENTS = [
  { key: 'weighted_completion', label: 'Weighted Task Completion', weight: '60%', color: '#6366f1',
    desc: 'Did you finish tasks? Critical tasks worth more' },
  { key: 'deadline_adherence',  label: 'Deadline Adherence',       weight: '22%', color: '#0ea5e9',
    desc: 'Did you finish before the deadline?' },
  { key: 'energy_efficiency',   label: 'Energy Efficiency',        weight: '10%', color: '#22c55e',
    desc: 'Did you avoid burning out?' },
  { key: 'dependency_bonus',    label: 'Dependency Ordering',      weight:  '5%', color: '#f59e0b',
    desc: 'Did you do Task A before Task B that depends on it?' },
  { key: 'interruption_bonus',  label: 'Interruption Handling',    weight:  '3%', color: '#f43f5e',
    desc: 'Did you handle surprise urgent tasks?' },
]

function ScoringFormula({ scoreComponents }) {
  return (
    <div style={{ background: '#0f172a', borderRadius: 14, padding: 16, marginBottom: 0 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: '#475569',
        textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 10 }}>
        Reward Formula
      </div>
      <div style={{ display: 'flex', height: 10, borderRadius: 99,
        overflow: 'hidden', marginBottom: 10 }}>
        {SCORE_COMPONENTS.map(c => (
          <div key={c.key} style={{ flex: parseInt(c.weight),
            background: c.color, transition: 'flex .5s' }} />
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 6 }}>
        {SCORE_COMPONENTS.map(c => {
          const val = scoreComponents?.[c.key]
          return (
            <div key={c.key} style={{ borderTop: `2px solid ${c.color}`,
              paddingTop: 6 }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: c.color }}>
                {c.weight}
              </div>
              <div style={{ fontSize: 9, color: '#64748b', lineHeight: 1.4,
                marginTop: 2 }}>{c.label}</div>
              {val != null && (
                <div style={{ fontSize: 12, fontWeight: 700, color: '#94a3b8',
                  marginTop: 4 }}>→ {val.toFixed(4)}</div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Main Dashboard ─────────────────────────────────────────────────────────────
export default function Dashboard() {
  const [difficulty, setDiff]       = useState('medium')
  const [streaming,  setStreaming]   = useState(false)
  const [streamDone, setStreamDone]  = useState(false)
  const [episodeNum, setEpNum]       = useState(0)

  // live data
  const [steps,       setSteps]      = useState([])   // [{step,action,reward,done,drift}]
  const [rewards,     setRewards]    = useState([])   // flat array for chart
  const [tasks,       setTasks]      = useState([])
  const [energy,      setEnergy]     = useState(1.0)
  const [stress,      setStress]     = useState(0.0)
  const [fatigue,     setFatigue]    = useState('low')
  const [stressLvl,   setStressLvl]  = useState('calm')
  const [focusMode,   setFocusMode]  = useState(false)
  const [blockedIds,  setBlocked]    = useState([])
  const [deadlineIds, setDeadlines]  = useState([])
  const [driftEvents, setDrift]      = useState([])
  const [finalScore,  setFinal]      = useState(null)
  const [scoreComps,  setComps]      = useState(null)
  const [history,     setHistory]    = useState([])
  const [error,       setError]      = useState(null)

  const esRef    = useRef(null)
  const logRef   = useRef(null)

  // auto-scroll step log
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [steps])

  const startStream = useCallback((diff) => {
    const d = diff || difficulty
    if (esRef.current) { esRef.current.close(); esRef.current = null }

    setStreaming(true); setStreamDone(false); setFinal(null); setComps(null)
    setError(null); setSteps([]); setRewards([]); setTasks([])
    setEnergy(1.0); setStress(0.0); setDrift([])
    setEpNum(prev => prev + 1)

    const es = new EventSource(`${API}/stream/run?difficulty=${d}&delay_ms=350`)
    esRef.current = es

    es.onmessage = (ev) => {
      const msg = JSON.parse(ev.data)

      if (msg.type === 'reset') {
        setTasks(msg.tasks || [])
        setEnergy(msg.energy ?? 1.0)
        setStress(msg.stress ?? 0.0)
        const w = msg.visible_state?.workers?.[0]
        if (w) { setFatigue(w.fatigue_level); setStressLvl(w.stress_level) }
        setBlocked(msg.visible_state?.blocked_tasks || [])
        setDeadlines(msg.visible_state?.upcoming_deadlines || [])
        setFocusMode(msg.visible_state?.focus_mode || false)
      }

      if (msg.type === 'step') {
        const w = msg.visible_state?.workers?.[0]
        setEnergy(msg.energy ?? (w ? undefined : 0.5))
        setStress(msg.stress ?? 0.0)
        if (w) { setFatigue(w.fatigue_level); setStressLvl(w.stress_level) }
        setBlocked(msg.visible_state?.blocked_tasks || [])
        setDeadlines(msg.visible_state?.upcoming_deadlines || [])
        setFocusMode(msg.visible_state?.focus_mode || false)
        setTasks(msg.tasks || [])
        setRewards(prev => [...prev, msg.reward])
        setSteps(prev => [...prev, {
          step:   msg.step,
          action: msg.action,
          reward: msg.reward,
          done:   msg.done,
          drift:  msg.schema_drift || null,
        }])
        if (msg.schema_drift) setDrift(prev => [...prev, msg.schema_drift])

        if (msg.done) {
          const sc = msg.final_score
          setFinal(sc)
          setStreamDone(true)
          setStreaming(false)
          // compute score components from the last step
          if (msg.visible_state) {
            // fetch detailed benchmark for this difficulty for component breakdown
            fetch(`${API}/benchmark`)
              .then(r => r.ok ? r.json() : null)
              .then(d => { if (d?.[diff || difficulty]?.components) setComps(d[diff || difficulty].components) })
              .catch(() => {})
          }
          setHistory(prev => [
            { ep: prev.length + 1, score: sc, difficulty: d,
              steps: msg.step, totalReward: msg.total_reward },
            ...prev.slice(0, 7),
          ])
          es.close(); esRef.current = null
        }
      }

      if (msg.type === 'error') {
        setError(msg.message); setStreaming(false)
        es.close(); esRef.current = null
      }
    }

    es.onerror = () => {
      setError('Connection lost. Click ▶ Play Episode to retry.')
      setStreaming(false); es.close(); esRef.current = null
    }
  }, [difficulty])

  const stopStream = () => {
    if (esRef.current) { esRef.current.close(); esRef.current = null }
    setStreaming(false)
  }

  useEffect(() => () => { if (esRef.current) esRef.current.close() }, [])

  // ── derived ────────────────────────────────────────────────────────────────
  const totalReward  = rewards.reduce((s, v) => s + v, 0)
  const tasksDone    = tasks.filter(t => t.progress >= 1.0).length
  const currentStep  = steps[steps.length - 1]

  // ── layout styles ─────────────────────────────────────────────────────────
  const card = (ex = {}) => ({
    background: '#fff', border: '1px solid #e2e8f0',
    borderRadius: 14, padding: 16, ...ex,
  })

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif' }}>

      {/* ── TOP CONTROLS ─────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center',
        marginBottom: 14, flexWrap: 'wrap' }}>

        <select value={difficulty}
          onChange={e => { setDiff(e.target.value); if (streaming) startStream(e.target.value) }}
          disabled={streaming}
          style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 12px',
            fontSize: 13, background: '#fff', fontWeight: 600 }}>
          {['easy','medium','hard','expert'].map(l => (
            <option key={l} value={l}>{l.charAt(0).toUpperCase() + l.slice(1)}</option>
          ))}
        </select>

        {streaming
          ? <button onClick={stopStream}
              style={{ background: '#ef4444', color: '#fff', border: 'none',
                borderRadius: 8, padding: '9px 22px', fontWeight: 800,
                fontSize: 14, cursor: 'pointer' }}>⏹ Stop</button>
          : <button onClick={() => startStream()}
              style={{ background: '#6366f1', color: '#fff', border: 'none',
                borderRadius: 8, padding: '9px 22px', fontWeight: 800,
                fontSize: 14, cursor: 'pointer' }}>
              {streamDone ? '↺ Replay Episode' : '▶ Play Episode'}
            </button>
        }

        {streaming && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6,
            background: '#eef2ff', border: '1px solid #c7d2fe', borderRadius: 8,
            padding: '7px 14px' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%',
              background: '#6366f1', display: 'inline-block',
              animation: 'blink 1s ease-in-out infinite' }} />
            <span style={{ fontSize: 13, fontWeight: 700, color: '#6366f1' }}>
              LIVE · Episode #{episodeNum} · Step {steps.length}
            </span>
          </div>
        )}

        {streamDone && finalScore != null && (
          <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0',
            borderRadius: 8, padding: '7px 16px', fontWeight: 700,
            fontSize: 13, color: '#15803d' }}>
            ✅ Episode #{episodeNum} · Final Score: <span style={{ fontSize: 16 }}>
              {finalScore.toFixed(4)}
            </span>
          </div>
        )}

        {/* live totals */}
        {(streaming || streamDone) && rewards.length > 0 && (
          <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
            {[
              { l:'∑ Reward', v: totalReward.toFixed(3),
                c: totalReward >= 0 ? '#16a34a' : '#ef4444' },
              { l:'Tasks',   v: `${tasksDone}/${tasks.length}`, c: '#6366f1' },
              { l:'Energy',  v: `${(energy*100).toFixed(0)}%`,  c: energyColor(energy) },
              { l:'Stress',  v: `${(stress*100).toFixed(0)}%`,  c: stressColor(stress) },
            ].map(s => (
              <div key={s.l} style={{ background: '#f8fafc',
                border: '1px solid #e2e8f0', borderRadius: 8,
                padding: '5px 12px', textAlign: 'center', minWidth: 64 }}>
                <div style={{ fontSize: 9, color: '#94a3b8',
                  textTransform: 'uppercase' }}>{s.l}</div>
                <div style={{ fontSize: 14, fontWeight: 800, color: s.c }}>{s.v}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* error */}
      {error && (
        <div style={{ background: '#fef2f2', border: '1px solid #fca5a5',
          borderRadius: 10, padding: '10px 14px', marginBottom: 12,
          fontSize: 13, color: '#dc2626' }}>
          ⚠️ {error}
          <button onClick={() => setError(null)}
            style={{ marginLeft: 10, background: 'none', border: 'none',
              cursor: 'pointer', color: '#dc2626', fontWeight: 700 }}>✕</button>
        </div>
      )}

      {/* schema drift alerts */}
      {driftEvents.map((d, i) => (
        <div key={i} style={{ background: '#fffbeb', border: '1px solid #fcd34d',
          borderRadius: 10, padding: '8px 14px', marginBottom: 8,
          fontSize: 12, color: '#92400e', fontWeight: 600 }}>
          ⚡ Schema Drift @ step {d.step}: {d.message}
        </div>
      ))}

      {/* ── MAIN 3-COLUMN GRID ─────────────────────────────────────────────── */}
      <div style={{ display: 'grid',
        gridTemplateColumns: '320px 1fr 260px', gap: 14, marginBottom: 14 }}>

        {/* ── COL 1: LIVE STEP LOG ─────────────────────────────────────────── */}
        <div style={{ ...card(), display: 'flex', flexDirection: 'column',
          maxHeight: 480 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8',
            textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 10,
            display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>Step-by-Step Log</span>
            {steps.length > 0 && (
              <span style={{ color: '#6366f1' }}>{steps.length} steps</span>
            )}
          </div>

          {/* idle state */}
          {steps.length === 0 && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
              color: '#94a3b8', textAlign: 'center', padding: 20 }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>🤖</div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>
                Press ▶ Play Episode
              </div>
              <div style={{ fontSize: 11, marginTop: 4 }}>
                Watch the AI agent play step by step
              </div>
            </div>
          )}

          <div ref={logRef} style={{ flex: 1, overflowY: 'auto',
            fontFamily: 'monospace', fontSize: 12 }}>
            {steps.map((s, i) => {
              const icon = ACTION_ICON[s.action?.type] || '•'
              const aclr = ACTION_COLOR[s.action?.type] || '#64748b'
              const rclr = rewardColor(s.reward)
              const rbg  = rewardBg(s.reward)
              return (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '5px 6px', borderRadius: 6, marginBottom: 2,
                  background: s.done ? '#f0fdf4' : (i === steps.length - 1 && streaming) ? '#eef2ff' : 'transparent',
                  border: s.done ? '1px solid #bbf7d0' : (i === steps.length - 1 && streaming) ? '1px solid #c7d2fe' : '1px solid transparent',
                }}>
                  {/* step number */}
                  <span style={{ color: '#94a3b8', minWidth: 26, textAlign: 'right',
                    fontSize: 10 }}>[{s.step}]</span>
                  {/* action icon + type */}
                  <span style={{ color: aclr, fontWeight: 700, minWidth: 16 }}>{icon}</span>
                  <span style={{ color: aclr, fontWeight: 700, minWidth: 44 }}>
                    {s.action?.type}
                  </span>
                  {/* task id */}
                  <span style={{ color: '#475569', minWidth: 28, fontSize: 11 }}>
                    {s.action?.task_id || '—'}
                  </span>
                  {/* reward badge */}
                  <span style={{ marginLeft: 'auto', background: rbg,
                    color: rclr, fontWeight: 800, fontSize: 11,
                    padding: '1px 7px', borderRadius: 99, minWidth: 56,
                    textAlign: 'right' }}>
                    {s.reward >= 0 ? '+' : ''}{s.reward.toFixed(3)}
                  </span>
                  {/* drift marker */}
                  {s.drift && <span title={s.drift.message} style={{ fontSize: 11 }}>⚡</span>}
                  {/* done marker */}
                  {s.done && <span style={{ fontSize: 10, color: '#16a34a' }}>✓</span>}
                </div>
              )
            })}

            {/* episode summary at end */}
            {streamDone && finalScore != null && (
              <div style={{ marginTop: 8, padding: '10px', borderRadius: 8,
                background: '#0f172a', color: '#fff' }}>
                <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 4 }}>
                  [END] Episode #{episodeNum}
                </div>
                <div style={{ color: '#94a3b8', fontSize: 11, lineHeight: 1.8 }}>
                  <div>success: {finalScore >= 0.5 ? 'true ✅' : 'false ❌'}</div>
                  <div>steps: {steps.length}</div>
                  <div style={{ color: finalScore >= 0.5 ? '#4ade80' : '#fbbf24',
                    fontWeight: 700 }}>
                    score: {finalScore.toFixed(4)}
                  </div>
                  <div style={{ color: totalReward >= 0 ? '#4ade80' : '#f87171' }}>
                    ∑reward: {totalReward.toFixed(3)}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── COL 2: CHARTS ────────────────────────────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* Reward per step bar+line chart */}
          <div style={card()}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8',
              textTransform: 'uppercase', letterSpacing: '.08em',
              marginBottom: 8, display: 'flex', justifyContent: 'space-between' }}>
              <span>Reward / Step</span>
              {rewards.length > 0 && (
                <span style={{ color: totalReward >= 0 ? '#16a34a' : '#ef4444' }}>
                  Σ {totalReward >= 0 ? '+' : ''}{totalReward.toFixed(3)}
                </span>
              )}
            </div>
            <div style={{ border: '1px solid #f1f5f9', borderRadius: 8,
              background: '#fafafa', overflow: 'hidden' }}>
              <RewardChart rewards={rewards} height={130} />
            </div>
            {rewards.length > 0 && (
              <div style={{ display: 'flex', gap: 20, marginTop: 8 }}>
                {[
                  { l: 'Steps',  v: rewards.length },
                  { l: 'Mean',   v: (totalReward / rewards.length).toFixed(3) },
                  { l: 'Peak',   v: Math.max(...rewards).toFixed(3) },
                  { l: 'Worst',  v: Math.min(...rewards).toFixed(3) },
                ].map(s => (
                  <div key={s.l} style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 9, color: '#94a3b8',
                      textTransform: 'uppercase' }}>{s.l}</div>
                    <div style={{ fontSize: 13, fontWeight: 700,
                      color: '#0f172a' }}>{s.v}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Cumulative reward */}
          {rewards.length > 1 && (
            <div style={card()}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8',
                textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 8 }}>
                Cumulative Reward
              </div>
              <div style={{ border: '1px solid #f1f5f9', borderRadius: 8,
                background: '#fafafa', overflow: 'hidden' }}>
                <RewardChart
                  rewards={rewards.reduce((acc, v) => {
                    acc.push((acc[acc.length - 1] || 0) + v); return acc
                  }, [])}
                  height={90}
                />
              </div>
            </div>
          )}

          {/* Episode history */}
          {history.length > 0 && (
            <div style={card()}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8',
                textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 8 }}>
                Episode History
              </div>
              <div style={{ fontFamily: 'monospace', fontSize: 11 }}>
                <div style={{ display: 'flex', color: '#94a3b8', fontWeight: 700,
                  borderBottom: '1px solid #f1f5f9', paddingBottom: 3, marginBottom: 3 }}>
                  {['#', 'Diff', 'Steps', 'Score'].map(h => (
                    <div key={h} style={{ flex: 1 }}>{h}</div>
                  ))}
                </div>
                {history.map(h => (
                  <div key={h.ep} style={{ display: 'flex', padding: '2px 0',
                    color: h.score >= 0.5 ? '#16a34a' : h.score >= 0.3 ? '#f59e0b' : '#ef4444' }}>
                    <div style={{ flex: 1, color: '#94a3b8' }}>{h.ep}</div>
                    <div style={{ flex: 1, color: '#475569',
                      textTransform: 'capitalize' }}>{h.difficulty}</div>
                    <div style={{ flex: 1 }}>{h.steps}</div>
                    <div style={{ flex: 1, fontWeight: 700 }}>{h.score.toFixed(4)}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── COL 3: TASK QUEUE + WORKER STATE ─────────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* Worker state */}
          {(streaming || streamDone) && (
            <div style={card()}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8',
                textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 10 }}>
                Worker State
              </div>
              <StatBar label={`Energy — ${fatigue}`} value={energy}
                color={energyColor(energy)} />
              <StatBar label={`Stress — ${stressLvl}`} value={stress}
                color={stressColor(stress)} />
              {focusMode && (
                <div style={{ marginTop: 6, fontSize: 11, fontWeight: 700,
                  color: '#7c3aed', background: '#f5f3ff',
                  borderRadius: 6, padding: '4px 8px' }}>
                  🎯 FOCUS MODE ACTIVE
                </div>
              )}
              {deadlineIds.length > 0 && (
                <div style={{ marginTop: 6, fontSize: 11, color: '#dc2626',
                  fontWeight: 600 }}>
                  ⏰ Deadlines: {deadlineIds.join(', ')}
                </div>
              )}
              {blockedIds.length > 0 && (
                <div style={{ marginTop: 4, fontSize: 11, color: '#f59e0b',
                  fontWeight: 600 }}>
                  🔒 Blocked: {blockedIds.join(', ')}
                </div>
              )}
            </div>
          )}

          {/* Task queue */}
          <div style={{ ...card(), flex: 1, overflowY: 'auto', maxHeight: 320 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8',
              textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 10,
              display: 'flex', justifyContent: 'space-between' }}>
              <span>Task Queue</span>
              {tasks.length > 0 && (
                <span style={{ color: '#6366f1' }}>
                  {tasksDone}/{tasks.length} done
                </span>
              )}
            </div>

            {tasks.length === 0 && (
              <div style={{ color: '#cbd5e1', fontSize: 12, textAlign: 'center',
                padding: '20px 0' }}>
                Tasks appear when episode starts
              </div>
            )}

            {tasks.map(t => {
              const blocked  = blockedIds.includes(t.id)
              const deadline = deadlineIds.includes(t.id)
              const pc       = priColor[t.priority] || '#94a3b8'
              const pb       = priBg[t.priority]   || '#f8fafc'
              return (
                <div key={t.id} style={{
                  marginBottom: 10, padding: '8px 10px', borderRadius: 8,
                  border: `1px solid ${t.progress >= 1 ? '#bbf7d0' : deadline ? '#fca5a5' : blocked ? '#fcd34d' : '#f1f5f9'}`,
                  background: t.progress >= 1 ? '#f0fdf4' : deadline ? '#fef2f2' : blocked ? '#fffbeb' : '#fff',
                  opacity: blocked ? 0.7 : 1,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between',
                    alignItems: 'center', marginBottom: 5 }}>
                    <div>
                      <span style={{ fontSize: 12, fontWeight: 700,
                        color: '#0f172a' }}>{t.task_type}</span>
                      <span style={{ fontSize: 10, color: '#94a3b8',
                        marginLeft: 4 }}>#{t.id}</span>
                      {t.is_interrupted && (
                        <span style={{ fontSize: 9, marginLeft: 4,
                          color: '#7c3aed', fontWeight: 700 }}>⚡INT</span>
                      )}
                    </div>
                    <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 6px',
                      borderRadius: 99, background: pb, color: pc }}>
                      {t.priority}
                    </span>
                  </div>

                  {/* progress bar */}
                  <div style={{ height: 6, background: '#f1f5f9', borderRadius: 99 }}>
                    <div style={{
                      height: 6, borderRadius: 99,
                      width: `${t.progress * 100}%`,
                      background: t.progress >= 1 ? '#22c55e' : deadline ? '#ef4444' : '#6366f1',
                      transition: 'width .35s ease',
                      boxShadow: t.progress > 0 ? '0 0 4px rgba(99,102,241,.5)' : 'none',
                    }} />
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between',
                    fontSize: 10, color: '#94a3b8', marginTop: 3 }}>
                    <span>{(t.progress * 100).toFixed(0)}%</span>
                    <span>
                      {t.deadline ? `⏰ step ${t.deadline}` : 'no deadline'}
                      {t.depends_on ? ` · dep:${t.depends_on}` : ''}
                      {blocked ? ' 🔒' : ''}
                      {t.progress >= 1 ? ' ✅' : ''}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* ── BOTTOM: SCORING FORMULA ─────────────────────────────────────────── */}
      <ScoringFormula scoreComponents={scoreComps} />

      <style>{`
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:.2} }
      `}</style>
    </div>
  )
}
