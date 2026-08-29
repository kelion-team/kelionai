// Minimal i18n. UI strings per language; English is the fallback for any
// language we don't have a translation for. Add a new language by adding a
// block to `dict` — nothing else changes.
import { loadLocalLang } from './prefs'
import { productConfig } from './productConfig'

export type Lang = 'en' | 'ro' | 'es' | 'fr' | 'de' | 'it' | 'pt'

export interface Strings {
  signIn: string
  signOut: string
  chatHint: string
  chatPlaceholder: string
  send: string
  functionsTitle: string
  attachTitle: string
  imagePrompt: string
  greetPrompt: string
  scenarioTitle: string
  scenarioHint: string
  scenarioRecord: string
  scenarioStop: string
  scenarioRecording: string
  monitorTitle: string
  execTitle: string
  disconnectCamTitle: string
  connectCamTitle: string
  cameraConsentPrompt: string
  micBlocked: string
  micNoDevice: string
  micUnsupported: string
  brainNotActive: string
  brainError: string
  turnIndeterminate: string
  offline: string
  // ── VERDICTE ONESTE PE COD DE EROARE (registrul frontend, lot C): sesiune
  // expirată ≠ „am pierdut netul", paywall ≠ „eroare la creier", prea multe
  // cereri ≠ „cererea s-a rupt pe drum" — fiecare cauză cu vorba EI. Plus
  // rândul onest pentru tura online încheiată complet GOALĂ (nimic pe ecran,
  // nimic pe monitor, niciun sunet) — tăcerea totală era minciună prin omisiune.
  paywallRow: string
  rateLimited: string
  turnEmpty: string
  offlineCompanion: string
  offlineFaraWebgpu: string
  offlineModelNepregatit: string
  offlineEroareLocal: string
  raspunsAmanat: string
  updateNouAnunt: string
  credits: string
  topUp: string
  lowCredit: string
  landingHeadline: string
  landingSub: string
  manualTitle: string
  multilingual: string
  features: readonly string[]
  /** The self-applying countdown in the version bar — `{n}` = seconds left. */
  /** Blocking gate: you cannot continue on the old version until you update. */
  cookieNote: string
  privacyLabel: string
  termsLabel: string
  errClosed: string
  errBadState: string
  errTokenExchange: string
  errNoIdToken: string
  errNoEmail: string
  errGeneric: string
  // ── THE MONITOR (Stage.tsx) — they were written directly in code, in Romanian ──
  // 20 texts that a Romanian logged-out user saw in Romanian: button titles,
  // empty states and failure messages.
  wsFileFailed: string
  wsOpenFile: string
  wsPageBlocked: string
  wsDownloadArchive: string
  // Aug 2 (the monitor runs every format): media that can't play (codec the
  // browser lacks, e.g. .mkv/.avi) and binaries with no in-page viewer get an
  // HONEST fallback + download, never a dead black box.
  wsMediaFailed: string
  wsFileNoPreview: string
  wsDownloadFile: string
  // THE THEME TOGGLE (Aug 2 — the lighter background): top-bar button that
  // flips between the new light default and the original dark identity.
  themeToDark: string
  langPickTitle: string
  manualLabel: string
  cvTitle: string
  cvBaseTitle: string
  cvBaseHint: string
  cvUpload: string
  cvUploadBusy: string
  cvBasePlaceholder: string
  cvSave: string
  cvSaveBusy: string
  cvSaved: string
  cvJobTitle: string
  cvYourName: string
  cvNamePlaceholder: string
  cvJobSpec: string
  cvJobSpecPlaceholder: string
  cvAdaptBtn: string
  cvAdaptBusy: string
  cvResultTitle: string
  cvResultPlaceholder: string
  cvDownload: string
  cvCopy: string
  cvCopied: string
  cvDone: string
  cvErrLoad: string
  cvErrSave: string
  cvErrRead: string
  cvErrNet: string
  cvErrNeedCv: string
  cvErrNeedSpec: string
  themeToLight: string
  wsClose: string
  wsCloseAll: string
  wsCopy: string
  wsZoomFit: string
  wsZoomOut: string
  wsZoomIn: string
  wsSaveHtml: string
  wsSaveTxt: string
  buildLoading: string
  buildEmpty: string
  buildWaiting: string
  buildCiOk: string
  buildCiRunning: string
  buildThrottled: string
  // ── THE LATENCY AND LISTENING BANDS (ChatPanel.tsx) ──────────────────────
  latencyChip: string
  /** Tooltip of the hourglass+stopwatch shown while Kelion really works. */
  workClockTitle: string
  heardYouTitle: string
  heardBrainTitle: string
  /** Title of the K band — the reply flowing FROM the brain. */
  heardKelionTitle: string
  // ── THE COMPOSER (ChatPanel.tsx) — frontend audit, Aug 2 ─────────────────
  micTalk: string
  micStop: string
  voiceVolume: string
  // ── MODUL MAȘINĂ (Adrian, 11 aug) — voce-first, legislație auto ───────────
  carMode: string
  carExit: string
  carHint: string
  // MINIM 4G (owner, 13 aug): nota scurtă, non-blocantă, pe conexiune slabă (2G/3G).
  retea4g: string
  carVoiceOn: string
  carVoiceOff: string
  carListening: string
  // ── MESSENGER KELION↔KELION (Adrian, 11 aug) — interfața de apel ──────────
  apelSuna: string
  apelAccepta: string
  apelRefuza: string
  apelSunPe: string
  apelConectat: string
  apelNotaFaza2: string
  apelInchide: string
  /** Anunțul vocal la apel primit — {name} se înlocuiește cu numele apelantului. */
  apelAnunt: string
  /** The send button while a turn is running — sending INTERRUPTS (Jul 13 barge-in). */
  sendInterrupts: string
  attRemove: string
  // ── ATTACHMENTS, HONEST (audit Aug 2: a failed conversion vanished without
  // a trace; the admin "raw" chip was never actually transmitted) ───────────
  /** `{name}` = file name. */
  docAttachFailed: string
  /** `{name}` = file name. */
  docTooLarge: string
  docPrompt: string
  /** Offline: o imagine atașată nu are drum spre creierul local (text-only).
   *  OPȚIONALĂ (doar en/ro azi — restul limbilor cad pe fallback-ul en de la
   *  locul de folosire; clasa B11, declarată în RAMAS). */
  offlineNoVision?: string
  // ── THE VOICE, HONEST (audit Aug 2: the real reason was thrown away) ─────
  voiceDownTemp: string
  voiceInvalidKey: string
  voiceProviderQuota: string
  voiceModelAccess: string
  voiceNotConfigured: string
  voiceIdleTimeout: string
  voiceSessionLimit: string
  voiceBillingConflict: string
  voiceBillingUnavailable: string
  voiceRetryStopped: string
  voiceNeedLogin: string
  voiceNeedCredit: string
  asrLost: string
  stopAck: string
  // ── PROMO RECORDING (they were RO/EN inline ternaries — 5 languages got
  // whichever branch the SPEECH language picked, not the UI language) ───────
  promoTakeSaved: string
  /** `{subject}` = the clip's subject. */
  promoWrongLang: string
  promoRetake: string
  promoRecStopped: string
  promoRecReady: string
  promoVoiceLost: string
  recStartTitle: string
  recStopTitle: string
  // ── STAGE (audit Aug 2: Romanian literals next to the very keys that
  // should have carried them) ───────────────────────────────────────────────
  back: string
  wsSave: string
  wsSaved: string
  wsOpenTab: string
  wsArchiveNote: string
  creditOut: string
  creditOk: string
  contactLabel: string
  buildQueued: string
  buildRunning: string
  buildDone: string
  buildDoneUnverified: string
  buildFailed: string
  buildCancelled: string
  buildOnlyAdmin: string
  /** Sesiunea a murit (401) — NU e o problemă de rol; omul trebuie doar să se
   *  logheze iar (9 aug: 403-ul mincinos îl făcea pe owner să creadă că nu mai
   *  e admin). */
  sessionExpired: string
  buildUnavailable: string
  buildNoServer: string
  buildHead: string
  /** `{n}` = attempt number. */
  buildAttempt: string
  buildSeePr: string
  /** Butonul × de pe fiecare ordin viu (owner, 13 aug: „nu are x de oprit
   *  individual"). Oprește DOAR ordinul lui, nu tot panoul. */
  buildStop: string
  /** `{n}` = numărul ordinului. Confirmarea înainte de a opri un ordin în lucru. */
  buildStopConfirm: string
  buildCiFailed: string
  // ── THE PAYMENT CODE, SHOWN (M4, Aug 2): matching depends on the person
  // writing this code in the transfer reference — and the UI used to navigate
  // away without ever showing it. ────────────────────────────────────────────
  checkoutTitle: string
  checkoutHint: string
  checkoutOpen: string
  checkoutWaiting: string
  // ── THE HONEST CONNECTION VERDICT (Adrian, 2 aug: the app claimed „lost
  // internet" with zero measurement; now the claim is measured — see
  // diagnozaConexiune in lib/chat.ts) ──────────────────────────────────────
  serverDown: string
  requestLost: string
  // ── CUSTOMER SETTINGS ───────────────────────────────────────────────────
  title: string
  close: string
  prefs: string
  langLabel: string
  voiceLabel: string
  voiceDefault: string
  voiceNote: string
  wallet: string
  account: string
  signedInAs: string
  loggingOut: string
  logout: string
  deleteAcc: string
  deleteConfirm: string
  deleteAccClosed: string
  cancel: string
  deleting: string
}
// ── ENGLEZA E BAZA, PE FIECARE CHEIE ────────────────────────────────────────
// Adrian's rule (Jul 30): "100% English in the whole app; then the per-user
// language rule applies, including admin".
//
// The type requires COMPLETE English and leaves the other languages PARTIAL. Before,
// `Record<Lang, Strings>` forced every language to have ALL keys — meaning a
// translation could only be added as a block, or not at all. That's why
// hundreds of texts stayed written directly in code: it was easier than translating everything at once.
// Now an untranslated key falls cleanly onto English, not onto blank; translations can
// be added in stages, without the interface ever having empty labels.
const dict: { en: Strings } & Partial<Record<Lang, Partial<Strings>>> = {
  en: {
    signIn: 'Sign in with Google',
    signOut: 'Sign out',
    chatHint: 'Say something to Kelion…',
    chatPlaceholder: 'Message Kelion',
    send: 'Send',
    functionsTitle: 'Functions',
    attachTitle: 'Attach file',
    imagePrompt: 'What do you see in this image?',
    greetPrompt: 'Greet me briefly, suited to the time of day. Do NOT describe or comment on the camera or the image.',
    scenarioTitle: 'Promo scenario (record)',
    scenarioHint: 'One step per line — Kelion runs them while recording. Keep it short (~15s).',
    scenarioRecord: 'Record',
    scenarioStop: 'Stop',
    scenarioRecording: 'Recording scenario…',
    monitorTitle: 'Monitor mode',
    execTitle: 'Live execution',
    disconnectCamTitle: 'Disconnect camera',
    connectCamTitle: 'Connect camera',
    cameraConsentPrompt: 'Turn on the camera for snapshots you or Kelion explicitly request? Continuous vision, location and face storage stay off unless you enable each one separately.',
    micBlocked: 'Microphone blocked. Allow mic access in the browser, then tap the mic again.',
    micNoDevice: 'No microphone found.',
    micUnsupported: 'Speech recognition is not supported in this browser. Use Chrome.',
    brainNotActive: 'The brain is not active yet (OpenAI is not configured).',
    brainError: 'Brain error. Please try again.',
    turnIndeterminate: 'This request may already have performed an action, but its final result was lost. Check the result before trying anything again.',
    offline: "I've lost the internet connection — I'll be right back when the signal returns.",
    paywallRow: "You've reached the free plan's limit — check the options to continue.",
    rateLimited: 'Too many requests in a short time — wait a moment and try again.',
    turnEmpty: 'I came back without an answer this time — please ask me again.',
    offlineCompanion: "Offline — companion mode. I'm here with you; full Kelion returns when you get signal.",
    offlineFaraWebgpu: "I'm in companion mode, but this device has no WebGPU — I can't run the local brain offline here.",
    offlineModelNepregatit: "I'm offline. The local brain isn't downloaded yet — prepare it while you have signal and I'll work without a connection too.",
    offlineEroareLocal: 'The local brain hit a problem:',
    raspunsAmanat: 'I can now tell you the answer to what you asked while you were offline',
    updateNouAnunt: 'New version ready — tap to apply',
    credits: 'credits',
    topUp: 'Please top up your credit',
    lowCredit: 'Your credit is running low — please top up.',
    landingHeadline: 'Your brilliant assistant. It sees, hears and speaks.',
    // NO FREE TRIAL (Adrian — see Landing.tsx: "Nobody gets free minutes
    // anymore"): this line used to promise "Try it free for 10 minutes" in all
    // 7 languages while the product had no free trial. The promise is gone.
    landingSub:
      'Talk to Kelion in your own language — ask, show, navigate, create. Sign in with Google and add credit to start.',
    manualTitle: 'Everything Kelion can do',
    multilingual: 'Multinational support — understands and replies in dozens of languages, written and spoken.',
    features: [
      'Natural conversation with a genuinely brilliant mind',
      'Speaks and listens — fully hands-free',
      'Sees through your camera',
      'Email, Calendar, Tasks, Drive and Contacts',
      'Live web search and up-to-date facts',
      'Maps, routes and live navigation',
      'Weather anywhere in the world',
      'Finds and plays YouTube and music',
      'Creates images, logos and designs',
      'Translates and writes in any language or tone',
      'A team of seven specialist agents working for you',
      'Writes real software and tests it in a live sandbox',
    ],
    cookieNote: 'We use cookies and basic analytics to run the site.',
    privacyLabel: 'Privacy',
    termsLabel: 'Terms',
    errClosed: 'Kelionai is currently private. This account does not have access yet.',
    errBadState: 'Login failed (security check). Please try again.',
    errTokenExchange: 'Could not complete Google sign-in. Please try again.',
    errNoIdToken: 'Google did not return an identity. Please try again.',
    errNoEmail: 'Could not read a verified email from Google.',
    errGeneric: 'Sign-in error. Please try again.',
    wsFileFailed: "Couldn't load the contents of this file here.",
    wsOpenFile: 'Open the file ↗',
    wsPageBlocked: 'This page cannot be displayed here.',
    wsDownloadArchive: 'Download the archive ↓',
    wsMediaFailed: "This media can't be played in the browser (unsupported format or codec).",
    wsFileNoPreview: "This file type can't be previewed in the page — you can download it.",
    wsDownloadFile: 'Download the file ↓',
    themeToDark: 'Switch to the dark theme',
    langPickTitle: 'Language Kelion speaks to you',
    manualLabel: 'Manual',
    cvTitle: 'CV Tailoring',
    cvBaseTitle: '1. Your base CV',
    cvBaseHint: 'Write it here or upload a TXT, Markdown, CSV, PDF or DOCX file. It is saved for next time.',
    cvUpload: 'Upload CV (TXT / PDF / DOCX)',
    cvUploadBusy: 'Reading the file...',
    cvBasePlaceholder: 'Write or upload your base CV here...',
    cvSave: 'Save base CV',
    cvSaveBusy: 'Saving...',
    cvSaved: 'Your base CV was saved.',
    cvJobTitle: '2. The job (you find it)',
    cvYourName: 'Your name (for the file):',
    cvNamePlaceholder: 'e.g. John Smith',
    cvJobSpec: 'Job specification (paste the full ad):',
    cvJobSpecPlaceholder: 'Paste the title + the full description/requirements of the job you found...',
    cvAdaptBtn: 'Tailor & Preview',
    cvAdaptBusy: 'Tailoring your CV...',
    cvResultTitle: '3. Tailored CV',
    cvResultPlaceholder: 'Your CV tailored to the job requirements appears here. Preview it, then download.',
    cvDownload: '\u2b07 Download',
    cvCopy: 'Copy',
    cvCopied: 'The tailored CV was copied.',
    cvDone: 'Done — preview and download.',
    cvErrLoad: 'Could not load your saved CV.',
    cvErrSave: 'The CV could not be saved.',
    cvErrRead: 'Could not read the file.',
    cvErrNet: 'A network error occurred.',
    cvErrNeedCv: 'Write or upload your base CV first.',
    cvErrNeedSpec: 'Paste the job specification (the ad).',
    themeToLight: 'Switch to the light theme',
    wsClose: 'Close',
    wsCloseAll: 'Close everything',
    wsCopy: 'Copy',
    wsZoomFit: 'Fit the text (zoom)',
    wsZoomOut: 'Zoom out',
    wsZoomIn: 'Zoom in',
    wsSaveHtml: "Save to Kelion's memory + download (.html)",
    wsSaveTxt: "Save to Kelion's memory + download (.txt)",
    buildLoading: 'Loading…',
    buildEmpty: 'Nothing in progress. When Kelion picks up a request, it shows here step by step.',
    buildWaiting: 'Waiting for the worker…',
    buildCiOk: 'Independently verified by CI (build + tests on a clean machine)',
    buildCiRunning: 'CI is still running on the pull request',
    buildThrottled: 'Waiting for quota',
    latencyChip: 'sent → first word / full answer',
    workClockTitle: 'Kelion is really working on the task — live elapsed time',
    heardYouTitle: 'You — on the way to the brain',
    heardBrainTitle: 'The brain got it and is thinking',
    heardKelionTitle: 'Kelion — from the brain',
    micTalk: 'Talk (microphone)',
    micStop: 'Stop the microphone',
    carMode: 'Car mode',
    carExit: 'Exit car mode',
    carHint: 'Talk — I answer out loud, eyes on the road',
    retea4g: 'For the full experience (fast voice, 3D avatar) you need at least 4G — basic chat still works.',
    carVoiceOn: 'Start voice',
    carVoiceOff: 'Stop voice',
    carListening: 'Listening — talk freely',
    apelSuna: 'is calling you',
    apelAccepta: 'Answer',
    apelRefuza: 'Decline',
    apelSunPe: 'Calling',
    apelConectat: 'Connected',
    apelNotaFaza2: 'Speak — I translate live',
    apelInchide: 'Hang up',
    apelAnunt: '{name} is calling. Say answer or decline.',
    voiceVolume: 'Kelion’s voice volume',
    sendInterrupts: 'Kelion is answering — send now and your message replaces the current answer',
    attRemove: 'Remove attachment',
    docAttachFailed: 'I couldn’t read “{name}” — it was NOT attached.',
    docTooLarge: '“{name}” is too large to attach (the limit is about 18 MB).',
    offlineNoVision: 'You are offline — I cannot look at images right now (the offline brain is text-only). The picture was not sent anywhere; try again when the connection returns.',
    docPrompt: 'I attached a document — read it and tell me what it contains.',
    voiceDownTemp:
      'My live voice is temporarily unavailable — dictation and typing still work, and I will retry the full voice by myself shortly.',
    voiceInvalidKey:
      'Live voice is off because the OpenAI key configured on the server is invalid. The administrator must correct it.',
    voiceProviderQuota:
      'Live voice is off because the OpenAI API project has no available quota. This is separate from your Kelion credit.',
    voiceModelAccess:
      'Live voice is off because the OpenAI API project cannot access the configured Realtime model.',
    voiceNotConfigured:
      'Live voice is off because its OpenAI server configuration is missing or invalid.',
    voiceIdleTimeout:
      'Live voice stopped after a period of inactivity. Press the microphone when you want to speak again.',
    voiceSessionLimit:
      'Live voice is already open in another tab or device. Close it there, then press the microphone here.',
    voiceBillingConflict:
      'Live voice stopped to prevent a duplicate charge. The administrator must check the billing record before trying again.',
    voiceBillingUnavailable:
      'Live voice stopped because usage could not be recorded safely. The administrator must check billing storage before trying again.',
    voiceRetryStopped:
      'Live voice still cannot connect. Automatic retries have stopped; press the microphone to start a new attempt.',
    voiceNeedLogin: 'The live voice needs you signed in — sign in and I can speak again.',
    voiceNeedCredit:
      'Your credit has run out, so the live voice is paused — typing still works. Top up and the voice comes back.',
    asrLost: 'I couldn’t transcribe that — please say it again.',
    stopAck: 'Stopped.',
    promoTakeSaved: 'Take stopped and the clip was saved. Say “retake” to do the same take again.',
    promoWrongLang:
      'The saved script was in another language. Say “make a clip about {subject}” again and I’ll redo it in your language.',
    promoRetake: 'Same take again — press the pulsing red button and pick the screen.',
    promoRecStopped: 'Recording stopped — the clip is saving to Downloads.',
    promoRecReady: 'Ready to record. Press the pulsing red button at the top and pick the screen.',
    promoVoiceLost: 'Part of the narration failed to synthesize — the clip may have silent gaps.',
    recStartTitle: 'Record a promo clip',
    recStopTitle: 'Stop recording',
    back: 'Back',
    wsSave: 'Save',
    wsSaved: 'Saved ✓',
    wsOpenTab: 'Open in a new tab ↗',
    wsArchiveNote: 'Archive ({name}) — its contents can’t be previewed in the page. You can download it:',
    creditOut: 'Credit used up — top up to continue',
    creditOk: 'You have credit',
    contactLabel: 'Contact',
    buildQueued: 'Queued',
    buildRunning: 'Working',
    buildDone: 'Done',
    buildDoneUnverified: 'Finished without live proof',
    buildFailed: 'Failed',
    buildCancelled: 'Cancelled',
    buildOnlyAdmin: 'Only the admin can see the builder.',
    sessionExpired: 'Your session expired — sign in again.',
    buildUnavailable: 'The builder is unavailable right now.',
    buildNoServer: 'No connection to the server.',
    buildHead: 'Kelion’s builder',
    buildAttempt: 'attempt {n}',
    buildSeePr: 'See the PR ↗',
    buildStop: 'Stop this order',
    buildStopConfirm: 'Stop order #{n}? What it has already done is kept; it just stops here.',
    buildCiFailed: 'CI failed on the PR',
    checkoutTitle: 'Secure Revolut checkout',
    checkoutHint: 'The amount and your account are already linked. Confirm the payment on Revolut; no reference code is needed.',
    checkoutOpen: 'Continue securely to Revolut ↗',
    checkoutWaiting: 'Credit is added only after Revolut confirms the completed payment.',
    serverDown:
      'The server isn’t answering right now — it is NOT your internet. I keep checking and will pick this up by myself the moment it returns.',
    requestLost: 'The request broke on the way (your internet and the server are fine) — please send it again.',
    title: 'Client Settings',
    close: 'Close',
    prefs: 'Language & Voice Preferences',
    langLabel: 'Language Kelion speaks to you',
    voiceLabel: 'Voice used for synthesis',
    voiceDefault: 'Default voice (set by server)',
    voiceNote: 'This setting controls how Kelion hears and responds to you vocally.',
    wallet: 'Wallet & Credits',
    account: 'Your Account',
    signedInAs: 'Signed in as:',
    loggingOut: 'Logging out...',
    logout: 'Log out',
    deleteAcc: 'Request data deletion',
    deleteConfirm: 'Permanently delete and anonymize your account data? The server may require recent Google reauthentication and will return a deletion receipt with any legally retained categories.',
    deleteAccClosed: `The deletion service did not confirm the request. No success is assumed; contact ${productConfig.supportEmail} for support.`,
    cancel: 'Cancel',
    deleting: 'Deleting...',
  },
  ro: {
    signIn: 'Conectează-te cu Google',
    signOut: 'Deconectare',
    chatHint: 'Spune-i ceva lui Kelion…',
    chatPlaceholder: 'Scrie-i lui Kelion',
    send: 'Trimite',
    functionsTitle: 'Funcții',
    attachTitle: 'Atașează fișier',
    imagePrompt: 'Ce vezi în această imagine?',
    greetPrompt: 'Salută-mă scurt, potrivit cu ora zilei. NU menționa că ai primit sau că vezi vreo imagine (interzis "Văd" / "Observ"). Salvează imaginea tăcut.',
    scenarioTitle: 'Scenariu promo (înregistrare)',
    scenarioHint: 'Câte un pas pe linie — Kelion le rulează în timp ce înregistrează. Ține-l scurt (~15s).',
    scenarioRecord: 'Înregistrează',
    scenarioStop: 'Stop',
    scenarioRecording: 'Înregistrez scenariul…',
    monitorTitle: 'Mod monitor',
    execTitle: 'Execuție în direct',
    disconnectCamTitle: 'Deconectează camera',
    connectCamTitle: 'Conectează camera',
    cameraConsentPrompt: 'Pornești camera pentru instantaneele cerute explicit de tine sau de Kelion? Vederea continuă, locația și stocarea facială rămân oprite până le activezi separat.',
    micBlocked: 'Microfonul e blocat. Permite accesul la microfon în browser, apoi apasă din nou pe microfon.',
    micNoDevice: 'Niciun microfon găsit.',
    micUnsupported: 'Recunoașterea vocală nu e suportată în acest browser. Folosește Chrome.',
    brainNotActive: 'Creierul nu e încă activat (OpenAI nu este configurat).',
    brainError: 'Eroare la creier. Încearcă din nou.',
    turnIndeterminate: 'Cererea poate să fi executat deja o acțiune, dar rezultatul final s-a pierdut. Verifică rezultatul înainte să repeți.',
    offline: 'Am pierdut conexiunea la internet — revin de îndată ce revine semnalul.',
    paywallRow: 'Ai atins limita planului gratuit — vezi opțiunile ca să continui.',
    rateLimited: 'Prea multe cereri într-un timp scurt — așteaptă puțin și încearcă din nou.',
    turnEmpty: 'Am rămas fără răspuns de data asta — mai întreabă-mă o dată.',
    offlineCompanion: 'Offline — mod companion. Sunt cu tine; Kelion complet revine când prinzi semnal.',
    offlineFaraWebgpu: 'Sunt în mod companion, dar dispozitivul ăsta nu are WebGPU — nu pot rula creierul local offline aici.',
    offlineModelNepregatit: 'Sunt offline. Creierul local nu e încă descărcat — pregătește-l cât ai semnal și apoi merg și fără net.',
    offlineEroareLocal: 'Creierul local a dat de o problemă:',
    raspunsAmanat: 'Îți pot spune acum răspunsul la ce m-ai întrebat cât erai offline',
    updateNouAnunt: 'Versiune nouă pregătită — apasă ca s-o aplici',
    credits: 'credite',
    topUp: 'Te rog reîncarcă creditul',
    lowCredit: 'Mai ai puțin credit — te rog reîncarcă.',
    landingHeadline: 'Asistentul tău genial. Vede, aude și vorbește.',
    landingSub:
      'Vorbește cu Kelion în limba ta — întreabă, arată, navighează, creează. Conectează-te cu Google și pune credit ca să începi.',
    manualTitle: 'Tot ce știe Kelion să facă',
    multilingual: 'Suport multinațional — înțelege și răspunde în zeci de limbi, scris și vorbit.',
    features: [
      'Conversație naturală cu o minte cu adevărat genială',
      'Vorbește și ascultă — complet hands-free',
      'Vede prin camera ta',
      'Email, Calendar, Sarcini, Drive și Contacte',
      'Căutare web live și informații la zi',
      'Hărți, rute și navigație în timp real',
      'Vremea oriunde în lume',
      'Găsește și pune YouTube și muzică',
      'Creează imagini, logo-uri și design',
      'Traduce și scrie în orice limbă sau ton',
      'O echipă de șapte agenți specialiști pentru tine',
      'Scrie software real și îl testează într-un sandbox live',
    ],
    cookieNote: 'Folosim cookies și analytics de bază pentru funcționarea site-ului.',
    privacyLabel: 'Confidențialitate',
    termsLabel: 'Termeni',
    errClosed: 'Kelionai este momentan privat. Acest cont nu are încă acces.',
    errBadState: 'Autentificarea a eșuat (verificare de securitate). Încearcă din nou.',
    errTokenExchange: 'Nu am putut finaliza conectarea cu Google. Încearcă din nou.',
    errNoIdToken: 'Google nu a returnat o identitate. Încearcă din nou.',
    errNoEmail: 'Nu am putut citi un email verificat de la Google.',
    errGeneric: 'Eroare la conectare. Încearcă din nou.',
    wsFileFailed: 'Nu am putut aduce conținutul fișierului aici.',
    wsOpenFile: 'Deschide fișierul ↗',
    wsPageBlocked: 'Această pagină nu poate fi afișată aici.',
    wsDownloadArchive: 'Descarcă arhiva ↓',
    wsMediaFailed: 'Acest fișier media nu poate fi redat în browser (format sau codec neacceptat).',
    wsFileNoPreview: 'Acest tip de fișier nu se poate previzualiza în pagină — îl poți descărca.',
    wsDownloadFile: 'Descarcă fișierul ↓',
    themeToDark: 'Comută pe tema întunecată',
    langPickTitle: 'Limba în care îți vorbește Kelion',
    manualLabel: 'Manual',
    cvTitle: 'Adaptare CV',
    cvBaseTitle: '1. CV-ul tău de bază',
    cvBaseHint: 'Scrie-l aici sau încarcă un fișier TXT, Markdown, CSV, PDF ori DOCX. Se salvează pentru data viitoare.',
    cvUpload: 'Încarcă CV (TXT / PDF / DOCX)',
    cvUploadBusy: 'Se citește fișierul...',
    cvBasePlaceholder: 'Scrie sau încarcă CV-ul tău de bază aici...',
    cvSave: 'Salvează CV-ul de bază',
    cvSaveBusy: 'Se salvează...',
    cvSaved: 'CV-ul de bază a fost salvat.',
    cvJobTitle: '2. Jobul (îl cauți tu)',
    cvYourName: 'Numele tău (pentru fișier):',
    cvNamePlaceholder: 'ex: Adrian Popescu',
    cvJobSpec: 'Specificația jobului (lipește tot anunțul):',
    cvJobSpecPlaceholder: 'Lipește aici titlul + toată descrierea/cerințele jobului găsit de tine...',
    cvAdaptBtn: 'Adaptează & Previzualizează',
    cvAdaptBusy: 'Se adaptează CV-ul...',
    cvResultTitle: '3. CV adaptat',
    cvResultPlaceholder: 'CV-ul adaptat pe cerințele jobului apare aici. Îl previzualizezi, apoi îl descarci.',
    cvDownload: '\u2b07 Descarcă',
    cvCopy: 'Copiază',
    cvCopied: 'CV-ul adaptat a fost copiat.',
    cvDone: 'Gata — previzualizează și descarcă.',
    cvErrLoad: 'Nu s-a putut încărca CV-ul salvat.',
    cvErrSave: 'Nu s-a putut salva CV-ul.',
    cvErrRead: 'Nu s-a putut citi fișierul.',
    cvErrNet: 'A apărut o eroare de rețea.',
    cvErrNeedCv: 'Scrie sau încarcă întâi CV-ul de bază.',
    cvErrNeedSpec: 'Lipește specificația (anunțul) jobului.',
    themeToLight: 'Comută pe tema luminoasă',
    wsClose: 'Închide',
    wsCloseAll: 'Închide tot',
    wsCopy: 'Copiază',
    wsZoomFit: 'Potrivește textul (zoom)',
    wsZoomOut: 'Micșorează',
    wsZoomIn: 'Mărește',
    wsSaveHtml: 'Salvează în memoria lui Kelion + descarcă (.html)',
    wsSaveTxt: 'Salvează în memoria lui Kelion + descarcă (.txt)',
    buildLoading: 'Se încarcă…',
    buildEmpty: 'Niciun ordin în lucru acum. Când Kelion preia o cerință, apare aici pas cu pas.',
    buildWaiting: 'Așteaptă lucrătorul…',
    buildCiOk: 'Verificat independent de CI (build + teste pe mașină curată)',
    buildCiRunning: 'CI încă rulează pe PR',
    buildThrottled: 'Așteaptă cotă',
    latencyChip: 'trimis → primul cuvânt / răspuns complet',
    workClockTitle: 'Kelion chiar lucrează la sarcină — timp scurs, live',
    heardYouTitle: 'Tu — înspre creier',
    heardBrainTitle: 'Creierul a primit și gândește',
    heardKelionTitle: 'Kelion — dinspre creier',
    micTalk: 'Vorbește (microfon)',
    micStop: 'Oprește microfonul',
    carMode: 'Mod mașină',
    carExit: 'Ieși din modul mașină',
    carHint: 'Vorbește — îți răspund cu voce, ochii pe drum',
    retea4g: 'Pentru experiența completă (voce rapidă, avatar 3D) e nevoie de minim 4G — chatul de bază merge oricum.',
    carVoiceOn: 'Pornește vocea',
    carVoiceOff: 'Oprește vocea',
    carListening: 'Ascult — vorbește liber',
    apelSuna: 'te sună',
    apelAccepta: 'Răspunde',
    apelRefuza: 'Refuză',
    apelSunPe: 'Sun',
    apelConectat: 'Conectat',
    apelNotaFaza2: 'Vorbește — traduc live',
    apelInchide: 'Închide',
    apelAnunt: 'Te sună {name}. Spune „răspunde" sau „refuză".',
    voiceVolume: 'Volumul vocii lui Kelion',
    sendInterrupts: 'Kelion răspunde — trimite acum și mesajul tău înlocuiește răspunsul curent',
    attRemove: 'Scoate atașamentul',
    docAttachFailed: 'Nu am putut citi „{name}” — NU a fost atașat.',
    docTooLarge: '„{name}” e prea mare pentru atașare (limita e cam 18 MB).',
    offlineNoVision: 'Ești offline — nu mă pot uita la imagini acum (creierul offline e doar pe text). Poza n-a plecat nicăieri; încearcă iar când revine conexiunea.',
    docPrompt: 'Am atașat un document — citește-l și spune-mi ce conține.',
    voiceDownTemp:
      'Vocea mea live e momentan indisponibilă — dictarea și scrisul merg, iar eu reîncerc singur vocea completă în curând.',
    voiceInvalidKey:
      'Vocea live este oprită deoarece cheia OpenAI configurată pe server este invalidă. Administratorul trebuie să o corecteze.',
    voiceProviderQuota:
      'Vocea live este oprită deoarece proiectul OpenAI API nu mai are cotă disponibilă. Aceasta este separată de creditul tău Kelion.',
    voiceModelAccess:
      'Vocea live este oprită deoarece proiectul OpenAI API nu are acces la modelul Realtime configurat.',
    voiceNotConfigured:
      'Vocea live este oprită deoarece configurarea OpenAI de pe server lipsește sau este invalidă.',
    voiceIdleTimeout:
      'Vocea live s-a oprit după o perioadă de inactivitate. Apasă microfonul când vrei să vorbești din nou.',
    voiceSessionLimit:
      'Vocea live este deja deschisă în alt tab sau pe alt dispozitiv. Oprește-o acolo, apoi apasă microfonul aici.',
    voiceBillingConflict:
      'Vocea live s-a oprit pentru a evita o debitare duplicată. Administratorul trebuie să verifice înregistrarea înainte de o nouă încercare.',
    voiceBillingUnavailable:
      'Vocea live s-a oprit deoarece utilizarea nu a putut fi înregistrată în siguranță. Administratorul trebuie să verifice stocarea facturării înainte de o nouă încercare.',
    voiceRetryStopped:
      'Vocea live tot nu se poate conecta. Am oprit reluările automate; apasă microfonul pentru o încercare nouă.',
    voiceNeedLogin: 'Vocea live cere să fii logat — conectează-te și pot vorbi din nou.',
    voiceNeedCredit:
      'Creditul s-a terminat, așa că vocea live e pe pauză — scrisul merge în continuare. Reîncarcă și vocea revine.',
    asrLost: 'Nu am reușit să transcriu — te rog spune din nou.',
    stopAck: 'Am oprit.',
    promoTakeSaved: 'Dubla s-a oprit și clipul s-a salvat. Spune „reluăm” pentru încă o dublă cu același scenariu.',
    promoWrongLang:
      'Scenariul salvat era în altă limbă. Spune-mi din nou „fă un clip despre {subject}” și îl refac în limba curentă.',
    promoRetake: 'Reluăm aceeași dublă — apasă butonul roșu care pulsează și alege ecranul.',
    promoRecStopped: 'Am oprit înregistrarea — clipul se salvează în Descărcări.',
    promoRecReady: 'Pregătit de înregistrare. Apasă butonul roșu care pulsează, sus, și alege ecranul.',
    promoVoiceLost: 'O parte din narațiune nu s-a putut sintetiza — clipul poate avea goluri de sunet.',
    recStartTitle: 'Înregistrează un clip promo',
    recStopTitle: 'Oprește înregistrarea',
    back: 'Înapoi',
    wsSave: 'Salvează',
    wsSaved: 'Salvat ✓',
    wsOpenTab: 'Deschide într-un tab nou ↗',
    wsArchiveNote: 'Arhivă ({name}) — conținutul nu se poate previzualiza în pagină. O poți descărca:',
    creditOut: 'Credit epuizat — reîncarcă pentru a continua',
    creditOk: 'Ai credit',
    contactLabel: 'Contact',
    buildQueued: 'În coadă',
    buildRunning: 'Lucrează',
    buildDone: 'Gata',
    buildDoneUnverified: 'Terminat fără dovadă live',
    buildFailed: 'Eșuat',
    buildCancelled: 'Anulat',
    buildOnlyAdmin: 'Doar adminul vede constructorul.',
    sessionExpired: 'Sesiunea a expirat — loghează-te din nou.',
    buildUnavailable: 'Constructor indisponibil momentan.',
    buildNoServer: 'Fără legătură cu serverul.',
    buildHead: 'Constructorul lui Kelion',
    buildAttempt: 'încercarea {n}',
    buildSeePr: 'Vezi PR ↗',
    buildStop: 'Oprește acest ordin',
    buildStopConfirm: 'Oprești ordinul #{n}? Ce a făcut deja rămâne; doar se oprește aici.',
    buildCiFailed: 'CI a picat pe PR',
    checkoutTitle: 'Plată securizată prin Revolut',
    checkoutHint: 'Suma și contul tău sunt deja asociate. Confirmă plata în Revolut; nu este necesar un cod de referință.',
    checkoutOpen: 'Continuă securizat în Revolut ↗',
    checkoutWaiting: 'Creditul se adaugă numai după ce Revolut confirmă plata finalizată.',
    serverDown:
      'Serverul nu răspunde momentan — NU e internetul tău. Verific întruna și reiau singur în clipa în care revine.',
    requestLost: 'Cererea s-a rupt pe drum (netul tău și serverul sunt bune) — mai trimite o dată.',
    title: 'Setări Client',
    close: 'Închide',
    prefs: 'Preferințe limbi & voce',
    langLabel: 'Limba în care îți vorbește Kelion',
    voiceLabel: 'Vocea folosită pentru sinteză',
    voiceDefault: 'Vocea implicită (stabilită de server)',
    voiceNote: 'Această opțiune controlează cum te aude și cum îți răspunde Kelion vocal.',
    wallet: 'Portofel & Credite',
    account: 'Contul tău',
    signedInAs: 'Autentificat ca:',
    loggingOut: 'Deconectare...',
    logout: 'Deconectare',
    deleteAcc: 'Cere ștergerea datelor',
    deleteConfirm: 'Ștergi definitiv și anonimizezi datele contului? Serverul poate cere reautentificare Google recentă și va întoarce o dovadă cu eventualele categorii păstrate legal.',
    deleteAccClosed: `Serviciul de ștergere nu a confirmat cererea. Nu presupunem succesul; pentru ajutor scrie la ${productConfig.supportEmail}.`,
    cancel: 'Anulează',
    deleting: 'Se șterge...',
  },
  es: {
    signIn: 'Iniciar sesión con Google',
    signOut: 'Cerrar sesión',
    chatHint: 'Dile algo a Kelion…',
    chatPlaceholder: 'Escríbele a Kelion',
    send: 'Enviar',
    functionsTitle: 'Funciones',
    attachTitle: 'Adjuntar archivo',
    imagePrompt: '¿Qué ves en esta imagen?',
    greetPrompt: 'Salúdame brevemente, según la hora del día. NO describas ni comentes sobre la cámara o la imagen.',
    scenarioTitle: 'Guion promocional (grabar)',
    scenarioHint: 'Un paso por línea — Kelion los ejecuta mientras graba. Hazlo corto (~15s).',
    scenarioRecord: 'Grabar',
    scenarioStop: 'Detener',
    scenarioRecording: 'Grabando guion…',
    monitorTitle: 'Modo monitor',
    execTitle: 'Ejecución en vivo',
    disconnectCamTitle: 'Desconectar cámara',
    connectCamTitle: 'Conectar cámara',
    cameraConsentPrompt: '¿Activar la cámara para instantáneas solicitadas explícitamente por ti o por Kelion? La visión continua, la ubicación y el almacenamiento facial siguen desactivados hasta que actives cada opción por separado.',
    micBlocked: 'Micrófono bloqueado. Permite el acceso al micrófono en el navegador y vuelve a pulsar.',
    micNoDevice: 'No se encontró ningún micrófono.',
    micUnsupported: 'El reconocimiento de voz no es compatible con este navegador. Usa Chrome.',
    brainNotActive: 'El cerebro aún no está activo (OpenAI no está configurado).',
    brainError: 'Error del cerebro. Inténtalo de nuevo.',
    turnIndeterminate: 'Es posible que esta solicitud ya haya realizado una acción, pero se perdió el resultado final. Comprueba el resultado antes de volver a intentarlo.',
    offline: 'He perdido la conexión a internet — vuelvo en cuanto regrese la señal.',
    paywallRow: 'Has alcanzado el límite del plan gratuito — mira las opciones para continuar.',
    rateLimited: 'Demasiadas solicitudes en poco tiempo — espera un momento e inténtalo de nuevo.',
    turnEmpty: 'Esta vez me quedé sin respuesta — pregúntame de nuevo, por favor.',
    offlineCompanion: 'Sin conexión — modo compañía. Estoy contigo; Kelion completo vuelve cuando haya señal.',
    offlineFaraWebgpu: 'Estoy en modo compañía, pero este dispositivo no tiene WebGPU — no puedo ejecutar el cerebro local sin conexión aquí.',
    offlineModelNepregatit: 'Estoy sin conexión. El cerebro local aún no está descargado — prepáralo mientras tengas señal y funcionaré también sin conexión.',
    offlineEroareLocal: 'El cerebro local tuvo un problema:',
    raspunsAmanat: 'Ahora puedo darte la respuesta a lo que me preguntaste mientras estabas sin conexión',
    updateNouAnunt: 'Nueva versión lista — toca para aplicarla',
    credits: 'créditos',
    topUp: 'Por favor recarga tu crédito',
    lowCredit: 'Te queda poco crédito — recarga, por favor.',
    landingHeadline: 'Tu asistente brillante. Ve, oye y habla.',
    landingSub:
      'Habla con Kelion en tu idioma — pregunta, muestra, navega, crea. Inicia sesión con Google y añade crédito para empezar.',
    manualTitle: 'Todo lo que Kelion sabe hacer',
    multilingual: 'Soporte multinacional — entiende y responde en decenas de idiomas, escrito y hablado.',
    features: [
      'Conversación natural con una mente realmente brillante',
      'Habla y escucha — totalmente manos libres',
      'Ve a través de tu cámara',
      'Email, Calendario, Tareas, Drive y Contactos',
      'Búsqueda web en vivo e información actualizada',
      'Mapas, rutas y navegación en tiempo real',
      'El tiempo en cualquier lugar del mundo',
      'Encuentra y reproduce YouTube y música',
      'Crea imágenes, logotipos y diseños',
      'Traduce y escribe en cualquier idioma o tono',
      'Un equipo de siete agentes especialistas para ti',
      'Escribe software real y lo prueba en un sandbox en vivo',
    ],
    cookieNote: 'Usamos cookies y analítica básica para el funcionamiento del sitio.',
    privacyLabel: 'Privacidad',
    termsLabel: 'Términos',
    errClosed: 'Kelionai es privado por ahora. Esta cuenta aún no tiene acceso.',
    errBadState: 'Error de inicio de sesión (verificación de seguridad). Inténtalo de nuevo.',
    errTokenExchange: 'No se pudo completar el inicio de sesión con Google. Inténtalo de nuevo.',
    errNoIdToken: 'Google no devolvió una identidad. Inténtalo de nuevo.',
    errNoEmail: 'No se pudo leer un email verificado de Google.',
    errGeneric: 'Error al iniciar sesión. Inténtalo de nuevo.',
    wsFileFailed: 'No se pudo cargar aquí el contenido del archivo.',
    wsOpenFile: 'Abrir el archivo ↗',
    wsPageBlocked: 'Esta página no se puede mostrar aquí.',
    wsDownloadArchive: 'Descargar el archivo ↓',
    wsMediaFailed: 'Este archivo multimedia no se puede reproducir en el navegador (formato o códec no compatible).',
    wsFileNoPreview: 'Este tipo de archivo no se puede previsualizar en la página — puedes descargarlo.',
    wsDownloadFile: 'Descargar el archivo ↓',
    themeToDark: 'Cambiar al tema oscuro',
    themeToLight: 'Cambiar al tema claro',
    wsClose: 'Cerrar',
    wsCloseAll: 'Cerrar todo',
    wsCopy: 'Copiar',
    wsZoomFit: 'Ajustar el texto (zoom)',
    wsZoomOut: 'Alejar',
    wsZoomIn: 'Acercar',
    wsSaveHtml: 'Guardar en la memoria de Kelion + descargar (.html)',
    wsSaveTxt: 'Guardar en la memoria de Kelion + descargar (.txt)',
    buildLoading: 'Cargando…',
    buildEmpty: 'Nada en curso. Cuando Kelion acepte una petición, aparecerá aquí paso a paso.',
    buildWaiting: 'Esperando al trabajador…',
    buildCiOk: 'Verificado de forma independiente por CI (compilación + pruebas en una máquina limpia)',
    buildCiRunning: 'CI todavía se está ejecutando en el pull request',
    buildThrottled: 'Esperando cuota',
    latencyChip: 'enviado → primera palabra / respuesta completa',
    workClockTitle: 'Kelion realmente está trabajando en la tarea — tiempo transcurrido en vivo',
    heardYouTitle: 'Tú — camino al cerebro',
    heardBrainTitle: 'El cerebro lo recibió y está pensando',
    heardKelionTitle: 'Kelion — desde el cerebro',
    micTalk: 'Hablar (micrófono)',
    micStop: 'Detener el micrófono',
    carMode: 'Modo coche',
    carExit: 'Salir del modo coche',
    carHint: 'Habla — te respondo en voz alta, ojos en la carretera',
    retea4g: 'Para la experiencia completa (voz rápida, avatar 3D) necesitas al menos 4G — el chat básico funciona igual.',
    carVoiceOn: 'Activar voz',
    carVoiceOff: 'Detener voz',
    carListening: 'Te escucho — habla libremente',
    apelSuna: 'te está llamando',
    apelAccepta: 'Responder',
    apelRefuza: 'Rechazar',
    apelSunPe: 'Llamando',
    apelConectat: 'Conectado',
    apelNotaFaza2: 'Habla — traduzco en directo',
    apelInchide: 'Colgar',
    apelAnunt: 'Te llama {name}. Di responder o rechazar.',
    voiceVolume: 'Volumen de la voz de Kelion',
    sendInterrupts: 'Kelion está respondiendo — envía ahora y tu mensaje reemplazará la respuesta actual',
    attRemove: 'Quitar archivo adjunto',
    docAttachFailed: 'No pude leer “{name}” — NO fue adjuntado.',
    docTooLarge: '“{name}” es demasiado grande para adjuntar (el límite es de aprox. 18 MB).',
    docPrompt: 'Adjunté un documento — léelo y dime qué contiene.',
    voiceDownTemp:
      'Mi voz en vivo no está disponible temporalmente — el dictado y la escritura siguen funcionando, y reintentaré la voz completa pronto.',
    voiceInvalidKey:
      'La voz en vivo está desactivada porque la clave de OpenAI configurada en el servidor no es válida. El administrador debe corregirla.',
    voiceProviderQuota:
      'La voz en vivo está desactivada porque el proyecto de la API de OpenAI no tiene cuota disponible. Esto es independiente de tu crédito Kelion.',
    voiceModelAccess:
      'La voz en vivo está desactivada porque el proyecto de la API de OpenAI no tiene acceso al modelo Realtime configurado.',
    voiceNotConfigured:
      'La voz en vivo está desactivada porque falta la configuración de OpenAI del servidor o no es válida.',
    voiceIdleTimeout:
      'La voz en vivo se detuvo tras un periodo de inactividad. Pulsa el micrófono cuando quieras volver a hablar.',
    voiceSessionLimit:
      'La voz en vivo ya está abierta en otra pestaña o dispositivo. Ciérrala allí y luego pulsa el micrófono aquí.',
    voiceBillingConflict:
      'La voz en vivo se detuvo para evitar un cobro duplicado. El administrador debe revisar el registro de cobro antes de volver a intentarlo.',
    voiceBillingUnavailable:
      'La voz en vivo se detuvo porque el uso no pudo registrarse de forma segura. El administrador debe revisar el almacenamiento de facturación antes de volver a intentarlo.',
    voiceRetryStopped:
      'La voz en vivo sigue sin poder conectarse. Se detuvieron los reintentos automáticos; pulsa el micrófono para iniciar un nuevo intento.',
    voiceNeedLogin: 'La voz en vivo requiere que inicies sesión — inicia sesión y podré hablar de nuevo.',
    voiceNeedCredit:
      'Tu crédito se ha agotado, por lo que la voz en vivo está pausada — la escritura sigue funcionando. Recarga y la voz volverá.',
    asrLost: 'No pude transcribir eso — por favor dillo de nuevo.',
    stopAck: 'Detenido.',
    promoTakeSaved: 'Toma detenida y clip guardado. Di “repetir” para volver a hacer la misma toma.',
    promoWrongLang:
      'El guion guardado estaba en otro idioma. Di “haz un clip sobre {subject}” de nuevo y lo rehaceré en tu idioma.',
    promoRetake: 'Misma toma de nuevo — pulsa el botón rojo parpadeante y elige la pantalla.',
    promoRecStopped: 'Grabación detenida — el clip se está guardando en Descargas.',
    promoRecReady: 'Listo para grabar. Pulsa el botón rojo parpadeante arriba y elige la pantalla.',
    promoVoiceLost: 'Parte de la narración no se pudo sintetizar — el clip puede tener silencios.',
    recStartTitle: 'Grabar un clip promocional',
    recStopTitle: 'Detener grabación',
    back: 'Volver',
    wsSave: 'Guardar',
    wsSaved: 'Guardado ✓',
    wsOpenTab: 'Abrir en una nueva pestaña ↗',
    wsArchiveNote: 'Archivo ({name}) — su contenido no se puede previsualizar en la página. Puedes descargarlo:',
    creditOut: 'Crédito agotado — recarga para continuar',
    creditOk: 'Tienes crédito',
    contactLabel: 'Contacto',
    buildQueued: 'En cola',
    buildRunning: 'Trabajando',
    buildDone: 'Listo',
    buildDoneUnverified: 'Terminado sin prueba en vivo',
    buildFailed: 'Fallido',
    buildCancelled: 'Cancelado',
    buildOnlyAdmin: 'Solo el administrador puede ver el constructor.',
    sessionExpired: 'Tu sesión expiró — inicia sesión de nuevo.',
    buildUnavailable: 'El constructor no está disponible en este momento.',
    buildNoServer: 'Sin conexión con el servidor.',
    buildHead: 'El constructor de Kelion',
    buildAttempt: 'intento {n}',
    buildSeePr: 'Ver el PR ↗',
    buildCiFailed: 'La CI falló en el PR',
    checkoutTitle: 'Pago seguro con Revolut',
    checkoutHint: 'El importe y tu cuenta ya están vinculados. Confirma el pago en Revolut; no necesitas un código de referencia.',
    checkoutOpen: 'Continuar de forma segura a Revolut ↗',
    checkoutWaiting: 'El crédito se añade solo cuando Revolut confirma el pago completado.',
    serverDown:
      'El servidor no responde ahora mismo — NO es tu internet. Sigo comprobando y reanudaré todo en cuanto vuelva.',
    requestLost: 'La solicitud se interrumpió en el camino (tu internet y el servidor están bien) — por favor envíala de nuevo.',
  },
  fr: {
    signIn: 'Se connecter avec Google',
    signOut: 'Se déconnecter',
    chatHint: 'Dites quelque chose à Kelion…',
    chatPlaceholder: 'Écrivez à Kelion',
    send: 'Envoyer',
    functionsTitle: 'Fonctions',
    attachTitle: 'Joindre un fichier',
    imagePrompt: 'Que voyez-vous sur cette image ?',
    greetPrompt: 'Saluez-moi brièvement, selon l’heure de la journée. NE décrivez PAS et NE commentez PAS la caméra ou l’image.',
    scenarioTitle: 'Scénario promo (enregistrer)',
    scenarioHint: 'Une étape par ligne — Kelion les exécute pendant l’enregistrement. Restez bref (~15s).',
    scenarioRecord: 'Enregistrer',
    scenarioStop: 'Arrêter',
    scenarioRecording: 'Enregistrement du scénario…',
    monitorTitle: 'Mode moniteur',
    execTitle: 'Exécution en direct',
    disconnectCamTitle: 'Déconnecter la caméra',
    connectCamTitle: 'Connecter la caméra',
    cameraConsentPrompt: 'Activer la caméra pour les instantanés explicitement demandés par vous ou Kelion ? La vision continue, la localisation et le stockage facial restent désactivés jusqu’à leur activation séparée.',
    micBlocked: 'Micro bloqué. Autorisez l’accès au micro dans le navigateur, puis réessayez.',
    micNoDevice: 'Aucun microphone trouvé.',
    micUnsupported: 'La reconnaissance vocale n’est pas prise en charge par ce navigateur. Utilisez Chrome.',
    brainNotActive: 'Le cerveau n’est pas encore actif (OpenAI n’est pas configuré).',
    brainError: 'Erreur du cerveau. Veuillez réessayer.',
    turnIndeterminate: 'Cette demande a peut-être déjà effectué une action, mais son résultat final a été perdu. Vérifiez le résultat avant de réessayer.',
    offline: 'J’ai perdu la connexion internet — je reviens dès que le signal revient.',
    paywallRow: 'Tu as atteint la limite du plan gratuit — regarde les options pour continuer.',
    rateLimited: 'Trop de requêtes en peu de temps — attends un instant et réessaie.',
    turnEmpty: 'Je suis resté sans réponse cette fois — repose-moi la question.',
    offlineCompanion: 'Hors ligne — mode compagnon. Je suis avec toi ; le Kelion complet revient dès qu’il y a du signal.',
    offlineFaraWebgpu: 'Je suis en mode compagnon, mais cet appareil n’a pas de WebGPU — je ne peux pas faire tourner le cerveau local hors ligne ici.',
    offlineModelNepregatit: 'Je suis hors ligne. Le cerveau local n’est pas encore téléchargé — prépare-le tant que tu as du signal et je fonctionnerai aussi sans connexion.',
    offlineEroareLocal: 'Le cerveau local a rencontré un problème :',
    raspunsAmanat: 'Je peux maintenant te donner la réponse à ce que tu m’as demandé hors ligne',
    updateNouAnunt: 'Nouvelle version prête — touchez pour l’appliquer',
    credits: 'crédits',
    topUp: 'Veuillez recharger votre crédit',
    lowCredit: 'Votre crédit est presque épuisé — veuillez recharger.',
    landingHeadline: 'Votre assistant brillant. Il voit, entend et parle.',
    landingSub:
      'Parlez à Kelion dans votre langue — demandez, montrez, naviguez, créez. Connectez-vous avec Google et ajoutez du crédit pour commencer.',
    manualTitle: 'Tout ce que Kelion sait faire',
    multilingual: 'Support multinational — comprend et répond dans des dizaines de langues, à l’écrit comme à l’oral.',
    features: [
      'Conversation naturelle avec un esprit vraiment brillant',
      'Parle et écoute — entièrement mains libres',
      'Voit à travers votre caméra',
      'Email, Agenda, Tâches, Drive et Contacts',
      'Recherche web en direct et informations à jour',
      'Cartes, itinéraires et navigation en temps réel',
      'La météo partout dans le monde',
      'Trouve et lance YouTube et de la musique',
      'Crée des images, des logos et des designs',
      'Traduit et écrit dans toutes les langues et tous les tons',
      'Une équipe de sept agents spécialistes à votre service',
      'Écrit de vrais logiciels et les teste dans un sandbox en direct',
    ],
    cookieNote: 'Nous utilisons des cookies et des statistiques de base pour le fonctionnement du site.',
    privacyLabel: 'Confidentialité',
    termsLabel: 'Conditions',
    errClosed: 'Kelionai est privé pour le moment. Ce compte n’a pas encore accès.',
    errBadState: 'Échec de la connexion (contrôle de sécurité). Veuillez réessayer.',
    errTokenExchange: 'Impossible de finaliser la connexion Google. Veuillez réessayer.',
    errNoIdToken: 'Google n’a pas renvoyé d’identité. Veuillez réessayer.',
    errNoEmail: 'Impossible de lire un email vérifié depuis Google.',
    errGeneric: 'Erreur de connexion. Veuillez réessayer.',
    wsFileFailed: 'Impossible de charger le contenu du fichier ici.',
    wsOpenFile: 'Ouvrir le fichier ↗',
    wsPageBlocked: 'Cette page ne peut pas être affichée ici.',
    wsDownloadArchive: 'Télécharger l’archive ↓',
    wsMediaFailed: 'Ce fichier multimédia ne peut pas être lu dans le navigateur (format ou codec non pris en charge).',
    wsFileNoPreview: 'Ce type de fichier ne peut pas être prévisualisé dans la page — vous pouvez le télécharger.',
    wsDownloadFile: 'Télécharger le fichier ↓',
    themeToDark: 'Passer au thème sombre',
    themeToLight: 'Passer au thème clair',
    wsClose: 'Fermer',
    wsCloseAll: 'Tout fermer',
    wsCopy: 'Copier',
    wsZoomFit: 'Ajuster le texte (zoom)',
    wsZoomOut: 'Dézoomer',
    wsZoomIn: 'Zoomer',
    wsSaveHtml: 'Enregistrer dans la mémoire de Kelion + télécharger (.html)',
    wsSaveTxt: 'Enregistrer dans la mémoire de Kelion + télécharger (.txt)',
    buildLoading: 'Chargement…',
    buildEmpty: 'Rien en cours. Dès que Kelion prend une demande, elle s’affiche ici étape par étape.',
    buildWaiting: 'En attente du travailleur…',
    buildCiOk: 'Vérifié indépendamment par la CI (build + tests sur une machine propre)',
    buildCiRunning: 'La CI tourne encore sur la pull request',
    buildThrottled: 'En attente de quota',
    latencyChip: 'envoyé → premier mot / réponse complète',
    workClockTitle: 'Kelion travaille vraiment sur la tâche — temps écoulé en direct',
    heardYouTitle: 'Vous — en route vers le cerveau',
    heardBrainTitle: 'Le cerveau a reçu et réfléchit',
    heardKelionTitle: 'Kelion — depuis le cerveau',
    micTalk: 'Parler (microphone)',
    micStop: 'Arrêter le microphone',
    carMode: 'Mode voiture',
    carExit: 'Quitter le mode voiture',
    carHint: 'Parle — je réponds à voix haute, les yeux sur la route',
    retea4g: 'Pour une expérience complète (voix rapide, avatar 3D), il faut au moins la 4G — le chat de base fonctionne quand même.',
    carVoiceOn: 'Activer la voix',
    carVoiceOff: 'Couper la voix',
    carListening: 'J’écoute — parle librement',
    apelSuna: 't’appelle',
    apelAccepta: 'Répondre',
    apelRefuza: 'Refuser',
    apelSunPe: 'Appel',
    apelConectat: 'Connecté',
    apelNotaFaza2: 'Parle — je traduis en direct',
    apelInchide: 'Raccrocher',
    apelAnunt: '{name} t’appelle. Dis répondre ou refuser.',
    voiceVolume: 'Volume de la voix de Kelion',
    sendInterrupts: 'Kelion répond — envoyez maintenant et votre message remplacera la réponse actuelle',
    attRemove: 'Supprimer la pièce jointe',
    docAttachFailed: 'Impossible de lire « {name} » — il n’a PAS été joint.',
    docTooLarge: '« {name} » est trop grand pour être joint (la limite est d’environ 18 Mo).',
    docPrompt: 'J’ai joint un document — lis-le et dis-moi ce qu’il contient.',
    voiceDownTemp:
      'Ma voix en direct est temporairement indisponible — la dictée et l’écriture fonctionnent toujours, et je réessaierai bientôt la voix complète.',
    voiceInvalidKey:
      'La voix en direct est désactivée car la clé OpenAI configurée sur le serveur est invalide. L’administrateur doit la corriger.',
    voiceProviderQuota:
      'La voix en direct est désactivée car le projet API OpenAI n’a plus de quota disponible. Cela est distinct de votre crédit Kelion.',
    voiceModelAccess:
      'La voix en direct est désactivée car le projet API OpenAI n’a pas accès au modèle Realtime configuré.',
    voiceNotConfigured:
      'La voix en direct est désactivée car la configuration OpenAI du serveur est absente ou invalide.',
    voiceIdleTimeout:
      'La voix en direct s’est arrêtée après une période d’inactivité. Appuyez sur le microphone pour reparler.',
    voiceSessionLimit:
      'La voix en direct est déjà ouverte dans un autre onglet ou appareil. Fermez-la là-bas, puis appuyez sur le microphone ici.',
    voiceBillingConflict:
      'La voix en direct s’est arrêtée pour éviter une facturation en double. L’administrateur doit vérifier l’enregistrement avant de réessayer.',
    voiceBillingUnavailable:
      'La voix en direct s’est arrêtée car l’utilisation n’a pas pu être enregistrée en toute sécurité. L’administrateur doit vérifier le stockage de facturation avant de réessayer.',
    voiceRetryStopped:
      'La voix en direct ne peut toujours pas se connecter. Les tentatives automatiques sont arrêtées ; appuyez sur le microphone pour réessayer.',
    voiceNeedLogin: 'La voix en direct nécessite que vous soyez connecté — connectez-vous et je pourrai reparler.',
    voiceNeedCredit:
      'Votre crédit est épuisé, la voix en direct est donc en pause — l’écriture fonctionne toujours. Rechargez y la voix reviendra.',
    asrLost: 'Je n’ai pas pu transcrire cela — veuillez le redire.',
    stopAck: 'Arrêté.',
    promoTakeSaved: 'Prise arrêtée et clip enregistré. Dites « refaire » pour refaire la même prise.',
    promoWrongLang:
      'Le scénario enregistré était dans une autre langue. Redites « fais un clip sur {subject} » et je le referai dans votre langue.',
    promoRetake: 'Même prise à nouveau — appuyez sur le bouton rouge clignotant et choisissez l’écran.',
    promoRecStopped: 'Enregistrement arrêté — le clip s’enregistre dans Téléchargements.',
    promoRecReady: 'Prêt à enregistrer. Appuyez sur le bouton rouge clignotant en haut et choisissez l’écran.',
    promoVoiceLost: 'Une partie de la narration n’a pas pu être synthétisée — le clip peut contenir des silences.',
    recStartTitle: 'Enregistrer un clip promo',
    recStopTitle: 'Arrêter l’enregistrement',
    back: 'Retour',
    wsSave: 'Enregistrer',
    wsSaved: 'Enregistré ✓',
    wsOpenTab: 'Ouvrir dans un nouvel onglet ↗',
    wsArchiveNote: 'Archive ({name}) — son contenu ne peut pas être prévisualisé dans la page. Vous pouvez la télécharger :',
    creditOut: 'Crédit épuisé — rechargez pour continuer',
    creditOk: 'Vous avez du crédit',
    contactLabel: 'Contact',
    buildQueued: 'En attente',
    buildRunning: 'En cours',
    buildDone: 'Terminé',
    buildDoneUnverified: 'Terminé sans preuve en ligne',
    buildFailed: 'Échoué',
    buildCancelled: 'Annulé',
    buildOnlyAdmin: 'Seul l’administrateur peut voir le constructeur.',
    sessionExpired: 'Votre session a expiré — reconnectez-vous.',
    buildUnavailable: 'Le constructeur est indisponible pour le moment.',
    buildNoServer: 'Pas de connexion au serveur.',
    buildHead: 'Le constructeur de Kelion',
    buildAttempt: 'tentative {n}',
    buildSeePr: 'Voir le PR ↗',
    buildCiFailed: 'La CI a échoué sur le PR',
    checkoutTitle: 'Paiement sécurisé avec Revolut',
    checkoutHint: 'Le montant et votre compte sont déjà associés. Confirmez le paiement dans Revolut ; aucun code de référence n’est requis.',
    checkoutOpen: 'Continuer en toute sécurité vers Revolut ↗',
    checkoutWaiting: 'Le crédit est ajouté uniquement lorsque Revolut confirme le paiement terminé.',
    serverDown:
      'Le serveur ne répond pas pour le moment — ce n’est PAS votre internet. Je continue de vérifier et reprendrai tout dès son retour.',
    requestLost: 'La requête a été interrompue en chemin (votre internet et le serveur vont bien) — veuillez l’renvoyer.',
  },
  de: {
    signIn: 'Mit Google anmelden',
    signOut: 'Abmelden',
    chatHint: 'Sag Kelion etwas…',
    chatPlaceholder: 'Schreib an Kelion',
    send: 'Senden',
    functionsTitle: 'Funktionen',
    attachTitle: 'Datei anhängen',
    imagePrompt: 'Was siehst du auf diesem Bild?',
    greetPrompt: 'Begrüße mich kurz, passend zur Tageszeit. Beschreibe oder kommentiere die Kamera oder das Bild NICHT.',
    scenarioTitle: 'Promo-Szenario (aufnehmen)',
    scenarioHint: 'Ein Schritt pro Zeile — Kelion führt sie während der Aufnahme aus. Kurz halten (~15s).',
    scenarioRecord: 'Aufnehmen',
    scenarioStop: 'Stopp',
    scenarioRecording: 'Szenario wird aufgenommen…',
    monitorTitle: 'Monitor-Modus',
    execTitle: 'Live-Ausführung',
    disconnectCamTitle: 'Kamera trennen',
    connectCamTitle: 'Kamera verbinden',
    cameraConsentPrompt: 'Kamera für ausdrücklich von Ihnen oder Kelion angeforderte Einzelbilder einschalten? Kontinuierliche Sicht, Standort und Gesichtsspeicherung bleiben aus, bis Sie sie getrennt aktivieren.',
    micBlocked: 'Mikrofon blockiert. Erlaube den Mikrofonzugriff im Browser und tippe erneut.',
    micNoDevice: 'Kein Mikrofon gefunden.',
    micUnsupported: 'Spracherkennung wird in diesem Browser nicht unterstützt. Nutze Chrome.',
    brainNotActive: 'Das Gehirn ist noch nicht aktiv (OpenAI ist nicht konfiguriert).',
    brainError: 'Gehirn-Fehler. Bitte versuche es erneut.',
    turnIndeterminate: 'Diese Anfrage hat möglicherweise bereits eine Aktion ausgeführt, aber das Endergebnis ging verloren. Prüfe das Ergebnis, bevor du es erneut versuchst.',
    offline: 'Ich habe die Internetverbindung verloren — ich bin zurück, sobald das Signal wieder da ist.',
    paywallRow: 'Du hast das Limit des Gratisplans erreicht — sieh dir die Optionen an, um weiterzumachen.',
    rateLimited: 'Zu viele Anfragen in kurzer Zeit — warte kurz und versuch es erneut.',
    turnEmpty: 'Diesmal bin ich ohne Antwort geblieben — frag mich bitte noch einmal.',
    offlineCompanion: 'Offline — Begleitmodus. Ich bin bei dir; das volle Kelion kehrt zurück, sobald du Signal hast.',
    offlineFaraWebgpu: 'Ich bin im Begleitmodus, aber dieses Gerät hat kein WebGPU — ich kann das lokale Gehirn hier offline nicht ausführen.',
    offlineModelNepregatit: 'Ich bin offline. Das lokale Gehirn ist noch nicht heruntergeladen — bereite es vor, solange du Signal hast, dann funktioniere ich auch ohne Verbindung.',
    offlineEroareLocal: 'Das lokale Gehirn hatte ein Problem:',
    raspunsAmanat: 'Ich kann dir jetzt die Antwort auf deine Frage von unterwegs (offline) geben',
    updateNouAnunt: 'Neue Version bereit — zum Anwenden tippen',
    credits: 'Guthaben',
    topUp: 'Bitte lade dein Guthaben auf',
    lowCredit: 'Dein Guthaben wird knapp — bitte aufladen.',
    landingHeadline: 'Dein brillanter Assistent. Er sieht, hört und spricht.',
    landingSub:
      'Sprich mit Kelion in deiner Sprache — frag, zeig, navigiere, erschaffe. Melde dich mit Google an und lade Guthaben auf, um zu starten.',
    manualTitle: 'Alles, was Kelion kann',
    multilingual: 'Multinationale Unterstützung — versteht und antwortet in Dutzenden Sprachen, schriftlich und gesprochen.',
    features: [
      'Natürliche Gespräche mit einem wirklich brillanten Verstand',
      'Spricht und hört zu — komplett freihändig',
      'Sieht durch deine Kamera',
      'E-Mail, Kalender, Aufgaben, Drive und Kontakte',
      'Live-Websuche und aktuelle Fakten',
      'Karten, Routen und Echtzeit-Navigation',
      'Wetter überall auf der Welt',
      'Findet und spielt YouTube und Musik',
      'Erstellt Bilder, Logos und Designs',
      'Übersetzt und schreibt in jeder Sprache und jedem Ton',
      'Ein Team aus sieben Spezialagenten für dich',
      'Schreibt echte Software und testet sie in einer Live-Sandbox',
    ],
    cookieNote: 'Wir verwenden Cookies und einfache Statistiken für den Betrieb der Website.',
    privacyLabel: 'Datenschutz',
    termsLabel: 'AGB',
    errClosed: 'Kelionai ist derzeit privat. Dieses Konto hat noch keinen Zugang.',
    errBadState: 'Anmeldung fehlgeschlagen (Sicherheitsprüfung). Bitte erneut versuchen.',
    errTokenExchange: 'Google-Anmeldung konnte nicht abgeschlossen werden. Bitte erneut versuchen.',
    errNoIdToken: 'Google hat keine Identität zurückgegeben. Bitte erneut versuchen.',
    errNoEmail: 'Es konnte keine verifizierte E-Mail von Google gelesen werden.',
    errGeneric: 'Anmeldefehler. Bitte erneut versuchen.',
    wsFileFailed: 'Der Inhalt der Datei konnte hier nicht geladen werden.',
    wsOpenFile: 'Datei öffnen ↗',
    wsPageBlocked: 'Diese Seite kann hier nicht angezeigt werden.',
    wsDownloadArchive: 'Archiv herunterladen ↓',
    wsMediaFailed: 'Diese Mediendatei kann im Browser nicht abgespielt werden (Format oder Codec nicht unterstützt).',
    wsFileNoPreview: 'Dieser Dateityp lässt sich auf der Seite nicht anzeigen — du kannst ihn herunterladen.',
    wsDownloadFile: 'Datei herunterladen ↓',
    themeToDark: 'Zum dunklen Design wechseln',
    themeToLight: 'Zum hellen Design wechseln',
    wsClose: 'Schließen',
    wsCloseAll: 'Alles schließen',
    wsCopy: 'Kopieren',
    wsZoomFit: 'Text einpassen (Zoom)',
    wsZoomOut: 'Verkleinern',
    wsZoomIn: 'Vergrößern',
    wsSaveHtml: 'In Kelions Gedächtnis speichern + herunterladen (.html)',
    wsSaveTxt: 'In Kelions Gedächtnis speichern + herunterladen (.txt)',
    buildLoading: 'Wird geladen…',
    buildEmpty: 'Nichts in Arbeit. Sobald Kelion einen Auftrag übernimmt, erscheint er hier Schritt für Schritt.',
    buildWaiting: 'Wartet auf den Arbeiter…',
    buildCiOk: 'Unabhängig von der CI geprüft (Build + Tests auf einer sauberen Maschine)',
    buildCiRunning: 'Die CI läuft noch am Pull Request',
    buildThrottled: 'Wartet auf Kontingent',
    latencyChip: 'gesendet → erstes Wort / vollständige Antwort',
    workClockTitle: 'Kelion arbeitet wirklich an der Aufgabe — verstrichene Zeit live',
    heardYouTitle: 'Du — unterwegs zum Gehirn',
    heardBrainTitle: 'Das Gehirn hat es und denkt nach',
    heardKelionTitle: 'Kelion — vom Gehirn',
    micTalk: 'Sprechen (Mikrofon)',
    micStop: 'Mikrofon stoppen',
    carMode: 'Automodus',
    carExit: 'Automodus verlassen',
    carHint: 'Sprich — ich antworte laut, Augen auf die Straße',
    retea4g: 'Für das volle Erlebnis (schnelle Stimme, 3D-Avatar) brauchst du mindestens 4G — der einfache Chat funktioniert trotzdem.',
    carVoiceOn: 'Stimme starten',
    carVoiceOff: 'Stimme stoppen',
    carListening: 'Ich höre zu — sprich frei',
    apelSuna: 'ruft dich an',
    apelAccepta: 'Annehmen',
    apelRefuza: 'Ablehnen',
    apelSunPe: 'Ruft',
    apelConectat: 'Verbunden',
    apelNotaFaza2: 'Sprich — ich übersetze live',
    apelInchide: 'Auflegen',
    apelAnunt: '{name} ruft an. Sag annehmen oder ablehnen.',
    voiceVolume: 'Kelions Sprachlautstärke',
    sendInterrupts: 'Kelion antwortet — jetzt senden und deine Nachricht ersetzt die aktuelle Antwort',
    attRemove: 'Anhang entfernen',
    docAttachFailed: 'Konnte „{name}“ nicht lesen — wurde NICHT angehängt.',
    docTooLarge: '„{name}“ ist zu groß zum Anhängen (das Limit liegt bei etwa 18 MB).',
    docPrompt: 'Ich habe ein Dokument angehängt — lies es und sag mir, was es enthält.',
    voiceDownTemp:
      'Meine Live-Stimme ist vorübergehend nicht verfügbar — Diktat und Schreiben funktionieren weiterhin, und ich versuche es in Kürze selbst erneut.',
    voiceInvalidKey:
      'Die Live-Stimme ist ausgeschaltet, weil der auf dem Server konfigurierte OpenAI-Schlüssel ungültig ist. Der Administrator muss ihn korrigieren.',
    voiceProviderQuota:
      'Die Live-Stimme ist ausgeschaltet, weil das OpenAI-API-Projekt kein verfügbares Kontingent hat. Dies ist vom Kelion-Guthaben getrennt.',
    voiceModelAccess:
      'Die Live-Stimme ist ausgeschaltet, weil das OpenAI-API-Projekt keinen Zugriff auf das konfigurierte Realtime-Modell hat.',
    voiceNotConfigured:
      'Die Live-Stimme ist ausgeschaltet, weil die OpenAI-Serverkonfiguration fehlt oder ungültig ist.',
    voiceIdleTimeout:
      'Die Live-Stimme wurde nach einer Zeit der Inaktivität beendet. Drücke das Mikrofon, wenn du wieder sprechen möchtest.',
    voiceSessionLimit:
      'Die Live-Stimme ist bereits in einem anderen Tab oder Gerät geöffnet. Beende sie dort und drücke dann hier das Mikrofon.',
    voiceBillingConflict:
      'Die Live-Stimme wurde beendet, um eine doppelte Abbuchung zu verhindern. Der Administrator muss den Eintrag vor einem neuen Versuch prüfen.',
    voiceBillingUnavailable:
      'Die Live-Stimme wurde beendet, weil die Nutzung nicht sicher erfasst werden konnte. Der Administrator muss den Abrechnungsspeicher vor einem neuen Versuch prüfen.',
    voiceRetryStopped:
      'Die Live-Stimme kann weiterhin keine Verbindung herstellen. Automatische Versuche wurden beendet; drücke das Mikrofon für einen neuen Versuch.',
    voiceNeedLogin: 'Für die Live-Stimme musst du angemeldet sein — melde dich an, damit ich wieder sprechen kann.',
    voiceNeedCredit:
      'Dein Guthaben ist aufgebraucht, daher ist die Live-Stimme pausiert — Schreiben funktioniert weiterhin. Lade auf und die Stimme kehrt zurück.',
    asrLost: 'Ich konnte das nicht transkribieren — bitte sag es noch einmal.',
    stopAck: 'Gestoppt.',
    promoTakeSaved: 'Take gestoppt und Clip gespeichert. Sag „wiederholen“, um denselben Take nochmal zu machen.',
    promoWrongLang:
      'Das gespeicherte Skript war in einer anderen Sprache. Sag noch einmal „mach einen Clip über {subject}“ und ich mache es in deiner Sprache neu.',
    promoRetake: 'Derselbe Take nochmal — drücke den pulsierenden roten Knopf und wähle den Bildschirm.',
    promoRecStopped: 'Aufnahme gestoppt — der Clip wird unter Downloads gespeichert.',
    promoRecReady: 'Bereit zur Aufnahme. Drücke den pulsierenden roten Knopf oben und wähle den Bildschirm.',
    promoVoiceLost: 'Ein Teil der Narration konnte nicht synthetisiert werden — der Clip kann Stille enthalten.',
    recStartTitle: 'Promo-Clip aufnehmen',
    recStopTitle: 'Aufnahme stoppen',
    back: 'Zurück',
    wsSave: 'Speichern',
    wsSaved: 'Gespeichert ✓',
    wsOpenTab: 'In neuem Tab öffnen ↗',
    wsArchiveNote: 'Archiv ({name}) — der Inhalt kann auf der Seite nicht angezeigt werden. Du kannst es herunterladen:',
    creditOut: 'Guthaben aufgebraucht — aufladen zum Fortfahren',
    creditOk: 'Du hast Guthaben',
    contactLabel: 'Kontakt',
    buildQueued: 'In Warteschlange',
    buildRunning: 'Arbeitet',
    buildDone: 'Fertig',
    buildDoneUnverified: 'Beendet ohne Live-Nachweis',
    buildFailed: 'Fehlgeschlagen',
    buildCancelled: 'Abgebrochen',
    buildOnlyAdmin: 'Nur der Admin kann den Builder sehen.',
    sessionExpired: 'Deine Sitzung ist abgelaufen — melde dich neu an.',
    buildUnavailable: 'Der Builder ist derzeit nicht verfügbar.',
    buildNoServer: 'Keine Verbindung zum Server.',
    buildHead: 'Kelions Builder',
    buildAttempt: 'Versuch {n}',
    buildSeePr: 'PR ansehen ↗',
    buildCiFailed: 'CI beim PR fehlgeschlagen',
    checkoutTitle: 'Sicherer Revolut-Checkout',
    checkoutHint: 'Betrag und Konto sind bereits verknüpft. Bestätige die Zahlung in Revolut; ein Referenzcode ist nicht nötig.',
    checkoutOpen: 'Sicher zu Revolut weitergehen ↗',
    checkoutWaiting: 'Guthaben wird erst hinzugefügt, wenn Revolut die abgeschlossene Zahlung bestätigt.',
    serverDown:
      'Der Server antwortet gerade nicht — es liegt NICHT an deinem Internet. Ich prüfe weiter und mache von selbst weiter, sobald er zurück ist.',
    requestLost: 'Die Anfrage wurde unterwegs unterbrochen (dein Internet und der Server sind in Ordnung) — bitte erneut senden.',
  },
  it: {
    signIn: 'Accedi con Google',
    signOut: 'Esci',
    chatHint: 'Di’ qualcosa a Kelion…',
    chatPlaceholder: 'Scrivi a Kelion',
    send: 'Invia',
    functionsTitle: 'Funzioni',
    attachTitle: 'Allega file',
    imagePrompt: 'Cosa vedi in questa immagine?',
    greetPrompt: 'Salutami brevemente, in base all’ora del giorno. NON descrivere né commentare la fotocamera o l’immagine.',
    scenarioTitle: 'Scenario promo (registra)',
    scenarioHint: 'Un passo per riga — Kelion li esegue durante la registrazione. Tienilo breve (~15s).',
    scenarioRecord: 'Registra',
    scenarioStop: 'Ferma',
    scenarioRecording: 'Registrazione dello scenario…',
    monitorTitle: 'Modalità monitor',
    execTitle: 'Esecuzione dal vivo',
    disconnectCamTitle: 'Scollega fotocamera',
    connectCamTitle: 'Collega fotocamera',
    cameraConsentPrompt: 'Attivare la fotocamera per istantanee richieste esplicitamente da te o da Kelion? Visione continua, posizione e archiviazione del volto restano disattivate finché non le abiliti separatamente.',
    micBlocked: 'Microfono bloccato. Consenti l’accesso al microfono nel browser e riprova.',
    micNoDevice: 'Nessun microfono trovato.',
    micUnsupported: 'Il riconoscimento vocale non è supportato in questo browser. Usa Chrome.',
    brainNotActive: 'Il cervello non è ancora attivo (OpenAI non è configurato).',
    brainError: 'Errore del cervello. Riprova.',
    turnIndeterminate: 'Questa richiesta potrebbe aver già eseguito un’azione, ma il risultato finale è andato perso. Controlla il risultato prima di riprovare.',
    offline: 'Ho perso la connessione a internet — torno appena il segnale ritorna.',
    paywallRow: 'Hai raggiunto il limite del piano gratuito — guarda le opzioni per continuare.',
    rateLimited: 'Troppe richieste in poco tempo — aspetta un attimo e riprova.',
    turnEmpty: 'Questa volta sono rimasto senza risposta — chiedimelo di nuovo.',
    offlineCompanion: 'Offline — modalità compagnia. Sono con te; il Kelion completo torna quando c’è segnale.',
    offlineFaraWebgpu: 'Sono in modalità compagnia, ma questo dispositivo non ha WebGPU — non posso eseguire il cervello locale offline qui.',
    offlineModelNepregatit: 'Sono offline. Il cervello locale non è ancora scaricato — preparalo finché hai segnale e funzionerò anche senza connessione.',
    offlineEroareLocal: 'Il cervello locale ha avuto un problema:',
    raspunsAmanat: 'Ora posso darti la risposta a ciò che mi hai chiesto mentre eri offline',
    updateNouAnunt: 'Nuova versione pronta — tocca per applicarla',
    credits: 'crediti',
    topUp: 'Ricarica il tuo credito, per favore',
    lowCredit: 'Il tuo credito sta per finire — ricarica, per favore.',
    landingHeadline: 'Il tuo assistente brillante. Vede, sente e parla.',
    landingSub:
      'Parla con Kelion nella tua lingua — chiedi, mostra, naviga, crea. Accedi con Google e aggiungi credito per iniziare.',
    manualTitle: 'Tutto ciò che Kelion sa fare',
    multilingual: 'Supporto multinazionale — capisce e risponde in decine di lingue, scritte e parlate.',
    features: [
      'Conversazione naturale con una mente davvero brillante',
      'Parla e ascolta — completamente a mani libere',
      'Vede attraverso la tua fotocamera',
      'Email, Calendario, Attività, Drive e Contatti',
      'Ricerca web dal vivo e informazioni aggiornate',
      'Mappe, percorsi e navigazione in tempo reale',
      'Il meteo ovunque nel mondo',
      'Trova e riproduce YouTube e musica',
      'Crea immagini, loghi e design',
      'Traduce e scrive in qualsiasi lingua e tono',
      'Una squadra di sette agenti specialisti al tuo servizio',
      'Scrive software vero e lo testa in una sandbox dal vivo',
    ],
    cookieNote: 'Usiamo cookie e statistiche di base per il funzionamento del sito.',
    privacyLabel: 'Privacy',
    termsLabel: 'Termini',
    errClosed: 'Kelionai è privato al momento. Questo account non ha ancora accesso.',
    errBadState: 'Accesso non riuscito (controllo di sicurezza). Riprova.',
    errTokenExchange: 'Impossibile completare l’accesso con Google. Riprova.',
    errNoIdToken: 'Google non ha restituito un’identità. Riprova.',
    errNoEmail: 'Impossibile leggere un’email verificata da Google.',
    errGeneric: 'Errore di accesso. Riprova.',
    wsFileFailed: 'Non è stato possibile caricare qui il contenuto del file.',
    wsOpenFile: 'Apri il file ↗',
    wsPageBlocked: 'Questa pagina non può essere mostrata qui.',
    wsDownloadArchive: 'Scarica l’archivio ↓',
    wsMediaFailed: 'Questo file multimediale non può essere riprodotto nel browser (formato o codec non supportato).',
    wsFileNoPreview: 'Questo tipo di file non si può visualizzare nella pagina — puoi scaricarlo.',
    wsDownloadFile: 'Scarica il file ↓',
    themeToDark: 'Passa al tema scuro',
    themeToLight: 'Passa al tema chiaro',
    wsClose: 'Chiudi',
    wsCloseAll: 'Chiudi tutto',
    wsCopy: 'Copia',
    wsZoomFit: 'Adatta il testo (zoom)',
    wsZoomOut: 'Riduci',
    wsZoomIn: 'Ingrandisci',
    wsSaveHtml: 'Salva nella memoria di Kelion + scarica (.html)',
    wsSaveTxt: 'Salva nella memoria di Kelion + scarica (.txt)',
    buildLoading: 'Caricamento…',
    buildEmpty: 'Niente in corso. Quando Kelion prende in carico una richiesta, compare qui passo dopo passo.',
    buildWaiting: 'In attesa del lavoratore…',
    buildCiOk: 'Verificato in modo indipendente dalla CI (build + test su una macchina pulita)',
    buildCiRunning: 'La CI è ancora in esecuzione sulla pull request',
    buildThrottled: 'In attesa di quota',
    latencyChip: 'inviato → prima parola / risposta completa',
    workClockTitle: 'Kelion sta davvero lavorando al compito — tempo trascorso dal vivo',
    heardYouTitle: 'Tu — in viaggio verso il cervello',
    heardBrainTitle: 'Il cervello l’ha ricevuto e sta pensando',
    heardKelionTitle: 'Kelion — dal cervello',
    micTalk: 'Parla (microfono)',
    micStop: 'Interrompi il microfono',
    carMode: 'Modalità auto',
    carExit: 'Esci dalla modalità auto',
    carHint: 'Parla — rispondo a voce, occhi sulla strada',
    retea4g: 'Per la piena esperienza (voce veloce, avatar 3D) serve almeno il 4G — la chat di base funziona comunque.',
    carVoiceOn: 'Attiva voce',
    carVoiceOff: 'Ferma voce',
    carListening: 'Ti ascolto — parla liberamente',
    apelSuna: 'ti sta chiamando',
    apelAccepta: 'Rispondi',
    apelRefuza: 'Rifiuta',
    apelSunPe: 'Chiamata',
    apelConectat: 'Connesso',
    apelNotaFaza2: 'Parla — traduco dal vivo',
    apelInchide: 'Riaggancia',
    apelAnunt: 'Ti chiama {name}. Di rispondi o rifiuta.',
    voiceVolume: 'Volume della voce di Kelion',
    sendInterrupts: 'Kelion sta rispondendo — invia ora e il tuo messaggio sostituirà la risposta attuale',
    attRemove: 'Rimuovi allegato',
    docAttachFailed: 'Impossibile leggere “{name}” — NON è stato allegato.',
    docTooLarge: '“{name}” è troppo grande da allegare (il limite è di circa 18 MB).',
    docPrompt: 'Ho allegato un documento — leggilo e dimmi cosa contiene.',
    voiceDownTemp:
      'La mia voce dal vivo è temporaneamente non disponibile — la dettatura e la scrittura funzionano ancora e riproverò presto a ripristinare la voce completa.',
    voiceInvalidKey:
      'La voce dal vivo è disattivata perché la chiave OpenAI configurata sul server non è valida. L’amministratore deve correggerla.',
    voiceProviderQuota:
      'La voce dal vivo è disattivata perché il progetto API OpenAI non ha quota disponibile. Questo è separato dal tuo credito Kelion.',
    voiceModelAccess:
      'La voce dal vivo è disattivata perché il progetto API OpenAI non può accedere al modello Realtime configurato.',
    voiceNotConfigured:
      'La voce dal vivo è disattivata perché la configurazione OpenAI del server manca o non è valida.',
    voiceIdleTimeout:
      'La voce dal vivo si è fermata dopo un periodo di inattività. Premi il microfono quando vuoi parlare di nuovo.',
    voiceSessionLimit:
      'La voce dal vivo è già aperta in un’altra scheda o dispositivo. Chiudila lì, poi premi qui il microfono.',
    voiceBillingConflict:
      'La voce dal vivo si è fermata per evitare un addebito duplicato. L’amministratore deve controllare la registrazione prima di riprovare.',
    voiceBillingUnavailable:
      'La voce dal vivo si è fermata perché non è stato possibile registrare l’utilizzo in modo sicuro. L’amministratore deve controllare l’archivio di fatturazione prima di riprovare.',
    voiceRetryStopped:
      'La voce dal vivo non riesce ancora a connettersi. I tentativi automatici sono stati interrotti; premi il microfono per un nuovo tentativo.',
    voiceNeedLogin: 'La voce dal vivo richiede l’accesso — accedi e potrò parlare di nuovo.',
    voiceNeedCredit:
      'Il tuo credito è esaurito, quindi la voce dal vivo è in pausa — la scrittura funziona ancora. Ricarica e la voce tornerà.',
    asrLost: 'Non sono riuscito a trascrivere — per favore ripetilo.',
    stopAck: 'Fermato.',
    promoTakeSaved: 'Take fermato e clip salvato. Di’ “ripeti” per fare di nuovo lo stesso take.',
    promoWrongLang:
      'Lo script salvato era in un’altra lingua. Di’ di nuovo “fai un clip su {subject}” e lo rifarò nella tua lingua.',
    promoRetake: 'Stesso take di nuovo — premi il pulsante rosso pulsante e scegli lo schermo.',
    promoRecStopped: 'Registrazione fermata — il clip si sta salvando in Download.',
    promoRecReady: 'Pronto per registrare. Premi il pulsante rosso pulsante in alto e scegli lo schermo.',
    promoVoiceLost: 'Parte della narrazione non è stata sintetizzata — il clip potrebbe avere tratti di silenzio.',
    recStartTitle: 'Registra un clip promo',
    recStopTitle: 'Interrompi registrazione',
    back: 'Indietro',
    wsSave: 'Salva',
    wsSaved: 'Salvato ✓',
    wsOpenTab: 'Apri in una nuova scheda ↗',
    wsArchiveNote: 'Archivio ({name}) — il suo contenuto non può essere visualizzato nella pagina. Puoi scaricarlo:',
    creditOut: 'Credito esaurito — ricarica per continuare',
    creditOk: 'Hai credito',
    contactLabel: 'Contatto',
    buildQueued: 'In coda',
    buildRunning: 'In corso',
    buildDone: 'Fatto',
    buildDoneUnverified: 'Terminato senza prova live',
    buildFailed: 'Fallito',
    buildCancelled: 'Annullato',
    buildOnlyAdmin: 'Solo l’amministratore può vedere il builder.',
    sessionExpired: 'La sessione è scaduta — accedi di nuovo.',
    buildUnavailable: 'Il builder non è disponibile al momento.',
    buildNoServer: 'Nessuna connessione al server.',
    buildHead: 'Il builder di Kelion',
    buildAttempt: 'tentativo {n}',
    buildSeePr: 'Vedi la PR ↗',
    buildCiFailed: 'La CI è fallita sulla PR',
    checkoutTitle: 'Pagamento sicuro con Revolut',
    checkoutHint: 'L’importo e il tuo account sono già collegati. Conferma il pagamento in Revolut; non serve un codice di riferimento.',
    checkoutOpen: 'Continua in sicurezza su Revolut ↗',
    checkoutWaiting: 'Il credito viene aggiunto solo dopo che Revolut conferma il pagamento completato.',
    serverDown:
      'Il server non risponde al momento — NON è la tua connessione. Continuo a controllare e riprenderò da solo appena torna.',
    requestLost: 'La richiesta si è interrotta lungo il percorso (la tua connessione e il server stanno bene) — per favore inviala di nuovo.',
  },
  pt: {
    signIn: 'Entrar com Google',
    signOut: 'Sair',
    chatHint: 'Diga algo ao Kelion…',
    chatPlaceholder: 'Escreva ao Kelion',
    send: 'Enviar',
    functionsTitle: 'Funções',
    attachTitle: 'Anexar arquivo',
    imagePrompt: 'O que você vê nesta imagem?',
    greetPrompt: 'Cumprimente-me brevemente, de acordo com a hora do dia. NÃO descreva nem comente sobre a câmera ou a imagem.',
    scenarioTitle: 'Roteiro promo (gravar)',
    scenarioHint: 'Um passo por linha — Kelion os executa durante a gravação. Seja breve (~15s).',
    scenarioRecord: 'Gravar',
    scenarioStop: 'Parar',
    scenarioRecording: 'Gravando roteiro…',
    monitorTitle: 'Modo monitor',
    execTitle: 'Execução ao vivo',
    disconnectCamTitle: 'Desconectar câmera',
    connectCamTitle: 'Conectar câmera',
    cameraConsentPrompt: 'Ativar a câmera para instantâneos solicitados explicitamente por você ou por Kelion? Visão contínua, localização e armazenamento facial permanecem desligados até você ativar cada opção separadamente.',
    micBlocked: 'Microfone bloqueado. Permita o acesso ao microfone no navegador e toque novamente.',
    micNoDevice: 'Nenhum microfone encontrado.',
    micUnsupported: 'O reconhecimento de voz não é suportado neste navegador. Use o Chrome.',
    brainNotActive: 'O cérebro ainda não está ativo (a OpenAI não está configurada).',
    brainError: 'Erro do cérebro. Tente novamente.',
    turnIndeterminate: 'Esta solicitação pode já ter realizado uma ação, mas o resultado final foi perdido. Verifique o resultado antes de tentar novamente.',
    offline: 'Perdi a conexão com a internet — volto assim que o sinal retornar.',
    paywallRow: 'Atingiste o limite do plano gratuito — vê as opções para continuar.',
    rateLimited: 'Demasiados pedidos em pouco tempo — espera um momento e tenta de novo.',
    turnEmpty: 'Desta vez fiquei sem resposta — pergunta-me novamente.',
    offlineCompanion: 'Offline — modo companhia. Estou contigo; o Kelion completo volta quando houver sinal.',
    offlineFaraWebgpu: 'Estou em modo companhia, mas este dispositivo não tem WebGPU — não consigo rodar o cérebro local offline aqui.',
    offlineModelNepregatit: 'Estou offline. O cérebro local ainda não foi baixado — prepare-o enquanto tem sinal e funcionarei mesmo sem conexão.',
    offlineEroareLocal: 'O cérebro local teve um problema:',
    raspunsAmanat: 'Agora posso te dar a resposta ao que me perguntaste enquanto estavas offline',
    updateNouAnunt: 'Nova versão pronta — toque para aplicar',
    credits: 'créditos',
    topUp: 'Por favor, recarregue o seu crédito',
    lowCredit: 'O seu crédito está acabando — recarregue, por favor.',
    landingHeadline: 'O seu assistente brilhante. Ele vê, ouve e fala.',
    landingSub:
      'Fale com o Kelion no seu idioma — pergunte, mostre, navegue, crie. Entre com o Google e adicione crédito para começar.',
    manualTitle: 'Tudo o que o Kelion sabe fazer',
    multilingual: 'Suporte multinacional — entende e responde em dezenas de idiomas, escrito e falado.',
    features: [
      'Conversa natural com uma mente realmente brilhante',
      'Fala e ouve — totalmente mãos livres',
      'Vê através da sua câmera',
      'Email, Agenda, Tarefas, Drive e Contatos',
      'Pesquisa web ao vivo e informações atualizadas',
      'Mapas, rotas e navegação em tempo real',
      'O tempo em qualquer lugar do mundo',
      'Encontra e reproduz YouTube e música',
      'Cria imagens, logotipos e designs',
      'Traduz e escreve em qualquer idioma ou tom',
      'Uma equipe de sete agentes especialistas para você',
      'Escreve software de verdade e o testa em um sandbox ao vivo',
    ],
    cookieNote: 'Usamos cookies e análises básicas para o funcionamento do site.',
    privacyLabel: 'Privacidade',
    termsLabel: 'Termos',
    errClosed: 'O Kelionai é privado no momento. Esta conta ainda não tem acesso.',
    errBadState: 'Falha no login (verificação de segurança). Tente novamente.',
    errTokenExchange: 'Não foi possível concluir o login com o Google. Tente novamente.',
    errNoIdToken: 'O Google não retornou uma identidade. Tente novamente.',
    errNoEmail: 'Não foi possível ler um email verificado do Google.',
    errGeneric: 'Erro ao entrar. Tente novamente.',
    wsFileFailed: 'Não foi possível carregar aqui o conteúdo do arquivo.',
    wsOpenFile: 'Abrir o arquivo ↗',
    wsPageBlocked: 'Esta página não pode ser exibida aqui.',
    wsDownloadArchive: 'Baixar o arquivo ↓',
    wsMediaFailed: 'Este arquivo de mídia não pode ser reproduzido no navegador (formato ou codec não suportado).',
    wsFileNoPreview: 'Este tipo de arquivo não pode ser visualizado na página — você pode baixá-lo.',
    wsDownloadFile: 'Baixar o arquivo ↓',
    themeToDark: 'Mudar para o tema escuro',
    themeToLight: 'Mudar para o tema claro',
    wsClose: 'Fechar',
    wsCloseAll: 'Fechar tudo',
    wsCopy: 'Copiar',
    wsZoomFit: 'Ajustar o texto (zoom)',
    wsZoomOut: 'Diminuir',
    wsZoomIn: 'Aumentar',
    wsSaveHtml: 'Salvar na memória do Kelion + baixar (.html)',
    wsSaveTxt: 'Salvar na memória do Kelion + baixar (.txt)',
    buildLoading: 'Carregando…',
    buildEmpty: 'Nada em andamento. Quando o Kelion assumir um pedido, ele aparece aqui passo a passo.',
    buildWaiting: 'Aguardando o trabalhador…',
    buildCiOk: 'Verificado de forma independente pela CI (build + testes numa máquina limpa)',
    buildCiRunning: 'A CI ainda está a correr no pull request',
    buildThrottled: 'À espera de quota',
    latencyChip: 'enviado → primeira palavra / resposta completa',
    workClockTitle: 'Kelion está realmente trabalhando na tarefa — tempo decorrido ao vivo',
    heardYouTitle: 'Tu — a caminho do cérebro',
    heardBrainTitle: 'O cérebro recebeu e está a pensar',
    heardKelionTitle: 'Kelion — do cérebro',
    micTalk: 'Falar (microfone)',
    micStop: 'Parar o microfone',
    carMode: 'Modo carro',
    carExit: 'Sair do modo carro',
    carHint: 'Fala — respondo em voz alta, olhos na estrada',
    retea4g: 'Para a experiência completa (voz rápida, avatar 3D) precisas de pelo menos 4G — o chat básico funciona na mesma.',
    carVoiceOn: 'Ativar voz',
    carVoiceOff: 'Parar voz',
    carListening: 'A ouvir — fala à vontade',
    apelSuna: 'está a ligar-te',
    apelAccepta: 'Atender',
    apelRefuza: 'Recusar',
    apelSunPe: 'A ligar',
    apelConectat: 'Ligado',
    apelNotaFaza2: 'Fala — traduzo ao vivo',
    apelInchide: 'Desligar',
    apelAnunt: '{name} está a ligar. Diz atender ou recusar.',
    voiceVolume: 'Volume da voz de Kelion',
    sendInterrupts: 'Kelion está respondendo — envie agora e sua mensagem substituirá a resposta atual',
    attRemove: 'Remover anexo',
    docAttachFailed: 'Não foi possível ler “{name}” — NÃO foi anexado.',
    docTooLarge: '“{name}” é grande demais para anexar (o limite é de cerca de 18 MB).',
    docPrompt: 'Anexei um documento — leia-o e me diga o que ele contém.',
    voiceDownTemp:
      'Minha voz ao vivo está temporariamente indisponível — o ditado e a escrita continuam funcionando, e tentarei novamente a voz completa em breve.',
    voiceInvalidKey:
      'A voz ao vivo está desativada porque a chave OpenAI configurada no servidor é inválida. O administrador precisa corrigi-la.',
    voiceProviderQuota:
      'A voz ao vivo está desativada porque o projeto da API OpenAI não tem cota disponível. Isso é separado do seu crédito Kelion.',
    voiceModelAccess:
      'A voz ao vivo está desativada porque o projeto da API OpenAI não tem acesso ao modelo Realtime configurado.',
    voiceNotConfigured:
      'A voz ao vivo está desativada porque a configuração OpenAI do servidor está ausente ou inválida.',
    voiceIdleTimeout:
      'A voz ao vivo parou após um período de inatividade. Pressione o microfone quando quiser falar novamente.',
    voiceSessionLimit:
      'A voz ao vivo já está aberta em outra aba ou dispositivo. Feche-a lá e depois pressione o microfone aqui.',
    voiceBillingConflict:
      'A voz ao vivo parou para evitar uma cobrança duplicada. O administrador deve verificar o registro antes de tentar novamente.',
    voiceBillingUnavailable:
      'A voz ao vivo parou porque não foi possível registrar o uso com segurança. O administrador deve verificar o armazenamento de faturamento antes de tentar novamente.',
    voiceRetryStopped:
      'A voz ao vivo ainda não consegue se conectar. As tentativas automáticas foram interrompidas; pressione o microfone para uma nova tentativa.',
    voiceNeedLogin: 'A voz ao vivo requer que você esteja conectado — entre para que eu possa falar novamente.',
    voiceNeedCredit:
      'Seu crédito acabou, por isso a voz ao vivo está pausada — a escrita continua funcionando. Recarregue e a voz voltará.',
    asrLost: 'Não consegui transcrever isso — por favor diga novamente.',
    stopAck: 'Parado.',
    promoTakeSaved: 'Take parado e clipe salvo. Diga “repetir” para fazer o mesmo take novamente.',
    promoWrongLang:
      'O roteiro salvo estava em outro idioma. Diga “faça um clipe sobre {subject}” novamente e eu o farei no seu idioma.',
    promoRetake: 'Mesmo take novamente — pressione o botão vermelho pulsante e escolha a tela.',
    promoRecStopped: 'Gravação parada — o clipe está sendo salvo em Downloads.',
    promoRecReady: 'Pronto para gravar. Pressione o botão vermelho pulsante no topo e escolha a tela.',
    promoVoiceLost: 'Parte da narração não pôde ser sintetizada — o clipe pode ter lapsos em silêncio.',
    recStartTitle: 'Gravar um clipe promo',
    recStopTitle: 'Parar gravação',
    back: 'Voltar',
    wsSave: 'Salvar',
    wsSaved: 'Salvo ✓',
    wsOpenTab: 'Abrir em uma nova aba ↗',
    wsArchiveNote: 'Arquivo ({name}) — o conteúdo não pode ser visualizado na página. Você pode baixá-lo:',
    creditOut: 'Crédito esgotado — recarregue para continuar',
    creditOk: 'Você tem crédito',
    contactLabel: 'Contato',
    buildQueued: 'Na fila',
    buildRunning: 'Trabalhando',
    buildDone: 'Concluído',
    buildDoneUnverified: 'Concluído sem prova ao vivo',
    buildFailed: 'Falhou',
    buildCancelled: 'Cancelado',
    buildOnlyAdmin: 'Apenas o administrador pode ver o construtor.',
    sessionExpired: 'A sessão expirou — inicie sessão novamente.',
    buildUnavailable: 'O construtor está indisponível no momento.',
    buildNoServer: 'Sem conexão com o servidor.',
    buildHead: 'O construtor do Kelion',
    buildAttempt: 'tentativa {n}',
    buildSeePr: 'Ver o PR ↗',
    buildCiFailed: 'A CI falhou no PR',
    checkoutTitle: 'Pagamento seguro com Revolut',
    checkoutHint: 'O valor e a sua conta já estão associados. Confirme o pagamento no Revolut; não é necessário um código de referência.',
    checkoutOpen: 'Continuar com segurança para o Revolut ↗',
    checkoutWaiting: 'O crédito só é adicionado quando o Revolut confirma o pagamento concluído.',
    serverDown:
      'O servidor não está respondendo no momento — NÃO é a sua internet. Continuo verificando e retomarei sozinho assim que voltar.',
    requestLost: 'A solicitação foi interrompida no caminho (sua internet e o servidor estão bem) — por favor envie novamente.',
  },
}

