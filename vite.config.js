import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { createApi } from './server/api.mjs'
import { loadDotEnv } from './server/env.mjs'

const root = fileURLToPath(new URL('.', import.meta.url))

// Mounts the same API the production server uses, so `npm run dev` is one process.
function thumbnailApi() {
  const mount = (server) => {
    loadDotEnv(root)
    server.middlewares.use(createApi(root))
  }
  return { name: 'thumbnail-api', configureServer: mount, configurePreviewServer: mount }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), thumbnailApi()],
  server: { port: Number(process.env.PORT ?? 4327), watch: { ignored: ['**/outputs/**'] } },
  preview: { port: Number(process.env.PORT ?? 4327) }
})
