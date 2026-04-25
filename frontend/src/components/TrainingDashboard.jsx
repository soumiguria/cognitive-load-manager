import React, { useState, useEffect } from 'react'

const API = ''

// ── colour palette ─────────────────────────────────────────────────────────────
const DIFF_COLOR  = { easy:'#22c55e', medium:'#6366f1', hard:'#f59e0b', expert:'#ef4444' }
const DIFF_BG     = { easy:'#f0fdf4', medium:'#eef2ff', hard:'#fffbeb', expert:'#fef2f2' }
const DIFF_ORDER  = ['easy','medium','hard','expert']
const COMP_COLORS = ['#6366f1','#0ea5e9','#22c55e','#f59e0b','#f43f5e']
const COMP_LABELS = [
  'Weighted Completion ×0.60',
  'Deadline Adherence ×0.22',
  'Energy Efficiency ×0.10',
  'Dependency Bonus ×0.05',
  'Interruption Bonus ×0.03',
]

// Published README baseline scores and LLM target scores
const BASELINE  = { easy:0.856, medium:0.523, hard:0.301, expert:0.221 }
const LLM_TARGET = { easy:0.88,  medium:0.58,  hard:0.37,  expert:0.27  }

// ── Tiny chart helpers ─────────────────────────────────────────────────────────
function LineChart({ data, color='#6366f1', height=110 }) {
  if (!data || !data.length) return (
    <div style={{ height, display:'flex', alignItems:'center',
      justifyContent:'center', color:'#cbd5e1', fontSize:12 }}>No data</div>
  )
  const W = Math.max(data.length * 16, 300)
  const lo = Math.min(...data)
  const hi = Math.max(...data)
  const sp = hi === lo ? 1 : hi - lo
  const py = v => (height-12) - ((v-lo)/sp)*(height-24) + 6
  const pts = data.map((v,i) => `${i*16+8},${py(v)}`).join(' ')
  return (
    <svg width="100%" height={height} viewBox={`0 0 ${W} ${height}`}
      preserveAspectRatio="none" style={{ display:'block' }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2"
        strokeLinejoin="round" strokeLinecap="round"/>
      <circle cx={(data.length-1)*16+8} cy={py(data[data.length-1])} r="4" fill={color}/>
    </svg>
  )
}

function BarGroup({ label, value, baseline, target, color, bg }) {
  const pct    = v => `${Math.min(100, v * 100).toFixed(0)}%`
  const active = value !== null && value !== undefined
  return (
    <div style={{ background: bg, borderRadius: 12,
      padding: '14px 16px', border: `1px solid ${color}33` }}>
      <div style={{ display:'flex', justifyContent:'space-between', marginBottom: 10 }}>
        <span style={{ fontWeight:700, color:'#0f172a', fontSize:15,
          textTransform:'capitalize' }}>{label}</span>
        {active
          ? <span style={{ fontWeight:800, fontSize:18, color }}>{value.toFixed(4)}</span>
          : <span style={{ color:'#94a3b8', fontSize:13 }}>—</span>}
      </div>

      {/* Achieved */}
      <BarRow label="Achieved" pct={active ? pct(value) : '0%'} color={color}
        val={active ? value.toFixed(4) : '—'} />
      {/* Baseline */}
      <BarRow label="Baseline" pct={pct(baseline)} color="#94a3b8" val={baseline.toFixed(4)} />
      {/* LLM target */}
      <BarRow label="LLM Target" pct={pct(target)} color="#6366f1" val={target.toFixed(4)}
        dashed />
    </div>
  )
}

function BarRow({ label, pct, color, val, dashed }) {
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ display:'flex', justifyContent:'space-between',
        fontSize:11, color:'#64748b', marginBottom:2 }}>
        <span>{label}</span><span style={{ fontWeight:600 }}>{val}</span>
      </div>
      <div style={{ height:6, background:'#f1f5f9', borderRadius:99 }}>
        <div style={{ height:6, borderRadius:99, width:pct, background:color,
          border: dashed ? `2px dashed ${color}` : 'none',
          background: dashed ? 'transparent' : color,
          transition:'width .6s ease' }} />
      </div>
    </div>
  )
}

