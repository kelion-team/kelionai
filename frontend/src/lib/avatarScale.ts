// Persistent avatar 3D scale. The owner can resize the avatar in edit mode
// (double-click the avatar in PiP mode, then scroll); the actual model scale
// is stored here so it survives reloads and deploys instead of snapping back
// to the hard-coded default.

import { useEffect, useState } from 'react'

export const DEFAULT_AVATAR_SCALE = 1.65
const STORAGE_KEY = 'kelion-avatar-scale'
const CHANGE_EVENT = 'kelion:avatar-scale-changed'

export function getAvatarScale(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_AVATAR_SCALE
    const n = Number(raw)
    return Number.isFinite(n) && n > 0 ? Math.round(n * 1000) / 1000 : DEFAULT_AVATAR_SCALE
  } catch {
    return DEFAULT_AVATAR_SCALE
  }
}

export function setAvatarScale(scale: number): void {
  const clamped = Math.max(0.3, Math.min(5, Math.round(scale * 1000) / 1000))
  try {
    localStorage.setItem(STORAGE_KEY, String(clamped))
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: clamped }))
}

export function useAvatarScale(): [number, (scale: number) => void] {
  const [scale, setScaleState] = useState(getAvatarScale)

  useEffect(() => {
    const handler = (e: Event): void => {
      const d = (e as CustomEvent).detail
      if (typeof d === 'number' && Number.isFinite(d)) {
        setScaleState(d)
      } else {
        setScaleState(getAvatarScale())
      }
    }
    window.addEventListener(CHANGE_EVENT, handler)
    return () => window.removeEventListener(CHANGE_EVENT, handler)
  }, [])

  const setScale = (value: number): void => {
    setAvatarScale(value)
  }

  return [scale, setScale]
}
