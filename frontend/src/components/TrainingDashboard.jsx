import React, { useState, useEffect, useRef, useMemo } from 'react'

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

const BASELINE   = { easy:0.856, medium:0.523, hard:0.301, expert:0.221 }
const LLM_TARGET = { easy:0.88,  medium:0.58,  hard:0.37,  expert:0.27  }

// ── Helpers ────────────────────────────────────────────────────────────────────
function trailingAvg(arr, w = 10) {
  return arr.map((_, i) => {
    const sl = arr.slice(Math.max(0, i - w + 1), i + 1)
    return sl.reduce((s, v) => s + v, 0) / sl.length
  })
}
function arrAvg(arr) {
  return arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0
}

// ── GRPO Training Chart (matches the reference image) ─────────────────────────
function GRPOTrainingChart({ curve }) {
  const data = useMemo(() => {
    if (!curve || curve.length < 10) return null
    const n     = curve.length
    const means = curve.map(d => d.mean)
    const maxes = curve.map(d => d.max ?? d.mean)
    const mins  = curve.map(d => d.min ?? d.mean)
    const sm    = trailingAvg(means, 10)

    const yLo = Math.min(-0.01, ...mins) - 0.005
    const yHi = Math.max(...maxes) + 0.01

    // Phase averages
    const t1 = Math.floor(n / 3), t2 = Math.floor((2 * n) / 3)
    const early  = arrAvg(means.slice(0, t1))
    const middle = arrAvg(means.slice(t1, t2))
    const late   = arrAvg(means.slice(t2))

    return { n, means, maxes, mins, sm, yLo, yHi,
             startMean: means[0], endMean: means[n - 1],
             peakMean: Math.max(...means),
             early, middle, late }
  }, [curve])

  if (!data) return null

  const { n, means, maxes, mins, sm,
          yLo, yHi, startMean, endMean, peakMean,
          early, middle, late } = data

  // SVG layout
  const W = 880, PAD = { t: 24, r: 20, b: 38, l: 52 }
  const cW = W - PAD.l - PAD.r
  const H1 = 220
  const cH = H1 - PAD.t - PAD.b

  const x  = i => PAD.l + (i / Math.max(n - 1, 1)) * cW
  const y  = v => PAD.t + cH - ((v - yLo) / (yHi - yLo)) * cH
  const fp = v => v.toFixed(1)

  // Polyline points (generated once via useMemo already)
  const bandPts = curve.map((d, i) => `${fp(x(i))},${fp(y(d.min))}`).join(' ')
                + ' '
                + [...curve].reverse().map((d, i) => `${fp(x(n - 1 - i))},${fp(y(d.max))}`).join(' ')
  const rawPts  = means.map((v, i) => `${fp(x(i))},${fp(y(v))}`).join(' ')
  const smPts   = sm.map((v, i) => `${fp(x(i))},${fp(y(v))}`).join(' ')

  const y0     = y(0)
  const yStart = y(startMean)

  // Y-axis ticks
  const yTicks = []
  for (let v = -0.10; v <= yHi + 0.01; v = Math.round((v + 0.05) * 100) / 100) {
    if (v >= yLo) yTicks.push(v)
  }
  // X-axis ticks (every 200 or 100 steps)
  const xStep = n > 500 ? 200 : 100
  const xTicks = []
  for (let i = 0; i < n; i += xStep) xTicks.push(i)
  if (xTicks[xTicks.length - 1] !== n - 1) xTicks.push(n - 1)

  const phases = [
    { label: 'Early',  sub: '(first 1/3)',   val: early,  fill: '#fca5a5' },
    { label: 'Middle', sub: '(second 1/3)',  val: middle, fill: '#fcd34d' },
    { label: 'Late',   sub: '(final 1/3)',   val: late,   fill: '#86efac' },
  ]
  const maxPhase = Math.max(early, middle, late)

  // Phase bar SVG dimensions
  const BW = W, BH = 130
  const BPAD = { t: 10, b: 44, l: PAD.l, r: PAD.r }
  const bcW = BW - BPAD.l - BPAD.r
  const bcH = BH - BPAD.t - BPAD.b
  const barSlot = bcW / phases.length
  const barW    = barSlot * 0.52

  return (
    <div style={{ background:'#fff', border:'1px solid #e2e8f0', borderRadius:14,
      padding:'18px 16px 12px', marginBottom:16 }}>

      {/* Chart title */}
      <div style={{ textAlign:'center', marginBottom:12 }}>
        <div style={{ fontSize:15, fontWeight:800, color:'#1e3a8a', letterSpacing:'.01em' }}>
          ⚡ StressTest — GRPO Training Reward Curve
        </div>
        <div style={{ fontSize:12, color:'#475569', marginTop:2 }}>
          Cognitive Load Manager · Meta OpenEnv Hackathon
        </div>
        <div style={{ fontSize:11, color:'#94a3b8', marginTop:1 }}>
          Episode Reward Over Training (mean ± range per step)
        </div>
      </div>

      {/* ── Top chart SVG ── */}
      <svg width="100%" viewBox={`0 0 ${W} ${H1}`}
        style={{ display:'block', overflow:'visible' }}>

        {/* Y-axis grid + labels */}
        {yTicks.map(v => (
          <g key={v}>
            <line x1={PAD.l} y1={y(v)} x2={W - PAD.r} y2={y(v)}
              stroke="#e8edf5" strokeWidth="0.7" strokeDasharray="4 3"/>
            <text x={PAD.l - 5} y={y(v) + 3.5} fontSize="9"
              fill="#94a3b8" textAnchor="end">
              {v >= 0 ? `+${v.toFixed(2)}` : v.toFixed(2)}
            </text>
          </g>
        ))}

        {/* min/max band */}
        <polygon points={bandPts} fill="#6366f112" stroke="none"/>
        <polyline points={maxes.map((v, i) => `${fp(x(i))},${fp(y(v))}`).join(' ')}
          fill="none" stroke="#6366f130" strokeWidth="0.7"/>
        <polyline points={mins.map((v, i) => `${fp(x(i))},${fp(y(v))}`).join(' ')}
          fill="none" stroke="#6366f130" strokeWidth="0.7"/>

        {/* Zero baseline (red dashed) */}
        {y0 >= PAD.t && y0 <= PAD.t + cH && (
          <line x1={PAD.l} y1={y0} x2={W - PAD.r} y2={y0}
            stroke="#ef4444" strokeWidth="1" strokeDasharray="5 4" opacity="0.6"/>
        )}

        {/* Start reward baseline (gray dotted) */}
        <line x1={PAD.l} y1={yStart} x2={W - PAD.r} y2={yStart}
          stroke="#94a3b8" strokeWidth="0.8" strokeDasharray="3 3" opacity="0.7"/>

        {/* Raw mean (thin) */}
        <polyline points={rawPts} fill="none"
          stroke="#818cf8" strokeWidth="0.9" opacity="0.45"/>

        {/* Smoothed mean (thick) */}
        <polyline points={smPts} fill="none"
          stroke="#1d4ed8" strokeWidth="2.5"
          strokeLinejoin="round" strokeLinecap="round"/>

        {/* X-axis ticks */}
        {xTicks.map(i => (
          <g key={i}>
            <line x1={x(i)} y1={PAD.t + cH} x2={x(i)} y2={PAD.t + cH + 4}
              stroke="#cbd5e1" strokeWidth="1"/>
            <text x={x(i)} y={PAD.t + cH + 14} fontSize="9"
              fill="#94a3b8" textAnchor="middle">{i}</text>
          </g>
        ))}

        {/* X-axis label */}
        <text x={PAD.l + cW / 2} y={H1 - 2} fontSize="10"
          fill="#64748b" textAnchor="middle">Training Step</text>

        {/* Start annotation */}
        <circle cx={x(0)} cy={y(sm[0])} r="4" fill="#94a3b8"/>
        <text x={x(0) + 9} y={y(sm[0]) - 6} fontSize="9" fill="#6b7280" fontWeight="600">
          Start: {startMean >= 0 ? '+' : ''}{startMean.toFixed(4)}
        </text>

        {/* End annotation */}
        <circle cx={x(n - 1)} cy={y(sm[n - 1])} r="4.5" fill="#1d4ed8"/>
        <text x={x(n - 1) - 10} y={y(sm[n - 1]) - 8} fontSize="9"
          fill="#1d4ed8" textAnchor="end" fontWeight="600">
          End: {endMean >= 0 ? '+' : ''}{endMean.toFixed(4)}
        </text>

        {/* Chart border */}
        <rect x={PAD.l} y={PAD.t} width={cW} height={cH}
          fill="none" stroke="#e2e8f0" strokeWidth="1"/>
      </svg>

      {/* Legend */}
      <div style={{ display:'flex', gap:16, justifyContent:'center',
        margin:'6px 0 10px', flexWrap:'wrap', fontSize:10, color:'#64748b' }}>
        {[
          { color:'#6366f112', stroke:'#6366f130', label:'min/max range', band:true },
          { color:'#818cf8', label:'raw mean', opacity:0.5 },
          { color:'#1d4ed8', label:'smoothed (window=10)', bold:true },
          { color:'#ef4444', label:'zero baseline', dash:true },
          { color:'#94a3b8', label:'start reward', dash:true },
        ].map(l => (
          <span key={l.label} style={{ display:'flex', alignItems:'center', gap:5 }}>
            {l.band ? (
              <svg width="26" height="10" style={{ verticalAlign:'middle' }}>
                <rect x="0" y="2" width="26" height="6" fill={l.color}/>
                <line x1="0" y1="5" x2="26" y2="5" stroke={l.stroke} strokeWidth="0.8"/>
              </svg>
            ) : (
              <svg width="26" height="10" style={{ verticalAlign:'middle' }}>
                <line x1="0" y1="5" x2="26" y2="5"
                  stroke={l.color}
                  strokeWidth={l.bold ? '2.5' : '1'}
                  strokeDasharray={l.dash ? '4 3' : undefined}
                  opacity={l.opacity ?? 1}/>
              </svg>
            )}
            {l.label}
          </span>
        ))}
      </div>

      {/* Phase bar subtitle */}
      <div style={{ textAlign:'center', fontSize:11, color:'#64748b', marginBottom:4 }}>
        Average Reward by Training Phase (Early → Late shows improvement)
      </div>

      {/* ── Phase bar chart SVG ── */}
      <svg width="100%" viewBox={`0 0 ${BW} ${BH}`}
        style={{ display:'block', maxHeight:130 }}>
        {phases.map((p, i) => {
          const bH  = (p.val / maxPhase) * bcH
          const bX  = BPAD.l + i * barSlot + (barSlot - barW) / 2
          const bY  = BPAD.t + bcH - bH
          return (
            <g key={p.label}>
              {/* Bar */}
              <rect x={bX} y={bY} width={barW} height={bH}
                fill={p.fill} rx="4" opacity="0.88"/>
              {/* Value label above bar */}
              <text x={bX + barW / 2} y={bY - 5} fontSize="10"
                fill="#1f2937" fontWeight="700" textAnchor="middle">
                +{p.val.toFixed(4)}
              </text>
              {/* Phase label */}
              <text x={bX + barW / 2} y={BPAD.t + bcH + 16} fontSize="9.5"
                fill="#374151" textAnchor="middle" fontWeight="600">{p.label}</text>
              <text x={bX + barW / 2} y={BPAD.t + bcH + 28} fontSize="8.5"
                fill="#9ca3af" textAnchor="middle">{p.sub}</text>
            </g>
          )
        })}
        {/* Y=0 baseline */}
        <line x1={BPAD.l} y1={BPAD.t + bcH} x2={BW - BPAD.r} y2={BPAD.t + bcH}
          stroke="#d1d5db" strokeWidth="1"/>
      </svg>

      {/* Summary stats row */}
      <div style={{ display:'flex', gap:12, justifyContent:'center', flexWrap:'wrap',
        marginTop:10, paddingTop:10, borderTop:'1px solid #f1f5f9' }}>
        {[
          { l:'Total Steps', v: n.toLocaleString(),            c:'#6366f1' },
          { l:'Start',       v: `+${startMean.toFixed(4)}`,    c:'#6b7280' },
          { l:'End',         v: `+${endMean.toFixed(4)}`,      c:'#1d4ed8' },
          { l:'Total Gain',  v: `+${(endMean-startMean).toFixed(4)}`, c:'#16a34a' },
          { l:'Peak Mean',   v: `+${peakMean.toFixed(4)}`,     c:'#22c55e' },
        ].map(s => (
          <div key={s.l} style={{ textAlign:'center', minWidth:80 }}>
            <div style={{ fontSize:9, color:'#94a3b8', textTransform:'uppercase',
              letterSpacing:'.06em', marginBottom:2 }}>{s.l}</div>
            <div style={{ fontSize:14, fontWeight:800, color:s.c }}>{s.v}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Before vs After Training — single overlay chart ───────────────────────────
function BeforeAfterComparisonChart({ curve }) {
  const N = Math.min(120, Math.floor(curve.length / 5))
  const beforeSlice = curve.slice(0, N)
  const afterSlice  = curve.slice(curve.length - N)

  const bMeans = beforeSlice.map(d => d.mean)
  const aMeans = afterSlice.map(d => d.mean)
  const smB = trailingAvg(bMeans, 8)
  const smA = trailingAvg(aMeans, 8)

  const allVals = [...bMeans, ...aMeans]
  const yLo = Math.min(-0.01, ...allVals) - 0.005
  const yHi = Math.max(...allVals) + 0.015

  const W = 880, PAD = { t:28, r:20, b:40, l:54 }, H = 200
  const cW = W - PAD.l - PAD.r
  const cH = H - PAD.t - PAD.b

  const x  = i => PAD.l + (i / Math.max(N - 1, 1)) * cW
  const y  = v => PAD.t + cH - ((v - yLo) / (yHi - yLo)) * cH
  const fp = v => v.toFixed(1)

  const bSmPts  = smB.map((v, i) => `${fp(x(i))},${fp(y(v))}`).join(' ')
  const aSmPts  = smA.map((v, i) => `${fp(x(i))},${fp(y(v))}`).join(' ')
  const bRawPts = bMeans.map((v, i) => `${fp(x(i))},${fp(y(v))}`).join(' ')
  const aRawPts = aMeans.map((v, i) => `${fp(x(i))},${fp(y(v))}`).join(' ')

  // Filled area under each smoothed line
  const bFill = `${fp(x(0))},${fp(y(yLo))} ${bSmPts} ${fp(x(N-1))},${fp(y(yLo))}`
  const aFill = `${fp(x(0))},${fp(y(yLo))} ${aSmPts} ${fp(x(N-1))},${fp(y(yLo))}`

  const avgB = arrAvg(bMeans), avgA = arrAvg(aMeans)
  const gain = avgA - avgB
  const gainPct = avgB !== 0 ? ((gain / Math.abs(avgB)) * 100).toFixed(1) : '∞'

  const yTicks = []
  for (let v = -0.05; v <= yHi + 0.01; v = Math.round((v + 0.05) * 100) / 100) {
    if (v >= yLo) yTicks.push(v)
  }
  const xLabels = [0, Math.floor(N/4), Math.floor(N/2), Math.floor(3*N/4), N-1]

  return (
    <div style={{ background:'#fff', border:'1px solid #e2e8f0', borderRadius:14,
      padding:'18px 16px 14px', marginBottom:16 }}>

      {/* Header row */}
      <div style={{ display:'flex', justifyContent:'space-between',
        alignItems:'flex-start', marginBottom:14, flexWrap:'wrap', gap:12 }}>
        <div>
          <div style={{ fontSize:14, fontWeight:800, color:'#0f172a', marginBottom:3 }}>
            📊 Before vs After Training — Reward Comparison
          </div>
          <div style={{ fontSize:11, color:'#64748b', lineHeight:1.5 }}>
            First <b>{N} steps</b> (pre-convergence) vs Last <b>{N} steps</b> (post-GRPO) — both smoothed with window=8
          </div>
        </div>

        {/* Stat chips */}
        <div style={{ display:'flex', gap:8, flexShrink:0 }}>
          {[
            { label:'Before avg', val:`+${avgB.toFixed(4)}`,
              bg:'#fff1f2', fg:'#e11d48', border:'#fecdd3' },
            { label:'After avg',  val:`+${avgA.toFixed(4)}`,
              bg:'#f0fdf4', fg:'#15803d', border:'#bbf7d0' },
            { label:'Gain',       val:`+${gain.toFixed(4)}`,
              bg:'#eff6ff', fg:'#1d4ed8', border:'#bfdbfe' },
            { label:'Improvement', val:`${gainPct}%`,
              bg:'#fdf4ff', fg:'#7e22ce', border:'#e9d5ff' },
          ].map(s => (
            <div key={s.label} style={{ background:s.bg,
              border:`1px solid ${s.border}`, borderRadius:10,
              padding:'8px 14px', textAlign:'center', minWidth:72 }}>
              <div style={{ fontSize:9, color:s.fg, textTransform:'uppercase',
                letterSpacing:'.06em', marginBottom:2 }}>{s.label}</div>
              <div style={{ fontSize:15, fontWeight:800, color:s.fg }}>{s.val}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Chart SVG */}
      <svg width="100%" viewBox={`0 0 ${W} ${H}`}
        style={{ display:'block', overflow:'visible' }}>

        {/* Grid + Y ticks */}
        {yTicks.map(v => (
          <g key={v}>
            <line x1={PAD.l} y1={y(v)} x2={W - PAD.r} y2={y(v)}
              stroke="#e8edf5" strokeWidth="0.7" strokeDasharray="4 3"/>
            <text x={PAD.l - 5} y={y(v) + 3.5} fontSize="9"
              fill="#94a3b8" textAnchor="end">
              {v >= 0 ? `+${v.toFixed(2)}` : v.toFixed(2)}
            </text>
          </g>
        ))}

        {/* Zero line */}
        <line x1={PAD.l} y1={y(0)} x2={W - PAD.r} y2={y(0)}
          stroke="#94a3b8" strokeWidth="0.8" strokeDasharray="3 3" opacity="0.6"/>

        {/* Filled areas */}
        <polygon points={bFill} fill="#f43f5e0e" stroke="none"/>
        <polygon points={aFill} fill="#22c55e0e" stroke="none"/>

        {/* Raw lines (thin, behind) */}
        <polyline points={bRawPts} fill="none"
          stroke="#f43f5e" strokeWidth="0.8" opacity="0.28"/>
        <polyline points={aRawPts} fill="none"
          stroke="#16a34a" strokeWidth="0.8" opacity="0.28"/>

        {/* Smoothed lines (prominent) */}
        <polyline points={bSmPts} fill="none"
          stroke="#f43f5e" strokeWidth="2.8"
          strokeLinejoin="round" strokeLinecap="round"/>
        <polyline points={aSmPts} fill="none"
          stroke="#16a34a" strokeWidth="2.8"
          strokeLinejoin="round" strokeLinecap="round"/>

        {/* Average reference lines */}
        <line x1={PAD.l} y1={y(avgB)} x2={W - PAD.r} y2={y(avgB)}
          stroke="#f43f5e" strokeWidth="1" strokeDasharray="6 4" opacity="0.5"/>
        <line x1={PAD.l} y1={y(avgA)} x2={W - PAD.r} y2={y(avgA)}
          stroke="#16a34a" strokeWidth="1" strokeDasharray="6 4" opacity="0.5"/>

        {/* Avg labels on right */}
        <text x={W - PAD.r + 3} y={y(avgB) + 3.5} fontSize="8.5"
          fill="#f43f5e" fontWeight="600">avg</text>
        <text x={W - PAD.r + 3} y={y(avgA) + 3.5} fontSize="8.5"
          fill="#16a34a" fontWeight="600">avg</text>

        {/* Start/end dots */}
        <circle cx={x(0)}    cy={y(smB[0])}    r="4" fill="#f43f5e"/>
        <circle cx={x(N-1)}  cy={y(smB[N-1])}  r="4" fill="#f43f5e"/>
        <circle cx={x(0)}    cy={y(smA[0])}    r="4" fill="#16a34a"/>
        <circle cx={x(N-1)}  cy={y(smA[N-1])}  r="4.5" fill="#16a34a"/>

        {/* X-axis */}
        {xLabels.map(i => (
          <g key={i}>
            <line x1={x(i)} y1={PAD.t + cH} x2={x(i)} y2={PAD.t + cH + 4}
              stroke="#cbd5e1" strokeWidth="1"/>
            <text x={x(i)} y={PAD.t + cH + 14} fontSize="9"
              fill="#94a3b8" textAnchor="middle">{i}</text>
          </g>
        ))}
        <text x={PAD.l + cW / 2} y={H - 2} fontSize="10"
          fill="#64748b" textAnchor="middle">Steps (relative within window)</text>

        {/* Chart border */}
        <rect x={PAD.l} y={PAD.t} width={cW} height={cH}
          fill="none" stroke="#e2e8f0" strokeWidth="1"/>
      </svg>

      {/* Legend */}
      <div style={{ display:'flex', gap:24, justifyContent:'center',
        marginTop:8, fontSize:11, color:'#64748b', flexWrap:'wrap' }}>
        <span style={{ display:'flex', alignItems:'center', gap:6 }}>
          <svg width="24" height="10"><line x1="0" y1="5" x2="24" y2="5"
            stroke="#f43f5e" strokeWidth="2.8"/></svg>
          Before Training (steps 0–{N})
        </span>
        <span style={{ display:'flex', alignItems:'center', gap:6 }}>
          <svg width="24" height="10"><line x1="0" y1="5" x2="24" y2="5"
            stroke="#16a34a" strokeWidth="2.8"/></svg>
          After Training (steps {curve.length - N}–{curve.length})
        </span>
        <span style={{ display:'flex', alignItems:'center', gap:6 }}>
          <svg width="24" height="10"><line x1="0" y1="5" x2="24" y2="5"
            stroke="#94a3b8" strokeWidth="1" strokeDasharray="4 3"/></svg>
          Phase average
        </span>
      </div>
    </div>
  )
}

// ── Scoring Formula Card (standalone, visually rich) ─────────────────────────
const FORMULA_ITEMS = [
  { key:'completion', label:'Task Completion',   weight:0.60, color:'#6366f1',
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

      {/* Title */}
      <div style={{ marginBottom:16 }}>
        <div style={{ fontSize:14, fontWeight:800, color:'#0f172a', marginBottom:4 }}>
          🏆 Reward Scoring Formula
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
        {/* Labels under bar */}
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
            {/* Coloured top accent bar */}
            <div style={{ position:'absolute', top:0, left:0, right:0,
              height:4, background:it.color, borderRadius:'12px 12px 0 0' }}/>
            {/* Weight badge */}
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

// ── Tiny SVG charts (used by benchmark section) ────────────────────────────────
function LineChart({ data, color = '#6366f1', height = 120 }) {
  if (!data || !data.length) return (
    <div style={{ height, display:'flex', alignItems:'center',
      justifyContent:'center', color:'#cbd5e1', fontSize:12 }}>No data yet</div>
  )
  const W  = Math.max(data.length * 18, 300)
  const lo = Math.min(...data), hi = Math.max(...data)
  const sp = hi === lo ? 1 : hi - lo
  const py = v => (height - 14) - ((v - lo) / sp) * (height - 26) + 7
  const pts = data.map((v, i) => `${i * 18 + 9},${py(v)}`).join(' ')
  return (
    <svg width="100%" height={height} viewBox={`0 0 ${W} ${height}`}
      preserveAspectRatio="none" style={{ display:'block' }}>
      <line x1="0" y1={py(0)} x2={W} y2={py(0)}
        stroke="#e2e8f0" strokeWidth="1" strokeDasharray="4 3"/>
      <polyline
        points={[`0,${height}`,
                 ...data.map((v, i) => `${i * 18 + 9},${py(v)}`),
                 `${(data.length - 1) * 18 + 9},${height}`].join(' ')}
        fill={color + '18'} stroke="none"/>
      <polyline points={pts} fill="none" stroke={color}
        strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round"/>
      <circle cx={(data.length - 1) * 18 + 9} cy={py(data[data.length - 1])}
        r="4.5" fill={color}/>
    </svg>
  )
}

// Small band chart (used by demo training live view)
function BandChart({ curve, height = 140 }) {
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
  const lo = Math.min(...mins), hi = Math.max(...maxes)
  const sp = hi === lo ? 1 : hi - lo
  const py = v => (height - 14) - ((v - lo) / sp) * (height - 26) + 7
  const bandPts = [
    ...mins.map((v, i) => `${i * 18 + 9},${py(v)}`),
    ...[...maxes].reverse().map((v, i) =>
      `${(curve.length - 1 - i) * 18 + 9},${py(v)}`),
  ].join(' ')
  const meanPts = means.map((v, i) => `${i * 18 + 9},${py(v)}`).join(' ')
  return (
    <svg width="100%" height={height} viewBox={`0 0 ${W} ${height}`}
      preserveAspectRatio="none" style={{ display:'block' }}>
      <line x1="0" y1={py(0)} x2={W} y2={py(0)}
        stroke="#e2e8f0" strokeWidth="1" strokeDasharray="4 3"/>
      <polyline points={bandPts} fill="#6366f118" stroke="none"/>
      <polyline points={maxes.map((v, i) => `${i * 18 + 9},${py(v)}`).join(' ')}
        fill="none" stroke="#6366f140" strokeWidth="1"/>
      <polyline points={mins.map((v, i) => `${i * 18 + 9},${py(v)}`).join(' ')}
        fill="none" stroke="#6366f140" strokeWidth="1"/>
      <polyline points={meanPts} fill="none" stroke="#6366f1"
        strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round"/>
      <circle cx={(curve.length - 1) * 18 + 9} cy={py(means[means.length - 1])}
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
            <BarRow label="Before (random)" pct={bPct} color="#94a3b8"
              val={bv != null ? bv.toFixed(4) : '—'} />
            <BarRow label="After (trained)" pct={aPct} color={DIFF_COLOR[d]}
              val={av != null ? av.toFixed(4) : '—'} glow />
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

// ── Demo training progress section ────────────────────────────────────────────
function DemoTrainingProgress({ state, onStart }) {
  const { running, status, current_step, total_steps, curve,
          before, after, metadata, error } = state

  const pct = total_steps > 0
    ? Math.round((current_step / total_steps) * 100) : 0
  const lastEntry = curve && curve.length ? curve[curve.length - 1] : null
  const meanTrace = (curve || []).map(d => d.mean)

  return (
    <div style={{ background:'#fff', border:'1px solid #e2e8f0',
      borderRadius:14, padding:20, marginBottom:16 }}>

      <div style={{ display:'flex', justifyContent:'space-between',
        alignItems:'flex-start', marginBottom:14 }}>
        <div>
          <div style={{ fontSize:14, fontWeight:800, color:'#0f172a', marginBottom:4 }}>
            🧪 Demo Training — Random → Heuristic Agent
          </div>
          <div style={{ fontSize:12, color:'#64748b', lineHeight:1.6, maxWidth:500 }}>
            Simulates GRPO reward progression on the HF Space (no GPU required).
            Runs {total_steps} steps. Results saved to{' '}
            <code style={{ background:'#f1f5f9', padding:'1px 5px',
              borderRadius:4, fontSize:11 }}>reward_curve.json</code>.
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

      {status !== 'idle' && (
        <div style={{ marginBottom:14 }}>
          <div style={{ display:'flex', justifyContent:'space-between',
            fontSize:12, color:'#64748b', marginBottom:6 }}>
            <span style={{ fontWeight:600,
              color: status==='completed'?'#16a34a': status==='error'?'#ef4444':'#6366f1' }}>
              {status==='running'   && `⚡ Training… step ${current_step}/${total_steps}`}
              {status==='completed' && `✅ Training complete — ${total_steps} steps`}
              {status==='error'     && `❌ ${error}`}
            </span>
            <span>{pct}%</span>
          </div>
          <div style={{ height:10, background:'#f1f5f9', borderRadius:99, overflow:'hidden' }}>
            <div style={{
              height:10, borderRadius:99,
              width:`${status==='completed' ? 100 : pct}%`,
              background: status==='completed' ? '#22c55e' : '#6366f1',
              transition:'width .4s ease',
              boxShadow:'0 0 8px #6366f166',
            }}/>
          </div>
        </div>
      )}

      {(running || status==='completed') && (
        <div style={{ display:'flex', gap:10, flexWrap:'wrap', marginBottom:14 }}>
          {[
            { l:'Step', v:`${current_step}/${total_steps}`, c:'#6366f1' },
            { l:'Last Mean', v: lastEntry ? lastEntry.mean.toFixed(4) : '—',
              c: lastEntry && lastEntry.mean >= 0 ? '#16a34a':'#ef4444' },
            { l:'Last Max',   v: lastEntry ? lastEntry.max.toFixed(4)  : '—', c:'#22c55e' },
            { l:'Difficulty', v: metadata?.difficulty ?? '—',           c:'#0ea5e9' },
          ].map(s => (
            <div key={s.l} style={{ background:'#f8fafc', borderRadius:8,
              padding:'7px 12px', textAlign:'center', minWidth:64 }}>
              <div style={{ fontSize:9, color:'#94a3b8', textTransform:'uppercase',
                marginBottom:2 }}>{s.l}</div>
              <div style={{ fontSize:13, fontWeight:800, color:s.c }}>{s.v}</div>
            </div>
          ))}
        </div>
      )}

      {meanTrace.length > 0 && (
        <div style={{ border:'1px solid #f1f5f9', borderRadius:10,
          background:'#fafafa', overflow:'hidden', marginBottom:14 }}>
          <div style={{ padding:'8px 12px 0', fontSize:10, color:'#94a3b8',
            fontWeight:700, textTransform:'uppercase' }}>
            Live Reward Curve (mean ± band)
          </div>
          <BandChart curve={curve} height={130}/>
        </div>
      )}

      {/* Before/After when demo completes */}
      {status === 'completed' && (before || after) && (
        <div style={{ marginTop:8 }}>
          <SectionHeader>Before vs After — Score Comparison</SectionHeader>
          <BeforeAfterBars before={before} after={after}/>
        </div>
      )}

      {status === 'idle' && (
        <div style={{ textAlign:'center', padding:'18px 0',
          color:'#94a3b8', fontSize:13 }}>
          Click <b>▶ medium</b> / <b>▶ hard</b> / <b>▶ expert</b> to start demo training.
        </div>
      )}
    </div>
  )
}

// ── Benchmark section ──────────────────────────────────────────────────────────
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
  const card = (ex = {}) => ({
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
            style={{ background: running ? '#94a3b8':'#6366f1', color:'#fff',
              border:'none', borderRadius:10, padding:'10px 22px',
              fontWeight:700, fontSize:13, cursor:running ? 'not-allowed':'pointer',
              marginLeft:20, whiteSpace:'nowrap' }}>
            {running ? '⏳ Running…' : '▶ Run Benchmarks'}
          </button>
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:10 }}>
          {DIFF_ORDER.map(d => {
            const score = data?.[d]?.score
            const bPct = `${Math.min(100, BASELINE[d] * 100).toFixed(0)}%`
            const sPct = score != null ? `${Math.min(100, score * 100).toFixed(0)}%` : '0%'
            return (
              <div key={d} style={{ background:DIFF_BG[d],
                border:`1px solid ${DIFF_COLOR[d]}33`, borderRadius:12,
                padding:'12px 14px' }}>
                <div style={{ fontWeight:700, color:DIFF_COLOR[d], fontSize:14,
                  textTransform:'capitalize', marginBottom:8 }}>{d}</div>
                <BarRow label="Achieved" pct={sPct} color={DIFF_COLOR[d]}
                  val={score != null ? score.toFixed(4) : '—'} glow={score != null}/>
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
                  background: sel === d ? DIFF_COLOR[d] : DIFF_BG[d],
                  color: sel === d ? '#fff' : DIFF_COLOR[d],
                  fontWeight:700, fontSize:13, cursor:'pointer',
                  textTransform:'capitalize' }}>{d}</button>
            ))}
          </div>
          {selD && !selD.error && (
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
              <div>
                <SectionHeader>Stats — {sel}</SectionHeader>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr',
                  gap:8, marginBottom:14 }}>
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
                    viewBox={`0 0 ${Math.max((selD.energy_trace || []).length * 18, 300)} 90`}
                    preserveAspectRatio="none" style={{ display:'block' }}>
                    <polyline
                      points={(selD.energy_trace || []).map((v, i) => `${i * 18 + 9},${80 - v * 70}`).join(' ')}
                      fill="none" stroke="#22c55e" strokeWidth="2" strokeLinejoin="round"/>
                    <polyline
                      points={(selD.stress_trace || []).map((v, i) => `${i * 18 + 9},${80 - v * 70}`).join(' ')}
                      fill="none" stroke="#f59e0b" strokeWidth="2"
                      strokeLinejoin="round" strokeDasharray="5 3"/>
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

      <ScoringFormulaCard/>
    </>
  )
}

function ComponentBar({ components }) {
  const total = COMP_KEYS.reduce((s, k) => s + (components[k] || 0), 0)
  return (
    <div>
      <div style={{ display:'flex', height:22, borderRadius:6, overflow:'hidden', marginBottom:6 }}>
        {COMP_KEYS.map((k, i) => {
          const v   = components[k] || 0
          const pct = total > 0 ? (v / total) * 100 : 0
          return <div key={k} title={`${COMP_LABELS[i]}: ${v.toFixed(4)}`}
            style={{ width:`${pct}%`, background:COMP_COLORS[i], minWidth: pct > 2 ? 2 : 0 }}/>
        })}
      </div>
      <div style={{ display:'flex', flexWrap:'wrap', gap:'4px 10px' }}>
        {COMP_KEYS.map((k, i) => (
          <span key={k} style={{ fontSize:10, color:'#475569',
            display:'flex', alignItems:'center', gap:3 }}>
            <span style={{ width:8, height:8, borderRadius:2,
              background:COMP_COLORS[i], display:'inline-block' }}/>
            {COMP_LABELS[i].split(' ')[0]}: <b>{(components[k] || 0).toFixed(4)}</b>
          </span>
        ))}
      </div>
    </div>
  )
}

// ── Main TrainingDashboard ─────────────────────────────────────────────────────
export default function TrainingDashboard() {
  const [activeTab, setActiveTab] = useState('training')

  const [trainState, setTrainState] = useState({
    running:false, status:'idle', current_step:0, total_steps:25,
    difficulty:'medium', curve:[], before:null, after:null,
    metadata:null, error:null,
  })
  const [savedLog, setSavedLog] = useState(null)
  const esRef = useRef(null)

  // Load saved training log on mount
  useEffect(() => {
    fetch(`${API}/training-log`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setSavedLog(d) })
      .catch(() => {})
  }, [])

  const startTraining = async (difficulty) => {
    if (trainState.running) return
    await fetch(`${API}/train/start?difficulty=${difficulty}&steps=25`, { method:'POST' })
    if (esRef.current) { esRef.current.close(); esRef.current = null }
    const es = new EventSource(`${API}/train/stream`)
    esRef.current = es
    es.onmessage = (ev) => {
      const d = JSON.parse(ev.data)
      setTrainState(d)
      if (d.status === 'completed' || d.status === 'error') {
        fetch(`${API}/training-log`)
          .then(r => r.ok ? r.json() : null)
          .then(saved => { if (saved) setSavedLog(saved) })
          .catch(() => {})
        es.close(); esRef.current = null
      }
    }
    es.onerror = () => { es.close(); esRef.current = null }
  }
  useEffect(() => () => { if (esRef.current) esRef.current.close() }, [])

  // The saved log curve — show GRPO chart if it has many steps (real training data)
  const savedCurve = savedLog?.curve ?? []
  const hasRealTrainingData = savedCurve.length > 100

  const TABS = [
    { id:'training',  label:'🧪 Training Progress' },
    { id:'benchmark', label:'📈 Benchmarks' },
  ]

  return (
    <div>
      <div style={{ display:'flex', gap:4, marginBottom:20 }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            style={{ padding:'9px 20px', borderRadius:10, border:'none',
              background: activeTab === t.id ? '#0f172a' : '#e2e8f0',
              color: activeTab === t.id ? '#fff' : '#64748b',
              fontWeight:700, fontSize:13, cursor:'pointer' }}>
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === 'training' && (
        <>
          {/* Real GRPO training chart — shown when actual data exists */}
          {hasRealTrainingData && (
            <>
              <GRPOTrainingChart curve={savedCurve}/>
              <BeforeAfterComparisonChart curve={savedCurve}/>
            </>
          )}

          {/* Demo training controls */}
          <DemoTrainingProgress state={trainState} onStart={startTraining}/>

          {/* Scoring formula — always visible */}
          <ScoringFormulaCard/>

          {/* No data placeholder */}
          {!hasRealTrainingData && trainState.status === 'idle' && (
            <div style={{ background:'linear-gradient(135deg,#f8fafc 0%,#eef2ff 100%)',
              border:'1px solid #e2e8f0', borderRadius:14, padding:28,
              textAlign:'center', color:'#94a3b8', fontSize:14 }}>
              <div style={{ fontSize:36, marginBottom:10 }}>📈</div>
              <div style={{ fontWeight:800, color:'#475569', fontSize:15, marginBottom:6 }}>
                GRPO Training Charts will appear here
              </div>
              <div style={{ fontSize:13, lineHeight:1.8, maxWidth:440,
                margin:'0 auto', color:'#64748b' }}>
                The full training chart + before/after comparison
                (<b>1,116 steps</b>) load automatically from{' '}
                <code style={{ background:'#e0e7ff', color:'#4f46e5',
                  padding:'1px 6px', borderRadius:4, fontSize:11 }}>
                  reward_curve.json
                </code>
                .<br/>
                Or click <b>▶ medium</b> above to run a quick 25-step demo.
              </div>
            </div>
          )}
        </>
      )}

      {activeTab === 'benchmark' && <BenchmarkSection/>}
    </div>
  )
}