function SectionHeader({ children }) {
  return (
    <div style={{ fontSize:11, fontWeight:700, color:'#94a3b8', textTransform:'uppercase',
      letterSpacing:'.08em', marginBottom:12 }}>{children}</div>
  )
}

// ── Stacked component bar ──────────────────────────────────────────────────────
function ComponentBar({ components }) {
  const KEYS = ['weighted_completion','deadline_adherence','energy_efficiency',
                'dependency_bonus','interruption_bonus']
  const total = KEYS.reduce((s,k) => s + (components[k]||0), 0)
  return (
    <div>
      <div style={{ display:'flex', height:28, borderRadius:8, overflow:'hidden',
        marginBottom:8 }}>
        {KEYS.map((k,i) => {
          const v = components[k] || 0
          const pct = total > 0 ? (v/total)*100 : 0
          return (
            <div key={k} title={`${COMP_LABELS[i]}: ${v.toFixed(4)}`}
              style={{ width:`${pct}%`, background:COMP_COLORS[i],
                transition:'width .6s', minWidth: pct > 2 ? 2 : 0 }} />
          )
        })}
      </div>
      <div style={{ display:'flex', flexWrap:'wrap', gap:'6px 14px' }}>
        {KEYS.map((k,i) => (
          <span key={k} style={{ fontSize:11, color:'#475569', display:'flex',
            alignItems:'center', gap:4 }}>
            <span style={{ width:10, height:10, borderRadius:2,
              background:COMP_COLORS[i], display:'inline-block' }}/>
            {COMP_LABELS[i].split(' ')[0]}: <b>{(components[k]||0).toFixed(4)}</b>
          </span>
        ))}
      </div>
    </div>
  )
}

