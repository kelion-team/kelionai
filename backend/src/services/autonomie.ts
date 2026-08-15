// ── KELION STARTS WORK BY ITSELF ─────────────────────────────────────────────
//
// Adrian, Jul 30: "why don't you make it fully autonomous?" · "it is allowed to
// do anything, with no restriction" · "let it repair itself, build what you
// cannot build" · **"the theme of its autonomy will be to complete the whole
// Revolut part; when that works, it is autonomous"**.
//
// What ALREADY existed: the constructor received orders and carried them
// through (proven — PR #588, opened and merged by itself). What was MISSING:
// someone to GIVE it the order. In other words it was autonomous in execution,
// but reactive in starting — it waited for a human.
//
// This is the missing piece. Every hour, this loop:
//   1. checks whether its latest work failed → hands it BACK, with the failure
//      log, so it repairs it itself (that is "repair itself");
//   2. otherwise takes the next step in the MISSION — the Revolut part, end to
//      end;
//   3. if the mission is finished, moves to `RAMAS-DE-FACUT.md`, the owner's
//      list.
// Without asking anyone.
//
// WHY THE MISSION COMES BEFORE THE LIST: because he stated the test. Not "do
// something somewhere" — the entire Revolut payments part, until it works.
//
// WHY `RAMAS-DE-FACUT.md` AFTER THAT, and not a new list: that is already HIS
// list, kept up to date, with proof for every row. A second list would diverge
// from the first within two days, and he would have two truths about the same
// thing.
//
// ── THE GUARDS, and why each one ─────────────────────────────────────────────
//
// "No restrictions" means we do not ask for PERMISSION. It does not mean we let
// it trip over itself:
//
//   • ONE single order in progress — if something is already started, nothing
//     else is given to it. Otherwise tasks would pile on tasks every hour and
//     none would finish.
//   • THAT IS ALL. NOTHING ELSE. (Adrian, Jul 30: "I pay, I ask, you execute
//     without commenting" · "if you add unwanted barriers not approved by me,
//     doesn't that mean you sabotage my work?") I had added a daily cap and an
//     abandonment after three attempts — two barriers nobody requested. They
//     are REMOVED. There is no cap, and no task is abandoned: a failed step is
//     retried, and the "least attempted first" ordering keeps a hard step from
//     starving the rest. "One order at a time" remains, but it is not a
//     permission — the worker takes one order at a time anyway.
import { config } from '../config.js'
import {
  createBuildJob, listBuildJobs, loadKv, saveKv, getCapabilityGaps, setGapResolved,
  rezumatPlati,
  type BuildJob,
} from '../db.js'
import { brainCompleteWithTools, expertModelLadder } from './brain.js'
import {
  BROWSER_TOOLS, SECRET_LISTA_TOOL, } from './brainToolDefs.js'
import { TOATE_UNELTELE_ADMIN } from './brainToolDefs.js'
// repo_* / runbook_* / request_repair live in the SHARED source — importing
// them from routes/chat.js put this module in an import cycle, and on plain
// Node the consts were not yet initialized when UNELTELE_MAINILOR evaluated
// (ReferenceError at boot, production down — 2 aug, 93be3a6).
import {
  REPO_WRITE_TOOL, REPO_OPEN_PR_TOOL, REPO_MERGE_PR_TOOL,
  RUN_RUNBOOK_TOOL, RUNBOOK_STATUS_TOOL, RUNBOOK_LOG_TOOL, REQUEST_REPAIR_TOOL,
} from './brainToolDefs.js'
import { platiAutomatePornite } from './cardFurnizor.js'
import { voceRecenta, fataRecenta } from './adminLock.js'
import {
  execSharedAdminTool, SHARED_ADMIN_TOOLS,
  execUserScopedTool, USER_SCOPED_TOOLS,
} from './adminTools.js'
import { inventarulMeu } from './brainCapabilities.js'
import { evalueazaCerinta, imbunatatireContinua } from './cerinte.js'
import { notifyAdmin } from './adminNotification.js'
import { listeazaCerinte, actualizeazaCerinta, arhiveazaBuildJobsVechi, cheltuitAziConstructor } from '../db.js'
import { isOpsPaused } from './runbooks.js'
import { autonomActiv } from './autonomActiv.js'
import { utcDay } from './timeContext.js'
import {
  browserOpen, browserClick, browserType, browserRead, browserBack,
  browserScroll, browserKey, browserClickAt, browserClose,
} from './browser.js'
import type { AnthropicTool } from './brainContract.js'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

/** WHO carries the task — and this is NOT a detail, it is the cause of a
 *  failure I almost sent to production (Jul 30).
 *
 *  There are TWO different hands, with different tools:
 *    • THE CONSTRUCTOR (the VPS agent, `deploy/constructor-agent.mjs`) has
 *      exactly 7 tools: ls, grep, read, write, edit, run, finish. It writes CODE
 *      and opens PRs. It has NO browser. It cannot set secrets.
 *    • KELION ITSELF (the application's brain) has the live browser (9 tools)
 *      and, as of today, `secret_pune`/`secret_lista`/`secret_publica`.
 *
 *  A portal step sent to the constructor would have failed three times in a
 *  row, on the owner's money, and ended "blocked" — because we were asking an
 *  agent without a browser to enter a site. That is why every step says
 *  EXPLICITLY who carries it, and the loop sends it where the tools exist. */
type Executant = 'maini' | 'constructor'

/** A mission step, or a row from the owner's list — the same to the loop. */
interface Sarcina {
  /** The key we remember it by: `M1`, `B8`… */
  cod: string
  /** The short title — appears in the panel and journal. */
  titlu: string
  /** The complete order. The executor sees NOTHING else. */
  ordin: string
  /** Who carries it: Kelion's hands (browser + secrets) or the constructor (code). */
  executant: Executant
  /** HOW HARD it is, 1..5. It goes into the order as "NIVEL DE DIFICULTATE:
   *  N/5", and the constructor chooses its HAND accordingly: a big model for a
   *  hard task, a free one for a trivial task. No marker → 3 (medium), on the
   *  safe side. */
  dificultate?: number
  /** How completion is PROVEN — a measurement, not its word.
   *  Returns `true` only if the thing really happened. */
  dovada?: () => Promise<boolean>
  /** CAN IT BE TAKEN NOW? Not "is it allowed" — CAN it. A step requiring the
   *  owner's voice window cannot be done at 3 AM, no matter how much freedom
   *  it has.
   *
   *  Without this gate, the card step (M6) would have been chosen on every
   *  pass — it is the least attempted, so first in line — would have failed on
   *  "I did not recognize your voice", and would have starved ALL the rest:
   *  the mission, the requirements, the gaps. A step impossible right now is
   *  not a task; it is a loop. */
  poate?: () => boolean | Promise<boolean>
}

/** Do the keys really exist in the repo secrets? (measurement, not claim) */

/** A repo file, tried on the same paths the RAMAS reader uses. `null` = not
 *  readable — a proof that depends on it stays UNPROVEN, it never guesses. */
async function fisierDinRepo(rel: string): Promise<string | null> {
  for (const baza of [process.cwd(), path.resolve(process.cwd(), '..'), '/root/kelion/repo']) {
    const text = await readFile(path.resolve(baza, rel), 'utf8').catch(() => '')
    if (text) return text
  }
  return null
}

// ── THE MEASURED PROOFS OF M2–M5 (Aug 2) ────────────────────────────────────
// The constructor's 'done' means "a PR was opened and CI wasn't red" — the
// code may not even be merged, let alone deployed. These measure the RUNNING
// server (the database answers) and the shipped sources instead; a step with
// a proof closes ONLY when the proof passes.
/** M2: the net + the codes actually answer from THIS server's database.
 *  `rezumatPlati` returns null when any of its queries fails (missing table
 *  included) — so a non-null answer is the table existing, measured. */
async function plasaRaspunde(): Promise<boolean> {
  return (await rezumatPlati().catch(() => null)) !== null
}
/** M3: the data layer answers AND the panel actually renders it.
 *  MARKER CORECTAT (5 aug, auditul „autonomia nu mai vine"): verifica
 *  `'payNetHead'` — dar ăsta e doar NUMELE unei chei i18n în adminText.ts, NU
 *  apare în AdminPanel.tsx (panoul afișează hardcodat „🕸 Plăți Neatribuite",
 *  AdminPanel.tsx:1476). Din cauza asta M3 nu devenea NICIODATĂ `gata`, deși
 *  panoul e livrat și LIVE — iar M3 ne-gata ținea `misiuneGata` false, deci
 *  bucla nu ajungea niciodată la lista ownerului. Marker → string care CHIAR
 *  există în panou. */
