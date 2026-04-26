import React from 'react'
import Dashboard from './components/Dashboard'

export default function App() {
  return (
    <div style={{ minHeight: '100vh', background: '#f1f5f9', fontFamily: 'system-ui,sans-serif' }}>
      {/* ── Header ── */}
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

        <div style={{ flex: 1, display: 'flex', alignItems: 'center' }}>
          <span style={{ fontSize: 13, color: '#6366f1', fontWeight: 700,
            background: '#1e293b', borderRadius: 8, padding: '8px 16px' }}>
            🎮 Live Episode
          </span>
        </div>

        <a href="/docs" target="_blank" rel="noreferrer"
          style={{ fontSize: 12, color: '#475569', textDecoration: 'none',
            padding: '6px 12px', border: '1px solid #334155', borderRadius: 6,
            whiteSpace: 'nowrap' }}>
          API Docs ↗
        </a>
      </header>

      {/* ── Banner ── */}
      <div style={{
        background: 'linear-gradient(135deg,#4f46e5 0%,#0ea5e9 100%)',
        padding: '10px 24px', textAlign: 'center', fontSize: 13, color: '#fff',
      }}>
        🤖 AI agent plays live — press <b>▶ Play Episode</b> to start streaming.
        Switch to <b>🎮 Manual</b> to control the agent yourself.
      </div>

      {/* ── Content ── */}
      <main style={{ maxWidth: 1400, margin: '0 auto', padding: 24 }}>
        <Dashboard />
      </main>
    </div>
  )
}
