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
  orPillLive: string
  orPillLow: string
  orPillDead: string
  oaPillLive: string
  oaPillDead: string
  serperPillLive: string
  serperPillDead: string
  gemPillLive: string
  gemPillDead: string
  vpsPillLive: string
  vpsPillDead: string
  // Magazine
  checkingStores: string
  notListedYet: string
  downloadsHead: string
  // Inbox
  readingMailbox: string
  mailboxEmpty: string
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
  orPillLive: 'OpenRouter (the central brain): ${n} real{low} · click to top up',
  orPillLow: ' — deposit money!',
  orPillDead: 'Cannot read the OpenRouter balance (key missing or account unreachable)',
  oaPillLive: 'OpenAI (the voice): ${n} spent this month — measured from OpenAI’s API · click for details',
  oaPillDead: 'Cannot read the OpenAI spend (OPENAI_USAGE_KEY missing or the read failed)',
  serperPillLive: 'Serper (web search): {n} real credits · click for the dashboard',
  serperPillDead: 'Cannot read the Serper credit (SERPER_API_KEY missing or the read failed)',
  gemPillLive: 'Gemini Tier 2 is live — the key is serving, so you have credit and it works. ${n} spent this month (measured). Click to see the real balance on Google’s billing page.',
  gemPillDead: 'Gemini is not serving right now ({why}) — if the prepay credit ran out, top it up. Click for Google’s billing page. (The exact credit is only on Google’s page — no API exposes it.)',
  vpsPillLive: 'VPS: {free} GB free of {total} GB · load {load}% of {cpus} processors ({avg} at 1/5/15 min)',
  vpsPillDead: 'Cannot measure the VPS resources (/proc is not answering)',
  checkingStores: 'Checking the stores live…',
  notListedYet: '○ not listed yet',
  downloadsHead: 'Who downloaded (last 100)',
  readingMailbox: 'Reading the mailbox…',
  mailboxEmpty: 'The mailbox is empty or could not be read (check MAIL_PASS).',
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
  botsDetected: 'Bots detected',
  byCountry: 'By country',
  liveVisitorChats: 'Live conversations with visitors',
  pickConversation: 'Pick a conversation to reply to.',
  replyToVisitor: 'Reply to the visitor…',
  appLink: 'App link',
  shareOnSocial: 'Share the link on social networks',
  videoPlatforms: 'Video platforms — the promo clips are in the Downloads folder; upload them in their studio',
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
  orPillLive: 'OpenRouter (creierul central): ${n} real{low} · click pentru alimentare',
  orPillLow: ' — depune bani!',
  orPillDead: 'Nu pot citi soldul OpenRouter (cheie lipsă sau cont inaccesibil)',
  oaPillLive: 'OpenAI (vocea): ${n} cheltuiți luna asta — măsurat din API-ul OpenAI · click pentru detalii',
  oaPillDead: 'Nu pot citi cheltuiala OpenAI (OPENAI_USAGE_KEY lipsește sau citirea a picat)',
  serperPillLive: 'Serper (căutarea web): {n} credite reale · click pentru dashboard',
  serperPillDead: 'Nu pot citi creditul Serper (SERPER_API_KEY lipsește sau citirea a picat)',
  gemPillLive: 'Gemini Tier 2 activ — cheia servește, deci ai credit și merge. ${n} cheltuiți luna asta (măsurat). Click pentru creditul real pe pagina de facturare Google.',
  gemPillDead: 'Gemini nu servește acum ({why}) — dacă s-a epuizat creditul prepay, reîncarcă-l. Click pentru pagina de facturare Google. (Creditul exact e doar pe pagina Google — niciun API nu-l expune.)',
  vpsPillLive: 'VPS: {free} GB liberi din {total} GB · încărcare {load}% din {cpus} procesoare ({avg} la 1/5/15 min)',
  vpsPillDead: 'Nu pot măsura resursele VPS-ului (nu răspunde /proc)',
  checkingStores: 'Se verifică magazinele live…',
  notListedYet: '○ nelistat încă',
  downloadsHead: 'Cine a descărcat (ultimele 100)',
  readingMailbox: 'Se citește cutia…',
  mailboxEmpty: 'Cutia e goală sau nu s-a putut citi (verifică MAIL_PASS).',
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
  botsDetected: 'Boți detectați',
  byCountry: 'După țară',
  liveVisitorChats: 'Conversații live cu vizitatorii',
  pickConversation: 'Alege o conversație ca să răspunzi.',
  replyToVisitor: 'Răspunde vizitatorului…',
  appLink: 'Linkul aplicației',
  shareOnSocial: 'Trimite linkul pe rețele',
  videoPlatforms: 'Platforme video — clipurile promo sunt în folderul Downloads; se încarcă în studioul lor',
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
