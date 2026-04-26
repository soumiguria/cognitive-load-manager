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
            The dashboard hit a render error
          </div>
          <div style={{ fontSize: 13, color: '#7f1d1d', marginBottom: 12,
            fontFamily: 'monospace', background: '#fff', padding: 12, borderRadius: 8,
            border: '1px solid #fecaca', whiteSpace: 'pre-wrap' }}>
            {String(this.state.error?.message || this.state.error)}
          </div>
          <button onClick={() => this.setState({ error: null })}
            style={{ background: '#dc2626', color: '#fff', border: 'none',
              borderRadius: 8, padding: '10px 18px', fontWeight: 700, cursor: 'pointer' }}>
            Reset Dashboard
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

export default function App() {
  const [theme, setTheme] = React.useState(() => {
    if (typeof window === 'undefined') return 'light'
    return localStorage.getItem('clm-theme') || 'light'
  })

  React.useEffect(() => {
    try { localStorage.setItem('clm-theme', theme) } catch {}
  }, [theme])

  const isDark = theme === 'dark'
  const palette = isDark
    ? { bg: '#0b1220', headerBg: '#0f172a', headerBorder: '#1e293b',
        text: '#e2e8f0', subText: '#94a3b8', border: '#334155',
        bannerFrom: '#1e3a8a', bannerTo: '#0c4a6e' }
    : { bg: '#f1f5f9', headerBg: '#ffffff', headerBorder: '#e2e8f0',
        text: '#0f172a', subText: '#64748b', border: '#cbd5e1',
        bannerFrom: '#4f46e5', bannerTo: '#0ea5e9' }

  return (
    <div style={{ minHeight: '100vh', background: palette.bg,
      fontFamily: 'system-ui,sans-serif', color: palette.text,
      transition: 'background .25s ease, color .25s ease' }}>
      {/* Header */}
      <header style={{
        background: palette.headerBg, position: 'sticky', top: 0, zIndex: 20,
        display: 'flex', alignItems: 'center', gap: 32, padding: '0 24px',
        borderBottom: `1px solid ${palette.headerBorder}`,
        boxShadow: isDark ? '0 1px 3px rgba(0,0,0,.5)' : '0 1px 3px rgba(15,23,42,.06)',
      }}>
        <div style={{ padding: '14px 0', whiteSpace: 'nowrap', flex: 1 }}>
          <span style={{ fontSize: 18, fontWeight: 800, color: palette.text,
            letterSpacing: '-0.4px' }}>
            Cognitive Load Manager
          </span>
          <span style={{ fontSize: 12, color: palette.subText, marginLeft: 10 }}>
            OpenEnv
          </span>
        </div>

        <button onClick={() => setTheme(isDark ? 'light' : 'dark')}
          style={{ fontSize: 12, color: palette.text, background: 'transparent',
            padding: '6px 14px', border: `1px solid ${palette.border}`,
            borderRadius: 6, cursor: 'pointer', fontWeight: 600,
            whiteSpace: 'nowrap' }}>
          {isDark ? 'Light' : 'Dark'} mode
        </button>

        <a href="/docs" target="_blank" rel="noreferrer"
          style={{ fontSize: 12, color: palette.subText, textDecoration: 'none',
            padding: '6px 12px', border: `1px solid ${palette.border}`, borderRadius: 6,
            whiteSpace: 'nowrap' }}>
          API Docs
        </a>
      </header>

      {/* Banner */}
      <div style={{
        background: `linear-gradient(135deg,${palette.bannerFrom} 0%,${palette.bannerTo} 100%)`,
        padding: '10px 24px', textAlign: 'center', fontSize: 13, color: '#fff',
      }}>
        AI agent plays live — press <b>Play Episode</b> to start streaming.
        Switch to <b>Manual</b> to control the agent yourself.
      </div>

      {/* Content */}
      <main style={{ maxWidth: 1400, margin: '0 auto', padding: 24 }}>
        <ErrorBoundary>
          <Dashboard isDark={isDark} />
        </ErrorBoundary>
      </main>
    </div>
  )
}
