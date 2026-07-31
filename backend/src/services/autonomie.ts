// ── KELION SE APUCĂ SINGUR DE TREABĂ ─────────────────────────────────────────
//
// Adrian, 30 iul: „de ce nu îl faci full autonom?" · „are voie să facă orice,
// fără nicio restricție" · „dă-i liber să se repare singur, să-și construiască
// ce nu ești tu în stare" · **„tema autonomiei lui va fi să facă partea totală
// cu Revolut; când merge aia, e autonom"**.
//
// Ce EXISTA deja: constructorul primea ordine și le ducea la capăt (dovedit —
// PR #588, deschis și integrat de el singur). Ce LIPSEA: cineva care să-i DEA
// ordinul. Adică era autonom în execuție, dar reactiv în pornire — aștepta un om.
//
// Aici e piesa care lipsea. La fiecare oră, bucla asta:
//   1. se uită dacă ultimul lucru al lui a picat → i-l dă ÎNAPOI, cu jurnalul
//      eșecului, ca să-l repare singur (asta e „să se repare singur");
//   2. dacă nu, ia următorul pas din MISIUNE — partea Revolut, cap-coadă;
//   3. dacă misiunea s-a terminat, trece pe `RAMAS-DE-FACUT.md`, lista ownerului.
// Fără să întrebe pe nimeni.
//
// DE CE MISIUNEA E ÎNAINTEA LISTEI: pentru că el a spus care e proba. Nu „mai
// face ceva pe undeva" — partea de plăți Revolut, întreagă, până merge.
//
// DE CE PE URMĂ `RAMAS-DE-FACUT.md` și nu o listă nouă: aia e deja lista LUI,
// ținută la zi, cu dovada fiecărui rând. O a doua listă ar diverge de prima în
// două zile, iar el ar avea două adevăruri despre același lucru.
//
// ── GĂRZILE, și de ce fiecare ─────────────────────────────────────────────────
//
// „Fără restricții" înseamnă că nu-i cerem VOIE. Nu înseamnă că-l lăsăm să se
// calce pe picioare:
//
//   • UN SINGUR ordin în lucru — dacă mai are ceva pornit, nu i se mai dă nimic.
//     Altfel, la fiecare oră s-ar aduna sarcini peste sarcini și n-ar termina
//     niciuna.
//   • ATÂT. NIMIC ALTCEVA. (Adrian, 30 iul: „eu plătesc, eu cer, tu execuți fără
//     să comentezi" · „dacă tu pui bariere nedorite și neaprobate de mine, nu
//     înseamnă că-mi sabotezi munca?") Pusesem un plafon zilnic și un abandon
//     după trei încercări — două bariere pe care nu le-a cerut nimeni. Sunt
//     SCOASE. Nu există plafon, și nu se renunță la nicio sarcină: un pas care
//     pică se reia, iar ordinea „cine a fost încercat de mai puține ori" face ca
//     un pas greu să nu înfometeze restul. „Un singur ordin odată" rămâne, dar
//     nu e o permisiune — lucrătorul ia oricum un ordin pe rând.
import { config } from '../config.js'
import {
  createBuildJob, listBuildJobs, loadKv, saveKv, getCapabilityGaps, setGapResolved,
  type BuildJob,
} from '../db.js'
import { brainCompleteWithTools } from './brain.js'
import { BROWSER_TOOLS, SECRET_PUNE_TOOL, SECRET_LISTA_TOOL, SECRET_PUBLICA_TOOL } from './brainToolDefs.js'
import { execSharedAdminTool, SHARED_ADMIN_TOOLS } from './adminTools.js'
import { inventarulMeu } from './brainCapabilities.js'
import { evalueazaCerinta, imbunatatireContinua } from './cerinte.js'
import { listeazaCerinte, actualizeazaCerinta } from '../db.js'
import { listeazaSecrete } from './secrete.js'
import {
  browserOpen, browserClick, browserType, browserRead, browserBack,
  browserScroll, browserKey, browserClickAt, browserClose,
} from './browser.js'
import type { AnthropicTool } from './openrouter.js'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

/** CINE duce sarcina — și ăsta NU e un detaliu, e cauza unui eșec pe care era să-l
 *  trimit în producție (30 iul).
 *
 *  Sunt DOUĂ mâini diferite, cu unelte diferite:
 *    • CONSTRUCTORUL (agentul de pe VPS, `deploy/constructor-agent.mjs`) are
 *      exact 7 unelte: ls, grep, read, write, edit, run, finish. Scrie COD și
 *      deschide PR. NU are browser. NU poate pune secrete.
 *    • KELION ÎNSUȘI (creierul aplicației) are browserul live (9 unelte) și, de
 *      azi, `secret_pune`/`secret_lista`/`secret_publica`.
 *
 *  Un pas de portal trimis constructorului ar fi eșuat de trei ori la rând, pe
 *  banii ownerului, și s-ar fi terminat cu „blocat" — fiindcă îi ceream unui
 *  agent fără browser să intre pe un site. De-aia fiecare pas spune EXPLICIT
 *  cine îl duce, iar bucla îl trimite acolo unde există uneltele. */
type Executant = 'maini' | 'constructor'

/** Un pas din misiune, sau un rând din lista ownerului — la fel pentru buclă. */
interface Sarcina {
  /** Cheia sub care ținem minte: `M1`, `B8`… */
  cod: string
  /** Titlul, pe scurt — apare în panou și în jurnal. */
  titlu: string
  /** Ordinul complet. Executantul NU vede altceva. */
  ordin: string
  /** Cine îl duce: mâinile lui Kelion (browser + secrete) sau constructorul (cod). */
  executant: Executant
  /** CÂT DE GREA e, 1..5. Pleacă în ordin ca „NIVEL DE DIFICULTATE: N/5", iar
   *  constructorul își alege MÂNA după ea: model mare pe sarcină grea, gratuit
   *  pe una banală. Fără marcaj → 3 (mediu), pe partea sigură. */
  dificultate?: number
  /** Cum se DOVEDEȘTE că e gata — o măsurătoare, nu cuvântul lui.
   *  Întoarce `true` doar dacă lucrul chiar s-a întâmplat. */
  dovada?: () => Promise<boolean>
}

/** Cheile există cu adevărat în secretele repo-ului? (măsurătoare, nu declarație) */
async function secreteExista(...nume: string[]): Promise<boolean> {
  try {
    const j = JSON.parse(await listeazaSecrete()) as { secrete?: { nume: string }[] }
    const set = new Set((j.secrete ?? []).map((s) => s.nume))
    return nume.every((n) => set.has(n))
  } catch {
    return false
  }
}

