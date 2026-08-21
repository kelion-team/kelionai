import { FastifyInstance } from 'fastify'

export async function constructorViuRoutes(app: FastifyInstance): Promise<void> {
  // Lightweight probe: reports whether the DeepSeek constructor keys are
  // configured and which model is in use — useful for ops checks.
  app.get('/api/constructor/viu', async () => ({
    configurat: !!(process.env.CONSTRUCTOR_DEEPSEEK_KEY && process.env.CONSTRUCTOR_DEEPSEEK_URL),
    model: process.env.CONSTRUCTOR_DEEPSEEK_MODEL ?? null,
    ora: new Date().toISOString(),
  }))
}
