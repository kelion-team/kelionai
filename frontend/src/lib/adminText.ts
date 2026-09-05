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
  tabVisitors: string
  tabShare: string
  tabStores: string
  tabInbox: string
  tabGestures: string
  tabTokens: string
  tabBuilder: string
  tabRecovery: string
  tabSystem: string
  tabErrors: string
  tabNotifications: string
  tabBrain: string
  // Common states
  loading: string
  noSpendYet: string
  noConversationsYet: string
  noVersionsYet: string
  noOrdersYet: string
  noMessagesYet: string
  noContactMessagesYet: string
  noLettersYet: string
  // Pastilele din bara de sus (Stage.tsx, doar admin) — audit Aug 2: titlurile
  // erau scrise direct în cod, în română. `{n}` etc. = valorile măsurate.
  serperPillLive: string
  serperPillDead: string
  /** Titlu pe pastile când ultimele citiri au picat — datele afișate sunt vechi. */
  pillsStale: string
  vpsPillLive: string
  vpsPillDead: string
  // Magazine
  checkingStores: string
  notListedYet: string
  // Inbox
  readingMailbox: string
  mailboxEmpty: string
  mailboxReadFail: string
  mailboxNotConfigured: string
  reply: string
  // Recuperare
  versionNotePlaceholder: string
  // Constructor
  buildOrderPlaceholder: string
  constructorModelLoading: string
  constructorModelUnreadable: string
  constructorModelVerifiedAt: (date: string) => string
  constructorOutcomeUnresolved: (profile: string) => string
  constructorOutcomeTechnicalFailure: (profile: string) => string
  constructorOutcomeReason: (reason: string) => string
  constructorOutcomeNoOtherModel: string
  constructorOutcomeTechnicalNoModelAdvice: string
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
  orderEnqueuedWaiting: (id: number) => string
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
  gestureSaveFailed: string
  gapArchiveFailed: string
  alertCouldNotPerf: string
  promptManualCreditAmount: (email: string, currency: string) => string
  alertInvalidAmount: (s: string) => string
  promptManualCreditReason: string
  alertNotCredited: string
  confirmDeleteGap: string
  confirmResetCounters: string
  gapDeleteFailed: string
  mailFieldsRequired: string
  mailReplyFailed: string
}

