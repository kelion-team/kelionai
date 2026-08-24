import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { randomUUID } from 'node:crypto'
import { rosterViu, gasesteAgentViu, carteAgent, cheamaAgent } from '../services/agentiKelion.js'
import { getSessionUser } from '../session.js'
import { debitWalletMinorAtomar, grantCreditMinor, recordCost } from '../db.js'
import { config } from '../config.js'
import { esteAdminKelion } from '../services/adminIdentity.js'

// ── ENDPOINTUL AGENȚILOR A2A ────────────────────────────────────────────────
//
// Aici trăiesc, viu, cei 33 de agenți ai lui Kelion (services/agentiKelion.ts).
// Cărțile A2A arătau deja spre /api/a2a/<id> — până acum 404. Acum răspund:
// fiecare este creierul OpenAI al lui Kelion purtând pălăria unui specialist.
//
// Acceptă DOUĂ forme pe POST, ca să meargă și cu clienții standard, și la un
// curl de probă:
//   • A2A JSON-RPC 2.0 (method „message/send") — ce trimit clienții A2A și
//     orice client A2A.
//   • { "text": "..." } simplu — pentru verificarea live cu un curl scurt și
//     pentru apelurile interne ale lui Kelion.
//
// Doar cărțile sunt publice. Execuția cere sesiune și trece prin billing.

const MAX_TEXT = 8_000 // hardcod-permis: plafon tehnic anti-abuz pentru o sarcină A2A

function mesajId(): string {
  return `m_${randomUUID()}`
}

function rpcEroare(id: unknown, code: number, message: string): Record<string, unknown> {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } }
}

/** Scoate textul sarcinii din oricare formă acceptată. Exportat pentru teste. */
export function extrageText(body: Record<string, unknown>): string {
  const direct = body.text ?? body.sarcina ?? body.prompt
  if (typeof direct === 'string') return direct
  const params = body.params as { message?: { parts?: unknown[] } } | undefined
  const parts = params?.message?.parts
  if (Array.isArray(parts)) {
    return parts
      .map((p) => {
        const pp = p as { text?: string }
        return typeof pp.text === 'string' ? pp.text : ''
      })
      .join(' ')
      .trim()
  }
  return ''
}

export async function a2aRoutes(app: FastifyInstance): Promise<void> {
  // Registrul: dovada că agenții există și sunt accesibili (verificare live).
  // Rosterul VIU = codul + agenții puși de owner din admin (4 aug).
  app.get('/api/a2a', async () => {
    const roster = await rosterViu()
    return {
      count: roster.length,
      agents: roster.map((a) => ({ id: a.id, nume: a.nume, rol: a.rol, url: `/api/a2a/${a.id}` })),
    }
  })

  // Cartea de descoperire A2A — și pe calea simplă, și pe calea .well-known.
  const cartea = async (req: FastifyRequest, reply: FastifyReply) => {
    const a = await gasesteAgentViu((req.params as { id: string }).id)
    if (!a) {
      reply.code(404)
      return { error: 'agent necunoscut' }
    }
    return carteAgent(a)
  }
  app.get('/api/a2a/:id', cartea)
  app.get('/api/a2a/:id/.well-known/agent-card.json', cartea)

  // Endpointul care LUCREAZĂ.
  app.post('/api/a2a/:id', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req, reply) => {
    const user = getSessionUser(req)
    const a = await gasesteAgentViu((req.params as { id: string }).id)
    const body = (req.body ?? {}) as Record<string, unknown>
    const esteRpc = body.jsonrpc === '2.0' && typeof body.method === 'string'

    if (!user) {
      if (esteRpc) return rpcEroare(body.id, -32001, 'autentificare necesară')
      return reply.code(401).send({ error: 'unauthorized' })
    }
    if (esteRpc && body.method !== 'message/send') return rpcEroare(body.id, -32601, 'metodă nesuportată')

    if (!a) {
      if (esteRpc) return rpcEroare(body.id, -32601, 'agent necunoscut')
      reply.code(404)
      return { error: 'agent necunoscut' }
    }

    // Agenții „doar admin" (Adrian, 4 aug: „roboti de tranzactionare DOAR
    // admin"): endpointul e public pentru restul rosterului, dar aceștia refuză
    // orice apel fără sesiunea ownerului — cartea se vede, munca nu.
    if (a.doarAdmin) {
      if (!esteAdminKelion(user.email)) {
        // 401 pe sesiune moartă, 403 DOAR pe rol (regula din 9 aug) — și
        // mesajul spune cauza REALĂ, nu „nu ești owner" pe un cookie expirat.
        const motiv = 'doar ownerul poate chema acest agent'
        if (esteRpc) return rpcEroare(body.id, -32003, motiv)
        reply.code(403)
        return { error: motiv }
      }
    }

    const sarcina = extrageText(body).trim()
    if (!sarcina) {
      if (esteRpc) return rpcEroare(body.id, -32602, 'lipseste textul mesajului')
      reply.code(400)
      return { error: 'lipseste textul (trimite {"text":"..."})' }
    }
    if (sarcina.length > MAX_TEXT) {
      if (esteRpc) return rpcEroare(body.id, -32602, 'text prea lung')
      return reply.code(413).send({ error: 'text_prea_lung', max: MAX_TEXT })
    }

    const adminExempt = esteAdminKelion(user.email)
    const clientEvent = String(body.id ?? req.headers['idempotency-key'] ?? '').trim()
    if (!adminExempt && (!clientEvent || clientEvent.length > 100 || !/^[A-Za-z0-9._:-]+$/.test(clientEvent))) {
      return reply.code(400).send({ error: 'idempotency_key_required' })
    }
    const debitRef = `a2a:${a.id}:${clientEvent}`
    if (!adminExempt) {
      const debit = await debitWalletMinorAtomar(user.email, config.billing.chatTurnMinor, debitRef, `a2a:${a.id}`)
      if (!debit.ok) return reply.code(debit.code === 'insufficient' ? 402 : 503).send({ error: debit.code })
      if (debit.duplicate) return reply.code(409).send({ error: 'request_already_exists', idempotencyKey: clientEvent })
    }

    let r
    try {
      // Blindat (4 aug): sesiunea ownerului aprinde și memoria lui Kelion;
      // un apel public primește specialistul cu căutare + citit pagini.
      r = await cheamaAgent(a, sarcina, esteAdminKelion(user.email), user.email)
    } catch (e) {
      if (!adminExempt) await grantCreditMinor(user.email, config.billing.chatTurnMinor, `${debitRef}:refund`)
      const msg = e instanceof Error ? e.message : String(e)
      if (esteRpc) return rpcEroare(body.id, -32000, 'creierul nu a răspuns')
      reply.code(502)
      req.log.warn({ err: msg.slice(0, 200) }, 'A2A agent failure')
      return { error: 'creierul nu a raspuns' }
    }

    if (typeof r.costUsd === 'number' && r.costUsd > 0) {
      void recordCost(user.email, 'openai', r.costUsd)
    }

    if (esteRpc) {
      return {
        jsonrpc: '2.0',
        id: body.id ?? null,
        result: {
          kind: 'message',
          role: 'agent',
          messageId: mesajId(),
          parts: [{ kind: 'text', text: r.text }],
        },
      }
    }
    return { agent: r.agent, model: r.model, text: r.text }
  })
}
