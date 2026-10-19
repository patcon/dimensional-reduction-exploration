import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // three.js alone is most of the bundle; one chunk is fine for a demo.
  build: { chunkSizeWarningLimit: 1000 },
})
