// Owner: Agent E. Orb window tunables.
export const orbConfig = {
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
