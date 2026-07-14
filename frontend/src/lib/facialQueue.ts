import { useEffect, useRef } from 'react'

// Facial expressions Kelion's brain (or the local context parser) can trigger.
// All expressions are subtle, brief, and additive over the neutral face — they
// never replace blink or lip-sync, only modulate brows/eyes/mouth gently.
export type FacialLabel =
  | 'smile'       // warm, closed-mouth gentleman smile
  | 'raisedBrow'  // curiosity / "oh?"
  | 'surprise'    // slight widened eyes + jaw drop
  | 'think'       // pressed lips, slight brow knit
  | 'empathy'     // soft downturn + inner brow raise
  | 'warmth'      // slight smile + relaxed cheek squint

const VALID_FACIAL = new Set<FacialLabel>([
  'smile',
  'raisedBrow',
  'surprise',
  'think',
  'empathy',
  'warmth',
])

const bus = new EventTarget()
let nextId = 0

export function pushFacial(label: FacialLabel): void {
  if (!VALID_FACIAL.has(label)) return
  nextId++
  bus.dispatchEvent(new CustomEvent('facial', { detail: { id: nextId, label } }))
}

// Subscribe from a React component without causing re-renders.
export function useFacialQueue(callback: (label: FacialLabel) => void): void {
  const cbRef = useRef(callback)
  cbRef.current = callback
  useEffect(() => {
    const handler = (e: Event): void => {
      const detail = (e as CustomEvent).detail as { label?: FacialLabel } | undefined
      if (detail?.label) cbRef.current(detail.label)
    }
    bus.addEventListener('facial', handler)
    return () => bus.removeEventListener('facial', handler)
  }, [])
}
