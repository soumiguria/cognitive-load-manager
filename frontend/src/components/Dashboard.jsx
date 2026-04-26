import React, { useState, useEffect, useRef, useCallback } from 'react'

// Relative URL = same origin. Works on HF Spaces (frontend+backend on :7860)
// and locally via the Vite proxy defined in vite.config.js.
const API = ''

// ── Tiny SVG line chart ────────────────────────────────────────────────────────
function LineChart({ data, color = '#6366f1', height = 130, label }) {
  if (!data.length) return (
    <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: '#cbd5e1', fontSize: 12 }}>
      {label || 'Waiting for data…'}
    </div>
  )
  const W = Math.max(data.length * 18, 260)
  const lo = Math.min(...data)
  const hi = Math.max(...data)
  const span = hi === lo ? 1 : hi - lo
  const py = v => (height - 16) - ((v - lo) / span) * (height - 28) + 8

  const pts = data.map((v, i) => `${i * 18 + 9},${py(v)}`).join(' ')

  return (
    <svg width="100%" height={height} viewBox={`0 0 ${W} ${height}`}
      preserveAspectRatio="none" style={{ display: 'block' }}>
      {/* zero line */}
      <line x1="0" y1={py(0)} x2={W} y2={py(0)}
        stroke="#e2e8f0" strokeWidth="1" strokeDasharray="4 3" />
      {/* fill area */}
      <polyline
        points={[`0,${height}`, ...data.map((v, i) => `${i * 18 + 9},${py(v)}`),
                 `${(data.length - 1) * 18 + 9},${height}`].join(' ')}
        fill={color + '18'} stroke="none"
      />
      {/* line */}
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2"
        strokeLinejoin="round" strokeLinecap="round" />
      {/* last point dot */}
      {data.length > 0 && (
        <circle cx={(data.length - 1) * 18 + 9} cy={py(data[data.length - 1])}
          r="4" fill={color} />
      )}
    </svg>
  )
}

// Dual line chart (energy + stress)
function DualChart({ energy, stress, height = 130 }) {
  const data = energy.length ? energy : []
  if (!data.length) return (
    <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: '#cbd5e1', fontSize: 12 }}>Waiting for data…</div>
  )
  const W = Math.max(data.length * 18, 260)
  const py = (v, lo, hi) => {
    const span = hi === lo ? 1 : hi - lo
    return (height - 16) - ((v - lo) / span) * (height - 28) + 8
  }
  const loE = Math.min(...energy, 0), hiE = Math.max(...energy, 1)
  const loS = Math.min(...stress, 0), hiS = Math.max(...stress, 1)
  const ePts = energy.map((v, i) => `${i * 18 + 9},${py(v, loE, hiE)}`).join(' ')
  const sPts = stress.map((v, i) => `${i * 18 + 9},${py(v, loS, hiS)}`).join(' ')

  return (
    <svg width="100%" height={height} viewBox={`0 0 ${W} ${height}`}
      preserveAspectRatio="none" style={{ display: 'block' }}>
      <polyline points={ePts} fill="none" stroke="#22c55e" strokeWidth="2"
        strokeLinejoin="round" strokeLinecap="round" />
      <polyline points={sPts} fill="none" stroke="#f59e0b" strokeWidth="2"
        strokeLinejoin="round" strokeLinecap="round" strokeDasharray="5 3" />
    </svg>
  )
}

// ── Tiny components ────────────────────────────────────────────────────────────
function Chip({ label, value, color, bg }) {
  return (
    <div style={{ background: bg || '#fff', border: '1px solid #e2e8f0',
      borderRadius: 12, padding: '12px 14px', textAlign: 'center', minWidth: 80 }}>
      <div style={{ fontSize: 10, color: '#94a3b8', textTransform: 'uppercase',
        letterSpacing: '.07em', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 800, color: color || '#0f172a',
        lineHeight: 1.1 }}>{value}</div>
    </div>
  )
}

function Tag({ children, color, bg }) {
  return (
    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px',
      borderRadius: 99, background: bg, color, whiteSpace: 'nowrap' }}>
      {children}
    </span>
  )
}

const PRI_STYLE = {
  critical: { color: '#dc2626', bg: '#fef2f2' },
  high:     { color: '#d97706', bg: '#fffbeb' },
  normal:   { color: '#16a34a', bg: '#f0fdf4' },
  low:      { color: '#64748b', bg: '#f8fafc' },
}

