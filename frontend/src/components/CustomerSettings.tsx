import { useEffect, useRef, useState } from 'react'
import BackLink from './BackLink'
import type { User } from '../lib/api'
import { forgetCachedUser, logout } from '../lib/api'
import {
  loadServerPrefs,
  saveSpeechLang,
  deleteMyAccount,
  loadLocalLang,
  saveVoicePref,
} from '../lib/prefs'
import {
  fetchBalance,
  fetchHistory,
  fetchLowCreditReminder,
  saveLowCreditReminder,
  getCreditePeLira,
  setCreditePeLira,
  pacheteDinPraguri,
  majorToMinor,
  minorToMajor,
  formatMinorMoney,
  paymentStatusPresentation,
  type LowCreditReminderConfig,
  type WalletStatus,
  type PurchaseRecord,
} from '../lib/billing'
import { LANGS } from '../lib/languages'
import { resolveLang, strings } from '../lib/i18n'
import { voceLocalaDisponibila } from '../lib/voceBrowser'
import { apiFetch } from '../lib/transport'
import {
  installOfflineKit,
  offlineKitSnapshot,
  refreshOfflineKit,
  removeOfflineKit,
  subscribeOfflineKit,
  type OfflineKitSnapshot,
} from '../lib/kitOffline'
import {
  offlineKitEstimatedBytes,
  offlineKitManifest,
} from '../lib/offlineKitManifest'
import { offlineInstallRisks } from '../lib/offlineInstallPolicy'
import {
  buildSpectralProfilePayload,
  parseSpectralProfileStatus,
  type SpectralProfileStatus,
} from '../lib/voiceProfile'

