/** Pure public response formatting. No configuration, I/O, authentication or
 * release activation logic belongs in this repairable module. */
export function publicHealthPayload(): { status: string } {
  return { status:'ok' }
}

export function publicVersionPayload(version: string, bootAt: string): { v: string; at: string; ver: string } {
  return { v:version,at:bootAt,ver:version }
}
