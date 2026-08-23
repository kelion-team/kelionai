import 'dotenv/config'

// ── A KEY WRITTEN UNDER A DIFFERENT NAME IS NOT A MISSING KEY ──────────────
//
// Adrian, 30 Jul, twice: "all the keys have been written dozens of times."
// He was right, and the fault was this code. Look at what used to be below:
//   OPENAI_API_KEY     or  OPENAI_KEY      → two accepted names
//   OPENROUTER_API_KEY or  OPENROUTER_KEY  → two accepted names
//   GOOGLE_TTS_API_KEY or  GOOGLE_API_KEY  → two accepted names
//   GOOGLE_MAPS_KEY                        → ONE only, and without "_API_"
//   SERPER_API_KEY, GEMINI_API_KEY         → one each
// Someone had already hit the "I typed a different name" problem three times
// and patched it with aliases — but exactly on the ones that didn't work, no
// alias existed. And `MAPS` is the only one written without `_API_`, so the
// variant anyone normal would type (`GOOGLE_MAPS_API_KEY`) hit nothing. A key
// written under a reasonable name MUST be found; otherwise the user retypes it
// forever and we keep telling him "it's missing".
function env(...names: string[]): string {
  for (const n of names) {
    const v = process.env[n]
    if (v != null && v.trim() !== '') return v.trim()
  }
  return ''
}

/** All accepted names for each key. Exported so the admin panel can say
 *  "you typed X, I read Y" instead of "missing". */
export const ENV_ALIASES: Record<string, string[]> = {
  databaseUrl: ['DATABASE_URL', 'POSTGRES_URL'],
  googleServiceAccountJson: ['GOOGLE_SERVICE_ACCOUNT_JSON', 'GOOGLE_SERVICE_ACCOUNT', 'GCP_SERVICE_ACCOUNT_JSON'],
  googleTtsKey: ['GOOGLE_TTS_API_KEY', 'GOOGLE_TTS_KEY'],
  serperKey: ['SERPER_API_KEY', 'SERPER_KEY'],
  // (googleMapsKey scos, 3 aug — cheia nu avea niciun consumator; vezi nota
  // de la fostul câmp config.googleMapsKey de mai jos.)
  geminiKey: ['GEMINI_API_KEY', 'GEMINI_KEY', 'GOOGLE_GEMINI_API_KEY'],
  // OpenAI — REINTRODUS 23 aug 2026 ca provider alternativ pentru chat/text
  // (owner a aprobat OpenAI/ChatGPT cu scalare pe dificultate). Cheia din
  // env (OPENAI_API_KEY); modelele pot fi suprascrise prin env.
  openaiKey: ['OPENAI_API_KEY', 'OPENAI_KEY'],
  openaiLuna: ['OPENAI_LUNA_MODEL'],
  openaiMedium: ['OPENAI_MEDIUM_MODEL'],
  openaiHeavy: ['OPENAI_HEAVY_MODEL'],
  openaiMax: ['OPENAI_MAX_MODEL'],
  // (CHEIA FABLE 5 / Anthropic a fost SCOASĂ — owner, 16 aug: „fable iese total
  // de peste tot… curata peste tot in aplicatie". Nu mai există niciun consumator
  // Fable/Anthropic în cod; constructorul e Devin, iar creierul de raționament e
  // Gemini.)
  julesKey: ['JULES_API_KEY', 'JULES_KEY'],
  // Devin — constructorul EXTERN (owner, 20 aug: „punel pe devin cu cheie").
  // Cheia stă în secretele repo-ului → vps-set-env → env-ul VPS, ca restul.
  // `devinOrgId` e opțional (API-ul de bază /v1/sessions merge doar cu cheia).
  devinKey: ['DEVIN_API_KEY', 'DEVIN_KEY'],
  devinOrgId: ['DEVIN_ORG_ID'],
  mailPass: ['MAIL_PASS', 'MAIL_PASSWORD'],
  bridgeSecret: ['BRIDGE_SECRET'],
  sessionSecret: ['SESSION_SECRET'],
  githubToken: ['GITHUB_TOKEN', 'KELION_GITHUB_TOKEN'],
  useLocalVosk: ['USE_LOCAL_VOSK'],
  localVoskUrl: ['LOCAL_VOSK_URL'],
  // Coqui TTS (clonare voce, 23 aug 2026) — microserviciu Python pe port 5100 intern.
  // Default: 127.0.0.1:5100 (container same-host). Non-fatal: dacă nu rulează,
  // /api/voce/sintetizeaza returnează 503 cinstit.
  coquiUrl: ['COQUI_URL'],
}

