import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { getSessionUser } from '../session.js'
import { getPool, citesteSold, recordCost, dbEnabled } from '../db.js'
import { cautareStructurata } from '../services/google.js'
import { citestePagina, gasesteAgentViu, cheamaAgent } from '../services/agentiKelion.js'
import { geminiDirectChat } from '../services/geminiDirect.js'
import { config } from '../config.js'

// ── ADAPTAREA CV — REALĂ, NU SIMULATĂ (Adrian, 10 aug) ───────────────────────
// Prima versiune (ordinul #166 al constructorului) avea joburi HARDCODATE și o
// „adaptare" cu text inventat — zero căutare, zero creier. Ordinele ownerului:
// „nu a afișat niciun job" · „fără joburi hardcodate, doar ce apare la căutare" ·
// „vreau să pui toți agenții pe tabul de adaptare CV, cu logicile toate activate,
// cu management activat... intră pe platformele de recrutare, vezi cum
// funcționează și adaptezi real" · „tab să-mi încarc CV în orice format" ·
// „funcțiile tranzacționare și adaptare CV vor fi pentru useri plătitori".
//
// Acum: căutarea = Google REAL (Serper) cu site: pe platformele de recrutare;
// adaptarea = lanțul de agenți specialiști (cercetare → adaptare → verificare →
// plan), fiecare cu unelte reale (căutare web + citirea paginii anunțului);
// încărcarea CV = text/Markdown direct, PDF și imagini prin extragerea Gemini
// (nativ multimodal). Nicio listă inventată: căutarea picată se SPUNE
// (search_unavailable), nu se maschează cu o listă goală „fără rezultate".
//
// CONSTRÂNGERE REALĂ, spusă pe față: LinkedIn/Indeed blochează scrapingul de pe
// IP-uri de datacenter. Ce facem noi e REAL dar prin Google (Serper): găsim
// anunțurile publice indexate, cu link — omul aplică pe platformă, cu CV-ul
// adaptat de noi. Nu pretindem „cont conectat la LinkedIn".

const PLATFORME: Record<string, { site: string; nume: string }> = {
  linkedin: { site: 'linkedin.com/jobs', nume: 'LinkedIn' },
  indeed: { site: 'indeed.com', nume: 'Indeed' },
  cv_library: { site: 'cv-library.co.uk', nume: 'CV Library' },
}

interface JobGasit {
  id: string
  platform: string
  title: string
  link: string
  description: string
}

interface AdaptBody {
  jobs?: { title?: string; link?: string; platform?: string; description?: string }[]
  jobDescription?: string
  jobLink?: string
  cvContent?: string
}

/** Poarta „useri plătitori" (Adrian, 10 aug): adminul intră mereu; un customer
 *  intră DOAR cu credit în portofel (singura noțiune reală de „plătitor" din
 *  aplicație — portofelul preplătit). Citirea picată se spune (503), nu se
 *  confundă cu „n-ai credit" (402) — regula 1. */
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

/** CV-ul salvat al userului. '' = nu există — se SPUNE, nu se inventează unul
 *  (versiunea veche fabrica un CV cu telefon inexistent — date false). */
async function citesteCv(email: string): Promise<string> {
  if (!dbEnabled()) return ''
  try {
    const r = await getPool().query<{ value: string }>('SELECT value FROM kv_state WHERE key = $1', [`cv_implicit:${email}`])
    return r.rows[0]?.value ?? ''
  } catch {
    return ''
  }
}

/** Un pas din lanțul de agenți: cheamă specialistul, contabilizează costul.
 *  Eșecul unui pas nu îngroapă tot lanțul — se raportează pasul picat. */
async function pasAgent(
  idAgent: string,
  numePas: string,
  sarcina: string,
  email: string,
  caAdmin: boolean,
): Promise<{ agent: string; nume: string; text: string; ok: boolean }> {
  const a = await gasesteAgentViu(idAgent)
  if (!a) return { agent: idAgent, nume: numePas, text: `agentul ${idAgent} nu există în roster`, ok: false }
  try {
    const r = await cheamaAgent(a, sarcina, caAdmin)
    if (r.costUsd > 0) void recordCost(email, 'gemini', r.costUsd)
    return { agent: a.id, nume: numePas, text: r.text.trim(), ok: Boolean(r.text.trim()) }
  } catch (e) {
    return { agent: idAgent, nume: numePas, text: `pasul a picat: ${e instanceof Error ? e.message.slice(0, 200) : String(e)}`, ok: false }
  }
}