// ── Training Log panel ─────────────────────────────────────────────────────────
function TrainingLog() {
  const [data, setData] = useState(null)

  useEffect(() => {
    fetch(`${API}/training-log`)
      .then(r => r.ok ? r.json() : [])
      .then(setData)
      .catch(() => setData([]))
  }, [])

  const card = { background:'#fff', border:'1px solid #e2e8f0',
    borderRadius:14, padding:16, marginBottom:16 }

  if (data === null) return (
    <div style={card}>
      <SectionHeader>GRPO Training Curve — Last Run</SectionHeader>
      <div style={{ color:'#94a3b8', textAlign:'center', padding:28, fontSize:13 }}>
        Loading…
      </div>
    </div>
  )

  if (!data.length) return (
    <div style={card}>
      <SectionHeader>GRPO Training Curve — Last Run</SectionHeader>
      <div style={{ color:'#94a3b8', fontSize:13, textAlign:'center', padding:28,
        lineHeight:1.7 }}>
        No training data yet.<br/>
        Run&ensp;
        <code style={{ background:'#f1f5f9', padding:'2px 8px', borderRadius:5, fontSize:12 }}>
          python training_loop.py --train
        </code>
        &ensp;to generate reward curves.<br/>
        The dashboard will update automatically once&ensp;
        <code style={{ background:'#f1f5f9', padding:'2px 8px', borderRadius:5, fontSize:12 }}>
          reward_curve.json
        </code>
        &ensp;is committed.
      </div>
    </div>
  )

  const means  = data.map(d => d.mean)
  const maxes  = data.map(d => d.max)
  const mins   = data.map(d => d.min)
  const final  = means[means.length - 1]
  const peak   = Math.max(...means)
  const worst  = Math.min(...means)
  const total  = data.length

  return (
    <div style={card}>
      <SectionHeader>GRPO Training Curve — {total} Steps</SectionHeader>
      <div style={{ display:'flex', gap:24, marginBottom:14 }}>
        {[
          { l:'Final Mean', v:final.toFixed(4), c:'#6366f1' },
          { l:'Peak Mean',  v:peak.toFixed(4),  c:'#22c55e' },
          { l:'Min Mean',   v:worst.toFixed(4), c:'#ef4444' },
          { l:'Steps',      v:total,            c:'#0ea5e9' },
        ].map(s => (
          <div key={s.l} style={{ textAlign:'center', minWidth:70 }}>
            <div style={{ fontSize:10, color:'#94a3b8', textTransform:'uppercase',
              marginBottom:2 }}>{s.l}</div>
            <div style={{ fontSize:18, fontWeight:800, color:s.c }}>{s.v}</div>
          </div>
        ))}
      </div>

      {/* Reward band chart (mean + shaded min/max) */}
      <div style={{ border:'1px solid #f1f5f9', borderRadius:8,
        background:'#fafafa', overflow:'hidden', marginBottom:12 }}>
        <svg width="100%" height={130}
          viewBox={`0 0 ${Math.max(data.length*16,300)} 130`}
          preserveAspectRatio="none" style={{ display:'block' }}>
          {(() => {
            const W = Math.max(data.length*16, 300)
            const lo = Math.min(...mins)
            const hi = Math.max(...maxes)
            const sp = hi===lo ? 1 : hi-lo
            const py = v => 118 - ((v-lo)/sp)*104 + 6
            const mPts = means.map((v,i) => `${i*16+8},${py(v)}`).join(' ')
            return (
              <>
                <polyline
                  points={[
                    ...mins.map((v,i) => `${i*16+8},${py(v)}`),
                    ...[...maxes].reverse().map((v,i) =>
                      `${(data.length-1-i)*16+8},${py(v)}`)
                  ].join(' ')}
                  fill="#6366f115" stroke="none"/>
                <polyline points={maxes.map((v,i)=>`${i*16+8},${py(v)}`).join(' ')}
                  fill="none" stroke="#6366f140" strokeWidth="1"/>
                <polyline points={mins.map((v,i)=>`${i*16+8},${py(v)}`).join(' ')}
                  fill="none" stroke="#6366f140" strokeWidth="1"/>
                <polyline points={mPts} fill="none" stroke="#6366f1"
                  strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round"/>
                <circle cx={(data.length-1)*16+8} cy={py(means[means.length-1])}
                  r="4" fill="#6366f1"/>
              </>
            )
          })()}
        </svg>
      </div>

      {/* Recent 10 rows */}
      <div style={{ fontFamily:'monospace', fontSize:11 }}>
        <div style={{ display:'flex', gap:0, color:'#94a3b8', fontWeight:700,
          borderBottom:'1px solid #f1f5f9', paddingBottom:4, marginBottom:4 }}>
          {['Step','Mean','Max','Min'].map(h => <div key={h} style={{flex:1}}>{h}</div>)}
        </div>
        {data.slice(-8).map(d => (
          <div key={d.step} style={{ display:'flex', gap:0, padding:'2px 0',
            color: d.mean >= 0 ? '#16a34a' : '#ef4444' }}>
            <div style={{flex:1}}>{d.step}</div>
            <div style={{flex:1}}>{d.mean.toFixed(4)}</div>
            <div style={{flex:1}}>{d.max?.toFixed(4) ?? '—'}</div>
            <div style={{flex:1}}>{d.min?.toFixed(4) ?? '—'}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Main TrainingDashboard ─────────────────────────────────────────────────────
export default function TrainingDashboard() {
  const [benchData, setBench]      = useState(null)
  const [running,   setRunning]    = useState(false)
  const [selected,  setSelected]   = useState('medium')

  const runBenchmark = async () => {
    setRunning(true); setBench(null)
    try {
      const r = await fetch(`${API}/benchmark`)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      setBench(await r.json())
    } catch (e) {
      console.error(e)
    } finally { setRunning(false) }
  }

  const card = (extra={}) => ({
    background:'#fff', border:'1px solid #e2e8f0',
    borderRadius:14, padding:16, marginBottom:16, ...extra,
  })

  const selData = benchData?.[selected]

  return (
    <div>
      {/* ── Benchmark suite ─────────────────────────────────────────────── */}
      <div style={card()}>
        <div style={{ display:'flex', justifyContent:'space-between',
          alignItems:'center', marginBottom:16 }}>
          <div>
            <SectionHeader>Heuristic Agent Benchmark</SectionHeader>
            <p style={{ fontSize:13, color:'#64748b', margin:0, lineHeight:1.5 }}>
              Runs the CLM heuristic agent on all four difficulty levels with seed=42.
              Scores compared to published baseline and LLM target.
            </p>
          </div>
          <button onClick={runBenchmark} disabled={running}
            style={{ background: running ? '#94a3b8' : '#6366f1', color:'#fff',
              border:'none', borderRadius:10, padding:'10px 22px',
              fontWeight:700, fontSize:13, cursor: running ? 'not-allowed' : 'pointer',
              whiteSpace:'nowrap', marginLeft:20 }}>
            {running ? '⏳ Running…' : '▶ Run All Benchmarks'}
          </button>
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:12 }}>
          {DIFF_ORDER.map(d => (
            <BarGroup
              key={d} label={d}
              value={benchData?.[d]?.score ?? null}
              baseline={BASELINE[d]}
              target={LLM_TARGET[d]}
              color={DIFF_COLOR[d]}
              bg={DIFF_BG[d]}
            />
          ))}
        </div>

        {benchData && (
          <div style={{ marginTop:16, padding:'12px 14px',
            background:'#f8fafc', borderRadius:10, fontSize:12, color:'#64748b' }}>
            <b style={{ color:'#334155' }}>Legend:</b>&ensp;
            Achieved = heuristic agent score (this run) ·&ensp;
            Baseline = published heuristic baseline from README ·&ensp;
            LLM Target = expected score after GRPO training
          </div>
        )}
      </div>

      {/* ── Detailed breakdown for selected difficulty ───────────────────── */}
      {benchData && (
        <div style={card()}>
          <div style={{ display:'flex', gap:6, marginBottom:14 }}>
            {DIFF_ORDER.map(d => (
              <button key={d} onClick={() => setSelected(d)}
                style={{ padding:'7px 16px', borderRadius:8, border:'none',
                  background: selected===d ? DIFF_COLOR[d] : DIFF_BG[d],
                  color: selected===d ? '#fff' : DIFF_COLOR[d],
                  fontWeight:700, fontSize:13, cursor:'pointer',
                  textTransform:'capitalize' }}>
                {d}
              </button>
            ))}
          </div>

          {selData && !selData.error && (
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
              {/* Stats */}
              <div>
                <SectionHeader>Episode Stats — {selected}</SectionHeader>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8,
                  marginBottom:14 }}>
                  {[
                    { l:'Score',        v: selData.score?.toFixed(4) },
                    { l:'Total Reward', v: selData.total_reward?.toFixed(3) },
                    { l:'Steps',        v: selData.steps },
                    { l:'Tasks Done',
                      v: `${selData.tasks_done}/${selData.tasks_total}` },
                    { l:'Avg Energy',   v: selData.avg_energy?.toFixed(3) },
                    { l:'Deadlines',
                      v: `${selData.deadlines_met}/${selData.deadlines_total}` },
                  ].map(s => (
                    <div key={s.l} style={{ background:'#f8fafc',
                      borderRadius:8, padding:'10px 12px' }}>
                      <div style={{ fontSize:10, color:'#94a3b8', marginBottom:3 }}>{s.l}</div>
                      <div style={{ fontSize:15, fontWeight:700, color:'#0f172a' }}>{s.v}</div>
                    </div>
                  ))}
                </div>

                {/* Scoring components */}
                {selData.components && (
                  <>
                    <SectionHeader>Score Component Breakdown</SectionHeader>
                    <ComponentBar components={selData.components} />
                  </>
                )}
              </div>

              {/* Mini charts */}
              <div>
                <SectionHeader>Step Rewards</SectionHeader>
                <div style={{ border:'1px solid #f1f5f9', borderRadius:8,
                  background:'#fafafa', overflow:'hidden', marginBottom:12 }}>
                  <LineChart data={selData.step_rewards} color={DIFF_COLOR[selected]} height={110}/>
                </div>

                <SectionHeader>Energy Trace</SectionHeader>
                <div style={{ border:'1px solid #f1f5f9', borderRadius:8,
                  background:'#fafafa', overflow:'hidden', marginBottom:12 }}>
                  <LineChart data={selData.energy_trace} color="#22c55e" height={90}/>
                </div>

                <SectionHeader>Stress Trace</SectionHeader>
                <div style={{ border:'1px solid #f1f5f9', borderRadius:8,
                  background:'#fafafa', overflow:'hidden' }}>
                  <LineChart data={selData.stress_trace} color="#f59e0b" height={90}/>
                </div>
              </div>
            </div>
          )}

          {selData?.error && (
            <div style={{ color:'#dc2626', fontSize:13 }}>⚠️ {selData.error}</div>
          )}
        </div>
      )}

      {/* ── Scoring formula reference ────────────────────────────────────── */}
      <div style={card()}>
        <SectionHeader>Scoring Formula</SectionHeader>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:10 }}>
          {[
            { comp:'Weighted Completion',  weight:'×0.60', color:COMP_COLORS[0] },
            { comp:'Deadline Adherence',   weight:'×0.22', color:COMP_COLORS[1] },
            { comp:'Energy Efficiency',    weight:'×0.10', color:COMP_COLORS[2] },
            { comp:'Dependency Bonus',     weight:'×0.05', color:COMP_COLORS[3] },
            { comp:'Interruption Bonus',   weight:'×0.03', color:COMP_COLORS[4] },
          ].map(c => (
            <div key={c.comp} style={{ background:'#f8fafc', borderRadius:10,
              padding:'12px 14px', borderTop:`3px solid ${c.color}` }}>
              <div style={{ fontSize:18, fontWeight:800, color:c.color,
                marginBottom:4 }}>{c.weight}</div>
              <div style={{ fontSize:12, color:'#475569', fontWeight:600 }}>{c.comp}</div>
            </div>
          ))}
        </div>
        <div style={{ marginTop:12, fontSize:12, color:'#94a3b8', fontFamily:'monospace',
          background:'#f8fafc', padding:'10px 14px', borderRadius:8 }}>
          score = weighted_completion×0.60 + deadline_adherence×0.22
                + energy_efficiency×0.10 + dependency_bonus×0.05
                + interruption_bonus×0.03  &nbsp; (clamped to 0.01–0.99)
        </div>
      </div>

      {/* ── Before/After comparison table ────────────────────────────────── */}
      <div style={card()}>
        <SectionHeader>Before vs After Training — Score Comparison</SectionHeader>
        <div style={{ overflowX:'auto' }}>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
            <thead>
              <tr style={{ background:'#f8fafc' }}>
                {['Difficulty','Baseline (heuristic)','Heuristic Achieved',
                  'LLM Target (post-GRPO)','Δ vs Baseline'].map(h => (
                  <th key={h} style={{ padding:'10px 14px', textAlign:'left',
                    fontWeight:700, color:'#475569', fontSize:11,
                    textTransform:'uppercase', borderBottom:'1px solid #e2e8f0' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {DIFF_ORDER.map((d, i) => {
                const achieved = benchData?.[d]?.score
                const delta = achieved != null ? achieved - BASELINE[d] : null
                return (
                  <tr key={d} style={{ borderBottom:'1px solid #f1f5f9',
                    background: i%2===0 ? '#fff' : '#fafafa' }}>
                    <td style={{ padding:'10px 14px', fontWeight:700,
                      textTransform:'capitalize', color:DIFF_COLOR[d] }}>{d}</td>
                    <td style={{ padding:'10px 14px', color:'#475569' }}>
                      {BASELINE[d].toFixed(3)}
                    </td>
                    <td style={{ padding:'10px 14px', fontWeight:700,
                      color: achieved != null ? DIFF_COLOR[d] : '#94a3b8' }}>
                      {achieved != null ? achieved.toFixed(4) : '—'}
                    </td>
                    <td style={{ padding:'10px 14px', color:'#6366f1', fontWeight:600 }}>
                      {LLM_TARGET[d].toFixed(3)}
                    </td>
                    <td style={{ padding:'10px 14px', fontWeight:700,
                      color: delta == null ? '#94a3b8'
                        : delta >= 0 ? '#16a34a' : '#ef4444' }}>
                      {delta != null
                        ? (delta >= 0 ? '+' : '') + delta.toFixed(4)
                        : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── GRPO training history ─────────────────────────────────────────── */}
      <TrainingLog />
    </div>
  )
}