async function panoulPlatilorExista(): Promise<boolean> {
  if (!(await plasaRaspunde())) return false
  const panou = await fisierDinRepo('frontend/src/components/AdminPanel.tsx')
  return panou !== null && panou.includes('Neatribuite')
}
/** M4: the payment code is truly SHOWN to the user (both payment surfaces). */
async function codulSeArata(): Promise<boolean> {
  const portofel = await fisierDinRepo('frontend/src/components/WalletButton.tsx')
  const credite = await fisierDinRepo('frontend/src/pages/Credits.tsx')
  return portofel !== null && portofel.includes('pay-code-big') && credite !== null && credite.includes('pay-code-big')
}
/** M5: the end-to-end money test exists in the shipped sources. */
async function probaCapCoadaExista(): Promise<boolean> {
  return (await fisierDinRepo('backend/src/fluxBaniCapCoada.test.ts')) !== null
}

/** What we remember about a step between passes. */
interface StarePas {
  /** The order opened for this step (0 = none right now). */
  job: number
  /** How many times we handed out the step (including repairs). */
  incercari: number
  /** Finished successfully — we do not touch it again. */
  gata?: boolean
  /** PARCAT (Adrian, 4 aug: „tot ce pică și nu mai e de actualitate să nu mai
   *  rămână"): după LIMITA_INCERCARI eșecuri, oprim reluarea la nesfârșit —
   *  nu mai umplem auditul cu același ordin căzut de 18 ori. NU mai e „pe veci":
   *  se de-parchează SINGUR când se schimbă lumea (vezi `semnatura` + fix #2). */
  blocat?: boolean
  /** SEMNĂTURA LUMII la clipa parcării (versiune publicată + chei + reușite).
   *  Cât rămâne aceeași, parcarea ține (o reîncercare ar da exact același eșec).
   *  Când se schimbă (deploy nou / cheie nouă / o reușită), pasul se de-parchează
   *  și primește O încercare nouă, cu abordare schimbată. Lipsă = parcat înainte
   *  de fix → se de-parchează o dată. */
  semnatura?: string
}

// Câte reîncercări dăm unei sarcini înainte s-o PARCĂM (nu abandonăm de tot —
// o parcăm, ca să nu curgă la infinit în audit). Owner-ul a inversat regula
// veche „never abandon" pe 4 aug: ce pică de zeci de ori și nu mai e de
// actualitate nu trebuie să rămână.
const LIMITA_INCERCARI = 6

// ── THE MISSION: THE REVOLUT PART, END TO END ────────────────────────────────
//
// Adrian, Jul 30: "his autonomy theme will be to do the whole Revolut part;
// when that works, he's autonomous." So the test is not "opened a PR" — it's
// "the user pays and gets the credits on his own, without anyone lifting a
// finger."
//
// What's ALREADY written (not redone): the unique `KLN-XXXX-XXXX` codes, the
// `payment_codes` table, matching the code from the reference, idempotent
// crediting (`topUpUser`), and the Enable Banking reader
// (`services/openBanking.ts` — GoCardless closed new signups end-2025; only
// history mentions it now).
//
// What's MISSING, and why it doesn't work: **the link through which the app
// FINDS OUT that money came in.** The bank reader requires an account on a
// foreign portal, with consent expiring in 30-90 days — the owner closed it
// after the portal gave him 502s and a broken login, and he's right. The path
// that requires NO new account: **the Revolut email**, which the app already
// reads (`mailbox.ts`, the contact@kelionai.app mailbox).
//
// The steps below are exactly that path, in buildable order.
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
    // HIS HANDS: needs secret_pune/secret_publica. The constructor doesn't have them.
    executant: 'maini',
    dificultate: 4, // configuration on external services, touches the keys

    // Proof, not the claim — measured on the RUNNING SERVER, not on GitHub
    // secret NAMES (VPS truth, 2 aug: the env has REVOLUT_PAY_LINK while the
    // GitHub secret is called REVOLUT_PAY — the same alias disease as the
    // 30 iul config.ts lesson, one layer up; the old check could NEVER pass).
    dovada: () => Promise.resolve(!!config.revolut?.payLink),
  },
  {
    cod: 'M1',
    titlu: 'Cheile Enable Banking + contul legat — citirea plăților pe verde',
    ordin:
      `MISIUNE REVOLUT, pasul 1 — FURNIZORUL S-A SCHIMBAT, ȘI DE CE.\n\n` +
      `31 iul 2026, dovadă pe viu: GoCardless Bank Account Data (fostul Nordigen) scrie ` +
      `„New signups are currently disabled" — a ÎNCHIS conturile noi la final de 2025 și ` +
      `închide serviciul treptat. Emailul din 31 iul („account setup complete, payouts ` +
      `enabled") era de la manage.gocardless.com — ALT produs (Direct Debit), o capcană ` +
      `în care a căzut și AI-ul anterior: acolo NU există cheile de care avem nevoie.\n\n` +
      `Furnizorul actual e ENABLE BANKING (enablebanking.com) — gratuit pentru citirea ` +
      `contului propriu („Restricted Production"). Codul cititorului e deja rescris pe ` +
      `API-ul lor (openBanking.ts). Tu verifici și repari, nu cauți portalul.\n\n` +
      `CE AI DE FĂCUT, EXACT:\n` +
      `  1. secret_lista — vezi dacă ENABLE_BANKING_APP_ID și ENABLE_BANKING_PRIVATE_KEY_B64 ` +
      `     sunt puse. Dacă lipsesc: înregistrarea aplicației cere emailul titularului — ` +
      `     scrie „AȘTEPT APROBAREA: aplicația Enable Banking se înregistrează de titular" ` +
      `     și oprește-te. NU o face în locul lui.\n` +
      `  2. Dacă cheile sunt puse: admin_vezi money-circuit → câmpul citirePlati. ` +
      `     Dacă scrie „nu e legat contul": legarea se face cu consimțământul titularului ` +
      `     prin POST /api/admin/plati/legatura/start (întoarce URL-ul de deschis) apoi ` +
      `     /finalizeaza cu codul din URL-ul de întoarcere. Consimțământul îl dă DOAR ` +
      `     titularul, în aplicația Revolut — tu îi dai linkul și-i spui unde să apese.\n` +
      `  3. VERIFICĂ, nu presupune: după legare, citirePlati trebuie să scrie verde ` +
      `     („N intrări citite"). Dacă scrie „consimțământul poate fi expirat" — PSD2 ` +
      `     expiră la max. 90 zile, se reface cu aceleași două rute.\n\n` +
      `DE CE CONTEAZĂ: fără chei + cont legat, startCitirePlati() iese pe loc și TOT ` +
      `lanțul rămâne teoretic — userul plătește, banii intră la owner, creditele nu apar ` +
      `NICIODATĂ singure. Lanțul e probat în fluxPlati.test.ts. Nu mai e nimic de ` +
      `construit acolo — e de ținut verde.\n\n` +
      `INTERZIS, decis de owner, nu se renegociază: NU prin email (plata nu se citește din ` +
      `inbox). NU tastezi parole și nu le ceri. Valorile cheilor nu se repetă, nu ajung pe ` +
      `monitor, nu se scriu în repo.`,
    executant: 'maini',
    dificultate: 4,

    // Proof: the RUNNING server sees both keys (same server-truth rule as M0;
    // measured 2 aug on the VPS: the private key EXISTS — 4364 chars — only
    // the app id is missing, so this reads the exact remaining gap).
    dovada: () => Promise.resolve(!!(config.enableBanking?.appId && config.enableBanking?.privateKeyB64)),
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
    dificultate: 4, // touches money: a mistake here credits the wrong person
    // PROOF (Aug 2): the net's queries answer from THIS server's database.
    dovada: plasaRaspunde,
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
    dovada: panoulPlatilorExista,
  },
  {
    cod: 'M4',
    titlu: 'Userul: apasă, plătește, primește creditele — live, fără refresh',
    ordin:
      `MISIUNE REVOLUT, pasul 4 din 5 — CAPĂTUL DINSPRE CLIENT.\n\n` +
      `Ruta /api/billing/checkout dă deja {url, code, amount, currency} — linkul Revolut al ` +
      `ownerului plus codul unic. Ce lipsește e drumul văzut de om, cap-coadă:\n` +
      `  • sume la alegere, nu una singură — preseturi + sumă liberă, în acord cu regula ` +
      `    VIE din validateTopUp (routes/billing.ts): o sumă pe care serverul ar respinge-o ` +
      `    nu se oferă în interfață (regula se citește din cod, nu se copiază aici);\n` +
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
    dovada: codulSeArata,
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
    dovada: probaCapCoadaExista,
  },
  {
    cod: 'M6',
    titlu: 'Cardul la furnizori și PLĂȚILE AUTOMATE — ca să nu te mai oprești niciodată',
    ordin:
      `MISIUNEA CARE DOVEDEȘTE AUTONOMIA — PLĂȚILE AUTOMATE.\n\n` +
      `Adrian, 31 iul: „a pus cardul la furnizori? a setat tot?" · „asta era cerința care ` +
      `dovedea autonomia reală" · „plățile automate".\n\n` +
      `SCOPUL NU E „am completat formularul". Scopul e ca furnizorul să se încaseze SINGUR ` +
      `— reîncărcare automată pornită — ca tu să nu rămâi niciodată fără credit și ownerul ` +
      `să nu apese nimic. Un card pus fără plata automată nu rezolvă nimic: peste o lună ` +
      `taci din nou, iar el află din faptul că nu-i mai răspunzi.\n\n` +
      `POARTA, cerută de owner: „să opereze pentru mine când îi cer DOAR EU, folosind ` +
      `sistemul de recunoaștere vocală." Uneltele de card refuză singure dacă vocea lui ` +
      `nu a fost recunoscută în ultimele 15 minute. Deci pasul ăsta NU se face în bucla de ` +
      `noapte — se face când îți cere el, cu vocea. Dacă bucla te aduce aici și fereastra ` +
      `de voce e închisă, card_stare ți-o spune: atunci raportezi ce lipsește și te oprești, ` +
      `nu forțezi.\n\n` +
      `CUM, EXACT:\n` +
      `  1. card_stare — vezi ce câmpuri sunt configurate pe server și dacă vocea lui e ` +
      `     recunoscută acum. Dacă nu e: spui atât, și te oprești.\n` +
      `  2. browser_open pe pagina de facturare a furnizorului (aistudio.google.com / ` +
      `     console.cloud.google.com → Billing, serper.dev → Billing), browser_read ` +
      `     ca să vezi câmpurile numerotate.\n` +
      `  3. card_completeaza, câmp cu câmp: numar, expirare, cvc, nume, cod_postal. TU NU ` +
      `     PRIMEȘTI VALOAREA și nu ai ce cere — spui doar CE câmp și ÎN CE index. Serverul ` +
      `     scrie. Din prima scriere, pagina nu mai ajunge pe monitor și cifrele sunt mascate.\n` +
      `  4. Trimiți formularul (browser_click pe butonul de salvare).\n` +
      `  5. PORNEȘTI REÎNCĂRCAREA AUTOMATĂ: „Auto-recharge" / „Auto top-up" / „Automatic ` +
      `     payments" — comutatorul, plus pragul și suma dacă le cere („când soldul scade ` +
      `     sub X, încarcă Y"). ĂSTA e pasul care contează.\n` +
      `  6. card_gata cu numele furnizorului. Serverul CITEȘTE el pagina și îți spune dacă ` +
      `     vede card la dosar ȘI plată automată. Dacă nu vede plata automată, nu te-ai ` +
      `     terminat treaba: o pornești și chemi din nou card_gata.\n\n` +
      `CE NU FACI, NICIODATĂ: nu ceri numărul cardului nimănui, nu-l repeți, nu-l scrii ` +
      `într-un fișier și nu-l pui într-un secret — uneltele mele refuză din construcție ` +
      `orice arată a card. Valorile se pun O SINGURĂ DATĂ, de mâna ownerului, ca secrete ` +
      `(CARD_NUMAR, CARD_EXPIRARE, CARD_CVC, CARD_NUME, CARD_COD_POSTAL). Nu tastezi parole.`,
    // HIS HANDS: browser + card tools. The constructor has neither the page nor
    // the voice window — a card order sent to it would be guaranteed to fail.
    executant: 'maini',
    dificultate: 5, // foreign payment page, voice guard, real money

    // PROOF: not "said he put the card", but what the code MEASURED on the
    // provider's page at session close — automatic payment turned on.
    dovada: platiAutomatePornite,

    // CAN ONLY BE TAKEN while BOTH biometric windows are open — voce ȘI față
    // (Adrian, 5 aug: „adaugă verificare față"). Exact ca poarta din cardFurnizor:
    // trei factori (admin + voce + față). Altfel bucla îl sare, nu-l arde în
    // încercări eșuate (fereastra de card oricum l-ar refuza).
    poate: () => voceRecenta(config.adminEmail) && fataRecenta(config.adminEmail),
  },
]

