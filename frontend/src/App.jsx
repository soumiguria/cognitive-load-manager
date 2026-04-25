import React, { useState } from 'react'
import Dashboard from './components/Dashboard'
import TrainingDashboard from './components/TrainingDashboard'

const TABS = [
  { id: 'live',     label: '🎮 Live Episode' },
  { id: 'training', label: '📊 Training Analytics' },
]

export default function App() {
  const [tab, setTab] = useState('live')

  return (
    <div style={{ minHeight: '100vh', background: '#f1f5f9', fontFamily: 'system-ui,sans-serif' }}>
      {/* ── Header / Nav ── */}
      <header style={{
        background: '#0f172a', position: 'sticky', top: 0, zIndex: 20,
        display: 'flex', alignItems: 'center', gap: 32, padding: '0 24px',
        boxShadow: '0 1px 3px rgba(0,0,0,.4)',
      }}>
        <div style={{ padding: '14px 0', whiteSpace: 'nowrap' }}>
          <span style={{ fontSize: 19, fontWeight: 800, color: '#fff', letterSpacing: '-0.5px' }}>
            🧠 CLM
          </span>
          <span style={{ fontSize: 12, color: '#64748b', marginLeft: 10 }}>
            Cognitive Load Manager · OpenEnv
          </span>
        </div>

        <nav style={{ display: 'flex', gap: 4, flex: 1 }}>
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                padding: '10px 18px', borderRadius: 8, border: 'none',
                background: tab === t.id ? '#6366f1' : 'transparent',
                color: tab === t.id ? '#fff' : '#94a3b8',
                fontWeight: 600, fontSize: 13, cursor: 'pointer',
                transition: 'all .15s',
              }}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <a href="/docs" target="_blank" rel="noreferrer"
          style={{ fontSize: 12, color: '#475569', textDecoration: 'none',
            padding: '6px 12px', border: '1px solid #334155', borderRadius: 6,
            whiteSpace: 'nowrap' }}>
          API Docs ↗
        </a>
      </header>

      {/* ── Hero banner (shown only on first load) ── */}
      <div style={{
        background: 'linear-gradient(135deg,#4f46e5 0%,#0ea5e9 100%)',
        padding: '10px 24px', textAlign: 'center', fontSize: 13, color: '#fff',
      }}>
        🤖 AI agent is playing live — no local setup needed.&ensp;
        <b>🎮 Live Episode</b> streams in real-time.&ensp;
        <b>📊 Training Analytics</b> shows benchmark scores and scoring formula.
      </div>

      {/* ── Content ── */}
      <main style={{ maxWidth: 1400, margin: '0 auto', padding: 24 }}>
        {tab === 'live' ? <Dashboard /> : <TrainingDashboard />}
      </main>
    </div>
  )
}
