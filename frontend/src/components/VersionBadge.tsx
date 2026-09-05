import { useEffect, useState } from 'react'
import { versionLabel } from '../lib/updateCheck'
import { fetchRuntimeVersion, runtimeVersionLabel, type RuntimeVersionEvidence } from '../lib/versionEvidence'
import { ceas } from '../lib/ceas'

const VERSION_READ_MS = 45_000 // hardcod-permis: ritmul citirii read-only, nu ora buildului sau a deploy-ului.
const VERSION_TIMEOUT_MS = 6_000 // hardcod-permis: limită de transport; nu inventează un rezultat la timeout.

export function VersionBadge({ online }: { online: boolean }) {
  const [runtime, setRuntime] = useState<RuntimeVersionEvidence | null>(null)
  useEffect(() => {
    if (!online) return
    let stopped = false
    let controller: AbortController | null = null
    const read = async (): Promise<void> => {
      if (controller) return
      controller = new AbortController()
      const timeout = window.setTimeout(() => controller?.abort(), VERSION_TIMEOUT_MS)
      try {
        const next = await fetchRuntimeVersion(controller.signal)
        if (!stopped) setRuntime(next)
      } finally {
        window.clearTimeout(timeout)
        controller = null
      }
    }
    void read()
    const timer = ceas('versiune server', () => void read(), VERSION_READ_MS)
    return () => { stopped = true; controller?.abort(); window.clearInterval(timer) }
  }, [online])

  return <div className="app-watermark" aria-label="Versiune și ore Europe/London">
    <div>{versionLabel()}</div>
    <div>{runtimeVersionLabel(online ? runtime : null)}</div>
  </div>
}