/** The last pass — the panel can tell whether the loop is actually working. */
let ultima: { la: string; ok: boolean; detaliu: string } | null = null
export function stareAutonomie(): { la: string; ok: boolean; detaliu: string } | null {
  return ultima
}

/** Reads the owner's list and returns the UNRESOLVED rows, as tasks.
 *
 *  The format is a Markdown table: `| B8 | **title** | status... |`. Resolved
 *  rows contain "✅" — we skip those. */
async function randuriDeFacut(): Promise<Sarcina[]> {
  // The file lives in the project root; in the container, the source sits next to `dist`.
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
    if (/✅/.test(linie)) continue // resolved → we don't touch it again
    const [, cod, titluBrut, rest] = m
    const titlu = titluBrut.replace(/\*\*/g, '').trim()
    if (!titlu) continue
    const context = `${titlu} — ${rest.replace(/\|/g, ' ').trim()}`.slice(0, 1800)
    // List rows are CODE work — they go to the constructor. If one asks for a
    // portal or keys, the order tells it to open a PR with the analysis, not to
    // struggle with tools it doesn't have.
    out.push({
      cod,
      titlu,
      executant: 'constructor',
      ordin: `SARCINĂ LUATĂ SINGUR din RAMAS-DE-FACUT.md, rândul ${cod}.\n\n${context}`,
    })
  }
  return out
}

// ── WHAT HE LACKS, TAKEN BY HIM AND BUILT ────────────────────────────────────
//
// Adrian, Jul 30: "autonomy also means the ability to see what he's missing,
// plus extended autonomous capabilities for learning and development."
//
// Half already existed and worked: when a user asks for something Kelion can't
// do, it gets written to `capability_gaps` (the `log_unsupported_request`
// tool), and `triageGaps()` has him triage his own list — "DE IMPLEMENTAT" or
// closed as a duplicate.
//
// The broken half came after: NOBODY built what he marked "DE IMPLEMENTAT".
// The list sat there. So he saw what he lacked but didn't develop — exactly
// the gap he named. From here on, what he marked himself becomes work he takes
// himself. The circle closes: sees → builds → can.
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

