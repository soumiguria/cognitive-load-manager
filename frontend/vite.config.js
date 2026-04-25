import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// API paths that need to be proxied to the FastAPI backend during local dev.
// In production (HuggingFace Spaces) both frontend and backend are served from
// the same origin (port 7860), so relative URLs work with no proxy needed.
const BACKEND = 'http://localhost:7860'
const API_PATHS = [
  '/reset', '/step', '/state', '/health',
  '/training-log', '/stream', '/benchmark',
  '/grade', '/grader', '/docs', '/openapi.json',
]

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: Object.fromEntries(
      API_PATHS.map(p => [
        p,
        { target: BACKEND, changeOrigin: true, ws: false },
      ])
    ),
  },
})
