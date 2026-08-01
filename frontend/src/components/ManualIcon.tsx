// ── PICTOGRAMELE MANUALULUI ─────────────────────────────────────────────────
// Adrian, Jul 30: "the manual is extremely rudimentary... the level is
// kindergarten." He was right: it was black text on white, with no visual landmark.
//
// Drawn in code (SVG), not images: they scale perfectly, take the surrounding
// color, add no network request and cannot break on a deploy. A book is read
// with the eyes — if every chapter looks identical, you remember nothing.
import React from 'react'

const cai: Record<string, React.JSX.Element> = {
  google: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </>
  ),
  vedere: (
    <>
      <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z" />
      <circle cx="12" cy="12" r="2.6" />
    </>
  ),
  afisare: (
    <>
      <rect x="2.5" y="4" width="19" height="13" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </>
  ),
  memorie: (
    <>
      <path d="M5 4h11l3 3v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" />
      <path d="M8 9h7M8 13h7M8 17h4" />
    </>
  ),
  browser: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 9.5h18M3 14.5h18M12 3c2.4 2.6 3.6 5.6 3.6 9s-1.2 6.4-3.6 9c-2.4-2.6-3.6-5.6-3.6-9S9.6 5.6 12 3z" />
    </>
  ),
  cod: (
    <>
      <path d="M12 3a6 6 0 0 0-6 6c0 1.9 1 3.3 1.8 4.3.6.8 1.2 1.5 1.2 2.7v1h6v-1c0-1.2.6-1.9 1.2-2.7C17 12.3 18 10.9 18 9a6 6 0 0 0-6-6z" />
      <path d="M10 20h4" />
    </>
  ),
  diverse: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v5M12 16.2v.1" />
    </>
  ),
}

export default function ManualIcon({ k, size = 22 }: { k: string; size?: number }): React.JSX.Element {
  return (
    <svg
      className="manual-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {cai[k] ?? cai.diverse}
    </svg>
  )
}
