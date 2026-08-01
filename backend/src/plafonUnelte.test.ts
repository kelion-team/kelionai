import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// ── THE PROVIDER'S 64-TOOL CEILING ───────────────────────────────────────────
// Aug 1, live incident: the chat route sent 76 tools to the provider →
// every turn died with `400: at most 64 tools are allowed` and the user saw
// only "Am întâmpinat o problemă tehnică". The fix is structural: the list is
// deduped by name (open_app_view was registered TWICE), the self-proposed
// dynamic tools fill only the slots left, and the base itself is trimmed
// under the ceiling with a loud log. This guard makes sure the ceiling can
// never silently disappear again.
const chat = readFileSync(
  fileURLToPath(new URL('./routes/chat.ts', import.meta.url)),
  'utf8',
)

describe('plafonul de 64 de unelte al furnizorului e garantat structural', () => {
  it('există o constantă de plafon și e folosită la trimitere', () => {
    expect(chat).toMatch(/MAX_PROVIDER_TOOLS = 64/)
    expect(chat).toMatch(/baseTools\.slice\(0, MAX_PROVIDER_TOOLS\)/)
  })

  it('lista e deduplicată pe NUME înainte de trimitere', () => {
    expect(chat).toMatch(/seenNames\.has\(t\.name\)/)
  })

  it('uneltele dinamice umplu DOAR sloturile rămase sub plafon', () => {
    expect(chat).toMatch(/for \(const t of dynTools\)[\s\S]*?tools\.length >= MAX_PROVIDER_TOOLS[\s\S]*?break/)
  })
})
