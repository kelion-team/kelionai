export const CONSTRUCTOR_LOCAL_ACTOR = 'OpenCode (motor configurat separat)'

const LEGACY_CONSTRUCTOR_ACTORS = new Set([
  'codex-worker',
])

/**
 * Păstrează valorile istorice în DB pentru audit, dar nu expune în produs
 * identitatea executorului retras. Actorii necunoscuți rămân nemodificați:
 * nu atribuim local o execuție care ar putea aparține altui serviciu.
 */
export function constructorActorLabel(actor: string | null | undefined): string | null {
  const value = actor?.trim()
  if (!value) return null
  return LEGACY_CONSTRUCTOR_ACTORS.has(value) ? CONSTRUCTOR_LOCAL_ACTOR : value
}
