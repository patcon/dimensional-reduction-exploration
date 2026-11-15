import * as THREE from 'three'

/** How near a cursor, in pixels, a click or hover has to be to pick its digit. */
const PICK_RADIUS = 14
/** How near a chord, in pixels past its edge, a click or hover has to be to pick its digit (when no cursor is near). */
const CHORD_PICK_SLOP = 3

const projected = new THREE.Vector3()
function toScreen(camera: THREE.Camera, x: number, y: number, z: number, width: number, height: number) {
  projected.set(x, y, z).project(camera)
  return [((projected.x + 1) / 2) * width, ((1 - projected.y) / 2) * height]
}

/**
 * The digit at (x, y) on a `width` × `height` view: the cursor nearest it, if it's close enough;
 * failing that, the nearest chord under it, when `chords` are drawn. `cursors` holds (x, y, z) per
 * digit, and each chord runs from its root (x, y) in `chords.roots` to its cursor, `chords.width` pixels wide.
 */
export function pickDigit(
  x: number,
  y: number,
  width: number,
  height: number,
  camera: THREE.Camera,
  n: number,
  cursors: Float32Array,
  chords: { roots: Float32Array; width: number } | null,
): number | null {
  let best: number | null = null, bestD = PICK_RADIUS * PICK_RADIUS
  for (let i = 0; i < n; i++) {
    const [sx, sy] = toScreen(camera, cursors[i * 3], cursors[i * 3 + 1], cursors[i * 3 + 2], width, height)
    const d = (sx - x) ** 2 + (sy - y) ** 2
    if (d <= bestD) { best = i; bestD = d }
  }
  if (best !== null || !chords) return best
  bestD = (chords.width / 2 + CHORD_PICK_SLOP) ** 2
  for (let i = 0; i < n; i++) {
    const [ax, ay] = toScreen(camera, chords.roots[i * 2], chords.roots[i * 2 + 1], 0, width, height)
    const [bx, by] = toScreen(camera, cursors[i * 3], cursors[i * 3 + 1], 0, width, height)
    // Distance to the segment from root to tip.
    const ex = bx - ax, ey = by - ay, len2 = ex * ex + ey * ey
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * ex + (y - ay) * ey) / len2)) : 0
    const d = (ax + ex * t - x) ** 2 + (ay + ey * t - y) ** 2
    if (d <= bestD) { best = i; bestD = d }
  }
  return best
}
