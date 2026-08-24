import { readdirSync } from 'node:fs'
import { join } from 'node:path'

const DIRECTOARE_IGNORATE = new Set(['node_modules', 'dist', '.git'])

/**
 * Parcurge recursiv un arbore și întoarce doar fișierele cu extensiile cerute.
 * Directoarele generate/ascunse sunt excluse într-un singur loc, astfel încât
 * toate porțile statice să scaneze aceeași suprafață.
 */
export function* fisiereCod(dir, extensii, { ignoraTeste = false } = {}) {
  let intrari
  try {
    intrari = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }

  for (const intrare of intrari) {
    if (DIRECTOARE_IGNORATE.has(intrare.name) || intrare.name.startsWith('.')) continue
    const cale = join(dir, intrare.name)
    if (intrare.isDirectory()) {
      yield* fisiereCod(cale, extensii, { ignoraTeste })
      continue
    }
    if (!extensii.some((extensie) => intrare.name.endsWith(extensie))) continue
    if (ignoraTeste && /\.(?:test|spec)\.[^.]+$/.test(intrare.name)) continue
    yield cale
  }
}

export function listaFisiereCod(dir, extensii, optiuni) {
  return [...fisiereCod(dir, extensii, optiuni)]
}