/** Ce ținem minte despre un pas, între treceri. */
interface StarePas {
  /** Ordinul deschis pentru pasul ăsta (0 = niciunul acum). */
  job: number
  /** Câte ori am dat pasul (inclusiv reparațiile). */
  incercari: number
  /** Terminat cu bine — nu ne mai atingem de el. */
  gata?: boolean
}

// ── MISIUNEA: PARTEA REVOLUT, CAP-COADĂ ──────────────────────────────────────
//
// Adrian, 30 iul: „tema autonomiei lui va fi să facă partea totală cu Revolut;
// când merge aia, e autonom." Deci proba nu e „a deschis un PR" — e „userul
// plătește și primește creditele singur, fără ca nimeni să miște un deget".
//
// Ce e DEJA scris (nu se refac): codurile unice `KLN-XXXX-XXXX`, tabela
// `payment_codes`, potrivirea codului din referință, creditarea idempotentă
// (`topUpUser`), și cititorul bancar GoCardless (`services/openBanking.ts`).
//
// Ce LIPSEȘTE, și de-aia nu merge: **veriga prin care aplicația AFLĂ că a intrat
// un ban.** Cititorul bancar cere un cont pe un portal străin, cu consimțământ
// care expiră la 30-90 de zile — ownerul l-a închis după ce portalul i-a dat
// 502 și login stricat, și are dreptate. Drumul care NU cere niciun cont nou:
// **emailul de la Revolut**, pe care aplicația deja îl citește (`mailbox.ts`,
// cutia contact@kelionai.app).
//
// Pașii de mai jos sunt exact drumul ăla, în ordinea în care se poate construi.
const MISIUNE: Sarcina[] = [
  {
    cod: 'M0',
    titlu: 'Setările Revolut, făcute de el — nu de om',
    ordin:
      `MISIUNE REVOLUT, pasul 0 — SETĂRILE LE FACI TU.\n\n` +
      `Adrian, 30 iul: „cerința a fost autonomia lui și să rezolve problema cu setările ` +
      `pentru Revolut… să creeze secretele și să le pună unde trebuie, e al meu și îi ` +
      `permit full acces."\n\n` +
      `AI UNELTELE, DE AZI: secret_lista (ce chei există), secret_pune (scrie o cheie în ` +
      `secretele repo-ului, criptat), secret_publica (le duce pe server și repornește ` +
      `aplicația). Nu mai ceri omului să intre nicăieri.\n\n` +
      `FĂ AȘA:\n` +
      `  1. secret_lista — vezi ce ai deja. Ce e pus, nu se mai cere.\n` +
      `  2. Citește backend/src/config.ts și services/ — ce nume de chei așteaptă codul ` +
      `     pentru plăți? Lucrează pe numele REALE din cod, nu pe cele din amintiri.\n` +
      `  3. Ce poți genera singur (chei, perechi de chei, identificatori), GENEREAZĂ și pune ` +
      `     cu secret_pune. Ce doar Revolut poate emite, pregătește-i omului un singur pas ` +
      `     scurt, cu linkul exact — și DOAR dacă ai dovada din documentație că nu se poate ` +
      `     altfel. Nu-l trimite să caute; el a pierdut deja o zi așa.\n` +
      `  4. secret_publica, apoi VERIFICĂ pe /api/admin/env-check că serverul chiar le vede ` +
      `     (nume + lungime; valoarea nu se afișează niciodată, nicăieri).\n` +
      `  5. Spune-i ce ai configurat: numele cheilor și starea. NICIODATĂ valorile.\n\n` +
      `REGULA CARE NU SE ÎNCALCĂ: valoarea unui secret nu se repetă, nu se confirmă, nu se ` +
      `pune pe monitor, nu se scrie într-un fișier din repo. Datele unui card nu trec pe ` +
      `nicăieri, niciodată.`,
    // MÂINILE LUI: are nevoie de secret_pune/secret_publica. Constructorul nu le are.
    executant: 'maini',
    dificultate: 4, // configurare pe servicii externe, atinge cheile

    // Dovada, nu declarația: linkul de plată chiar există în secrete.
    dovada: () => secreteExista('REVOLUT_PAY_LINK'),
  },
  {
    cod: 'M1',
    titlu: 'Intri TU pe portal, cu browserul tău, și-ți faci singur cheile',
    ordin:
      `MISIUNE REVOLUT, pasul 1 din 5 — VERIGA CARE LIPSEȘTE, ȘI CINE O FACE: TU.\n\n` +
      `Adrian, 30 iul, cuvânt cu cuvânt: „are liber 1000000% să folosească tot ca să obțină ` +
      `scopul meu" · „e al meu și îi permit full acces". Deci NU ceri voie, NU-l trimiți pe ` +
      `el nicăieri, și NU te oprești la primul obstacol de pe un portal.\n\n` +
      `CE E DEJA SCRIS (nu rescrii nimic din astea): codurile unice KLN-XXXX-XXXX ` +
      `(db.ts → creeazaCodPlata), tabela payment_codes, potrivirea codului din referință ` +
      `(crediteazaDupaCod), creditarea idempotentă (topUpUser), ȘI CITITORUL DE TRANZACȚII ` +
      `— backend/src/services/openBanking.ts, gata scris. Lipsesc DOAR cheile lui.\n\n` +
      `CE E INTERZIS, decis de owner — nu se renegociază:\n` +
      `  • NU prin email. Plata nu se citește din inbox. (30 iul: „ce ai făcut cu email ` +
      `    scoți imediat, nu accept așa ceva".) Niciun modul care caută încasări în cutia ` +
      `    poștală, sub niciun nume.\n` +
      `  • NU prin API-ul Revolut: MĂSURAT din documentația lor — API-ul e doar pe Revolut ` +
      `    Business, plan Grow+, iar Business nu se dă persoanelor fizice autorizate. Ownerul ` +
      `    are Pro. Ușa aia e închisă; nu pierde timp pe ea.\n` +
      `  • NU-i cere ownerului să intre pe portal. A pierdut deja o zi așa. Portalul e al tău.\n\n` +
      `DRUMUL, ȘI E AL TĂU — BROWSERUL. Ai browser real pe server: browser_open, browser_read, ` +
      `browser_click, browser_click_at, browser_type, browser_scroll, browser_key, ` +
      `browser_back, browser_close. Cu el faci TOT lanțul:\n` +
      `  1. deschizi https://bankaccountdata.gocardless.com/ — ăsta, nu „manage." și nu ` +
      `     „developer.", alea sunt ALTE produse și n-au cheile noastre;\n` +
      `  2. la login, PORNEȘTE ÎNTÂI comutatorul „I agree to … Terms & Conditions" — până ` +
      `     nu-l pornești, butoanele (inclusiv „Log in with Google") rămân MOARTE. Ăsta e ` +
      `     motivul real pentru care ownerul n-a putut intra, nu o defecțiune;\n` +
      `  3. Developers → User Secrets → Create new → iei Secret ID și Secret Key;\n` +
      `  4. le pui SINGUR: secret_pune GOCARDLESS_SECRET_ID, secret_pune GOCARDLESS_SECRET_KEY;\n` +
      `  5. Bank connections → Add bank → Revolut (id REVOLUT_REVOGB21) → pornești cererea ` +
      `     de acces. AICI, și DOAR aici, e nevoie de owner: legea (PSD2) cere ca titularul ` +
      `     să aprobe în aplicația Revolut de pe telefonul lui. Îi spui SCURT: „aprobă în ` +
      `     Revolut, e o singură apăsare" — și aștepți. Nimic altceva nu-i ceri;\n` +
      `  6. după aprobare iei Account ID → secret_pune GOCARDLESS_ACCOUNT_ID;\n` +
      `  7. secret_publica — le duce pe server și repornește aplicația;\n` +
      `  8. VERIFICI că merge: starea din stareCitirePlati() trebuie să treacă pe ✅. Dacă ` +
      `     nu trece, e treaba ta să afli de ce, nu a lui.\n\n` +
      `REGULI DE FIER: nu tastezi parole și nu le ceri; dacă un pas cere parola ownerului, ` +
      `te oprești și spui exact la ce pas ai ajuns. Niciun număr de card nu trece pe nicăieri. ` +
      `Valorile cheilor nu se repetă în chat, nu ajung pe monitor, nu se scriu în repo — ` +
      `raportezi NUMELE și starea.\n\n` +
      `DACĂ PORTALUL PICĂ (502, pagină albă, buton mort): reîncerci, cauți alt drum în ` +
      `interfața lor, faci capturi pe monitor ca ownerul să vadă unde ești. Nu abandonezi ` +
      `la prima eroare și nu i-o pasezi lui.\n\n` +
      `CÂND CHEILE SUNT PUSE, restul merge singur: openBanking.ts citește tranzacțiile din ` +
      `5 în 5 minute, potrivește codul KLN din referință și creditează. Scrii teste dacă ` +
      `atingi cod; dacă a fost doar configurare, scrii în PR ce ai configurat și dovada că ` +
      `starea a trecut pe verde.`,
    // MÂINILE LUI: portal = browser + secrete. Rulează în aplicație, unde
    // uneltele chiar există (constructorul le are acum și el, prin
    // /api/constructor/tool — dar pasul ăsta nu e muncă de cod).
    executant: 'maini',
    dificultate: 5, // portal străin, formulare care se schimbă, consimțământ bancar

    // Dovada: cele trei chei chiar există. Fără ele, cititorul nu poate citi nimic.
    dovada: () => secreteExista('GOCARDLESS_SECRET_ID', 'GOCARDLESS_SECRET_KEY', 'GOCARDLESS_ACCOUNT_ID'),
  },
  {
    cod: 'M2',
    titlu: 'Plasa: nicio plată nu se pierde, chiar dacă userul greșește codul',
    ordin:
      `MISIUNE REVOLUT, pasul 2 din 5 — PLASA.\n\n` +
      `O plată intră fără cod, sau cu codul scris greșit. Azi ea dispare fără urmă. ` +
      `Ownerul: „nicio plată nu se pierde" — trebuie să fie adevărat, nu o promisiune.\n\n` +
      `CONSTRUIEȘTE: tabela plati_neatribuite (sumă, monedă, referința brută, sursa, data, ` +
      `starea, cui i-a fost atribuită în final) + scrierea în ea din calea de detectare, ` +
      `de fiecare dată când o încasare NU se potrivește cu niciun cod.\n\n` +
      `Reguli: nu ghici userul după sumă (două plăți de £10 în aceeași zi = credit greșit ` +
      `dat omului greșit); atribuirea rămâne o acțiune explicită de admin, dar plata trebuie ` +
      `să fie VIZIBILĂ imediat ce a intrat. Creditarea la atribuire trece tot prin topUpUser ` +
      `(idempotent), pe aceeași referință bancară — deci nu poate credita de două ori.\n\n` +
      `Teste: plată fără cod → ajunge în plati_neatribuite; aceeași plată văzută de două ori ` +
      `→ un singur rând; atribuirea manuală creditează o singură dată.`,
    executant: 'constructor',
    dificultate: 4, // atinge banii: o greșeală aici creditează pe cine nu trebuie
  },
  {
    cod: 'M3',
    titlu: 'Panoul de plăți în Admin — ce a intrat, ce așteaptă, ce n-a mers',
    ordin:
      `MISIUNE REVOLUT, pasul 3 din 5 — CE VEDE OWNERUL.\n\n` +
      `CONSTRUIEȘTE în Admin (frontend/src/components/AdminPanel.tsx, secțiunea Bani) un ` +
      `tablou al plăților, alimentat de rute noi de admin (strict admin, ca restul):\n` +
      `  • coduri emise și neplătite (cine, cât, de când), cu cele expirate marcate;\n` +
      `  • plăți încasate și creditate: cod, user, sumă, data, referința bancară;\n` +
      `  • plăți neatribuite (de la pasul 2), fiecare cu un buton „atribuie userului X";\n` +
      `  • totaluri: azi / luna asta.\n\n` +
      `REGULA #1 A OWNERULUI, obligatorie aici: o valoare care nu a venit dintr-o citire ` +
      `reușită se afișează „nu pot verifica" — NICIODATĂ 0. Un 0 pus în locul unei citiri ` +
      `picate l-a costat o zi întreagă pe 30 iul („Stripe £0.00" în timp ce avea bani).\n\n` +
      `Teste pe potrivire/totaluri. La frontend rulează comanda EXACTĂ: cd frontend && npm run build.`,
    executant: 'constructor',
    dificultate: 3,
  },
  {
    cod: 'M4',
    titlu: 'Userul: apasă, plătește, primește creditele — live, fără refresh',
    ordin:
      `MISIUNE REVOLUT, pasul 4 din 5 — CAPĂTUL DINSPRE CLIENT.\n\n` +
      `Ruta /api/billing/checkout dă deja {url, code, amount, currency} — linkul Revolut al ` +
      `ownerului plus codul unic. Ce lipsește e drumul văzut de om, cap-coadă:\n` +
      `  • sume la alegere (10 / 15 / 20 / altă sumă), nu una singură;\n` +
      `  • codul afișat MARE, cu buton de copiere, și scris limpede unde se pune: la ` +
      `    referință/notă, în pagina Revolut. Dacă omul nu-l scrie, plata nu se potrivește ` +
      `    singură — deci instrucțiunea e parte din funcționalitate, nu decor;\n` +
      `  • starea „aștept plata" care se închide SINGURĂ când creditele intră (poll rar sau ` +
      `    prin canalul SSE existent) — fără ca userul să dea refresh;\n` +
      `  • istoricul plăților lui în contul lui.\n\n` +
      `Verifică în același PR că nu a rămas nicio urmă de Stripe pe drumul userului ` +
      `(ownerul, 30 iul: „0 stripe").`,
    executant: 'constructor',
    dificultate: 3,
  },
  {
    cod: 'M5',
    titlu: 'Proba automată cap-coadă — ca să nu se mai strice pe tăcute',
    ordin:
      `MISIUNE REVOLUT, pasul 5 din 5 — PROBA.\n\n` +
      `Scrie un test de integrare care parcurge TOT drumul, fără rețea și fără bani reali:\n` +
      `  1. un user cere credit → primește un cod;\n` +
      `  2. sosește o încasare Revolut simulată, cu codul în referință;\n` +
      `  3. creditele apar în contul ACELUI user, cu suma exactă;\n` +
      `  4. aceeași încasare încă o dată → soldul NU se mișcă (idempotența);\n` +
      `  5. o încasare cu cod inexistent → plată neatribuită, ZERO credite date.\n\n` +
      `Ăsta e testul care apără veniturile ownerului. Dacă cineva strică lanțul peste ` +
      `trei luni, pică aici, nu în extrasul lui de cont.\n\n` +
      `Actualizează PROCEDURA-PLATI.md cu drumul REAL, cel construit la pasul 1, ` +
      `și taie ce nu mai e adevărat.`,
    executant: 'constructor',
    dificultate: 3,
  },
]

