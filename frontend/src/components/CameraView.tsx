import { useEffect, useRef, useState, type MutableRefObject } from 'react'
import {
  startCamera,
  stopStream,
  boostLowLight,
  isFatalCameraError,
  getCameraErrorCode,
  type Facing,
} from '../lib/camera'
import { startFaceSampling } from '../lib/faceprint'
import { getTeava, calitateCamera } from '../lib/retea'
import { raporteazaPozaVizitei } from '../lib/vizita'

// Device camera capture — NOT shown on screen. The feed is for Kelion's vision
// only: the <video> element is kept playing but visually hidden, and frames are
// grabbed via `captureRef` and sent to the brain (permanent vision). The element
// stays off-screen (not display:none) so the browser keeps decoding frames.
// Frames are downscaled to keep the payload small.
export default function CameraView({
  active,
  facing,
  onError,
  captureRef,
}: {
  readonly active: boolean
  readonly facing: Facing
  readonly onError: () => void
  readonly captureRef?: MutableRefObject<(() => string | null) | null>
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const faceStopRef = useRef<(() => void) | null>(null)
  const [retryNonce, setRetryNonce] = useState(0)
  // CRONOMETRUL PORNIRII (owner, 14 aug: „nici nu capturează după ce dau accept"
  // + „delay enorm"). Ca următorul raport să vină cu CIFRA fazei vinovate, nu cu
  // ghicit: măsurăm de la activare → flux → play → PRIMUL CADRU capturat, și
  // scriem fiecare fază în consolă. Peste 5s până la primul cadru = EROARE
  // (console.error → intră în client_errors → o vede și Kelion, și self-heal).
  const tPornireRef = useRef(0)

  // Start/stop the camera stream. Camera access is serialised inside camera.ts,
  // so rapid flips (front/back) or React StrictMode remounts cannot grab the
  // sensor before the previous stop has released it.
  useEffect(() => {
    if (!active) {
      faceStopRef.current?.()
      faceStopRef.current = null
      stopStream(streamRef.current)
      streamRef.current = null
      return
    }

    const controller = new AbortController()
    tPornireRef.current = performance.now()
    void (async () => {
      try {
        const stream = await startCamera(facing, controller.signal)
        if (controller.signal.aborted) {
          stopStream(stream)
          return
        }
        // eslint-disable-next-line no-console
        console.log(`[cameră] flux obținut după ${Math.round(performance.now() - tPornireRef.current)} ms (getUserMedia + coadă de eliberare)`)
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play().catch(() => undefined)
          // eslint-disable-next-line no-console
          console.log(`[cameră] play pornit după ${Math.round(performance.now() - tPornireRef.current)} ms de la activare`)
        }
        // Lift exposure/gain after the stream is alive — the browser may have
        // started conservatively in dim light.
        await boostLowLight(stream).catch(() => undefined)
        // Face sampling in the BACKGROUND (owner vs. someone else recognition).
        // Starts only now (live camera), runs decoupled from chat, stops at
        // cleanup. It blocks nothing on the reply path.
        if (videoRef.current && !faceStopRef.current) {
          faceStopRef.current = startFaceSampling(
            videoRef.current,
            () => captureRef?.current?.() ?? null,
          )
        }
        // POZA VIZITEI (P3; owner, 15 aug: „de ce nu e legata de vizitator
        // poza"): camera e ACORDATĂ și vie — un singur cadru mic pe sesiune
        // pleacă spre rândul vizitei. La 1,5s, ca senzorul să apuce să expună
        // (primul cadru după pornire iese des negru). Best-effort.
        setTimeout(() => raporteazaPozaVizitei(videoRef.current), 1500)
      } catch (err) {
        // If our own cleanup aborted the request, this is not a real error.
        if (controller.signal.aborted) return
        const code = getCameraErrorCode(err)
        const fatal = isFatalCameraError(err)
        const message = err instanceof Error ? err.message : String(err)
        // eslint-disable-next-line no-console
        console.error(`camera nu pornește: ${code}${fatal ? ' (fatal)' : ''} (facing=${facing})`, message)
        onError()
      }
    })()

    return () => {
      controller.abort()
      faceStopRef.current?.()
      faceStopRef.current = null
      stopStream(streamRef.current)
      streamRef.current = null
    }
    // `captureRef` lipsea din listă. E un ref (identitate stabilă), deci
    // adăugarea NU schimbă când rulează efectul — dar oprește avertismentul și,
    // mai important, ține lista sinceră: dacă mâine devine altceva decât un ref,
    // efectul chiar trebuie să reacționeze la el.
  }, [active, facing, onError, retryNonce, captureRef])

  // If the page regains focus or comes back online, try to recover from a
  // transient failure (camera busy, permission prompt dismissed, etc.).
  useEffect(() => {
    if (!active) return
    const tryResume = () => {
      if (document.hidden) return
      if (streamRef.current) return
      setRetryNonce((n) => n + 1)
    }
    window.addEventListener('focus', tryResume)
    document.addEventListener('visibilitychange', tryResume)
    window.addEventListener('online', tryResume)
    return () => {
      window.removeEventListener('focus', tryResume)
      document.removeEventListener('visibilitychange', tryResume)
      window.removeEventListener('online', tryResume)
    }
  }, [active])

  // Register a frame grabber (latest frame as a downscaled JPEG data URL).
  useEffect(() => {
    if (!captureRef) return
    // ── CANVASURI REFOLOSITE + SONDĂ MICĂ (măsurat 8 aug, consola ownerului) ──
    // Vechea captare făcea, la FIECARE tick de 250 ms: un canvas NOU, drawImage
    // la 768px, apoi getImageData(768) — o citire GPU→CPU sincronă — uneori de
    // DOUĂ ori (a doua oară pentru boost-ul de lumină). Ceasul cu nume a prins-o
    // în flagrant: „captare cadre cameră a ținut firul 2312 ms (vârf 6341 ms)"
    // — iar cererea de chat a așteptat EXACT 6334 ms în spatele ei. Alea erau
    // secundele de întârziere reclamate.
    // Acum: lumina se măsoară pe o sondă de 48×27 (getImageData de ~500× mai
    // ieftin), canvasurile se refolosesc, iar citirea mare (768px) nu se mai
    // face deloc — cadrul mare doar se desenează și se împachetează JPEG.
    const panzaMare = document.createElement('canvas')
    const sonda = document.createElement('canvas')
    sonda.width = 48
    sonda.height = 27

    /** Fracția de pixeli „aprinși" din sondă (sub filtrul dat), sau null dacă
     *  sonda nu se poate citi (canvas pătat — atunci avem încredere în cadru). */
    const masoaraLumina = (v: HTMLVideoElement, filtru: string): number | null => {
      const pctx = sonda.getContext('2d', { willReadFrequently: true })
      if (!pctx) return null
      pctx.filter = filtru
      pctx.drawImage(v, 0, 0, sonda.width, sonda.height)
      try {
        const d = pctx.getImageData(0, 0, sonda.width, sonda.height).data
        let lit = 0
        let total = 0
        for (let i = 0; i < d.length; i += 16) {
          total++
          if (d[i] + d[i + 1] + d[i + 2] > 36) lit++ // peste aproape-negru
        }
        return total > 0 ? lit / total : 0
      } catch {
        return null
      }
    }

    // ── CAPTURĂ NON-BLOCANTĂ (owner, 13 aug, log live: „captare cadre cameră a
    // ținut firul 8720 ms — repară să nu mai am așa ceva"). `toDataURL` e o
    // encodare JPEG + citire GPU→CPU SINCRONĂ: când GPU-ul e sufocat (avatar +
    // face-api + o pagină browser pe monitor) blochează firul principal SECUNDE,
    // iar lip-sync-ul/vocea sar. Fixul din #1053 (pauză cât VORBEȘTE Kelion) nu
    // acoperea cazul „tăcut, dar creierul așteaptă serverul 18s". Acum encode-ul e
    // ASINCRON, în afara firului: `createImageBitmap` (redimensionare off-thread) →
    // `OffscreenCanvas.convertToBlob` (encode async) → dataURL. captureRef întoarce
    // INSTANT ultimul cadru gata — nu mai blochează niciodată firul.
    let ultimulCadru: string | null = null
    let ocupat = false
    const suportaAsync =
      typeof createImageBitmap === 'function' && typeof OffscreenCanvas === 'function'

    const blobLaDataUrl = (b: Blob): Promise<string> =>
      new Promise((rez, resp) => {
        const fr = new FileReader()
        fr.onload = () => rez(String(fr.result))
        fr.onerror = () => resp(fr.error ?? new Error('citire blob'))
        fr.readAsDataURL(b)
      })

    const reincarca = async (): Promise<void> => {
      const v = videoRef.current
      // Cadrul e real doar după ce camera a DECODAT o imagine (readyState >= 2);
      // altfel drawImage ar prinde un dreptunghi negru.
      if (ocupat || !v || !v.videoWidth || v.readyState < 2) return
      ocupat = true
      try {
        // CALITATE ADAPTIVĂ LA ȚEAVĂ (12 aug): pe 4G/Wi-Fi 512/0.6; pe 3G/2G scade.
        const cal = calitateCamera(getTeava())
        const scale = Math.min(1, cal.maxDim / Math.max(v.videoWidth, v.videoHeight))
        const w = Math.round(v.videoWidth * scale)
        const h = Math.round(v.videoHeight * scale)
        // Lumina + boost pe sonda mică 48×27 (sync, ~500× mai ieftin decât cadrul).
        const lit = masoaraLumina(v, 'none')
        let filtru = 'none'
        if (lit !== null) {
          if (lit === 0) {
            ultimulCadru = null // lentila acoperită
            return
          }
          if (lit < 0.08) {
            const boost = lit < 0.02 ? 2.8 : lit < 0.04 ? 2.2 : 1.8
            filtru = `brightness(${boost}) contrast(${Math.min(1.4, 1 + boost * 0.15)})`
            const litBoost = masoaraLumina(v, filtru)
            if (litBoost !== null && litBoost < 0.02) {
              ultimulCadru = null // și boostat rămâne negru — senzorul nu dă imagine
              return
            }
          }
        }
        if (suportaAsync) {
          const bmp = await createImageBitmap(v, {
            resizeWidth: w,
            resizeHeight: h,
            resizeQuality: 'low',
          })
          const off = new OffscreenCanvas(w, h)
          const octx = off.getContext('2d')
          if (!octx) {
            bmp.close()
            return
          }
          octx.filter = filtru
          octx.drawImage(bmp, 0, 0, w, h)
          bmp.close()
          const blob = await off.convertToBlob({ type: 'image/jpeg', quality: cal.jpeg })
          ultimulCadru = await blobLaDataUrl(blob)
        } else {
          // Cădere sigură (browsere fără OffscreenCanvas/createImageBitmap): calea
          // sincronă de dinainte — rară, și pe astea nu rulează avatarul greu.
          if (panzaMare.width !== w) panzaMare.width = w
          if (panzaMare.height !== h) panzaMare.height = h
          const ctx = panzaMare.getContext('2d')
          if (!ctx) return
          ctx.filter = filtru
          ctx.drawImage(v, 0, 0, w, h)
          ultimulCadru = panzaMare.toDataURL('image/jpeg', cal.jpeg)
        }
      } catch {
        /* un cadru prost nu oprește bucla */
      } finally {
        ocupat = false
      }
    }

    // captureRef = citirea INSTANT a ultimului cadru gata (nu atinge GPU-ul, nu
    // blochează firul); reîmprospătarea se face în fundal la ~1s (ajunge pentru
    // vedere + faceprint), nu la 4 fps sincron care sufoca firul.
    captureRef.current = () => ultimulCadru
    // PORNIRE RAPIDĂ (owner, 14 aug: „vede exact, dar are delay enorm la pornire").
    // Înainte: un tick FIX la 1000 ms — dacă primul tick prindea camera încă
    // nedecodată (readyState<2), primul cadru bun venea abia la următorul tick →
    // 1-3 s de „orb" la pornire. Acum: sondăm DES (150 ms) până prindem PRIMUL
    // cadru, apoi revenim la ritmul lent (1 s, care ajunge pentru vedere+faceprint
    // și nu sufocă firul). Auto-planificat (setTimeout), guardat de `ocupat`.
    let primaGata = false
    let idReincarca = 0
    const planifica = (): void => {
      idReincarca = window.setTimeout(() => {
        void reincarca().then(() => {
          if (!primaGata && ultimulCadru) {
            primaGata = true
            // CIFRA care închide ghicitul (14 aug): cât a durat REAL de la
            // activarea camerei până la primul cadru capturat. Sub 5s = doar
            // informativ; peste = EROARE raportată (client_errors → self-heal).
            const ms = Math.round(performance.now() - tPornireRef.current)
            if (ms > 5000) {
              // eslint-disable-next-line no-console
              console.error(`cameră lentă: primul cadru abia după ${ms} ms de la pornire (flux+decodare) — de investigat faza din jurnalul [cameră]`)
            } else {
              // eslint-disable-next-line no-console
              console.log(`[cameră] primul cadru capturat după ${ms} ms de la activare`)
            }
          }
          planifica()
        })
      }, primaGata ? 1000 : 150)
    }
    void reincarca()
    planifica()
    return () => {
      window.clearTimeout(idReincarca)
      captureRef.current = null
    }
  }, [captureRef])

  if (!active) return null
  // Hidden from the user — Kelion's eyes only. Kept off-screen (not display:none)
  // so the browser keeps decoding frames for capture.
  return <video ref={videoRef} muted playsInline aria-hidden className="camera-hidden" />
}
