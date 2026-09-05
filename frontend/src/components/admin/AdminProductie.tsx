import { ConstructorJobProgress } from './ConstructorJobProgress'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { adminStrings } from '../../lib/adminText'
import {
  fetchCreier,
  type CreierAdmin,
  fetchConstructorWorkerAdmin,
  type ConstructorWorkerAdmin,
  fetchConstructorModelAdmin,
  evalueazaOrdinConstructor,
  type EvalConstructor,
} from '../../lib/admin'
import { fetchBalance, formatMinorMoney, type WalletStatus } from '../../lib/billing'
import { apiFetch } from '../../lib/transport'
import { AGENT_CUSTOM_ROLE_MAX_LENGTH } from '../../../../backend/src/shared/agentCustomPolicy'
import {
  constructorAvailabilityFromSnapshot,
  constructorActorLabel,
  constructorFinalResultText,
  constructorHasVerifiedLiveResult,
  constructorJobCanBeCancelled,
  constructorPersistentEventsText,
  type ConstructorWorkerSummary,
} from '../../lib/constructorContract'
import {
  adminContractText,
  adminMutationAcknowledged,
  adminReleaseActionAcknowledged,
  parseAdminArchiveAcknowledgement,
  parseAdminBuildArchive,
  parseAdminConstructorDiagnostic,
  parseAdminConstructorIntake,
  parseAdminConstructorSnapshot,
  parseAdminReleaseSnapshot,
  parseAdminRestoreAcknowledgement,
  type AdminConstructorModelSnapshot,
  type AdminConstructorDiagnostic,
  type AdminReleaseSnapshot,
  type BuildArchiveCursor,
  type BuildJobRow,
} from '../../lib/adminConstructorContract'

// ── CONSTRUCTOR tab ─────────────────────────────────────────────────────────