function required(name: string): string {
  const v = process.env[name]
  if (!v || v.trim() === '') {
    // FAIL-FAST ÎN PRODUCȚIE (audit 9 aug): „required" care întoarce '' nu
    // cere nimic — un SESSION_SECRET lipsă lăsa serverul să booteze tăcut,
    // login-ul dădea 500 și TOATE cookie-urile mureau mut. Mai bine o pornire
    // care ȚIPĂ (anti-fantoma publicării o prinde pe loc: containerul nu urcă,
    // live rămâne pe versiunea bună) decât un server care minte. Toate cele 4
    // nume gardate aici sunt deja obligatorii și în poarta de env din deploy.sh.
    if (process.env.NODE_ENV === 'production') {
      throw new Error(`env obligatoriu LIPSĂ sau GOL: ${name} — completează-l în kelionai.env (poarta din deploy.sh îl cere și ea)`)
    }
    return ''
  }
  return v
}

const isProd = process.env.NODE_ENV === 'production'

// ── MODELUL UNIC AL CREIERULUI — SIGILAT (Adrian, 6 aug, regulă ultra-decisă:
// „modelul decis de mine să nu se poată modifica accidental sau de altcineva fără
// decizia mea; mereu cel mai performant model complet; când apare ceva nou, preluat
// prin update automat, peste tot"). O SINGURĂ sursă de adevăr, în COD, FĂRĂ env
// (nici GEMINI_MODEL_GREU, nici BRAIN_*) — ca nimic (autonomie, env pe VPS, UI) să
// nu-l poată schimba din greșeală. Se schimbă DOAR prin auto-upgrade VALIDAT
// (services/modelAutoUpgrade) — probă reală + doar la un Pro mai nou, niciodată la
// flash/experimental. Config-ul îl expune prin GETTERI, deci se aplică AUTOMAT
// peste tot (chat, agenți, memorie, fallback, scară) — schimbi într-un loc, se
// schimbă peste tot.
// SCHIMBAT 7 aug, PE MĂSURĂTOARE, cu acordul explicit al ownerului: slotul greu
// pleacă de pe Pro pe `gemini-3.5-flash`. Proba de calitate (scripts/proba-calitate.py,
// 10 sarcini cu verificare AUTOMATĂ × 2 rulări × 8 modele, gândire 'high', rulată
// de owner pe VPS-ul lui):
//   gemini-3.5-flash        20/20   median 2620 ms   cel mai lent  6,3 s
//   gemini-3-flash-preview  20/20   median 2093 ms   cel mai lent  6,4 s
//   gemini-3.1-pro-preview  20/20   median 4713 ms   cel mai lent 73,3 s
//   gemini-pro-latest       20/20   median 4818 ms   cel mai lent 72,2 s
//   gemini-2.5-pro          18/20   median 6553 ms   cel mai lent 75,3 s
// La CALITATE sunt egale (20/20). Diferența e că Pro e de două ori mai lent la
// mediană și, mai grav, are cazuri de 72-75 SECUNDE. S-a ales `3.5-flash` și nu
// `3-flash-preview` (cu 527 ms mai rapid) fiindcă „preview" e un nume pe care
// Google îl poate retrage; iar 3.5-flash e din aceeași familie ca slotul rapid
// (3.5-flash-lite), deci intră pe aceeași ramură de configurare a gândirii.
export const MODEL_UNIC_DEFAULT = 'gemini-3.5-flash'
let modelUnicActiv = MODEL_UNIC_DEFAULT
/** Codul modelului unic (ex: „gemini-3.1-pro-preview"). Sursa de adevăr, live. */
export function modelUnicCod(): string {
  return modelUnicActiv
}
/** Modelul unic cu prefix google-direct/ (forma treptelor creierului). */
export function modelUnicDirect(): string {
  return `google-direct/${modelUnicActiv}`
}
export function esteModelGeneralGreu(cod: string): boolean {
  if (!cod || typeof cod !== 'string') return false
  const curat = cod.replace(/^google-direct\//, '').trim()
  if (!/^gemini-\d+(?:\.\d+)?-flash(?:-|$)/.test(curat) || /-lite(?:-|$)/.test(curat) || /-(?:video|audio|live|image|embed|eap|tuning|vision|thinking|realtime|grounding|robotics|custom|distill|stream|agent)(?:-|$)/i.test(curat)) {
    return false
  }
  return /^gemini-\d+(?:\.\d+)?-flash(?:-(?:preview|\d{3,}))?$/i.test(curat)
}

/** Setează modelul unic — DOAR din auto-upgrade-ul validat. Acceptă NUMAI un
 *  Gemini flash general de producție/preview (niciodată lite/specializat), altfel refuză (false). Poarta
 *  care ține „mereu cel mai performant, dar niciodată degradat de o schimbare
 *  greșită". */
export function setModelUnicValidat(m: string): boolean {
  const cod = String(m || '').replace(/^google-direct\//, '').trim()
  if (!esteModelGeneralGreu(cod)) return false
  modelUnicActiv = cod
  return true
}

// ── AL DOILEA SLOT: MODELUL RAPID (Adrian, 7 aug — MĂSURAT pe cheia lui, de pe
// VPS, cu payload real) ──────────────────────────────────────────────────────
// Dovada care a impus separarea (rulată de owner, 3 măsurători/model):
//   gemini-3.5-flash-lite    508–713 ms   unelte DA · vede DA · aude DA
//   gemini-3.1-pro-preview   3.622 ms … 45.026 ms (EXPIRAT)  ← ce rula pe chat
// Adică modelul de chat era cel mai lent DIN TOATE și, mai rău, imprevizibil
// (3,6s → 45s pe aceeași cerere). „18 secunde să-mi spună cât e ceasul?" —
// întrebarea ownerului, care a pornit studiul; răspunsul a fost: da, și nici
// măcar nu știa ora.
//
// DE CE `gemini-3.5-flash-lite` și NU `gemini-flash-lite-latest` (care măsura
// 511 ms, cu 100 ms mai puțin): aliasul `-latest` nu se potrivește NICIUNEIA din
// ramurile de configurare a gândirii din geminiDirect.ts (`/gemini-2\.5/` sau
// `/gemini-3/`) → ar pleca fără `thinkingLevel` și fără podeaua de output, exact
// capcana din 6 aug în care 3.x consumă tot bugetul pe gândire și întoarce
// răspuns GOL. `3.5-flash-lite` intră pe ramura `gemini-3`, primește configul
// corect, e cel mai NOU lite, și e la 100 ms de vârf. Corectitudine peste 100 ms.
//
// CE RĂMÂNE PE SLOTUL GREU: `geminiModelGreu`, `workDefault`, `topDefault` —
// gândirea grea, agenții cu efort înalt și autonomia. Iar unealta `ask_brain`
// (oferită de chat.ts DOAR pe tura ușoară) escaladează singură de pe slotul
// rapid pe cel greu când sarcina chiar cere gândire. [ADUS LA COD, lot D:
// slotul greu NU mai e Pro — MODEL_UNIC_DEFAULT e `gemini-3.5-flash` (mutat de
// pe Pro pe 7 aug, vezi mai sus); „Pro" de aici era rămășița acelei ere.]
export const MODEL_RAPID_DEFAULT = 'gemini-3.5-flash-lite'
let modelRapidActiv = MODEL_RAPID_DEFAULT
/** Codul modelului rapid de conversație (ex: „gemini-3.5-flash-lite"). */
export function modelRapidCod(): string {
  return modelRapidActiv
}
/** Modelul rapid cu prefix google-direct/ (forma treptelor creierului). */
export function modelRapidDirect(): string {
  return `google-direct/${modelRapidActiv}`
}
/** Setează modelul rapid — DOAR din auto-upgrade validat. Acceptă NUMAI un Gemini
 *  `flash-lite`. STRÂNS pe 7 aug: până acum accepta și flash simplu, ceea ce n-a
 *  contat cât timp slotul greu era Pro — dar de când GREUL e flash, o poartă largă
 *  aici ar fi lăsat AMBELE sloturi pe același model, adică o singură treaptă
 *  deghizată în două. Acum sunt disjuncte prin construcție: conversația = lite,
 *  gândirea grea = flash fără lite. */
export function setModelRapidValidat(m: string): boolean {
  const cod = String(m || '').replace(/^google-direct\//, '').trim()
  if (!/^gemini-\d+(?:\.\d+)?-flash-lite(?:-|$)/.test(cod)) return false
  modelRapidActiv = cod
  return true
}

// ── AL TREILEA SLOT: MODELUL PROFUND (owner, 22 aug 2026: „escaladări pe modele
// superioare"). Scara creierului trece de la 1 treaptă la 4: flash-lite (vorbă
// simplă) → flash (gândire + unelte) → PROFUND (Pro, raționament complex, cod,
// strategie) → ULTRA (env-configurable, pentru modele viitoare).
// Pro e MĂSURAT 20/20 pe calitate (proba-calitate.py), dar 2x mai lent cu outliers
// de 72-75s — de-aia stă DOAR pe treapta a 3-a, escaladat automat la dificultate
// mare (ESCALATE_TOP_AT) sau când modelul cere singur prin ask_brain.
export const MODEL_PROFUND_DEFAULT = 'gemini-3.1-pro-preview'
let modelProfundActiv = MODEL_PROFUND_DEFAULT
/** Codul modelului profund (ex: „gemini-3.1-pro-preview"). */
export function modelProfundCod(): string {
  return process.env.MODEL_CREIER_PROFUND ?? modelProfundActiv
}
/** Modelul profund cu prefix google-direct/ (forma treptelor creierului). */
export function modelProfundDirect(): string {
  return `google-direct/${modelProfundCod()}`
}
/** Setează modelul profund — DOAR din auto-upgrade validat. Acceptă un Gemini Pro
 *  de producție/preview. */
function setModelProfundValidat(m: string): boolean {
  const cod = String(m || '').replace(/^google-direct\//, '').trim()
  if (!/^gemini-\d+(?:\.\d+)?-pro(?:-|$)/.test(cod)) return false
  modelProfundActiv = cod
  return true
}

// ── AL PATRULEA SLOT: MODELUL ULTRA — pentru probleme maximale (strategie
//  complexă, analiză de sistem, decizii critice). Env-configurable pentru modele
//  viitoare; default = tot Pro (până apare ceva mai puternic măsurat).
export function modelUltraCod(): string {
  return process.env.MODEL_CREIER_ULTRA ?? modelProfundCod()
}
export function modelUltraDirect(): string {
  return `google-direct/${modelUltraCod()}`
}

export const config = {
  isProd,
  port: Number(process.env.PORT ?? 8080),
  useLocalVosk: env(...ENV_ALIASES.useLocalVosk) === '1',
  localVoskUrl: env(...ENV_ALIASES.localVoskUrl),
  google: {
    clientId: required('GOOGLE_CLIENT_ID'),
    clientSecret: required('GOOGLE_CLIENT_SECRET'),
    redirectUri: required('GOOGLE_REDIRECT_URI'),
  },
  sessionSecret: required('SESSION_SECRET'),
  // OPUS PE VOCEA LIVE (owner, 12 aug: „fă Opus" — banda vocii pe 3G). OFF din
  // start: cu flagul stins, calea vocii rămâne EXACT PCM-ul de azi (zero
  // regresie). Pornit (`VOICE_OPUS=1`), hopul browser↔server se comprimă ~10×,
  // cu cădere sigură pe PCM dacă browserul n-are WebCodecs sau codecul de server
  // nu se încarcă. Serverul↔Google rămâne PCM (Gemini Live cere PCM) — dar aia e
  // bandă de datacenter, nu 3G-ul omului.
  voiceOpus: (process.env.VOICE_OPUS ?? '') === '1',
  // ── CREIER DUBLU (owner, 13 aug: „două creiere, o singură voce"; „e urgent ca
  // kelion să lucreze real") ───────────────────────────────────────────────────
  // Fața rapidă (flash) ține discuția caldă + primul cuvânt sub 1s; pe turele
  // GRELE (inclusiv „ownerul cere o ACȚIUNE" — vezi `heavy` din chat.ts), creierul
  // din spate = INTELIGENȚĂ REALĂ (Gemini Pro la thinking maxim,
  // `gemini-3.1-pro-preview`, măsurat 20/20 pe cheia ownerului) — ăsta e leacul
  // pentru „spune că face și nu execută / fabrică": un model care CHEAMĂ unealta,
  // nu narează. PORNIT DIN START (owner, 13 aug): turele ușoare rămân pe flash
  // (conversație caldă, latență mică), doar cele grele urcă pe creierul real. Se
  // stinge cu `CREIER_DUBLU=0`; modelul e suprascriabil din env fără publicare.
  // PLASĂ (chat.ts): dacă profundul se epuizează, tura cade O DATĂ pe flash — nu
  // moare pe mesajul neutru. Etapa 2 (holder cald + orchestrarea vocii) rămâne.
  creierDublu: (process.env.CREIER_DUBLU ?? '') !== '0',
  // DEFAULT = modelul VALIDAT/viu (modelUnicCod), NU un ID hardcodat expirat.
  // Owner, 13 aug: „creierul 2 nu e funcțional" — DOVADA: era `gemini-3.1-pro-preview`
  // (versiunea 3.1), pe când modelul viu, validat automat, e 3.5. Deci pe turele
  // grele (chat.ts) comuta pe un model EXPIRAT → pica → cădea tăcut pe flash →
  // creierul 2 „mort", iar Kelion rămânea pe modelul slab care nu cheamă uneltele
  // de admin. Acum profundul e MEREU un model care servește; gândirea grea vine din
  // `reasoning:'high'` aplicat pe el. Suprascriabil din env (MODEL_CREIER_PROFUND)
  // când există un Pro dedicat, valid.
  get modelCreierProfund(): string {
    return process.env.MODEL_CREIER_PROFUND ?? modelUnicCod()
  },
  autonomyDailyMax: Math.max(1, Number(process.env.AUTONOMY_DAILY_MAX ?? '20') || 20),
  databaseUrl: env(...ENV_ALIASES.databaseUrl),
  googleServiceAccountJson: env(...ENV_ALIASES.googleServiceAccountJson),
  googleTtsKey: env(...ENV_ALIASES.googleTtsKey),
  // Chirp 3 HD voice style — MALE in every language (Adrian, Aug 2: "voce
  // masculina in orice limba"). Default Charon (male). services/tts.ts has a
  // hard guard: any known FEMALE style is rewritten to Charon before the API.
  ttsVoiceStyle: process.env.GOOGLE_TTS_VOICE ?? process.env.KELION_GOOGLE_CHIRP_TTS_STYLE ?? 'Charon',
  serperKey: env(...ENV_ALIASES.serperKey),
  // (Câmpul `googleMapsKey` a fost ȘTERS — auditul admin, 3 aug: nu-l citea
  // NIMENI. mapsSearch/mapsDirections/geocode merg exclusiv pe Nominatim OSM
  // + OSRM, cu sau fără cheie; rândul lui din env-check împingea ownerul să
  // configureze o cheie fără niciun efect — încălcarea regulii #4.)
  geminiKey: env(...ENV_ALIASES.geminiKey),
  // OpenAI — REINTRODUS 23 aug 2026. Provider alternativ pentru chat/text,
  // cu scalare automată pe dificultate (owner a aprobat). hardcod-permis:
  // modelele default sunt prețuri reale OpenAI, suprascrise prin env.
  openai: {
    key: env(...ENV_ALIASES.openaiKey),
    luna: env(...ENV_ALIASES.openaiLuna) || 'gpt-5.6-luna', // hardcod-permis: default chat ușor
    medium: env(...ENV_ALIASES.openaiMedium) || 'o4-mini', // hardcod-permis: default chat mediu
    heavy: env(...ENV_ALIASES.openaiHeavy) || 'o3-mini', // hardcod-permis: default chat greu (o3-mini în loc de o3)
    max: env(...ENV_ALIASES.openaiMax) || 'gpt-5.6-sol', // hardcod-permis: default chat maxim
  },
  // (config.anthropicKey SCOS — owner, 16 aug: Fable/Anthropic a ieșit total.)
  // Jules — agentul asincron oficial Google (3 aug): cheia API din vps-keys.
  julesKey: env(...ENV_ALIASES.julesKey),
  // Devin — constructorul extern (owner, 20 aug). Cheia din env; org opțional.
  devinKey: env(...ENV_ALIASES.devinKey),
  devinOrgId: env(...ENV_ALIASES.devinOrgId),
  // Creierul DIRECT (chat + VEDERE + AUDIO — Gemini e multimodal, un singur
  // model face tot). 5 aug 2026: Adrian a RETRACTAT hibridul — „peste tot în
  // aplicație pui modelul avansat". UN SINGUR creier = Gemini 3 Pro
  // (`gemini-3.1-pro-preview`; `gemini-3-pro-preview` dă 404 — nu-i pe cheie).
  // AMBELE câmpuri = Pro: NU mai citim GEMINI_MODEL (era treapta ușoară a
  // hibridului retras — altfel env-ul vechi GEMINI_MODEL=flash de pe VPS ar
  // readuce flash-ul pe chat). geminiDirect ridică plafonul de output pe 3.x
  // (gândirea intră în maxOutputTokens). Vocea live rulează Pro prin CREIER
  // (ureche→Pro→voce), deci „modelul avansat" e și pe voce. Un singur creier.
  // GETTERI pe sursa unică (fără env): se aplică AUTOMAT peste tot; auto-upgrade-ul
  // validat schimbă modelul într-un singur loc → se schimbă peste tot.
  // DOUĂ SLOTURI (7 aug): `geminiModel` = conversația (RAPID, ~0,6s), iar
  // `geminiModelGreu` = gândirea grea (azi = modelul unic `gemini-3.5-flash`,
  // NU Pro — lot D a corectat rămășița). Bifurcația care le folosește
  // există de mult în chat.ts (`heavy ? Greu : geminiModel`) — până azi ambele
  // ramuri dădeau același model, deci era o bifurcație moartă. Acum e vie.
  get geminiModel(): string {
    return modelRapidCod()
  },
  get geminiModelGreu(): string {
    return modelUnicCod()
  },
  // ── CREIERUL 2 (constructorul) = gemini-3.7-flash (DECIZIA ownerului, 14 aug:
  // „a apărut 3.7… l-am verificat eu, pune-l la creierul 2") ─────────────────
  // CHATUL rămâne pe modelul unic SIGILAT (3.5-flash) — auto-upgrade-ul l-a
  // refuzat CORECT pe 3.7 acolo (poarta „toate probele sau nimic": 3.7 a picat
  // „fără-invenție", 19/20 vs 20/20 — măsurat 14 aug cu proba-calitate).
  // Ownerul l-a verificat el și l-a ales EXPLICIT pentru constructor, unde
  // porțile de cod (7 porți + verdict pe mașină curată) prind oricum orice
  // invenție. NU știe live (fără bidiGenerateContent — măsurat pe API): vocea
  // nu-l atinge. Suprascriibil prin env (CONSTRUCTOR_GEMINI_MODEL).
  get constructorGeminiModel(): string {
    return process.env.CONSTRUCTOR_GEMINI_MODEL ?? 'gemini-3.7-flash'
  },
  // VIDEO — Veo prin cheia Gemini. NICIUN nivel gratuit (măsurat pe pagina
  // oficială de prețuri, 2 aug 2026) — de-aia plata cere alegerea conștientă
  // VIDEO_ALLOW_PAID=1, ca la constructor: nimic plătit din greșeală.
  videoModel: process.env.VIDEO_MODEL ?? 'veo-3.1-fast-generate-preview',
  videoAllowPaid: process.env.VIDEO_ALLOW_PAID === '1',
  // ── CREIERUL = GEMINI DIRECT, UNIC (Adrian, 3 aug, ordin repetat: „openrouter
  // și open ai scos din toată aplicația") ────────────────────────────────────
  // OpenRouter și OpenAI au fost EXTIRPATE complet (3 aug): creierul e Gemini
  // direct pe cheia Tier 2 a ownerului, căutarea e Serper, vocea e Google
  // Chirp 3 (urechi + gură). Treptele de mai jos sunt SINGURELE modele ale
  // creierului; toate poartă prefixul `google-direct/` (vezi geminiDirect.ts).
  // LACĂT ÎN COD (Adrian, 3 aug: „blochează-le cu cod ca să nu se mai schimbe
  // la orice update"): default sigur = Gemini, în cod, nu în env (care se poate
  // reseta). Lacătul (scripts/verifica-gemini.mjs + lacat.test.ts) pinuiește
  // toate trei treptele.
  brain: {
    // 4 aug 2026: toate treptele mutate de la generația 2.5 la 'gemini-3.6-flash'
    // — cea mai nouă, mai rapidă, mai ieftină, și măsurat multimodală (text +
    // apel de unealtă + imagine + audio, toate 200✓ pe cheia ownerului). „Tot pe
    // cel mai evoluat" (ordinul ownerului, 4 aug). Rămâne Gemini direct (lacătul).
    // 6 aug: SIGILAT pe sursa unică, FĂRĂ env — toate treptele = același model unic
    // Nu mai există split flash/pro, nici suprascriere din env. Getteri →
    // auto-upgrade-ul se aplică peste tot instant.
    // 7 aug: treapta de CHAT trece pe modelul RAPID (măsurat: 0,6s vs 3,6–45s),
    // iar `work`/`top` rămân pe modelul UNIC (azi `gemini-3.5-flash`, nu Pro —
    // lot D) — acolo se face gândirea grea, agenții cu efort înalt, autonomia
    // și escaladarea `ask_brain` din chat.
    get chatDefault(): string {
      return modelRapidDirect()
    },
    get workDefault(): string {
      return modelUnicDirect()
    },
    // PROFUND (22 aug): treapta a 3-a — Pro pentru raționament complex, escaladat
    // automat la dificultate mare sau prin ask_brain.
    get profundDefault(): string {
      return modelProfundDirect()
    },
    // ULTRA (22 aug): treapta a 4-a — pentru probleme maximale. Env-configurable.
    get ultraDefault(): string {
      return modelUltraDirect()
    },
    get topDefault(): string {
      return modelProfundDirect()
    },
  },
  // ── COLLECTING MONEY THROUGH REVOLUT (Adrian, 30 Jul: "Stripe goes out
  // completely and Pro comes in") ────────────────────────────────────────────
  // The Revolut Pro account has no Merchant API (that's Business only), so
  // there's no webhook to credit the user by itself. What it DOES have is a
  // payment link hosted by Revolut: the user pays there, and the credits are
  // granted by the admin from the panel (`grantCredit`, which already
  // existed).
  //
  // The link lives in env, not in code: it changes without publishing, and
  // if it's missing the button SAYS it's not configured, instead of taking
  // the user into a void.
  revolut: {
    payLink: (process.env.REVOLUT_PAY_LINK ?? '').trim(),
    // The Gmail label where the owner routes Revolut payment emails; the
    // email-reader searches ONLY here (Adrian, 3 aug: „acolo trebuie să ajungă
    // emailurile și de acolo să se caute").
    mailLabel: (process.env.REVOLUT_MAIL_LABEL ?? 'Revolut_kelionai_plati').trim(),
  },
  // ── READING TRANSACTIONS FROM THE REVOLUT ACCOUNT (Open Banking) ─────────
  // How the app finds out a user paid, when Revolut Pro has no webhook: it
  // revolut: { payLink: ..., ... }
  // (A doua secțiune revolut — menținută pentru compatibilitate).
  openBanking: {
    enabled: (process.env.REVOLUT_OB_ENABLED ?? '') === '1',
    clientId: process.env.REVOLUT_OB_CLIENT_ID ?? '',
    privateKeyPem: process.env.REVOLUT_OB_PRIVATE_KEY ?? '',
    signingCertPem: process.env.REVOLUT_OB_SIGNING_CERT ?? '',
  },
}