/** Ultima trecere — panoul poate spune dacă bucla chiar lucrează. */
let ultima: { la: string; ok: boolean; detaliu: string } | null = null
export function stareAutonomie(): { la: string; ok: boolean; detaliu: string } | null {
  return ultima
}

/** Citește lista ownerului și întoarce rândurile NEREZOLVATE, ca sarcini.
 *
 *  Formatul e un tabel Markdown: `| B8 | **titlu** | stare... |`. Rândurile
 *  rezolvate conțin „✅" — pe alea le sărim. */
async function randuriDeFacut(): Promise<Sarcina[]> {
  // Fișierul stă în rădăcina proiectului; în container, sursa e lângă `dist`.
  const cai = [
    path.resolve(process.cwd(), 'RAMAS-DE-FACUT.md'),
    path.resolve(process.cwd(), '..', 'RAMAS-DE-FACUT.md'),
    '/root/kelion/repo/RAMAS-DE-FACUT.md',
  ]
  let text = ''
  for (const c of cai) {
    text = await readFile(c, 'utf8').catch(() => '')
    if (text) break
  }
  if (!text) return []
  const out: Sarcina[] = []
  for (const linie of text.split('\n')) {
    // `| B8 | **Titlu** | descriere |`
    const m = linie.match(/^\|\s*([A-Z]\d+)\s*\|\s*(.+?)\s*\|(.*)\|\s*$/)
    if (!m) continue
    if (/✅/.test(linie)) continue // rezolvat → nu ne mai atingem de el
    const [, cod, titluBrut, rest] = m
    const titlu = titluBrut.replace(/\*\*/g, '').trim()
    if (!titlu) continue
    const context = `${titlu} — ${rest.replace(/\|/g, ' ').trim()}`.slice(0, 1800)
    // Rândurile listei sunt muncă de COD — merg la constructor. Dacă vreunul cere
    // portal sau chei, ordinul îi spune să deschidă PR cu analiza, nu să se
    // chinuie cu unelte pe care nu le are.
    out.push({
      cod,
      titlu,
      executant: 'constructor',
      ordin: `SARCINĂ LUATĂ SINGUR din RAMAS-DE-FACUT.md, rândul ${cod}.\n\n${context}`,
    })
  }
  return out
}