// ── CHANGE THE APPROACH FROM THE FIRST RETRY, NOT THE THIRD ──────────────────
//
// Adrian, Jul 30: "after 3 he must look for solutions, go out, identify
// solutions, study the problem, install himself various tools — under no
// circumstances abandon or sit in a loop."
//
// Adrian, Jul 31, sharper: "I don't think that after 2 rounds he has any
// chance in the third of solving something, if he doesn't change the approach
// — even after the first."
//
// He's right, and the threshold of 3 was mine, not his. A plan that failed
// once doesn't become good because you repeat it on a pricier model: it's the
// same mistake, paid more. What must change on RETRY is the PATH, not the
// hand. That's why the method-change demand kicks in from the FIRST retry, and
// the better model stays just a helper on top, not the strategy.
export function escaladare(incercariDeja: number): string {
  if (incercariDeja < 1) return ''
  return (
    `⚠ AI ÎNCERCAT DEJA DE ${incercariDeja} ${incercariDeja === 1 ? 'DATĂ' : 'ORI'} ȘI N-A IEȘIT. ` +
    `SCRIE ÎNTÂI, ÎN PRIMUL RÂND AL RĂSPUNSULUI, CE FACI ALTFEL DE DATA ASTA — dacă nu poți ` +
    `numi diferența, înseamnă că repeți, iar repetarea a fost deja plătită și n-a mers. ` +
    `NU repeta ce ai făcut — ` +
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

// ── THE OWNER'S REQUIREMENTS: analysis before code, then execution ───────────
//
// Adrian, Jul 30: "advanced requirement-management systems, advanced
// evaluations of the offered solutions". This is where it ties into the loop:
// a NEW requirement doesn't go to building — first the options are laid on the
// table and one is chosen, with a reason. Only the ANALYZED one becomes an
// order, and it ships with the chosen variant and the acceptance criterion
// glued to it, so the target doesn't move after delivery.
async function cerinteDeDus(): Promise<Sarcina[]> {
  const analizate = await listeazaCerinte('analizata', 20).catch(() => [])
  return analizate.map((c) => ({
    cod: `C${c.id}`,
    titlu: c.text.slice(0, 90),
    executant: 'constructor' as Executant,
    // The level HE set at evaluation, together with the chosen variant.
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

/** The rules glued to EVERY order — same for the mission and for the list. */
function cuRegulile(ordin: string, dificultate = 3): string {
  const niv = Math.max(1, Math.min(5, Math.round(Number(dificultate) || 3)))
  return (
    // THE MARKER THAT PICKS THE HAND (Adrian, Jul 30: "by difficulty level,
    // set automatically per requirement"). The constructor reads it BEFORE it
    // starts and picks the right model — not after it has already burned half
    // the budget finding out the hard way that it was heavy.
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

/** How many autonomous orders were given TODAY (the daily count). */
async function dateAzi(): Promise<number> {
  const azi = utcDay()
  const raw = await loadKv(`autonomie:zi:${azi}`).catch(() => null)
  return Number(raw ?? 0) || 0
}

async function citesteStare(cod: string): Promise<StarePas> {
  const raw = await loadKv(`autonomie:pas:${cod}`).catch(() => null)
  if (!raw) return { job: 0, incercari: 0 }
  try {
    const v = JSON.parse(raw) as Partial<StarePas>
    return { job: Number(v.job ?? 0) || 0, incercari: Number(v.incercari ?? 0) || 0, gata: v.gata, blocat: v.blocat, semnatura: v.semnatura }
  } catch {
    return { job: 0, incercari: 0 }
  }
}

async function scrieStare(cod: string, s: StarePas): Promise<void> {
  await saveKv(`autonomie:pas:${cod}`, JSON.stringify(s)).catch(() => {})
}

/** What came out of the order given for this step: done, failed (with log), or nothing yet. */
function verdict(job: BuildJob | undefined): 'gata' | 'picat' | 'inLucru' {
  if (!job) return 'inLucru' // can't find it anymore (short list) → we assume nothing
  if (job.status === 'done') return 'gata'
  if (job.status === 'failed') return 'picat'
  return 'inLucru'
}

// ── HIS HANDS: BROWSER + SECRETS, WITHOUT ANY HUMAN IN THE LOOP ──────────────
//
// The constructor writes code. But a portal doesn't open with `write` and a
// key doesn't get set with `edit`. For those steps, the order NO LONGER goes
// to the queue — it runs HERE, in the app, with exactly the tools Kelion has
// in a conversation: the 9 browser tools and the 3 secret tools. The
// difference from a normal turn is that nobody talks to it: the prompt is the
// mission order.
let mainileOcupate = false

/** Runs the real tools — the same functions the chat calls.
 *
 *  EXPORTED because TWO mouths use it: the loop here, and the CONSTRUCTOR on
 *  the VPS, through `/api/constructor/tool` (Adrian, Jul 30: "I asked for
 *  fully equipped agents and you gave them only trinkets"). He was right: the
 *  constructor had 7 tools and no browser. A second copy of the dispatch would
 *  have diverged in two days — so a single one, here. */
export async function uneltele(name: string, args: Record<string, unknown>): Promise<string> {
  const email = config.adminEmail
  const baseUrl = 'https://kelionai.app'
  // The WHOLE admin set, not a hand-written list (Adrian, Jul 30: "all of
  // them, he must be fully equipped"). `SHARED_ADMIN_TOOLS` is the single
  // source — if a new tool appears there tomorrow, he has it too, without
  // anyone touching this file.
  if (SHARED_ADMIN_TOOLS.has(name)) {
    return (await execSharedAdminTool(name, args, { email, baseUrl })) ?? JSON.stringify({ error: 'unealtă necunoscută' })
  }
  // THE TOOLS TIED TO HIM (memory, notes, server logs, cost, mailbox,
  // propose_tool). Adrian, Jul 31: "75 capabilities on chat, he must really
  // get all of them." These need nothing from the HTTP request — only who the
  // user is — so they had no real reason to be missing when he works alone.
  // Without them he remembers nothing from one turn to the next.
  if (USER_SCOPED_TOOLS.has(name)) {
    const r = await execUserScopedTool(name, args, email, true)
    if (r !== null) return r
  }
  // The page comes back as text + numbered elements; we trim it so a big page
  // doesn't eat the brain's whole context window.
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
    // ── AGENȚII, ȘI PENTRU CONSTRUCTOR (10 aug, ownerul: „constructorul să
    // folosească la nevoie automat toți agenții"; „când îi lipsește un TIP de
    // agent, îl creează automat, verifică și dă deploy") ─────────────────────
    // Logica unică e în agentiKelion.ts (executa*) — aici doar o chemăm. Import
    // dinamic: agentiKelion ar închide un ciclu la evaluarea modulului (lecția
    // 2 aug); la RULARE e sigur.
    case 'cheama_agent': {
      const { executaCheamaAgent } = await import('./agentiKelion.js')
      const r = await executaCheamaAgent(String(args.agent ?? ''), String(args.sarcina ?? ''), true)
      return r.json.slice(0, 20_000)
    }
    case 'agent_nou': {
      const { executaAgentNou } = await import('./agentiKelion.js')
      return executaAgentNou(String(args.nume ?? ''), String(args.rol ?? ''), args.doarAdmin === true)
    }
    default: return JSON.stringify({ error: `unealtă necunoscută: ${name}` })
  }
}

// ── SELF-VERIFICATION: "delivered" does not mean "works" ─────────────────────
//
// Everything "finished" today, *I* proved, by hand, with curl. That doesn't
// scale and, worse, it's exactly how "the chat is mute" slipped through: a
// finished order, a green PR, and the app silent on live.
//
// Here the DELIVERED requirement proves itself, with the real tools — browser
// on the live site, database query, app health — against the CRITERION written
// before delivery. It moves to "verified" ONLY on what it measured; otherwise
// it goes back to work, with what it found. The owner's rule #1, applied to
// our own records.
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
    // BUCLA ÎNCHISĂ (P4; owner, 15 aug): verdictul ajunge LA OM — panou + push
    // pe telefon (notifyAdmin poartă deja pushTelefon) — nu doar în coloana
    // de stare, unde îl vede doar cine deschide tabelul.
    void notifyAdmin('cerinta_live', `Cerința #${c.id} e LIVE`, spus.slice(0, 180), {
      cerinta: c.id,
      dovada: spus.slice(0, 500),
    }).catch(() => {})
    return { pornit: true, motiv: `cerința #${c.id} — VERIFICATĂ pe live: ${spus.slice(10, 160)}` }
  }
  // Didn't pass → back to work, with what it found. Not declared done.
  await actualizeazaCerinta(c.id, { stare: 'analizata', dovada: spus.slice(0, 2000) }).catch(() => {})
  // Și căderea probei se SPUNE (P4): „a murit pe live" e mai important pentru
  // om decât „e verde" — altfel află abia când se lovește de ea.
  void notifyAdmin('cerinta_picata', `Cerința #${c.id} a picat proba pe live`, spus.slice(0, 180), {
    cerinta: c.id,
    vazut: spus.slice(0, 500),
  }).catch(() => {})
  return { pornit: true, motiv: `cerința #${c.id} — n-a trecut proba, o reia: ${spus.slice(0, 160)}` }
}

// ── WHEN EVERYTHING YOU HAND OUT FAILS, THE PROBLEM IS NO LONGER IN THE ORDER ──
//
// Adrian, Jul 31, four question marks: "how does it retry or what happens
// with the failed ones? what's the logic????"
//
// The retry logic EXISTED and worked: a failed order is handed back with the
// failure log glued on, the difficulty rises with each attempt, after 3 it
// goes out and searches, it never abandons. Visible in the panel: #20 → #24,
// second attempt.
//
// What was MISSING is simpler and graver: **nobody looked at the pattern.**
// Ten orders in a row (#15…#24), zero finished — and the loop calmly handed
// out the eleventh. When ALL of them fail, the problem is no longer in the
// next order; it's in the hand that executes. Insisting means paying ten times
// for the same failure.
//
// What it does from now on: it does NOT stop working (that would be a barrier,
// and he rightly forbade it) — it CHANGES the target. Instead of the eleventh
// identical order to the constructor that just failed ten times, it issues a
// DIAGNOSTIC order, carried by HIS HANDS: "find out why they all fail, fix the
// cause". The hands have browser, logs and secrets; the constructor is the
// broken one. It abandons nothing — it just stops hitting the same wall.

/** How many consecutive failed orders, with NO success, before it changes target.
 *
 *  TWO, not five. Adrian, Jul 31: "I don't think that after 2 rounds he has
 *  any chance in the third of solving something, if he doesn't change the
 *  approach". The threshold of 5 was mine and meant five paid failures before
 *  I noticed the pattern. */
const PRAG_ESEC = 2

/** The world's signature — WHAT could change enough to make a new attempt worthwhile.
 *
 *  Computed for FREE (nothing in the process costs tokens): the published
 *  version, how many keys the process sees, how many orders ever succeeded.
 *  As long as the signature is the same, a retry would produce exactly the
 *  same result — so nothing gets spent on it. When it changes (you published
 *  new code, a key appeared, something succeeded), the wall falls on its own
 *  and work restarts. */
function semnaturaLumii(cateReusite: number): string {
  const versiune = (process.env.GIT_COMMIT_SHA ?? '').slice(0, 7)
  const chei = Object.keys(process.env).filter((k) => /_KEY$|_SECRET$|_TOKEN$|_URL$|^CARD_/.test(k)).length
  return `${versiune}|${chei}|${cateReusite}`
}

/** What we remember about a wall, between passes. */
interface StareZid {
  cate: number
  cauza: string
  cand: string
  /** The world, as it was when the wall went up. */
  semnatura: string
  /** The diagnostic already ran — it costs, so it does NOT repeat on the same wall. */
  diagnosticat: boolean
  /** What the diagnostic found, so it shows in the panel without asking again. */
  raport: string
}

async function citesteZid(): Promise<StareZid | null> {
  try {
    const raw = await loadKv('autonomie:zid')
    return raw ? (JSON.parse(raw) as StareZid) : null
  } catch {
    return null
  }
}

/** What repeats in the failure logs — the COMMON cause, not the latest error.
 *
 *  We normalize each line (strip the digits, which differ from job to job)
 *  and count. What appears in the most logs is the cause; a single line that
 *  appears in one log is noise. */
function cauzaComuna(picate: BuildJob[]): string {
  const nr = new Map<string, { n: number; exemplu: string }>()
  for (const j of picate) {
    const randuri = (j.log ?? '')
      .split('\n')
      .map((r) => r.trim())
      .filter((r) => r.length > 20 && /eroare|error|failed|refuz|refus|timeout|429|4\d\d|5\d\d|nu (pot|poate|are)/i.test(r))
    // A single vote per job, otherwise a long log wins on its own.
    const vazute = new Set<string>()
    for (const r of randuri) {
      const cheie = r.replace(/\d+/g, '#').slice(0, 120)
      if (vazute.has(cheie)) continue
      vazute.add(cheie)
      const e = nr.get(cheie) ?? { n: 0, exemplu: r.slice(0, 200) }
      e.n += 1
      nr.set(cheie, e)
    }
  }
  const top = [...nr.values()].sort((a, b) => b.n - a.n)[0]
  if (!top || top.n < 2) return ''
  return `„${top.exemplu}" — în ${top.n} din ${picate.length} jurnale`
}

/** Orders started by the loop (not by a human), newest first. */
function aleBuclei(jobs: BuildJob[]): BuildJob[] {
  return jobs.filter((j) => String(j.orderedBy ?? '').toLowerCase().startsWith('kelion'))
}

/** Did all recent orders fail? Then we don't hand out the eleventh one the same way.
 *
 *  `granita` = the highest loop-job id at the moment the LAST wall fell. The
 *  streak counts ONLY orders newer than it. Without the boundary the wall was
 *  a deadlock, measured live (2-3 aug): the historical streak of failures
 *  never changes on a new sha, so every world change burned one diagnostic
 *  turn and re-walled — and since the wall hands out no orders, nothing could
 *  ever become 'done' to break the streak. "The wall falls and work restarts"
 *  (the spec above) requires the COUNT to restart too, not just the kv row. */
function zidul(jobs: BuildJob[], granita = 0): { blocat: boolean; cate: number; cauza: string } {
  const ale = aleBuclei(jobs).filter(
    (j) => (j.status === 'done' || j.status === 'failed') && Number(j.id ?? 0) > granita,
  )
  const consecutive: BuildJob[] = []
  for (const j of ale) {
    if (j.status === 'done') break // a success breaks the streak — no longer a wall
    consecutive.push(j)
  }
  return consecutive.length >= PRAG_ESEC
    ? { blocat: true, cate: consecutive.length, cauza: cauzaComuna(consecutive) }
    : { blocat: false, cate: consecutive.length, cauza: '' }
}

/** A work turn of Kelion's, started by the loop, not by a human. */
/** The ladder for his hands, chosen by how heavy the task is.
 *
 *  The usual ladder starts with the WORK model. For a difficulty 4-5 task —
 *  a foreign portal, something that touches money — that means starting with
 *  the second hand and finding out only after the turns are wasted. Here we
 *  put the TOP at the head, and the rest of the ladder stays below as a net. */
function scaraPentru(dificultate = 3): string[] | undefined {
  if (dificultate < 4) return undefined // the usual ladder fits
  const top = config.brain.topDefault
  const restul = expertModelLadder()
  return top ? [top, ...restul.filter((m) => m !== top)] : restul
}

/** EVERYTHING his brain gets when working alone.
 *
 *  Adrian, Jul 31: "you must make sure that whatever brain gets swapped in
 *  always receives everything" · "the 75, consciously, for his brain,
 *  whichever one is put in".
 *
 *  That's why it's an EXPORTED constant, not a local list: the guard in
 *  `uneltePartajate.test.ts` compares it against what the executor knows how
 *  to run, and fails if the two diverge. The capabilities don't depend on
 *  which model is in today. */
export const UNELTELE_MAINILOR = [
  ...BROWSER_TOOLS,
  ...TOATE_UNELTELE_ADMIN,
  REPO_WRITE_TOOL, REPO_OPEN_PR_TOOL, REPO_MERGE_PR_TOOL,
  RUN_RUNBOOK_TOOL, RUNBOOK_STATUS_TOOL, RUNBOOK_LOG_TOOL, REQUEST_REPAIR_TOOL,
]

async function ruleazaCuMainile(s: Sarcina): Promise<string> {
  // ── EVERYTHING THE EXECUTOR KNOWS HOW TO ROUTE, NOT A LIST WRITTEN BY ME ────
  //
  // Adrian, Jul 31: "you're missing a few essential elements for Kelion's
  // capabilities, which are they?" This was the first one.
  //
  // `uneltele()` routes the WHOLE shared set. The list here had 15 of them:
  // the browser, the secrets, the card. Missing from its hand — although the
  // executor knows them — were read_source (to read its own code), db_query
  // (to query the database), system_health (to take its pulse),
  // repo_write/repo_open_pr (to write code and open PRs), runbook_log (to read
  // the failure log).
  //
  // Worse: `inventarulMeu()` in the prompt tells it it HAS them all. So it was
  // told "you have db_query", asked for it, and the tool wasn't in the list —
  // a "can't" for something the code underneath actually could do.
  //
  // That's why the list is no longer written by hand: it's DERIVED from what
  // the executor knows. If a new tool appears in the dispatcher tomorrow, he
  // has it too, without anyone touching this file.
  const tools = UNELTELE_MAINILOR as unknown as AnthropicTool[]
  const prompt =
    `${s.ordin}\n\n` +
    // AWARE OF WHAT HE HAS (Adrian, Jul 30): his complete inventory, derived
    // from the registry. An agent that doesn't know its tools says "can't" for
    // what it holds in its hand.
    `${inventarulMeu()}\n\n` +
    `CUM LUCREZI AICI: nu-ți vorbește nimeni, nu aștepți răspuns de la nimeni. ` +
    `Ai browserul (browser_open/read/click/type/scroll/key/click_at/back/close) și ` +
    `secretele (secret_lista/secret_pune/secret_publica). Le folosești. ` +
    `Începe cu secret_lista, ca să nu ceri ce ai deja.\n\n` +
    `Când termini, scrie în DOUĂ-TREI rânduri ce ai făcut și ce mai lipsește. ` +
    `Dacă ai nevoie de owner pentru un pas pe care legea îl cere doar de la el ` +
    `(aprobarea din aplicația bancară), scrie exact: „AȘTEPT APROBAREA: <ce anume>". ` +
    `NICIODATĂ valorile cheilor — doar numele lor.`
  return brainCompleteWithTools(prompt, tools, uneltele, {
    maxRounds: 30,
    maxTokens: 2500,
    models: scaraPentru(s.dificultate),
  })
}

/** One pass: repairs itself if it failed, otherwise takes the next task. */
// PLAFON ZILNIC DE ARDERE (Adrian, B8/K15: „contor real pe admin cu cât s-a
// construit zilnic, limitare automată, buton de oprit limita"). APROBAT explicit
// de owner (spre deosebire de plafonul scos pe 30 iul, pe care nu-l ceruse). Cifra
// + comutatorul se citesc din KV — le setezi din admin. Implicit PORNIT (a cerut
// limitarea automată); '0' pe comutator o stinge.
const PLAFON_USD_DEFAULT = 10
export async function plafonConstructor(): Promise<{ activ: boolean; plafon: number; cheltuit: number }> {
  const [activRaw, plafonRaw, cheltuit] = await Promise.all([
    loadKv('constructor:plafon_activ').catch(() => null),
    loadKv('constructor:plafon_usd').catch(() => null),
    cheltuitAziConstructor().catch(() => 0),
  ])
  const plafon = Number(plafonRaw) > 0 ? Number(plafonRaw) : PLAFON_USD_DEFAULT
  const activ = activRaw === null ? true : activRaw !== '0' && activRaw !== 'false'
  return { activ, plafon, cheltuit }
}

export async function poateSaLucreze(): Promise<{ pornit: boolean; motiv: string }> {
  // ── HIS SWITCH, CHECKED BEFORE ANYTHING ─────────────────────────────────────
  //
  // Adrian, Jul 31, morning: pressed "Stop" to cut a $27.84 spend in three and
  // a half hours, then asked — rightly — "first it must be verified that
  // autonomy is on stop". Good that he asked: it WASN'T.
  //
  // `isOpsPaused()` had existed in runbooks.ts since Jul 27. This loop never
  // looked at it, EVER. You pressed the button, `kelion_ops_paused=1` got
  // written to the database, the panel showed you "⏸ Autonomy is STOPPED by
  // you" — and the loop kept working, spending. A switch that doesn't switch
  // is worse than none: you believe you stopped, so you stop watching.
  //
  // Exactly his rule #1, in its most expensive form: the panel ASSERTED a
  // state nobody had measured. The check comes first, before any brain turn,
  // and costs one database read — zero tokens.
  // OFF BY DEFAULT (9 aug, ownerul: „off default, dacă nu trebuie nu se
  // autoactivează"). Comutatorul-master, verificat ÎNAINTE de orice tură de
  // creier: fără el pornit, bucla nu umple coada constructorului și nu cheltuie
  // niciun token. Separat de isOpsPaused (aia rămâne frâna clasică).
  if (!(await autonomActiv().catch(() => false))) {
    return { pornit: false, motiv: '⏹ autonomie OPRITĂ (implicit) — pornește-o din admin când e nevoie' }
  }
  if (await isOpsPaused().catch(() => false)) {
    return { pornit: false, motiv: '⏸ oprit de tine — nu fac nimic și nu cheltuiesc nimic' }
  }
  if (mainileOcupate) return { pornit: false, motiv: 'lucrează chiar acum cu browserul' }
  // null = coada necitibilă (auditul admin, 3 aug) — bucla nu pornește nimic
  // peste o coadă pe care n-a văzut-o.
  const jobs = (await listBuildJobs(40).catch(() => null)) ?? ([] as BuildJob[])
  const dupaId = new Map(jobs.map((j) => [j.id, j]))

  // 1. Already busy? One thing at a time — otherwise it finishes nothing.
  if (jobs.some((j) => j.status === 'running' || j.status === 'queued')) {
    return { pornit: false, motiv: 'are deja un ordin în lucru' }
  }

  // 1b. PLAFONUL ZILNIC DE ARDERE (B8/K15): dacă e activ și s-a atins, nu mai
  // pornim ordine azi — dar o SPUNEM clar, cu unde se oprește limita. Nu e o
  // barieră ascunsă: e cifra TA, cu buton de oprit, în admin.
  const pl = await plafonConstructor()
  if (pl.activ && pl.cheltuit >= pl.plafon) {
    return {
      pornit: false,
      motiv: `⛔ plafon zilnic de ardere atins: $${pl.cheltuit.toFixed(2)} din $${pl.plafon.toFixed(2)} — nu mai pornesc ordine azi (oprește limita din Admin → Constructor)`,
    }
  }

  // 2. THERE IS NO CAP. (Adrian, Jul 30: "if you put unwanted barriers,
  // unapproved by me, doesn't that mean you're sabotaging my work?" · "I pay,
  // I ask, you execute without commenting".) I had set a daily cap nobody
  // asked me for. It's removed. The orders-per-day count is kept only so the
  // panel can SHOW how many it gave — not to stop it.
  const azi = await dateAzi()

  // 3. The mission (the Revolut part) has priority; then the owner's list.
  // A step that requires the voice window (M6, the card) can NOT be taken at
  // night. We take it out of the equation instead of letting it block the
  // mission forever: otherwise "the mission isn't done" would have stayed
  // true forever, and the requirements and gaps would never have gotten a turn.
  const pasii = await Promise.all(
    MISIUNE.map(async (p) => ({
      p,
      st: await citesteStare(p.cod),
      poate: p.poate ? await Promise.resolve(p.poate()).catch(() => false) : true,
    })),
  )
  const misiuneGata = pasii.every((e) => e.st.gata || !e.poate)
  // After the mission: first WHAT HE LACKS (the gaps he triaged himself —
  // "sees what he's missing and develops"), then the rows from the owner's
  // list. THE TEST BEFORE ANYTHING ELSE: what's delivered but unverified is
  // not allowed to sit like that. "Delivered" doesn't mean "works" — see the
  // mute chat of Jul 30.
  if (!mainileOcupate) {
    mainileOcupate = true
    try {
      const v = await verificaLivrata().catch(() => null)
      if (v) return v
    } finally {
      mainileOcupate = false
    }
  }

  // ── THE WALL: if EVERYTHING I hand out fails, I don't hand out the eleventh
  // the same way. Not abandonment and not a cap: it's the change of target.
  // The constructor that failed N times in a row doesn't get repaired by
  // receiving order N+1 — it gets repaired by looking at what its logs say.
  // This order is carried by THE HANDS, which have browser and logs; the
  // constructor is the broken one.
  const zidVechi = await citesteZid()
  const reusite = aleBuclei(jobs).filter((j) => j.status === 'done').length
  const acum = semnaturaLumii(reusite)
  let granita = Number((await loadKv('autonomie:zid:granita').catch(() => null)) ?? 0) || 0

  // DID THE WALL FALL? Not because time passed — because SOMETHING CHANGED:
  // newly published code, an appeared key, a successful order. As long as the
  // world is identical, a retry would give identically the same failure.
  if (zidVechi && zidVechi.semnatura !== acum) {
    // The fall moves the COUNTING BOUNDARY too: "work restarts" means the new
    // world gets a fresh attempt, judged on ITS orders — not a re-diagnosis
    // of the streak from the old world. Measured live (2-3 aug): without the
    // boundary, every new sha burned one diagnostic turn and re-walled on the
    // same 11 historical failures, and since the wall hands out no orders,
    // nothing could ever break the streak — a deadlock dressed as prudence.
    granita = aleBuclei(jobs).reduce((mx, j) => Math.max(mx, Number(j.id ?? 0)), granita)
    await saveKv('autonomie:zid:granita', String(granita)).catch(() => {})
    await saveKv('autonomie:zid', '').catch(() => {})
  } else if (zidVechi) {
    // WALL STANDING, WORLD UNCHANGED → NOTHING GETS SPENT. Zero model calls,
    // zero orders. Adrian, Jul 31: "should it sit in a loop consuming?" No.
    // This pass costs exactly as much as a database query.
    return {
      pornit: false,
      motiv:
        `⏸ OPRIT pe zid, nu consum nimic: ${zidVechi.cate} ordine picate la rând, 0 reușite. ` +
        (zidVechi.cauza ? `Cauza care se repetă: ${zidVechi.cauza}. ` : '') +
        (zidVechi.raport ? `Diagnostic: ${zidVechi.raport.slice(0, 200)}. ` : '') +
        `Repornesc SINGUR când se schimbă ceva real — publici cod nou, apare o cheie, ` +
        `sau reușește un ordin. Până atunci, o reîncercare ar da exact același eșec, pe banii tăi.`,
    }
  }

  const zid = zidul(jobs, granita)
  if (zid.blocat && !mainileOcupate) {
    mainileOcupate = true
    try {
      const spus = await ruleazaCuMainile({
        cod: 'ZID',
        titlu: 'De ce pică TOATE ordinele',
        executant: 'maini',
        dificultate: 5,
        ordin:
          `OPREȘTE-TE DIN A MAI DA ORDINE ȘI AFLĂ DE CE PICĂ TOATE.\n\n` +
          `Ultimele ${zid.cate} ordine pornite de tine au picat, unul după altul, ZERO terminate. ` +
          `Când tot ce dai pică, problema nu mai e în ordinul următor — e în mâna care execută. ` +
          `Al ${zid.cate + 1}-lea ordin identic ar costa la fel de mult și ar pica la fel.\n\n` +
          (zid.cauza ? `CE SE REPETĂ ÎN JURNALE: ${zid.cauza}\n\n` : '') +
          `FĂ AȘA, în ordinea asta:\n` +
          `  1. server_logs (errorsOnly=false) și runbook_log pe ultimele ordine — citește ce a scris ` +
          `     lucrătorul când a căzut. Nu ghici din titlu.\n` +
          `  2. system_health — merge puntea de pe VPS? Are cheile? Are loc pe disc?\n` +
          `  3. db_query pe build_jobs: SELECT id, status, attempts, left(log, 400) FROM build_jobs ` +
          `     ORDER BY id DESC LIMIT 12 — vezi tiparul cu ochii tăi.\n` +
          `  4. Când ai găsit cauza REALĂ (una singură, nu o listă de bănuieli), REPAR-O: dacă e în ` +
          `     cod, deschide PR; dacă e o cheie lipsă, pune-o cu secret_pune; dacă e puntea moartă, ` +
          `     spune exact ce trebuie repornit.\n\n` +
          `RAPORTEAZĂ ÎN DOUĂ RÂNDURI: cauza, și ce ai făcut cu ea. Dacă n-o poți repara singur, ` +
          `scrie „AȘTEPT APROBAREA: <ce anume>" — dar numai după ce ai măsurat, nu în loc să măsori.`,
      }).catch((e: Error) => `a crăpat: ${e.message}`)
      // The diagnostic runs ONLY ONCE per wall. From the next pass on, the
      // branch above returns without spending anything — until the world
      // changes. Otherwise I wouldn't have stopped the loop, I'd just have
      // changed its label.
      const stare: StareZid = {
        cate: zid.cate,
        cauza: zid.cauza,
        cand: new Date().toISOString(),
        semnatura: acum,
        diagnosticat: true,
        raport: spus.slice(0, 1000),
      }
      await saveKv('autonomie:zid', JSON.stringify(stare)).catch(() => {})
      return {
        pornit: true,
        motiv:
          `ZID: ${zid.cate} ordine picate la rând, 0 reușite — am oprit ordinele și am căutat cauza. ` +
          `${spus.slice(0, 300)}`,
      }
    } finally {
      mainileOcupate = false
    }
  }

  // ANALYSIS BEFORE CODE: a new requirement gets evaluated first — options,
  // scores, one chosen with a reason. It's a cheap brain turn, not an order.
  const noi = await listeazaCerinte('noua', 5).catch(() => [])
  if (noi.length) {
    const r = await evalueazaCerinta(noi[0]).catch((e: Error) => ({ ok: false, detaliu: e.message }))
    return { pornit: r.ok, motiv: `cerința #${noi[0].id}: ${r.detaliu}` }
  }

  // THE OWNER'S REQUIREMENTS DON'T WAIT FOR THE MISSION TO CLOSE. Measured
  // live (3 aug): C1 was 'analizata' at 00:34 and structurally could NEVER
  // receive its order — this list was mission-only until every step closed,
  // while the analysis (a paid turn) had already been spent. Analysis with
  // money, delivery never. The mission keeps precedence at EQUAL attempts
  // (it's listed first and the sort below is stable); a thrice-failed step
  // yields its turn to fresh work and is still retried — the same
  // anti-starvation rule the mission already applies to itself. Only the
  // GENERAL list (gaps + RAMAS-DE-FACUT rows) stays behind the mission, as
  // designed on Jul 30 — behind pașii RULABILI ai misiunii, nu în spatele unei
  // misiuni întregi PARCATE. Măsurat pe 15 aug (dovada 6 „vede ce îi lipsește
  // și construiește" stătea gri; owner: „finalizeeaza si restul de 2 care nu
  // sunt bifate"): un pas de misiune parcat ținea `misiuneGata=false` la
  // nesfârșit deși el însuși nu rula — deci golurile triate „DE IMPLEMENTAT"
  // nu primeau NICIODATĂ rând. Aceeași regulă anti-înfometare de mai sus se
  // aplică și aici: când misiunea nu are NICIUN pas rulabil în tura asta,
  // lista generală intră la rând. Pașii parcați rămân în listă ca să se
  // DE-PARCHEZE singuri la schimbarea lumii — și atunci își reiau întâietatea
  // (sortarea stabilă îi ține primii).
  const misiuneRulabila = pasii.some((e) => e.poate && !e.st.gata && !e.st.blocat)
  const brute = [
    ...(misiuneGata ? [] : pasii.filter((e) => e.poate).map((e) => e.p)),
    ...(await cerinteDeDus()),
    ...(misiuneGata || !misiuneRulabila ? [...(await golurileLui()), ...(await randuriDeFacut())] : []),
  ]
  if (!brute.length) return { pornit: false, motiv: 'n-am ce lua: nici goluri, nici rânduri de listă' }

  // NOTHING GETS ABANDONED. Before, after 3 attempts the step was marked
  // "blocked" and given up on — a barrier nobody asked for. Now it's retried
  // forever; and so a heavy step doesn't starve the rest, tasks are taken in
  // "who was tried the fewest times" order. So it both insists and advances.
  const cuStare = await Promise.all(brute.map(async (x) => ({ x, st: await citesteStare(x.cod) })))
  // ── FIX #2 (Adrian, 5 aug: „ca el să nu mai pice ȘI să nu mai stea") ────────
  // Un pas PARCAT nu mai e blocat pe veci. Se de-parchează SINGUR când s-a
  // schimbat lumea (versiune nouă publicată / cheie nouă / o reușită) — exact
  // regula zidului: cât lumea e la fel, o reîncercare ar da același eșec, deci
  // parcarea ține; când lumea chiar s-a schimbat, primește O încercare nouă, cu
  // abordarea schimbată (`escaladare` intră singur, incercari=0 la re-armare).
  // Un pas parcat ÎNAINTE de fix (fără semnătură) se de-parchează o dată.
  for (const e of cuStare) {
    if (e.st.blocat && (!e.st.semnatura || e.st.semnatura !== acum)) {
      e.st = { job: 0, incercari: 0 }
      await scrieStare(e.x.cod, e.st)
      await saveKv(`autonomie:parcat:${e.x.cod}`, '').catch(() => {})
      console.log(`[AUTONOM] ${e.x.cod} DE-PARCAT — lumea s-a schimbat, primește o încercare nouă cu abordare schimbată`)
    }
  }
  // Sar peste cele GATA și peste cele PARCATE (4 aug) — parcatele nu mai intră
  // în rotație, deci nu mai nasc ordine căzute la infinit (dar se de-parchează la
  // schimbarea lumii, mai sus).
  const sarcini = cuStare.filter((e) => !e.st.gata && !e.st.blocat).sort((a, b) => a.st.incercari - b.st.incercari)

  for (const { x: s, st } of sarcini) {

    // It already gave an order on this task — what came of it?
    if (st.job && !dupaId.has(st.job)) {
      // AUDIT Aug 2: verdict(undefined) read as 'in progress' — a job fallen
      // out of the 40-row read window parked its step FOREVER on „aștept
      // ordinul #N". Unknown is unknown, not in-progress: free the slot so the
      // step can be retried, and say so in the log.
      console.log(`[AUTONOM] ordinul #${st.job} (${s.cod}) a ieșit din fereastra citită — pasul se eliberează`)
      await scrieStare(s.cod, { ...st, job: 0 })
      st.job = 0
    }
    if (st.job) {
      const v = verdict(dupaId.get(st.job))
      if (v === 'inLucru') return { pornit: false, motiv: `aștept ordinul #${st.job} (${s.cod})` }
      if (v === 'gata') {
        // MEASURED, NOT ASSUMED (Aug 2): a constructor 'done' = "a PR was
        // opened and CI wasn't red" — the code may still be waiting for the
        // owner's merge. A step WITH a proof closes only when the measurement
        // passes; until then the job stays attached and the check repeats on
        // every pass (after the merge deploys, the proof turns true here).
        if (s.dovada && !(await s.dovada().catch(() => false))) {
          console.log(
            `[AUTONOM] ${s.cod}: ordinul #${st.job} e 'done', dar măsurătoarea NU confirmă încă ` +
              `(PR-ul așteaptă probabil merge + publicare) — nu se marchează gata`,
          )
          continue
        }
        await scrieStare(s.cod, { ...st, job: 0, gata: true })
        // A built gap also gets closed in HIS list of lacks — otherwise he'd
        // retake it forever, or "can't" would stay written for something he can.
        if (/^G\d+$/.test(s.cod)) await setGapResolved(Number(s.cod.slice(1)), true).catch(() => {})
        // A carried requirement moves to "delivered" — NOT to "verified".
        // Verification requires a measurement on live, not the finishing of an
        // order. Rule #1.
        if (/^C\d+$/.test(s.cod)) {
          await actualizeazaCerinta(Number(s.cod.slice(1)), {
            stare: 'livrata',
            dovada: `ordinul #${st.job} s-a terminat; rămâne de VERIFICAT pe live`,
          }).catch(() => {})
        }
        console.log(`[AUTONOM] ${s.cod} („${s.titlu}") — gata, ordinul #${st.job}`)
        continue // move to the next task in the SAME pass
      }
      // FAILED → "must repair itself": we hand it BACK, with what it wrote
      // itself in the log when it fell. No maximum number of attempts — we
      // don't give up.
    }

    // PLAFONUL (4 aug): dacă sarcina asta a picat deja de LIMITA_INCERCARI ori,
    // n-o mai relansăm ACUM — o PARCĂM cu semnătura lumii. Altfel același ordin
    // cade la infinit (owner: #78-#89, încercarea 15-18) și umple auditul. NU mai
    // e pe veci: se de-parchează singur când se schimbă lumea (fix #2, sus).
    if (st.incercari >= LIMITA_INCERCARI) {
      // FIX #3 (măsurare, 5 aug): salvăm DE CE a picat — cauza comună din
      // jurnalele buclei — ca să NU dispară cu curățarea ordinelor vechi (până
      // acum, a doua zi nu se mai vedea de ce s-a parcat un pas). Persistat în kv,
      // vizibil în panou și în raportul de dimineață.
      const picateBuclei = aleBuclei(jobs).filter((j) => j.status === 'failed')
      const cauza =
        cauzaComuna(picateBuclei) ||
        (st.job ? ((dupaId.get(st.job)?.log ?? '').split('\n').filter((r) => r.trim()).slice(-1)[0] ?? '').slice(0, 200) : '')
      await saveKv(
        `autonomie:parcat:${s.cod}`,
        JSON.stringify({ titlu: s.titlu, cauza, incercari: st.incercari, cand: new Date().toISOString() }),
      ).catch(() => {})
      await scrieStare(s.cod, { ...st, job: 0, blocat: true, semnatura: acum })
      console.log(
        `[AUTONOM] ${s.cod} PARCAT după ${st.incercari} încercări — cauza: ${cauza.slice(0, 120)} (se de-parchează la schimbarea lumii)`,
      )
      continue
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
          // A task that already failed is, by definition, heavier than it
          // looked. We raise the level with each attempt — so the second time
          // it starts on a better hand, not the same one that just failed.
          Math.min(5, (s.dificultate ?? 3) + st.incercari),
        )
      : cuRegulile(s.ordin, s.dificultate)

    // ── HANDS STEP: he does it NOW, himself, with the browser and the secrets ──
    // It doesn't enter the constructor's queue: the constructor has no browser
    // and no way to set a key. And at the end we DON'T take his word — it gets
    // measured.
    if (s.executant === 'maini') {
      mainileOcupate = true
      const ziua = utcDay()
      await saveKv(`autonomie:zi:${ziua}`, String(azi + 1)).catch(() => {})
      try {
        // Hands steps leave no job log, so the escalation gets glued here, by
        // the number of attempts. NB: `escaladare()` kicks in from the FIRST
        // retry (`incercariDeja < 1` → ''), NOT the third — the old „from the
        // third" note was stale (the 3-threshold was mine, removed 2 aug).
        const spus = await ruleazaCuMainile({ ...s, ordin: escaladare(st.incercari) + ordin })
          .catch((e: Error) => `a crăpat: ${e.message}`)
        const chiarAFacut = s.dovada ? await s.dovada().catch(() => false) : false
        const incercari = st.incercari + 1
        if (chiarAFacut) {
          await scrieStare(s.cod, { job: 0, incercari, gata: true })
          console.log(`[AUTONOM] ${s.cod} („${s.titlu}") — FĂCUT, dovedit prin măsurare`)
          return { pornit: true, motiv: `${s.cod}: ${s.titlu} — gata` }
        }
        // Didn't work out. If it asked for the owner's approval, that is NOT a
        // failure of his — it's the only thing the law requires from the
        // account holder.
        const asteapta = /AȘTEPT APROBAREA:?\s*(.{0,160})/i.exec(spus)?.[1]?.trim()
        if (asteapta) {
          await scrieStare(s.cod, { job: 0, incercari: st.incercari })
          // `pornit: false` (5 aug, auditul de cost): un pas care AȘTEAPTĂ o
          // apăsare de la owner NU e „a lucrat" — dacă întorceam `pornit: true`,
          // cadența era PAUZA_A_LUCRAT_MS (2 min), iar `incercari` nu creștea, deci
          // pasul nu se parca niciodată → relua o tură plătită de creier (cu
          // unelte browser) la fiecare 2 min, la nesfârșit, pe banii ownerului,
          // pentru ceva ce nu poate avansa fără el. Acum cade pe cadența de 1h.
          return { pornit: false, motiv: `${s.cod}: așteaptă o apăsare de la tine — ${asteapta}` }
        }
        // Didn't work this time either → retried on the next pass. No abandonment.
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
    const ziua = utcDay()
    await saveKv(`autonomie:zi:${ziua}`, String(azi + 1)).catch(() => {})
    const eticheta = jurnal ? 'reparație' : 'sarcină nouă'
    console.log(`[AUTONOM] ${eticheta}: ${s.cod} („${s.titlu}") → ordinul #${id}`)
    return { pornit: true, motiv: `${s.cod} (${eticheta}): ${s.titlu}` }
  }
  // Nothing left to carry. Then it does NOT sit idle: it re-analyzes what it
  // delivered — "could it be better, NOW?" (Adrian: "continuous analysis and
  // improvement of implementation possibilities"). What comes out becomes a
  // new requirement, i.e. the next pass's work. Without this, the system
  // delivers once and freezes.
  const imb = await imbunatatireContinua().catch(() => ({ propuneri: 0, detaliu: 'n-a mers reanaliza' }))
  return { pornit: imb.propuneri > 0, motiv: `nimic de dus → reanaliză: ${imb.detaliu}` }
}

// ── THE PACE OF THE LOOP ─────────────────────────────────────────────────────
// Measured live (3 aug, 00:34→01:34): the analysis of requirement #1 finished
// at 00:34 and its ORDER could only be written at the NEXT pass — a fixed hour
// later. One action per pass is right (analysis → order → verification, each
// on its own turn); the FIXED hour after a SUCCESSFUL action is a brake nobody
// asked for (Adrian, Jul 30: "I pay, I ask, you execute"). The hour stays only
// where the pass costs nothing and there is nothing to continue.
export const PAUZA_A_LUCRAT_MS = 2 * 60 * 1000 // did something → carry on
export const PAUZA_ORDIN_IN_LUCRU_MS = 5 * 60 * 1000 // waiting on an order → cheap DB check
export const PAUZA_NIMIC_MS = 60 * 60 * 1000 // wall / nothing to do → the old hour

/** How long until the next pass, from what THIS pass did. Pure — the tests hold it. */
export function urmatoareaPauzaMs(r: { pornit: boolean; motiv: string }): number {
  if (r.pornit) return PAUZA_A_LUCRAT_MS
  if (r.motiv.startsWith('are deja un ordin în lucru')) return PAUZA_ORDIN_IN_LUCRU_MS
  return PAUZA_NIMIC_MS
}

/** The loop. After each pass it decides WHEN the next one runs — it keeps
 *  working while there is work, and sleeps the hour only when idle. */
export function startAutonomie(): void {
  const ruleaza = async (): Promise<{ pornit: boolean; motiv: string }> => {
    // CURĂȚENIE AUTOMATĂ (K9 + K13): arhivează ordinele terminate mai vechi de o
    // zi, ca panoul Constructor să nu se încarce cu istoric. Best-effort — nu
    // blochează pasul de autonomie dacă pică.
    await arhiveazaBuildJobsVechi(1).catch(() => 0)
    const r = await poateSaLucreze().catch((e) => ({ pornit: false, motiv: String(e).slice(0, 120) }))
    ultima = {
      la: new Date().toISOString(),
      ok: r.pornit,
      detaliu: r.pornit ? `a pornit singur: ${r.motiv}` : r.motiv,
    }
    // IN THE DATABASE TOO, not just in memory: we publish several times a day,
    // and every restart erased the trace. Without it, the evidence page
    // couldn't tell "the loop hasn't gotten to it yet" from "the loop doesn't
    // work at all" — exactly the confusion rule #1 forbids.
    await saveKv('autonomie:ultima', JSON.stringify(ultima)).catch(() => {})
    return r
  }
  // THE ROW SURVIVES THE DEPLOY (audit Aug 2): the kv copy was written but
  // NOTHING read it back at boot — after every publish, „Kelion, de capul
  // lui" showed blank for at least 3 minutes and the loop looked dead when it
  // wasn't. Load the last saved pass into memory right away.
  void loadKv('autonomie:ultima')
    .then((v) => {
      if (!v || ultima) return
      const j = JSON.parse(v) as { la?: string; ok?: boolean; detaliu?: string }
      if (j?.la && typeof j.detaliu === 'string')
        ultima = { la: j.la, ok: !!j.ok, detaliu: `${j.detaliu} (dinainte de repornire)` }
    })
    .catch(() => {})
  // First pass 3 minutes after startup (the container must be ready). From
  // then on each pass schedules the next one AFTER it finishes — passes can
  // take minutes (hands turns hold a browser), so a fixed interval could pile
  // one on top of another; chaining makes overlap impossible.
  const lant = (ms: number): void => {
    setTimeout(() => {
      void ruleaza()
        .catch(() => ({ pornit: false, motiv: 'trecerea a crăpat' }))
        .then((r) => lant(urmatoareaPauzaMs(r)))
    }, ms)
  }
  lant(3 * 60 * 1000)
}
