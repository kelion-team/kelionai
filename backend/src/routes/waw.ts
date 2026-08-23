import type { FastifyInstance } from 'fastify'
import { getSessionUser } from '../session.js'
import { emotieKelionDominanta, parametriAvatar, actualizeazaEmotieKelion } from '../services/emotiiKelion.js'
import { getSalutDimineata, detecteazaTrezierea, marcheazaActivitate } from '../services/modulVis.js'
import { getJurnaleRecente, getJurnalPentruZi } from '../services/jurnalAuto.js'
import { analizeazaSanatate } from '../services/detectieSanatate.js'
import { getConfigMostenire, setConfigMostenire, stareMostenire } from '../services/mostenireDigitala.js'
import { getProfilPersonalitate, promptPersonalitate } from '../services/personalitateEvolutiva.js'

// ── RUTELE CELOR 10 „WAW" (owner, 22 aug 2026: „uimește-mă") ────────────────

export async function wawRoutes(fastify: FastifyInstance): Promise<void> {
  // #1 MODUL VIS — salut de dimineață
  fastify.get('/api/kelion/salut-dimineata', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    marcheazaActivitate()
    const trezit = detecteazaTrezierea()
    const salut = trezit ? getSalutDimineata() : null
    return reply.send({ trezit, salut })
  })

  // #3 EMOȚIILE LUI KELION — starea internă + parametri avatar
  fastify.get('/api/kelion/emotie', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    return reply.send(emotieKelionDominanta())
  })

  fastify.get('/api/kelion/avatar-parametri', async (_req, reply) => {
    return reply.send(parametriAvatar())
  })

  fastify.post('/api/kelion/emotie/trigger', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    const corp = (req.body ?? {}) as { trigger?: string }
    actualizeazaEmotieKelion(corp.trigger as 'user_suparat' | 'user_vesel' | 'user_intreaba' | 'eveniment_urgent' | 'inactivitate' | 'sarcina_reusita')
    return reply.send(emotieKelionDominanta())
  })

  // #4 JURNAL AUTOMAT
  fastify.get('/api/jurnal/recent', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    const jurnale = await getJurnaleRecente(user.email, 7)
    return reply.send({ jurnale })
  })

  fastify.get('/api/jurnal/:data', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    const { data } = req.params as { data: string }
    const jurnal = await getJurnalPentruZi(user.email, data)
    return reply.send({ jurnal })
  })

  // #5 DETECTARE BURNOUT/SĂNĂTATE
  fastify.get('/api/sanatate/analiza', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    const alerta = await analizeazaSanatate(user.email)
    return reply.send({ alerta })
  })

  // #9 MOȘTENIRE DIGITALĂ
  fastify.get('/api/mostenire/config', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    return reply.send(getConfigMostenire())
  })

  fastify.post('/api/mostenire/config', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    const corp = (req.body ?? {}) as Record<string, unknown>
    setConfigMostenire(corp)
    return reply.send({ ok: true })
  })

  fastify.get('/api/mostenire/stare', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    return reply.send(stareMostenire())
  })

  // #10 PERSONALITATE EVOLUTIVĂ
  fastify.get('/api/personalitate/profil', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    return reply.send(getProfilPersonalitate())
  })

  fastify.get('/api/personalitate/prompt', async (_req, reply) => {
    return reply.send({ prompt: promptPersonalitate() })
  })

  // #6 CLONARE VOCE — stocare + verificare sample
  fastify.get('/api/voce/sample', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    try {
      const { loadKv } = await import('../db.js')
      const raw = await loadKv(`voce_sample_${user.email}`)
      return reply.send({ are: !!raw })
    } catch {
      return reply.send({ are: false })
    }
  })

  fastify.post('/api/voce/sample', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    const corp = (req.body ?? {}) as { audioBase64?: string; textCitit?: string }
    if (!corp.audioBase64) return reply.code(400).send({ error: 'lipsa audio' })
    try {
      const { saveKv } = await import('../db.js')
      await saveKv(`voce_sample_${user.email}`, JSON.stringify({
        audio: corp.audioBase64.slice(0, 500000), // max 500KB — sample de 30s
        text: corp.textCitit ?? '',
        ts: Date.now(),
      }))
      return reply.send({ ok: true })
    } catch {
      return reply.code(500).send({ error: 'eroare_stocare' })
    }
  })
}