// ── CE ÎI LIPSEȘTE LUI, LUAT DE EL ȘI CONSTRUIT ──────────────────────────────
//
// Adrian, 30 iul: „autonomia mai înseamnă și capacitatea de a vedea ce îi
// lipsește și capabilități extinse autonome de învățare și dezvoltare".
//
// Jumătate exista deja, și mergea: când un user cere ceva ce Kelion nu poate,
// se scrie în `capability_gaps` (unealta `log_gap`), iar `triageGaps()` îl pune
// pe el să-și trieze SINGUR lista — „DE IMPLEMENTAT" sau închis ca duplicat.
//
// Jumătatea ruptă era după: NIMENI nu construia ce marcase „DE IMPLEMENTAT".
// Lista zăcea. Deci vedea ce-i lipsește, dar nu se dezvolta — exact golul pe
// care l-a numit el. De aici încolo, ce a marcat singur devine muncă pe care
// tot el o ia. Cercul se închide: vede → construiește → poate.
async function golurileLui(): Promise<Sarcina[]> {
  const goluri = await getCapabilityGaps(false, 100).catch(() => [])
  return goluri
    .filter((g) => String((g as { triage?: string | null }).triage ?? '').startsWith('DE IMPLEMENTAT'))
    .slice(0, 20)
    .map((g) => ({
      cod: `G${g.id}`,
      titlu: String(g.request).slice(0, 90),
      executant: 'constructor' as Executant,
      ordin:
        `CAPABILITATE CARE ÎȚI LIPSEȘTE — ai marcat-o TU „de implementat", nimeni nu ți-a cerut-o acum.\n\n` +
        `CE A CERUT OMUL ȘI N-AI PUTUT FACE: "${String(g.request).slice(0, 600)}"\n` +
        `De câte ori s-a cerut: ${g.hits}.\n` +
        (g.reason ? `Ce ai notat tu atunci: ${String(g.reason).slice(0, 300)}\n` : '') +
        (((g as { triage?: string | null }).triage) ? `Verdictul tău la triere: ${String((g as { triage?: string | null }).triage).slice(0, 300)}\n` : '') +
        `\nCONSTRUIEȘTE-O. Nu o descrie, nu propune un plan — scrie codul, cu teste care apără ` +
        `exact comportamentul nou, și leagă unealta în registrul de capabilități ` +
        `(services/brainCapabilities.ts) ca să n-o poți avea „adormită".\n\n` +
        `Dacă la a doua privire chiar NU merită (duplicat, sau se poate deja cu ce ai), ` +
        `spune-o limpede în PR și explică de ce — a te răzgândi cu motiv nu e eșec.`,
    }))
}

