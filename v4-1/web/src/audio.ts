/**
 * The page's one AudioContext, shared by the metronome and the music. Browsers only let a page make sound once someone
 * has interacted with it, so it's made (or resumed) on a press or key anywhere, pressing play, say.
 */
let context: AudioContext | null = null

/** Makes or resumes the AudioContext; call it from a press or a key. */
export function unlockAudio() {
  context ??= new AudioContext()
  if (context.state === 'suspended') void context.resume()
  return context
}

/** The AudioContext, if it's running. */
export const runningAudio = () => (context?.state === 'running' ? context : null)

/** Unlocks audio on the next press or key anywhere, until the returned function is called. */
export function unlockOnInteraction() {
  window.addEventListener('pointerdown', unlockAudio)
  window.addEventListener('keydown', unlockAudio)
  return () => {
    window.removeEventListener('pointerdown', unlockAudio)
    window.removeEventListener('keydown', unlockAudio)
  }
}
