// `pnpm dev`: Vite's dev server, taking one flag Vite no longer has, `--https`, to serve over https with a
// self-signed certificate (pnpm dev --host --https, for phones on this machine's network). Everything else goes to Vite.
import { spawn } from 'node:child_process'

const args = process.argv.slice(2)
const https = args.includes('--https')
const vite = spawn('vite', ['dev', ...args.filter((a) => a !== '--https')], {
  stdio: 'inherit',
  env: https ? { ...process.env, DEV_HTTPS: '1' } : process.env,
})
vite.on('exit', (code, signal) => (signal ? process.kill(process.pid, signal) : process.exit(code ?? 0)))