// ── DUPĂ TREI ÎNCERCĂRI: IESE ȘI CAUTĂ, NU SE ÎNVÂRTE ────────────────────────
//
// Adrian, 30 iul: „după 3 trebuie să caute soluții, să iasă, să identifice
// soluții, să studieze problema, să-și instaleze unelte diverse — în niciun caz
// să abandoneze sau să stea în buclă."
//
// Ăsta e chiar echilibrul corect, și e altceva decât ce pusesem eu: nu un
// PLAFON (renunță) și nici o repetare oarbă (se învârte), ci o SCHIMBARE DE
// METODĂ. Are cu ce, de la PR #591: browser real, runbook-uri, baza de date,
// și voie să-și instaleze pachete.
function escaladare(incercariDeja: number): string {
  if (incercariDeja < 3) return ''
  return (
    `⚠ AI ÎNCERCAT DEJA DE ${incercariDeja} ORI ȘI N-A IEȘIT. NU repeta ce ai făcut — ` +
    `ai dovada că drumul ăla nu duce nicăieri. SCHIMBĂ METODA, în ordinea asta:\n` +
    `  1. IEȘI ȘI CAUTĂ: browser_open pe mesajul EXACT de eroare și pe documentația ` +
    `     oficială a lucrului care nu merge. Citește, nu ghici.\n` +
    `  2. STUDIAZĂ PROBLEMA: db_query pe datele reale, system_health, runbook_log — ` +
    `     vezi ce se întâmplă de fapt, nu ce crezi tu că se întâmplă.\n` +
    `  3. INSTALEAZĂ-ȚI UNELTE: dacă lipsește o bibliotecă, pune-o ` +
    `     (npm --prefix backend install <pachet>). Dacă lipsește ceva de sistem, ` +
    `     run_runbook. Nu te opri fiindcă „nu ai".\n` +
    `  4. ALEGE ALT DRUM și spune în PR care e și DE CE, cu ce ai aflat la pașii 1-3.\n` +
    `Nu ai voie să abandonezi, și nu ai voie să reiei la nesfârșit același lucru.\n\n`
  )
}

// ── CERINȚELE OWNERULUI: analiză înainte de cod, apoi execuție ───────────────
//
// Adrian, 30 iul: „sisteme avansate de gestiune a cerințelor, evaluări avansate
// pe soluțiile oferite". Aici se leagă de buclă: o cerință NOUĂ nu pleacă la
// construit — întâi i se pun variantele pe masă și se alege una, cu motiv. Abia
// cea ANALIZATĂ devine ordin, și pleacă cu varianta aleasă și cu criteriul de
// acceptare lipite de ea, ca ținta să nu se mute după livrare.
async function cerinteDeDus(): Promise<Sarcina[]> {
  const analizate = await listeazaCerinte('analizata', 20).catch(() => [])
  return analizate.map((c) => ({
    cod: `C${c.id}`,
    titlu: c.text.slice(0, 90),
    executant: 'constructor' as Executant,
    // Nivelul pe care l-a pus EL la evaluare, odată cu varianta aleasă.
    dificultate: c.dificultate,
    ordin:
      `CERINȚA OWNERULUI #${c.id}. Ai analizat-o deja și ai ALES un drum — ăsta e.\n\n` +
      `CE A CERUT: ${c.text}\n\n` +
      (c.criteriu ? `CUM SE DOVEDEȘTE CĂ E FĂCUTĂ (criteriul de acceptare, scris ÎNAINTE de\n` +
        `livrare tocmai ca ținta să nu se mute): ${c.criteriu}\n\n` : '') +
      (c.aleasa ? `VARIANTA ALEASĂ DE TINE, ȘI DE CE:\n${c.aleasa}\n\n` : '') +
      (c.optiuni ? `Celelalte variante evaluate (ca să nu le reiei): ${c.optiuni.slice(0, 1200)}\n\n` : '') +
      `Dacă pe parcurs descoperi că varianta aleasă e greșită, NU o duce de dragul ` +
      `consecvenței: scrie în PR ce ai aflat și care e drumul bun. A te răzgândi cu ` +
      `dovadă e corect; a insista pe un drum mort, nu.`,
  }))
}

/** Regulile care se lipesc la FIECARE ordin — la fel pentru misiune și pentru listă. */
function cuRegulile(ordin: string, dificultate = 3): string {
  const niv = Math.max(1, Math.min(5, Math.round(Number(dificultate) || 3)))
  return (
    // MARCAJUL CARE ALEGE MÂNA (Adrian, 30 iul: „pe nivel de dificultate setabil
    // automat pe cerință"). Constructorul îl citește ÎNAINTE să înceapă și își
    // pune modelul potrivit — nu după ce a ars deja jumătate din buget aflând
    // pe pielea lui că era greu.
    `NIVEL DE DIFICULTATE: ${niv}/5\n\n` +
    `${ordin}\n\n` +
    `Fă-o cap-coadă: găsește cauza REALĂ în sursă (search_source/read_source), rescrie ` +
    `curat modulul responsabil — fără petice — și scrie teste care apără exact ` +
    `comportamentul construit.\n\n` +
    `Verifică ÎNAINTE de PR, cu comenzile EXACTE (nu variante — „tsc -p" în loc de ` +
    `„npm run build" a blocat publicarea 25 de minute pe 30 iul):\n` +
    `  cd backend  && npm run typecheck && npm test\n` +
    `  cd frontend && npm run build\n` +
    `  node scripts/verifica-sintaxa.mjs && node scripts/verifica-exporturi.mjs\n\n` +
    `Dacă sarcina cere o decizie a ownerului (bani, plafoane, conturi noi), NU decide ` +
    `singur și NU-l trimite pe el prin portaluri: deschide PR cu analiza și opțiunile, ` +
    `și spune limpede ce aștepți de la el.\n\n` +
    `Actualizează AI-HANDOFF.md în același PR.`
  )
}

/** Câte ordine autonome s-au dat AZI (plafonul zilnic). */
async function dateAzi(): Promise<number> {
  const azi = new Date().toISOString().slice(0, 10)
  const raw = await loadKv(`autonomie:zi:${azi}`).catch(() => null)
  return Number(raw ?? 0) || 0
}

async function citesteStare(cod: string): Promise<StarePas> {
  const raw = await loadKv(`autonomie:pas:${cod}`).catch(() => null)
  if (!raw) return { job: 0, incercari: 0 }
  try {
    const v = JSON.parse(raw) as Partial<StarePas>
    return { job: Number(v.job ?? 0) || 0, incercari: Number(v.incercari ?? 0) || 0, gata: v.gata }
  } catch {
    return { job: 0, incercari: 0 }
  }
}

