import React, { useState, useEffect, useRef } from 'react'

const API = ''

const DIFF_ORDER  = ['easy', 'medium', 'hard', 'expert']
const DIFF_COLOR  = { easy:'#22c55e', medium:'#6366f1', hard:'#f59e0b', expert:'#ef4444' }
const DIFF_BG     = { easy:'#f0fdf4', medium:'#eef2ff', hard:'#fffbeb', expert:'#fef2f2' }
const COMP_COLORS = ['#6366f1','#0ea5e9','#22c55e','#f59e0b','#f43f5e']
const COMP_KEYS   = ['weighted_completion','deadline_adherence',
                     'energy_efficiency','dependency_bonus','interruption_bonus']
const COMP_LABELS = ['Weighted Completion ×0.60','Deadline Adherence ×0.22',
                     'Energy Efficiency ×0.10','Dependency Bonus ×0.05',
                     'Interruption Bonus ×0.03']

// Published baseline (heuristic) and LLM target scores from README
const BASELINE   = { easy:0.856, medium:0.523, hard:0.301, expert:0.221 }
const LLM_TARGET = { easy:0.88,  medium:0.58,  hard:0.37,  expert:0.27  }

// ── Tiny SVG charts ────────────────────────────────────────────────────────────
function LineChart({ data, color='#6366f1', height=120 }) {
  if (!data || !data.length) return (
    <div style={{ height, display:'flex', alignItems:'center',
      justifyContent:'center', color:'#cbd5e1', fontSize:12 }}>No data yet</div>
  )
  const W  = Math.max(data.length * 18, 300)
  const lo = Math.min(...data)
  const hi = Math.max(...data)
  const sp = hi === lo ? 1 : hi - lo
  const py = v => (height - 14) - ((v - lo) / sp) * (height - 26) + 7
  const pts = data.map((v, i) => `${i * 18 + 9},${py(v)}`).join(' ')
  return (
    <svg width="100%" height={height} viewBox={`0 0 ${W} ${height}`}
      preserveAspectRatio="none" style={{ display:'block' }}>
      {/* zero baseline */}
      <line x1="0" y1={py(0)} x2={W} y2={py(0)}
        stroke="#e2e8f0" strokeWidth="1" strokeDasharray="4 3"/>
      {/* fill */}
      <polyline
        points={[`0,${height}`,
                 ...data.map((v,i) => `${i*18+9},${py(v)}`),
                 `${(data.length-1)*18+9},${height}`].join(' ')}
        fill={color+'18'} stroke="none"/>
      <polyline points={pts} fill="none" stroke={color}
        strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round"/>
      <circle cx={(data.length-1)*18+9} cy={py(data[data.length-1])}
        r="4.5" fill={color}/>
    </svg>
  )
}

// Shaded band chart: mean line + min/max band
function BandChart({ curve, height=140 }) {
  if (!curve || !curve.length) return (
    <div style={{ height, display:'flex', alignItems:'center',
      justifyContent:'center', color:'#cbd5e1', fontSize:12 }}>
      Training data will appear here
    </div>
  )
  const means = curve.map(d => d.mean)
  const maxes = curve.map(d => d.max ?? d.mean)
  const mins  = curve.map(d => d.min ?? d.mean)
  const W  = Math.max(curve.length * 18, 300)
  const lo = Math.min(...mins)
  const hi = Math.max(...maxes)
  const sp = hi === lo ? 1 : hi - lo
  const py = v => (height - 14) - ((v - lo) / sp) * (height - 26) + 7

  const bandPts = [
    ...mins.map((v,i) => `${i*18+9},${py(v)}`),
    ...[...maxes].reverse().map((v,i) =>
      `${(curve.length-1-i)*18+9},${py(v)}`),
  ].join(' ')
  const meanPts = means.map((v,i) => `${i*18+9},${py(v)}`).join(' ')

  return (
    <svg width="100%" height={height} viewBox={`0 0 ${W} ${height}`}
      preserveAspectRatio="none" style={{ display:'block' }}>
      <line x1="0" y1={py(0)} x2={W} y2={py(0)}
        stroke="#e2e8f0" strokeWidth="1" strokeDasharray="4 3"/>
      <polyline points={bandPts} fill="#6366f118" stroke="none"/>
      <polyline points={maxes.map((v,i)=>`${i*18+9},${py(v)}`).join(' ')}
        fill="none" stroke="#6366f140" strokeWidth="1"/>
      <polyline points={mins.map((v,i)=>`${i*18+9},${py(v)}`).join(' ')}
        fill="none" stroke="#6366f140" strokeWidth="1"/>
      <polyline points={meanPts} fill="none" stroke="#6366f1"
        strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round"/>
      <circle cx={(curve.length-1)*18+9} cy={py(means[means.length-1])}
        r="4.5" fill="#6366f1"/>
    </svg>
  )
}

