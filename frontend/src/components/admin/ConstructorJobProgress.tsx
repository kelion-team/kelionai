import type { BuildJobRow } from '../../lib/adminConstructorContract'
import { constructorHasVerifiedLiveResult } from '../../lib/constructorContract'

// Activity reports need seconds and milliseconds so successive poll results
// are distinguishable. Keep the owner's timezone explicit, not browser-local.
const activityClock = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3,
  hourCycle: 'h23', timeZoneName: 'short',
})

function reportTimestamp(value: string | null | undefined) {
  const date = value ? new Date(value) : null
  return date && Number.isFinite(date.getTime()) ? { iso: date.toISOString(), label: activityClock.format(date) } : null
}

/** Progress is a durable milestone count, never elapsed time or token guessing. */
export function ConstructorJobProgress({ job }: { job: BuildJobRow }) {
  const progress = job.workCard?.progress ?? job.continuity?.progress
  const live = constructorHasVerifiedLiveResult(job.status, job.continuity)
  const measured = progress?.source === 'constructor_activity_events' && progress.total > 0
    && progress.percent !== null && (progress.percent < 100 || live)
  const percent = live ? 100 : measured ? progress.percent! : null
  const current = (job.workCard?.activity ?? job.continuity?.activity)?.at(-1)
  const detail = job.progress?.trim()
  const activity = detail || current?.label || 'Nicio activitate detaliată publicată.'
  // A heartbeat can advance while no new tool action occurred. Keep its time
  // separate from the canonical event; job.updatedAt is only a report update.
  const signal = reportTimestamp(job.workCard?.heartbeatAt ?? (detail ? job.updatedAt : null))
  const eventTime = reportTimestamp(current?.at)
  const stopped = job.status === 'failed' ? 'Oprit cu eroare' : job.status === 'cancelled' ? 'Anulat explicit' : null
  const status = stopped ?? (live ? 'Deploy live verificat' : job.status === 'running' ? 'în lucru'
    : job.status === 'queued' ? 'în coadă' : 'execuție încheiată; deploy live neverificat')
  return (
    <div className="constructor-job-progress" style={{ flexBasis: '100%', marginTop: 8 }}>
      <label htmlFor={`constructor-progress-${job.id}`}>
        {stopped ?? (live ? 'Deploy live verificat' : progress?.currentStage ?? current?.label ?? job.constructorStage)}
        {' · '}{percent === null ? 'progres nemăsurat' : `${percent}% din etapele confirmate`}
      </label>
      <progress id={`constructor-progress-${job.id}`} max={100} value={percent ?? undefined}
        aria-label={`Progresul ordinului ${job.id}`} style={{ display: 'block', width: '100%', marginTop: 5 }} />
      <div className="chat-hint">
        {measured && <>{progress.completed}/{progress.total} etape confirmate. </>}
        Bara măsoară etapele confirmate, nu timpul rămas sau numărul de unelte.
      </div>
      <section aria-label={`Activitatea ordinului ${job.id}`} aria-live="polite" aria-atomic="true"
        style={{ marginTop: 8, padding: 10, border: '1px solid currentColor', borderRadius: 8, fontSize: 14, overflowWrap: 'anywhere' }}>
        <strong>Ultimul raport al executorului</strong>
        <div>Status raportat: {status}.</div>
        <div style={{ marginTop: 5, whiteSpace: 'pre-wrap' }}>{activity}</div>
        <div style={{ marginTop: 5 }}>
          {eventTime ? <>Ultimul eveniment canonic: {current!.label} · <time dateTime={eventTime.iso} title={eventTime.iso}>{eventTime.label} (Europe/London)</time></>
            : 'Momentul ultimului eveniment canonic nu este disponibil.'}
        </div>
        <div>
          {signal ? <>{job.workCard?.heartbeatAt ? 'Semnal raportat la' : 'Raport actualizat la'} <time dateTime={signal.iso} title={signal.iso}>{signal.label} (Europe/London)</time></>
            : 'Ora actualizării raportului nu este disponibilă.'}
          {' '}Un semnal nou nu dovedește o acțiune nouă.
        </div>
        {job.status === 'running' && job.constructorStage === 'working' && (
          <div style={{ marginTop: 5 }}>Execuția AI: procent necunoscut. Uneltele confirmate nu indică procentul de finalizare.</div>
        )}
        {stopped && <div>Execuția nu mai este în curs; activitatea afișată rămâne dovadă istorică.</div>}
      </section>
    </div>
  )
}
