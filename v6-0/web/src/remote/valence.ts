/**
 * A phone's facing as a number, −1 to +1, from which way is up in its own axes: as the room's detection reads it, or
 * between the ends it was calibrated to (set high and set low). Kept apart from the remote's page so it can be checked.
 */

import type { Calibration, Detection } from '../protocol.ts'

/** A direction in the phone's own axes: x to its right edge, y to its top, z out of its screen. */
export type Vec = [number, number, number]

const RAD = Math.PI / 180
/** Spin can't be read from a phone this near flat (the screen's plane this near level). */
const SPIN_FLAT = 0.3

const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
export const angle = (a: Vec, b: Vec) => Math.acos(Math.max(-1, Math.min(1, dot(a, b))))

/** Which way is up, in the phone's own axes, from a device orientation's beta and gamma (degrees), or null without them. */
export function upOf(beta: number | null, gamma: number | null): Vec | null {
  if (beta === null || gamma === null) return null
  const b = beta * RAD, g = gamma * RAD
  return [-Math.cos(b) * Math.sin(g), Math.sin(b), Math.cos(b) * Math.cos(g)]
}

/**
 * Valence from which way is up, as the detection reads it, or null when it can't tell. Flip: the screen's normal,
 * upwards (face up +1, edge on 0, face down −1). Invert: the phone's top edge, upwards (upright +1, upside down −1).
 * Spin: a steering wheel, the screen to you, evenly with the angle (upright +1, landscape 0, upside down −1); lying near
 * flat, there's no telling.
 */
export function detected(detection: Detection, [x, y, z]: Vec) {
  if (detection === 'flip') return z
  if (detection === 'invert') return y
  if (Math.hypot(x, y) < SPIN_FLAT) return null
  return 1 - Math.abs(Math.atan2(-x, y)) / (Math.PI / 2)
}

/** Where this phone is −1 (low) and +1 (high), as which way is up then, set by calibrating; null for the detection's own. */
export type Setpoints = { low: Vec | null; high: Vec | null }
export const NO_SETPOINTS: Setpoints = { low: null, high: null }

/** Each detection's own ends, as which way is up: face down and face up, or upside down and upright. */
export const ENDS: Record<Detection, { low: Vec; high: Vec }> = {
  flip: { low: [0, 0, -1], high: [0, 0, 1] },
  invert: { low: [0, -1, 0], high: [0, 1, 0] },
  spin: { low: [0, -1, 0], high: [0, 1, 0] },
}

/** Setpoints closer than this (radians, about 6°) would swing from −1 to +1 on the slightest turn: they're ignored. */
const MIN_TURN = 0.1

/** The setpoints after calibrating, with `up` which way is up now; unchanged if there's no reading, or they'd be too close. */
export function calibrated(points: Setpoints, set: Calibration, detection: Detection, up: Vec | null): Setpoints {
  if (set === 'reset') return NO_SETPOINTS
  if (up === null) return points
  const other = set === 'high' ? (points.low ?? ENDS[detection].low) : (points.high ?? ENDS[detection].high)
  if (angle(up, other) < MIN_TURN) return points
  return set === 'high' ? { ...points, high: up } : { ...points, low: up }
}

/**
 * Valence with `up` which way is up: from the setpoints if either is set (the detection's own end standing in for one
 * that isn't), else as the detection reads it.
 *
 * Between setpoints it's how much nearer the phone is to high than to low, over how far apart they are:
 * (angle from low − angle from high) / angle between them. Along the turn from one to the other that runs evenly from
 * −1 to +1, and past either end it stays there; held any other way it still reads, and changes smoothly, so it never
 * sticks. (Before, valence came from the phone's place along the turn between the setpoints, and read nothing when held
 * well off that turn. With setpoints near opposite, as face up and face down are, that turn is barely defined, and
 * flipping the phone any other way passed through the middle reading nothing, so it held what it last read there.)
 */
export function valenceOf(detection: Detection, points: Setpoints, up: Vec) {
  if (!points.low && !points.high) return detected(detection, up)
  const a = points.low ?? ENDS[detection].low
  const b = points.high ?? ENDS[detection].high
  const ab = angle(a, b)
  return Math.max(-1, Math.min(1, (angle(up, a) - angle(up, b)) / ab))
}
