import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { getSessionUser } from '../session.js'
import { getPool, citesteSold, recordCost, dbEnabled } from '../db.js'
import { gasesteAgentViu, cheamaAgent } from '../services/agentiKelion.js'
import { geminiDirectChat } from '../services/geminiDirect.js'
import { config } from '../config.js'

// ── ADAPTAREA CV — FLUXUL SIMPLU (Adrian, 10 aug, redesign) ──────────────────
// „User introduce CV de bază, user își caută singur un job, tu primești
// specificația TOTALĂ a jobului și inserezi în CV-ul lui cerințele jobului — DAR
// CU CAP, nu din topor —, previzualizezi și trimiți către download versiunea
// «nume_aplicant_nume_job». În rest scoți tot de la opțiunea asta."
//
// Deci: NU mai există căutare de joburi / platforme / salariu / locație aici.
// Doar: CV de bază (scris sau încărcat în orice format) + specificația jobului
// lipită de user → adaptare inteligentă (inserează cerințele REALE pe care
// candidatul le are, reformulate cu terminologia anunțului; fără invenție, fără
// îndesat de cuvinte-cheie) → previzualizare → download.

/** Poarta „useri plătitori": adminul intră mereu; un customer intră DOAR cu
 *  credit în portofel. Citirea picată se spune (503), nu se confundă cu „n-ai
 *  credit" (402) — regula 1. */
async function platitorul(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<{ email: string; admin: boolean } | null> {
  const user = getSessionUser(req)
  if (!user) {
    reply.code(401).send({ error: 'Neautorizat' })
    return null
  }
  if (user.role === 'admin') return { email: user.email, admin: true }
  const sold = await citesteSold(user.email)
  if (!sold.citit) {
    reply.code(503).send({ error: `nu pot verifica portofelul: ${sold.motiv}` })
    return null
  }
  if (sold.sold <= 0) {
    reply.code(402).send({ error: 'Adaptarea CV e pentru utilizatorii cu credit. Alimentează portofelul ca s-o folosești.' })
    return null
  }
  return { email: user.email, admin: false }
}

/** CV-ul salvat al userului. '' = nu există — se SPUNE, nu se inventează unul. */
async function citesteCv(email: string): Promise<string> {
  if (!dbEnabled()) return ''
  try {
    const r = await getPool().query<{ value: string }>('SELECT value FROM kv_state WHERE key = $1', [`cv_implicit:${email}`])
    return r.rows[0]?.value ?? ''
  } catch {
    return ''
  }
}

/** Nume de fișier sigur: doar litere/cifre, restul → „_". */
function curataNume(s: string, implicit: string): string {
  return String(s ?? '').trim().replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_+|_+$/g, '').slice(0, 60) || implicit
}

