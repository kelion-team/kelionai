import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { FastifyRequest } from 'fastify'
import { config } from './config.js'
import { clientIp } from './routes/demo.js'

const req = (headers: Record<string, string>, ip = '203.0.113.10'): FastifyRequest =>
  ({ headers, ip }) as unknown as FastifyRequest

describe('identitatea de rețea vine numai din proxy-ul de încredere', () => {
  it('ignoră antetele publice care pot fi fabricate de client', () => {
    expect(clientIp(req({
      'cf-connecting-ip': '1.1.1.1',
      'true-client-ip': '2.2.2.2',
      'x-forwarded-for': '3.3.3.3',
    }))).toBe('203.0.113.10')
  })

  it('folosește antetul intern suprascris de Caddy', () => {
    expect(clientIp(req({ 'x-kelion-client-ip': '198.51.100.7' }))).toBe('198.51.100.7')
  })

  it('producția ascultă implicit numai pe loopback', () => {
    const source = readFileSync(fileURLToPath(new URL('./config.ts', import.meta.url)), 'utf8')
    expect(source).toContain("isProd ? '127.0.0.1' : '0.0.0.0'")
    expect(config.bindHost).toBeTruthy()
  })
})
