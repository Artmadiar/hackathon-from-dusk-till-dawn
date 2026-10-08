import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { defineConfig } from 'vite'

// Браузер ходит только на web (3387); /api проксируется в платформу — cookie same-origin
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  server: {
    host: true,
    port: 3387,
    strictPort: true,
    proxy: {
      '/api': {
        target: process.env.PLATFORM_URL ?? 'http://localhost:3380',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
})