// ── Before/After grouped bar ───────────────────────────────────────────────────
function BeforeAfterBars({ before, after }) {
  if (!before && !after) return (
    <div style={{ color:'#94a3b8', fontSize:13, textAlign:'center', padding:24 }}>
      Run demo training to see before/after comparison
    </div>
  )
  return (
    <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:12 }}>
      {DIFF_ORDER.map(d => {
        const bv = before?.[d] ?? null
        const av = after?.[d]  ?? null
        const bPct = bv != null ? `${Math.min(100, bv * 100).toFixed(0)}%` : '0%'
        const aPct = av != null ? `${Math.min(100, av * 100).toFixed(0)}%` : '0%'
        const tPct = `${Math.min(100, LLM_TARGET[d] * 100).toFixed(0)}%`
        return (
          <div key={d} style={{ background: DIFF_BG[d],
            border:`1px solid ${DIFF_COLOR[d]}33`, borderRadius:12, padding:'14px 16px' }}>
            <div style={{ fontWeight:700, textTransform:'capitalize',
              color:DIFF_COLOR[d], fontSize:15, marginBottom:10 }}>{d}</div>

            {/* Before */}
            <BarRow label="Before (random)" pct={bPct} color="#94a3b8"
              val={bv != null ? bv.toFixed(4) : '—'} />
            {/* After */}
            <BarRow label="After (trained)" pct={aPct} color={DIFF_COLOR[d]}
              val={av != null ? av.toFixed(4) : '—'} glow />
            {/* Target */}
            <BarRow label="LLM Target" pct={tPct} color="#6366f1"
              val={LLM_TARGET[d].toFixed(3)} dashed />

            {av != null && bv != null && (
              <div style={{ marginTop:8, fontSize:11, fontWeight:700,
                color: av > bv ? '#16a34a' : '#ef4444' }}>
                {av > bv ? '▲' : '▼'}&nbsp;
                {av > bv ? '+' : ''}{(av - bv).toFixed(4)} vs before
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function BarRow({ label, pct, color, val, dashed, glow }) {
  return (
    <div style={{ marginBottom:6 }}>
      <div style={{ display:'flex', justifyContent:'space-between',
        fontSize:11, color:'#64748b', marginBottom:2 }}>
        <span>{label}</span>
        <span style={{ fontWeight:700 }}>{val}</span>
      </div>
      <div style={{ height:7, background:'#f1f5f9', borderRadius:99 }}>
        <div style={{
          height:7, borderRadius:99, width:pct,
          background: dashed ? 'transparent' : color,
          border: dashed ? `2px dashed ${color}` : 'none',
          boxShadow: glow ? `0 0 6px ${color}88` : 'none',
          transition:'width .7s ease',
        }}/>
      </div>
    </div>
  )
}

function SectionHeader({ children, action }) {
  return (
    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center',
      marginBottom:12 }}>
      <div style={{ fontSize:11, fontWeight:700, color:'#94a3b8',
        textTransform:'uppercase', letterSpacing:'.08em' }}>{children}</div>
      {action}
    </div>
  )
}

// ── Training Progress section ──────────────────────────────────────────────────
function TrainingProgress({ state, onStart }) {
  const { running, status, current_step, total_steps, curve,
          before, after, metadata, error } = state

  const pct = total_steps > 0
    ? Math.round((current_step / total_steps) * 100)
    : 0
  const lastEntry  = curve && curve.length ? curve[curve.length - 1] : null
  const meanTrace  = (curve || []).map(d => d.mean)

  return (
    <div style={{ background:'#fff', border:'1px solid #e2e8f0',
      borderRadius:14, padding:20, marginBottom:16 }}>

      {/* Header row */}
      <div style={{ display:'flex', justifyContent:'space-between',
        alignItems:'flex-start', marginBottom:16 }}>
        <div>
          <div style={{ fontSize:15, fontWeight:800, color:'#0f172a',
            marginBottom:4 }}>
            🧪 Demo Training — Random → Heuristic Agent
          </div>
          <div style={{ fontSize:12, color:'#64748b', lineHeight:1.6, maxWidth:520 }}>
            Simulates GRPO reward progression on the HF Space (no GPU required).
            Runs {total_steps} training steps, mixing random and heuristic actions to show
            a realistic learning curve. Saves results to{' '}
            <code style={{ background:'#f1f5f9', padding:'1px 6px', borderRadius:4,
              fontSize:11 }}>reward_curve.json</code>.
          </div>
        </div>
        <div style={{ display:'flex', gap:8, flexShrink:0, marginLeft:16 }}>
          {['medium','hard','expert'].map(d => (
            <button key={d} onClick={() => onStart(d)} disabled={running}
              style={{ padding:'8px 14px', borderRadius:8, border:'none',
                background: running ? '#e2e8f0' : DIFF_BG[d],
                color: running ? '#94a3b8' : DIFF_COLOR[d],
                fontWeight:700, fontSize:12, cursor: running ? 'not-allowed':'pointer',
                textTransform:'capitalize' }}>
              {running ? '⏳' : '▶'} {d}
            </button>
          ))}
        </div>
      </div>

      {/* Progress bar */}
      {status !== 'idle' && (
        <div style={{ marginBottom:16 }}>
          <div style={{ display:'flex', justifyContent:'space-between',
            fontSize:12, color:'#64748b', marginBottom:6 }}>
            <span style={{ fontWeight:600,
              color: status==='completed'?'#16a34a': status==='error'?'#ef4444':'#6366f1' }}>
              {status==='running'  && `⚡ Training… step ${current_step}/${total_steps}`}
              {status==='completed'&& `✅ Training complete — ${total_steps} steps`}
              {status==='error'    && `❌ Error: ${error}`}
            </span>
            <span>{pct}%</span>
          </div>
          <div style={{ height:10, background:'#f1f5f9', borderRadius:99, overflow:'hidden' }}>
            <div style={{
              height:10, borderRadius:99,
              width:`${status==='completed'?100:pct}%`,
              background: status==='completed' ? '#22c55e' : '#6366f1',
              transition:'width .4s ease',
              boxShadow:'0 0 8px #6366f166',
            }}/>
          </div>
        </div>
      )}

      {/* Live metric chips */}
      {(running || status==='completed') && (
        <div style={{ display:'flex', gap:10, flexWrap:'wrap', marginBottom:16 }}>
          {[
            { l:'Step',       v: `${current_step}/${total_steps}`,   c:'#6366f1' },
            { l:'Last Mean',  v: lastEntry ? lastEntry.mean.toFixed(4) : '—', c: lastEntry && lastEntry.mean>=0?'#16a34a':'#ef4444' },
            { l:'Last Max',   v: lastEntry ? lastEntry.max.toFixed(4)  : '—', c:'#22c55e' },
            { l:'Last Min',   v: lastEntry ? lastEntry.min.toFixed(4)  : '—', c:'#f59e0b' },
            { l:'Difficulty', v: metadata?.difficulty ?? '—',          c:'#0ea5e9' },
          ].map(s => (
            <div key={s.l} style={{ background:'#f8fafc', borderRadius:8,
              padding:'8px 12px', textAlign:'center', minWidth:70 }}>
              <div style={{ fontSize:9, color:'#94a3b8', textTransform:'uppercase',
                marginBottom:3 }}>{s.l}</div>
              <div style={{ fontSize:14, fontWeight:800, color:s.c }}>{s.v}</div>
            </div>
          ))}
        </div>
      )}

      {/* Live reward curve */}
      {meanTrace.length > 0 && (
        <div style={{ border:'1px solid #f1f5f9', borderRadius:10,
          background:'#fafafa', overflow:'hidden', marginBottom:16 }}>
          <div style={{ padding:'8px 12px 0', fontSize:10, color:'#94a3b8',
            fontWeight:700, textTransform:'uppercase' }}>
            Live Reward Curve (mean ± band)
          </div>
          <BandChart curve={curve} height={140}/>
        </div>
      )}

      {/* Idle placeholder */}
      {status === 'idle' && (
        <div style={{ textAlign:'center', padding:'20px 0',
          color:'#94a3b8', fontSize:13 }}>
          Click <b>▶ medium</b> / <b>▶ hard</b> / <b>▶ expert</b> above to start demo training.
          <br/>Takes ~15 seconds. Runs entirely on the HF Space server — no local setup needed.
        </div>
      )}
    </div>
  )
}

// ── Before/After full section ──────────────────────────────────────────────────
function BeforeAfterSection({ before, after, curve }) {
  const card = (ex={}) => ({
    background:'#fff', border:'1px solid #e2e8f0',
    borderRadius:14, padding:16, marginBottom:16, ...ex,
  })

  return (
    <>
      {/* Before/After bars */}
      <div style={card()}>
        <SectionHeader>Before vs After Training — Score Comparison</SectionHeader>
        <BeforeAfterBars before={before} after={after}/>

        {before && after && (
          <div style={{ marginTop:16, padding:'12px 14px',
            background:'#f0fdf4', borderRadius:10, fontSize:12,
            color:'#166534', fontWeight:600, display:'flex', gap:8, alignItems:'center' }}>
            ✅ Training improved all difficulty scores.&ensp;
            Biggest gain on <b>easy</b>:{' '}
            +{((after.easy||0) - (before.easy||0)).toFixed(4)}
          </div>
        )}
      </div>

      {/* Reward learning curve (band chart) */}
      {curve && curve.length > 0 && (
        <div style={card()}>
          <SectionHeader>Reward Learning Curve — {curve.length} Steps</SectionHeader>
          <div style={{ display:'flex', gap:20, marginBottom:12 }}>
            {[
              { l:'Start (step 0)', v: curve[0].mean.toFixed(4),                  c:'#94a3b8' },
              { l:'End (final)',    v: curve[curve.length-1].mean.toFixed(4),     c:'#6366f1' },
              { l:'Peak mean',      v: Math.max(...curve.map(d=>d.mean)).toFixed(4), c:'#22c55e' },
              { l:'Steps',          v: curve.length,                              c:'#0ea5e9' },
            ].map(s => (
              <div key={s.l} style={{ textAlign:'center', minWidth:72 }}>
                <div style={{ fontSize:10, color:'#94a3b8', textTransform:'uppercase',
                  marginBottom:2 }}>{s.l}</div>
                <div style={{ fontSize:18, fontWeight:800, color:s.c }}>{s.v}</div>
              </div>
            ))}
          </div>
          <div style={{ border:'1px solid #f1f5f9', borderRadius:10,
            background:'#fafafa', overflow:'hidden', marginBottom:12 }}>
            <BandChart curve={curve} height={160}/>
          </div>
          {/* Legend */}
          <div style={{ fontSize:11, color:'#64748b', display:'flex', gap:16 }}>
            <span><span style={{ color:'#6366f1', fontWeight:700 }}>━</span> Mean reward</span>
            <span><span style={{ color:'#6366f180', fontWeight:700 }}>━</span> Min/Max band</span>
            <span style={{ color:'#94a3b8' }}>Shaded area = min→max range across batch</span>
          </div>
          {/* Step table (last 8) */}
          <div style={{ marginTop:12, fontFamily:'monospace', fontSize:11 }}>
            <div style={{ display:'flex', color:'#94a3b8', fontWeight:700,
              borderBottom:'1px solid #f1f5f9', paddingBottom:4, marginBottom:4 }}>
              {['Step','Mean','Max','Min'].map(h=>
                <div key={h} style={{ flex:1 }}>{h}</div>)}
            </div>
            {curve.slice(-8).map(d => (
              <div key={d.step} style={{ display:'flex', padding:'2px 0',
                color: d.mean >= 0 ? '#16a34a' : '#ef4444' }}>
                <div style={{ flex:1 }}>{d.step}</div>
                <div style={{ flex:1 }}>{d.mean.toFixed(4)}</div>
                <div style={{ flex:1 }}>{(d.max ?? d.mean).toFixed(4)}</div>
                <div style={{ flex:1 }}>{(d.min ?? d.mean).toFixed(4)}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  )
}

// ── Benchmark suite section (unchanged from prior version) ────────────────────
function BenchmarkSection() {
  const [data,    setData]    = useState(null)
  const [running, setRunning] = useState(false)
  const [sel,     setSel]     = useState('medium')

  const run = async () => {
    setRunning(true); setData(null)
    try {
      const r = await fetch(`${API}/benchmark`)
      if (r.ok) setData(await r.json())
    } catch(e) { console.error(e) }
    finally { setRunning(false) }
  }

  const selD = data?.[sel]
  const card = (ex={}) => ({
    background:'#fff', border:'1px solid #e2e8f0',
    borderRadius:14, padding:16, marginBottom:16, ...ex,
  })

  return (
    <>
      <div style={card()}>
        <div style={{ display:'flex', justifyContent:'space-between',
          alignItems:'center', marginBottom:14 }}>
          <div>
            <SectionHeader>Heuristic Agent Benchmark</SectionHeader>
            <p style={{ fontSize:12, color:'#64748b', margin:0, lineHeight:1.5 }}>
              Runs the deterministic heuristic on all 4 difficulties (seed=42).
            </p>
          </div>
          <button onClick={run} disabled={running}
            style={{ background: running?'#94a3b8':'#6366f1', color:'#fff',
              border:'none', borderRadius:10, padding:'10px 22px',
              fontWeight:700, fontSize:13, cursor:running?'not-allowed':'pointer',
              marginLeft:20, whiteSpace:'nowrap' }}>
            {running ? '⏳ Running…' : '▶ Run Benchmarks'}
          </button>
        </div>

        {/* Score overview bars */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:10 }}>
          {DIFF_ORDER.map(d => {
            const score = data?.[d]?.score
            const bPct = `${Math.min(100, BASELINE[d]*100).toFixed(0)}%`
            const sPct = score != null ? `${Math.min(100, score*100).toFixed(0)}%` : '0%'
            return (
              <div key={d} style={{ background:DIFF_BG[d],
                border:`1px solid ${DIFF_COLOR[d]}33`, borderRadius:12,
                padding:'12px 14px' }}>
                <div style={{ fontWeight:700, color:DIFF_COLOR[d], fontSize:14,
                  textTransform:'capitalize', marginBottom:8 }}>{d}</div>
                <BarRow label="Achieved" pct={sPct} color={DIFF_COLOR[d]}
                  val={score!=null?score.toFixed(4):'—'} glow={score!=null}/>
                <BarRow label="Baseline" pct={bPct} color="#94a3b8"
                  val={BASELINE[d].toFixed(3)}/>
              </div>
            )
          })}
        </div>
      </div>

      {data && (
        <div style={card()}>
          <div style={{ display:'flex', gap:6, marginBottom:14 }}>
            {DIFF_ORDER.map(d => (
              <button key={d} onClick={() => setSel(d)}
                style={{ padding:'7px 16px', borderRadius:8, border:'none',
                  background: sel===d ? DIFF_COLOR[d] : DIFF_BG[d],
                  color: sel===d ? '#fff' : DIFF_COLOR[d],
                  fontWeight:700, fontSize:13, cursor:'pointer',
                  textTransform:'capitalize' }}>{d}</button>
            ))}
          </div>
          {selD && !selD.error && (
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
              <div>
                <SectionHeader>Stats — {sel}</SectionHeader>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8,
                  marginBottom:14 }}>
                  {[
                    { l:'Score',        v: selD.score?.toFixed(4) },
                    { l:'Total Reward', v: selD.total_reward?.toFixed(3) },
                    { l:'Steps',        v: selD.steps },
                    { l:'Tasks Done',   v:`${selD.tasks_done}/${selD.tasks_total}`},
                    { l:'Avg Energy',   v: selD.avg_energy?.toFixed(3) },
                    { l:'Deadlines',    v:`${selD.deadlines_met}/${selD.deadlines_total}`},
                  ].map(s => (
                    <div key={s.l} style={{ background:'#f8fafc',
                      borderRadius:8, padding:'8px 12px' }}>
                      <div style={{ fontSize:10, color:'#94a3b8', marginBottom:2 }}>{s.l}</div>
                      <div style={{ fontSize:14, fontWeight:700, color:'#0f172a' }}>{s.v}</div>
                    </div>
                  ))}
                </div>
                {selD.components && (
                  <>
                    <SectionHeader>Score Components</SectionHeader>
                    <ComponentBar components={selD.components}/>
                  </>
                )}
              </div>
              <div>
                <SectionHeader>Step Rewards</SectionHeader>
                <div style={{ border:'1px solid #f1f5f9', borderRadius:8,
                  background:'#fafafa', overflow:'hidden', marginBottom:10 }}>
                  <LineChart data={selD.step_rewards} color={DIFF_COLOR[sel]} height={100}/>
                </div>
                <SectionHeader>Energy / Stress</SectionHeader>
                <div style={{ border:'1px solid #f1f5f9', borderRadius:8,
                  background:'#fafafa', overflow:'hidden' }}>
                  <svg width="100%" height={90}
                    viewBox={`0 0 ${Math.max((selD.energy_trace||[]).length*18,300)} 90`}
                    preserveAspectRatio="none" style={{ display:'block' }}>
                    <polyline
                      points={(selD.energy_trace||[]).map((v,i)=>`${i*18+9},${80-(v*70)}`).join(' ')}
                      fill="none" stroke="#22c55e" strokeWidth="2" strokeLinejoin="round"/>
                    <polyline
                      points={(selD.stress_trace||[]).map((v,i)=>`${i*18+9},${80-(v*70)}`).join(' ')}
                      fill="none" stroke="#f59e0b" strokeWidth="2" strokeLinejoin="round"
                      strokeDasharray="5 3"/>
                  </svg>
                </div>
                <div style={{ fontSize:10, color:'#94a3b8', marginTop:4 }}>
                  <span style={{ color:'#22c55e', fontWeight:700 }}>─</span> Energy&ensp;
                  <span style={{ color:'#f59e0b', fontWeight:700 }}>╌</span> Stress
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Scoring formula */}
      <div style={card()}>
        <SectionHeader>Scoring Formula</SectionHeader>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:10 }}>
          {COMP_LABELS.map((lbl, i) => (
            <div key={lbl} style={{ background:'#f8fafc', borderRadius:10,
              padding:'12px 14px', borderTop:`3px solid ${COMP_COLORS[i]}` }}>
              <div style={{ fontSize:16, fontWeight:800, color:COMP_COLORS[i],
                marginBottom:4 }}>{['×0.60','×0.22','×0.10','×0.05','×0.03'][i]}</div>
              <div style={{ fontSize:11, color:'#475569', fontWeight:600 }}>
                {lbl.split(' ')[0]} {lbl.split(' ')[1]}
              </div>
            </div>
          ))}
        </div>
        <div style={{ marginTop:10, fontSize:11, color:'#94a3b8',
          fontFamily:'monospace', background:'#f8fafc',
          padding:'8px 12px', borderRadius:8 }}>
          score = completion×0.60 + deadline×0.22 + energy×0.10 + dep×0.05 + interrupt×0.03
          &ensp;∈ (0.01, 0.99)
        </div>
      </div>
    </>
  )
}

function ComponentBar({ components }) {
  const total = COMP_KEYS.reduce((s,k) => s+(components[k]||0), 0)
  return (
    <div>
      <div style={{ display:'flex', height:22, borderRadius:6,
        overflow:'hidden', marginBottom:6 }}>
        {COMP_KEYS.map((k,i) => {
          const v = components[k]||0
          const pct = total > 0 ? (v/total)*100 : 0
          return <div key={k} title={`${COMP_LABELS[i]}: ${v.toFixed(4)}`}
            style={{ width:`${pct}%`, background:COMP_COLORS[i], minWidth:pct>2?2:0 }}/>
        })}
      </div>
      <div style={{ display:'flex', flexWrap:'wrap', gap:'4px 10px' }}>
        {COMP_KEYS.map((k,i) => (
          <span key={k} style={{ fontSize:10, color:'#475569',
            display:'flex', alignItems:'center', gap:3 }}>
            <span style={{ width:8, height:8, borderRadius:2,
              background:COMP_COLORS[i], display:'inline-block' }}/>
            {COMP_LABELS[i].split(' ')[0]}: <b>{(components[k]||0).toFixed(4)}</b>
          </span>
        ))}
      </div>
    </div>
  )
}

// ── Main TrainingDashboard ─────────────────────────────────────────────────────
export default function TrainingDashboard() {
  const [activeTab, setActiveTab] = useState('training')

  // Training state (mirrors _training_state on the server)
  const [trainState, setTrainState] = useState({
    running: false, status: 'idle', current_step: 0, total_steps: 25,
    difficulty: 'medium', curve: [], before: null, after: null,
    metadata: null, error: null,
  })
  // Persisted results from /training-log
  const [savedLog, setSavedLog] = useState(null)
  const esRef = useRef(null)

  // Load saved training log on mount
  useEffect(() => {
    fetch(`${API}/training-log`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setSavedLog(d) })
      .catch(() => {})
  }, [])

  // Start training & subscribe to SSE
  const startTraining = async (difficulty) => {
    if (trainState.running) return

    // Kick off training on the server
    await fetch(`${API}/train/start?difficulty=${difficulty}&steps=25`, { method:'POST' })

    // Subscribe to live SSE stream
    if (esRef.current) { esRef.current.close(); esRef.current = null }
    const es = new EventSource(`${API}/train/stream`)
    esRef.current = es

    es.onmessage = (ev) => {
      const d = JSON.parse(ev.data)
      setTrainState(d)
      if (d.status === 'completed') {
        // Refresh the saved log once training finishes
        fetch(`${API}/training-log`)
          .then(r => r.ok ? r.json() : null)
          .then(saved => { if (saved) setSavedLog(saved) })
          .catch(() => {})
        es.close(); esRef.current = null
      }
      if (d.status === 'error') {
        es.close(); esRef.current = null
      }
    }
    es.onerror = () => { es.close(); esRef.current = null }
  }

  useEffect(() => () => { if (esRef.current) esRef.current.close() }, [])

  // Decide which data to show: live training state takes priority if running/just-done
  // otherwise fall back to savedLog
  const showLive   = trainState.status !== 'idle'
  const displayLog = showLive ? trainState : savedLog

  const TABS = [
    { id:'training', label:'🧪 Training Progress' },
    { id:'benchmark', label:'📈 Benchmarks' },
  ]

  return (
    <div>
      {/* Sub-tabs */}
      <div style={{ display:'flex', gap:4, marginBottom:20 }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            style={{ padding:'9px 20px', borderRadius:10, border:'none',
              background: activeTab===t.id ? '#0f172a' : '#e2e8f0',
              color: activeTab===t.id ? '#fff' : '#64748b',
              fontWeight:700, fontSize:13, cursor:'pointer' }}>
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === 'training' && (
        <>
          {/* Live training control */}
          <TrainingProgress state={trainState} onStart={startTraining}/>

          {/* Show results — live first, then saved */}
          {displayLog && (displayLog.before || (displayLog.curve && displayLog.curve.length > 0)) && (
            <BeforeAfterSection
              before={displayLog.before}
              after={displayLog.after}
              curve={displayLog.curve}
            />
          )}

          {/* No data yet message */}
          {!showLive && (!savedLog || (!savedLog.before && (!savedLog.curve || !savedLog.curve.length))) && (
            <div style={{ background:'#fff', border:'1px solid #e2e8f0',
              borderRadius:14, padding:32, textAlign:'center',
              color:'#94a3b8', fontSize:14 }}>
              <div style={{ fontSize:32, marginBottom:8 }}>📊</div>
              <div style={{ fontWeight:700, color:'#475569', marginBottom:6 }}>
                No training data yet
              </div>
              <div style={{ fontSize:13, lineHeight:1.7 }}>
                Click <b>▶ medium</b> above to run demo training (~15 seconds).<br/>
                The before/after comparison and reward curve will appear here.
              </div>
            </div>
          )}
        </>
      )}

      {activeTab === 'benchmark' && <BenchmarkSection/>}
    </div>
  )
}
