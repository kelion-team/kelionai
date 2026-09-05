import { useEffect, useRef, useState } from 'react'
import { apiFetch } from './transport'
import { parseMonitorView, type MonitorConnection, type MonitorView } from './constructorMonitorView'

/** One read loop per panel. Browser time never creates a server activity event. */
export function useConstructorMonitor(): MonitorConnection {
  const [observation,setObservation] = useState<{snapshot:MonitorView|null;connected:boolean;receivedAt:number;roundTripMs:number}>(
    {snapshot:null,connected:false,receivedAt:0,roundTripMs:0})
  const [,redraw] = useState(0)
  const lastServedAt = useRef<number>(-Infinity)
  useEffect(() => {
    let generation=0, controller:AbortController|null=null, stopped=false
    const disconnect=() => setObservation(old => ({...old,connected:false}))
    async function refresh() {
      controller?.abort()
      const current=++generation
      if (!navigator.onLine) { disconnect(); return }
      controller=new AbortController()
      const signal=controller.signal, started=performance.now()
      const timeout=window.setTimeout(() => controller?.signal === signal && controller.abort(),8_000)
      try {
        const response=await apiFetch('/api/admin/constructor/monitor',{credentials:'include',cache:'no-store',signal})
        const snapshot=response.ok ? parseMonitorView(await response.json()) : null
        if (stopped || generation!==current) return
        if (!snapshot || Date.parse(snapshot.servedAt)<=lastServedAt.current || !navigator.onLine) { disconnect(); return }
        lastServedAt.current=Date.parse(snapshot.servedAt)
        const receivedAt=performance.now()
        setObservation({snapshot,connected:true,receivedAt,roundTripMs:receivedAt-started})
      } catch { if (!stopped && generation===current) disconnect() }
      finally { window.clearTimeout(timeout) }
    }
    const offline=() => { generation++; controller?.abort(); disconnect() }
    const online=() => { void refresh() }
    const visible=() => { if (document.visibilityState==='visible') void refresh() }
    void refresh()
    const poll=window.setInterval(() => { void refresh() },10_000)
    window.addEventListener('offline',offline); window.addEventListener('online',online)
    document.addEventListener('visibilitychange',visible)
    return () => { stopped=true;generation++;controller?.abort();window.clearInterval(poll)
      window.removeEventListener('offline',offline);window.removeEventListener('online',online)
      document.removeEventListener('visibilitychange',visible) }
  },[])
  // Re-render at expiry, not a cosmetic once-per-second progress animation.
  useEffect(() => {
    if (!observation.connected || !observation.snapshot) return
    const snapshot=observation.snapshot, served=Date.parse(snapshot.servedAt)
    const elapsed=performance.now()-observation.receivedAt+observation.roundTripMs
    const deadlines=[20_000,...snapshot.cases.map(c => c.activeExecutionUntil ? Date.parse(c.activeExecutionUntil)-served : 0),
      ...snapshot.externalRemediations.map(c => c.activeUntil ? Date.parse(c.activeUntil)-served : 0)]
      .filter(ms => ms>elapsed)
    if (!deadlines.length) return
    const timeout=window.setTimeout(() => redraw(value => value+1),Math.min(...deadlines)-elapsed+1)
    return () => window.clearTimeout(timeout)
  })
  return {snapshot:observation.snapshot,connected:observation.connected,
    elapsedMs:performance.now()-observation.receivedAt+observation.roundTripMs}
}
