import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = path.resolve(import.meta.dirname, '../..')
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8')

describe('Git credential boundary', () => {
  it('workerul Constructor nu poate primi credentiale sau publica', () => {
    const worker = read('deploy/codex-worker.mjs')
    const service = read('deploy/systemd/kelion-codex-worker.service')
    const workerConfig = read('deploy/codex-worker.env.example')

    expect(worker).toContain("GIT_ASKPASS: '/bin/false'")
    expect(worker).toContain("GIT_TERMINAL_PROMPT: '0'")
    expect(worker).not.toMatch(/GH_TOKEN|GITHUB_TOKEN|x-access-token:/)
    expect(service).not.toMatch(/GitHub|GH_TOKEN|GITHUB_TOKEN|SSH_AUTH_SOCK/)
    expect(workerConfig).toMatch(/^CODEX_WORKER_EXEC_ENABLED=0$/m)
    expect(service).toContain('ConditionPathExists=/etc/kelion/codex-worker.enabled')
  })

  it('poarta de rezervă folosește askpass temporar, fără token în URL', () => {
    const gate = read('deploy/porti-pr.sh')
    expect(gate).toContain('GIT_ASKPASS="$ASKPASS"')
    expect(gate).toContain('GIT_TERMINAL_PROMPT=0')
    expect(gate).toContain('https://github.com/$GITHUB_REPOSITORY.git')
    expect(gate).not.toContain('https://x-access-token:')
  })

  it('workflow-urile nu persistă credentialele checkout și publică doar artefacte', () => {
    for (const file of ['.github/workflows/build-images.yml', '.github/workflows/deploy.yml']) {
      expect(read(file)).toContain('persist-credentials: false')
    }
    const release = read('.github/workflows/deploy.yml')
    expect(release).toContain('environment: production')
    expect(release).toContain('CANDIDATE_SHA')
    expect(release).not.toMatch(/git push|git remote set-url/)
  })
})
