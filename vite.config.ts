import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// In GitHub Actions: VITE_BASE_URL is set to "/<repo-name>/"
// In local dev: defaults to "/"
const base = process.env.VITE_BASE_URL ?? '/'

export default defineConfig({
  base,
  plugins: [
    react(),
    tailwindcss(),
  ],
  optimizeDeps: {
    include: ['sql.js'],
  },
  assetsInclude: ['**/*.wasm'],
})
