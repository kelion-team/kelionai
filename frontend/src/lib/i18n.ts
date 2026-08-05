// Minimal i18n. UI strings per language; English is the fallback for any
// language we don't have a translation for. Add a new language by adding a
// block to `dict` — nothing else changes.
import { loadLocalLang } from './prefs'

export type Lang = 'en' | 'ro' | 'es' | 'fr' | 'de' | 'it' | 'pt'

export interface Strings {
  signIn: string
  restricted: string
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
  disconnectCamTitle: string
  connectCamTitle: string
  micBlocked: string
  micNoDevice: string
  micUnsupported: string
  brainNotActive: string
  brainError: string
  offline: string
  credits: string
  topUp: string
  lowCredit: string
  landingHeadline: string
  landingSub: string
  manualTitle: string
  multilingual: string
  features: readonly string[]
  updateReady: string
  updateNow: string
  /** The self-applying countdown in the version bar — `{n}` = seconds left. */
  updateAuto: string
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
  // empty states, the admin unlock panel.
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
  adminLocked: string
  adminLockedHint: string
  adminUnlock: string
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
  // ── THE VOICE, HONEST (audit Aug 2: the real reason was thrown away) ─────
  voiceDownTemp: string
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
  connectGoogle: string
  connectGoogleTitle: string
  buildQueued: string
  buildRunning: string
  buildDone: string
  buildFailed: string
  buildOnlyAdmin: string
  buildUnavailable: string
  buildNoServer: string
  buildHead: string
  /** `{n}` = attempt number. */
  buildAttempt: string
  buildSeePr: string
  buildCiFailed: string
  unlockWrongCode: string
  unlockRetryError: string
  unlockNetError: string
  unlockPlaceholder: string
  lockedTitle: string
  // ── THE PAYMENT CODE, SHOWN (M4, Aug 2): matching depends on the person
  // writing this code in the transfer reference — and the UI used to navigate
  // away without ever showing it. ────────────────────────────────────────────
  payCodeTitle: string
  payCodeHint: string
  payCodeCopy: string
  payCodeCopied: string
  payCodeOpen: string
  payCodeWaiting: string
  // ── THE HONEST CONNECTION VERDICT (Adrian, 2 aug: the app claimed „lost
  // internet" with zero measurement; now the claim is measured — see
  // diagnozaConexiune in lib/chat.ts) ──────────────────────────────────────
  serverDown: string
  requestLost: string
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
    restricted: 'Access is restricted. Only authorized accounts may enter.',
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
    disconnectCamTitle: 'Disconnect camera',
    connectCamTitle: 'Connect camera',
    micBlocked: 'Microphone blocked. Allow mic access in the browser, then tap the mic again.',
    micNoDevice: 'No microphone found.',
    micUnsupported: 'Speech recognition is not supported in this browser. Use Chrome.',
    brainNotActive: 'The brain is not active yet (Gemini key missing).',
    brainError: 'Brain error. Please try again.',
    offline: "I've lost the internet connection — I'll be right back when the signal returns.",
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
    updateReady: 'A new version is available',
    updateNow: 'Update',
    updateAuto: 'applies automatically in {n} s',
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
    cookieNote: 'We use cookies and basic analytics to run the free trial.',
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
    adminLocked: 'The Admin panel is locked 🔒',
    adminLockedHint: 'Talk to Kelion — your voiceprint opens it by itself — or type the unlock secret.',
    adminUnlock: 'Unlock',
    latencyChip: 'sent → first word / full answer',
    workClockTitle: 'Kelion is really working on the task — live elapsed time',
    heardYouTitle: 'You — on the way to the brain',
    heardBrainTitle: 'The brain got it and is thinking',
    heardKelionTitle: 'Kelion — from the brain',
    micTalk: 'Talk (microphone)',
    micStop: 'Stop the microphone',
    voiceVolume: 'Kelion’s voice volume',
    sendInterrupts: 'Kelion is answering — send now and your message replaces the current answer',
    attRemove: 'Remove attachment',
    docAttachFailed: 'I couldn’t read “{name}” — it was NOT attached.',
    docTooLarge: '“{name}” is too large to attach (the limit is about 18 MB).',
    docPrompt: 'I attached a document — read it and tell me what it contains.',
    voiceDownTemp:
      'My live voice is temporarily unavailable — dictation and typing still work, and I will retry the full voice by myself shortly.',
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
    connectGoogle: 'Connect Google',
    connectGoogleTitle: 'Grant Gmail, Calendar & Drive access so Kelion can act on them',
    buildQueued: 'Queued',
    buildRunning: 'Working',
    buildDone: 'Done',
    buildFailed: 'Failed',
    buildOnlyAdmin: 'Only the admin can see the builder.',
    buildUnavailable: 'The builder is unavailable right now.',
    buildNoServer: 'No connection to the server.',
    buildHead: 'Kelion’s builder',
    buildAttempt: 'attempt {n}',
    buildSeePr: 'See the PR ↗',
    buildCiFailed: 'CI failed on the PR',
    unlockWrongCode: 'Wrong code — try again.',
    unlockRetryError: 'Error — try again.',
    unlockNetError: 'Network error — try again.',
    unlockPlaceholder: 'Activation secret',
    lockedTitle: 'Locked — talk to Kelion (your voiceprint opens it) or type the secret',
    payCodeTitle: 'Your payment code',
    payCodeHint: 'Add this code to the Reference / Note field on the Revolut page before paying. Without this code, payment CANNOT be automatically matched to your account!',
    payCodeCopy: 'Copy the code',
    payCodeCopied: 'Copied ✓',
    payCodeOpen: 'Open Revolut and pay ↗',
    payCodeWaiting: 'Waiting for the payment — the credits arrive by themselves a few minutes after it lands.',
    serverDown:
      'The server isn’t answering right now — it is NOT your internet. I keep checking and will pick this up by myself the moment it returns.',
    requestLost: 'The request broke on the way (your internet and the server are fine) — please send it again.',
  },
  ro: {
    signIn: 'Conectează-te cu Google',
    restricted: 'Acces restricționat. Doar conturile autorizate pot intra.',
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
    disconnectCamTitle: 'Deconectează camera',
    connectCamTitle: 'Conectează camera',
    micBlocked: 'Microfonul e blocat. Permite accesul la microfon în browser, apoi apasă din nou pe microfon.',
    micNoDevice: 'Niciun microfon găsit.',
    micUnsupported: 'Recunoașterea vocală nu e suportată în acest browser. Folosește Chrome.',
    brainNotActive: 'Creierul nu e încă activat (lipsește cheia Gemini).',
    brainError: 'Eroare la creier. Încearcă din nou.',
    offline: 'Am pierdut conexiunea la internet — revin de îndată ce revine semnalul.',
    credits: 'credite',
    topUp: 'Te rog reîncarcă creditul',
    lowCredit: 'Mai ai puțin credit — te rog reîncarcă.',
    landingHeadline: 'Asistentul tău genial. Vede, aude și vorbește.',
    landingSub:
      'Vorbește cu Kelion în limba ta — întreabă, arată, navighează, creează. Conectează-te cu Google și pune credit ca să începi.',
    manualTitle: 'Tot ce știe Kelion să facă',
    multilingual: 'Suport multinațional — înțelege și răspunde în zeci de limbi, scris și vorbit.',
    updateReady: 'O versiune nouă este disponibilă',
    updateNow: 'Actualizează',
    updateAuto: 'se aplică automat în {n} s',
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
    cookieNote: 'Folosim cookies și analytics de bază pentru proba gratuită.',
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
    adminLocked: 'Panoul Admin e încuiat 🔒',
    adminLockedHint: 'Vorbește cu Kelion — amprenta ta vocală îl deschide singură — sau tastează secretul de activare.',
    adminUnlock: 'Deblochează',
    latencyChip: 'trimis → primul cuvânt / răspuns complet',
    workClockTitle: 'Kelion chiar lucrează la sarcină — timp scurs, live',
    heardYouTitle: 'Tu — înspre creier',
    heardBrainTitle: 'Creierul a primit și gândește',
    heardKelionTitle: 'Kelion — dinspre creier',
    micTalk: 'Vorbește (microfon)',
    micStop: 'Oprește microfonul',
    voiceVolume: 'Volumul vocii lui Kelion',
    sendInterrupts: 'Kelion răspunde — trimite acum și mesajul tău înlocuiește răspunsul curent',
    attRemove: 'Scoate atașamentul',
    docAttachFailed: 'Nu am putut citi „{name}” — NU a fost atașat.',
    docTooLarge: '„{name}” e prea mare pentru atașare (limita e cam 18 MB).',
    docPrompt: 'Am atașat un document — citește-l și spune-mi ce conține.',
    voiceDownTemp:
      'Vocea mea live e momentan indisponibilă — dictarea și scrisul merg, iar eu reîncerc singur vocea completă în curând.',
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
    connectGoogle: 'Conectează Google',
    connectGoogleTitle: 'Dă acces la Gmail, Calendar și Drive ca Kelion să poată lucra cu ele',
    buildQueued: 'În coadă',
    buildRunning: 'Lucrează',
    buildDone: 'Gata',
    buildFailed: 'Eșuat',
    buildOnlyAdmin: 'Doar adminul vede constructorul.',
    buildUnavailable: 'Constructor indisponibil momentan.',
    buildNoServer: 'Fără legătură cu serverul.',
    buildHead: 'Constructorul lui Kelion',
    buildAttempt: 'încercarea {n}',
    buildSeePr: 'Vezi PR ↗',
    buildCiFailed: 'CI a picat pe PR',
    unlockWrongCode: 'Cod greșit — mai încearcă.',
    unlockRetryError: 'Eroare — reîncearcă.',
    unlockNetError: 'Eroare de rețea — reîncearcă.',
    unlockPlaceholder: 'Secretul de activare',
    lockedTitle: 'Încuiat — vorbește cu Kelion (amprenta ta îl deschide) sau tastează secretul',
    payCodeTitle: 'Codul tău de plată',
    payCodeHint: 'Introdu acest cod în câmpul Referință / Notă în pagina Revolut înainte de a plăti. Fără cod, plata NU se poate asocia automat contului tău!',
    payCodeCopy: 'Copiază codul',
    payCodeCopied: 'Copiat ✓',
    payCodeOpen: 'Deschide Revolut și plătește ↗',
    payCodeWaiting: 'Aștept plata — creditele intră singure la câteva minute după ce ajunge.',
    serverDown:
      'Serverul nu răspunde momentan — NU e internetul tău. Verific întruna și reiau singur în clipa în care revine.',
    requestLost: 'Cererea s-a rupt pe drum (netul tău și serverul sunt bune) — mai trimite o dată.',
  },
  es: {
    signIn: 'Iniciar sesión con Google',
    restricted: 'Acceso restringido. Solo pueden entrar cuentas autorizadas.',
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
    disconnectCamTitle: 'Desconectar cámara',
    connectCamTitle: 'Conectar cámara',
    micBlocked: 'Micrófono bloqueado. Permite el acceso al micrófono en el navegador y vuelve a pulsar.',
    micNoDevice: 'No se encontró ningún micrófono.',
    micUnsupported: 'El reconocimiento de voz no es compatible con este navegador. Usa Chrome.',
    brainNotActive: 'El cerebro aún no está activo (falta la clave de Gemini).',
    brainError: 'Error del cerebro. Inténtalo de nuevo.',
    offline: 'He perdido la conexión a internet — vuelvo en cuanto regrese la señal.',
    credits: 'créditos',
    topUp: 'Por favor recarga tu crédito',
    lowCredit: 'Te queda poco crédito — recarga, por favor.',
    landingHeadline: 'Tu asistente brillante. Ve, oye y habla.',
    landingSub:
      'Habla con Kelion en tu idioma — pregunta, muestra, navega, crea. Inicia sesión con Google y añade crédito para empezar.',
    manualTitle: 'Todo lo que Kelion sabe hacer',
    multilingual: 'Soporte multinacional — entiende y responde en decenas de idiomas, escrito y hablado.',
    updateReady: 'Hay una nueva versión disponible',
    updateNow: 'Actualizar',
    updateAuto: 'se aplicará automáticamente en {n} s',
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
    cookieNote: 'Usamos cookies y analítica básica para la prueba gratuita.',
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
    adminLocked: 'El panel de Admin está bloqueado 🔒',
    adminLockedHint: 'Habla con Kelion — tu huella de voz lo abre sola — o escribe el secreto de activación.',
    adminUnlock: 'Desbloquear',
    latencyChip: 'enviado → primera palabra / respuesta completa',
    workClockTitle: 'Kelion realmente está trabajando en la tarea — tiempo transcurrido en vivo',
    heardYouTitle: 'Tú — camino al cerebro',
    heardBrainTitle: 'El cerebro lo recibió y está pensando',
    heardKelionTitle: 'Kelion — desde el cerebro',
    micTalk: 'Hablar (micrófono)',
    micStop: 'Detener el micrófono',
    voiceVolume: 'Volumen de la voz de Kelion',
    sendInterrupts: 'Kelion está respondiendo — envía ahora y tu mensaje reemplazará la respuesta actual',
    attRemove: 'Quitar archivo adjunto',
    docAttachFailed: 'No pude leer “{name}” — NO fue adjuntado.',
    docTooLarge: '“{name}” es demasiado grande para adjuntar (el límite es de aprox. 18 MB).',
    docPrompt: 'Adjunté un documento — léelo y dime qué contiene.',
    voiceDownTemp:
      'Mi voz en vivo no está disponible temporalmente — el dictado y la escritura siguen funcionando, y reintentaré la voz completa pronto.',
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
    connectGoogle: 'Conectar Google',
    connectGoogleTitle: 'Concede acceso a Gmail, Calendar y Drive para que Kelion pueda actuar sobre ellos',
    buildQueued: 'En cola',
    buildRunning: 'Trabajando',
    buildDone: 'Listo',
    buildFailed: 'Fallido',
    buildOnlyAdmin: 'Solo el administrador puede ver el constructor.',
    buildUnavailable: 'El constructor no está disponible en este momento.',
    buildNoServer: 'Sin conexión con el servidor.',
    buildHead: 'El constructor de Kelion',
    buildAttempt: 'intento {n}',
    buildSeePr: 'Ver el PR ↗',
    buildCiFailed: 'La CI falló en el PR',
    unlockWrongCode: 'Código incorrecto — inténtalo de nuevo.',
    unlockRetryError: 'Error — inténtalo de nuevo.',
    unlockNetError: 'Error de red — inténtalo de nuevo.',
    unlockPlaceholder: 'Secreto de activación',
    lockedTitle: 'Bloqueado — habla con Kelion (tu huella de voz lo abre) o escribe el secreto',
    payCodeTitle: 'Tu código de pago',
    payCodeHint: 'Añade este código al campo Referencia / Nota en la página de Revolut antes de pagar. ¡Sin este código, el pago NO se puede asociar automáticamente a tu cuenta!',
    payCodeCopy: 'Copiar el código',
    payCodeCopied: 'Copiado ✓',
    payCodeOpen: 'Abrir Revolut y pagar ↗',
    payCodeWaiting: 'Esperando el pago — los créditos llegan solos unos minutos después de realizarlo.',
    serverDown:
      'El servidor no responde ahora mismo — NO es tu internet. Sigo comprobando y reanudaré todo en cuanto vuelva.',
    requestLost: 'La solicitud se interrumpió en el camino (tu internet y el servidor están bien) — por favor envíala de nuevo.',
  },
  fr: {
    signIn: 'Se connecter avec Google',
    restricted: 'Accès restreint. Seuls les comptes autorisés peuvent entrer.',
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
    disconnectCamTitle: 'Déconnecter la caméra',
    connectCamTitle: 'Connecter la caméra',
    micBlocked: 'Micro bloqué. Autorisez l’accès au micro dans le navigateur, puis réessayez.',
    micNoDevice: 'Aucun microphone trouvé.',
    micUnsupported: 'La reconnaissance vocale n’est pas prise en charge par ce navigateur. Utilisez Chrome.',
    brainNotActive: 'Le cerveau n’est pas encore actif (clé Gemini manquante).',
    brainError: 'Erreur du cerveau. Veuillez réessayer.',
    offline: 'J’ai perdu la connexion internet — je reviens dès que le signal revient.',
    credits: 'crédits',
    topUp: 'Veuillez recharger votre crédit',
    lowCredit: 'Votre crédit est presque épuisé — veuillez recharger.',
    landingHeadline: 'Votre assistant brillant. Il voit, entend et parle.',
    landingSub:
      'Parlez à Kelion dans votre langue — demandez, montrez, naviguez, créez. Connectez-vous avec Google et ajoutez du crédit pour commencer.',
    manualTitle: 'Tout ce que Kelion sait faire',
    multilingual: 'Support multinational — comprend et répond dans des dizaines de langues, à l’écrit comme à l’oral.',
    updateReady: 'Une nouvelle version est disponible',
    updateNow: 'Mettre à jour',
    updateAuto: "s'applique automatiquement dans {n} s",
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
    cookieNote: 'Nous utilisons des cookies et des statistiques de base pour l’essai gratuit.',
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
    adminLocked: 'Le panneau Admin est verrouillé 🔒',
    adminLockedHint: 'Parlez à Kelion — votre empreinte vocale l’ouvre toute seule — ou tapez le secret d’activation.',
    adminUnlock: 'Déverrouiller',
    latencyChip: 'envoyé → premier mot / réponse complète',
    workClockTitle: 'Kelion travaille vraiment sur la tâche — temps écoulé en direct',
    heardYouTitle: 'Vous — en route vers le cerveau',
    heardBrainTitle: 'Le cerveau a reçu et réfléchit',
    heardKelionTitle: 'Kelion — depuis le cerveau',
    micTalk: 'Parler (microphone)',
    micStop: 'Arrêter le microphone',
    voiceVolume: 'Volume de la voix de Kelion',
    sendInterrupts: 'Kelion répond — envoyez maintenant et votre message remplacera la réponse actuelle',
    attRemove: 'Supprimer la pièce jointe',
    docAttachFailed: 'Impossible de lire « {name} » — il n’a PAS été joint.',
    docTooLarge: '« {name} » est trop grand pour être joint (la limite est d’environ 18 Mo).',
    docPrompt: 'J’ai joint un document — lis-le et dis-moi ce qu’il contient.',
    voiceDownTemp:
      'Ma voix en direct est temporairement indisponible — la dictée et l’écriture fonctionnent toujours, et je réessaierai bientôt la voix complète.',
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
    connectGoogle: 'Connecter Google',
    connectGoogleTitle: 'Accordez l’accès à Gmail, Calendar et Drive pour que Kelion puisse agir dessus',
    buildQueued: 'En attente',
    buildRunning: 'En cours',
    buildDone: 'Terminé',
    buildFailed: 'Échoué',
    buildOnlyAdmin: 'Seul l’administrateur peut voir le constructeur.',
    buildUnavailable: 'Le constructeur est indisponible pour le moment.',
    buildNoServer: 'Pas de connexion au serveur.',
    buildHead: 'Le constructeur de Kelion',
    buildAttempt: 'tentative {n}',
    buildSeePr: 'Voir le PR ↗',
    buildCiFailed: 'La CI a échoué sur le PR',
    unlockWrongCode: 'Code incorrect — réessayez.',
    unlockRetryError: 'Erreur — réessayez.',
    unlockNetError: 'Erreur réseau — réessayez.',
    unlockPlaceholder: 'Secret d’activation',
    lockedTitle: 'Verrouillé — parlez à Kelion (votre empreinte vocale l’ouvre) ou tapez le secret',
    payCodeTitle: 'Votre code de paiement',
    payCodeHint: 'Ajoutez ce code dans le champ Référence / Note sur la page Revolut avant de payer. Sans ce code, le paiement NE PEUT PAS être associé automatiquement à votre compte !',
    payCodeCopy: 'Copier le code',
    payCodeCopied: 'Copié ✓',
    payCodeOpen: 'Ouvrir Revolut et payer ↗',
    payCodeWaiting: 'En attente du paiement — les crédits arrivent seuls quelques minutes après la réception.',
    serverDown:
      'Le serveur ne répond pas pour le moment — ce n’est PAS votre internet. Je continue de vérifier et reprendrai tout dès son retour.',
    requestLost: 'La requête a été interrompue en chemin (votre internet et le serveur vont bien) — veuillez l’renvoyer.',
  },
  de: {
    signIn: 'Mit Google anmelden',
    restricted: 'Zugang beschränkt. Nur autorisierte Konten haben Zutritt.',
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
    disconnectCamTitle: 'Kamera trennen',
    connectCamTitle: 'Kamera verbinden',
    micBlocked: 'Mikrofon blockiert. Erlaube den Mikrofonzugriff im Browser und tippe erneut.',
    micNoDevice: 'Kein Mikrofon gefunden.',
    micUnsupported: 'Spracherkennung wird in diesem Browser nicht unterstützt. Nutze Chrome.',
    brainNotActive: 'Das Gehirn ist noch nicht aktiv (Gemini-Schlüssel fehlt).',
    brainError: 'Gehirn-Fehler. Bitte versuche es erneut.',
    offline: 'Ich habe die Internetverbindung verloren — ich bin zurück, sobald das Signal wieder da ist.',
    credits: 'Guthaben',
    topUp: 'Bitte lade dein Guthaben auf',
    lowCredit: 'Dein Guthaben wird knapp — bitte aufladen.',
    landingHeadline: 'Dein brillanter Assistent. Er sieht, hört und spricht.',
    landingSub:
      'Sprich mit Kelion in deiner Sprache — frag, zeig, navigiere, erschaffe. Melde dich mit Google an und lade Guthaben auf, um zu starten.',
    manualTitle: 'Alles, was Kelion kann',
    multilingual: 'Multinationale Unterstützung — versteht und antwortet in Dutzenden Sprachen, schriftlich und gesprochen.',
    updateReady: 'Eine neue Version ist verfügbar',
    updateNow: 'Aktualisieren',
    updateAuto: 'wird automatisch in {n} s angewendet',
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
    cookieNote: 'Wir verwenden Cookies und einfache Statistiken für die Gratis-Probe.',
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
    adminLocked: 'Das Admin-Panel ist gesperrt 🔒',
    adminLockedHint: 'Sprich mit Kelion — dein Stimmabdruck öffnet es von selbst — oder tippe das Freischaltgeheimnis.',
    adminUnlock: 'Entsperren',
    latencyChip: 'gesendet → erstes Wort / vollständige Antwort',
    workClockTitle: 'Kelion arbeitet wirklich an der Aufgabe — verstrichene Zeit live',
    heardYouTitle: 'Du — unterwegs zum Gehirn',
    heardBrainTitle: 'Das Gehirn hat es und denkt nach',
    heardKelionTitle: 'Kelion — vom Gehirn',
    micTalk: 'Sprechen (Mikrofon)',
    micStop: 'Mikrofon stoppen',
    voiceVolume: 'Kelions Sprachlautstärke',
    sendInterrupts: 'Kelion antwortet — jetzt senden und deine Nachricht ersetzt die aktuelle Antwort',
    attRemove: 'Anhang entfernen',
    docAttachFailed: 'Konnte „{name}“ nicht lesen — wurde NICHT angehängt.',
    docTooLarge: '„{name}“ ist zu groß zum Anhängen (das Limit liegt bei etwa 18 MB).',
    docPrompt: 'Ich habe ein Dokument angehängt — lies es und sag mir, was es enthält.',
    voiceDownTemp:
      'Meine Live-Stimme ist vorübergehend nicht verfügbar — Diktat und Schreiben funktionieren weiterhin, und ich versuche es in Kürze selbst erneut.',
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
    connectGoogle: 'Google verbinden',
    connectGoogleTitle: 'Gewähre Zugriff auf Gmail, Kalender & Drive, damit Kelion darauf zugreifen kann',
    buildQueued: 'In Warteschlange',
    buildRunning: 'Arbeitet',
    buildDone: 'Fertig',
    buildFailed: 'Fehlgeschlagen',
    buildOnlyAdmin: 'Nur der Admin kann den Builder sehen.',
    buildUnavailable: 'Der Builder ist derzeit nicht verfügbar.',
    buildNoServer: 'Keine Verbindung zum Server.',
    buildHead: 'Kelions Builder',
    buildAttempt: 'Versuch {n}',
    buildSeePr: 'PR ansehen ↗',
    buildCiFailed: 'CI beim PR fehlgeschlagen',
    unlockWrongCode: 'Falscher Code — bitte erneut versuchen.',
    unlockRetryError: 'Fehler — bitte erneut versuchen.',
    unlockNetError: 'Netzwerkfehler — bitte erneut versuchen.',
    unlockPlaceholder: 'Aktivierungsgeheimnis',
    lockedTitle: 'Gesperrt — sprich mit Kelion (dein Stimmabdruck öffnet es) oder tippe das Geheimnis',
    payCodeTitle: 'Dein Zahlungscode',
    payCodeHint: 'Füge diesen Code vor der Zahlung in das Feld Referenz / Hinweis auf der Revolut-Seite ein. Ohne diesen Code kann die Zahlung NICHT automatisch deinem Konto zugeordnet werden!',
    payCodeCopy: 'Code kopieren',
    payCodeCopied: 'Kopiert ✓',
    payCodeOpen: 'Revolut öffnen und bezahlen ↗',
    payCodeWaiting: 'Warten auf die Zahlung — das Guthaben trifft wenige Minuten nach Eingang von selbst ein.',
    serverDown:
      'Der Server antwortet gerade nicht — es liegt NICHT an deinem Internet. Ich prüfe weiter und mache von selbst weiter, sobald er zurück ist.',
    requestLost: 'Die Anfrage wurde unterwegs unterbrochen (dein Internet und der Server sind in Ordnung) — bitte erneut senden.',
  },
  it: {
    signIn: 'Accedi con Google',
    restricted: 'Accesso limitato. Solo gli account autorizzati possono entrare.',
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
    disconnectCamTitle: 'Scollega fotocamera',
    connectCamTitle: 'Collega fotocamera',
    micBlocked: 'Microfono bloccato. Consenti l’accesso al microfono nel browser e riprova.',
    micNoDevice: 'Nessun microfono trovato.',
    micUnsupported: 'Il riconoscimento vocale non è supportato in questo browser. Usa Chrome.',
    brainNotActive: 'Il cervello non è ancora attivo (manca la chiave Gemini).',
    brainError: 'Errore del cervello. Riprova.',
    offline: 'Ho perso la connessione a internet — torno appena il segnale ritorna.',
    credits: 'crediti',
    topUp: 'Ricarica il tuo credito, per favore',
    lowCredit: 'Il tuo credito sta per finire — ricarica, per favore.',
    landingHeadline: 'Il tuo assistente brillante. Vede, sente e parla.',
    landingSub:
      'Parla con Kelion nella tua lingua — chiedi, mostra, naviga, crea. Accedi con Google e aggiungi credito per iniziare.',
    manualTitle: 'Tutto ciò che Kelion sa fare',
    multilingual: 'Supporto multinazionale — capisce e risponde in decine di lingue, scritte e parlate.',
    updateReady: 'È disponibile una nuova versione',
    updateNow: 'Aggiorna',
    updateAuto: 'si applica automaticamente tra {n} s',
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
    cookieNote: 'Usiamo cookie e statistiche di base per la prova gratuita.',
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
    adminLocked: 'Il pannello Admin è bloccato 🔒',
    adminLockedHint: 'Parla con Kelion — la tua impronta vocale lo apre da sola — oppure digita il segreto di attivazione.',
    adminUnlock: 'Sblocca',
    latencyChip: 'inviato → prima parola / risposta completa',
    workClockTitle: 'Kelion sta davvero lavorando al compito — tempo trascorso dal vivo',
    heardYouTitle: 'Tu — in viaggio verso il cervello',
    heardBrainTitle: 'Il cervello l’ha ricevuto e sta pensando',
    heardKelionTitle: 'Kelion — dal cervello',
    micTalk: 'Parla (microfono)',
    micStop: 'Interrompi il microfono',
    voiceVolume: 'Volume della voce di Kelion',
    sendInterrupts: 'Kelion sta rispondendo — invia ora e il tuo messaggio sostituirà la risposta attuale',
    attRemove: 'Rimuovi allegato',
    docAttachFailed: 'Impossibile leggere “{name}” — NON è stato allegato.',
    docTooLarge: '“{name}” è troppo grande da allegare (il limite è di circa 18 MB).',
    docPrompt: 'Ho allegato un documento — leggilo e dimmi cosa contiene.',
    voiceDownTemp:
      'La mia voce dal vivo è temporaneamente non disponibile — la dettatura e la scrittura funzionano ancora e riproverò presto a ripristinare la voce completa.',
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
    connectGoogle: 'Connetti Google',
    connectGoogleTitle: 'Concedi l’accesso a Gmail, Calendar e Drive così Kelion può agirvi',
    buildQueued: 'In coda',
    buildRunning: 'In corso',
    buildDone: 'Fatto',
    buildFailed: 'Fallito',
    buildOnlyAdmin: 'Solo l’amministratore può vedere il builder.',
    buildUnavailable: 'Il builder non è disponibile al momento.',
    buildNoServer: 'Nessuna connessione al server.',
    buildHead: 'Il builder di Kelion',
    buildAttempt: 'tentativo {n}',
    buildSeePr: 'Vedi la PR ↗',
    buildCiFailed: 'La CI è fallita sulla PR',
    unlockWrongCode: 'Codice errato — riprova.',
    unlockRetryError: 'Errore — riprova.',
    unlockNetError: 'Errore di rete — riprova.',
    unlockPlaceholder: 'Segreto di attivazione',
    lockedTitle: 'Bloccato — parla con Kelion (la tua impronta vocale lo apre) o digita il segreto',
    payCodeTitle: 'Il tuo codice di pagamento',
    payCodeHint: 'Aggiungi questo codice nel campo Riferimento / Nota sulla pagina Revolut prima di pagare. Senza questo codice, il pagamento NON può essere associato automaticamente al tuo account!',
    payCodeCopy: 'Copia il codice',
    payCodeCopied: 'Copiato ✓',
    payCodeOpen: 'Apri Revolut e paga ↗',
    payCodeWaiting: 'In attesa del pagamento — i crediti arrivano da soli pochi minuti dopo l’incasso.',
    serverDown:
      'Il server non risponde al momento — NON è la tua connessione. Continuo a controllare e riprenderò da solo appena torna.',
    requestLost: 'La richiesta si è interrotta lungo il percorso (la tua connessione e il server stanno bene) — per favore inviala di nuovo.',
  },
  pt: {
    signIn: 'Entrar com Google',
    restricted: 'Acesso restrito. Apenas contas autorizadas podem entrar.',
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
    disconnectCamTitle: 'Desconectar câmera',
    connectCamTitle: 'Conectar câmera',
    micBlocked: 'Microfone bloqueado. Permita o acesso ao microfone no navegador e toque novamente.',
    micNoDevice: 'Nenhum microfone encontrado.',
    micUnsupported: 'O reconhecimento de voz não é suportado neste navegador. Use o Chrome.',
    brainNotActive: 'O cérebro ainda não está ativo (falta a chave Gemini).',
    brainError: 'Erro do cérebro. Tente novamente.',
    offline: 'Perdi a conexão com a internet — volto assim que o sinal retornar.',
    credits: 'créditos',
    topUp: 'Por favor, recarregue o seu crédito',
    lowCredit: 'O seu crédito está acabando — recarregue, por favor.',
    landingHeadline: 'O seu assistente brilhante. Ele vê, ouve e fala.',
    landingSub:
      'Fale com o Kelion no seu idioma — pergunte, mostre, navegue, crie. Entre com o Google e adicione crédito para começar.',
    manualTitle: 'Tudo o que o Kelion sabe fazer',
    multilingual: 'Suporte multinacional — entende e responde em dezenas de idiomas, escrito e falado.',
    updateReady: 'Uma nova versão está disponível',
    updateNow: 'Atualizar',
    updateAuto: 'aplica-se automaticamente em {n} s',
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
    cookieNote: 'Usamos cookies e análises básicas para o teste gratuito.',
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
    adminLocked: 'O painel Admin está bloqueado 🔒',
    adminLockedHint: 'Fala com o Kelion — a tua impressão de voz abre-o sozinha — ou escreve o segredo de ativação.',
    adminUnlock: 'Desbloquear',
    latencyChip: 'enviado → primeira palavra / resposta completa',
    workClockTitle: 'Kelion está realmente trabalhando na tarefa — tempo decorrido ao vivo',
    heardYouTitle: 'Tu — a caminho do cérebro',
    heardBrainTitle: 'O cérebro recebeu e está a pensar',
    heardKelionTitle: 'Kelion — do cérebro',
    micTalk: 'Falar (microfone)',
    micStop: 'Parar o microfone',
    voiceVolume: 'Volume da voz de Kelion',
    sendInterrupts: 'Kelion está respondendo — envie agora e sua mensagem substituirá a resposta atual',
    attRemove: 'Remover anexo',
    docAttachFailed: 'Não foi possível ler “{name}” — NÃO foi anexado.',
    docTooLarge: '“{name}” é grande demais para anexar (o limite é de cerca de 18 MB).',
    docPrompt: 'Anexei um documento — leia-o e me diga o que ele contém.',
    voiceDownTemp:
      'Minha voz ao vivo está temporariamente indisponível — o ditado e a escrita continuam funcionando, e tentarei novamente a voz completa em breve.',
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
    connectGoogle: 'Conectar Google',
    connectGoogleTitle: 'Conceda acesso ao Gmail, Agenda e Drive para que Kelion possa atuar neles',
    buildQueued: 'Na fila',
    buildRunning: 'Trabalhando',
    buildDone: 'Concluído',
    buildFailed: 'Falhou',
    buildOnlyAdmin: 'Apenas o administrador pode ver o construtor.',
    buildUnavailable: 'O construtor está indisponível no momento.',
    buildNoServer: 'Sem conexão com o servidor.',
    buildHead: 'O construtor do Kelion',
    buildAttempt: 'tentativa {n}',
    buildSeePr: 'Ver o PR ↗',
    buildCiFailed: 'A CI falhou no PR',
    unlockWrongCode: 'Código incorreto — tente novamente.',
    unlockRetryError: 'Erro — tente novamente.',
    unlockNetError: 'Erro de rede — tente novamente.',
    unlockPlaceholder: 'Segredo de ativação',
    lockedTitle: 'Bloqueado — fale com o Kelion (sua impressão de voz o abre) ou digite o segredo',
    payCodeTitle: 'Seu código de pagamento',
    payCodeHint: 'Adicione este código no campo Referência / Nota na página do Revolut antes de pagar. Sem este código, o pagamento NÃO pode ser associado automaticamente à sua conta!',
    payCodeCopy: 'Copiar o código',
    payCodeCopied: 'Copiado ✓',
    payCodeOpen: 'Abrir Revolut e pagar ↗',
    payCodeWaiting: 'Aguardando o pagamento — os créditos chegam sozinhos alguns minutos após o recebimento.',
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