export async function jobsRoutes(fastify: FastifyInstance): Promise<void> {
  // CV-ul de bază — citire. '' când nu există (frontendul cere încărcarea).
  fastify.get('/api/jobs/cv-implicit', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user) return reply.status(401).send({ error: 'Neautorizat' })
    return reply.send({ cv: await citesteCv(user.email) })
  })

  // CV-ul de bază — salvare manuală (textul editat în pagină).
  fastify.put('/api/jobs/cv-implicit', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user) return reply.status(401).send({ error: 'Neautorizat' })
    const { cv } = (req.body ?? {}) as { cv?: string }
    if (!cv?.trim()) return reply.status(400).send({ error: 'Conținutul CV-ului este obligatoriu' })
    if (!dbEnabled()) return reply.status(503).send({ error: 'baza de date nu e configurată — CV-ul nu se poate salva' })
    await getPool().query(
      `INSERT INTO kv_state (key, value, updated_at) VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [`cv_implicit:${user.email}`, cv.slice(0, 40_000)],
    )
    return reply.send({ success: true, message: 'CV-ul a fost salvat.' })
  })

  // ÎNCĂRCAREA CV-ULUI „în orice format": text/Markdown direct; PDF + imagini
  // (scan/poză) prin extragerea REALĂ Gemini (multimodal nativ). DOCX nu e
  // suportat inline — se spune cinstit (salvează ca PDF), nu se preface.
  fastify.post('/api/jobs/cv-incarca', async (req, reply) => {
    const cine = await platitorul(req, reply)
    if (!cine) return
    const { nume = '', mime = '', base64 = '' } = (req.body ?? {}) as { nume?: string; mime?: string; base64?: string }
    if (!base64) return reply.status(400).send({ error: 'fișierul lipsește' })
    if (base64.length > 11_000_000) return reply.status(413).send({ error: 'fișier prea mare (max ~8MB)' })
    const ext = (nume.split('.').pop() ?? '').toLowerCase()

    let text = ''
    if (mime.startsWith('text/') || ['txt', 'md', 'csv'].includes(ext)) {
      text = Buffer.from(base64, 'base64').toString('utf8')
    } else if (mime === 'application/pdf' || ext === 'pdf' || mime.startsWith('image/')) {
      const mimeReal = mime || 'application/pdf'
      try {
        const r = await geminiDirectChat(config.geminiModel, [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Extrage TEXTUL COMPLET al acestui CV, verbatim, păstrând structura (secțiuni, liste). Doar textul, fără comentarii.' },
              { type: 'image_url', image_url: { url: `data:${mimeReal};base64,${base64}` } },
            ],
          },
        ], [], { maxTokens: 4096, temperature: 0 })
        if (r.costUsd > 0) void recordCost(cine.email, 'gemini', r.costUsd)
        text = r.text.trim()
      } catch (e) {
        return reply.status(502).send({ error: `extragerea a picat: ${e instanceof Error ? e.message.slice(0, 160) : String(e)}` })
      }
      if (!text) return reply.status(422).send({ error: 'nu am putut extrage text din fișier (e gol sau necitibil)' })
    } else if (['doc', 'docx', 'odt', 'rtf'].includes(ext)) {
      return reply.status(415).send({ error: 'formatul Word nu e suportat direct — salvează CV-ul ca PDF sau text și încarcă-l așa' })
    } else {
      return reply.status(415).send({ error: `format necunoscut (${mime || ext || 'fără tip'}) — merge text, Markdown, PDF sau imagine` })
    }

    text = text.trim().slice(0, 40_000)
    if (!text) return reply.status(422).send({ error: 'fișierul nu conține text' })
    if (!dbEnabled()) return reply.status(503).send({ error: 'baza de date nu e configurată — CV-ul nu se poate salva' })
    await getPool().query(
      `INSERT INTO kv_state (key, value, updated_at) VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [`cv_implicit:${cine.email}`, text],
    )
    return reply.send({ success: true, cv: text, message: 'CV-ul a fost citit și salvat.' })
  })

  // ADAPTAREA „CU CAP" — un singur pas, agentul „documente" pe efort înalt.
  // Input: CV-ul de bază + specificația COMPLETĂ a jobului (lipită de user) +
  // numele aplicantului (pentru fișier). Output: CV-ul adaptat + titlul jobului
  // + numele fișierului „nume_aplicant_nume_job".
  fastify.post('/api/jobs/adapt', async (req, reply) => {
    const cine = await platitorul(req, reply)
    if (!cine) return
    const { cvContent = '', jobSpec = '', applicantName = '' } =
      (req.body ?? {}) as { cvContent?: string; jobSpec?: string; applicantName?: string }

    const cv = (cvContent || (await citesteCv(cine.email))).trim()
    if (!cv) return reply.status(400).send({ error: 'Nu ai un CV — încarcă-l sau scrie-l întâi în „CV-ul Tău".' })
    const spec = String(jobSpec).trim()
    if (!spec) return reply.status(400).send({ error: 'Lipsește specificația jobului — lipește anunțul complet.' })

    const agent = await gasesteAgentViu('documente')
    if (!agent) return reply.status(503).send({ error: 'agentul de documente nu e disponibil acum' })

    const sarcina =
      `Ai CV-ul de bază al candidatului și specificația COMPLETĂ a unui job. Rescrie CV-ul candidatului ADAPTAT pentru ACEST job:\n` +
      `- inserează și scoate în față EXACT cerințele/atribuțiile jobului pe care candidatul le ARE deja în CV, reformulate cu terminologia anunțului (ca să treacă și filtrele ATS);\n` +
      `- reordonează secțiunile ca cele mai relevante pentru job să fie sus;\n` +
      `- CU CAP, nu din topor: NU îndesa liste de cuvinte-cheie, NU inventa experiență, ani, tehnologii sau realizări care nu apar în CV-ul original — doar reformulezi și evidențiezi ce se potrivește REAL;\n` +
      `- păstrează structura de CV (contact, sumar, experiență, competențe, educație) și limba CV-ului original.\n` +
      `RĂSPUNDE STRICT în formatul:\nJOB: <titlul jobului, scurt, un singur rând>\n---\n<CV-ul adaptat complet, gata de trimis>\n\n` +
      `CV DE BAZĂ:\n${cv}\n\nSPECIFICAȚIA JOBULUI:\n${spec.slice(0, 9000)}`

    let text = ''
    try {
      const r = await cheamaAgent({ ...agent, efort: 'high' }, sarcina, cine.admin)
      if (r.costUsd > 0) void recordCost(cine.email, 'gemini', r.costUsd)
      text = r.text.trim()
    } catch (e) {
      return reply.status(502).send({ error: `adaptarea a picat: ${e instanceof Error ? e.message.slice(0, 200) : String(e)}` })
    }
    if (!text) return reply.status(502).send({ error: 'adaptarea a întors gol — încearcă din nou' })

    // Despărțim titlul jobului (pentru numele fișierului) de CV-ul adaptat.
    let jobName = ''
    let adaptedCv = text
    const m = /^\s*JOB:\s*(.+?)\s*\n\s*-{3,}\s*\n([\s\S]*)$/.exec(text)
    if (m) {
      jobName = m[1].trim().slice(0, 80)
      adaptedCv = m[2].trim()
    }

    const fileName = `${curataNume(applicantName, 'aplicant')}_${curataNume(jobName, 'job')}`
    return reply.send({ success: true, adaptedCv, jobName: jobName || undefined, fileName })
  })
}
