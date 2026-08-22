// ── DISPECER PAZNIC — DE LA „VEDE" LA „FACE" ─────────────────────────────────
// Adrian: „când vede o eroare, când pică ceva, sau când Kelion are o lipsă,
// vede și face imediat".
//
// Acesta e al doilea strat: ia evenimentele de la `paznic.ts` și le execută
// sau le escaladează. Fiecare acțiune e simplă și are o singură responsabilitate.

import type { EvenimentPaznic } from './paznic.js'
import { notifyAdmin } from './adminNotification.js'

export interface DepsDispecer {
  selfHeal: () => Promise<{ filed: number }>
  constructor: (eveniment: EvenimentPaznic) => Promise<void>
}

const dispecerImplicite: DepsDispecer = {
  selfHeal: async () => ({ filed: 0 }),
  constructor: async () => {},
}

/** Execută acțiunea propusă de paznic. Nu aruncă — oprește cercul la primul
 *  pas care nu merge, nu la toate. */
export async function executaActiune(
  e: EvenimentPaznic,
  deps: Partial<DepsDispecer> = {},
): Promise<{ facut: string; ok: boolean; detalii?: string }> {
  const d = { ...dispecerImplicite, ...deps }

  switch (e.actiune) {
    case 'notifica':
      try {
        await notifyAdmin(
          'paznic',
          e.nivel === 'critic' ? 'CRITIC' : 'Atenție',
          e.mesaj,
          { detalii: e.detalii, semnatura: e.semnatura, sursa: e.sursa, la: e.la },
        )
        return { facut: 'notificare admin', ok: true }
      } catch (err) {
        return { facut: 'notificare admin', ok: false, detalii: String(err).slice(0, 160) }
      }

    case 'selfHeal':
      try {
        const r = await d.selfHeal()
        return { facut: 'selfHeal', ok: r.filed === 0, detalii: `ordonante repuse=${r.filed}` }
      } catch (err) {
        return { facut: 'selfHeal', ok: false, detalii: String(err).slice(0, 160) }
      }

    case 'constructor':
      try {
        await d.constructor(e)
        return { facut: 'constructor', ok: true }
      } catch (err) {
        return { facut: 'constructor', ok: false, detalii: String(err).slice(0, 160) }
      }

    case 'monitorizeaza':
    default:
      return { facut: 'nimic', ok: true }
  }
}

/** Rulează dispecerul pe TOATE evenimentele unui ciclu. */
export async function dispecereazaEvenimente(
  evenimente: EvenimentPaznic[],
  deps?: Partial<DepsDispecer>,
): Promise<{ facut: string; ok: boolean; detalii?: string }[]> {
  const rezultate: { facut: string; ok: boolean; detalii?: string }[] = []
  // Nu rulăm în paralel: vrem un jurnal ordonat și nu suprasolicităm sisteme.
  for (const e of evenimente) {
    rezultate.push(await executaActiune(e, deps))
  }
  return rezultate
}
