/**
 * Projects a persisted milestone count onto the public 0-100 scale.
 * No stage-specific percentage lives here: both numerator and denominator
 * come from the canonical Constructor activity catalog and event history.
 */
export function procentDinEtapePersistate(
  completed: number,
  total: number,
  resolved: boolean,
): number | null {
  if (!Number.isFinite(completed) || !Number.isFinite(total) || total <= 0) return null
  if (resolved) return 100
  const boundedCompleted = Math.max(0, Math.min(completed, total))
  return Math.min(99, Math.floor((boundedCompleted * 100) / total))
}
