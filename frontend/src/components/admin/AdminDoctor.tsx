import { useEffect, useRef, useState } from 'react'
import type { DoctorSnapshot } from '../../../../backend/src/shared/doctor'
import { checkDoctorNow, fetchDoctor, setDoctorGrant } from '../../lib/doctor'
import { parseAdminConstructorSnapshot, type BuildJobRow } from '../../lib/adminConstructorContract'
import { apiFetch } from '../../lib/transport'
import { formatLondonTimestamp } from '../../lib/versionEvidence'
import { ConstructorJobProgress } from './ConstructorJobProgress'

const DOCTOR_POLL_MS = 15_000 // hardcod-permis: actualizare UI, nu ritmul sau durata reparațiilor serverului.

export function DoctorReport({ snapshot, jobs }: { snapshot: DoctorSnapshot; jobs: BuildJobRow[] | null }) {
  return (
    <div>
      <p role="status">
        {snapshot.state === 'disabled' ? 'Reparații automate neautorizate — monitorizarea poate continua, fără ordine noi.'
          : snapshot.state === 'ready' ? 'Doctor autorizat și pregătit conform ultimei citiri a serverului.'
          : snapshot.state === 'running' ? 'Doctorul urmărește o reparație în curs.'
          : 'Doctor blocat — cauza măsurată trebuie rezolvată înainte de continuare.'}
      </p>
      {snapshot.error && <p role="alert">Cauză raportată de server: <code>{snapshot.error}</code></p>}
      <p className="chat-hint">Ultima verificare: {formatLondonTimestamp(snapshot.checkedAt) ?? 'neefectuată; funcționarea nu este încă probată'}.</p>
      {snapshot.grant && <p className="chat-hint">
        Autorizație {snapshot.grant.active ? 'activă' : 'inactivă'} · {snapshot.grant.expiresAt === null ? 'permanentă, revocabilă' : `expiră ${formatLondonTimestamp(snapshot.grant.expiresAt) ?? 'la un moment neconfirmat'}`}
        {' · '}{snapshot.grant.jobsCreated}/{snapshot.grant.maxJobs} ordine în fereastra de {snapshot.grant.windowHours} ore.
        {' '}Limita se reînnoiește la {formatLondonTimestamp(snapshot.grant.windowResetsAt) ?? 'un moment neconfirmat'}.
      </p>}
      {snapshot.incidents.length === 0 && <p className="chat-hint">Niciun incident înregistrat în acest răspuns. Aceasta nu dovedește că toate funcțiile aplicației au fost testate.</p>}
      {snapshot.incidents.map((incident) => {
        const job = jobs?.find((row) => row.id === incident.jobId)
        return (
          <section key={incident.id} className="admin-release-box" aria-label={`Incident Doctor ${incident.id}`}>
            <b>{incident.summary}</b>
            <p className="chat-hint">{incident.code} · {incident.status} · verificat {formatLondonTimestamp(incident.checkedAt) ?? 'la un moment neconfirmat'}</p>
            <p>{incident.evidence.result}: {incident.evidence.reason}</p>
            {incident.evidence.httpStatus !== null && <p className="chat-hint">HTTP {incident.evidence.httpStatus}</p>}
            {incident.jobId !== null && <p className="chat-hint">Ordin Constructor #{incident.jobId}</p>}
            {job ? <>
              <ConstructorJobProgress job={job} />
              {job.prUrl && <a href={job.prUrl} target="_blank" rel="noreferrer">PR-ul reparației ↗</a>}
              {job.continuity?.nextAction && <p className="chat-hint">{job.continuity.nextAction}</p>}
            </> : incident.jobId !== null && <p className="chat-hint">Progresul canonic al ordinului nu este disponibil în snapshotul curent; nu afișez un procent presupus.</p>}
            {incident.closure && <p className="chat-hint">
              Dovadă de închidere: versiune live <code>{incident.closure.liveSha}</code>, simptom reprobat sănătos la {formatLondonTimestamp(incident.closure.verifiedAt) ?? 'un moment neconfirmat'}.
            </p>}
          </section>
        )
      })}
    </div>
  )
}

/** One Admin surface; the backend owns grants, detection, intake and closure. */
export function AdminDoctor() {
  const [snapshot, setSnapshot] = useState<DoctorSnapshot | null | 'loading'>('loading')
  const [jobs, setJobs] = useState<BuildJobRow[] | null>(null)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [message, setMessage] = useState('')
  const [hours, setHours] = useState<string | null>(null)
  const [permanent, setPermanent] = useState(true)
  const [windowHours, setWindowHours] = useState<string | null>(null)
  const [maxJobs, setMaxJobs] = useState<string | null>(null)
  const refresh = useRef({ generation: 0, controller: null as AbortController | null })

  const load = (): void => {
    refresh.current.controller?.abort()
    const controller = new AbortController()
    const generation = ++refresh.current.generation
    refresh.current.controller = controller
    void fetchDoctor(controller.signal).then((next) => {
      if (generation !== refresh.current.generation || controller.signal.aborted) return
      setSnapshot(next)
      if (!next?.incidents.some((incident) => incident.jobId !== null)) { setJobs(null); return }
      void apiFetch('/api/admin/constructor', { signal: controller.signal }).then(async (response) => {
        const parsed = response.ok ? parseAdminConstructorSnapshot(await response.json()) : null
        if (generation === refresh.current.generation && !controller.signal.aborted) setJobs(parsed?.jobs ?? null)
      }).catch(() => { if (generation === refresh.current.generation && !controller.signal.aborted) setJobs(null) })
    })
  }

  useEffect(() => {
    const pendingRefresh = refresh.current
    load()
    const timer = window.setInterval(() => { if (!busyRef.current) load() }, DOCTOR_POLL_MS)
    return () => { ++pendingRefresh.generation; pendingRefresh.controller?.abort(); window.clearInterval(timer) }
  }, [])

  const mutate = async (operation: () => Promise<DoctorSnapshot | null>): Promise<void> => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setMessage('')
    ++refresh.current.generation
    refresh.current.controller?.abort()
    try {
      const next = await operation()
      if (next === null) {
        setMessage('Acțiunea nu a putut fi confirmată. Nu presupun că autorizarea sau starea s-a schimbat; recitesc serverul.')
      } else setSnapshot(next)
      load()
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const current = typeof snapshot === 'object' && snapshot !== null ? snapshot : null
  const requestedHours = hours === null ? current?.limits.maxDurationHours ?? 0 : Number(hours)
  const requestedMaxJobs = maxJobs === null ? current?.limits.maxJobs ?? 0 : Number(maxJobs)
  const requestedWindowHours = windowHours === null ? current?.limits.maxWindowHours ?? 0 : Number(windowHours)
  const grantLocked = busy || current?.grant?.active === true
  const grantValid = current !== null && !current.grant?.active && (permanent || (Number.isInteger(requestedHours) && requestedHours >= 1 && requestedHours <= current.limits.maxDurationHours))
    && Number.isInteger(requestedMaxJobs) && requestedMaxJobs >= 1 && requestedMaxJobs <= current.limits.maxJobs
    && Number.isInteger(requestedWindowHours) && requestedWindowHours >= 1 && requestedWindowHours <= current.limits.maxWindowHours

  return (
    <div className="admin-card" aria-labelledby="admin-doctor-title">
      <h3 id="admin-doctor-title">Doctor — probleme măsurate, reparații și dovadă live</h3>
      <p className="chat-hint">Monitorizarea și probele nu cer autorizarea reparațiilor. Autorizarea revocabilă permite ordine noi prin Constructorul configurat și aceeași coadă. PR-urile și deploy-ul continuă automat după verificările obligatorii, fără aprobare manuală pentru fiecare PR. Doctorul nu activează senzori, nu schimbă modelul, costurile sau secretele. Un incident se închide numai după dovada live și reproba simptomului.</p>
      <p className="chat-hint">Un incident raportat nu este automat reparabil: limitele de execuție sunt verificate pe server. Funcțiile neverificate sau blocate rămân afișate ca atare; autorizarea singură nu dovedește că executorul este pregătit.</p>
      {snapshot === 'loading' && <p role="status">Se citește starea Doctorului…</p>}
      {snapshot === null && <p role="alert">Doctor necitibil. Nu pot confirma activarea, autorizarea sau absența incidentelor.</p>}
      {current && <DoctorReport snapshot={current} jobs={jobs} />}
      {message && <p role="alert" className="chat-hint">{message}</p>}
      <div className="admin-form-row">
        <button type="button" className="ghost" disabled={busy} onClick={load}>Reîmprospătează starea</button>
        <button type="button" className="ghost" disabled={busy || !current} onClick={() => void mutate(checkDoctorNow)}>Verifică acum — fără autorizare nouă</button>
      </div>
      {current && <form onSubmit={(event) => {
        event.preventDefault()
        if (!grantValid || busyRef.current) return
        if (!window.confirm(`Autorizezi Doctorul ${permanent ? 'permanent, până la revocare' : `pentru ${requestedHours} ore`}, cu maximum ${requestedMaxJobs} ordine de reparare măsurată la fiecare ${requestedWindowHours} ore? Publicarea este automată după verificările obligatorii, fără aprobare manuală pentru fiecare PR. Poți revoca autorizația din acest panou.`)) return
        void mutate(() => setDoctorGrant({ scope: 'measured-code-repair', durationHours: permanent ? null : requestedHours, maxJobs: requestedMaxJobs, windowHours: requestedWindowHours }))
      }}>
        <div className="admin-form-row">
          <label><input type="checkbox" checked={permanent} disabled={grantLocked} onChange={(event) => setPermanent(event.currentTarget.checked)} /> Autorizare permanentă, revocabilă</label>
          {!permanent && <label>Durată (ore) <input type="number" min={1} max={current.limits.maxDurationHours} value={hours ?? current.limits.maxDurationHours} disabled={grantLocked} onChange={(event) => setHours(event.currentTarget.value)} required /></label>}
          <label>Maximum ordine pe fereastră <input type="number" min={1} max={current.limits.maxJobs} value={maxJobs ?? current.limits.maxJobs} disabled={grantLocked} onChange={(event) => setMaxJobs(event.currentTarget.value)} required /></label>
          <label>Fereastră (ore) <input type="number" min={1} max={current.limits.maxWindowHours} value={windowHours ?? current.limits.maxWindowHours} disabled={grantLocked} onChange={(event) => setWindowHours(event.currentTarget.value)} required /></label>
          <button type="submit" className="ghost" disabled={busy || !grantValid}>Autorizează intervalul și limita alese</button>
          {current.grant?.active && <button type="button" className="ghost" disabled={busy} onClick={() => void mutate(() => setDoctorGrant(null))}>Revocă autorizarea</button>}
        </div>
        {current.grant?.active && <p className="chat-hint">Există deja o autorizare activă. Pentru alte limite sau altă durată, revoc-o explicit înainte de o autorizare nouă.</p>}
        <p className="chat-hint">Revocarea oprește ordinele noi și anulează ordinele Doctor încă nepreluate. Un ordin deja revendicat, un PR sau un deploy poate continua prin porțile existente; revocarea nu inversează publicarea.</p>
      </form>}
    </div>
  )
}