export async function jobsRoutes(fastify: FastifyInstance): Promise<void> {
  // CV-ul implicit — citire. '' când nu există (frontendul cere încărcarea).
  fastify.get('/api/jobs/cv-implicit', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user) return reply.status(401).send({ error: 'Neautorizat' })
    return reply.send({ cv: await citesteCv(user.email) })
  })

  // CV-ul implicit — salvare manuală (textul editat în pagină).
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

  // ÎNCĂRCAREA CV-ULUI „în orice format" (Adrian, 10 aug): text/Markdown direct;
  // PDF + imagini (scan/poză de CV) prin extragerea REALĂ Gemini (multimodal
  // nativ — fără biblioteci noi). DOCX nu e suportat de Gemini inline — se
  // spune cinstit, cu alternativa (salvează ca PDF), nu se preface.
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

  // CĂUTAREA REALĂ de joburi: Google (Serper) cu site: pe platforma aleasă.
  // Fără nimic hardcodat. Căutarea picată = 503 spus pe față, nu listă goală.
  fastify.post('/api/jobs/search', async (req, reply) => {
    const cine = await platitorul(req, reply)
    if (!cine) return
    const { query = '', platforms = Object.keys(PLATFORME) } = (req.body ?? {}) as { query?: string; platforms?: string[] }
    const term = String(query).trim()
    if (!term) return reply.status(400).send({ error: 'scrie ce cauți (titlu, tehnologie, companie)' })

    const alese = platforms.filter((p) => PLATFORME[p]).slice(0, 3)
    if (alese.length === 0) return reply.status(400).send({ error: 'alege cel puțin o platformă' })

    const jobs: JobGasit[] = []
    let picat = 0
    for (const p of alese) {
      const { site, nume } = PLATFORME[p]
      const rez = await cautareStructurata(`site:${site} ${term}`, 6)
      if (rez === null) {
        picat++
        continue
      }
      for (const r of rez) {
        jobs.push({ id: r.link, platform: nume, title: r.title, link: r.link, description: r.snippet })
      }
    }
    if (picat === alese.length) {
      return reply.status(503).send({ error: 'căutarea nu e disponibilă acum (cheia/cota Serper) — nu pot căuta joburi reale în acest moment' })
    }
    return reply.send({ jobs, nota: jobs.length === 0 ? `Google nu a întors anunțuri pentru „${term}" pe platformele alese — încearcă alți termeni.` : undefined })
  })

  // ADAPTAREA REALĂ — lanțul de agenți („toți agenții... cu management activat,
  // pași logici ca pentru om"): 1. Cercetare (cautator — citește anunțul real +
  // caută compania), 2. Adaptare (documente — rescrie CV-ul CINSTIT, fără
  // experiență inventată, + scrisoarea de intenție), 3. Verificare (critic —
  // golurile reale, versiunea finală), 4. Plan (planificator — întrebări de
  // interviu + pașii de aplicare). Fiecare pas se întoarce în răspuns, la vedere.
  fastify.post('/api/jobs/adapt', async (req, reply) => {
    const cine = await platitorul(req, reply)
    if (!cine) return
    const { jobs = [], jobDescription = '', jobLink = '', cvContent = '' } = (req.body ?? {}) as AdaptBody

    // 1. CV-ul de adaptat — cel trimis sau cel salvat. Fără CV nu inventăm unul.
    const cv = (cvContent || (await citesteCv(cine.email))).trim()
    if (!cv) return reply.status(400).send({ error: 'Nu ai un CV salvat — încarcă-l sau scrie-l întâi în „CV-ul Tău".' })

    // 2. Contextul REAL al joburilor țintă: titlu+platformă+fragment din căutare
    // + textul PAGINII anunțului (citit acum, nu presupus). Max 3 ținte.
    const tinte = jobs.filter((j) => j?.title || j?.link).slice(0, 3)
    let context = ''
    for (const j of tinte) {
      context += `\n--- ANUNȚ: ${j.title ?? '(fără titlu)'} (${j.platform ?? '?'}) ---\n`
      if (j.description) context += `Fragment din căutare: ${j.description}\n`
      if (j.link) {
        const pagina = await citestePagina(j.link)
        context += pagina.startsWith('{"error"')
          ? `Pagina anunțului (${j.link}) nu s-a putut citi — se folosește doar fragmentul din căutare.\n`
          : `Textul paginii anunțului:\n${pagina.slice(0, 5000)}\n`
      }
    }
    if (jobLink.trim()) {
      const pagina = await citestePagina(jobLink.trim())
      context += `\n--- ANUNȚ DIN LINK ---\n${pagina.startsWith('{"error"') ? `Pagina (${jobLink}) nu s-a putut citi: ${pagina}` : pagina.slice(0, 5000)}\n`
    }
    if (jobDescription.trim()) context += `\n--- DESCRIEREA DATĂ DE UTILIZATOR ---\n${jobDescription.trim().slice(0, 5000)}\n`
    if (!context.trim()) return reply.status(400).send({ error: 'Selectează cel puțin un job din căutare sau dă un link/o descriere.' })

    // 3. LANȚUL DE AGENȚI — pașii unui om care aplică, pe bune.
    const pasi: { agent: string; nume: string; text: string; ok: boolean }[] = []

    const cercetare = await pasAgent(
      'cautator', 'Cercetare',
      `Un candidat aplică la joburile de mai jos. Cercetează REAL (căutare web + citește pagini dacă ajută): ce cere concret fiecare rol, ce e important pentru angajator/companie, cuvintele-cheie pe care sistemele de filtrare CV (ATS) le caută. Scurt și concret, pe puncte, per anunț.\n${context}`,
      cine.email, cine.admin,
    )
    pasi.push(cercetare)

    const adaptare = await pasAgent(
      'documente', 'Adaptare CV + scrisoare',
      `Rescrie CV-ul de mai jos ADAPTAT pentru anunțurile date. REGULĂ DE FIER: nimic inventat — nu adăuga experiență, ani sau tehnologii care nu apar în CV-ul original; doar reformulezi, reordonezi și scoți în față ce se potrivește, cu cuvintele-cheie ale anunțului. Apoi scrie o SCRISOARE DE INTENȚIE scurtă (max 150 de cuvinte), concretă, fără șabloane goale.\n\nCV ORIGINAL:\n${cv}\n\nANUNȚURILE:\n${context}\n\nCE A AFLAT CERCETAREA:\n${cercetare.ok ? cercetare.text : '(cercetarea a picat — folosește doar anunțurile)'}\n\nFormat: întâi CV-ul adaptat complet, apoi „--- SCRISOARE DE INTENȚIE ---" și scrisoarea.`,
      cine.email, cine.admin,
    )
    pasi.push(adaptare)
    if (!adaptare.ok) {
      return reply.status(502).send({ error: `adaptarea a picat: ${adaptare.text}`, pasi })
    }

    const verificare = await pasAgent(
      'critic', 'Verificare',
      `Verifică CV-ul adaptat față de anunțuri: 1) A inventat ceva ce nu era în original? (dacă da, spune exact ce trebuie scos) 2) Ce cerințe REALE ale anunțului nu sunt acoperite de candidat (golurile, cinstit)? 3) Trei îmbunătățiri concrete. Scurt, pe puncte.\n\nCV ORIGINAL:\n${cv.slice(0, 6000)}\n\nCV ADAPTAT:\n${adaptare.text.slice(0, 8000)}\n\nANUNȚURILE:\n${context.slice(0, 4000)}`,
      cine.email, cine.admin,
    )
    pasi.push(verificare)

    const plan = await pasAgent(
      'planificator', 'Plan de aplicare + interviu',
      `Pentru candidatura de mai jos, fă: 1) PAȘII CONCREȚI de aplicare (unde intră, pe ce link aplică, ce atașează, când revine cu follow-up); 2) 5 ÎNTREBĂRI PROBABILE de interviu PENTRU ACESTE roluri, cu schița răspunsului bazată STRICT pe CV-ul candidatului (nimic inventat).\n\nANUNȚURILE:\n${context.slice(0, 4000)}\n\nCV ADAPTAT:\n${adaptare.text.slice(0, 6000)}`,
      cine.email, cine.admin,
    )
    pasi.push(plan)

    return reply.send({
      success: true,
      adaptedCv: adaptare.text,
      verificare: verificare.ok ? verificare.text : undefined,
      plan: plan.ok ? plan.text : undefined,
      pasi: pasi.map((p) => ({ agent: p.agent, nume: p.nume, ok: p.ok, text: p.text })),
      message: 'Adaptare făcută cu lanțul de agenți (cercetare → adaptare → verificare → plan).',
    })
  })
}
