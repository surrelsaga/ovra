// Owner: Agent E. Orb window tunables.
export const orbConfig = {
  dragThresholdPx: 4,
  keyMovePx: 16,
  awayTickMs: 15_000
}

export function awayText(ms: number): string {
  const min = Math.floor(ms / 60_000)
  return min < 1 ? 'Away · just now' : `Away · ${min} min`
}
