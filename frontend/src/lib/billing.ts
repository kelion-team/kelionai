import { apiFetch } from './transport'

declare const __CHECKOUT_ORIGINS__: readonly string[]

// Rata este necunoscută până la răspunsul valid al sursei vii `/api/tarife`.
// Nicio cifră monetară nu este inventată în browser dacă sursa nu poate fi citită.
let _creditePeLira: number | null = null
export function getCreditePeLira(): number | null {
  return _creditePeLira
}
export function setCreditePeLira(v: number): void {
  if (Number.isFinite(v) && v > 0) _creditePeLira = v
}
export const creditsForPounds = (pounds: number, rate = _creditePeLira): number | null =>
  rate !== null && Number.isFinite(rate) && rate > 0 ? Math.floor(pounds * rate) : null

/** Pachetele de alimentare derivate din pragurile serverului (nu hardcodate). */
export function pacheteDinPraguri(praguri: { minim: number; pas: number; primaAlimentare: number }): number[] {
  const { pas, minim, primaAlimentare } = praguri
  if (
    !Number.isFinite(pas) || pas <= 0 ||
    !Number.isFinite(minim) || minim <= 0 ||
    !Number.isFinite(primaAlimentare) || primaAlimentare < minim
  ) return []
  return [pas * 1, pas * 2, pas * 4, pas * 10]
}

export interface LowCreditReminderConfig {
  enabled: boolean
  thresholdMinor: number
  suggestedTopupMinor: number
  currency: string
  minorUnit: number
}

function parseLowCreditReminder(raw: unknown): LowCreditReminderConfig | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Record<string, unknown>
  const thresholdMinor = Number(value.thresholdMinor)
  const suggestedTopupMinor = Number(value.suggestedTopupMinor)
  const minorUnit = Number(value.minorUnit)
  const currency = typeof value.currency === 'string' ? value.currency.trim().toUpperCase() : ''
  if (
    typeof value.enabled !== 'boolean' ||
    !Number.isSafeInteger(thresholdMinor) || thresholdMinor < 0 ||
    !Number.isSafeInteger(suggestedTopupMinor) || suggestedTopupMinor < 0 ||
    !Number.isInteger(minorUnit) || minorUnit < 0 || minorUnit > 6 ||
    !/^[A-Z]{3}$/.test(currency)
  ) return null
  return { enabled: value.enabled, thresholdMinor, suggestedTopupMinor, currency, minorUnit }
}

export async function fetchLowCreditReminder(): Promise<LowCreditReminderConfig | null> {
  try {
    const response = await apiFetch('/api/billing/low-credit-reminder')
    if (!response.ok) return null
    return parseLowCreditReminder(await response.json())
  } catch {
    return null
  }
}

export async function saveLowCreditReminder(
  config: LowCreditReminderConfig,
): Promise<LowCreditReminderConfig | null> {
  try {
    const response = await apiFetch('/api/billing/low-credit-reminder', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        enabled: config.enabled,
        thresholdMinor: config.thresholdMinor,
        suggestedTopupMinor: config.suggestedTopupMinor,
      }),
    })
    if (!response.ok) return null
    return parseLowCreditReminder(await response.json())
  } catch {
    return null
  }
}

export function majorToMinor(amount: number, minorUnit: number): number | null {
  if (!Number.isFinite(amount) || amount < 0 || !Number.isInteger(minorUnit) || minorUnit < 0 || minorUnit > 6) return null
  const minor = Math.round(amount * 10 ** minorUnit)
  return Number.isSafeInteger(minor) ? minor : null
}

export function minorToMajor(amountMinor: number, minorUnit: number): number | null {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0 || !Number.isInteger(minorUnit) || minorUnit < 0 || minorUnit > 6) return null
  return amountMinor / 10 ** minorUnit
}

export function formatMinorMoney(
  amountMinor: number,
  currency: string,
  minorUnit: number,
  locale = 'en-GB',
): string | null {
  const amount = minorToMajor(amountMinor, minorUnit)
  if (amount === null || !/^[A-Z]{3}$/.test(currency)) return null
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amount)
  } catch {
    return null
  }
}

// Client helpers for the credit system. The USER sees CREDITS (+ the % of their
// last top-up still left, for the low-credit alerts). The ADMIN sees real money
// (the provider pool) via the admin endpoints.

