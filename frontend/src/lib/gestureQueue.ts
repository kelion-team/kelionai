import { useEffect, useRef } from 'react'

// Labels Kelion's brain can send to make the avatar perform a one-time gesture.
// Each gesture blends in over the procedural v2 idle animation, holds briefly,
// then blends back so breathing and lip-sync stay alive.
export type GestureLabel = 'raiseRightHand' | 'salute' | 'pointMonitor'

const VALID_GESTURES = new Set<GestureLabel>(['raiseRightHand', 'salute', 'pointMonitor'])

const bus = new EventTarget()
let nextId = 0

export function pushGesture(label: GestureLabel): void {
  if (!VALID_GESTURES.has(label)) return
  nextId++
  bus.dispatchEvent(new CustomEvent('gesture', { detail: { id: nextId, label } }))
}

export function isGestureLabel(value: unknown): value is GestureLabel {
  return typeof value === 'string' && VALID_GESTURES.has(value as GestureLabel)
}

// Subscribe from a React component (AvatarModel) without causing re-renders.
export function useGestureQueue(callback: (label: GestureLabel) => void): void {
  const cbRef = useRef(callback)
  cbRef.current = callback
  useEffect(() => {
    const handler = (e: Event): void => {
      const detail = (e as CustomEvent).detail as { label?: GestureLabel } | undefined
      if (detail?.label) cbRef.current(detail.label)
    }
    bus.addEventListener('gesture', handler)
    return () => bus.removeEventListener('gesture', handler)
  }, [])
}
