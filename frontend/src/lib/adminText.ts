// ── THE ADMIN PANEL TEXT — ENGLISH IS THE BASE, ROMANIAN IS A TRANSLATION ──
//
// Adrian's rule (Jul 30): "including the whole app default English", then
// the user's language, "including admin". The public and user surfaces are
// already done (`publicText.ts`, `i18n.ts`); the admin panel was the last place in
// the app written directly in Romanian.
//
// WHY A SEPARATE FILE, not `i18n.ts`: these keys are seen ONLY by the admin.
// Put in the common dictionary, they would bloat the `Strings` type with ~60
// labels every new language would have to pass through — for a screen no user
// ever opens. Here the namespace is clear and separate.
//
// The same completeness rule as `i18n.ts`: **English is mandatory**
// (the type requires it whole), the other languages are partial and fall cleanly onto
// English. Romanian is complete because today's admin is Romanian; a missing
// language leaves no empty labels, it shows English.
import { resolveLang, type Lang } from './i18n'
import { loadLocalLang } from './prefs'

export interface AdminStrings {
  // Taburile
  tabEnterprise: string
  tabMoney: string
  // Becuri de credit AI (owner, 13 aug: „bec roșu/verde… click = reîncărcare")
  becuriTitlu: string
  becuriLoad: string
  becuriEroare: string
  becuriReincarca: string
  becuriDeschideFactura: string
  becuriServeste: string
  becuriNecunoscut: string
  becuriBaraTitlu: string
  becuriBaraFaraCredit: string
  tabUsers: string
  tabShare: string
  tabStores: string
  tabInbox: string
  tabVoiceprints: string
  tabGestures: string
  tabTokens: string
  tabBuilder: string
  tabRecovery: string
  // Common states
  loading: string
  noSpendYet: string
  noConversationsYet: string
  noVoiceprintsYet: string
  noVersionsYet: string
  noOrdersYet: string
  noMessagesYet: string
  noContactMessagesYet: string
  noLettersYet: string
  // Pastilele din bara de sus (Stage.tsx, doar admin) — audit Aug 2: titlurile
  // erau scrise direct în cod, în română. `{n}` etc. = valorile măsurate.
  // Panoul de plăți (M3, Aug 2) — codurile emise/plătite + plasa neatribuită.
  payHead: string
  payTotals: string
  payReadFail: string
  payNetHead: string
  payNetEmpty: string
  payAssign: string
  payIgnore: string
  payAssignPrompt: string
  serperPillLive: string
  serperPillDead: string
  gemPillLive: string
  gemPillDead: string
  /** Bucata „cheltuit luna asta" din tooltipurile Gemini — SEPARATĂ (auditul
   *  admin, 3 aug): când jurnalul nu se poate citi se afișează varianta
   *  `gemSpendUnreadable`, nu un „$0.00 (măsurat)" fabricat. */
  gemSpendMeasured: string
  gemSpendUnreadable: string
  /** Pastila unică 🔒 când lacătul admin (423) blochează măsurătorile. */
  pillsLocked: string
  /** Titlu pe pastile când ultimele citiri au picat — datele afișate sunt vechi. */
  pillsStale: string
  vpsPillLive: string
  vpsPillDead: string
  // Magazine
  checkingStores: string
  notListedYet: string
  downloadsHead: string
  // Inbox
  readingMailbox: string
  mailboxEmpty: string
  mailboxReadFail: string
  mailboxNotConfigured: string
  reply: string
  // Amprente vocale
  playVoiceSample: string
  noVoiceSampleYet: string
  // Recuperare
  versionNotePlaceholder: string
  // Constructor
  buildOrderPlaceholder: string
  // Tokenuri
  checkingTokens: string
  tokensFailed: string
  // Utilizatori / istoric
  seeWhatTheyWrote: string
  seeWholeChat: string
  recentSessions: string
  translateToRo: string
  // Istoric chat (auditul admin, 3 aug): textele erau hardcodate în engleză,
  // ocolind A, iar o citire eșuată apărea ca „No history yet." — fals.
  noHistoryYet: string
  usersReadFail: string
  historyReadFail: string
  selectUserHint: string
  // Vizitatori
  liveVisitorChats: string
  pickConversation: string
  replyToVisitor: string
  // Distribuie
  appLink: string
  shareOnSocial: string
  videoPlatforms: string
  // Audit
  loadingAudit: string
  nothingDown: string
  // Dialogs, Alerts & Status Messages
  writeCompleteOrder: string
  orderEnqueuedPaused: (id: number) => string
  orderEnqueuedActive: (id: number) => string
  orderSendFailed: string
  confirmDeleteInboxMsg: (count: number) => string
  mailDeleteResult: (deleted: number, detail: string) => string
  mailDeleteFailed: string
  confirmDeleteBuildOrder: (id: number) => string
  orderDeleted: (id: number) => string
  orderDeleteFailed: string
  confirmStopBuildOrder: (id: number) => string
  orderStopped: (id: number) => string
  orderStopFailed: string
  confirmClearFailedJobs: string
  ordersCleaned: (count: number) => string
  ordersCleanFailed: string
  orderResumed: (id: number) => string
  orderResumeFailed: string
  savingRecovery: string
  recoverySaved: (tag: string) => string
  recoverySaveFailed: (err: string) => string
  recoverySaveNetworkError: string
  confirmRestoreApp: (when: string, sha: string) => string
  confirmRestoreAppSure: (note: string, tag: string) => string
  restoringApp: (tag: string) => string
  restoreSuccess: (sha: string) => string
  restoreFailed: (err: string) => string
  restoreNetworkError: string
  lockSecretMinLength: string
  lockSecretSaved: string
  lockSecretSaveFailed: string
  gestureSaveFailed: string
  gapArchiveFailed: string
  revolutLinkStarting: string
  revolutLinkApprovePrompt: string
  revolutLinkStartFailed: (err: string) => string
  revolutLinkNetworkError: string
  revolutLinkPromptCode: string
  revolutLinkFinalizing: string
  revolutLinkSuccess: (count: number) => string
  revolutLinkFailed: (err: string) => string
  revolutPromptAssign: (amount: number) => string
  alertResult: (res: string) => string
  alertCouldNotPerf: string
  promptManualCreditAmount: (email: string) => string
  alertInvalidAmount: (s: string) => string
  promptManualCreditReason: string
  alertNotCredited: string
  confirmDeleteGap: string
  voiceprintKept: string
  voiceprintKeptTitle: string
  voiceprintFetchError: (email: string) => string
  confirmResetCounters: string
  gapDeleteFailed: string
  mailFieldsRequired: string
  mailReplyFailed: string
}

