import { activityForJob, type MonitorConnection } from '../../lib/constructorMonitorView'
import { formatLondonTimestamp } from '../../lib/versionEvidence'
const labels:Record<string,string> = {
  waiting:'În așteptare',executing:'Execuție raportată',worker_stopped:'Worker oprit',process_missing:'Proces dispărut',
  heartbeat_stale:'Semnal expirat',stage_stall:'Etapă fără avans confirmat',terminal_failure:'Eroare terminală',
  intentional_pause:'Pauză intenționată',deploy_gate:'Publicare în curs',completed:'Dovadă de release prezentă',
  cancelled:'Anulat',unverified:'Stare neverificată',
}
function When({value}:{value:string|null}) {
  return value ? <time dateTime={value} title={value}>{formatLondonTimestamp(value) ?? 'moment neconfirmat'}</time> : <>nedisponibilă</>
}
export function ConstructorJobActivity({jobId,cycle,status,connection}:{jobId:number;cycle:number|undefined;status:string;connection:MonitorConnection}) {
  const {active,pipelineActive,externalActive,current,external,fresh}=activityForJob(connection,jobId,cycle,status)
  return <section aria-label={'Supravegherea ordinului '+jobId} aria-live="polite" style={{flexBasis:'100%',fontSize:13,marginTop:6}}>
    <strong>
      {active && <span role="img" aria-label={'Activitate recentă verificată pentru ordinul '+jobId} title={externalActive ? 'Remediere externă corelată, nu progres artificial al ordinului' : 'Activitate a executorului verificată'}>⌛ </span>}
      {active ? (externalActive ? 'Remediere în lucru pentru acest ordin' : 'Activitate recentă a executorului') : 'Fără activitate curentă confirmată'}
    </strong>
    {!fresh && <div>Citire indisponibilă sau expirată; detaliile păstrate mai jos sunt istorice.</div>}
    <div>Ultima verificare reușită a monitorului VPS: <When value={connection.snapshot?.lastSuccessfulCheck ?? null} />.</div>
    {connection.snapshot?.error && <div>Monitor indisponibil: {connection.snapshot.error}.</div>}
    {current ? <div>Pipeline: {labels[current.code] ?? current.code}. Responsabil: {current.responsible}.
      {' '}Verificat: <When value={current.checkedAt} />. Următorul pas: {current.nextAction}</div>
      : <div>Starea verificată pentru ciclul curent nu este disponibilă.</div>}
    {external && <details open={externalActive || external.state==='blocked'}>
      <summary>Remediere externă · {externalActive ? 'activitate recentă' : external.state==='blocked' ? 'blocată' : external.state==='completed' ? 'remediere externă încheiată, nu ordin finalizat' : 'activitate neconfirmată acum'}</summary>
      <div>Coordonator: {external.coordinator}. Execuție: {external.executionId}.</div>
      <div>{external.summary}</div><div>Următorul pas: {external.nextAction}</div>
      <div>Ultima dovadă: <When value={external.lastEvidenceAt} />.</div>
      {external.evidenceDigest && <div style={{overflowWrap:'anywhere'}}>Sursă: {external.sourceRef}. SHA-256: <code>{external.evidenceDigest}</code>.</div>}
    </details>}
    {(active || external) && <div>Activitatea și procentul sunt distincte. {pipelineActive ? 'Executorul are o dovadă recentă.' : 'Nu declarăm pipelineul în execuție.'} Bara crește numai la etape confirmate.</div>}
  </section>
}
