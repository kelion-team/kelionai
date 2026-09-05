import { useEffect, useState } from 'react'
import { loadedUiCommit, versionLabel } from '../lib/updateCheck'
import { fetchReleaseVersions, releaseComparisonLabel, runtimeVersionLabel, type ReleaseVersionEvidence } from '../lib/versionEvidence'
import { ceas } from '../lib/ceas'

const VERSION_READ_MS = 45_000 // hardcod-permis: ritmul citirii read-only, nu ora buildului sau a deploy-ului.
const VERSION_TIMEOUT_MS = 6_000 // hardcod-permis: limită de transport; nu inventează un rezultat la timeout.

export function VersionBadge({ online }: { online: boolean }) {
  const [evidence, setEvidence] = useState<ReleaseVersionEvidence | null>(null)
  useEffect(() => {
    if (!online) return
    let stopped = false
    let controller: AbortController | null = null
    const read = async (): Promise<void> => {
      if (controller) return
      controller = new AbortController()
      const timeout = window.setTimeout(() => controller?.abort(), VERSION_TIMEOUT_MS)
      try {
        const next = await fetchReleaseVersions(loadedUiCommit(),controller.signal)
        if (!stopped) setEvidence(next)
      } finally {
        window.clearTimeout(timeout)
        controller = null
      }
    }
    void read()
    const timer = ceas('versiune server', () => void read(), VERSION_READ_MS)
    return () => { stopped = true; controller?.abort(); window.clearInterval(timer) }
  }, [online])

  const current = online ? evidence : null
  return <div className="app-watermark" aria-label="Versiune și ore Europe/London"
    data-version-state={current?.state ?? 'unverified'} data-ui-commit={loadedUiCommit() ?? 'unknown'}
    data-runtime-commit={current?.runtime?.commit ?? 'unknown'} data-live-commit={current?.liveCommit ?? 'unknown'}>
    <div>{versionLabel()}</div>
    <div>{runtimeVersionLabel(current?.runtime ?? null)}</div>
    <div title={`UI ${loadedUiCommit() ?? 'unknown'} / live ${current?.liveCommit ?? 'unknown'}`}>{releaseComparisonLabel(current)}</div>
  </div>
}
