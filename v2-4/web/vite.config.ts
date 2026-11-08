import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // `@/` is `src/`, as shadcn's components import it.
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
})