const en: AdminStrings = {
  tabEnterprise: '➕ Add agent',
  tabMoney: 'Money',
  becuriTitlu: 'AI credit — lights (click = top-up page)',
  becuriLoad: 'reading balances…',
  becuriEroare: 'could not read AI credit',
  becuriReincarca: 'no credit — click to add funds',
  becuriDeschideFactura: 'open billing page',
  becuriServeste: 'serving (live probe passed)',
  becuriNecunoscut: 'cannot verify',
  becuriBaraTitlu: 'AI credit — click for Money',
  becuriBaraFaraCredit: '{n} AI out of credit — click for Money',
  tabUsers: 'Users',
  tabShare: 'Share',
  tabStores: 'Stores',
  tabInbox: 'Inbox',
  tabVoiceprints: 'Voiceprints',
  tabGestures: 'Gestures',
  tabTokens: 'Tokens',
  tabBuilder: 'Builder',
  tabRecovery: 'Recovery',
  loading: 'Loading…',
  noSpendYet: 'No spend yet.',
  noConversationsYet: 'No conversations yet.',
  noVoiceprintsYet: 'No voiceprint recorded yet.',
  noVersionsYet: 'No version saved yet.',
  noOrdersYet: 'No orders yet.',
  noMessagesYet: 'They have not written a message yet.',
  noContactMessagesYet: 'No contact message yet.',
  noLettersYet: 'No letters yet (or MAIL_PASS is not set).',
  payHead: 'Payments with a code',
  payTotals: '{emise} codes issued · {platite} paid · {pending} pending · {net} in the net',
  payReadFail: 'Could not read the payments — this is a failed read, NOT an empty ledger.',
  payNetHead: 'Unattributed payments — the net (inflows nobody matched)',
  payNetEmpty: 'Nothing in the net.',
  payAssign: 'Assign',
  payIgnore: 'Ignore',
  payAssignPrompt: 'The email of the user this payment of {amount} belongs to:',
  // (orPill*/oaPill* removed 3 Aug — the OpenRouter/OpenAI pills died with the
  // providers; the brain's state lives on the Gemini pill.)
  serperPillLive: 'Serper (web search): {n} real credits · click for the dashboard',
  serperPillDead: 'Cannot read the Serper credit (SERPER_API_KEY missing or the read failed)',
  // CLICKUL SPUS CORECT (auditul admin, 3 aug): din 3 aug clickul deschide
  // promptul de tastat creditul; pagina Google se deschide doar pe câmp gol —
  // vechiul „Click to see the real balance on Google’s billing page" descria
  // comportamentul dispărut. {spend} = gemSpendMeasured SAU gemSpendUnreadable.
  gemPillLive: 'Gemini Tier 2 is live — the key is serving, so you have credit and it works. {spend}. Click opens Google’s top-up page; the pencil next to the pill sets the credit you see in AI Studio.',
  gemPillDead: 'Gemini is not serving right now ({why}) — if the prepay credit ran out, top it up. Click opens Google’s top-up page; the pencil sets the credit you see in AI Studio. (The exact credit is only on Google’s page — no API exposes it.)',
  gemSpendMeasured: '${n} spent this month (measured)',
  gemSpendUnreadable: 'the month’s spend is unreadable right now (the journal read failed) — not $0', // hardcod-permis: text DESPRE cifra necitibilă („nu $0") — nu o cifră afișată ca fapt
  pillsLocked: '🔒 measurements locked — unlock the admin (the lock blocks /api/admin/*). Click to enter the code.',
  pillsStale: '⚠ the last reads failed — the figures shown are {min} min old, not current.',
  vpsPillLive: 'VPS: {free} GB free of {total} GB · load {load}% of {cpus} processors ({avg} at 1/5/15 min)',
  vpsPillDead: 'Cannot measure the VPS resources (/proc is not answering)',
  checkingStores: 'Checking the stores live…',
  notListedYet: '○ not listed yet',
  downloadsHead: 'Who downloaded (last 100)',
  readingMailbox: 'Reading the mailbox…',
  // TREI STĂRI, TREI TEXTE (auditul admin, 3 aug): golul real, IMAP-ul picat
  // și MAIL_PASS lipsă nu mai sunt strivite într-un singur mesaj ambiguu.
  mailboxEmpty: 'The INBOX folder is empty. (Mail already processed by the Secretary lives in the Kelion-Answered / Kelion-ToAnswer / Kelion-Automated folders.)',
  mailboxReadFail: 'The IMAP read FAILED: {motiv} — this is a failed read, not an empty mailbox. Try again.',
  mailboxNotConfigured: 'MAIL_PASS is not set — the mailbox cannot be read at all.',
  reply: 'Reply:',
  playVoiceSample: 'Play the voice sample',
  noVoiceSampleYet: 'No audio sample captured yet',
  versionNotePlaceholder: 'Note (optional): what this version is',
  buildOrderPlaceholder: 'The build order: what, where, how it is verified',
  checkingTokens: 'Checking the tokens…',
  tokensFailed: 'Could not load the checks.',
  seeWhatTheyWrote: 'See what it wrote and how it tested',
  seeWholeChat: 'See the whole chat: what they wrote and how Kelion answered',
  recentSessions: 'Recent sessions — who, when, how long they stayed',
  translateToRo: 'Translate the whole conversation to Romanian (from any language), instantly',
  noHistoryYet: 'No history yet.',
  usersReadFail: 'Could not read the user list — a failed read, NOT an empty history. It retries when you reopen the tab.',
  historyReadFail: 'Could not read the conversation — a failed read, not an empty chat. Try again.',
  selectUserHint: 'Select a user to view their history.',
  liveVisitorChats: 'Live conversations with visitors',
  pickConversation: 'Pick a conversation to reply to.',
  replyToVisitor: 'Reply to the visitor…',
  appLink: 'App link',
  shareOnSocial: 'Share the link on social networks',
  // FĂRĂ AFIRMAȚIA DESPRE FOLDER (auditul admin, 3 aug): vechiul text jura că
  // clipurile promo SUNT în Downloads — nimeni n-a măsurat asta, iar pașii de
  // deasupra grilei spun corect: întâi generezi clipul, abia apoi îl urci.
  videoPlatforms: 'Video platforms — they open the studio; generate the clip first (the steps above), then upload it there',
  loadingAudit: 'Loading the audit…',
  nothingDown: 'Nothing is down right now: health is green, zero server errors, zero client errors, zero failed builds.',
  writeCompleteOrder: 'Write complete build order (what, where, how to verify).',
  orderEnqueuedPaused: (id: number) => `Order #${id} queued — but autonomy is PAUSED: order waits until you restart autonomy in Money tab.`,
  orderEnqueuedActive: (id: number) => `Order #${id} queued — worker picks it up within 2 mins; you will get an email with the PR.`,
  orderSendFailed: 'Could not send order — try again.',
  confirmDeleteInboxMsg: (count: number) => `Delete ${count === 1 ? 'selected message' : count + ' messages'} from inbox?`,
  mailDeleteResult: (deleted: number, detail: string) => `Deleted: ${deleted} — ${detail}`,
  mailDeleteFailed: 'Could not delete — try again.',
  confirmDeleteBuildOrder: (id: number) => `Permanently delete build order #${id}?`,
  orderDeleted: (id: number) => `Order #${id} deleted.`,
  orderDeleteFailed: 'Could not delete — try again.',
  confirmStopBuildOrder: (id: number) => `Stop active order #${id}? (will mark as failed, worker will not continue)`,
  orderStopped: (id: number) => `Order #${id} stopped.`,
  orderStopFailed: 'Could not stop — try again.',
  confirmClearFailedJobs: 'Clear all failed and completed orders from queue? (active orders remain)',
  ordersCleaned: (count: number) => `Cleaned: ${count} orders deleted.`,
  ordersCleanFailed: 'Could not clean queue — try again.',
  orderResumed: (id: number) => `Order #${id} re-queued.`,
  orderResumeFailed: 'Could not resume order — try again.',
  savingRecovery: 'Saving current version…',
  recoverySaved: (tag: string) => `Saved ✓ recovery point: ${tag}`,
  recoverySaveFailed: (err: string) => `Could not save: ${err}`,
  recoverySaveNetworkError: 'Could not save — network error; try again.',
  confirmRestoreApp: (when: string, sha: string) => `Restore application to version from ${when} (${sha})?`,
  confirmRestoreAppSure: (note: string, tag: string) => `SURE? Production will be brought EXACTLY to state "${note || tag}" and republished automatically. Subsequent changes will be lost from application (staying only in git history).`,
  restoringApp: (tag: string) => `Restoring to ${tag}…`,
  restoreSuccess: (sha: string) => `Restored ✓ master is now at ${sha} — server republish starts automatically (1-2 min).`,
  restoreFailed: (err: string) => `Restore failed: ${err}`,
  restoreNetworkError: 'Restore failed — check connection and try again.',
  lockSecretMinLength: 'Secret must have at least 4 characters.',
  lockSecretSaved: 'Secret saved ✓ — but lock remains DISARMED in code; secret takes effect only when lock is re-enabled.',
  lockSecretSaveFailed: 'Could not save — try again.',
  gestureSaveFailed: 'NOT saved — server refused; toggle reverted. Try again.',
  gapArchiveFailed: 'Could not archive — try again.',
  revolutLinkStarting: 'Starting linking…',
  revolutLinkApprovePrompt: 'Approve in Revolut app, then press "I have return code".',
  revolutLinkStartFailed: (err: string) => `Could not start linking: ${err}`,
  revolutLinkNetworkError: 'Could not start linking — network down.',
  revolutLinkPromptCode: 'Code from return URL (after Revolut approval):',
  revolutLinkFinalizing: 'Finalizing linking…',
  revolutLinkSuccess: (count: number) => `Account linked ✓ (${count} accounts) — payment reading starts on next run.`,
  revolutLinkFailed: (err: string) => `Linking failed: ${err}`,
  revolutPromptAssign: (amount: number) => `Assign £${amount} payment to user (email):`,
  alertResult: (res: string) => `Result: ${res}`,
  alertCouldNotPerf: 'Could not perform action — server refused or session expired.',
  promptManualCreditAmount: (email: string) => `Manual credit for ${email} — amount in POUNDS £ (e.g. 5.50 or -5.50):`,
  alertInvalidAmount: (s: string) => `Amount "${s}" is not valid — write e.g. 5.50 (or 5,50). Nothing credited.`,
  promptManualCreditReason: 'Credit reason (ex: refund, test, loyalty):',
  alertNotCredited: 'Not credited — server refused or session expired.',
  confirmDeleteGap: 'PERMANENTLY delete request?',
  voiceprintKept: 'kept (never deleted)',
  voiceprintKeptTitle: "Owner's order (Aug 14): voiceprints are kept — no command can delete them (server + database both refuse).",
  voiceprintFetchError: (email: string) => `Voice sample for ${email} could not be loaded — missing or read failed.`,
  confirmResetCounters: 'Reset consumption counters to 0?\n\nDeletes only supplier cost log.\nDoes NOT touch user credits, payment ledger or purchase history.\nAlready consumed credits are NOT refunded.',
  gapDeleteFailed: 'Could not delete request — try again.',
  mailFieldsRequired: 'Email and subject fields are required.',
  mailReplyFailed: 'Not sent — message was NOT saved; try again.',
}

