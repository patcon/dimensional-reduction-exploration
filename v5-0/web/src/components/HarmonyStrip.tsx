import { useEffect, useRef } from 'react'
import { runningAudio } from '../audio'
import { BAR, CHORD_TONES, chordSize, TONE_NAMES, type MusicWalk } from '../music'
import { broadColor, rgbCss } from '../palette'

/** How long a melody note's dot shows over its tone, in ms. */
const STRUCK_MS = 350

/**
 * The chord now: a bar per tone, low to high, each swelling as the pad's does (the nth n times a bar), the walker's
 * group's taller and in its colour, and a dot over the tone the melody last struck.
 */
export function HarmonyStrip({ walk }: { walk: MusicWalk }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!
    let id = requestAnimationFrame(function draw() {
      id = requestAnimationFrame(draw)
      const dpr = window.devicePixelRatio || 1
      const { width, height } = canvas.getBoundingClientRect()
      if (!width) return
      if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
        canvas.width = Math.round(width * dpr)
        canvas.height = Math.round(height * dpr)
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, width, height)
      const m = walk.music
      if (!m || m.broadCount === 0) return
      const style = getComputedStyle(canvas)
      const ink = style.color
      const muted = style.getPropertyValue('--muted-foreground')
      const rule = style.getPropertyValue('--border')

      const tones = chordSize(m.broadCount)
      // Low to high, as they sound.
      const sorted = CHORD_TONES.slice(0, tones).sort((a, b) => a - b)
      const xOf = (semitones: number) => 18 + (width - 36) * (tones > 1 ? sorted.indexOf(semitones) / (tones - 1) : 0.5)
      const node = walk.node !== null && walk.node < m.rows.length ? walk.node : null
      const here = node === null || m.broad[node] < 0 ? -1 : m.broad[node] % CHORD_TONES.length
      const ctxAudio = runningAudio()
      const t = walk.playing && ctxAudio ? ctxAudio.currentTime - walk.chordStart : 0

      ctx.strokeStyle = rule
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(10, height - 22.5)
      ctx.lineTo(width - 10, height - 22.5)
      ctx.stroke()
      ctx.font = '11px system-ui, sans-serif'
      ctx.textAlign = 'center'
      for (let i = 0; i < tones; i++) {
        const x = xOf(CHORD_TONES[i])
        const on = i === here && tones > 1
        const pulse = walk.playing ? 0.5 + 0.5 * Math.sin((2 * Math.PI * (i + 1) * t) / BAR - Math.PI / 2) : 0.5
        const bar = (on ? 20 : 12) + pulse * (on ? 24 : 20)
        ctx.fillStyle = on ? rgbCss(broadColor(i)) : muted
        ctx.globalAlpha = on ? 1 : 0.45 + 0.4 * pulse
        ctx.fillRect(x - 5, height - 22 - bar, 10, bar)
        ctx.globalAlpha = 1
        ctx.fillStyle = on ? ink : muted
        ctx.fillText(TONE_NAMES[i], x, height - 6)
      }
      const { at, tone } = walk.struck
      if (tone >= 0 && tone < tones && performance.now() - at < STRUCK_MS) {
        ctx.fillStyle = ink
        ctx.beginPath()
        ctx.arc(xOf(CHORD_TONES[tone]), 6, 4, 0, 2 * Math.PI)
        ctx.fill()
      }
    })
    return () => cancelAnimationFrame(id)
  }, [walk])

  return <canvas ref={canvasRef} className="block h-24 w-full text-foreground" aria-label="The chord now, each tone swelling at its own rate" />
}