async function scrieStare(cod: string, s: StarePas): Promise<void> {
  await saveKv(`autonomie:pas:${cod}`, JSON.stringify(s)).catch(() => {})
}

/** Ce a ieșit din ordinul dat pentru pasul ăsta: gata, picat (cu jurnal), sau încă nimic. */
function verdict(job: BuildJob | undefined): 'gata' | 'picat' | 'inLucru' {
  if (!job) return 'inLucru' // nu-l mai găsim (listă scurtă) → nu presupunem nimic
  if (job.status === 'done') return 'gata'
  if (job.status === 'failed') return 'picat'
  return 'inLucru'
}

// ── MÂINILE LUI: BROWSER + SECRETE, FĂRĂ NICIUN OM ÎN TURĂ ───────────────────
//
// Constructorul scrie cod. Dar un portal nu se deschide cu `write` și o cheie nu
// se pune cu `edit`. Pentru pașii ăia, ordinul NU mai pleacă în coadă — se
// execută AICI, în aplicație, cu exact uneltele pe care le are Kelion într-o
// conversație: cele 9 unelte de browser și cele 3 de secrete. Diferența față de
// o tură normală e că nu-i vorbește nimeni: prompt-ul e ordinul misiunii.
let mainileOcupate = false

/** Execută uneltele reale — aceleași funcții pe care le cheamă chatul.
 *
 *  EXPORTAT fiindcă le folosesc DOUĂ guri: bucla de aici, și CONSTRUCTORUL de pe
 *  VPS, prin `/api/constructor/tool` (Adrian, 30 iul: „am cerut agenți full
 *  echipați și tu i-ai dat doar ciurucuri"). Avea dreptate: constructorul avea 7
 *  unelte și niciun browser. O a doua copie a dispatch-ului ar fi divergit în
 *  două zile — deci una singură, aici. */
export async function uneltele(name: string, args: Record<string, unknown>): Promise<string> {
  const email = config.adminEmail
  const baseUrl = 'https://kelionai.app'
  // TOT setul de admin, nu o listă scrisă de mână (Adrian, 30 iul: „toate,
  // trebuie echipat la full"). `SHARED_ADMIN_TOOLS` e sursa unică — dacă mâine
  // apare o unealtă nouă acolo, o are și el, fără să mai umble nimeni aici.
  if (SHARED_ADMIN_TOOLS.has(name)) {
    return (await execSharedAdminTool(name, args)) ?? JSON.stringify({ error: 'unealtă necunoscută' })
  }
  // Pagina se întoarce ca text + elemente numerotate; o tăiem, ca o pagină mare
  // să nu mănânce toată fereastra de context a creierului.
  const scurt = (v: unknown): string => JSON.stringify(v).slice(0, 20_000)
  switch (name) {
    case 'browser_open': return scurt(await browserOpen(email, baseUrl, String(args.url ?? '')))
    case 'browser_click': return scurt(await browserClick(email, baseUrl, Number(args.index ?? -1)))
    case 'browser_type':
      return scurt(await browserType(email, baseUrl, Number(args.index ?? -1), String(args.text ?? ''), args.submit === true))
    case 'browser_read': return scurt(await browserRead(email, baseUrl))
    case 'browser_back': return scurt(await browserBack(email, baseUrl))
    case 'browser_scroll': return scurt(await browserScroll(email, baseUrl, args.direction === 'up' ? 'up' : 'down'))
    case 'browser_key': return scurt(await browserKey(email, baseUrl, String(args.key ?? '')))
    case 'browser_click_at': return scurt(await browserClickAt(email, baseUrl, Number(args.x ?? 0), Number(args.y ?? 0)))
    case 'browser_close': { await browserClose(email); return JSON.stringify({ ok: true }) }
    default: return JSON.stringify({ error: `unealtă necunoscută: ${name}` })
  }
}

// ── VERIFICAREA PROPRIE: „livrat" nu înseamnă „merge" ────────────────────────
//
// Tot ce s-a „terminat" azi l-am dovedit EU, cu mâna, cu curl. Asta nu se
// scalează și, mai rău, e exact felul în care s-a strecurat „chatul e mut": un
// ordin terminat, un PR verde, și aplicația tăcută pe live.
//
// Aici cerința LIVRATĂ se probează singură, cu uneltele reale — browser pe
// site-ul viu, interogare în baza de date, sănătatea aplicației — față de
// CRITERIUL scris înainte de livrare. Trece pe „verificată" DOAR cu ce a
// măsurat; altfel se întoarce la lucru, cu ce a găsit. Regula #1 a ownerului,
// aplicată propriei noastre evidențe.
async function verificaLivrata(): Promise<{ pornit: boolean; motiv: string } | null> {
  const livrate = await listeazaCerinte('livrata', 5).catch(() => [])
  const c = livrate[0]
  if (!c) return null
  const tools = [
    ...BROWSER_TOOLS, SECRET_LISTA_TOOL,
  ] as unknown as AnthropicTool[]
  const prompt =
    `VERIFICI CE AI LIVRAT. Nu întrebi pe nimeni, nu presupui — MĂSORI.\n\n` +
    `CERINȚA #${c.id}: ${c.text}\n` +
    `CRITERIUL DE ACCEPTARE (scris ÎNAINTE de livrare, ca ținta să nu se mute): ` +
    `${c.criteriu ?? '(nescris — atunci verifică dacă cerința chiar e îndeplinită, pe înțelesul omului)'}\n` +
    (c.aleasa ? `Soluția aleasă: ${c.aleasa}\n` : '') +
    `\n${inventarulMeu()}\n\n` +
    `Deschide aplicația LIVE (https://kelionai.app) cu browserul și probează. ` +
    `Dacă merge: răspunde exact „VERIFICAT: <ce ai măsurat, concret>". ` +
    `Dacă NU merge: „NU MERGE: <ce ai văzut, exact>". ` +
    `Nu ai voie să scrii „VERIFICAT" fără o măsurătoare pe care ai făcut-o tu.`
  const spus = await brainCompleteWithTools(prompt, tools, uneltele, { maxRounds: 20, maxTokens: 1500 })
    .catch((e: Error) => `NU MERGE: verificarea a crăpat — ${e.message}`)

  if (/^\s*VERIFICAT/i.test(spus)) {
    await actualizeazaCerinta(c.id, { stare: 'verificata', dovada: spus.slice(0, 2000) }).catch(() => {})
    return { pornit: true, motiv: `cerința #${c.id} — VERIFICATĂ pe live: ${spus.slice(10, 160)}` }
  }
  // N-a trecut → înapoi la lucru, cu ce a găsit. Nu se declară gata.
  await actualizeazaCerinta(c.id, { stare: 'analizata', dovada: spus.slice(0, 2000) }).catch(() => {})
  return { pornit: true, motiv: `cerința #${c.id} — n-a trecut proba, o reia: ${spus.slice(0, 160)}` }
}

