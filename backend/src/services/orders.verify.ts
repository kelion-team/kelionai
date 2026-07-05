// Test izolat pentru logica PURĂ de ordine (rulează: npx tsx src/services/orders.verify.ts)
// Dovadă pentru: #2 decizie la conflict, #3 dedup, #4 raport — fără a atinge puntea live.
import { decideDeployFailure, isDuplicateOrder, composeOrdersReport, type OrderRow } from './orders.js'

let passed = 0
let failed = 0
function check(name: string, cond: boolean): void {
  if (cond) {
    passed++
    console.log(`  ✓ ${name}`)
  } else {
    failed++
    console.error(`  ✗ ${name}`)
  }
}

console.log('#2 decideDeployFailure — conflict → rebuild (nu buclă), altul → retry:')
const c1 = decideDeployFailure('imbin fixul: Automatic merge failed', 'Influencer')
check('conflict „imbin" → action rebuild', c1.action === 'rebuild' && c1.conflict === true)
check('conflict → mesaj FĂRĂ „zi ok" (nu buclează)', !/zi „ok"/i.test(c1.message))
check('conflict → spune că a retrimis la reconstruit', /reconstruit/i.test(c1.message))
const c2 = decideDeployFailure('npm run build a picat: type error', 'ceva')
check('build fail (fără conflict) → action retry', c2.action === 'retry' && c2.conflict === false)
check('retry → cere „ok"', /zi „ok"/i.test(c2.message))
const c3 = decideDeployFailure('CONFLICT (content): Merge conflict in chat.ts')
check('conflict englezesc „CONFLICT/Merge conflict" → rebuild', decideDeployFailure('CONFLICT (content): Merge conflict in chat.ts').action === 'rebuild')

console.log('#3 isDuplicateOrder — același lucru nu se mai construiește de 2 ori:')
const recent = ['Integrează meseria 1 Influencer cap-coadă în backend și frontend']
check('duplicat identic → true', isDuplicateOrder('integreaza meseria 1 influencer cap-coada in backend si frontend', recent))
check('duplicat prin conținere → true', isDuplicateOrder('Integrează meseria 1 Influencer', recent))
check('ordin diferit → false', !isDuplicateOrder('Adaugă filtru de zgomot pe microfon', recent))
check('text prea scurt → false (nu prindem fraze mici)', !isDuplicateOrder('da', ['da fă']))
check('listă goală → false', !isDuplicateOrder('orice ordin lung aici', []))

console.log('#4 composeOrdersReport — raport cu toate cererile + stadiile:')
const orders: OrderRow[] = [
  { text: 'Endpoint /api/sdk-ping', status: 'certified', created_at: '2026-07-05T18:51:00Z', delivered_at: '2026-07-05T18:52:00Z' },
  { text: 'Filtru voiceprint microfon', status: 'published', created_at: '2026-07-05T19:31:00Z' },
  { text: 'Registru de ordine', status: 'delivered', created_at: '2026-07-05T21:30:00Z' },
  { text: 'Ceva neînceput', status: 'pending' },
]
const rep = composeOrdersReport(orders, 'Registru + raport ordine')
check('raportul numără toate ordinele (4)', rep.includes('Raport ordine (4)'))
check('arată cerința activă', rep.includes('Registru + raport ordine'))
check('traduce statusul în stadiu citibil (certificat)', /certificat/i.test(rep))
check('traduce „delivered" în „în lucru"', /în lucru/i.test(rep))
check('listează fiecare ordin cu textul', rep.includes('Endpoint /api/sdk-ping') && rep.includes('Filtru voiceprint microfon'))
check('registru gol → mesaj clar', composeOrdersReport([], null).includes('niciun ordin'))
check('registru gol dar cerință activă → o arată', composeOrdersReport([], 'X activă').includes('X activă'))

console.log(`\nREZULTAT: ${passed} trecute, ${failed} picate`)
if (failed > 0) process.exit(1)