// ── Scoring Formula Card ───────────────────────────────────────────────────────
const FORMULA_ITEMS = [
  { key:'completion', label:'Task Completion',    weight:0.60, color:'#6366f1',
    desc:'Fraction of tasks fully completed, weighted by priority' },
  { key:'deadline',   label:'Deadline Adherence', weight:0.22, color:'#0ea5e9',
    desc:'Bonus for finishing before deadline; penalty for missing it' },
  { key:'energy',     label:'Energy Efficiency',  weight:0.10, color:'#22c55e',
    desc:'Penalises high worker fatigue and stress spikes' },
  { key:'dependency', label:'Dependency Bonus',   weight:0.05, color:'#f59e0b',
    desc:'Reward for respecting task dependency order' },
  { key:'interrupt',  label:'Interruption Bonus', weight:0.03, color:'#f43f5e',
    desc:'Reward for minimising context-switching interruptions' },
]

function ScoringFormulaCard() {
  return (
    <div style={{ background:'#fff', border:'1px solid #e2e8f0',
      borderRadius:14, padding:'20px 20px 16px', marginBottom:16 }}>

      <div style={{ marginBottom:16 }}>
        <div style={{ fontSize:14, fontWeight:800, color:'#0f172a', marginBottom:4 }}>
          Reward Scoring Formula
        </div>
        <div style={{ fontSize:11, color:'#64748b' }}>
          Each action is scored on 5 dimensions. Weights reflect cognitive-load research priorities.
        </div>
      </div>

      {/* Stacked weight bar */}
      <div style={{ marginBottom:16 }}>
        <div style={{ fontSize:10, color:'#94a3b8', fontWeight:700, textTransform:'uppercase',
          letterSpacing:'.07em', marginBottom:6 }}>Weight distribution</div>
        <div style={{ display:'flex', height:18, borderRadius:99, overflow:'hidden',
          boxShadow:'0 1px 4px #0001' }}>
          {FORMULA_ITEMS.map(it => (
            <div key={it.key} title={`${it.label}: ×${it.weight}`}
              style={{ width:`${it.weight * 100}%`, background:it.color,
                display:'flex', alignItems:'center', justifyContent:'center' }}>
              {it.weight >= 0.10 && (
                <span style={{ fontSize:9, color:'#fff', fontWeight:800 }}>
                  {(it.weight * 100).toFixed(0)}%
                </span>
              )}
            </div>
          ))}
        </div>
        <div style={{ display:'flex', marginTop:5 }}>
          {FORMULA_ITEMS.map(it => (
            <div key={it.key} style={{ width:`${it.weight * 100}%`,
              textAlign:'center', fontSize:8.5, color:it.color, fontWeight:700,
              overflow:'hidden', whiteSpace:'nowrap' }}>
              {it.weight >= 0.08 ? it.label.split(' ')[0] : ''}
            </div>
          ))}
        </div>
      </div>

      {/* Component cards */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:10,
        marginBottom:14 }}>
        {FORMULA_ITEMS.map(it => (
          <div key={it.key} style={{
            background:`${it.color}08`,
            border:`1.5px solid ${it.color}30`,
            borderRadius:12, padding:'12px 12px 10px',
            position:'relative', overflow:'hidden',
          }}>
            <div style={{ position:'absolute', top:0, left:0, right:0,
              height:4, background:it.color, borderRadius:'12px 12px 0 0' }}/>
            <div style={{ display:'inline-flex', alignItems:'center',
              background:it.color, color:'#fff', borderRadius:99,
              padding:'2px 9px', fontSize:13, fontWeight:900,
              marginBottom:8, marginTop:2 }}>
              ×{it.weight.toFixed(2)}
            </div>
            <div style={{ fontSize:11, fontWeight:700, color:'#1e293b',
              marginBottom:4, lineHeight:1.3 }}>
              {it.label}
            </div>
            <div style={{ fontSize:10, color:'#64748b', lineHeight:1.4 }}>
              {it.desc}
            </div>
          </div>
        ))}
      </div>

      {/* Formula expression */}
      <div style={{ background:'#f8fafc', borderRadius:10,
        padding:'12px 16px', border:'1px solid #e2e8f0' }}>
        <div style={{ fontSize:10, color:'#94a3b8', fontWeight:700,
          textTransform:'uppercase', letterSpacing:'.07em', marginBottom:6 }}>
          Formula
        </div>
        <div style={{ fontFamily:'monospace', fontSize:12, lineHeight:1.8,
          display:'flex', flexWrap:'wrap', gap:'0 4px', alignItems:'center' }}>
          <span style={{ color:'#0f172a', fontWeight:700 }}>score =</span>
          {FORMULA_ITEMS.map((it, idx) => (
            <span key={it.key}>
              <span style={{ color:it.color, fontWeight:800 }}>
                {it.key === 'completion' ? 'completion' :
                 it.key === 'deadline'   ? 'deadline' :
                 it.key === 'energy'     ? 'energy' :
                 it.key === 'dependency' ? 'dep' : 'interrupt'}×{it.weight}
              </span>
              {idx < FORMULA_ITEMS.length - 1 &&
                <span style={{ color:'#94a3b8' }}> + </span>}
            </span>
          ))}
          <span style={{ color:'#94a3b8', marginLeft:6 }}>∈ (0.01, 0.99)</span>
        </div>
      </div>
    </div>
  )
}

