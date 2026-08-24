import { apiFetch } from './transport'

// Abonarea acestui browser/telefon la notificările push (Web Push, VAPID).
// Serverul ține cheile și abonările (/api/push/*); aici e doar dansul standard:
// permisiune → pushManager.subscribe(cheia publică) → trimite abonarea sus.
export type StarePush = 'nesuportat' | 'refuzat' | 'activ' | 'inactiv'

// Cheia VAPID vine base64url; browserul o vrea octeți (BufferSource). Alocarea
// explicită pe ArrayBuffer e cerută de TS-ul strict: Uint8Array.from() ar putea
// (teoretic) purta un SharedArrayBuffer, pe care subscribe() nu-l acceptă.
const b64laBiti = (b64: string): Uint8Array<ArrayBuffer> => {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4)
  const brut = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'))
  const biti = new Uint8Array(new ArrayBuffer(brut.length))
  for (let i = 0; i < brut.length; i++) biti[i] = brut.charCodeAt(i)
  return biti
}

const suportat = (): boolean =>
  'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

/** Starea REALĂ, măsurată din browser — nu una ținută minte. */
export async function starePush(): Promise<StarePush> {
  if (!suportat()) return 'nesuportat'
  if (Notification.permission === 'denied') return 'refuzat'
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = await reg?.pushManager.getSubscription()
  return sub ? 'activ' : 'inactiv'
}

/** Cere permisiunea, se abonează și înregistrează abonarea pe server.
 *  Întoarce starea în care chiar am ajuns — dacă serverul refuză, abonarea
 *  locală se retrage (o abonare pe care serverul n-o știe n-ar primi nimic). */
export async function activeazaPush(): Promise<StarePush> {
  if (!suportat()) return 'nesuportat'
  const permisiune = await Notification.requestPermission()
  if (permisiune !== 'granted') return 'refuzat'
  const reg = await navigator.serviceWorker.ready
  const r = await apiFetch('/api/push/cheie', { credentials: 'include' }).catch(() => null)
  if (!r?.ok) return 'inactiv'
  const { cheie } = (await r.json()) as { cheie: string }
  const sub = await reg.pushManager
    .subscribe({ userVisibleOnly: true, applicationServerKey: b64laBiti(cheie) })
    .catch(() => null)
  if (!sub) return 'inactiv'
  const sus = await apiFetch('/api/push/aboneaza', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ abonare: sub.toJSON() }),
  }).catch(() => null)
  if (!sus?.ok) {
    await sub.unsubscribe().catch(() => false)
    return 'inactiv'
  }
  return 'activ'
}

/** Retrage abonarea din browser și de pe server. */
export async function dezactiveazaPush(): Promise<StarePush> {
  if (!suportat()) return 'nesuportat'
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = await reg?.pushManager.getSubscription()
  if (!sub) return 'inactiv'
  const endpoint = sub.endpoint
  await sub.unsubscribe().catch(() => false)
  await apiFetch('/api/push/dezaboneaza', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ endpoint }),
  }).catch(() => null)
  return 'inactiv'
}