/** O tură de lucru a lui Kelion, pornită de buclă, nu de un om. */
async function ruleazaCuMainile(s: Sarcina): Promise<string> {
  const tools = [
    ...BROWSER_TOOLS, SECRET_LISTA_TOOL, SECRET_PUNE_TOOL, SECRET_PUBLICA_TOOL,
  ] as unknown as AnthropicTool[]
  const prompt =
    `${s.ordin}\n\n` +
    // CONȘTIENT DE CE ARE (Adrian, 30 iul): inventarul lui complet, derivat din
    // registru. Un agent care nu-și cunoaște uneltele spune „nu pot" pentru ce
    // are în mână.
    `${inventarulMeu()}\n\n` +
    `CUM LUCREZI AICI: nu-ți vorbește nimeni, nu aștepți răspuns de la nimeni. ` +
    `Ai browserul (browser_open/read/click/type/scroll/key/click_at/back/close) și ` +
    `secretele (secret_lista/secret_pune/secret_publica). Le folosești. ` +
    `Începe cu secret_lista, ca să nu ceri ce ai deja.\n\n` +
    `Când termini, scrie în DOUĂ-TREI rânduri ce ai făcut și ce mai lipsește. ` +
    `Dacă ai nevoie de owner pentru un pas pe care legea îl cere doar de la el ` +
    `(aprobarea din aplicația bancară), scrie exact: „AȘTEPT APROBAREA: <ce anume>". ` +
    `NICIODATĂ valorile cheilor — doar numele lor.`
  return brainCompleteWithTools(prompt, tools, uneltele, { maxRounds: 30, maxTokens: 2500 })
}