const ro: AdminStrings = {
  tabEnterprise: '➕ Agent nou',
  tabMoney: 'Bani',
  becuriTitlu: 'Credit AI — becuri (click = pagina de reîncărcare)',
  becuriLoad: 'se citesc soldurile…',
  becuriEroare: 'nu am putut citi creditul AI',
  becuriReincarca: 'fără credit — click ca să adaugi bani',
  becuriDeschideFactura: 'deschide pagina de facturare',
  becuriServeste: 'servește (probă vie reușită)',
  becuriNecunoscut: 'nu pot verifica',
  becuriBaraTitlu: 'Credit AI — click pentru Bani',
  becuriBaraFaraCredit: '{n} AI fără credit — click pentru Bani',
  tabUsers: 'Utilizatori',
  tabShare: 'Distribuie',
  tabStores: 'Magazine',
  tabInbox: 'Inbox',
  tabVoiceprints: 'Amprente vocale',
  tabGestures: 'Gesturi',
  tabTokens: 'Tokenuri',
  tabBuilder: 'Constructor',
  tabRecovery: 'Recuperare',
  loading: 'Se încarcă…',
  noSpendYet: 'Niciun consum încă.',
  noConversationsYet: 'Nicio conversație încă.',
  noVoiceprintsYet: 'Nicio amprentă vocală înregistrată încă.',
  noVersionsYet: 'Nicio versiune salvată încă.',
  noOrdersYet: 'Niciun ordin încă.',
  noMessagesYet: 'Nu a scris niciun mesaj încă.',
  noContactMessagesYet: 'Niciun mesaj de contact încă.',
  noLettersYet: 'Nicio scrisoare încă (sau MAIL_PASS nesetat).',
  payHead: 'Plăți cu cod',
  payTotals: '{emise} coduri emise · {platite} plătite · {pending} în așteptare · {net} în plasă',
  payReadFail: 'Nu am putut citi plățile — e o citire eșuată, NU un registru gol.',
  payNetHead: 'Plăți neatribuite — plasa (intrări pe care nu le-a potrivit nimeni)',
  payNetEmpty: 'Nimic în plasă.',
  payAssign: 'Atribuie',
  payIgnore: 'Ignoră',
  payAssignPrompt: 'Emailul userului căruia îi aparține plata de {amount}:',
  // (orPill*/oaPill* scoase, 3 aug — pastilele OpenRouter/OpenAI au murit odată
  // cu furnizorii; starea creierului trăiește pe pastila Gemini.)
  serperPillLive: 'Serper (căutarea web): {n} credite reale · click pentru dashboard',
  serperPillDead: 'Nu pot citi creditul Serper (SERPER_API_KEY lipsește sau citirea a picat)',
  gemPillLive: 'Gemini Tier 2 activ — cheia servește, deci ai credit și merge. {spend}. Click: pagina de alimentare Google; creionul de lângă pastilă scrie creditul din AI Studio.',
  gemPillDead: 'Gemini nu servește acum ({why}) — dacă s-a epuizat creditul prepay, reîncarcă-l. Click: pagina de alimentare Google; creionul scrie creditul din AI Studio. (Creditul exact e doar pe pagina Google — niciun API nu-l expune.)',
  gemSpendMeasured: '${n} cheltuiți luna asta (măsurat)',
  gemSpendUnreadable: 'cheltuiala lunii e necitibilă acum (citirea jurnalului a picat) — nu $0', // hardcod-permis: text DESPRE cifra necitibilă („nu $0") — nu o cifră afișată ca fapt
  pillsLocked: '🔒 măsurători blocate — deblochează adminul (lacătul blochează /api/admin/*). Click pentru cod.',
  pillsStale: '⚠ ultimele citiri au picat — cifrele afișate sunt vechi de {min} min, nu actuale.',
  vpsPillLive: 'VPS: {free} GB liberi din {total} GB · încărcare {load}% din {cpus} procesoare ({avg} la 1/5/15 min)',
  vpsPillDead: 'Nu pot măsura resursele VPS-ului (nu răspunde /proc)',
  checkingStores: 'Se verifică magazinele live…',
  notListedYet: '○ nelistat încă',
  downloadsHead: 'Cine a descărcat (ultimele 100)',
  readingMailbox: 'Se citește cutia…',
  mailboxEmpty: 'Folderul INBOX e gol. (Mailurile deja procesate de Secretar stau în folderele Kelion-Answered / Kelion-ToAnswer / Kelion-Automated.)',
  mailboxReadFail: 'Citirea IMAP a PICAT: {motiv} — e o citire eșuată, nu o cutie goală. Reîncearcă.',
  mailboxNotConfigured: 'MAIL_PASS nesetat — cutia nu poate fi citită deloc.',
  reply: 'Răspuns:',
  playVoiceSample: 'Ascultă mostra vocii',
  noVoiceSampleYet: 'Încă nu s-a captat o mostră audio',
  versionNotePlaceholder: 'Notă (opțional): ce e această versiune',
  buildOrderPlaceholder: 'Ordinul de construcție: ce, unde, cum se verifică',
  checkingTokens: 'Se verifică tokenurile…',
  tokensFailed: 'Nu s-au putut încărca verificările.',
  seeWhatTheyWrote: 'Vezi ce a scris și cum a testat',
  seeWholeChat: 'Vezi tot chatul: ce a scris și cum a răspuns Kelion',
  recentSessions: 'Sesiuni recente — cine, când, cât a stat',
  translateToRo: 'Traduce toată conversația în română (din orice limbă), instant',
  noHistoryYet: 'Niciun istoric încă.',
  usersReadFail: 'Nu am putut citi lista de utilizatori — citire eșuată, NU istoric gol. Se reîncearcă la redeschiderea tabului.',
  historyReadFail: 'Nu am putut citi conversația — citire eșuată, nu chat gol. Reîncearcă.',
  selectUserHint: 'Alege un utilizator ca să-i vezi istoricul.',
  liveVisitorChats: 'Conversații live cu vizitatorii',
  pickConversation: 'Alege o conversație ca să răspunzi.',
  replyToVisitor: 'Răspunde vizitatorului…',
  appLink: 'Linkul aplicației',
  shareOnSocial: 'Trimite linkul pe rețele',
  videoPlatforms: 'Platforme video — deschid studioul; clipul îl generezi întâi (pașii de mai sus), apoi îl urci de acolo',
  loadingAudit: 'Se încarcă auditul…',
  nothingDown: 'Nimic căzut acum: sănătatea e verde, zero erori de server, zero erori de client, zero construcții eșuate.',
  writeCompleteOrder: 'Scrie ordinul complet (ce construiește, unde, cum verifici).',
  orderEnqueuedPaused: (id: number) => `Ordin #${id} în coadă — dar autonomia e PE PAUZĂ: ordinul așteaptă (nu se pierde) până repornești autonomia din tabul Bani.`,
  orderEnqueuedActive: (id: number) => `Ordin #${id} în coadă — lucrătorul îl ia în max. 2 minute; primești email cu PR-ul.`,
  orderSendFailed: 'Nu s-a putut trimite — reîncearcă.',
  confirmDeleteInboxMsg: (count: number) => `Ștergi ${count === 1 ? 'mesajul selectat' : count + ' mesaje'} din inbox?`,
  mailDeleteResult: (deleted: number, detail: string) => `Șterse: ${deleted} — ${detail}`,
  mailDeleteFailed: 'Nu s-a putut șterge — reîncearcă.',
  confirmDeleteBuildOrder: (id: number) => `Ștergi definitiv ordinul #${id}?`,
  orderDeleted: (id: number) => `Ordinul #${id} șters.`,
  orderDeleteFailed: 'Nu s-a putut șterge — reîncearcă.',
  confirmStopBuildOrder: (id: number) => `Oprești ordinul #${id} aflat în lucru? (trece pe „eșuat", lucrătorul nu-l mai continuă)`,
  orderStopped: (id: number) => `Ordinul #${id} oprit.`,
  orderStopFailed: 'Nu s-a putut opri — reîncearcă.',
  confirmClearFailedJobs: 'Ștergi din coadă toate ordinele eșuate și terminate? (rămân doar cele în curs)',
  ordersCleaned: (count: number) => `Curățat: ${count} ordine șterse.`,
  ordersCleanFailed: 'Nu s-a putut curăța — reîncearcă.',
  orderResumed: (id: number) => `Ordinul #${id} repus în coadă.`,
  orderResumeFailed: 'Nu s-a putut relua — reîncearcă.',
  savingRecovery: 'Salvez versiunea curentă…',
  recoverySaved: (tag: string) => `Salvat ✓ punct de recuperare: ${tag}`,
  recoverySaveFailed: (err: string) => `Nu s-a putut salva: ${err}`,
  recoverySaveNetworkError: 'Nu s-a putut salva — rețeaua a picat; reîncearcă.',
  confirmRestoreApp: (when: string, sha: string) => `Restaurezi aplicația la versiunea din ${when} (${sha})?`,
  confirmRestoreAppSure: (note: string, tag: string) => `SIGUR? Producția va fi adusă EXACT la starea „${note || tag}” și se republică automat. Modificările de după acest punct dispar din aplicație (rămân doar în istoricul git).`,
  restoringApp: (tag: string) => `Restaurez la ${tag}…`,
  restoreSuccess: (sha: string) => `Restaurat ✓ master e acum la ${sha} — publicarea pe server pornește singură (1-2 min).`,
  restoreFailed: (err: string) => `Restaurarea a eșuat: ${err}`,
  restoreNetworkError: 'Restaurarea a eșuat — verifică conexiunea și reîncearcă.',
  lockSecretMinLength: 'Secretul trebuie să aibă minim 4 caractere.',
  lockSecretSaved: 'Secret salvat ✓ — dar lacătul rămâne DEZARMAT din cod (cererea ta, 31 iul); secretul intră în vigoare doar când îmi ceri să repornesc lacătul.',
  lockSecretSaveFailed: 'Nu s-a putut salva — reîncearcă.',
  gestureSaveFailed: 'NU s-a salvat — serverul a refuzat; bifa a revenit. Reîncearcă.',
  gapArchiveFailed: 'Nu s-a putut arhiva — reîncearcă.',
  revolutLinkStarting: 'Pornesc legarea…',
  revolutLinkApprovePrompt: 'Aprobă în aplicația Revolut, apoi apasă „Am codul din retur”.',
  revolutLinkStartFailed: (err: string) => `Nu s-a putut porni legarea: ${err}`,
  revolutLinkNetworkError: 'Nu s-a putut porni legarea — rețeaua a picat.',
  revolutLinkPromptCode: 'Codul din URL-ul de retur (după aprobare în Revolut):',
  revolutLinkFinalizing: 'Finalizez legarea…',
  revolutLinkSuccess: (count: number) => `Cont legat ✓ (${count} conturi) — citirea plăților pornește la următoarea trecere.`,
  revolutLinkFailed: (err: string) => `Legarea a eșuat: ${err}`,
  revolutPromptAssign: (amount: number) => `Atribuie plata de £${amount} userului (email):`,
  alertResult: (res: string) => `Rezultat: ${res}`,
  alertCouldNotPerf: 'Nu s-a putut — serverul a refuzat sau sesiunea a expirat.',
  promptManualCreditAmount: (email: string) => `Credit manual pentru ${email} — suma în LIRE £ (ex: 5.50 sau -5.50):`,
  alertInvalidAmount: (s: string) => `Suma „${s}” nu e validă — scrie de ex. 5.50 (sau 5,50). Nu s-a creditat nimic.`,
  promptManualCreditReason: 'Motivul creditării (ex: retur, test, fidelizare):',
  alertNotCredited: 'Nu s-a creditat — serverul a refuzat sau sesiunea a expirat.',
  confirmDeleteGap: 'Ștergi DEFINITIV cererea? (nu rămâne nici în istoric)',
  voiceprintKept: 'se păstrează (nu se șterge)',
  voiceprintKeptTitle: 'Ordinul ownerului (14 aug): amprentele vocale se păstrează — nicio comandă nu le poate șterge (refuză și serverul, și baza de date).',
  voiceprintFetchError: (email: string) => `Mostra lui ${email} nu s-a putut încărca — lipsește sau citirea a picat.`,
  confirmResetCounters: 'Pui pe 0 contoarele de consum?\n\nSe șterge doar jurnalul „cât ne-a costat pe noi la furnizori”.\nNU se ating: creditele userilor, registrul plăților, istoricul de cumpărare.\nCreditele deja consumate NU se dau înapoi.',
  gapDeleteFailed: 'Nu s-a putut șterge cererea — reîncearcă.',
  mailFieldsRequired: 'Câmpurile email și subiect sunt obligatorii.',
  mailReplyFailed: 'Nu s-a trimis — mesajul NU s-a salvat; reîncearcă.',
}

const dict: { en: AdminStrings } & Partial<Record<Lang, Partial<AdminStrings>>> = { en, ro }

const cache = new Map<Lang, AdminStrings>()

/** The panel text, in the connected admin's language. The same rule as everywhere:
 *  the local mirror of the server-identified language, else English. */
export function adminStrings(): AdminStrings {
  const lang = resolveLang(loadLocalLang() ?? 'en')
  const gata = cache.get(lang)
  if (gata) return gata
  const unit: AdminStrings = lang === 'en' ? dict.en : { ...dict.en, ...(dict[lang] ?? {}) }
  cache.set(lang, unit)
  return unit
}
