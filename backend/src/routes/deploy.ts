import type { FastifyInstance, FastifyPluginOptions, FastifyReply, FastifyRequest } from 'fastify'
import { listBuildJobs, type BuildJob } from '../db.js'
import { cerAdmin } from '../session.js'

export interface DeployState {
  status: 'idle' | 'running' | 'success' | 'failed'
  jobId: string | null
  step: string
  stepIndex: number
  totalSteps: number
  percent: number
  message: string
  startedAt: string | null
  updatedAt: string
  error: string | null
  commit: string | null
  liveVersion: string | null
}

const STAGES = ['queued', 'claimed', 'accepted', 'working', 'gates_passed', 'pr_opened', 'merged', 'deployed'] as const

function latestRelevant(jobs: BuildJob[]): BuildJob | null {
  return jobs.find((job) => job.status === 'running' || job.status === 'queued') ?? jobs[0] ?? null
}

function deployState(job: BuildJob | null): DeployState {
  if (!job) {
    return {
      status: 'idle', jobId: null, step: '', stepIndex: 0, totalSteps: STAGES.length,
      percent: 0, message: 'Niciun deploy în curs', startedAt: null,
      updatedAt: new Date(0).toISOString(), error: null, commit: null, liveVersion: null,
    }
  }
  const stage = STAGES.includes(job.constructorStage as typeof STAGES[number])
    ? job.constructorStage as typeof STAGES[number]
    : job.status === 'queued' ? 'queued' : 'working'
  const stageIndex = STAGES.indexOf(stage)
  const completed = job.status === 'done' && stage === 'deployed' && Boolean(job.commit && job.liveVersion)
  const failed = job.status === 'failed' || job.status === 'cancelled'
  return {
    status: completed ? 'success' : failed ? 'failed' : 'running',
    jobId: String(job.id),
    step: stage,
    stepIndex: stageIndex + 1,
    totalSteps: STAGES.length,
    percent: completed ? 100 : Math.max(0, Math.round((stageIndex / (STAGES.length - 1)) * 100)),
    message: String(job.progress || stage).slice(0, 500),
    startedAt: job.createdAt,
    updatedAt: job.updatedAt,
    error: failed ? 'Constructorul a raportat eșecul; detaliile sunt în jurnalul jobului autorizat.' : null,
    commit: job.commit,
    liveVersion: job.liveVersion,
  }
}

async function readDeployState(reply: FastifyReply): Promise<DeployState | null> {
  const jobs = await listBuildJobs(20)
  if (!jobs) {
    reply.code(503).send({ ok: false, error: 'deploy_state_unavailable' })
    return null
  }
  return deployState(latestRelevant(jobs))
}

export async function deployRoutes(fastify: FastifyInstance, _opts: FastifyPluginOptions): Promise<void> {
  // Read-only projection of the durable, signed Constructor job. The web app
  // has no endpoint that can paint a deployment state independently.
  fastify.get('/api/deploy/progress', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!cerAdmin(req, reply)) return
    const state = await readDeployState(reply)
    if (!state) return
    return reply.send({ ok: true, state })
  })

  fastify.get('/api/deploy/status', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!cerAdmin(req, reply)) return
    const initial = await readDeployState(reply)
    if (!initial) return
    reply.raw.setHeader('Content-Type', 'text/event-stream')
    reply.raw.setHeader('Cache-Control', 'no-store')
    reply.raw.setHeader('Connection', 'keep-alive')
    reply.raw.flushHeaders?.()

    let closed = false
    let busy = false
    const send = async (): Promise<void> => {
      if (closed || busy) return
      busy = true
      try {
        const jobs = await listBuildJobs(20)
        const payload = jobs
          ? { ok: true, state: deployState(latestRelevant(jobs)) }
          : { ok: false, error: 'deploy_state_unavailable' }
        reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`)
      } finally {
        busy = false
      }
    }
    reply.raw.write(`data: ${JSON.stringify({ ok: true, state: initial })}\n\n`)
    const interval = setInterval(() => { void send() }, 2_000)
    req.raw.on('close', () => {
      closed = true
      clearInterval(interval)
    })
  })
}

export default deployRoutes
