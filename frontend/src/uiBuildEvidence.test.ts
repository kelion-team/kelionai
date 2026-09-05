import { afterEach, describe, expect, it, vi } from 'vitest'
afterEach(() => { vi.unstubAllEnvs();vi.resetModules() })

async function buildConfig(commit: string | undefined) {
  vi.stubEnv('GIT_COMMIT_SHA',commit)
  vi.resetModules()
  return (await import('../vite.config')).default
}

describe('UI build evidence comes from the verified release input, not runtime polling or a guessed git ref', () => {
  it('embeds the same exact full SHA into compiled constants and the independently inspectable artifact', async () => {
    const sha = 'a'.repeat(40)
    const config = await buildConfig(sha)
    expect(config.define?.__BUILD_COMMIT__).toBe(JSON.stringify(sha))
    const plugin = config.plugins?.flat().find((item) => item && typeof item === 'object' && 'name' in item && item.name === 'kelion-ui-build-evidence')
    const emitFile = vi.fn()
    const generate = (plugin as unknown as { generateBundle:(this:{ emitFile:typeof emitFile }) => void }).generateBundle
    generate.call({ emitFile })
    expect(emitFile).toHaveBeenCalledExactlyOnceWith({ type:'asset',fileName:'ui-build.json',source:JSON.stringify({ schema:1,commit:sha }) })
  })
  it('local build without a release SHA is explicitly unknown', async () => {
    expect((await buildConfig(undefined)).define?.__BUILD_COMMIT__).toBe('null')
  })
  it('rejects nonempty short, malformed or uppercase release identifiers', async () => {
    for (const commit of ['abcdef0','latest','A'.repeat(40),'a'.repeat(39),'a'.repeat(41)]) {
      await expect(buildConfig(commit)).rejects.toThrow('GIT_COMMIT_SHA: expected exact lowercase full release SHA')
    }
  })
})
