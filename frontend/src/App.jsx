import React from 'react'
import Dashboard from './components/Dashboard'

function App() {
  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 selection:bg-indigo-500/30">
      <header className="border-b border-slate-800 bg-slate-900/50 backdrop-blur top-0 sticky z-10 px-6 py-4 flex items-center justify-center">
        <h1 className="text-xl font-bold bg-gradient-to-r from-indigo-400 to-cyan-400 bg-clip-text text-transparent">
          Cognitive Load Manager
        </h1>
        {/* <div className="text-sm text-slate-400">OpenEnv Compliant Environment Dashboard</div> */}
      </header>
      <main className="p-6 max-w-7xl mx-auto">
        <Dashboard />
      </main>
    </div>
  )
}

export default App