// ── Main Dashboard ─────────────────────────────────────────────────────────────
export default function Dashboard() {
  // ── mode: 'stream' (auto-play via SSE) | 'manual' (interactive) ────────────
  const [mode, setMode]       = useState('stream')
  const [difficulty, setDiff] = useState('medium')
  const diffRef = useRef('medium')
  useEffect(() => { diffRef.current = difficulty }, [difficulty])

  // ── stream state ──────────────────────────────────────────────────────────
  const [streaming, setStreaming]   = useState(false)
  const [streamDone, setStreamDone] = useState(false)
  const [currentStep, setCurrentStep] = useState(null)
  const [rewardTrace,  setRwTrace]  = useState([])
  const [energyTrace,  setEnTrace]  = useState([])
  const [stressTrace,  setStTrace]  = useState([])
  const [tasks,        setTasks]    = useState([])
  const [driftAlerts,  setDrift]    = useState([])
  const [finalScore,   setFinal]    = useState(null)
  const [currentAction, setAction]  = useState(null)
  const [episodeCount, setEpCount]  = useState(0)
  // history of scores across replays: [{ep, score, difficulty, steps}]
  const [history,      setHistory]  = useState([])
  const esRef        = useRef(null)
  const replayTimer  = useRef(null)

  // ── manual state ──────────────────────────────────────────────────────────
  const [sessionId,   setSession]   = useState(null)
  const [obs,         setObs]       = useState(null)
  const [manLogs,     setManLogs]   = useState([])
  const [manRewards,  setManRw]     = useState([])
  const [manDone,     setManDone]   = useState(false)
  const [loading,     setLoading]   = useState(false)
  const [error,       setError]     = useState(null)
  const logRef = useRef(null)

  // ── SSE streaming ─────────────────────────────────────────────────────────
  const startStream = useCallback((diff) => {
    const d = (typeof diff === 'string' && diff) ? diff : diffRef.current
    if (esRef.current)   { esRef.current.close(); esRef.current = null }
    if (replayTimer.current) { clearTimeout(replayTimer.current); replayTimer.current = null }

    // Reset per-episode state (keep history)
    setStreaming(true); setStreamDone(false); setFinal(null)
    setCurrentStep(null); setAction(null)
    setRwTrace([]); setEnTrace([]); setStTrace([])
    setTasks([]); setDrift([])
    setEpCount(prev => prev + 1)

    // Tracks whether this episode finished cleanly so onerror can ignore
    // the connection-close the browser fires after the server ends the stream.
    const episodeDone = { current: false }

    const es = new EventSource(`${API}/stream/run?difficulty=${d}&delay_ms=350`)
    esRef.current = es

    es.onmessage = (ev) => {
      let msg
      try { msg = JSON.parse(ev.data) } catch { return }
      if (!msg || typeof msg !== 'object') return

      const num = (v, fallback = 0) => (typeof v === 'number' && !isNaN(v) ? v : fallback)

      if (msg.type === 'reset') {
        setTasks(Array.isArray(msg.tasks) ? msg.tasks : [])
        setEnTrace([num(msg.energy, 1)])
        setStTrace([num(msg.stress, 0)])
      }

      if (msg.type === 'step') {
        setCurrentStep(num(msg.step, 0))
        setAction(msg.action || null)
        setTasks(Array.isArray(msg.tasks) ? msg.tasks : [])
        setRwTrace(prev => [...prev, num(msg.reward)])
        setEnTrace(prev => [...prev, num(msg.energy, 1)])
        setStTrace(prev => [...prev, num(msg.stress, 0)])
        if (msg.schema_drift) setDrift(prev => [...prev, msg.schema_drift])

        if (msg.done) {
          episodeDone.current = true
          const score = typeof msg.final_score === 'number' ? msg.final_score : null
          setFinal(score)
          setStreamDone(true)
          setStreaming(false)
          setHistory(prev => [
            { ep: prev.length + 1, score, difficulty: d, steps: num(msg.step, 0) },
            ...prev.slice(0, 9),
          ])
          es.close(); esRef.current = null
        }
      }

      if (msg.type === 'error') {
        setError(msg.message || 'Unknown error')
        setStreaming(false)
        es.close(); esRef.current = null
      }
    }

    es.onerror = () => {
      // When the server closes the stream after a clean episode end, the browser
      // fires onerror. Ignore it — only show an error for genuine disconnects.
      if (episodeDone.current) return
      setError('Stream disconnected. Check backend is running, then press Play again.')
      setStreaming(false)
      es.close(); esRef.current = null
    }
  }, []) // stable — reads difficulty through diffRef, never needs to be recreated

  const stopStream = () => {
    if (esRef.current)   { esRef.current.close(); esRef.current = null }
    if (replayTimer.current) { clearTimeout(replayTimer.current); replayTimer.current = null }
    setStreaming(false)
  }

  // Cleanup on unmount only
  useEffect(() => () => {
    if (esRef.current)       esRef.current.close()
    if (replayTimer.current) clearTimeout(replayTimer.current)
  }, [])

  // ── Manual episode helpers ────────────────────────────────────────────────
  const handleReset = async () => {
    setLoading(true); setError(null); setManRw([]); setManLogs([]); setManDone(false)
    try {
      const r = await fetch(`${API}/reset`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task_id: difficulty }),
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const d = await r.json()
      setSession(d.session_id); setObs(d.observation)
      setManLogs([{ type: 'system', msg: `Episode started (${difficulty})` }])
    } catch (err) {
      setError(err.message)
    } finally { setLoading(false) }
  }

  const handleAction = async (type, taskId = null) => {
    if (!sessionId) return
    setLoading(true)
    const action = { type }; if (taskId) action.task_id = taskId
    try {
      const r = await fetch(`${API}/step`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId, action }),
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const d = await r.json()
      setObs(d.observation)
      setManRw(prev => [...prev, d.reward])
      setManLogs(prev => [...prev, {
        type: d.reward >= 0 ? 'pos' : 'neg',
        msg: `${type}${taskId ? ' ' + taskId : ''} → ${d.reward?.toFixed(3)}`,
      }])
      if (d.done) {
        setManLogs(prev => [...prev, {
          type: 'system',
          msg: `Done. Final score: ${d.info?.final_score?.toFixed(4) ?? 'N/A'}`,
        }])
        setSession(null)
        setManDone(true)
      }
      setTimeout(() => {
        if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
      }, 50)
    } catch (err) {
      setError(err.message)
    } finally { setLoading(false) }
  }

  // ── Derived stream metrics ────────────────────────────────────────────────
  const totalReward   = rewardTrace.reduce((s, v) => s + v, 0)
  const lastEnergy    = energyTrace[energyTrace.length - 1] ?? null
  const lastStress    = stressTrace[stressTrace.length - 1] ?? null
  const tasksDone     = tasks.filter(t => t.progress >= 1.0).length
  const manTasks      = obs?.tasks || []
  const manWorkers    = obs?.visible_state?.workers || []
  const manW0         = manWorkers[0] || {}

  // ── card ──────────────────────────────────────────────────────────────────
  const card = (extra = {}) => ({
    background: '#fff', border: '1px solid #e2e8f0',
    borderRadius: 14, padding: 16, ...extra,
  })
  const section = { fontSize: 10, fontWeight: 700, color: '#94a3b8',
    textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 10 }

  return (
    <div>
      {/* ── Top controls ───────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center',
        marginBottom: 16, flexWrap: 'wrap' }}>
        {/* Mode toggle */}
        <div style={{ display: 'flex', background: '#e2e8f0', borderRadius: 10, padding: 3 }}>
          {[['stream', 'Auto-Play'], ['manual', 'Manual']].map(([id, lbl]) => (
            <button key={id} onClick={() => setMode(id)}
              style={{ padding: '7px 14px', borderRadius: 8, border: 'none',
                background: mode === id ? '#fff' : 'transparent',
                fontWeight: 600, fontSize: 13, cursor: 'pointer',
                boxShadow: mode === id ? '0 1px 3px rgba(0,0,0,.15)' : 'none',
                color: mode === id ? '#0f172a' : '#64748b',
              }}>{lbl}</button>
          ))}
        </div>

        {/* Difficulty */}
        <select value={difficulty}
          onChange={e => setDiff(e.target.value)}
          style={{ border: '1px solid #e2e8f0', borderRadius: 8,
            padding: '8px 12px', fontSize: 13, background: '#fff' }}>
          {['easy','medium','hard','expert'].map(l => (
            <option key={l} value={l}>{l.charAt(0).toUpperCase()+l.slice(1)}</option>
          ))}
        </select>

        {/* Action button */}
        {mode === 'stream' ? (
          streaming
            ? <button onClick={stopStream}
                style={{ background: '#ef4444', color: '#fff', border: 'none',
                  borderRadius: 8, padding: '8px 20px', fontWeight: 700,
                  fontSize: 13, cursor: 'pointer' }}>Stop</button>
            : !streamDone && (
                <button onClick={() => startStream()}
                  style={{ background: '#6366f1', color: '#fff', border: 'none',
                    borderRadius: 8, padding: '8px 20px', fontWeight: 700,
                    fontSize: 13, cursor: 'pointer' }}>
                  Play Episode
                </button>
              )
        ) : (
          !manDone && (
            <button onClick={handleReset} disabled={loading}
              style={{ background: loading ? '#94a3b8' : '#6366f1', color: '#fff',
                border: 'none', borderRadius: 8, padding: '8px 20px', fontWeight: 700,
                fontSize: 13, cursor: loading ? 'not-allowed' : 'pointer' }}>
              {loading ? 'Loading…' : sessionId ? 'Reset' : 'Start'}
            </button>
          )
        )}

        {streaming && (
          <span style={{ fontSize: 12, color: '#6366f1', fontWeight: 700,
            background: '#eef2ff', border: '1px solid #c7d2fe', borderRadius: 8,
            padding: '5px 12px', animation: 'pulse 1.2s ease-in-out infinite' }}>
            ● LIVE · Episode #{episodeCount}
          </span>
        )}

        {streamDone && (
          <span style={{ fontSize: 13, fontWeight: 700, color: '#16a34a',
            background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8,
            padding: '6px 14px' }}>
            Episode #{episodeCount} Complete
            {typeof finalScore === 'number' ? ` · Score: ${finalScore.toFixed(4)}` : ''}
          </span>
        )}
      </div>

      {/* ── Error banner ───────────────────────────────────────────────────── */}
      {error && (
        <div style={{ background: '#fef2f2', border: '1px solid #fca5a5',
          borderRadius: 10, padding: '10px 14px', marginBottom: 14,
          fontSize: 13, color: '#dc2626' }}>
          {error}&ensp;
          <button onClick={() => setError(null)}
            style={{ background: 'none', border: 'none', cursor: 'pointer',
              color: '#dc2626', fontWeight: 700 }}>x</button>
        </div>
      )}

      {/* ── Schema drift alerts ────────────────────────────────────────────── */}
      {driftAlerts.map((d, i) => (
        <div key={i} style={{ background: '#fffbeb', border: '1px solid #fcd34d',
          borderRadius: 10, padding: '10px 14px', marginBottom: 10,
          fontSize: 13, color: '#92400e', fontWeight: 600 }}>
          Schema Drift @ step {d.step}: {d.message}
        </div>
      ))}

      {/* ═══════════════════ STREAM MODE ═══════════════════════════════════ */}
      {mode === 'stream' && (
        <>
          {/* Episode complete banner */}
          {streamDone && (
            <div style={{
              background: 'linear-gradient(135deg,#16a34a 0%,#0ea5e9 100%)',
              borderRadius: 14, padding: '18px 24px', marginBottom: 16,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              flexWrap: 'wrap', gap: 12,
            }}>
              <div>
                <div style={{ fontSize: 18, fontWeight: 900, color: '#fff', letterSpacing: '-0.3px' }}>
                  Episode #{episodeCount} Complete
                </div>
                <div style={{ fontSize: 12, color: '#d1fae5', marginTop: 2 }}>
                  Final results frozen below — all charts and task data preserved
                </div>
              </div>
              {typeof finalScore === 'number' && (
                <div style={{ background: 'rgba(255,255,255,0.2)', borderRadius: 12,
                  padding: '10px 20px', textAlign: 'center' }}>
                  <div style={{ fontSize: 11, color: '#d1fae5', fontWeight: 700,
                    textTransform: 'uppercase', letterSpacing: '.06em' }}>Final Score</div>
                  <div style={{ fontSize: 28, fontWeight: 900, color: '#fff',
                    lineHeight: 1.1 }}>{finalScore.toFixed(4)}</div>
                </div>
              )}
            </div>
          )}

          {/* Metric chips */}
          {(streaming || streamDone) && (
            <div style={{ display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(90px,1fr))',
              gap: 10, marginBottom: 16 }}>
              <Chip label="Step"    value={currentStep ?? '—'} color="#6366f1" />
              <Chip label="∑ Reward" value={totalReward.toFixed(2)}
                color={totalReward >= 0 ? '#16a34a' : '#ef4444'} />
              <Chip label="Energy"  value={lastEnergy !== null ? lastEnergy.toFixed(2) : '—'}
                color={lastEnergy < 0.3 ? '#ef4444' : lastEnergy < 0.6 ? '#f59e0b' : '#22c55e'} />
              <Chip label="Stress"  value={lastStress !== null ? lastStress.toFixed(2) : '—'}
                color={lastStress > 0.7 ? '#ef4444' : lastStress > 0.4 ? '#f59e0b' : '#22c55e'} />
              <Chip label="Done"    value={`${tasksDone}/${tasks.length}`} color="#0ea5e9" />
              {currentAction && (
                <Chip label="Action"
                  value={currentAction.type + (currentAction.task_id ? ' ' + currentAction.task_id : '')}
                  color="#6366f1"
                  bg={currentAction.type === 'focus' ? '#eef2ff' : '#f8fafc'}
                />
              )}
            </div>
          )}

          {/* Charts row */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr',
            gap: 14, marginBottom: 14 }}>
            {/* Reward curve */}
            <div style={card()}>
              <div style={section}>Reward / Step</div>
              <LineChart data={rewardTrace} color="#6366f1" height={130}
                label="Press Play Episode to start" />
              {rewardTrace.length > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between',
                  fontSize: 11, color: '#64748b', marginTop: 6 }}>
                  <span>Min: {Math.min(...rewardTrace).toFixed(3)}</span>
                  <span>Max: {Math.max(...rewardTrace).toFixed(3)}</span>
                  <span>Steps: {rewardTrace.length}</span>
                </div>
              )}
            </div>

            {/* Energy + Stress dual chart */}
            <div style={card()}>
              <div style={{ ...section, display: 'flex', justifyContent: 'space-between',
                alignItems: 'center' }}>
                <span>Energy & Stress</span>
                <span style={{ fontSize: 10, fontWeight: 400 }}>
                  <span style={{ color: '#22c55e', fontWeight: 700 }}>─</span> Energy&ensp;
                  <span style={{ color: '#f59e0b', fontWeight: 700 }}>╌</span> Stress
                </span>
              </div>
              <DualChart energy={energyTrace} stress={stressTrace} height={130} />
              {energyTrace.length > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between',
                  fontSize: 11, color: '#64748b', marginTop: 6 }}>
                  <span>Min E: {Math.min(...energyTrace).toFixed(2)}</span>
                  <span>Max S: {Math.max(...stressTrace).toFixed(2)}</span>
                </div>
              )}
            </div>

            {/* Task completion */}
            <div style={card({ overflow: 'auto', maxHeight: 200 })}>
              <div style={section}>Task Progress</div>
              {tasks.length === 0 && (
                <div style={{ color: '#cbd5e1', fontSize: 12, padding: '20px 0',
                  textAlign: 'center' }}>
                  Episode not started
                </div>
              )}
              {tasks.map(t => {
                const ps = PRI_STYLE[t.priority] || PRI_STYLE.normal
                return (
                  <div key={t.id} style={{ marginBottom: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between',
                      alignItems: 'center', marginBottom: 3 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: '#334155' }}>
                        {t.task_type} <span style={{ color: '#94a3b8', fontWeight: 400 }}>#{t.id}</span>
                      </span>
                      <Tag color={ps.color} bg={ps.bg}>{t.priority}</Tag>
                    </div>
                    <div style={{ height: 5, background: '#f1f5f9', borderRadius: 99 }}>
                      <div style={{
                        height: 5, borderRadius: 99,
                        width: `${t.progress * 100}%`,
                        background: t.progress >= 1 ? '#22c55e' : '#6366f1',
                        transition: 'width .3s ease',
                      }} />
                    </div>
                    <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>
                      {(t.progress * 100).toFixed(0)}%
                      {t.deadline ? ` · deadline: step ${t.deadline}` : ''}
                      {t.is_interrupted ? ' (interrupted)' : ''}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Cumulative reward + episode history */}
          {rewardTrace.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 14 }}>
              <div style={card({ marginBottom: 0 })}>
                <div style={section}>Cumulative Reward — Episode #{episodeCount}</div>
                <LineChart
                  data={rewardTrace.reduce((acc, v) => {
                    acc.push((acc[acc.length - 1] || 0) + v); return acc
                  }, [])}
                  color="#0ea5e9" height={80}
                />
              </div>

              {history.length > 0 && (
                <div style={{ ...card({ marginBottom: 0 }), minWidth: 220 }}>
                  <div style={section}>Episode History</div>
                  <div style={{ fontFamily: 'monospace', fontSize: 11 }}>
                    {history.map(h => {
                      const sc = typeof h.score === 'number' ? h.score : null
                      const col = sc == null ? '#64748b'
                        : sc >= 0.5 ? '#16a34a' : sc >= 0.3 ? '#f59e0b' : '#ef4444'
                      const diff = typeof h.difficulty === 'string' ? h.difficulty : '—'
                      const steps = typeof h.steps === 'number' ? h.steps : 0
                      return (
                        <div key={h.ep} style={{ display: 'flex', gap: 8,
                          padding: '3px 0', borderBottom: '1px solid #f8fafc', color: col }}>
                          <span style={{ color: '#94a3b8', minWidth: 24 }}>#{h.ep}</span>
                          <span style={{ textTransform: 'capitalize', minWidth: 52,
                            color: '#475569' }}>{diff}</span>
                          <span style={{ fontWeight: 700 }}>{sc != null ? sc.toFixed(4) : '—'}</span>
                          <span style={{ color: '#94a3b8' }}>{steps}s</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* ═══════════════════ MANUAL MODE ════════════════════════════════════ */}
      {mode === 'manual' && (
        <>
          {/* Manual episode complete banner */}
          {manDone && (
            <div style={{
              background: 'linear-gradient(135deg,#6366f1 0%,#0ea5e9 100%)',
              borderRadius: 14, padding: '18px 24px', marginBottom: 16,
              display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
            }}>
              <div style={{ fontSize: 18, fontWeight: 900, color: '#fff' }}>
                Manual Episode Complete
              </div>
              <div style={{ fontSize: 12, color: '#c7d2fe' }}>
                All results frozen — task log and reward chart preserved below
              </div>
            </div>
          )}

          {/* Worker metric chips */}
          {(manWorkers.length > 0 || manDone) && obs && (
            <div style={{ display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(90px,1fr))',
              gap: 10, marginBottom: 16 }}>
              <Chip label="Fatigue" value={manW0.fatigue_level || '—'}
                color={manW0.fatigue_level === 'high' ? '#ef4444'
                  : manW0.fatigue_level === 'medium' ? '#f59e0b' : '#22c55e'} />
              <Chip label="Stress" value={manW0.stress_level || '—'}
                color={manW0.stress_level === 'critical' ? '#ef4444'
                  : manW0.stress_level === 'elevated' ? '#f59e0b' : '#22c55e'} />
              <Chip label="Step"  value={obs?.time_step ?? '—'} color="#6366f1" />
              <Chip label="Done"
                value={`${manTasks.filter(t => t.progress >= 1).length}/${manTasks.length}`}
                color="#0ea5e9" />
              <Chip label="∑ Reward"
                value={manRewards.reduce((s, v) => s + v, 0).toFixed(2)}
                color={manRewards.reduce((s, v) => s + v, 0) >= 0 ? '#16a34a' : '#ef4444'} />
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
            {/* Task list */}
            <div style={card()}>
              <div style={section}>Task Queue</div>
              {manTasks.length === 0 && (
                <div style={{ color: '#cbd5e1', fontSize: 13, textAlign: 'center', padding: 24 }}>
                  Press Start to begin
                </div>
              )}
              {manTasks.map(task => {
                const ps = PRI_STYLE[task.priority] || PRI_STYLE.normal
                return (
                  <div key={task.id} style={{ display: 'flex', alignItems: 'center',
                    gap: 8, padding: '8px 0', borderBottom: '1px solid #f1f5f9' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>
                        {task.task_type}&ensp;
                        <span style={{ fontSize: 10, color: '#94a3b8' }}>#{task.id}</span>
                      </div>
                      <div style={{ fontSize: 11, color: '#94a3b8' }}>
                        {task.deadline ? `deadline: ${task.deadline}` : 'no deadline'}
                        {task.depends_on ? ` · depends: ${task.depends_on}` : ''}
                      </div>
                      <div style={{ height: 4, background: '#f1f5f9', borderRadius: 99, marginTop: 4 }}>
                        <div style={{ height: 4, borderRadius: 99,
                          width: `${task.progress * 100}%`,
                          background: task.progress >= 1 ? '#22c55e' : '#6366f1',
                          transition: 'width .25s' }} />
                      </div>
                    </div>
                    <Tag color={ps.color} bg={ps.bg}>{task.priority}</Tag>
                    {sessionId && task.progress < 1.0 && (
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button onClick={() => handleAction('work', task.id)}
                          style={{ fontSize: 11, padding: '4px 9px', borderRadius: 6,
                            border: '1px solid #e2e8f0', background: '#f8fafc',
                            cursor: 'pointer', fontWeight: 600 }}>work</button>
                        <button onClick={() => handleAction('focus', task.id)}
                          style={{ fontSize: 11, padding: '4px 9px', borderRadius: 6,
                            border: '1px solid #6366f1', background: '#eef2ff',
                            color: '#6366f1', cursor: 'pointer', fontWeight: 600 }}>focus</button>
                      </div>
                    )}
                  </div>
                )
              })}
              {sessionId && (
                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                  <button onClick={() => handleAction('break')}
                    style={{ flex: 1, padding: 9, borderRadius: 8,
                      border: '1px solid #e2e8f0', background: '#f0fdf4',
                      color: '#16a34a', fontWeight: 700, cursor: 'pointer', fontSize: 13 }}>
                    Break</button>
                  <button onClick={() => handleAction('delay')}
                    style={{ flex: 1, padding: 9, borderRadius: 8,
                      border: '1px solid #e2e8f0', background: '#f8fafc',
                      color: '#64748b', fontWeight: 700, cursor: 'pointer', fontSize: 13 }}>
                    Delay</button>
                </div>
              )}
            </div>

            {/* Reward chart */}
            <div style={card()}>
              <div style={section}>Reward / Step</div>
              <LineChart data={manRewards} color="#6366f1" height={160}
                label="Rewards appear here as you act" />
              {manRewards.length > 0 && (
                <div style={{ display: 'flex', gap: 20, marginTop: 8 }}>
                  {[
                    { l: 'Total', v: manRewards.reduce((s,v)=>s+v,0).toFixed(3) },
                    { l: 'Mean',  v: (manRewards.reduce((s,v)=>s+v,0)/manRewards.length).toFixed(3) },
                    { l: 'Steps', v: manRewards.length },
                  ].map(s => (
                    <div key={s.l} style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 10, color: '#94a3b8' }}>{s.l}</div>
                      <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a' }}>{s.v}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Action log */}
          <div style={card()}>
            <div style={section}>Action Log</div>
            <div ref={logRef} style={{ height: 110, overflowY: 'auto',
              fontFamily: 'monospace', fontSize: 12 }}>
              {manLogs.length === 0 && (
                <span style={{ color: '#cbd5e1' }}>No actions yet…</span>
              )}
              {manLogs.map((l, i) => (
                <div key={i} style={{ padding: '1px 0',
                  color: l.type === 'pos' ? '#16a34a'
                    : l.type === 'neg' ? '#ef4444' : '#64748b' }}>
                  [{i}] {l.msg}
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* ── Reward scoring formula — always visible ── */}
      <div style={{ marginTop: 20 }}>
        <ScoringFormulaCard />
      </div>

      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }
      `}</style>
    </div>
  )
}
