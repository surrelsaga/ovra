// Owner: Agent E. Orb window tunables.
export const orbConfig = {
  cameraNoteMs: 3_000,
  dragThresholdPx: 4,
  keyMovePx: 16,
  awayTickMs: 15_000,
  /** Keep the controls up this long after the pointer leaves, so it can cross the gap to them. */
  hoverGraceMs: 700
}

export function awayText(ms: number): string {
  const min = Math.floor(ms / 60_000)
  return min < 1 ? 'Away · just now' : `Away · ${min} min`
}

/** Exact scheduling is owned by sensing; omit a countdown when the estimate is no longer useful. */
export function cameraLabel(view: import('@shared/types').OrbView, now: number): string {
  if (view.paused) return 'Camera paused by you'
  if (view.listening) return "Camera on · checking how you're doing"
  const min = view.nextCheckAt ? Math.ceil((view.nextCheckAt - now) / 60_000) : 0
  return min > 0 ? `Camera off · next check in ${min} min` : 'Camera off'
}
