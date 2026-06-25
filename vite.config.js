import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/podcast-top-trumps/',
  build: {
    outDir: 'docs',
    emptyOutDir: true,
  },
})