const en: AdminStrings = {
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
  tabVisitors: 'Visitors',
  tabShare: 'Share',
  tabStores: 'Stores',
  tabInbox: 'Inbox',
  tabGestures: 'Gestures',
  tabTokens: 'Tokens',
  tabBuilder: 'Builder',
  tabRecovery: 'Recovery',
  tabSystem: 'System',
  tabErrors: 'Errors',
  tabNotifications: 'Notifications',
  tabBrain: 'OpenAI brain',
  loading: 'Loading…',
  noSpendYet: 'No spend yet.',
  noConversationsYet: 'No conversations yet.',
  noVersionsYet: 'No version saved yet.',
  noOrdersYet: 'No orders yet.',
  noMessagesYet: 'They have not written a message yet.',
  noContactMessagesYet: 'No contact message yet.',
  noLettersYet: 'No letters yet (or MAIL_PASS is not set).',
  serperPillLive: 'Serper (web search): {n} real credits · click for the dashboard',
  serperPillDead: 'Cannot read the Serper credit (SERPER_API_KEY missing or the read failed)',
  pillsStale: '⚠ the last reads failed — the figures shown are {min} min old, not current.',
  vpsPillLive: 'VPS: {free} GB free of {total} GB · load {load}% of {cpus} processors ({avg} at 1/5/15 min)',
  vpsPillDead: 'Cannot measure the VPS resources (/proc is not answering)',
  checkingStores: 'Checking the stores live…',
  notListedYet: '○ not listed yet',
  readingMailbox: 'Reading the mailbox…',
  // TREI STĂRI, TREI TEXTE (auditul admin, 3 aug): golul real, IMAP-ul picat
  // și MAIL_PASS lipsă nu mai sunt strivite într-un singur mesaj ambiguu.
  mailboxEmpty: 'The INBOX folder is empty. (Mail already processed by the Secretary lives in the Kelion-Answered / Kelion-ToAnswer / Kelion-Automated folders.)',
  mailboxReadFail: 'The IMAP read FAILED: {motiv} — this is a failed read, not an empty mailbox. Try again.',
  mailboxNotConfigured: 'MAIL_PASS is not set — the mailbox cannot be read at all.',
  reply: 'Reply:',
  versionNotePlaceholder: 'Note (optional): what this version is',
  buildOrderPlaceholder: 'The build order: what, where, how it is verified',
  constructorModelLoading: 'Reading the active model…',
  constructorModelUnreadable: 'The active model could not be verified. No profile is assumed to be active.',
  constructorModelVerifiedAt: (date: string) => `Verified at ${date}`,
  constructorOutcomeUnresolved: (profile: string) => `The requirement ended with a valid unresolved result on ${profile}.`,
  constructorOutcomeTechnicalFailure: (profile: string) => `Technical failure on ${profile} — this is not evidence that the model is too weak.`,
  constructorOutcomeReason: (reason: string) => `Reason: ${reason}`,
  constructorOutcomeNoOtherModel: 'This run is terminal. A new attempt requires an explicit Retry; no model switch is proposed.',
  constructorOutcomeTechnicalNoModelAdvice: 'This technical verdict recommends neither a different model nor Retry.',
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
  orderEnqueuedWaiting: (id: number) => `Order #${id} queued — the Constructor chain cannot start it now; it will wait without a guaranteed ETA until the chain is available.`,
  orderEnqueuedActive: (id: number) => `Order #${id} queued — worker picks it up within 2 mins; you will get an email with the PR.`,
  orderSendFailed: 'Could not send order — try again.',
  confirmDeleteInboxMsg: (count: number) => `Delete ${count === 1 ? 'selected message' : count + ' messages'} from inbox?`,
  mailDeleteResult: (deleted: number, detail: string) => `Deleted: ${deleted} — ${detail}`,
  mailDeleteFailed: 'Could not delete — try again.',
  confirmDeleteBuildOrder: (id: number) => `Permanently delete build order #${id}?`,
  orderDeleted: (id: number) => `Order #${id} deleted.`,
  orderDeleteFailed: 'Could not delete — try again.',
  confirmStopBuildOrder: (id: number) => `Cancel active order #${id}? (it will be recorded as cancelled and the worker will not continue)`,
  orderStopped: (id: number) => `Order #${id} cancelled.`,
  orderStopFailed: 'Could not stop — try again.',
  confirmClearFailedJobs: 'Archive the visible failed, cancelled and completed rows? (they remain recoverable; active orders remain)',
  ordersCleaned: (count: number) => `Archived: ${count} visible orders.`,
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
  gestureSaveFailed: 'NOT saved — server refused; toggle reverted. Try again.',
  gapArchiveFailed: 'Could not archive — try again.',
  alertCouldNotPerf: 'Could not perform action — server refused or session expired.',
  promptManualCreditAmount: (email: string, currency: string) => `Manual credit for ${email} — positive amount in ${currency}:`,
  alertInvalidAmount: (s: string) => `Amount "${s}" is not a valid positive value. Nothing credited.`,
  promptManualCreditReason: 'Credit reason (ex: refund, test, loyalty):',
  alertNotCredited: 'Not credited — server refused or session expired.',
  confirmDeleteGap: 'PERMANENTLY delete request?',
  confirmResetCounters: 'Reset consumption counters to 0?\n\nDeletes only supplier cost log.\nDoes NOT touch user credits, payment ledger or purchase history.\nAlready consumed credits are NOT refunded.',
  gapDeleteFailed: 'Could not delete request — try again.',
  mailFieldsRequired: 'Email and subject fields are required.',
  mailReplyFailed: 'Not sent — message was NOT saved; try again.',
}

