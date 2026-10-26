import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { createTutor, tutorMiddleware } from './server/tutor.js'

// The project folder, so .env.local is found however the dev server is started
const root = fileURLToPath(new URL('.', import.meta.url))

// Serves the AI tutor from the dev server. The key is read here, on this computer,
// and never sent to the browser (only VITE_ variables are, and this isn't one).
function tutorPlugin(env) {
  const tutor = createTutor({
    apiKey: env.ANTHROPIC_API_KEY,
    model: env.TUTOR_MODEL || undefined,
    dailyLimit: Number(env.TUTOR_DAILY_LIMIT) || undefined,
    accessCode: env.TUTOR_ACCESS_CODE,
  })
  return {
    name: 'compiler-tutor',
    configureServer(server) {
      server.middlewares.use(tutorMiddleware(tutor))
    },
    configurePreviewServer(server) {
      server.middlewares.use(tutorMiddleware(tutor))
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, root, '') // reads .env and .env.local
  return {
    plugins: [react(), tutorPlugin(env)],
    server: {
      // File-change events were sometimes missed on this drive, leaving the browser
      // with stale modules. Polling checks the files directly instead.
      watch: {
        usePolling: true,
        interval: 300,
      },
    },
  }
})