export interface WalletStatus {
  credits: number
  percent: number
  currency: string
  // True if the user has never topped up: first top-up = £20 minimum
  // (brain activation), then any multiple of £5.
  firstTopUp?: boolean
  // Owner/admin: scutit de taxare — sold negativ = istoric, NU paywall.
  scutit?: boolean
  // Debit efectiv pentru această suprafață, măsurat și serializat de server.
  // UI-ul nu presupune nici măcar zero pentru contul scutit.
  debitMinor?: number
  // Numărul de credite consumate, calculat de ledgerul serverului.
  creditsUsed?: number
  minorUnit?: number
  // A payment PROMPT, never an automatic debit: present only when the user's
  // low-credit reminder is enabled and its threshold is reached. Money moves
  // only after the user explicitly confirms on Revolut.
  lowCreditPaymentPrompt?: Omit<LowCreditReminderConfig, 'enabled'> | null
}

function parseWalletStatus(raw: unknown): WalletStatus | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Record<string, unknown>
  const credits = value.credits
  const percent = value.percent
  const currency = typeof value.currency === 'string'
    ? value.currency.trim().toUpperCase()
    : ''
  const firstTopUp = value.firstTopUp
  const scutit = value.scutit
  const debitMinor = value.debitMinor
  const creditsUsed = value.creditsUsed
  const minorUnit = value.minorUnit

  if (
    !Number.isSafeInteger(credits) || (credits as number) < 0 ||
    typeof percent !== 'number' || !Number.isFinite(percent) || percent < 0 || percent > 100 ||
    !/^[A-Z]{3}$/.test(currency) ||
    typeof firstTopUp !== 'boolean' ||
    typeof scutit !== 'boolean' ||
    !Number.isSafeInteger(debitMinor) || (debitMinor as number) < 0 ||
    !Number.isSafeInteger(creditsUsed) || (creditsUsed as number) < 0 ||
    !Number.isInteger(minorUnit) || (minorUnit as number) < 0 || (minorUnit as number) > 6
  ) return null

  const promptRaw = value.lowCreditPaymentPrompt
  let lowCreditPaymentPrompt: WalletStatus['lowCreditPaymentPrompt'] = null
  if (promptRaw !== null) {
    const parsed = parseLowCreditReminder({
      ...(promptRaw && typeof promptRaw === 'object' ? promptRaw : {}),
      enabled: true,
    })
    if (!parsed) return null
    lowCreditPaymentPrompt = {
      thresholdMinor: parsed.thresholdMinor,
      suggestedTopupMinor: parsed.suggestedTopupMinor,
      currency: parsed.currency,
      minorUnit: parsed.minorUnit,
    }
  }

  if (
    scutit &&
    (debitMinor !== 0 || creditsUsed !== 0 || lowCreditPaymentPrompt !== null)
  ) return null

  return {
    credits: credits as number,
    percent,
    currency,
    firstTopUp,
    scutit,
    debitMinor: debitMinor as number,
    creditsUsed: creditsUsed as number,
    minorUnit: minorUnit as number,
    lowCreditPaymentPrompt,
  }
}

export async function fetchBalance(): Promise<WalletStatus | null> {
  try {
    const r = await apiFetch('/api/billing/balance')
    if (!r.ok) return null
    return parseWalletStatus(await r.json())
  } catch {
    return null
  }
}

const CHECKOUT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function safeHostedCheckoutUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 2_048) return null
  try {
    const url = new URL(raw)
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port ||
      url.hash ||
      !__CHECKOUT_ORIGINS__.includes(url.origin) ||
      !url.pathname.startsWith('/payment-link/')
    ) return null
    return url.href
  } catch {
    return null
  }
}

/** A fresh browser-generated key represents one explicit click to buy. */
export function newCheckoutIdempotencyKey(): string | null {
  const key = globalThis.crypto?.randomUUID?.()
  return typeof key === 'string' && CHECKOUT_UUID.test(key) ? key : null
}

