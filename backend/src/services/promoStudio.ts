import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { chromium } from 'playwright'
import { synthesize } from './tts.js'
import { saveAppFile, listStudioFiles } from '../db.js'
import { config } from '../config.js'

// ── STUDIOUL LUI KELION (Adrian, 27 iul: „Kelion trebuie să poată da rec să-și
// înregistreze propriile filmulețe de reclamă... are capabilitate să-și opereze
// tot până la salvare; comanda mea verbală, dată scris sau audio") ────────────
// Butonul Rec din browser cere prin construcție clickul unui om (getDisplayMedia
// — regulă de securitate a browserului). Autonomia se face deci PE SERVER:
//   1. narația: fiecare segment de scenariu → TTS (aceeași voce „ash" ca vocea
//      live), concatenat cu ffmpeg; durata fiecărui segment măsurată cu ffprobe;
//   2. LIMBILE (regula lui Adrian): comanda vine în română, CLIPUL e în engleză;
//      segmentele demonstrative în alte limbi primesc subtitrare în engleză,
//      ARSĂ în imagine doar pe porțiunile ne-engleze (SRT generat din durate);
//   3. imaginea: Chromium-ul de pe server (Playwright, recordVideo) deschide
//      scena /studio.html — care randează cadrele programate (carduri de titlu,
//      aplicația însăși în iframe same-origin, pagini web, imagini) — și
//      filmează exact durata narației;
//   4. lipirea: ffmpeg mux video+narație (+subtitrări) → mp4 H.264;
//   5. salvarea: app_files (supraviețuiește redeploy-urilor) → /dl/<nume>.
// Totul rulează în fundal — unealta întoarce imediat, starea se citește cu
// studio_status. Un singur episod se filmează la un moment dat.

const pExecFile = promisify(execFile)

export interface StudioSegment {
  /** Limba vorbită a segmentului (en/ro/fr/...). Clipul e implicit în engleză. */
  lang: string
  text: string
  /** Traducerea engleză pentru subtitrare — obligatorie când lang ≠ en. */
  en?: string
}
export interface StudioScene {
  /** Secunda la care apare scena. */
  at: number
  kind: 'title' | 'app' | 'web' | 'image'
  /** Pentru title: textul cardului. */
  text?: string
  /** Pentru web/image: URL-ul afișat. */
  url?: string
}
export interface StudioSpec {
  title: string
  segments: StudioSegment[]
  scenes: StudioScene[]
}

interface StudioState {
  status: 'idle' | 'filming' | 'processing' | 'done' | 'failed'
  title: string
  startedAt: number
  note: string
  url?: string
  seconds?: number
}

let state: StudioState = { status: 'idle', title: '', startedAt: 0, note: '' }

export function studioStatus(): string {
  return JSON.stringify({
    ...state,
    elapsedSec: state.startedAt ? Math.round((Date.now() - state.startedAt) / 1000) : 0,
    episoade: listStudioFiles().map((f) => ({
      name: f.name,
      url: `/dl/${f.name}`,
      mb: Math.round((f.bytes / 1024 / 1024) * 10) / 10,
    })),
  })
}

function slug(t: string): string {
  return (
    t
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'episod'
  )
}

function srtTime(sec: number): string {
  const ms = Math.round(sec * 1000)
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  const s = Math.floor((ms % 60_000) / 1000)
  const r = ms % 1000
  const p = (n: number, w = 2): string => String(n).padStart(w, '0')
  return `${p(h)}:${p(m)}:${p(s)},${p(r, 3)}`
}

async function audioSeconds(file: string): Promise<number> {
  const { stdout } = await pExecFile('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file,
  ])
  const n = Number(stdout.trim())
  if (!Number.isFinite(n) || n <= 0) throw new Error(`ffprobe: durată invalidă pentru ${path.basename(file)}`)
  return n
}

/** Pornește filmarea unui episod. Refuză dacă alta e deja în lucru. */
export function filmEpisode(spec: StudioSpec): { ok: boolean; note: string } {
  if (state.status === 'filming' || state.status === 'processing') {
    return { ok: false, note: `deja filmez „${state.title}" — vezi studio_status` }
  }
  const segs = (spec.segments ?? []).filter((s) => s?.text?.trim()).slice(0, 60)
  if (!segs.length) return { ok: false, note: 'scenariul e gol — dă segmente cu text' }
  const missing = segs.filter((s) => (s.lang || 'en').toLowerCase() !== 'en' && !s.en?.trim())
  if (missing.length)
    return { ok: false, note: `segmentele ne-engleze au nevoie de traducerea "en" pentru subtitrare (lipsesc ${missing.length})` }
  state = { status: 'filming', title: spec.title || 'Episod', startedAt: Date.now(), note: 'narația se generează' }
  void runFilm({ ...spec, segments: segs }).catch((e) => {
    state = { ...state, status: 'failed', note: String(e?.message ?? e).slice(0, 300) }
  })
  return { ok: true, note: 'filmarea a pornit — durează cât episodul + procesarea; urmărește cu studio_status' }
}

