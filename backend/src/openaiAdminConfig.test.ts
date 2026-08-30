import { afterEach, describe, expect, it } from 'vitest'
import { configSecretGuardsForTest } from './config.js'

const tracked = [
  'NODE_ENV',
  'OPENAI_API_KEY',
  'OPENAI_API_KEY_FILE',
  'OPENAI_ADMIN_KEY',
  'OPENAI_ADMIN_KEY_FILE',
] as const
const original = new Map(tracked.map((name) => [name, process.env[name]]))

afterEach(() => {
  for (const name of tracked) {
    const value = original.get(name)
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
})

describe('OpenAI credential family guards in config', () => {
  it('reciprocally refuses an Admin key in the inference slot and a project key in the Admin slot', () => {
    process.env.NODE_ENV = 'test'
    process.env.OPENAI_API_KEY = ['sk', 'admin', 'fixture-only-1234567890'].join('-')
    process.env.OPENAI_ADMIN_KEY = ['sk', 'proj', 'fixture-only-1234567890'].join('-')
    delete process.env.OPENAI_API_KEY_FILE
    delete process.env.OPENAI_ADMIN_KEY_FILE

    expect(configSecretGuardsForTest.hasRuntimeProjectKey()).toBe(false)
    expect(configSecretGuardsForTest.hasRuntimeAdminKey()).toBe(false)
  })

  it('in production refuses a direct project env value and requires the file transport', () => {
    process.env.NODE_ENV = 'production'
    process.env.OPENAI_API_KEY = ['sk', 'proj', 'fixture-only-1234567890'].join('-')
    delete process.env.OPENAI_API_KEY_FILE

    expect(() => configSecretGuardsForTest.hasRuntimeProjectKey())
      .toThrow(/OPENAI_API_KEY trebuie montat exclusiv prin OPENAI_API_KEY_FILE/)
  })

  it('in production refuses a direct Admin env value and requires the file transport', () => {
    process.env.NODE_ENV = 'production'
    process.env.OPENAI_ADMIN_KEY = ['sk', 'admin', 'fixture-only-1234567890'].join('-')
    delete process.env.OPENAI_ADMIN_KEY_FILE

    expect(() => configSecretGuardsForTest.hasRuntimeAdminKey())
      .toThrow(/OPENAI_ADMIN_KEY trebuie montat exclusiv prin OPENAI_ADMIN_KEY_FILE/)
  })
})
