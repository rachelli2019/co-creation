import { recallMiddleware } from './server/recall-middleware.mjs'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwind from '@tailwindcss/vite'

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwind(), {name: 'local-recall-api', configureServer(server) {server.middlewares.use(recallMiddleware(loadEnv(mode, '.', '')))}}],
}))