/** O trecere: se repară singur dacă a picat, altfel ia următoarea sarcină. */
export async function poateSaLucreze(): Promise<{ pornit: boolean; motiv: string }> {
  if (mainileOcupate) return { pornit: false, motiv: 'lucrează chiar acum cu browserul' }
  const jobs = await listBuildJobs(40).catch(() => [] as BuildJob[])
  const dupaId = new Map(jobs.map((j) => [j.id, j]))

  // 1. E deja ocupat? Un singur lucru odată — altfel nu termină nimic.
  if (jobs.some((j) => j.status === 'running' || j.status === 'queued')) {
    return { pornit: false, motiv: 'are deja un ordin în lucru' }
  }

  // 2. NU EXISTĂ PLAFON. (Adrian, 30 iul: „dacă tu pui bariere nedorite și
  // neaprobate de mine, nu înseamnă că-mi sabotezi munca?" · „eu plătesc, eu
  // cer, tu execuți fără să comentezi".) Pusesem un plafon zilnic pe care nu
  // mi l-a cerut nimeni. E scos. Numărul de ordine pe zi se ține doar ca să se
  // VADĂ în panou câte a dat — nu ca să-l oprească.
  const azi = await dateAzi()

  // 3. Misiunea (partea Revolut) are întâietate; pe urmă lista ownerului.
  const misiuneGata = await Promise.all(MISIUNE.map((p) => citesteStare(p.cod))).then((st) =>
    st.every((s) => s.gata),
  )
  // După misiune: întâi CE ÎI LIPSEȘTE LUI (golurile pe care le-a triat singur
  // — „vede ce-i lipsește și se dezvoltă"), apoi rândurile din lista ownerului.
  // PROBA ÎNAINTE DE ORICE ALTCEVA: ce e livrat dar neverificat nu are voie să
  // stea așa. „Livrat" nu înseamnă „merge" — vezi chatul mut din 30 iul.
  if (!mainileOcupate) {
    mainileOcupate = true
    try {
      const v = await verificaLivrata().catch(() => null)
      if (v) return v
    } finally {
      mainileOcupate = false
    }
  }

  // ANALIZA ÎNAINTE DE COD: o cerință nouă se evaluează întâi — variante,
  // scoruri, una aleasă cu motiv. E o tură ieftină de creier, nu un ordin.
  const noi = await listeazaCerinte('noua', 5).catch(() => [])
  if (noi.length) {
    const r = await evalueazaCerinta(noi[0]).catch((e: Error) => ({ ok: false, detaliu: e.message }))
    return { pornit: r.ok, motiv: `cerința #${noi[0].id}: ${r.detaliu}` }
  }

  const brute = misiuneGata
    ? [...(await cerinteDeDus()), ...(await golurileLui()), ...(await randuriDeFacut())]
    : MISIUNE
  if (!brute.length) return { pornit: false, motiv: 'n-am ce lua: nici goluri, nici rânduri de listă' }

  // NIMIC NU SE ABANDONEAZĂ. Înainte, după 3 încercări pasul era marcat „blocat"
  // și se renunța la el — o barieră pe care n-a cerut-o nimeni. Acum se reia la
  // nesfârșit; iar ca un pas greu să nu înfometeze restul, sarcinile se iau în
  // ordinea „cine a fost încercat de mai puține ori". Deci și insistă, și avansează.
  const cuStare = await Promise.all(brute.map(async (x) => ({ x, st: await citesteStare(x.cod) })))
  const sarcini = cuStare.filter((e) => !e.st.gata).sort((a, b) => a.st.incercari - b.st.incercari)

  for (const { x: s, st } of sarcini) {

    // A dat deja un ordin pe sarcina asta — ce s-a ales de el?
    if (st.job) {
      const v = verdict(dupaId.get(st.job))
      if (v === 'inLucru') return { pornit: false, motiv: `aștept ordinul #${st.job} (${s.cod})` }
      if (v === 'gata') {
        await scrieStare(s.cod, { ...st, job: 0, gata: true })
        // Un gol construit se închide și în lista LUI de lipsuri — altfel l-ar
        // relua la nesfârșit, sau ar rămâne scris „nu pot" pentru ceva ce poate.
        if (/^G\d+$/.test(s.cod)) await setGapResolved(Number(s.cod.slice(1)), true).catch(() => {})
        // O cerință dusă trece pe „livrată" — NU pe „verificată". Verificarea
        // cere o măsurătoare pe live, nu terminarea unui ordin. Regula #1.
        if (/^C\d+$/.test(s.cod)) {
          await actualizeazaCerinta(Number(s.cod.slice(1)), {
            stare: 'livrata',
            dovada: `ordinul #${st.job} s-a terminat; rămâne de VERIFICAT pe live`,
          }).catch(() => {})
        }
        console.log(`[AUTONOM] ${s.cod} („${s.titlu}") — gata, ordinul #${st.job}`)
        continue // trecem la următoarea sarcină în ACEEAȘI trecere
      }
      // PICAT → „să se repare singur": i-l dăm ÎNAPOI, cu ce a scris el însuși
      // în jurnal când a căzut. Fără număr maxim de încercări — nu renunțăm.
    }

    const picat = st.job ? dupaId.get(st.job) : undefined
    const jurnal = picat?.status === 'failed' ? (picat.log ?? '').slice(-2500) : ''
    const ordin = jurnal
      ? cuRegulile(
          `REPARI CE AI STRICAT TU. Ordinul #${st.job} pe sarcina asta a picat — ` +
            `încercarea ${st.incercari + 1}. Nu se renunță — se reia până iese.\n\n` +
            escaladare(st.incercari) +
            `SARCINA INIȚIALĂ:\n${s.ordin}\n\n` +
            `CE A SCRIS JURNALUL CÂND A CĂZUT (ultimele rânduri — pornește de la cauza de acolo, ` +
            `nu de la zero):\n${jurnal}`,
          // O sarcină care a picat deja e, prin definiție, mai grea decât părea.
          // Urcăm nivelul cu fiecare încercare — deci a doua oară pleacă pe o
          // mână mai bună, nu pe aceeași care tocmai a picat.
          Math.min(5, (s.dificultate ?? 3) + st.incercari),
        )
      : cuRegulile(s.ordin, s.dificultate)

    // ── PAS DE MÂINI: îl face ACUM, el, cu browserul și cu secretele ──────────
    // Nu intră în coada constructorului: constructorul n-are browser și n-are
    // cum să pună o cheie. Iar la final NU-l credem pe cuvânt — se măsoară.
    if (s.executant === 'maini') {
      mainileOcupate = true
      const ziua = new Date().toISOString().slice(0, 10)
      await saveKv(`autonomie:zi:${ziua}`, String(azi + 1)).catch(() => {})
      try {
        // Pașii de mâini nu lasă jurnal de job, deci escaladarea se lipește aici,
        // după numărul de încercări: de la a treia, schimbă metoda.
        const spus = await ruleazaCuMainile({ ...s, ordin: escaladare(st.incercari) + ordin })
          .catch((e: Error) => `a crăpat: ${e.message}`)
        const chiarAFacut = s.dovada ? await s.dovada().catch(() => false) : false
        const incercari = st.incercari + 1
        if (chiarAFacut) {
          await scrieStare(s.cod, { job: 0, incercari, gata: true })
          console.log(`[AUTONOM] ${s.cod} („${s.titlu}") — FĂCUT, dovedit prin măsurare`)
          return { pornit: true, motiv: `${s.cod}: ${s.titlu} — gata` }
        }
        // N-a ieșit. Dacă a cerut aprobarea ownerului, ăsta NU e un eșec de-al
        // lui — e singurul lucru pe care legea îl cere de la titularul contului.
        const asteapta = /AȘTEPT APROBAREA:?\s*(.{0,160})/i.exec(spus)?.[1]?.trim()
        if (asteapta) {
          await scrieStare(s.cod, { job: 0, incercari: st.incercari })
          return { pornit: true, motiv: `${s.cod}: așteaptă o apăsare de la tine — ${asteapta}` }
        }
        // N-a ieșit nici acum → se reia la trecerea următoare. Fără abandon.
        await scrieStare(s.cod, { job: 0, incercari })
        return { pornit: true, motiv: `${s.cod}: încercarea ${incercari} — ${spus.slice(0, 160)}` }
      } finally {
        mainileOcupate = false
      }
    }

    const id = await createBuildJob('kelion-autonom', ordin)
    if (!id) return { pornit: false, motiv: 'baza de date n-a răspuns' }
    if (/^C\d+$/.test(s.cod)) {
      await actualizeazaCerinta(Number(s.cod.slice(1)), { stare: 'in_lucru', job_id: id }).catch(() => {})
    }
    await scrieStare(s.cod, { job: id, incercari: st.incercari + 1 })
    const ziua = new Date().toISOString().slice(0, 10)
    await saveKv(`autonomie:zi:${ziua}`, String(azi + 1)).catch(() => {})
    const eticheta = jurnal ? 'reparație' : 'sarcină nouă'
    console.log(`[AUTONOM] ${eticheta}: ${s.cod} („${s.titlu}") → ordinul #${id}`)
    return { pornit: true, motiv: `${s.cod} (${eticheta}): ${s.titlu}` }
  }
  // N-a rămas nimic de dus. Atunci NU stă degeaba: își reanalizează ce a livrat
  // — „se putea mai bine, ACUM?" (Adrian: „analiza și îmbunătățirea continuă a
  // posibilităților de implementare"). Ce iese devine cerință nouă, deci munca
  // următoarei treceri. Fără asta, sistemul livrează o dată și îngheață.
  const imb = await imbunatatireContinua().catch(() => ({ propuneri: 0, detaliu: 'n-a mers reanaliza' }))
  return { pornit: imb.propuneri > 0, motiv: `nimic de dus → reanaliză: ${imb.detaliu}` }
}

/** Bucla. La fiecare oră se uită dacă are ce face — și se apucă. */
export function startAutonomie(): void {
  const ruleaza = async (): Promise<void> => {
    const r = await poateSaLucreze().catch((e) => ({ pornit: false, motiv: String(e).slice(0, 120) }))
    ultima = {
      la: new Date().toISOString(),
      ok: r.pornit,
      detaliu: r.pornit ? `a pornit singur: ${r.motiv}` : r.motiv,
    }
    // ȘI ÎN BAZĂ, nu doar în memorie: publicăm de câteva ori pe zi, iar fiecare
    // repornire ștergea urma. Fără ea, pagina de dovezi n-ar putea deosebi
    // „bucla n-a apucat încă" de „bucla nu merge deloc" — exact confuzia pe care
    // regula #1 o interzice.
    await saveKv('autonomie:ultima', JSON.stringify(ultima)).catch(() => {})
  }
  // Prima trecere la 3 minute după pornire (containerul trebuie să fie gata),
  // apoi din oră în oră.
  setTimeout(() => {
    void ruleaza()
    setInterval(() => void ruleaza(), 60 * 60 * 1000)
  }, 3 * 60 * 1000)
}
