import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { ROSTER, gasesteAgent, carteAgent, cheamaAgent } from '../services/agentiKelion.js'

// ── ENDPOINTUL AGENȚILOR A2A ────────────────────────────────────────────────
//
// Aici trăiesc, viu, cei 33 de agenți ai lui Kelion (services/agentiKelion.ts).
// Cărțile A2A arătau deja spre /api/a2a/<id> — până acum 404. Acum răspund:
// fiecare e creierul Gemini al lui Kelion purtând pălăria unui specialist.
//
// Acceptă DOUĂ forme pe POST, ca să meargă și cu clienții standard, și la un
// curl de probă:
//   • A2A JSON-RPC 2.0 (method „message/send") — ce trimit Gemini Enterprise și
//     orice client A2A.
//   • { "text": "..." } simplu — pentru verificarea live cu un curl scurt și
//     pentru apelurile interne ale lui Kelion.
//
// Notă de cost: endpointul e public (cărțile A2A sunt publice, nu pot purta un
// secret), deci consumă din creditul Gemini al ownerului. Traficul e mic (doar
// agenții lui), rate-limit-ul global e activ (index.ts), iar ieșirea e plafonată
// (maxTokens în agentiKelion.ts). E un compromis declarat, nu o scăpare.

function mesajId(): string {
  return `m_${Math.random().toString(36).slice(2, 10)}`
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
  app.get('/api/a2a', async () => ({
    count: ROSTER.length,
    agents: ROSTER.map((a) => ({ id: a.id, nume: a.nume, rol: a.rol, url: `/api/a2a/${a.id}` })),
  }))

  // Cartea de descoperire A2A — și pe calea simplă, și pe calea .well-known.
  const cartea = async (req: FastifyRequest, reply: FastifyReply) => {
    const a = gasesteAgent((req.params as { id: string }).id)
    if (!a) {
      reply.code(404)
      return { error: 'agent necunoscut' }
    }
    return carteAgent(a)
  }
  app.get('/api/a2a/:id', cartea)
  app.get('/api/a2a/:id/.well-known/agent-card.json', cartea)

  // Endpointul care LUCREAZĂ.
  app.post('/api/a2a/:id', async (req, reply) => {
    const a = gasesteAgent((req.params as { id: string }).id)
    const body = (req.body ?? {}) as Record<string, unknown>
    const esteRpc = body.jsonrpc === '2.0' && typeof body.method === 'string'

    if (!a) {
      if (esteRpc) return rpcEroare(body.id, -32601, 'agent necunoscut')
      reply.code(404)
      return { error: 'agent necunoscut' }
    }

    const sarcina = extrageText(body)
    if (!sarcina.trim()) {
      if (esteRpc) return rpcEroare(body.id, -32602, 'lipseste textul mesajului')
      reply.code(400)
      return { error: 'lipseste textul (trimite {"text":"..."})' }
    }

    let r
    try {
      r = await cheamaAgent(a, sarcina)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (esteRpc) return rpcEroare(body.id, -32000, msg)
      reply.code(502)
      return { error: 'creierul nu a raspuns', detaliu: msg }
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
