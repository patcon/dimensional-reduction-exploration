// The control scale round-trips, has a dead centre, and reaches PaCMAP's weights, logarithmic or linear.
import { DEFAULT_SCALE, toMultiplier, toU } from '../src/forceScale.ts'

let failures = 0
const expect = (ok: boolean, what: string) => {
  if (!ok) failures++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`)
}
const close = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b))

for (const s of [DEFAULT_SCALE, { ...DEFAULT_SCALE, log: false }]) {
  console.log(s.log ? 'logarithmic' : 'linear')
  let worst = 0
  for (let k = -1000; k <= 1000; k++) {
    const u = k / 1000
    if (Math.abs(u) <= s.deadzone) continue
    worst = Math.max(worst, Math.abs(toU(toMultiplier(u, s), s) - u))
  }
  expect(worst < 1e-9, `toU(toMultiplier(u)) = u outside the deadzone (worst ${worst.toExponential(1)})`)

  expect([0, s.deadzone, -s.deadzone, s.deadzone / 2].every((u) => toMultiplier(u, s) === 0), 'zero inside the deadzone')
  expect(close(toMultiplier(s.deadzone + 1e-12, s), s.min, 1e-6), `just outside the deadzone is ±min (${s.min})`)
  expect(close(toMultiplier(1, s), s.max) && close(toMultiplier(-1, s), -s.max), `the ends are ±max (${s.max})`)
  expect(toU(0, s) === 0, 'toU(0) = 0')

  for (const w of [1, 2, 3, 1000, -1]) {
    const u = toU(w, s)
    expect(Math.abs(u) < 1 && close(toMultiplier(u, s), w, 1e-9), `PaCMAP's ${w} is reachable (u = ${u.toFixed(3)})`)
  }
}

process.exit(failures ? 1 : 0)
