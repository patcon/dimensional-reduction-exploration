import { cloudflare } from '@cloudflare/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const page = (name: string) => fileURLToPath(new URL(name, import.meta.url))

// cloudflare() runs the worker (and its Durable Object) inside Vite's dev server, and builds it alongside the pages.
// `--mode share` (pnpm run dev:share) also opens a public link to this machine, through a Cloudflare Quick Tunnel, to
// try it from phones: they only report tilt to https pages. Without it, press `t` then Enter to open one.
// https://developers.cloudflare.com/workers/local-development/local-dev-tunnels/
// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), cloudflare({ tunnel: { autoStart: mode === 'share' } })],
  // `@/` is `src/`, as shadcn's components import it.
  resolve: { alias: { '@': page('./src') } },
  // three.js alone is most of the bundle; one chunk is fine for a demo.
  build: { chunkSizeWarningLimit: 1000 },
  environments: {
    // Two pages: the participant remote at /, the visualiser at /viz.
    client: { build: { rollupOptions: { input: { remote: page('index.html'), viz: page('viz.html') } } } },
  },
}))
