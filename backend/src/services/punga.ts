// ── THE SINGLE POCKET, IN ONE CURRENCY ──────────────────────────────────────
//
// Adrian, with live evidence: the header said "OpenRouter $9.99" while the
// Money tab said "Punga: £7.99" — the SAME wallet, two different figures.
// The cause: the finance route converted the OpenRouter balance (measured in
// USD) into the billing display currency (£) with the flat USD_TO_CURRENCY
// rate. A converted figure is not a measured one — the rate is hand-written,
// not read from anywhere — and it contradicted the very same number shown one
// centimeter to the left.
//
// The rule from here on: the pocket is counted ONLY in USD, exactly as the
// provider measures it. No conversion. What the header shows and what the
// Money tab shows is the same number, because it comes from the same reading.

export interface Punga {
  /** Sum of the parts that ANSWERED (USD). With a single part it is that part. */
  total: number
  /** false = a source did not answer — the total is incomplete, not "zero". */
  complete: boolean
  parti: {
    /** The REAL OpenRouter balance, in USD, as measured. null = unreadable. */
    openrouter: number | null
  }
  currency: 'usd'
}

export function calcPunga(openrouterUsd: number | null): Punga {
  return {
    total: Math.round((openrouterUsd ?? 0) * 100) / 100,
    complete: openrouterUsd !== null,
    parti: { openrouter: openrouterUsd },
    currency: 'usd',
  }
}