const ro: AdminStrings = {
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
  tabVisitors: 'Vizitatori',
  tabShare: 'Distribuie',
  tabStores: 'Magazine',
  tabInbox: 'Inbox',
  tabGestures: 'Gesturi',
  tabTokens: 'Tokenuri',
  tabBuilder: 'Constructor',
  tabRecovery: 'Recuperare',
  tabSystem: 'Sistem',
  tabErrors: 'Erori',
  tabNotifications: 'Notificări',
  tabBrain: 'Creier OpenAI',
  loading: 'Se încarcă…',
  noSpendYet: 'Niciun consum încă.',
  noConversationsYet: 'Nicio conversație încă.',
  noVersionsYet: 'Nicio versiune salvată încă.',
  noOrdersYet: 'Niciun ordin încă.',
  noMessagesYet: 'Nu a scris niciun mesaj încă.',
  noContactMessagesYet: 'Niciun mesaj de contact încă.',
  noLettersYet: 'Nicio scrisoare încă (sau MAIL_PASS nesetat).',
  serperPillLive: 'Serper (căutarea web): {n} credite reale · click pentru dashboard',
  serperPillDead: 'Nu pot citi creditul Serper (SERPER_API_KEY lipsește sau citirea a picat)',
  pillsStale: '⚠ ultimele citiri au picat — cifrele afișate sunt vechi de {min} min, nu actuale.',
  vpsPillLive: 'VPS: {free} GB liberi din {total} GB · încărcare {load}% din {cpus} procesoare ({avg} la 1/5/15 min)',
  vpsPillDead: 'Nu pot măsura resursele VPS-ului (nu răspunde /proc)',
  checkingStores: 'Se verifică magazinele live…',
  notListedYet: '○ nelistat încă',
  readingMailbox: 'Se citește cutia…',
  mailboxEmpty: 'Folderul INBOX e gol. (Mailurile deja procesate de Secretar stau în folderele Kelion-Answered / Kelion-ToAnswer / Kelion-Automated.)',
  mailboxReadFail: 'Citirea IMAP a PICAT: {motiv} — e o citire eșuată, nu o cutie goală. Reîncearcă.',
  mailboxNotConfigured: 'MAIL_PASS nesetat — cutia nu poate fi citită deloc.',
  reply: 'Răspuns:',
  versionNotePlaceholder: 'Notă (opțional): ce e această versiune',
  buildOrderPlaceholder: 'Ordinul de construcție: ce, unde, cum se verifică',
  constructorModelLoading: 'Se citește modelul activ…',
  constructorModelUnreadable: 'Modelul activ nu a putut fi verificat. Niciun profil nu este presupus activ.',
  constructorModelVerifiedAt: (date: string) => `Verificat la ${date}`,
  constructorOutcomeUnresolved: (profile: string) => `Cerința s-a încheiat valid, dar nerezolvat, pe ${profile}.`,
  constructorOutcomeTechnicalFailure: (profile: string) => `Eroare tehnică pe ${profile} — nu este dovadă că modelul este prea slab.`,
  constructorOutcomeReason: (reason: string) => `Motiv: ${reason}`,
  constructorOutcomeNoOtherModel: 'Rularea este oprită. O nouă încercare cere explicit Reia; nu se propune schimbarea modelului.',
  constructorOutcomeTechnicalNoModelAdvice: 'Acest verdict tehnic nu recomandă alt model sau Reia.',
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
  orderEnqueuedWaiting: (id: number) => `Ordin #${id} în coadă — lanțul Constructor nu îl poate porni acum; așteaptă fără termen garantat până când lanțul este disponibil.`,
  orderEnqueuedActive: (id: number) => `Ordin #${id} în coadă — lucrătorul îl ia în max. 2 minute; primești email cu PR-ul.`,
  orderSendFailed: 'Nu s-a putut trimite — reîncearcă.',
  confirmDeleteInboxMsg: (count: number) => `Ștergi ${count === 1 ? 'mesajul selectat' : count + ' mesaje'} din inbox?`,
  mailDeleteResult: (deleted: number, detail: string) => `Șterse: ${deleted} — ${detail}`,
  mailDeleteFailed: 'Nu s-a putut șterge — reîncearcă.',
  confirmDeleteBuildOrder: (id: number) => `Ștergi definitiv ordinul #${id}?`,
  orderDeleted: (id: number) => `Ordinul #${id} șters.`,
  orderDeleteFailed: 'Nu s-a putut șterge — reîncearcă.',
  confirmStopBuildOrder: (id: number) => `Anulezi ordinul #${id} aflat în lucru? (este înregistrat ca „anulat”, iar lucrătorul nu-l mai continuă)`,
  orderStopped: (id: number) => `Ordinul #${id} anulat.`,
  orderStopFailed: 'Nu s-a putut opri — reîncearcă.',
  confirmClearFailedJobs: 'Arhivezi rândurile vizibile eșuate, anulate și terminate? (rămân recuperabile; ordinele active nu sunt atinse)',
  ordersCleaned: (count: number) => `Arhivate: ${count} ordine vizibile.`,
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
  gestureSaveFailed: 'NU s-a salvat — serverul a refuzat; bifa a revenit. Reîncearcă.',
  gapArchiveFailed: 'Nu s-a putut arhiva — reîncearcă.',
  alertCouldNotPerf: 'Nu s-a putut — serverul a refuzat sau sesiunea a expirat.',
  promptManualCreditAmount: (email: string, currency: string) => `Credit manual pentru ${email} — suma pozitivă în ${currency}:`,
  alertInvalidAmount: (s: string) => `Suma „${s}” nu este o valoare pozitivă validă. Nu s-a creditat nimic.`,
  promptManualCreditReason: 'Motivul creditării (ex: retur, test, fidelizare):',
  alertNotCredited: 'Nu s-a creditat — serverul a refuzat sau sesiunea a expirat.',
  confirmDeleteGap: 'Ștergi DEFINITIV cererea? (nu rămâne nici în istoric)',
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
