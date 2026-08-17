import type { FastifyInstance } from 'fastify'

export async function constructorStareRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/constructor/stare', async (_req, reply) => {
    const key = process.env.CONSTRUCTOR_DEEPSEEK_KEY
    const url = process.env.CONSTRUCTOR_DEEPSEEK_URL
    const model = process.env.CONSTRUCTOR_DEEPSEEK_MODEL ?? null

    return reply.send({
      configurat: !!(key && url),
      model,
      ora: new Date().toISOString(),
    })
  })
}