// The server returns a provider-hosted order only after the durable local
// claim and provider reconciliation have both succeeded.
export interface CheckoutStart {
  url: string
  checkoutId: string
  amountMinor: number
  currency: string
  minorUnit: number
  status: 'pending' | 'paid'
}
export async function startCheckout(
  amountMinor: number,
  idempotencyKey: string,
): Promise<{ ok: true; pay: CheckoutStart } | { ok: false; error: string }> {
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
    return { ok: false, error: 'bad_amount' }
  }
  if (!CHECKOUT_UUID.test(idempotencyKey)) {
    return { ok: false, error: 'idempotency_key_invalid' }
  }
  try {
    const r = await apiFetch('/api/billing/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amountMinor, idempotencyKey }),
    })
    const j = (await r.json().catch(() => ({}))) as {
      [key: string]: unknown
    }
    if (!r.ok) {
      const error = typeof j.error === 'string' && /^[a-z0-9_]{3,80}$/.test(j.error)
        ? j.error
        : `checkout_http_${r.status}`
      return { ok: false, error }
    }
    const url = safeHostedCheckoutUrl(j.url)
    const checkoutId = typeof j.checkoutId === 'string' ? j.checkoutId : ''
    const returnedAmount = Number(j.amountMinor)
    const currency = typeof j.currency === 'string' ? j.currency.trim().toUpperCase() : ''
    const minorUnit = Number(j.minorUnit)
    const status = j.status
    if (
      !url ||
      !CHECKOUT_UUID.test(checkoutId) ||
      returnedAmount !== amountMinor ||
      !Number.isSafeInteger(returnedAmount) ||
      !/^[A-Z]{3}$/.test(currency) ||
      !Number.isInteger(minorUnit) ||
      minorUnit < 0 ||
      minorUnit > 6 ||
      (status !== 'pending' && status !== 'paid')
    ) return { ok: false, error: 'checkout_response_invalid' }
    return {
      ok: true,
      pay: { url, checkoutId, amountMinor: returnedAmount, currency, minorUnit, status },
    }
  } catch {
    return { ok: false, error: 'offline' }
  }
}

export type PaymentStatus = 'pending' | 'paid' | 'refunded' | 'chargeback' | 'failed' | 'admin_grant'

export interface PurchaseRecord {
  id: number
  amountMinor: number
  credits: number
  currency: string
  minorUnit: number
  status: PaymentStatus
  createdAt: string
}

export function paymentStatusPresentation(
  status: PaymentStatus,
  language: 'ro' | 'en',
): { label: string; tone: 'success' | 'warning' | 'danger' } {
  const ro = language === 'ro'
  if (status === 'paid') return { label: ro ? 'Plătită' : 'Paid', tone: 'success' }
  if (status === 'admin_grant') return { label: ro ? 'Credit oferit' : 'Credit granted', tone: 'success' }
  if (status === 'pending') return { label: ro ? 'În verificare' : 'Pending verification', tone: 'warning' }
  if (status === 'refunded') return { label: ro ? 'Rambursată' : 'Refunded', tone: 'warning' }
  if (status === 'chargeback') return { label: ro ? 'Plată contestată' : 'Chargeback', tone: 'danger' }
  return { label: ro ? 'Eșuată' : 'Failed', tone: 'danger' }
}

export async function fetchHistory(): Promise<PurchaseRecord[] | null> {
  try {
    const r = await apiFetch('/api/billing/history')
    if (!r.ok) return null
    const j = (await r.json()) as { history?: unknown; minorUnit?: unknown }
    if (!Array.isArray(j.history)) return null
    const minorUnit = Number(j.minorUnit)
    if (!Number.isInteger(minorUnit) || minorUnit < 0 || minorUnit > 6) return null
    const statuses = new Set<PaymentStatus>(['pending', 'paid', 'refunded', 'chargeback', 'failed', 'admin_grant'])
    const parsed: PurchaseRecord[] = []
    for (const raw of j.history) {
      if (!raw || typeof raw !== 'object') return null
      const row = raw as Record<string, unknown>
      const id = Number(row.id)
      const amountMinor = Number(row.amountMinor)
      const credits = Number(row.credits)
      const currency = typeof row.currency === 'string' ? row.currency.toUpperCase() : ''
      const status = row.status as PaymentStatus
      const createdAt = typeof row.createdAt === 'string' ? row.createdAt : ''
      if (
        !Number.isSafeInteger(id) || id < 1 ||
        !Number.isSafeInteger(amountMinor) || amountMinor < 0 ||
        !Number.isSafeInteger(credits) ||
        !/^[A-Z]{3}$/.test(currency) ||
        !statuses.has(status) ||
        !createdAt || !Number.isFinite(Date.parse(createdAt))
      ) return null
      parsed.push({ id, amountMinor, credits, currency, minorUnit, status, createdAt })
    }
    return parsed
  } catch {
    return null
  }
}
