import { useEffect } from 'react'

/** Whether this browser can keep the screen awake (it needs a secure context: https, or localhost). */
export const canWakeLock = typeof navigator !== 'undefined' && 'wakeLock' in navigator

/**
 * Keeps the screen from dimming or locking while `on`. The browser lets go of the lock whenever the page is
 * hidden, so it's taken again each time the page is shown.
 */
export function useWakeLock(on: boolean) {
  useEffect(() => {
    if (!on || !canWakeLock) return
    let lock: WakeLockSentinel | null = null
    let done = false
    const take = async () => {
      if (document.visibilityState !== 'visible' || (lock && !lock.released)) return
      try {
        const taken = await navigator.wakeLock.request('screen')
        if (done) void taken.release()
        else lock = taken
      } catch {
        // Refused (low battery, say): the screen sleeps as usual.
      }
    }
    void take()
    document.addEventListener('visibilitychange', take)
    return () => {
      done = true
      document.removeEventListener('visibilitychange', take)
      void lock?.release()
    }
  }, [on])
}
