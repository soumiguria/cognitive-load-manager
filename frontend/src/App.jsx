import React from 'react'
import Dashboard from './components/Dashboard'

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }
  static getDerivedStateFromError(error) {
    return { error }
  }
  componentDidCatch(error, info) {
    console.error('Dashboard crashed:', error, info)
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ background: '#fef2f2', border: '1px solid #fca5a5',
          borderRadius: 12, padding: 24, margin: 24, fontFamily: 'system-ui,sans-serif' }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: '#dc2626', marginBottom: 8 }}>
            ⚠️ The dashboard hit a render error
          </div>
          <div style={{ fontSize: 13, color: '#7f1d1d', marginBottom: 12,
            fontFamily: 'monospace', background: '#fff', padding: 12, borderRadius: 8,
            border: '1px solid #fecaca', whiteSpace: 'pre-wrap' }}>
            {String(this.state.error?.message || this.state.error)}
          </div>
          <button onClick={() => this.setState({ error: null })}
            style={{ background: '#dc2626', color: '#fff', border: 'none',
              borderRadius: 8, padding: '10px 18px', fontWeight: 700, cursor: 'pointer' }}>
            ↻ Reset Dashboard
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

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
        <ErrorBoundary>
          <Dashboard />
        </ErrorBoundary>
      </main>
    </div>
  )
}
