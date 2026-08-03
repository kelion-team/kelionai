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
  tabUsers: string
  tabVisitors: string
  tabLiveChat: string
  tabChatHistory: string
  tabShare: string
  tabGaps: string
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
  noContactsYet: string
  noVisitorsYet: string
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
  /** Promptul + tooltipul creditului Gemini (auditul admin, 3 aug): erau
   *  hardcodate în română în Stage.tsx — regresie față de auditul i18n din
   *  2 aug; clickul deschide promptul, NU direct pagina Google. */
  gemCreditPrompt: string
  gemCreditTitle: string
  gemCreditSaveFailed: string
  gemCreditInvalid: string
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
  botsDetected: string
  byCountry: string
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
}

const en: AdminStrings = {
  tabMoney: 'Money',
  tabUsers: 'Users',
  tabVisitors: 'Visitors',
  tabLiveChat: 'Live chat',
  tabChatHistory: 'Chat history',
  tabShare: 'Share',
  tabGaps: 'Unmet requests',
  tabStores: 'Stores',
  tabInbox: 'Inbox',
  tabVoiceprints: 'Voiceprints',
  tabGestures: 'Gestures',
  tabTokens: 'Tokens',
  tabBuilder: 'Builder',
  tabRecovery: 'Recovery',
  loading: 'Loading…',
  noSpendYet: 'No spend yet.',
  noContactsYet: 'No contacts yet.',
  noVisitorsYet: 'No visitors yet.',
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
  gemPillLive: 'Gemini Tier 2 is live — the key is serving, so you have credit and it works. {spend}. Click: type the credit you see in AI Studio so the pill shows it; leave empty to open Google’s billing page; „-” clears the figure.',
  gemPillDead: 'Gemini is not serving right now ({why}) — if the prepay credit ran out, top it up. Click: type the credit you see in AI Studio; leave empty to open Google’s billing page. (The exact credit is only on Google’s page — no API exposes it.)',
  gemSpendMeasured: '${n} spent this month (measured)',
  gemSpendUnreadable: 'the month’s spend is unreadable right now (the journal read failed) — not $0',
  gemCreditPrompt: 'The Gemini credit you see in AI Studio (£).\nGoogle does not expose it via any API, so it is shown as stated by you, with the date.\n\nType the amount (e.g. 10.88) · empty = open Google’s page · „-” = clear the figure.',
  gemCreditTitle: 'Gemini credit: £{gbp} — stated by you{date} (Google does not expose it via API). {spend}. Click to update it.',
  gemCreditSaveFailed: 'The credit was NOT saved — the server refused. Try again.',
  gemCreditInvalid: 'Not a valid amount — type e.g. 10.88 (negatives are not a credit; use „-” to clear).',
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
  botsDetected: 'Bots detected',
  byCountry: 'By country',
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
}

const ro: AdminStrings = {
  tabMoney: 'Bani',
  tabUsers: 'Utilizatori',
  tabVisitors: 'Vizitatori',
  tabLiveChat: 'Chat live',
  tabChatHistory: 'Istoric chat',
  tabShare: 'Distribuie',
  tabGaps: 'Cereri neacoperite',
  tabStores: 'Magazine',
  tabInbox: 'Inbox',
  tabVoiceprints: 'Amprente vocale',
  tabGestures: 'Gesturi',
  tabTokens: 'Tokenuri',
  tabBuilder: 'Constructor',
  tabRecovery: 'Recuperare',
  loading: 'Se încarcă…',
  noSpendYet: 'Niciun consum încă.',
  noContactsYet: 'Niciun contact încă.',
  noVisitorsYet: 'Niciun vizitator încă.',
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
  gemPillLive: 'Gemini Tier 2 activ — cheia servește, deci ai credit și merge. {spend}. Click: scrii creditul din AI Studio ca să apară pe pastilă; gol = pagina de facturare Google; „-” șterge cifra.',
  gemPillDead: 'Gemini nu servește acum ({why}) — dacă s-a epuizat creditul prepay, reîncarcă-l. Click: scrii creditul din AI Studio; gol = pagina de facturare Google. (Creditul exact e doar pe pagina Google — niciun API nu-l expune.)',
  gemSpendMeasured: '${n} cheltuiți luna asta (măsurat)',
  gemSpendUnreadable: 'cheltuiala lunii e necitibilă acum (citirea jurnalului a picat) — nu $0',
  gemCreditPrompt: 'Creditul Gemini pe care îl vezi în AI Studio (£).\nGoogle nu-l expune prin API, așa că-l arăt ca fiind spus de tine, cu data.\n\nScrie suma (ex: 10.88) · gol = deschide pagina Google · „-” = șterge cifra.',
  gemCreditTitle: 'Credit Gemini: £{gbp} — spus de tine{date} (Google nu-l dă prin API). {spend}. Click ca să-l actualizezi.',
  gemCreditSaveFailed: 'Creditul NU s-a salvat — serverul a refuzat. Reîncearcă.',
  gemCreditInvalid: 'Suma nu e validă — scrie de ex. 10.88 (negativul nu e credit; „-” șterge cifra).',
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
  botsDetected: 'Boți detectați',
  byCountry: 'După țară',
  liveVisitorChats: 'Conversații live cu vizitatorii',
  pickConversation: 'Alege o conversație ca să răspunzi.',
  replyToVisitor: 'Răspunde vizitatorului…',
  appLink: 'Linkul aplicației',
  shareOnSocial: 'Trimite linkul pe rețele',
  videoPlatforms: 'Platforme video — deschid studioul; clipul îl generezi întâi (pașii de mai sus), apoi îl urci de acolo',
  loadingAudit: 'Se încarcă auditul…',
  nothingDown: 'Nimic căzut acum: sănătatea e verde, zero erori de server, zero erori de client, zero construcții eșuate.',
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
