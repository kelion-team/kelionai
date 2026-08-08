import { describe, it, expect } from 'vitest'
import fs from 'node:fs'

// ── ORDINEA STRATURILOR DIN IMAGINE (8 aug 2026) ─────────────────────────────
// Adrian: „identifică de ce e așa de mare timpul de construcție și publicare".
//
// Cache-ul Docker e SECVENȚIAL: dacă un strat se invalidează, TOT ce vine după el
// se reconstruiește — chiar dacă fișierele lui n-au fost atinse. Ordinea veche
// punea `COPY frontend ./frontend` ÎNAINTEA lui `COPY backend/package.json`, deci
// orice virgulă schimbată în frontend reinstala TOATE dependențele backend, deși
// `package.json` nu fusese atins de luni de zile.
//
// Greșeala e invizibilă la citit — Dockerfile-ul „arată" corect — și nu pică
// niciun test obișnuit: build-ul iese bine, doar durează. De-aia are nevoie de un
// gard: costul se plătește la fiecare publicare, tăcut.

const DOCKERFILE = new URL('../../Dockerfile', import.meta.url)

/** Poziția unei INSTRUCȚIUNI, nu a unei mențiuni. Prima variantă căuta cu
 *  `indexOf` și găsea `COPY . .` scris într-un COMENTARIU de sus — deci compara
 *  poziții greșite și dădea roșu pe un Dockerfile perfect corect. Prins la proba
 *  gardului: un gard care se înșală e mai rău decât niciunul. */
function pozitia(src: string, bucata: string): number {
  const linii = src.split('\n')
  let offset = 0
  for (const linie of linii) {
    if (linie.startsWith(bucata)) return offset
    offset += linie.length + 1
  }
  expect.fail(`nu mai găsesc în Dockerfile, ca INSTRUCȚIUNE: „${bucata}"`)
}

describe('Dockerfile — dependențele stau pe straturi stabile, înaintea surselor', () => {
  const src = fs.readFileSync(DOCKERFILE, 'utf8')

  it('ambele instalări de dependențe vin ÎNAINTEA oricărei copieri de surse', () => {
    const npmCiFrontend = pozitia(src, 'RUN cd frontend && npm ci')
    const npmInstallBackend = pozitia(src, 'RUN cd backend && (npm install')
    const surseFrontend = pozitia(src, 'COPY frontend ./frontend')
    const surseBackend = pozitia(src, 'COPY backend ./backend')

    // Dacă asta se strică, fiecare publicare reinstalează dependențe degeaba.
    expect(npmCiFrontend, 'npm ci (frontend) trebuie ÎNAINTEA surselor de frontend').toBeLessThan(surseFrontend)
    expect(npmInstallBackend, 'npm install (backend) trebuie ÎNAINTEA surselor de frontend — altfel o schimbare de frontend îl invalidează').toBeLessThan(surseFrontend)
    expect(npmInstallBackend, 'npm install (backend) trebuie ÎNAINTEA surselor de backend').toBeLessThan(surseBackend)
  })

  it('fișierele de dependențe se copiază separat de restul codului', () => {
    // Dacă cineva înlocuiește copierea punctuală cu `COPY backend ./backend`
    // înainte de install, stratul de dependențe devine dependent de tot codul —
    // adică se invalidează la fiecare commit.
    const listaFrontend = pozitia(src, 'COPY frontend/package.json frontend/package-lock.json')
    const listaBackend = pozitia(src, 'COPY backend/package.json backend/package-lock.json')
    expect(listaFrontend).toBeLessThan(pozitia(src, 'RUN cd frontend && npm ci'))
    expect(listaBackend).toBeLessThan(pozitia(src, 'RUN cd backend && (npm install'))
  })

  it('modelul vocal (26MB) rămâne pe un strat stabil, nu după copierea codului', () => {
    // Lecția din 6 aug: stătea după `COPY . .`, deci se re-descărca la FIECARE
    // commit. E o descărcare de rețea în calea publicării — cel mai scump loc.
    const model = pozitia(src, 'RUN mkdir -p /app/backend/models')
    const totCodul = pozitia(src, 'COPY . .')
    expect(model, 'descărcarea modelului trebuie să rămână ÎNAINTEA lui COPY . .').toBeLessThan(totCodul)
  })

  it('`COPY . .` rămâne ULTIMUL pas de copiere — altfel strică tot cache-ul de deasupra', () => {
    const totCodul = pozitia(src, 'COPY . .')
    for (const buildStep of ['RUN cd frontend && npm run build', 'RUN cd backend && npm run build']) {
      expect(pozitia(src, buildStep), `„${buildStep}" trebuie ÎNAINTEA lui COPY . .`).toBeLessThan(totCodul)
    }
  })
})
