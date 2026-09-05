import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('./lib/errorReport', () => ({ marcheazaPlecarea:vi.fn() }))
import { watchForPwaUpdate, type ApplyPwaUpdate } from './lib/updateCheck'

let windowEvents: EventTarget
let documentEvents: EventTarget & { visibilityState:string }
let service: EventTarget & { controller: object; getRegistration:ReturnType<typeof vi.fn> }
let registration: EventTarget & { waiting:EventTarget | null; installing:EventTarget | null; update:ReturnType<typeof vi.fn> }
let waiting: EventTarget & { postMessage:ReturnType<typeof vi.fn> }
let reload: ReturnType<typeof vi.fn>
let navigatorValue: { serviceWorker:typeof service; onLine:boolean }
let stop: (() => void) | undefined
beforeEach(() => {
  vi.useFakeTimers()
  windowEvents=new EventTarget();documentEvents=Object.assign(new EventTarget(),{ visibilityState:'visible' })
  waiting=Object.assign(new EventTarget(),{ postMessage:vi.fn() })
  registration=Object.assign(new EventTarget(),{ waiting:waiting as EventTarget | null,installing:null as EventTarget | null,update:vi.fn(async () => registration) })
  service=Object.assign(new EventTarget(),{ controller:{},getRegistration:vi.fn(async () => registration) })
  reload=vi.fn();navigatorValue={ serviceWorker:service,onLine:true }
  vi.stubGlobal('navigator',navigatorValue);vi.stubGlobal('document',documentEvents)
  vi.stubGlobal('window',{ setInterval,clearInterval,location:{ reload },
    addEventListener:windowEvents.addEventListener.bind(windowEvents),removeEventListener:windowEvents.removeEventListener.bind(windowEvents) })
})
afterEach(() => { stop?.();stop=undefined;vi.unstubAllGlobals();vi.useRealTimers() })
const settle = async () => { await Promise.resolve();await Promise.resolve();await Promise.resolve() }

describe('standard PWA checks never interrupt the current tab without its own user action', () => {
  it('checks periodically and on network/visibility return, while preserving explicit activation', async () => {
    const offers: ApplyPwaUpdate[]=[]
    stop=watchForPwaUpdate((apply) => offers.push(apply));await settle()
    expect(registration.update).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(registration.update).toHaveBeenCalledTimes(2)
    navigatorValue.onLine=false;await vi.advanceTimersByTimeAsync(60_000)
    expect(registration.update).toHaveBeenCalledTimes(2)
    navigatorValue.onLine=true;windowEvents.dispatchEvent(new Event('online'));await settle()
    expect(registration.update).toHaveBeenCalledTimes(3)
    documentEvents.visibilityState='hidden';await vi.advanceTimersByTimeAsync(60_000)
    expect(registration.update).toHaveBeenCalledTimes(3)
    documentEvents.visibilityState='visible';documentEvents.dispatchEvent(new Event('visibilitychange'));await settle()
    expect(registration.update).toHaveBeenCalledTimes(4)
    service.dispatchEvent(new Event('controllerchange'))
    expect(reload).not.toHaveBeenCalled();expect(waiting.postMessage).not.toHaveBeenCalled()
    offers.at(-1)!()
    expect(waiting.postMessage).toHaveBeenCalledExactlyOnceWith('kelion-activate-update')
    service.dispatchEvent(new Event('controllerchange'));service.dispatchEvent(new Event('controllerchange'))
    expect(reload).toHaveBeenCalledTimes(1)
  })
  it('another tab activating a waiting worker cannot reload this chat until this user clicks', async () => {
    let apply: ApplyPwaUpdate | undefined
    stop=watchForPwaUpdate((action) => { apply=action });await settle()
    registration.waiting=null
    service.dispatchEvent(new Event('controllerchange'))
    expect(reload).not.toHaveBeenCalled()
    apply!()
    expect(reload).toHaveBeenCalledTimes(1)
    expect(waiting.postMessage).not.toHaveBeenCalled()
  })
  it('cleans up timers/listeners and does not announce a nonexistent waiting worker', async () => {
    registration.waiting=null
    const onWaiting=vi.fn()
    stop=watchForPwaUpdate(onWaiting);await settle()
    expect(onWaiting).not.toHaveBeenCalled()
    stop();stop=undefined
    await vi.advanceTimersByTimeAsync(120_000)
    windowEvents.dispatchEvent(new Event('online'));service.dispatchEvent(new Event('controllerchange'))
    expect(registration.update).toHaveBeenCalledTimes(1);expect(reload).not.toHaveBeenCalled()
  })
  it('discovers a registration created after the initial React effect instead of permanently missing updates', async () => {
    service.getRegistration.mockResolvedValueOnce(undefined)
    const onWaiting=vi.fn()
    stop=watchForPwaUpdate(onWaiting);await settle()
    expect(registration.update).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(service.getRegistration).toHaveBeenCalledTimes(2)
    expect(registration.update).toHaveBeenCalledTimes(1)
    expect(onWaiting).toHaveBeenCalled()
  })
  it('does not attach or update if registration discovery finishes after unmount', async () => {
    let finish: ((value:typeof registration) => void) | undefined
    service.getRegistration.mockImplementationOnce(() => new Promise((resolve) => { finish=resolve }))
    const onWaiting=vi.fn()
    stop=watchForPwaUpdate(onWaiting);await settle()
    stop();stop=undefined;finish!(registration);await settle()
    expect(registration.update).not.toHaveBeenCalled()
    expect(onWaiting).not.toHaveBeenCalled()
  })
})
