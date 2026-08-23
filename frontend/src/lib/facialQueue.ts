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

// ── EMOȚIE PERSISTENTĂ (owner, 23 aug 2026: „dacă se vede pe fața lui
//    satisfacție, tristețe, bucurie") — stratul de BAZĂ al feței.
//    Spre deosebire de pushFacial (micro-expresie de 2.45s), emoția
//    persistentă STA pe față cât timp emoția e activă. Când se schimbă,
//    fața trece smooth la noua expresie.
//    AvatarModel aplică stratul ăsta pe fiecare frame, DEDesubTUL
//    micro-expresiilor (care se adaugă temporar deasupra).
let emotiePersistentaCurenta: FacialLabel | null = null

export function setEmotiePersistenta(label: FacialLabel | null): void {
  if (label !== null && !VALID_FACIAL.has(label)) return
  emotiePersistentaCurenta = label
  bus.dispatchEvent(new CustomEvent('emotie-persistenta', { detail: { label } }))
}

export function getEmotiePersistenta(): FacialLabel | null {
  return emotiePersistentaCurenta
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

// Subscribe la emoția persistentă (stratul de bază al feței).
export function useEmotiePersistenta(callback: (label: FacialLabel | null) => void): void {
  const cbRef = useRef(callback)
  cbRef.current = callback
  useEffect(() => {
    const handler = (e: Event): void => {
      const detail = (e as CustomEvent).detail as { label: FacialLabel | null } | undefined
      cbRef.current(detail?.label ?? null)
    }
    bus.addEventListener('emotie-persistenta', handler)
    // Livrează și starea curentă la abonare (ca să prindă emoția de la pornire)
    cbRef.current(emotiePersistentaCurenta)
    return () => bus.removeEventListener('emotie-persistenta', handler)
  }, [])
}