function formatBytes(bytes: number, locale: string): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000
    unit++
  }
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: unit > 2 ? 2 : 1 }).format(value)} ${units[unit]}`
}

export default function CustomerSettings({
  user,
  offline,
  onClose,
}: {
  readonly user: User
  readonly offline: boolean
  readonly onClose: () => void
}): React.JSX.Element {
  const [lang, setLang] = useState<string>(loadLocalLang() ?? 'en')
  const base = lang.slice(0, 2).toLowerCase()
  const ro = base === 'ro'
  const t = strings(resolveLang(lang))
  const [voice, setVoice] = useState<string>('')
  const [voices, setVoices] = useState<string[]>([])
  const [wallet, setWallet] = useState<WalletStatus | null | 'necitit'>(
    'necitit',
  )
  const [saveErr, setSaveErr] = useState('')
  const [istoric, setIstoric] = useState<PurchaseRecord[] | null | 'necitit'>(
    'necitit',
  )
  const [busy, setBusy] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)
  const [deletionResult, setDeletionResult] = useState<{
    ok: boolean
    message: string
    reauthenticatePath?: '/auth/google'
  } | null>(null)
  const [reminder, setReminder] = useState<LowCreditReminderConfig | null>(null)
  const [reminderReadFailed, setReminderReadFailed] = useState(false)
  const [voiceProfile, setVoiceProfile] = useState<
    SpectralProfileStatus | 'necitit' | 'esuat'
  >('necitit')
  const [recordingVp, setRecordingVp] = useState(false)
  const [deletingVp, setDeletingVp] = useState(false)
  const [vpMsg, setVpMsg] = useState('')
  const [confirmStergeVp, setConfirmStergeVp] = useState(false)
  // Pragurile monetare vin exclusiv din configurația serverului.
  const [praguri, setPraguri] = useState<{
    primaAlimentare: number
    minim: number
    pas: number
  } | null>(null)
  const [pricingReadFailed, setPricingReadFailed] = useState(false)
  const [offlineKit, setOfflineKit] = useState<OfflineKitSnapshot>(() =>
    offlineKitSnapshot(),
  )
  const [offlineConsent, setOfflineConsent] = useState(false)
  const [offlineRiskConsent, setOfflineRiskConsent] = useState(false)
  const [offlineStorageRiskConsent, setOfflineStorageRiskConsent] = useState(false)
  const [confirmRemoveOffline, setConfirmRemoveOffline] = useState(false)
  const [storageAvailable, setStorageAvailable] = useState<number | null>(null)
  const [networkHint, setNetworkHint] = useState('unknown')
  const [batteryHint, setBatteryHint] = useState<{
    level: number
    charging: boolean
  } | null>(null)
  const offlineAbortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    const unsubscribe = subscribeOfflineKit(setOfflineKit)
    void refreshOfflineKit()
    void navigator.storage
      ?.estimate?.()
      .then((estimate) => {
        if (
          typeof estimate.quota === 'number' &&
          typeof estimate.usage === 'number'
        ) {
          setStorageAvailable(Math.max(0, estimate.quota - estimate.usage))
        }
      })
      .catch(() => {})
    const extendedNavigator = navigator as Navigator & {
      connection?: {
        type?: string
        effectiveType?: string
        saveData?: boolean
        addEventListener?: (type: 'change', listener: () => void) => void
        removeEventListener?: (type: 'change', listener: () => void) => void
      }
      getBattery?: () => Promise<{
        level: number
        charging: boolean
        addEventListener?: (
          type: 'levelchange' | 'chargingchange',
          listener: () => void,
        ) => void
        removeEventListener?: (
          type: 'levelchange' | 'chargingchange',
          listener: () => void,
        ) => void
      }>
    }
    const connection = extendedNavigator.connection
    const updateNetworkHint = (): void => {
      setNetworkHint(
        connection?.saveData
          ? 'save-data'
          : (connection?.type ?? connection?.effectiveType ?? 'unknown'),
      )
    }
    updateNetworkHint()
    connection?.addEventListener?.('change', updateNetworkHint)
    let disposed = false
    let batteryHandle: Awaited<
      ReturnType<NonNullable<typeof extendedNavigator.getBattery>>
    > | null = null
    const updateBatteryHint = (): void => {
      if (batteryHandle && !disposed)
        setBatteryHint({
          level: batteryHandle.level,
          charging: batteryHandle.charging,
        })
    }
    void extendedNavigator
      .getBattery?.()
      .then((battery) => {
        if (disposed) return
        batteryHandle = battery
        updateBatteryHint()
        battery.addEventListener?.('levelchange', updateBatteryHint)
        battery.addEventListener?.('chargingchange', updateBatteryHint)
      })
      .catch(() => {})
    return () => {
      disposed = true
      connection?.removeEventListener?.('change', updateNetworkHint)
      batteryHandle?.removeEventListener?.('levelchange', updateBatteryHint)
      batteryHandle?.removeEventListener?.('chargingchange', updateBatteryHint)
      unsubscribe()
      offlineAbortRef.current?.abort()
    }
  }, [])

  useEffect(() => {
    if (offline) return
    void (async () => {
      const [p, b, h, vpRes, tarifeRes] = await Promise.all([
        loadServerPrefs(),
        fetchBalance(),
        fetchHistory(),
        apiFetch('/api/voiceprint/me')
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
        apiFetch('/api/tarife')
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
      ])
      const reminderRes = b && !b.scutit ? await fetchLowCreditReminder() : null
      // O configurație monetară incompletă nu primește valori locale implicite.
      const liveRate = Number(tarifeRes?.creditePeLira)
      const liveThresholds = tarifeRes?.praguri
      const pricingValid =
        Number.isFinite(liveRate) &&
        liveRate > 0 &&
        liveThresholds &&
        Number.isFinite(liveThresholds.primaAlimentare) &&
        liveThresholds.primaAlimentare > 0 &&
        Number.isFinite(liveThresholds.minim) &&
        liveThresholds.minim > 0 &&
        Number.isFinite(liveThresholds.pas) &&
        liveThresholds.pas > 0 &&
        liveThresholds.primaAlimentare >= liveThresholds.minim
      if (pricingValid) {
        setCreditePeLira(liveRate)
        setPraguri(liveThresholds)
        setPricingReadFailed(false)
      } else {
        setPricingReadFailed(true)
      }
      if (p?.speechLang) setLang(p.speechLang)
      if (p?.voices?.length) setVoices(p.voices)
      setVoice(p?.voice ?? '')
      setWallet(b) // null = citirea a picat — se afișează ca eșec, nu „…" pe veci
      setIstoric(h)
      if (b && !b.scutit) {
        setReminder(reminderRes)
        setReminderReadFailed(reminderRes === null)
      }
      setVoiceProfile(parseSpectralProfileStatus(vpRes) ?? 'esuat')
    })()
  }, [offline, user.email])

  async function onReminder(
    patch: Partial<
      Pick<
        LowCreditReminderConfig,
        'enabled' | 'thresholdMinor' | 'suggestedTopupMinor'
      >
    >,
  ): Promise<void> {
    if (!reminder) return
    const before = reminder
    const next = { ...reminder, ...patch }
    setReminder(next)
    const saved = await saveLowCreditReminder(next)
    if (!saved) {
      setReminder(before)
      setReminderReadFailed(true)
      setSaveErr(
        ro
          ? 'Nu s-a salvat avertizarea de credit scăzut — reîncearcă.'
          : 'The low-credit reminder was not saved — try again.',
      )
    } else {
      setReminder(saved)
      setReminderReadFailed(false)
      setSaveErr('')
    }
  }

  async function onLang(code: string): Promise<void> {
    const inainte = lang
    setLang(code)
    const ok = await saveSpeechLang(code)
    if (!ok) {
      setLang(inainte)
      setSaveErr(
        ro
          ? 'Nu s-a salvat limba — reîncearcă.'
          : 'The language was not saved — try again.',
      )
    } else setSaveErr('')
  }

  async function onLogout(): Promise<void> {
    setBusy(true)
    await logout()
    window.location.reload()
  }

  async function onRecordVoiceprint(): Promise<void> {
    try {
      setRecordingVp(true)
      setVpMsg(ro ? 'Vorbește timp de 3 secunde...' : 'Speak for 3 seconds...')
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const AudioContextClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext
      const audioCtx = new AudioContextClass()
      const source = audioCtx.createMediaStreamSource(stream)
      const analyser = audioCtx.createAnalyser()
      analyser.fftSize = 512
      source.connect(analyser)

      const freqData = new Uint8Array(analyser.frequencyBinCount)
      const samples: number[][] = []

      const interval = setInterval(() => {
        analyser.getByteFrequencyData(freqData)
        samples.push(Array.from(freqData.slice(0, 32)))
      }, 100)

      await new Promise((resolve) => setTimeout(resolve, 3000))
      clearInterval(interval)
      stream.getTracks().forEach((track) => track.stop())
      await audioCtx.close().catch(() => {})

      const payload = buildSpectralProfilePayload(
        samples,
        audioCtx.sampleRate,
        analyser.fftSize,
      )

      setVpMsg(
        ro
          ? 'Se salvează profilul spectral în cont...'
          : 'Saving spectral profile to account...',
      )

      const resp = await apiFetch('/api/voiceprint/me', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      })

      const data = await resp.json().catch(() => null)
      const profileStatus = parseSpectralProfileStatus(data)
      if (resp.ok && profileStatus) {
        setVoiceProfile(profileStatus)
        setVpMsg(
          ro
            ? 'Profil vocal spectral salvat.'
            : 'Spectral voice profile saved.',
        )
      } else {
        setVpMsg(
          ro
            ? 'Profilul vocal spectral nu a putut fi salvat.'
            : 'Failed to save spectral voice profile.',
        )
      }
    } catch {
      setVpMsg(
        ro
          ? 'Microfon inaccesibil sau refuzat.'
          : 'Microphone inaccessible or denied.',
      )
    } finally {
      setRecordingVp(false)
    }
  }

  async function onDeleteVoiceprint(): Promise<void> {
    setDeletingVp(true)
    setVpMsg(
      ro
        ? 'Se șterge profilul vocal spectral...'
        : 'Deleting spectral voice profile...',
    )
    const r = await apiFetch('/api/voiceprint/me', { method: 'DELETE' }).catch(
      () => null,
    )
    const data = r
      ? ((await r.json().catch(() => null)) as {
          ok?: boolean
          deleted?: boolean
        } | null)
      : null
    if (r?.ok && data?.ok) {
      setVoiceProfile((current) =>
        typeof current === 'object'
          ? {
              ...current,
              enrolled: false,
              name: null,
              hasAudio: false,
              updatedAt: null,
            }
          : current,
      )
      setConfirmStergeVp(false)
      setVpMsg(
        ro
          ? 'Profilul spectral, metadatele și orice clip atașat profilului au fost șterse.'
          : 'The spectral profile, metadata and any clip attached to it were deleted.',
      )
    } else {
      setVpMsg(
        ro
          ? 'Profilul vocal spectral nu a putut fi șters acum — reîncearcă.'
          : 'The spectral voice profile could not be deleted right now — try again.',
      )
    }
    setDeletingVp(false)
  }

  async function onInstallOfflineKit(): Promise<void> {
    if (
      !offlineConsent ||
      (offlineRisks.length > 0 && !offlineRiskConsent) ||
      offlineKit.phase === 'installing'
    )
      return
    const controller = new AbortController()
    offlineAbortRef.current = controller
    await installOfflineKit(controller.signal, { allowVolatileStorage: offlineStorageRiskConsent })
    if (offlineAbortRef.current === controller) offlineAbortRef.current = null
  }

  function onCancelOfflineKit(): void {
    offlineAbortRef.current?.abort()
    offlineAbortRef.current = null
  }

  async function onRemoveOfflineKit(): Promise<void> {
    setConfirmRemoveOffline(false)
    const removed = await removeOfflineKit()
    if (removed) setOfflineConsent(false)
    const estimate = await navigator.storage?.estimate?.().catch(() => null)
    if (
      estimate &&
      typeof estimate.quota === 'number' &&
      typeof estimate.usage === 'number'
    ) {
      setStorageAvailable(Math.max(0, estimate.quota - estimate.usage))
    }
  }

  async function onDelete(): Promise<void> {
    setBusy(true)
    const result = await deleteMyAccount()
    setBusy(false)
    if (result.ok) {
      await forgetCachedUser()
      setConfirmDel(false)
      const retained = result.receipt.retained
        .map((item) => item.category)
        .join(', ')
      setDeletionResult({
        ok: true,
        message: ro
          ? `Ștergerea a fost confirmată. Dovadă: ${result.receipt.requestId}.${retained ? ` Păstrate legal: ${retained}.` : ''}`
          : `Deletion confirmed. Receipt: ${result.receipt.requestId}.${retained ? ` Legally retained: ${retained}.` : ''}`,
      })
    } else {
      const reauthenticatePath =
        result.reauthenticatePath === '/auth/google'
          ? '/auth/google'
          : undefined
      setDeletionResult({
        ok: false,
        message:
          result.error === 'recent_reauthentication_required'
            ? ro
              ? 'Este necesară o autentificare Google recentă înainte de ștergere.'
              : 'Recent Google reauthentication is required before deletion.'
            : `${t.deleteAccClosed} (${result.error})`,
        ...(reauthenticatePath ? { reauthenticatePath } : {}),
      })
    }
  }

  const offlineTotalBytes = offlineKitEstimatedBytes(offlineKit.runtimeBytes)
  const offlineReady = offlineKit.runtimeReady && Object.values(offlineKit.components).every(Boolean)
  const offlineBusy =
    offlineKit.phase === 'checking' ||
    offlineKit.phase === 'installing' ||
    offlineKit.phase === 'removing'
  const offlineRisks = offlineInstallRisks(networkHint, batteryHint)
  const offlineRiskKey = offlineRisks.join(':')
  const localVoiceAvailable = voceLocalaDisponibila(resolveLang(lang))
  const offlineRiskLabels = offlineRisks.map((risk) => {
    if (risk === 'data_saver')
      return ro ? 'economisirea datelor este activă' : 'data saver is enabled'
    if (risk === 'metered_or_slow')
      return ro
        ? 'conexiunea pare mobilă sau lentă'
        : 'the connection appears cellular or slow'
    return ro
      ? 'bateria este sub 30% și nu se încarcă'
      : 'the battery is below 30% and is not charging'
  })
  const offlineComponents: Array<{
    key: 'hearing' | 'brain'
    ro: string
    en: string
    bytes: number
  }> = [
    {
      key: 'hearing',
      ro: 'Auz local',
      en: 'Local hearing',
      bytes: offlineKitManifest.components.hearing.estimatedBytes,
    },
    {
      key: 'brain',
      ro: 'Răspuns local',
      en: 'Local response',
      bytes: offlineKitManifest.components.brain.estimatedBytes,
    },
  ]

  useEffect(() => {
    setOfflineRiskConsent(false)
  }, [offlineRiskKey])

  return (
    <div className="contact-overlay" onClick={onClose}>
      <div
        className="contact-panel settings-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="contact-langbar">
          <BackLink onBack={onClose} />
          <div className="contact-title" style={{ margin: 0 }}>
            ⚙ {t.title}
          </div>
          <button
            type="button"
            className="contact-x"
            aria-label={t.close}
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        {/* 1 — Basic preferences */}
        <section className="settings-sec">
          <h4>{t.prefs}</h4>
          <label className="contact-label">{t.langLabel}</label>
          <select value={lang} onChange={(e) => void onLang(e.target.value)}>
            {LANGS.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>

          {voices.length > 0 && (
            <>
              <label className="contact-label" style={{ marginTop: 12 }}>
                {t.voiceLabel}
              </label>
              <select
                value={voice}
                onChange={(e) => {
                  const v = e.target.value
                  const inainte = voice
                  setVoice(v)

                  void saveVoicePref(v || null).then((ok) => {
                    if (!ok) {
                      setVoice(inainte)
                      setSaveErr(
                        ro
                          ? 'Nu s-a salvat vocea — reîncearcă.'
                          : 'The voice was not saved — try again.',
                      )
                    } else setSaveErr('')
                  })
                }}
              >
                <option value="">{t.voiceDefault}</option>
                {voices.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
              <p className="settings-note">{t.voiceNote}</p>
            </>
          )}
        </section>

        <section className="settings-sec">
          <h4>{ro ? 'Kit pentru modul avion' : 'Airplane-mode kit'}</h4>
          <p className="settings-note">
            {ro
              ? `Instalare opțională pe acest dispozitiv: aproximativ ${formatBytes(offlineTotalBytes, 'ro-RO')}. Include auz și răspuns local; vocea funcționează numai dacă sistemul oferă o voce locală pentru limba aleasă, altfel răspunsul rămâne text-only. Modul avion nu folosește cheia sau serverul OpenAI.`
              : `Optional install on this device: approximately ${formatBytes(offlineTotalBytes, 'en-GB')}. It includes local hearing and responses; speech works only when the system provides a local voice for the selected language, otherwise replies remain text-only. Airplane mode does not use an OpenAI key or server.`}
          </p>
          <p className="settings-note">
            {ro
              ? `Nivel mobil implicit: răspuns local compact (${offlineKitManifest.components.brain.id}), cu o calitate mai redusă decât OpenAI online. Cere WebGPU, cel puțin ${Math.ceil(offlineKitManifest.components.brain.deviceRequirements.vramRequiredMB)} MB memorie GPU estimată și trece verificarea dispozitivului înainte de primul byte. Inferența GPU nu poate fi certificată de mediul automat headless; trebuie probată pe acest dispozitiv.`
              : `Default mobile tier: compact local responses (${offlineKitManifest.components.brain.id}), with lower quality than online OpenAI. It requires WebGPU, about ${Math.ceil(offlineKitManifest.components.brain.deviceRequirements.vramRequiredMB)} MB of estimated GPU memory, and a device preflight before the first byte. GPU inference cannot be certified by the automated headless environment and must be tested on this device.`}
          </p>
          <p className="settings-note">
            {ro
              ? `Auzul local (${offlineKitManifest.components.hearing.id}) este verificat separat: cere WebGPU cu shader-f16 și o limită de buffer de cel puțin ${formatBytes(offlineKitManifest.components.hearing.deviceRequirements.minimumMaxBufferSize, 'ro-RO')}. Dacă adaptorul nu confirmă aceste limite, descărcarea nu pornește.`
              : `Local hearing (${offlineKitManifest.components.hearing.id}) is checked separately: it requires WebGPU with shader-f16 and a buffer limit of at least ${formatBytes(offlineKitManifest.components.hearing.deviceRequirements.minimumMaxBufferSize, 'en-GB')}. The download will not start unless the adapter confirms those limits.`}
          </p>
          <p className="settings-note">
            {ro
              ? `Folosește Wi-Fi, ține dispozitivul la încărcat și verifică spațiul. Rețea detectată: ${networkHint}. Spațiu disponibil estimat: ${storageAvailable === null ? 'necunoscut' : formatBytes(storageAvailable, 'ro-RO')}.`
              : `Use Wi-Fi, keep the device charging and check storage. Detected network: ${networkHint}. Estimated available storage: ${storageAvailable === null ? 'unknown' : formatBytes(storageAvailable, 'en-GB')}.`}
            {batteryHint &&
              ` ${ro ? 'Baterie' : 'Battery'}: ${Math.round(batteryHint.level * 100)}%${batteryHint.charging ? ` · ${ro ? 'se încarcă' : 'charging'}` : ''}.`}
          </p>
          <ul
            className="settings-history"
            aria-label={
              ro ? 'Componente kit offline' : 'Offline kit components'
            }
          >
            {offlineComponents.map((component) => (
              <li
                key={component.key}
                className="settings-note"
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 8,
                }}
              >
                <span>{ro ? component.ro : component.en}</span>
                <span>
                  {formatBytes(component.bytes, ro ? 'ro-RO' : 'en-GB')}
                </span>
                <span>
                  {offlineKit.components[component.key]
                    ? '✓'
                    : offlineKit.current === component.key
                      ? '…'
                      : '—'}
                </span>
              </li>
            ))}
          </ul>
          <p className="settings-note" role="status">
            {localVoiceAvailable
              ? ro
                ? 'Voce offline OS disponibilă pentru limba curentă (nu se descarcă).'
                : 'An offline OS voice is available for the current language (no download).'
              : ro
                ? 'Nu există o voce OS locală dovedită pentru limba curentă; în avion răspunsul rămâne text-only.'
                : 'No proven local OS voice is available for the current language; airplane replies remain text-only.'}
          </p>
          {offlineKit.phase === 'checking' && (
            <p className="settings-note" role="status">
              {ro
                ? 'Se verifică inventarul local, dimensiunile și hashurile…'
                : 'Checking the local inventory, sizes and hashes…'}
            </p>
          )}
          {(offlineKit.phase === 'installing' ||
            offlineKit.phase === 'removing') && (
            <div style={{ marginTop: 10 }} role="status">
              <progress
                value={offlineKit.progress}
                max={1}
                style={{ width: '100%' }}
              />
              <p className="settings-note">
                {offlineKit.phase === 'removing'
                  ? ro
                    ? 'Se elimină kitul de pe dispozitiv…'
                    : 'Removing the kit from this device…'
                  : `${ro ? 'Instalare' : 'Installing'}: ${Math.round(offlineKit.progress * 100)}%`}
              </p>
            </div>
          )}
          {(offlineKit.phase === 'error' ||
            offlineKit.phase === 'cancelled') && (
            <p
              className="settings-note"
              role="alert"
              style={{ color: '#e6a23c' }}
            >
              {offlineKit.phase === 'cancelled'
                ? ro
                  ? 'Instalarea a fost anulată. Componentele deja finalizate rămân disponibile; poți relua.'
                  : 'Installation was cancelled. Completed components remain available; you can resume.'
                : offlineKit.message === 'offline'
                  ? ro
                    ? 'Este necesară o conexiune pentru instalare. Modul avion nu va încerca descărcarea.'
                    : 'A connection is required to install. Airplane mode will not attempt a download.'
                  : offlineKit.message === 'insufficient_storage'
                    ? ro
                      ? `Spațiu insuficient: sunt necesari ${formatBytes(offlineKit.preflight?.requiredWithHeadroomBytes ?? 0, 'ro-RO')} inclusiv rezerva de siguranță.`
                      : `Not enough storage: ${formatBytes(offlineKit.preflight?.requiredWithHeadroomBytes ?? 0, 'en-GB')} is required including safety headroom.`
                : offlineKit.message === 'storage_unavailable'
                      ? ro
                        ? 'Browserul nu poate confirma spațiul disponibil; instalarea nu pornește.'
                        : 'The browser cannot confirm available storage, so installation will not start.'
                      : offlineKit.message === 'webgpu_unavailable' ||
                          offlineKit.message === 'webgpu_feature_missing' ||
                          offlineKit.message === 'webgpu_limit_too_low'
                        ? ro
                          ? `Acest dispozitiv nu îndeplinește cerințele WebGPU pentru ${offlineKit.preflight?.deviceComponent === 'hearing' ? 'auzul local' : 'răspunsul local'}.`
                          : `This device does not meet the WebGPU requirements for ${offlineKit.preflight?.deviceComponent === 'hearing' ? 'local hearing' : 'local responses'}.`
                        : ro
                          ? 'Kitul nu a fost instalat complet. Verifică spațiul, WebGPU și conexiunea, apoi reîncearcă.'
                          : 'The kit was not installed completely. Check storage, WebGPU and the connection, then retry.'}
            </p>
          )}
          {(offlineKit.message === 'persistent_storage_denied' ||
            offlineKit.message === 'persistent_storage_unsupported') && !offlineBusy && (
            <label className="contact-label" style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 8 }}>
              <input
                type="checkbox"
                checked={offlineStorageRiskConsent}
                onChange={(event) => setOfflineStorageRiskConsent(event.target.checked)}
              />
              <span>
                {ro
                  ? 'Browserul nu garantează stocarea persistentă. Înțeleg că poate evacua kitul și că disponibilitatea în avion trebuie reverificată înainte de plecare.'
                  : 'The browser cannot guarantee persistent storage. I understand it may evict the kit and airplane availability must be rechecked before travel.'}
              </span>
            </label>
          )}
          {!offlineReady && !offlineBusy && (
            <label
              className="contact-label"
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 8,
                marginTop: 10,
              }}
            >
              <input
                type="checkbox"
                checked={offlineConsent}
                onChange={(event) => {
                  setOfflineConsent(event.target.checked)
                  if (!event.target.checked) setOfflineRiskConsent(false)
                }}
              />
              <span>
                {ro
                  ? 'Sunt de acord cu descărcarea acestui kit mare pe dispozitiv și cu folosirea spațiului local indicat.'
                  : 'I agree to download this large kit to this device and use the indicated local storage.'}
              </span>
            </label>
          )}
          {!offlineReady && !offlineBusy && offlineRisks.length > 0 && (
            <div
              role="alert"
              className="settings-note"
              style={{ marginTop: 10, color: '#e6a23c' }}
            >
              <p style={{ margin: 0 }}>
                {ro
                  ? `Descărcarea nu pornește încă: ${offlineRiskLabels.join(' și ')}.`
                  : `The download will not start yet: ${offlineRiskLabels.join(' and ')}.`}
              </p>
              <label
                className="contact-label"
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 8,
                  marginTop: 8,
                }}
              >
                <input
                  type="checkbox"
                  checked={offlineRiskConsent}
                  onChange={(event) =>
                    setOfflineRiskConsent(event.target.checked)
                  }
                />
                <span>
                  {ro
                    ? `Înțeleg riscul și confirm separat descărcarea celor aproximativ ${formatBytes(offlineTotalBytes, 'ro-RO')} în aceste condiții.`
                    : `I understand the risk and separately confirm downloading approximately ${formatBytes(offlineTotalBytes, 'en-GB')} under these conditions.`}
                </span>
              </label>
            </div>
          )}
          <div className="settings-account-actions" style={{ marginTop: 10 }}>
            {!offlineReady && !offlineBusy && (
              <button
                type="button"
                className="contact-send"
                disabled={
                  !offlineConsent ||
                  (offlineRisks.length > 0 && !offlineRiskConsent) ||
                  ((offlineKit.message === 'persistent_storage_denied' ||
                    offlineKit.message === 'persistent_storage_unsupported') && !offlineStorageRiskConsent) ||
                  navigator.onLine === false
                }
                onClick={() => void onInstallOfflineKit()}
              >
                {offlineKit.phase === 'error' ||
                offlineKit.phase === 'cancelled'
                  ? ro
                    ? 'Reîncearcă instalarea'
                    : 'Retry installation'
                  : ro
                    ? 'Descarcă kitul offline'
                    : 'Download offline kit'}
              </button>
            )}
            {offlineKit.phase === 'installing' && (
              <button
                type="button"
                className="ghost"
                onClick={onCancelOfflineKit}
              >
                {ro ? 'Anulează' : 'Cancel'}
              </button>
            )}
            {(offlineReady ||
              Object.values(offlineKit.components).some(Boolean)) &&
              !offlineBusy &&
              !confirmRemoveOffline && (
                <button
                  type="button"
                  className="ghost settings-danger"
                  onClick={() => setConfirmRemoveOffline(true)}
                >
                  {ro
                    ? 'Elimină kitul de pe dispozitiv'
                    : 'Remove kit from device'}
                </button>
              )}
            {confirmRemoveOffline && !offlineBusy && (
              <div className="settings-confirm">
                <span className="settings-note">
                  {ro
                    ? 'Elimini toate modelele locale și vocile descărcate pe acest dispozitiv?'
                    : 'Remove all local models and downloaded voices from this device?'}
                </span>
                <div className="settings-confirm-row">
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => setConfirmRemoveOffline(false)}
                  >
                    {t.cancel}
                  </button>
                  <button
                    type="button"
                    className="contact-send settings-danger-solid"
                    onClick={() => void onRemoveOfflineKit()}
                  >
                    {ro ? 'Confirmă eliminarea' : 'Confirm removal'}
                  </button>
                </div>
              </div>
            )}
          </div>
          {offlineReady && (
            <p
              className="settings-note"
              role="status"
              style={{ color: '#67c23a' }}
            >
              {ro
                ? '✓ Kitul este pregătit pentru testul în modul avion.'
                : '✓ The kit is ready for an airplane-mode test.'}
            </p>
          )}
        </section>

        {/* Soldul și avertizarea de credit folosesc exclusiv politica serverului. */}
        <section className="settings-sec">
          <h4>{t.wallet}</h4>
          {saveErr && (
            <p className="settings-note" style={{ color: '#e6a23c' }}>
              ⚠ {saveErr}
            </p>
          )}
          <div className="settings-credits">
            {wallet !== 'necitit' && wallet?.scutit === true ? (
              <strong>
                {wallet.debitMinor === 0 &&
                typeof wallet.minorUnit === 'number' &&
                Number.isInteger(wallet.creditsUsed) &&
                (wallet.creditsUsed as number) >= 0
                  ? ro
                    ? `Cost Kelion: ${formatMinorMoney(wallet.debitMinor, wallet.currency, wallet.minorUnit, 'ro-RO') ?? 'indisponibil'} · ${(wallet.creditsUsed as number).toLocaleString()} credite consumate`
                    : `Kelion cost: ${formatMinorMoney(wallet.debitMinor, wallet.currency, wallet.minorUnit) ?? 'unavailable'} · ${(wallet.creditsUsed as number).toLocaleString()} credits used`
                  : ro
                    ? 'Starea facturării admin nu poate fi citită'
                    : 'Admin billing status unavailable'}
              </strong>
            ) : wallet !== 'necitit' && wallet?.scutit === false ? (
              <>
                <strong>{wallet.credits.toLocaleString()}</strong> {t.credits}
              </>
            ) : wallet === 'necitit' ? (
              <strong>…</strong>
            ) : (
              <strong>
                {ro ? 'Stare indisponibilă' : 'Status unavailable'}
              </strong>
            )}
            {wallet === null && (
              <span className="settings-note" style={{ color: '#e6a23c' }}>
                {' '}
                {ro
                  ? '(nu am putut citi soldul — redeschide Setările)'
                  : '(could not read the balance — reopen Settings)'}
              </span>
            )}
          </div>

          {wallet !== 'necitit' && wallet?.scutit === true ? (
            <p className="settings-note">
              {ro
                ? 'Contul de admin este scutit conform stării măsurate de server și nu are flux de cumpărare. Creditarea userilor se face din Admin → Utilizatori → Credit.'
                : 'The admin account is exempt according to the measured server state and has no purchase flow. Users are credited from Admin → Users → Credit.'}
            </p>
          ) : wallet !== 'necitit' && wallet?.scutit === false ? (
            <p className="settings-note">
              {ro
                ? 'Alimentezi din pastila de credit „＋" din bara de sus — alegi pachetul de credite dorit.'
                : 'Top up from the credit pill “＋” in the top bar — pick the credit pack you want.'}
            </p>
          ) : null}

          {wallet !== 'necitit' && wallet?.scutit === false && reminder && (
            <label
              className="contact-label"
              style={{
                marginTop: 12,
                display: 'flex',
                gap: 8,
                alignItems: 'center',
              }}
            >
              <input
                type="checkbox"
                checked={reminder.enabled}
                onChange={(e) => void onReminder({ enabled: e.target.checked })}
              />
              {ro
                ? 'Avertizare de credit scăzut (plata cere confirmarea mea)'
                : 'Low-credit reminder (payment requires my confirmation)'}
            </label>
          )}
          {wallet !== 'necitit' &&
            wallet?.scutit === false &&
            reminder?.enabled &&
            praguri &&
            getCreditePeLira() !== null && (
              <div
                className="settings-topup"
                style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}
              >
                <span className="settings-note">
                  {ro
                    ? 'Avertizează când valoarea creditului scade sub'
                    : 'Remind me when credit value falls below'}
                </span>
                <input
                  type="number"
                  min={0}
                  step={1 / 10 ** reminder.minorUnit}
                  value={
                    minorToMajor(reminder.thresholdMinor, reminder.minorUnit) ??
                    ''
                  }
                  onChange={(e) => {
                    const minor = majorToMinor(
                      Number(e.target.value),
                      reminder.minorUnit,
                    )
                    if (minor !== null)
                      void onReminder({ thresholdMinor: minor })
                  }}
                  style={{ width: 70 }}
                />
                <span className="settings-note">
                  {reminder.currency};{' '}
                  {ro ? 'sugerează plata' : 'suggest payment'}
                </span>

                <select
                  value={reminder.suggestedTopupMinor}
                  onChange={(e) =>
                    void onReminder({
                      suggestedTopupMinor: Number(e.target.value),
                    })
                  }
                >
                  {Array.from(
                    new Set([
                      reminder.suggestedTopupMinor,
                      ...pacheteDinPraguri(praguri)
                        .map((major) => majorToMinor(major, reminder.minorUnit))
                        .filter((minor): minor is number => minor !== null),
                    ]),
                  )
                    .sort((a, b) => a - b)
                    .map((minor) => {
                      const major = minorToMajor(
                        minor,
                        reminder.minorUnit,
                      ) as number
                      return (
                        <option key={minor} value={minor}>
                          {Math.floor(major * (getCreditePeLira() as number))}{' '}
                          {ro ? 'credite' : 'credits'} ·{' '}
                          {formatMinorMoney(
                            minor,
                            reminder.currency,
                            reminder.minorUnit,
                            ro ? 'ro-RO' : 'en-GB',
                          ) ?? '—'}
                        </option>
                      )
                    })}
                </select>
              </div>
            )}
          {wallet !== 'necitit' &&
            wallet?.scutit === false &&
            reminder?.enabled && (
              <p className="settings-note">
                {ro
                  ? 'Când ajungi sub prag, apare doar o invitație de plată. Alegi suma și confirmi tu în Revolut; Kelion nu poate debita automat contul.'
                  : 'When you reach the threshold, Kelion only shows a payment prompt. You choose the amount and confirm in Revolut; Kelion cannot debit your account automatically.'}
              </p>
            )}
          {wallet !== 'necitit' &&
            wallet?.scutit === false &&
            reminderReadFailed && (
              <p className="settings-note" style={{ color: '#e6a23c' }}>
                {ro
                  ? 'Setările avertizării nu au putut fi citite. Controlul este dezactivat și nu s-a presupus nicio valoare implicită.'
                  : 'Reminder settings could not be read. The control is disabled and no default value was assumed.'}
              </p>
            )}
          {wallet !== 'necitit' &&
            wallet?.scutit === false &&
            pricingReadFailed && (
              <p className="settings-note" style={{ color: '#e6a23c' }}>
                {ro
                  ? 'Configurația de preț nu a putut fi citită. Opțiunile de plată sunt dezactivate și nu afișăm valori implicite.'
                  : 'Pricing configuration could not be read. Payment options are disabled and no fallback values are shown.'}
              </p>
            )}

          {wallet !== 'necitit' &&
            wallet?.scutit === false &&
            istoric !== 'necitit' && (
              <div style={{ marginTop: 12 }}>
                <label className="contact-label">
                  {ro ? 'Istoricul plăților' : 'Payment history'}
                </label>
                {istoric === null ? (
                  <p className="settings-note">
                    {ro
                      ? 'Nu am putut citi istoricul — reîncearcă.'
                      : 'Could not read the history — try again.'}
                  </p>
                ) : istoric.length === 0 ? (
                  <p className="settings-note">
                    {ro ? 'Nicio plată încă.' : 'No payments yet.'}
                  </p>
                ) : (
                  <ul className="settings-history">
                    {istoric.slice(0, 10).map((r) => {
                      const status = paymentStatusPresentation(
                        r.status,
                        ro ? 'ro' : 'en',
                      )
                      return (
                        <li
                          key={r.id}
                          className="settings-note"
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            gap: 8,
                          }}
                        >
                          <span>
                            {new Date(r.createdAt).toLocaleDateString()}
                          </span>
                          <span>
                            {formatMinorMoney(
                              r.amountMinor,
                              r.currency,
                              r.minorUnit,
                              ro ? 'ro-RO' : 'en-GB',
                            ) ?? '—'}{' '}
                            → {r.credits.toLocaleString()}{' '}
                            {ro ? 'credite' : 'credits'}
                          </span>
                          <span data-payment-tone={status.tone}>
                            {status.label}
                          </span>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            )}
        </section>

        {/* 3 — Cont și profil vocal */}
        <section className="settings-sec">
          <h4>{t.account}</h4>
          <div className="settings-account">
            <span className="settings-note">
              {t.signedInAs} <strong>{user.email}</strong>
            </span>
          </div>

          <div
            style={{
              marginTop: 14,
              padding: '10px 12px',
              background: 'rgba(255,255,255,0.04)',
              borderRadius: 8,
            }}
          >
            <label className="contact-label" style={{ marginBottom: 6 }}>
              🎙 {ro ? 'Profil vocal spectral' : 'Spectral voice profile'}
            </label>
            <p className="settings-note">
              {ro
                ? 'Opțional. Compară un profil spectral pentru personalizare. Nu este identificare neurală a vorbitorului și nu acordă acces sau roluri.'
                : 'Optional. Compares a spectral profile for personalisation. It is not neural speaker identification and never grants access or roles.'}
            </p>
            {typeof voiceProfile === 'object' && (
              <p
                className="settings-note"
                data-testid="voice-profile-availability"
              >
                {ro
                  ? 'Metodă disponibilă: profil spectral · numai personalizare.'
                  : 'Available method: spectral profile · personalisation only.'}
              </p>
            )}
            {voiceProfile === 'necitit' ? (
              <p className="settings-note">
                {ro
                  ? 'Se citește starea profilului...'
                  : 'Reading spectral profile status...'}
              </p>
            ) : voiceProfile === 'esuat' ? (
              <p className="settings-note" style={{ color: '#c1121f' }}>
                {ro
                  ? 'Nu pot citi acum starea profilului vocal; reîncearcă. Nu înseamnă că profilul lipsește.'
                  : 'Cannot read the spectral profile status right now; try again. This does not mean the profile is absent.'}
              </p>
            ) : voiceProfile.enrolled ? (
              <div>
                <p
                  className="settings-note"
                  style={{ color: '#67c23a', margin: '4px 0' }}
                >
                  ✓{' '}
                  {ro
                    ? 'Profil spectral asociat contului'
                    : 'Spectral profile linked to account'}
                </p>
                {voiceProfile.updatedAt && (
                  <p
                    className="settings-note"
                    style={{
                      opacity: 0.8,
                      fontSize: '0.82rem',
                      margin: '2px 0 8px',
                    }}
                  >
                    {ro ? 'Actualizată la:' : 'Last updated:'}{' '}
                    {new Date(voiceProfile.updatedAt).toLocaleString()}
                  </p>
                )}
                <button
                  type="button"
                  className="ghost"
                  disabled={recordingVp}
                  onClick={() => void onRecordVoiceprint()}
                  style={{
                    marginTop: 4,
                    padding: '4px 10px',
                    fontSize: '0.85rem',
                  }}
                >
                  {recordingVp
                    ? ro
                      ? 'Se înregistrează...'
                      : 'Recording...'
                    : ro
                      ? 'Reînregistrează profilul spectral'
                      : 'Re-record spectral profile'}
                </button>
                {!confirmStergeVp ? (
                  <button
                    type="button"
                    className="ghost settings-danger"
                    disabled={recordingVp || deletingVp}
                    onClick={() => setConfirmStergeVp(true)}
                    style={{
                      marginTop: 4,
                      marginLeft: 8,
                      padding: '4px 10px',
                      fontSize: '0.85rem',
                    }}
                  >
                    {ro
                      ? 'Șterge profilul spectral'
                      : 'Delete spectral profile'}
                  </button>
                ) : (
                  <div className="settings-confirm" style={{ marginTop: 8 }}>
                    <span className="settings-note">
                      {ro
                        ? 'Ștergi definitiv vectorul spectral, metadatele și orice clip atașat acestui profil?'
                        : 'Permanently delete the spectral vector, metadata and any clip attached to this profile?'}
                    </span>
                    <div className="settings-confirm-row">
                      <button
                        type="button"
                        className="ghost"
                        disabled={deletingVp}
                        onClick={() => setConfirmStergeVp(false)}
                      >
                        {t.cancel}
                      </button>
                      <button
                        type="button"
                        className="contact-send settings-danger-solid"
                        disabled={deletingVp}
                        onClick={() => void onDeleteVoiceprint()}
                      >
                        {deletingVp
                          ? ro
                            ? 'Se șterge...'
                            : 'Deleting...'
                          : ro
                            ? 'Confirmă ștergerea'
                            : 'Confirm deletion'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div>
                <p className="settings-note" style={{ margin: '4px 0 8px' }}>
                  {ro
                    ? 'Niciun profil vocal spectral asociat acestui cont.'
                    : 'No spectral voice profile is linked to this account.'}
                </p>
                <button
                  type="button"
                  className="ghost"
                  disabled={recordingVp}
                  onClick={() => void onRecordVoiceprint()}
                  style={{ padding: '4px 10px', fontSize: '0.85rem' }}
                >
                  {recordingVp
                    ? ro
                      ? 'Se înregistrează (3s)...'
                      : 'Recording (3s)...'
                    : ro
                      ? 'Înregistrează profilul spectral'
                      : 'Record spectral profile'}
                </button>
              </div>
            )}
            {vpMsg && (
              <p
                className="settings-note"
                style={{
                  marginTop: 6,
                  color:
                    vpMsg.includes('succes') || vpMsg.includes('success')
                      ? '#67c23a'
                      : '#e6a23c',
                }}
              >
                {vpMsg}
              </p>
            )}
          </div>
          <div className="settings-account-actions">
            <button
              type="button"
              className="ghost"
              disabled={busy}
              onClick={() => void onLogout()}
            >
              {busy ? t.loggingOut : t.logout}
            </button>
            {!confirmDel ? (
              <button
                type="button"
                className="ghost settings-danger"
                disabled={busy}
                onClick={() => {
                  setDeletionResult(null)
                  setConfirmDel(true)
                }}
              >
                {t.deleteAcc}
              </button>
            ) : (
              <div className="settings-confirm">
                <span className="settings-note">{t.deleteConfirm}</span>
                <div className="settings-confirm-row">
                  <button
                    type="button"
                    className="ghost"
                    disabled={busy}
                    onClick={() => setConfirmDel(false)}
                  >
                    {t.cancel}
                  </button>
                  <button
                    type="button"
                    className="contact-send settings-danger-solid"
                    disabled={busy}
                    onClick={() => void onDelete()}
                  >
                    {busy ? t.deleting : t.deleteAcc}
                  </button>
                </div>
              </div>
            )}
            {deletionResult && (
              <div
                className="settings-confirm"
                role="status"
                aria-live="polite"
              >
                <span
                  className="settings-note"
                  style={{ color: deletionResult.ok ? '#67c23a' : '#e6a23c' }}
                >
                  {deletionResult.message}
                </span>
                {deletionResult.reauthenticatePath && (
                  <a className="ghost" href={deletionResult.reauthenticatePath}>
                    {ro
                      ? 'Reautentifică prin Google'
                      : 'Reauthenticate with Google'}
                  </a>
                )}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
