// ── TEXTUL PANOULUI DE ADMIN — ENGLEZA E BAZA, ROMÂNA E O TRADUCERE ─────────
//
// Regula lui Adrian (30 iul): „inclusiv aplicația toată default engleză", apoi
// limba userului, „inclusiv admin". Suprafața publică și cea a userului sunt
// deja făcute (`publicText.ts`, `i18n.ts`); panoul de admin era ultimul loc din
// aplicație scris direct în română.
//
// DE CE UN FIȘIER SEPARAT, nu `i18n.ts`: cheile astea se văd DOAR de admin.
// Puse în dicționarul comun, ar fi umflat tipul `Strings` cu ~60 de rubrici pe
// care fiecare limbă nouă ar trebui să le treacă — pentru un ecran pe care nu-l
// deschide niciun user. Aici namespace-ul e limpede și separat.
//
// Aceeași regulă de completitudine ca la `i18n.ts`: **engleza e obligatorie**
// (tipul o cere întreagă), restul limbilor sunt parțiale și cad curat pe
// engleză. Româna e completă fiindcă adminul de azi e român; o limbă care
// lipsește nu lasă rubrici goale, arată engleza.
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
  // Stări comune
  loading: string
  noSpendYet: string
  noTransactionsYet: string
  noContactsYet: string
  noVisitorsYet: string
  noConversationsYet: string
  noVoiceprintsYet: string
  noVersionsYet: string
  noOrdersYet: string
  noMessagesYet: string
  noContactMessagesYet: string
  noLettersYet: string
  // Bani
  setManual: string
  activate: string
  andRunWorkflow: string
  once: string
  transactionsHead: string
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
  noTransactionsYet: 'No transactions yet.',
  noContactsYet: 'No contacts yet.',
  noVisitorsYet: 'No visitors yet.',
  noConversationsYet: 'No conversations yet.',
  noVoiceprintsYet: 'No voiceprint recorded yet.',
  noVersionsYet: 'No version saved yet.',
  noOrdersYet: 'No orders yet.',
  noMessagesYet: 'They have not written a message yet.',
  noContactMessagesYet: 'No contact message yet.',
  noLettersYet: 'No letters yet (or MAIL_PASS is not set).',
  setManual: 'Set to Manual',
  activate: 'Activate',
  andRunWorkflow: ' and run the workflow ',
  once: ' (once)',
  transactionsHead: 'History — top-ups via Revolut transfer (unique code per payment)',
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
  noTransactionsYet: 'Nicio tranzacție încă.',
  noContactsYet: 'Niciun contact încă.',
  noVisitorsYet: 'Niciun vizitator încă.',
  noConversationsYet: 'Nicio conversație încă.',
  noVoiceprintsYet: 'Nicio amprentă vocală înregistrată încă.',
  noVersionsYet: 'Nicio versiune salvată încă.',
  noOrdersYet: 'Niciun ordin încă.',
  noMessagesYet: 'Nu a scris niciun mesaj încă.',
  noContactMessagesYet: 'Niciun mesaj de contact încă.',
  noLettersYet: 'Nicio scrisoare încă (sau MAIL_PASS nesetat).',
  setManual: 'Setează Manual',
  activate: 'Activează',
  andRunWorkflow: ' și rulează workflow-ul ',
  once: ' (o dată)',
  transactionsHead: 'Istoric — alimentări prin transfer Revolut (cod unic la fiecare plată)',
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

/** Textul panoului, în limba adminului conectat. Aceeași regulă ca peste tot:
 *  oglinda locală a limbii identificate de server, altfel engleză. */
export function adminStrings(): AdminStrings {
  const lang = resolveLang(loadLocalLang() ?? 'en')
  const gata = cache.get(lang)
  if (gata) return gata
  const unit: AdminStrings = lang === 'en' ? dict.en : { ...dict.en, ...(dict[lang] ?? {}) }
  cache.set(lang, unit)
  return unit
}
