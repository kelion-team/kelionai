// Keep the screen awake while a map/route is on the monitor, so the browser
// never throttles the tab mid-navigation (the reason background nav "stops").
// Re-acquires automatically when the tab becomes visible again (the OS drops the
// lock when the tab is hidden).

interface WakeSentinel {
  release(): Promise<void>
  addEventListener?(type: 'release', cb: () => void): void
}

let sentinel: WakeSentinel | null = null
let want = false

async function acquire(): Promise<void> {
  const wl = (navigator as unknown as { wakeLock?: { request(t: string): Promise<WakeSentinel> } }).wakeLock
  if (!wl || sentinel) return
  try {
    sentinel = await wl.request('screen')
    sentinel.addEventListener?.('release', () => {
      sentinel = null
    })
  } catch {
    /* not supported / denied */
  }
}

export function keepScreenOn(on: boolean): void {
  want = on
  if (on) void acquire()
  else {
    void sentinel?.release()
    sentinel = null
  }
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (want && document.visibilityState === 'visible') void acquire()
  })
}