async function runFilm(spec: StudioSpec): Promise<void> {
  const work = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'studio-'))
  try {
    // 1. NARAȚIA — segment cu segment, cu durate reale.
    const durations: number[] = []
    const listLines: string[] = []
    for (let i = 0; i < spec.segments.length; i++) {
      const seg = spec.segments[i]
      const r = await synthesize(seg.text.trim().slice(0, 4000), seg.lang || 'en')
      if (!r.ok) throw new Error(`TTS a picat pe segmentul ${i + 1}: ${r.error}`)
      const f = path.join(work, `seg-${i}.mp3`)
      await fs.promises.writeFile(f, r.audio)
      durations.push(await audioSeconds(f))
      listLines.push(`file '${f.replace(/'/g, "'\\''")}'`)
    }
    const listFile = path.join(work, 'list.txt')
    await fs.promises.writeFile(listFile, listLines.join('\n'))
    const narration = path.join(work, 'narration.mp3')
    await pExecFile('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', narration])
    const total = Math.min(durations.reduce((a, b) => a + b, 0) + 1.5, 600)

    // 2. SUBTITRĂRILE — engleză, DOAR pe segmentele ne-engleze.
    let srtFile = ''
    let cursor = 0
    const srtBlocks: string[] = []
    for (let i = 0; i < spec.segments.length; i++) {
      const seg = spec.segments[i]
      const start = cursor
      cursor += durations[i]
      if ((seg.lang || 'en').toLowerCase() === 'en') continue
      srtBlocks.push(`${srtBlocks.length + 1}\n${srtTime(start)} --> ${srtTime(cursor)}\n${(seg.en ?? '').trim()}\n`)
    }
    if (srtBlocks.length) {
      srtFile = path.join(work, 'subs.srt')
      await fs.promises.writeFile(srtFile, srtBlocks.join('\n'))
    }

    // 3. IMAGINEA — scena /studio.html filmată exact pe durata narației.
    state = { ...state, status: 'filming', note: `filmez ${Math.round(total)}s de imagine` }
    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
    let videoPath = ''
    try {
      const ctx = await browser.newContext({
        viewport: { width: 1280, height: 720 },
        recordVideo: { dir: work, size: { width: 1280, height: 720 } },
      })
      const page = await ctx.newPage()
      const payload = Buffer.from(
        JSON.stringify({ title: spec.title, scenes: spec.scenes ?? [], total }),
        'utf8',
      ).toString('base64url')
      await page.goto(`http://127.0.0.1:${config.port}/studio.html#${payload}`, {
        waitUntil: 'load',
        timeout: 30_000,
      })
      await page.waitForTimeout(total * 1000)
      const vid = page.video()
      await ctx.close() // finalizează fișierul video
      videoPath = (await vid?.path()) ?? ''
    } finally {
      await browser.close().catch(() => {})
    }
    if (!videoPath) throw new Error('Playwright nu a produs fișierul video')

    // 4. LIPIREA — video + narație (+ subtitrări arse) → mp4.
    state = { ...state, status: 'processing', note: 'lipesc imaginea cu narația' }
    const out = path.join(work, 'out.mp4')
    const vf = srtFile
      ? ['-vf', `subtitles=${srtFile.replace(/([:\\'])/g, '\\$1')}:force_style='FontSize=18,OutlineColour=&H80000000,BorderStyle=4'`]
      : []
    await pExecFile('ffmpeg', [
      '-y', '-i', videoPath, '-i', narration,
      ...vf,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
      '-c:a', 'aac', '-b:a', '128k', '-shortest', out,
    ], { timeout: 600_000 })

    // 5. SALVAREA — episodul intră în stocarea permanentă, servit prin /dl/.
    const name = `episod-${slug(spec.title)}.mp4`
    await saveAppFile(name, await fs.promises.readFile(out), 'video/mp4')
    state = {
      status: 'done', title: spec.title, startedAt: state.startedAt,
      note: 'episodul e salvat', url: `/dl/${name}`, seconds: Math.round(total),
    }
  } finally {
    await fs.promises.rm(work, { recursive: true, force: true }).catch(() => {})
  }
}
