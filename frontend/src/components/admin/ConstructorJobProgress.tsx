import type { BuildJobRow } from '../../lib/adminConstructorContract'
import { constructorHasVerifiedLiveResult } from '../../lib/constructorContract'

/** Progress is a durable milestone count, never elapsed time or token guessing. */
export function ConstructorJobProgress({ job }: { job: BuildJobRow }) {
  const progress = job.workCard?.progress ?? job.continuity?.progress
  const live = constructorHasVerifiedLiveResult(job.status, job.continuity)
  const measured = progress?.source === 'constructor_activity_events' && progress.total > 0
    && progress.percent !== null && (progress.percent < 100 || live)
  const percent = live ? 100 : measured ? progress.percent! : null
  const current = job.continuity?.activity.at(-1)
  return (
    <div className="constructor-job-progress" style={{ flexBasis: '100%', marginTop: 8 }}>
      <label htmlFor={`constructor-progress-${job.id}`}>
        {live ? 'Deploy live verificat' : progress?.currentStage ?? current?.label ?? job.constructorStage}
        {' · '}{percent === null ? 'progres nemăsurat' : `${percent}% din etapele confirmate`}
      </label>
      <progress id={`constructor-progress-${job.id}`} max={100} value={percent ?? undefined}
        aria-label={`Progresul ordinului ${job.id}`} style={{ display: 'block', width: '100%', marginTop: 5 }} />
      <div className="chat-hint">
        {measured && <>{progress.completed}/{progress.total} etape confirmate · </>}
        {job.progress || 'Nicio activitate detaliată publicată.'}
        {current?.at && <> · actualizat {new Date(current.at).toLocaleString('ro-RO')}</>}
        {job.status === 'failed' && <> · Oprit cu eroare; nu este o execuție în curs.</>}
        {job.status === 'cancelled' && <> · Anulat explicit.</>}
      </div>
    </div>
  )
}