const SUPPORTED: Lang[] = ['en', 'ro', 'es', 'fr', 'de', 'it', 'pt']

// Resolve any locale string (e.g. "ro-RO", "en-GB") to a supported language.
export function resolveLang(locale: string | undefined | null): Lang {
  const base = (locale ?? 'en').toLowerCase().split('-')[0]
  return (SUPPORTED as string[]).includes(base) ? (base as Lang) : 'en'
}

// Cache: the merged object is computed ONCE per language. `strings()` is called on
// every render of every component — a spread there would do useless work
// dozens of times per second and would break React memoization (a new object every
// time → chained re-renders).
const cache = new Map<Lang, Strings>()

export function strings(lang: Lang): Strings {
  const gata = cache.get(lang)
  if (gata) return gata
  const unit: Strings = lang === 'en' ? dict.en : { ...dict.en, ...(dict[lang] ?? {}) }
  cache.set(lang, unit)
  return unit
}

// THE INTERFACE LANGUAGE, IN ONE PLACE. `resolveLang(loadLocalLang() ?? 'en')`
// was copied in Stage, WalletButton and CustomerSettings — three places to
// change if the rule moves. Here is the rule: the local mirror of the language
// IDENTIFIED by the server; missing → ENGLISH (Adrian: "on logout it shows
// English; on re-login it returns to the detected language").
export function uiStrings(): Strings {
  return strings(resolveLang(loadLocalLang() ?? 'en'))
}