export function AdminConstructor({ dedicatedClient = false }: { dedicatedClient?: boolean } = {}) {
  const A = adminStrings()
  const [buildJobs, setBuildJobs] = useState<BuildJobRow[] | null | 'necitit'>('necitit')
  const [buildArchive, setBuildArchive] = useState<{
    status: 'idle' | 'loading' | 'ready' | 'error'
    jobs: BuildJobRow[]
    nextCursor: BuildArchiveCursor | null
    appendError: boolean
  }>({ status: 'idle', jobs: [], nextCursor: null, appendError: false })
  const [archiveOpen, setArchiveOpen] = useState(false)
  const [constructorAcceptingWork, setConstructorAcceptingWork] = useState<boolean | null>(null)
  const [constructorWorkerCanStartNow, setConstructorWorkerCanStartNow] = useState<boolean | null>(null)
  const [constructorId, setConstructorId] = useState<ConstructorWorkerSummary | null>(null)
  const [constructorModel, setConstructorModel] = useState<AdminConstructorModelSnapshot | null | 'necitit'>('necitit')
  const [diagnostic, setDiagnostic] = useState<AdminConstructorDiagnostic | null>(null)
  const [release, setRelease] = useState<AdminReleaseSnapshot | null>(null)
  const [releaseBusy, setReleaseBusy] = useState(false)
  const [buildOrder, setBuildOrder] = useState('')
  const [buildMsg, setBuildMsg] = useState('')
  const [buildSubmitBusy, setBuildSubmitBusy] = useState(false)
  const buildRefreshRef = useRef<{ generation: number; controller: AbortController | null }>({ generation: 0, controller: null })
  const archiveRefreshRef = useRef<{ generation: number; controller: AbortController | null }>({ generation: 0, controller: null })
  const evalGenerationRef = useRef(0)
  const pendingBuildMutationRef = useRef(new Set<number>())
  const [pendingBuildMutations, setPendingBuildMutations] = useState<Set<number>>(new Set())
  const [agentName, setAgentName] = useState('')
  const [agentRole, setAgentRole] = useState('')
  const [agentDeep, setAgentDeep] = useState(false)
  const [agentAdminOnly, setAgentAdminOnly] = useState(false)
  const [agentBusy, setAgentBusy] = useState(false)
  const [agentMsg, setAgentMsg] = useState('')
  const [evalOrdin, setEvalOrdin] = useState<EvalConstructor | null>(null)

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const generation = ++evalGenerationRef.current
    const text = buildOrder.trim()
    if (text.length < 3) { setEvalOrdin(null); return }
    const id = window.setTimeout(() => {
      void evalueazaOrdinConstructor(text).then((evaluation) => {
        if (evalGenerationRef.current === generation) setEvalOrdin(evaluation)
      })
    }, 400)
    return () => {
      window.clearTimeout(id)
      if (evalGenerationRef.current === generation) evalGenerationRef.current += 1
    }
  }, [buildOrder])

  async function addCustomAgent(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (agentBusy || agentName.trim().length < 3 || agentRole.trim().length < 10) return
    setAgentBusy(true)
    setAgentMsg('')
    try {
      const response = await apiFetch('/api/enterprise/agent-nou', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ nume: agentName.trim(), rol: agentRole.trim(), efort: agentDeep ? 'high' : undefined, doarAdmin: agentAdminOnly || undefined }),
      })
      const body = (await response.json().catch(() => null)) as { id?: string; error?: string } | null
      if (!response.ok || !body?.id) {
        setAgentMsg(body?.error ?? `Agentul nu a fost creat (HTTP ${response.status}).`)
      } else {
        setAgentMsg(`Agentul ${body.id} este disponibil în aplicație.`)
        setAgentName(''); setAgentRole(''); setAgentDeep(false); setAgentAdminOnly(false)
      }
    } catch {
      setAgentMsg('Agentul nu a fost creat: conexiunea cu serverul a eșuat.')
    } finally {
      setAgentBusy(false)
    }
  }

  const refreshBuildJobs = (): void => {
    buildRefreshRef.current.controller?.abort()
    const controller = new AbortController()
    const generation = buildRefreshRef.current.generation + 1
    buildRefreshRef.current = { generation, controller }
    const isCurrent = (): boolean => buildRefreshRef.current.generation === generation
    apiFetch('/api/admin/constructor', { credentials: 'include', signal: controller.signal })
      .then(async (response) => response.ok ? parseAdminConstructorSnapshot(await response.json()) : null)
      .then((snapshot) => {
        if (!isCurrent()) return
        if (snapshot) {
          const availability = constructorAvailabilityFromSnapshot(snapshot)
          setBuildJobs(snapshot.jobs)
          setConstructorAcceptingWork(availability.acceptingWork)
          setConstructorWorkerCanStartNow(availability.workerCanStartNow)
          setConstructorId(snapshot.constructor)
        } else {
          setBuildJobs(null)
          setConstructorAcceptingWork(false)
          setConstructorWorkerCanStartNow(false)
          setConstructorId({ cine: 'unavailable', state: 'unknown', motiv: 'starea Constructorului nu a putut fi citită', lastHeartbeat: null })
        }
      })
      .catch(() => {
        if (!isCurrent()) return
        setBuildJobs(null)
        setConstructorAcceptingWork(false)
        setConstructorWorkerCanStartNow(false)
        setConstructorId({ cine: 'unavailable', state: 'unknown', motiv: 'starea Constructorului nu a putut fi citită', lastHeartbeat: null })
      })
    apiFetch('/api/admin/constructor/diagnostic', { credentials: 'include', signal: controller.signal })
      .then(async (response) => response.ok ? parseAdminConstructorDiagnostic(await response.json()) : null)
      .then((d) => {
        if (!isCurrent()) return
        setDiagnostic(d ?? {
          sanatos: false, verdict: 'Diagnosticul Constructor nu poate fi citit.',
          probleme: [{ cod: 'diagnostic_unavailable', severitate: 'critic', ce: 'Citirea diagnosticului a eșuat.', recomandare: 'Reîncearcă și verifică backendul și baza de date.' }],
          masuratori: null,
        })
      })
      .catch(() => {
        if (!isCurrent()) return
        setDiagnostic({
          sanatos: false, verdict: 'Diagnosticul Constructor nu poate fi citit.',
          probleme: [{ cod: 'diagnostic_unavailable', severitate: 'critic', ce: 'Conexiunea pentru diagnostic a eșuat.', recomandare: 'Reîncearcă și verifică serviciul backend.' }],
          masuratori: null,
        })
      })
    apiFetch('/api/admin/constructor/release', { credentials: 'include', cache: 'no-store', signal: controller.signal })
      .then(async (response) => response.ok ? parseAdminReleaseSnapshot(await response.json()) : null)
      .then((snapshot) => {
        if (!isCurrent()) return
        setRelease(snapshot ?? {
          jobId: null, integration: 'unavailable', setupInstructions: null, pr: null,
          checks: 'unknown', approval: 'unknown', merge: 'unknown',
          nextAction: 'Starea integrării GitHub nu a putut fi citită.',
        })
      })
      .catch(() => {
        if (!isCurrent()) return
        setRelease({
          jobId: null, integration: 'unavailable', setupInstructions: null, pr: null,
          checks: 'unknown', approval: 'unknown', merge: 'unknown',
          nextAction: 'Conexiunea către starea de publicare a eșuat.',
        })
      })
    void fetchConstructorModelAdmin(controller.signal).then((snapshot) => {
      if (!isCurrent()) return
      setConstructorModel(snapshot)
    })
  }

  const releaseAction = (): void => {
    if (!release?.jobId || !release.pr || releaseBusy) return
    setReleaseBusy(true)
    setBuildMsg('')
    void apiFetch('/api/admin/constructor/release/action', {
      method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ jobId: release.jobId, action: 'approve', prNumber: release.pr.number, headSha: release.pr.headSha }),
    })
      .then(async (response) => {
        const body: unknown = await response.json().catch(() => null)
        if (response.ok && adminReleaseActionAcknowledged(body)) {
          setBuildMsg('Aprobarea a fost înregistrată; publisherul separat va integra schimbarea după verificările obligatorii.')
          return
        }
        const error = adminContractText(body, 'error')
        setBuildMsg(`Acțiunea de publicare a eșuat${error ? `: ${error}` : '.'}`)
      })
      .catch(() => setBuildMsg('Acțiunea de publicare a eșuat: conexiunea cu serverul a căzut.'))
      .finally(() => { setReleaseBusy(false); refreshBuildJobs() })
  }

  useEffect(() => {
    refreshBuildJobs()
    const id = window.setInterval(() => { refreshBuildJobs() }, 10_000)
    return () => {
      window.clearInterval(id)
      buildRefreshRef.current.controller?.abort()
      buildRefreshRef.current.generation += 1
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const sendBuildOrder = (): void => {
    if (buildSubmitBusy) return
    const text = buildOrder.trim()
    if (text.length < 8) { setBuildMsg(A.writeCompleteOrder); return }
    const order = text
    setBuildSubmitBusy(true)
    setBuildMsg('')
    void apiFetch('/api/admin/constructor', {
      method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ order }),
    })
      .then(async (response) => ({ ok: response.ok, body: await response.json().catch(() => null) as unknown }))
      .then(({ ok, body }) => {
        const intake = ok ? parseAdminConstructorIntake(body) : null
        if (intake) {
          const availability = constructorAvailabilityFromSnapshot(intake)
          setConstructorAcceptingWork(availability.acceptingWork)
          setConstructorWorkerCanStartNow(availability.workerCanStartNow)
          setConstructorId(intake.constructor)
          setBuildOrder((current) => current.trim() === order ? '' : current)
          setEvalOrdin(null)
          setBuildMsg(
            intake.deduplicated
              ? `Ordinul #${intake.id} era deja activ; am reutilizat aceeași execuție fără dublură.`
              : availability.workerCanStartNow
                ? A.orderEnqueuedActive(intake.id)
                : A.orderEnqueuedWaiting(intake.id),
          )
        } else if (adminContractText(body, 'error') === 'ordin_respins') {
          setBuildMsg(`Ordin respins: ${adminContractText(body, 'motiv') ?? 'cerință neclară'}`)
        } else {
          setBuildMsg(A.orderSendFailed)
          refreshBuildJobs()
        }
      })
      .catch(() => setBuildMsg(A.orderSendFailed))
      .finally(() => setBuildSubmitBusy(false))
  }

  const beginBuildMutation = (id: number): boolean => {
    if (pendingBuildMutationRef.current.has(id)) return false
    pendingBuildMutationRef.current.add(id)
    setPendingBuildMutations(new Set(pendingBuildMutationRef.current))
    return true
  }
  const endBuildMutation = (id: number): void => {
    pendingBuildMutationRef.current.delete(id)
    setPendingBuildMutations(new Set(pendingBuildMutationRef.current))
  }
  const submitBuildMutation = (
    job: BuildJobRow, action: 'anuleaza' | 'reia',
    successMessage: string, staleMessage: string, failureMessage: string,
  ): void => {
    void apiFetch(`/api/admin/constructor/${job.id}/${action}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ expectedStatus: job.status, expectedUpdatedAt: job.updatedAt }),
    })
      .then(async (response) => ({ httpOk: response.ok, body: await response.json().catch(() => null) as unknown }))
      .then(({ httpOk, body }) => {
        setBuildMsg(
          httpOk && adminMutationAcknowledged(body)
            ? successMessage
            : adminContractText(body, 'error') === 'stale_job_state'
              ? staleMessage
              : failureMessage,
        )
      })
      .catch(() => setBuildMsg(failureMessage))
      .finally(() => { endBuildMutation(job.id); refreshBuildJobs() })
  }
  const deleteBuildOrder = (job: BuildJobRow): void => {
    if (!window.confirm(A.confirmDeleteBuildOrder(job.id)) || !beginBuildMutation(job.id)) return
    const query = new URLSearchParams({ expectedStatus: job.status, expectedUpdatedAt: job.updatedAt })
    void apiFetch(`/api/admin/constructor/${job.id}?${query.toString()}`, { method: 'DELETE', credentials: 'include' })
      .then(async (response) => ({ httpOk: response.ok, body: await response.json().catch(() => null) as unknown }))
      .then(({ httpOk, body }) => {
        if (httpOk && adminMutationAcknowledged(body)) {
          setBuildJobs((prev) => Array.isArray(prev) ? prev.filter((x) => x.id !== job.id) : prev)
          setBuildMsg(A.orderDeleted(job.id))
        } else setBuildMsg(adminContractText(body, 'error') === 'stale_job_state' ? 'Starea ordinului s-a schimbat; lista a fost reîmprospătată.' : A.orderDeleteFailed)
      })
      .catch(() => setBuildMsg(A.orderDeleteFailed))
      .finally(() => { endBuildMutation(job.id); refreshBuildJobs() })
  }
  const cancelBuildOrder = (job: BuildJobRow): void => {
    if (!window.confirm(A.confirmStopBuildOrder(job.id)) || !beginBuildMutation(job.id)) return
    submitBuildMutation(job, 'anuleaza', A.orderStopped(job.id), 'Starea ordinului s-a schimbat; oprirea nu a fost aplicată.', A.orderStopFailed)
  }
  const cleanBuildOrders = (): void => {
    if (!window.confirm(A.confirmClearFailedJobs)) return
    const buildJobsData = Array.isArray(buildJobs) ? buildJobs : null
    const jobs = (buildJobsData ?? [])
      .filter((job) => ['failed', 'done', 'cancelled'].includes(job.status))
      .map((job) => ({ id: job.id, status: job.status, updatedAt: job.updatedAt }))
    void apiFetch('/api/admin/constructor/curata', {
      method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ scope: 'failed_done', jobs }),
    })
      .then(async (response) => {
        const body: unknown = await response.json().catch(() => null)
        return { archived: response.ok ? parseAdminArchiveAcknowledgement(body) : null, error: adminContractText(body, 'error') }
      })
      .then(({ archived, error }) => {
        refreshBuildJobs()
        if (archiveOpen) loadBuildArchive()
        setBuildMsg(archived !== null
          ? A.ordersCleaned(archived)
          : error === 'stale_job_state'
            ? 'Starea ordinelor s-a schimbat; lista a fost reîmprospătată.'
            : A.ordersCleanFailed)
      })
      .catch(() => setBuildMsg(A.ordersCleanFailed))
  }
  const retryBuildOrder = (job: BuildJobRow): void => {
    if (!beginBuildMutation(job.id)) return
    submitBuildMutation(job, 'reia', A.orderResumed(job.id), 'Starea ordinului s-a schimbat; reluarea nu a fost aplicată.', A.orderResumeFailed)
  }

  const loadBuildArchive = (cursor: BuildArchiveCursor | null = null, append = false): void => {
    archiveRefreshRef.current.controller?.abort()
    const controller = new AbortController()
    const generation = archiveRefreshRef.current.generation + 1
    archiveRefreshRef.current = { generation, controller }
    const isCurrent = (): boolean => archiveRefreshRef.current.generation === generation
    const query = cursor ? `?cursorUpdatedAt=${encodeURIComponent(cursor.updatedAt)}&cursorId=${cursor.id}` : ''
    setBuildArchive((previous) => ({ status: 'loading', jobs: append ? previous.jobs : [], nextCursor: append ? previous.nextCursor : null, appendError: false }))
    void apiFetch(`/api/admin/constructor/arhiva${query}`, { credentials: 'include', cache: 'no-store', signal: controller.signal })
      .then(async (response) => response.ok ? parseAdminBuildArchive(await response.json().catch(() => null)) : null)
      .then((body) => {
        if (!isCurrent()) return
        if (!body) throw new Error('archive_unreadable')
        setBuildArchive((previous) => {
          const combined = append ? [...previous.jobs, ...body.jobs] : body.jobs
          return { status: 'ready', jobs: [...new Map(combined.map((job) => [job.id, job])).values()], nextCursor: body.nextCursor, appendError: false }
        })
      })
      .catch(() => {
        if (!isCurrent()) return
        setBuildArchive((previous) => append && previous.jobs.length > 0 ? { ...previous, status: 'ready', appendError: true } : { ...previous, status: 'error', appendError: false })
      })
  }
  const restoreBuildOrder = (job: BuildJobRow): void => {
    if (!beginBuildMutation(job.id)) return
    void apiFetch(`/api/admin/constructor/${job.id}/restaureaza`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ expectedStatus: job.status, expectedUpdatedAt: job.updatedAt }),
    })
      .then(async (response) => ({ httpOk: response.ok, body: await response.json().catch(() => null) as unknown }))
      .then(({ httpOk, body }) => setBuildMsg(
        httpOk && parseAdminRestoreAcknowledgement(body) !== null
          ? `Ordinul #${job.id} a fost restaurat în istoricul vizibil.`
          : adminContractText(body, 'error') === 'stale_job_state'
            ? 'Arhiva s-a schimbat; reîncarc lista.'
            : 'Ordinul nu a putut fi restaurat.',
      ))
      .catch(() => setBuildMsg('Arhiva nu a putut fi actualizată: conexiunea a eșuat.'))
      .finally(() => { endBuildMutation(job.id); loadBuildArchive(); refreshBuildJobs() })
  }

  const buildJobsData = Array.isArray(buildJobs) ? buildJobs : null
  const constructorModelSnapshot = typeof constructorModel === 'object' && constructorModel !== null
    ? constructorModel
    : null

  return (
    <div className="admin-tab-content">
      <div className="admin-card">
        <div className="admin-card-head">
          Constructor admin — ordin → modificări și teste → PR → aprobare → deploy verificat. Acest executor poate modifica Kelion numai pentru administrator; nu deservește spații de utilizator.
        </div>
        <div className="admin-constructor-status">
          <span
            className="chat-hint"
            style={{
              fontSize: 12, fontWeight: 600,
              color: constructorId == null ? undefined
                : constructorWorkerCanStartNow === true ? '#1a7f37'
                : constructorAcceptingWork === true ? '#2563eb'
                : constructorId.state === 'degraded' ? '#8a6d1a'
                : '#c1121f',
            }}
            title={constructorId?.motiv ?? 'identitatea constructorului încă nu s-a citit'}
          >
            {constructorId == null ? 'Constructor: se citește…'
              : constructorWorkerCanStartNow === true ? '🟢 Lanțul Constructor este pregătit: worker + publisher + release'
              : constructorAcceptingWork === true ? '🔵 Lanțul Constructor execută o etapă verificată'
              : constructorId.state === 'degraded' ? `🟠 Constructor degradat — ${constructorId.motiv}`
              : `🔴 Constructor indisponibil — ${constructorId.motiv}`}
          </span>
          {diagnostic && (diagnostic.probleme.length > 0 || !diagnostic.sanatos) && (
            <div className={`admin-diagnostic-box${diagnostic.sanatos ? ' warn' : ' crit'}`}>
              <div className="admin-diagnostic-verdict">
                {diagnostic.sanatos ? '⚠ ' : '🔴 '}{diagnostic.verdict}
              </div>
              {diagnostic.probleme.map((p) => (
                <div key={p.cod} className="admin-diagnostic-prob">
                  <span className="admin-diagnostic-ce">{p.severitate === 'critic' ? '🔴' : '⚠'} {p.ce}</span>
                  <br />
                  <span className="chat-hint" style={{ fontSize: 11.5 }}>→ {p.recomandare}</span>
                </div>
              ))}
            </div>
          )}
          {release && (
            <div className="admin-release-box">
              <div className="admin-release-title">Publicare GitHub</div>
              {release.integration !== 'ready' ? (
                <>
                  <div style={{ color: release.integration === 'setup_required' ? '#8a6d1a' : '#c1121f', marginTop: 5 }}>
                    {release.integration === 'setup_required' ? '⚠ Integrarea GitHub nu este configurată' : '🔴 Integrarea GitHub nu poate fi citită'}
                  </div>
                  {release.setupInstructions && <div className="chat-hint" style={{ marginTop: 5 }}>{release.setupInstructions}</div>}
                </>
              ) : !release.pr ? (
                <div className="chat-hint" style={{ marginTop: 5 }}>Nu există încă un PR Constructor de urmărit.</div>
              ) : (
                <>
                  <div style={{ marginTop: 5 }}><b>PR:</b>{' '}<a href={release.pr.url} target="_blank" rel="noreferrer">{release.pr.title}</a></div>
                  <div className="chat-hint" style={{ marginTop: 4 }}>Verificări: {release.checks} · Review: {release.approval} · Merge: {release.merge}</div>
                  <div style={{ marginTop: 5 }}>{release.nextAction}</div>
                  {!release.pr.merged && release.pr.state === 'open' && release.pr.baseRef === 'master' && release.checks === 'passed' && release.approval === 'required' && (
                    <button className="ghost" type="button" disabled={releaseBusy} style={{ marginTop: 7 }} onClick={releaseAction}>
                      {releaseBusy ? 'Se procesează…' : 'Aprobă în Kelion'}
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </div>
        <section className="admin-constructor-engine" aria-labelledby="constructor-engine-title">
          <h3 id="constructor-engine-title">Motorul Constructorului</h3>
          {constructorModel === 'necitit' && <p className="chat-hint" role="status">{A.constructorModelLoading}</p>}
          {constructorModel === null && <p className="chat-hint constructor-model-error" role="alert">{A.constructorModelUnreadable}</p>}
          {constructorModelSnapshot && (
            <>
              <p><b>{constructorModelSnapshot.model?.label ?? 'Configurație neverificată'}</b>
                {constructorModelSnapshot.model && <> · {constructorModelSnapshot.model.id}</>}
              </p>
              <p className="chat-hint" role={constructorModelSnapshot.state === 'ready' ? 'status' : 'alert'}>
                {constructorModelSnapshot.state === 'ready'
                  ? 'Configurația și disponibilitatea motorului sunt verificate. Finalizarea unui ordin se dovedește separat, mai jos.'
                  : 'Motor indisponibil: nu există o verificare curentă reușită.'}
              </p>
              {constructorModelSnapshot.verifiedAt && <p className="chat-hint">
                {A.constructorModelVerifiedAt(new Date(constructorModelSnapshot.verifiedAt).toLocaleString())}
              </p>}
            </>
          )}
        </section>
        <form className="admin-form-row" onSubmit={(e) => { e.preventDefault(); sendBuildOrder() }}>
          <input value={buildOrder} onChange={(e) => setBuildOrder(e.target.value)} placeholder={A.buildOrderPlaceholder} disabled={buildSubmitBusy} style={{ flex: 1, minWidth: 0 }} />
          <button type="submit" className="ghost" disabled={buildSubmitBusy}>{buildSubmitBusy ? 'Se trimite…' : 'Trimite ordinul'}</button>
        </form>
        {buildMsg && <div className="chat-hint">{buildMsg}</div>}
        {evalOrdin && (
          <div className="eval-ordin">
            <div className={`eval-verdict ${evalOrdin.trece ? 'ok' : 'stop'}`}>{evalOrdin.trece ? '✓ ' : '✕ '}{evalOrdin.motiv}</div>
            {evalOrdin.capacitatiNecesare.length > 0 && (
              <div className="eval-caps">
                Cerință:{' '}
                {evalOrdin.capacitatiNecesare.map((c) => <span className="eval-cap" key={c}>{c}</span>)}
              </div>
            )}
            {evalOrdin.trece && evalOrdin.clasament.length > 0 && (
              <div className="eval-ai-lista">
                {evalOrdin.clasament.map((ai) => (
                  <div className={`eval-ai ${ai.cheie === evalOrdin.aiRecomandat ? 'recomandat' : ''}`} key={ai.cheie}>
                    <div className="eval-ai-text">
                      <div className="eval-ai-cap">
                        <strong>{ai.nume}</strong>
                        {ai.cheie === evalOrdin.aiRecomandat && <span className="eval-badge">recomandat</span>}
                        <span className="eval-potrivire">{ai.potrivire}</span>
                      </div>
                      <div className="eval-ai-desc">{ai.descriere}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {!dedicatedClient && <div className="admin-card" style={{ marginTop: 12 }}>
        <div className="admin-card-head">Agent specializat</div>
        <p className="chat-hint">Creează un agent prin același sistem A2A și aceeași sesiune admin, fără o consolă paralelă.</p>
        <form onSubmit={(event) => void addCustomAgent(event)}>
          <div className="admin-form-row" style={{ flexWrap: 'wrap' }}>
            <input value={agentName} onChange={(event) => setAgentName(event.target.value)} placeholder="Numele agentului" minLength={3} maxLength={80} required />
            <textarea value={agentRole} onChange={(event) => setAgentRole(event.target.value)} placeholder="Rolul și limitele agentului" minLength={10} maxLength={AGENT_CUSTOM_ROLE_MAX_LENGTH} required rows={3} style={{ flex: 1, minWidth: 240 }} />
          </div>
          <label className="chat-hint" style={{ display: 'block', marginTop: 8 }}>
            <input type="checkbox" checked={agentDeep} onChange={(event) => setAgentDeep(event.target.checked)} />{' '}
            Raționament aprofundat pentru sarcini complexe
          </label>
          <label className="chat-hint" style={{ display: 'block', marginTop: 6 }}>
            <input type="checkbox" checked={agentAdminOnly} onChange={(event) => setAgentAdminOnly(event.target.checked)} />{' '}
            Disponibil numai adminului
          </label>
          <button type="submit" className="ghost" disabled={agentBusy} style={{ marginTop: 10 }}>
            {agentBusy ? 'Se creează…' : 'Creează agentul'}
          </button>
        </form>
        {agentMsg && <div className="chat-hint" role="status">{agentMsg}</div>}
      </div>}

      <div className="admin-card" style={{ marginTop: 12 }}>
        <div className="admin-card-head admin-card-head-row">
          <span>Coada ordinelor</span>
          <span className="admin-card-actions">
            <button type="button" className="ghost" style={{ fontSize: 12 }}
              onClick={() => { const next = !archiveOpen; setArchiveOpen(next); if (next) loadBuildArchive() }}>
              {archiveOpen ? 'Închide arhiva' : 'Arhivă'}
            </button>
            {buildJobsData?.some((j) => j.status === 'failed' || j.status === 'done' || j.status === 'cancelled') && (
              <button type="button" className="ghost" style={{ fontSize: 12 }} onClick={cleanBuildOrders} title="Arhivează recuperabil numai rândurile terminale vizibile în snapshotul curent">
                Curăță rândurile vizibile
              </button>
            )}
          </span>
        </div>

        {archiveOpen && (
          <div className="admin-archive-box">
            <b style={{ fontSize: 12 }}>Arhivă recuperabilă</b>
            {(buildArchive.status === 'idle' || (buildArchive.status === 'loading' && buildArchive.jobs.length === 0)) ? (
              <div className="chat-hint">Se încarcă arhiva…</div>
            ) : buildArchive.status === 'error' ? (
              <div className="chat-hint">Arhiva nu poate fi citită acum.</div>
            ) : buildArchive.jobs.length === 0 ? (
              <div className="chat-hint">Arhiva este goală.</div>
            ) : buildArchive.jobs.map((job) => (
              <div className="admin-list-row" key={`archived-${job.id}`} style={{ fontSize: 12 }}>
                <span>#{job.id} · {job.status} · {job.orderText.slice(0, 90)}</span>
                <button type="button" className="ghost" disabled={pendingBuildMutations.has(job.id)} onClick={() => restoreBuildOrder(job)}>Restaurează</button>
              </div>
            ))}
            {buildArchive.nextCursor && (
              <button type="button" className="ghost" disabled={buildArchive.status === 'loading'} onClick={() => loadBuildArchive(buildArchive.nextCursor, true)}>
                {buildArchive.status === 'loading' ? 'Se încarcă…' : 'Mai vechi'}
              </button>
            )}
            {buildArchive.appendError && <div className="chat-hint">Pagina următoare nu a putut fi citită; rândurile deja încărcate au fost păstrate.</div>}
          </div>
        )}

        {buildJobs === 'necitit' && <div className="chat-hint">{A.loading}</div>}
        {buildJobs === null && <div className="chat-hint" style={{ color: '#e6a23c' }}>⚠ Nu am putut citi coada — citire eșuată, nu coadă goală (reîncerc la 10s).</div>}
        {buildJobsData && buildJobsData.length === 0 && <div className="chat-hint">{A.noOrdersYet}</div>}
        {(buildJobsData ?? []).map((j) => (
          <div className="admin-list-row" key={j.id} style={{ flexWrap: 'wrap' }}>
            <span>
              <strong>#{j.id}</strong>{' '}
              <span className={`vis-badge ${constructorHasVerifiedLiveResult(j.status, j.continuity) ? 'human' : ['done', 'failed'].includes(j.status) ? 'kind-demo' : ''}`}>
                {j.status === 'queued' ? 'în coadă'
                  : j.status === 'running' ? 'lucrează…'
                  : j.status === 'done' ? (constructorHasVerifiedLiveResult(j.status, j.continuity) ? 'live și verificat' : 'terminat fără dovadă live')
                  : j.status === 'cancelled' ? 'anulat'
                  : 'eșuat'}
              </span>{' '}
              {j.nume || j.orderText.slice(0, 90)}{(j.nume ?? j.orderText).length > 90 ? '…' : ''}
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              {j.prUrl && <a href={j.prUrl} target="_blank" rel="noreferrer">PR ↗</a>}
              {j.tokens > 0 && <span>{`· ${Math.round(j.tokens / 1000)}k tok`}</span>}
              <span style={{ opacity: 0.7 }}>· {new Date(j.updatedAt).toLocaleString('ro-RO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
              {j.retryable && <button type="button" className="ghost" style={{ fontSize: 12 }} onClick={() => retryBuildOrder(j)} disabled={pendingBuildMutations.has(j.id)} title="Repune ordinul în coadă (îl reia de la zero)">↻ reia</button>}
              {j.deletable && <button type="button" className="ghost" style={{ fontSize: 12, color: '#ff7a7a' }} onClick={() => deleteBuildOrder(j)} disabled={pendingBuildMutations.has(j.id)} title="Șterge definitiv ordinul">✕</button>}
              {constructorJobCanBeCancelled(j.status, j.constructorStage) && <button type="button" className="ghost" style={{ fontSize: 12, color: '#ff7a7a' }} onClick={() => cancelBuildOrder(j)} disabled={pendingBuildMutations.has(j.id)} title={j.status === 'queued' ? 'Anulează ordinul aflat în coadă' : 'Oprește ordinul aflat în lucru (devine „anulat")'}>⏹ oprește</button>}
            </span>
            <ConstructorJobProgress job={j} />
            {j.continuity && (
              <div className="chat-hint" style={{ flexBasis: '100%', fontSize: 11, marginTop: 2 }}>
                <b>{j.continuity.state === 'completed' ? '✓ Dovadă live' : j.continuity.state === 'cancelled' ? 'Cerere anulată' : `Checkpoint: ${j.continuity.checkpoint}`}</b>
                {' · '}{j.continuity.message}
                {j.continuity.finalProof.complete && j.continuity.finalProof.liveVersion ? ` · versiune live ${j.continuity.finalProof.liveVersion}` : ''}
                {j.continuity.nextAction && <><br />Acțiune necesară: {j.continuity.nextAction}</>}
              </div>
            )}
            {j.continuity?.modelOutcome && (() => {
              const outcome = j.continuity.modelOutcome
              const profileText = 'profilul rularii'
              if (outcome.result === 'technical_failure') {
                return (
                  <div className="constructor-outcome technical" role="alert">
                    <b>{A.constructorOutcomeTechnicalFailure(profileText)}</b>
                    <div>{A.constructorOutcomeReason(outcome.reason)}</div>
                    <div>{A.constructorOutcomeTechnicalNoModelAdvice}</div>
                  </div>
                )
              }
              return (
                <div className="constructor-outcome unresolved">
                  <b>{A.constructorOutcomeUnresolved(profileText)}</b>
                  <div>{A.constructorOutcomeReason(outcome.reason)}</div>
                  <div>{A.constructorOutcomeNoOtherModel}</div>
                </div>
              )
            })()}
            {j.workCard && (
              <details id={`constructor-work-card-${j.id}`} className="build-progress" style={{ flexBasis: '100%', marginTop: 8 }}>
                <summary>
                  <b>Fișa canonică {j.workCard.id}</b>
                  {' · '}{j.workCard.progress.source === 'unavailable' ? 'cronologie necitibilă' : j.workCard.currentStep ?? 'pas nepublicat'}
                </summary>
                <div className="chat-hint" style={{ marginTop: 6 }}>
                  <b>Obiectiv:</b> {j.workCard.objective}<br />
                  <b>Owner / actor:</b> {j.workCard.owner ?? 'neatribuit'} / {constructorActorLabel(j.workCard.actor) ?? 'în așteptare'}<br />
                  <b>Heartbeat:</b> {j.workCard.heartbeatAt ? new Date(j.workCard.heartbeatAt).toLocaleString('ro-RO') : 'nepublicat'}{' · '}
                  <b>Evenimente persistente:</b> {constructorPersistentEventsText(j.workCard.progress, j.workCard.evidence.eventCount)}
                  {j.workCard.escalationCondition && <><br /><b>Escaladare:</b> {j.workCard.escalationCondition}</>}
                  {constructorFinalResultText(j.workCard.finalResult) && <><br /><b>Rezultat:</b> {constructorFinalResultText(j.workCard.finalResult)}</>}
                </div>
                {j.workCard.progress.source === 'unavailable' && <div className="chat-hint" style={{ color: '#c1121f', marginTop: 6 }}>⚠ Cronologia persistentă nu poate fi citită; lipsa evenimentelor din această fișă nu este un zero măsurat.</div>}
                {j.workCard.acceptanceCriteria.length > 0 && <ul className="chat-hint">{j.workCard.acceptanceCriteria.map((criterion) => <li key={criterion}>{criterion}</li>)}</ul>}
                {(j.continuity?.activity ?? []).length > 0 && (
                  <ol className="chat-hint" aria-label={`Cronologia ${j.workCard.id}`}>
                    {(j.continuity?.activity ?? []).map((event) => (
                      <li key={event.id}><b>{event.label}</b> · {event.percent === null ? 'progres nemăsurat' : `${event.percent}% din etape`} · {event.state}{event.at ? ` · ${new Date(event.at).toLocaleString('ro-RO')}` : ''}</li>
                    ))}
                  </ol>
                )}
                {j.workCard.contextLinks.some((link) => /^https?:\/\//.test(link)) && (
                  <div className="chat-hint">
                    {j.workCard.contextLinks.filter((link) => /^https?:\/\//.test(link)).map((link) => <a key={link} href={link} target="_blank" rel="noreferrer">Dovadă ↗</a>)}
                  </div>
                )}
              </details>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── CREIER tab ──────────────────────────────────────────────────────────────

export function AdminCreier() {
  const [creier, setCreierState] = useState<CreierAdmin | null | 'necitit'>('necitit')
  const [constructorWorker, setConstructorWorker] = useState<ConstructorWorkerAdmin | null | 'necitit'>('necitit')
  const [adminBilling, setAdminBilling] = useState<WalletStatus | null | 'necitit'>('necitit')

  useEffect(() => {
    setCreierState('necitit')
    void fetchCreier().then(setCreierState)
    setConstructorWorker('necitit')
    void fetchConstructorWorkerAdmin().then(setConstructorWorker)
    void fetchBalance().then(setAdminBilling)
  }, [])

  useEffect(() => {
    const id = window.setInterval(() => { void fetchConstructorWorkerAdmin().then(setConstructorWorker) }, 15_000)
    return () => window.clearInterval(id)
  }, [])

  const adminKelionCost =
    adminBilling !== 'necitit' && adminBilling !== null &&
    adminBilling.scutit === true && adminBilling.debitMinor === 0 &&
    adminBilling.creditsUsed === 0 && typeof adminBilling.minorUnit === 'number'
      ? formatMinorMoney(adminBilling.debitMinor, adminBilling.currency, adminBilling.minorUnit, 'ro-RO')
      : null
  const adminCreditsUsed =
    adminKelionCost && adminBilling !== 'necitit' && adminBilling !== null &&
    typeof adminBilling.creditsUsed === 'number'
      ? adminBilling.creditsUsed
      : null

  return (
    <div className="admin-tab-content">
      <div className="admin-card">
        <div className="admin-card-head">Creier conversațional și Constructor</div>
        <div className="admin-subcard">
          <div className="admin-subcard-title">Constructor — executor separat</div>
          {constructorWorker === 'necitit' && <p className="chat-hint">Se citește configurația…</p>}
          {constructorWorker === null && (
            <p className="chat-hint" style={{ color: '#e6a23c' }}>
              ⚠ Constructor: setup_required. Starea workerului local nu poate fi verificată; această pagină nu execută procese și nu afișează secrete.
            </p>
          )}
          {typeof constructorWorker === 'object' && constructorWorker !== null && (
            <>
              <p className="chat-hint">
                Worker: <b>
                  {constructorWorker.worker.state === 'ready' ? 'pregătit'
                  : constructorWorker.worker.state === 'busy' ? 'ocupat'
                  : constructorWorker.worker.state === 'offline' ? 'offline'
                  : constructorWorker.worker.state === 'setup_required' ? 'necesită configurare'
                  : constructorWorker.worker.state === 'degraded' ? 'degradat'
                  : 'stare necunoscută'}
                </b>.{constructorWorker.status ? ` ${constructorWorker.status}` : ''}
              </p>
              <p className="chat-hint">
                Executor: <b>{constructorWorker.executor ?? 'executor neverificat'}</b> · coadă: <b>{constructorWorker.queue ?? 'build_jobs'}</b>.<br />
                Ultimul heartbeat: {constructorWorker.worker.lastHeartbeat ? new Date(constructorWorker.worker.lastHeartbeat).toLocaleString('ro-RO') : 'neînregistrat'}
              </p>
              {(constructorWorker.worker.state === 'setup_required' || constructorWorker.worker.state === 'unknown') && (
                <p className="chat-hint">
                  {constructorWorker.setupInstructions ?? 'Verifică preflightul motorului configurat și autentificarea HMAC a cozii build_jobs.'}
                </p>
              )}
              {constructorWorker.worker.state === 'offline' && <p className="chat-hint">Workerul nu răspunde. Verifică diagnosticul executorului și disponibilitatea motorului configurat.</p>}
              {constructorWorker.worker.state === 'degraded' && (
                <p className="chat-hint" style={{ color: '#8a6d1a' }}>Workerul răspunde, dar a raportat o stare degradată. Cauza afișată mai sus trebuie rezolvată înainte ca panoul să-l considere pregătit.</p>
              )}
              <p className="chat-hint" style={{ marginTop: 8 }}>
                {adminKelionCost && adminCreditsUsed !== null
                  ? <><b>Cost Kelion admin: {adminKelionCost} · {adminCreditsUsed.toLocaleString('ro-RO')} credite consumate</b>.</>
                  : <><b>Starea debitului Kelion pentru admin nu poate fi verificată.</b></>}
              </p>
              <p className="chat-hint" style={{ marginTop: 8 }}>
                Executorul separat OpenCode execută exclusiv ordinele validate din build_jobs; browserul doar scrie în coadă și citește starea autorizată.
              </p>
            </>
          )}
        </div>

        {creier === 'necitit' && <p className="chat-hint">Se încarcă modelele…</p>}
        {creier === null && <p className="chat-hint">Nu s-a putut citi configurația OpenAI.</p>}
        {typeof creier === 'object' && creier !== null && (() => {
          const modele = creier.modele
          return (
            <>
              <p className="chat-hint">Provider: <b>OpenAI</b> · selecție automată</p>
              {creier.catalogEroare && <p className="chat-hint" style={{ marginTop: 8 }}>Catalog OpenAI: {creier.catalogEroare}</p>}
              <div className="chat-hint" style={{ marginTop: 12 }}>
                Trepte configurate de server:{' '}
                {modele.filter((model) => !model.isAuto).map((model) => `${model.validat ? '✓' : '⚠'} ${model.nume}`).join(' → ')}.
                Configurația este read-only în browser.
              </div>
            </>
          )
        })()}
      </div>
    </div>
  )
}
