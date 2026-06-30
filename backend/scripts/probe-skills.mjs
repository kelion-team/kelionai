// Skill smoke test — probes every non-Google Kelion skill end-to-end and prints
// pass/fail with real output, so we can verify the skills actually work instead
// of guessing.
//
//   node scripts/probe-skills.mjs                 # uses backend/.env keys
//   railway run node scripts/probe-skills.mjs     # uses PRODUCTION keys
//
// (Run from the backend/ directory, after `npm run build`.) Google skills —
// Calendar, Gmail, Drive, Tasks, Contacts — need a per-user OAuth token and are
// not covered here.

process.env.GOOGLE_CLIENT_ID ||= 'probe'
process.env.GOOGLE_CLIENT_SECRET ||= 'probe'
process.env.GOOGLE_REDIRECT_URI ||= 'http://localhost'
process.env.SESSION_SECRET ||= 'probe'

const { runGoogleTool } = await import('../dist/services/google.js')

const tests = [
  ['get_weather', { location: 'London' }],
  ['maps_search', { query: 'Eiffel Tower', max_results: 1 }],
  ['maps_directions', { origin: 'Oxford', destination: 'London' }],
  ['web_search', { query: 'latest technology news', max_results: 2 }],
  ['youtube_search', { query: 'lofi beats', max_results: 1 }],
  ['translate_text', { text: 'good morning', target: 'Romanian' }],
  ['wikipedia_lookup', { query: 'Witney' }],
  ['convert_currency', { amount: 100, from: 'USD', to: 'EUR' }],
  ['get_time', { timezone: 'Europe/Bucharest' }],
]

let fails = 0
for (const [name, input] of tests) {
  const t0 = Date.now()
  try {
    const out = await runGoogleTool(name, input, '')
    let o
    try {
      o = JSON.parse(out)
    } catch {
      o = { raw: out }
    }
    const ms = Date.now() - t0
    if (o.error) {
      fails++
      console.log(`FAIL  ${name} (${ms}ms): ${o.error}`)
    } else {
      console.log(`OK    ${name} (${ms}ms)`)
    }
  } catch (e) {
    fails++
    console.log(`THROW ${name}: ${e instanceof Error ? e.message : String(e)}`)
  }
}
console.log(`\n${tests.length - fails}/${tests.length} skills OK`)
process.exit(fails ? 1 : 0)
