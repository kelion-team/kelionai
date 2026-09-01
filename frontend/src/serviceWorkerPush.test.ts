import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'

const aici = dirname(fileURLToPath(import.meta.url))

type Eveniment = {
  waitUntil: (promisiune: Promise<unknown>) => void
  data?: { json: () => unknown; text: () => string }
  notification?: { data?: { url?: unknown }; close: () => void }
}

function incarcaWorkerul() {
  const handlere = new Map<string, (eveniment: Eveniment) => void>()
  const showNotification = vi.fn(async () => undefined)
  const openWindow = vi.fn(async () => undefined)
  const navigate = vi.fn(async () => undefined)
  const focus = vi.fn(async () => undefined)
  const self = {
    location: { origin: 'https://kelion.test' },
    addEventListener: (tip: string, handler: (eveniment: Eveniment) => void) => handlere.set(tip, handler),
    registration: { showNotification },
    clients: {
      claim: vi.fn(async () => undefined),
      matchAll: vi.fn(async () => []),
      openWindow,
    },
    skipWaiting: vi.fn(async () => undefined),
  }
  const cod = readFileSync(resolve(aici, '../public/sw.js'), 'utf8')
  runInNewContext(cod, { self, URL, Request, Response, caches: {} })
  return { handlere, showNotification, openWindow, navigate, focus }
}

async function ruleaza(handler: (eveniment: Eveniment) => void, eveniment: Omit<Eveniment, 'waitUntil'>) {
  let asteptata: Promise<unknown> | undefined
  handler({ ...eveniment, waitUntil: (promisiune) => { asteptata = promisiune } })
  await asteptata
}

describe('service worker push navigation', () => {
  it.each([
    'https://evil.example/phishing',
    'javascript:alert(1)',
    '//evil.example/phishing',
  ])('reduce URL-ul extern sau activ la root atât la push, cât și la click: %s', async (url) => {
    const { handlere, showNotification, openWindow } = incarcaWorkerul()
    const push = handlere.get('push')
    const click = handlere.get('notificationclick')
    expect(push).toBeTypeOf('function')
    expect(click).toBeTypeOf('function')

    await ruleaza(push!, {
      data: { json: () => ({ titlu: 'Test', mesaj: 'Mesaj', url }), text: () => '' },
    })
    expect(showNotification).toHaveBeenCalledWith('Test', expect.objectContaining({ data: { url: '/' } }))

    await ruleaza(click!, { notification: { data: { url }, close: vi.fn() } })
    expect(openWindow).toHaveBeenCalledWith('/')
  })

  it('păstrează numai calea, query-ul și fragmentul unei destinații same-origin', async () => {
    const { handlere, showNotification, openWindow } = incarcaWorkerul()
    await ruleaza(handlere.get('push')!, {
      data: {
        json: () => ({ titlu: 'Test', url: 'https://kelion.test/manual?cap=voce#permisiuni' }),
        text: () => '',
      },
    })
    expect(showNotification).toHaveBeenCalledWith('Test', expect.objectContaining({
      data: { url: '/manual?cap=voce#permisiuni' },
    }))

    await ruleaza(handlere.get('notificationclick')!, {
      notification: { data: { url: '/manual?cap=voce#permisiuni' }, close: vi.fn() },
    })
    expect(openWindow).toHaveBeenCalledWith('/manual?cap=voce#permisiuni')
  })
})
