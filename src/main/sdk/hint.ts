// Owner: Agent A. Validation smoothing: a code only counts once it has held for persistMs.
import type { ValidationEvent } from '@shared/types'

export interface ValidationSmoother {
  /** Feed a raw validation event (received at `now`). */
  push(ev: ValidationEvent, now: number): void
  /** Returns the newly persisted event if the shown code changed, else null. */
  poll(now: number): ValidationEvent | null
  /** Hint to show the user, or null when OK / nothing persisted yet. */
  hint(): string | null
  reset(): void
}

export function createValidationSmoother(persistMs: number): ValidationSmoother {
  let pending: { ev: ValidationEvent; since: number } | null = null
  let shown: ValidationEvent | null = null
  return {
    push(ev, now) {
      if (ev.code !== pending?.ev.code) pending = { ev, since: now }
    },
    poll(now) {
      if (!pending || pending.ev.code === shown?.code || now - pending.since < persistMs)
        return null
      shown = { ...pending.ev, t: now }
      return shown
    },
    hint: () => (shown && shown.code !== 0 ? shown.hint : null),
    reset() {
      pending = null
      shown = null
    }
  }
}
