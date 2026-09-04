// ── CULESUL PCM PRIN AudioWorklet — FĂRĂ ScriptProcessorNode (9 aug 2026) ────
//
// Ownerul: „e așa greu să scoți alertele, prin rezolvări reale?" — consola
// striga [Deprecation] ScriptProcessorNode la fiecare pornire de voce.
// Rezolvarea reală: AudioWorkletNode, API-ul curent. Procesorul rulează pe
// firul audio (nu mai ține firul principal — ăla care tot apărea în [ceas
// lent]) și strânge cadrele de 128 de mostre în bucăți de ~4096, exact mărimea
// pe care o trimitea ScriptProcessor-ul — serverul nu vede nicio diferență.
//
// Fără fișier separat de worklet (build-ul rămâne simplu): codul procesorului
// pleacă printr-un Blob URL. Pe un browser fără AudioWorklet, apelantul cade
// singur pe ScriptProcessor (întoarcem null, nu aruncăm) — vocea nu moare.

const COD_PROCESOR = `
class CulegatorPcm extends AudioWorkletProcessor {
  constructor() {
    super()
    this.strans = []
    this.mostre = 0
  }
  process(intrari) {
    const canal = intrari[0] && intrari[0][0]
    if (canal && canal.length) {
      this.strans.push(canal.slice(0))
      this.mostre += canal.length
      if (this.mostre >= 4096) {
        const tot = new Float32Array(this.mostre)
        let poz = 0
        for (const b of this.strans) { tot.set(b, poz); poz += b.length }
        this.port.postMessage(tot, [tot.buffer])
        this.strans = []
        this.mostre = 0
      }
    }
    return true
  }
}
registerProcessor('culegator-pcm', CulegatorPcm)
`

export interface CulesPcm {
  opreste(): void
}

// Contextul audio e acum PARTAJAT între sesiuni (audioContextPartajat.ts):
// `registerProcessor` cu același nume de două ori pe același worklet aruncă,
// deci modulul se înregistrează O DATĂ per context și se reține aici.
const contexteCuModul = new WeakSet<AudioContext>()

/** Pornește culesul: `laCadru` primește bucăți Float32 (~4096 mostre, rata
 *  contextului). Întoarce null dacă browserul nu poate — apelantul cade pe
 *  ScriptProcessor, cu deprecarea lui cu tot (mai bine deprecat decât mut). */
export async function pornesteCulesPcm(
  ctx: AudioContext,
  sursa: AudioNode,
  laCadru: (brut: Float32Array) => void,
): Promise<CulesPcm | null> {
  try {
    if (!ctx.audioWorklet) return null
    if (!contexteCuModul.has(ctx)) {
      const url = URL.createObjectURL(new Blob([COD_PROCESOR], { type: 'application/javascript' }))
      try {
        await ctx.audioWorklet.addModule(url)
      } finally {
        URL.revokeObjectURL(url)
      }
      contexteCuModul.add(ctx)
    }
    const nod = new AudioWorkletNode(ctx, 'culegator-pcm', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] })
    nod.port.onmessage = (ev: MessageEvent): void => laCadru(ev.data as Float32Array)
    sursa.connect(nod)
    // Ieșirea (tăcere) intră în graf ca procesorul să bată — aceeași nevoie pe
    // care o avea și ScriptProcessor („necesar ca onaudioprocess să ruleze").
    nod.connect(ctx.destination)
    return {
      opreste(): void {
        try { nod.port.onmessage = null } catch { /* deja mort */ }
        try { sursa.disconnect(nod) } catch { /* deja mort */ }
        try { nod.disconnect() } catch { /* deja mort */ }
      },
    }
  } catch {
    return null
  }
}
