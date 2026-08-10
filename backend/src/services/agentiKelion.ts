import { config } from '../config.js'
import { formatNowContext } from './timeContext.js'
import { listaAgentiCustom, searchMemories, getGoogleRefreshToken, adaugaAgentCustom } from '../db.js'
import { geminiDirectChat } from './geminiDirect.js'
import { webSearch, googleTools, runGoogleTool, refreshGoogleAccessToken } from './google.js'
import type { OrMessage, AnthropicTool } from './brainContract.js'

// ── ARSENALUL COMPLET (5 aug, ownerul: „nu are uneltele pentru tot ce are
// nevoie... instalează-i tot") ───────────────────────────────────────────────
// Până azi agenții aveau DOAR 3 unelte (căutare/pagină/amintiri) — creierul are
// ~76. De-acum agenții pleacă cu TOATE skill-urile Google, prin ACEEAȘI sursă
// unică pe care merge chat-ul (googleTools + runGoogleTool — zero duplicare):
//   • PUBLICE (vreme, hărți, rute, adresă, YouTube, traduceri, Wikipedia,
//     valute, oră) — pentru ORICINE cheamă un agent; nu ating date personale.
//   • PERSONALE (Gmail, Calendar, Drive, Tasks, Contacte) — DOAR pe căile
//     ownerului (caAdmin), cu tokenul lui Google; endpointul A2A e public și
//     datele lui nu ies pe el.
const GOOGLE_PUBLICE = new Set([
  'get_weather', 'maps_search', 'maps_directions', 'lookup_address', 'youtube_search',
  'translate_text', 'wikipedia_lookup', 'convert_currency', 'get_time',
])
// web_search din googleTools NU se re-oferă — căutarea e deja UNEALTA_CAUTARE.
const caAnthropic = (t: { name: string; description?: string; input_schema: unknown }): AnthropicTool => ({
  name: t.name,
  description: t.description ?? '',
  input_schema: t.input_schema as Record<string, unknown>,
})
const GOOGLE_TOOLS_PUBLICE: AnthropicTool[] = googleTools.filter((t) => GOOGLE_PUBLICE.has(t.name)).map(caAnthropic)
const GOOGLE_TOOLS_PERSONALE: AnthropicTool[] = googleTools
  .filter((t) => !GOOGLE_PUBLICE.has(t.name) && t.name !== 'web_search')
  .map(caAnthropic)
const NUME_GOOGLE = new Set(googleTools.map((t) => t.name))

/** Tokenul Google al ownerului — DOAR pe căile admin, pentru uneltele personale.
 *  Lipsă/expirat → runGoogleTool întoarce semnalul cinstit google_not_connected. */
async function tokenGoogleOwner(): Promise<string> {
  const refresh = await getGoogleRefreshToken(config.adminEmail).catch(() => null)
  if (!refresh) return ''
  const tok = await refreshGoogleAccessToken(refresh).catch(() => null)
  return tok?.accessToken ?? ''
}

// ── AGENȚII LUI KELION: SURSA UNICĂ ─────────────────────────────────────────
//
// De ce există (Adrian, 4 aug: „facem pentru tot agenți… când zic tot să fie
// tot" + „spargi sau OCOLEȘTI zidul, nu există alt rezultat"):
//
// Crearea agenților în consola Gemini Enterprise e blocată de o LICENȚĂ care se
// activează doar la login interactiv de om — contul de serviciu al aplicației
// nu poate (măsurat de trei ori: FAILED_PRECONDITION „license not available",
// 403 pe billingAccountLicenseConfigs.list, activare doar la primul login în
// interfață). Acela e zidul. Îl OCOLIM: agenții devin REALI și FUNCȚIONALI aici,
// în creierul lui Kelion — partea pe care o controlăm 100%. Fiecare agent e
// creierul Gemini al lui Kelion purtând pălăria unui specialist, servit la
// /api/a2a/<id> (endpointul spre care arătau deja cărțile A2A, până acum 404).
//
// Rosterul e SINGURA sursă: și endpointul viu (routes/a2a.ts), și scriptul de
// creare în consolă (routes/enterprise.ts) citesc de aici, deci lista din
// aplicație și lista din Enterprise nu pot să se contrazică niciodată.

export interface AgentKelion {
  id: string
  nume: string
  rol: string
  /** Bugetul de gândire al specialistului: 'high' = superputerea de raționament
   *  (Adrian, 4 aug: „super putere pentru gindire rationament... wow").
   *  Nespecificat = 'low' (rapid și ieftin, destul pentru meserii). */
  efort?: 'low' | 'high'
  /** Doar ownerul îl poate chema (Adrian, 4 aug: „roboti de tranzactionare
   *  DOAR admin") — routes/a2a.ts refuză POST-ul fără sesiune de admin. */
  doarAdmin?: boolean
}

export const ROSTER: AgentKelion[] = [
  // ── NIVEL 1 — CREIERUL SI SIMTURILE lui Kelion (fara ele aplicatia nu exista) ──
  { id: 'inginer-sef', nume: 'Inginer-sef', rol: 'Orchestreaza: sparge cererea in pasi si deleaga agentului potrivit.', efort: 'high' },
  { id: 'adevar', nume: 'Paznicul adevarului', rol: 'Anti-fabulatie: ce nu se poate proba = nu pot verifica.' },
  { id: 'senzorial', nume: 'Vaz Auz Memorie Gandire', rol: 'Gestioneaza vederea, auzul, memoria si gandirea lui Kelion.' },
  { id: 'gandire', nume: 'Agent Gandire Profunda', rol: 'Superputerea de rationament: probleme grele desfacute pas cu pas, ipoteze puse la incercare, concluzie verificata. Gandeste mult inainte sa raspunda.', efort: 'high' },
  { id: 'critic', nume: 'Agent Critic', rol: 'A doua opinie: cauta greselile intr-un plan sau raspuns INAINTE sa plece; spune si ce e bun.', efort: 'high' },
  { id: 'planificator', nume: 'Agent Planificator', rol: 'Sparge teluri mari in planuri pe zile: pasi, dependinte, termene realiste, ce se poate paraleliza.', efort: 'high' },
  { id: 'solutii', nume: 'Designer de solutii', rol: 'Arhitect: 2-3 solutii cu compromisuri, alege una, o desface in pasi.', efort: 'high' },
  // ── NIVEL 2 — CAPACITATILE DE ZI CU ZI (ce foloseste omul cel mai des) ──
  { id: 'cautator', nume: 'Cautator pe net', rol: 'Cautare web: surse multiple, citate, linkuri.' },
  { id: 'viziune', nume: 'Agent Viziune', rol: 'Analizeaza imagini si capturi ca un soim; spune si ce NU distinge.' },
  { id: 'voce', nume: 'Agent Voce', rol: 'STT/TTS, dictie, emotie. Prima vorba sub o secunda.' },
  { id: 'memorie', nume: 'Agent Memorie Date', rol: 'Baza de date: schema, interogari, migratii, igiena.' },
  { id: 'browser', nume: 'Agent Browser', rol: 'Deschide pagini, citeste, apasa, cu verificare dupa fiecare pas.' },
  { id: 'documente', nume: 'Agent Documente', rol: 'PDF-uri si acte: esenta, formulare, scrisori oficiale.' },
  { id: 'conversii', nume: 'Agent Conversii Fisiere', rol: 'Prelucrari de documente: conversii PDF/Word/Markdown, OCR pe scanuri, extrageri de tabele si text.' },
  { id: 'traduceri', nume: 'Agent Traduceri', rol: 'Traduceri naturale RO/EN si alte limbi, cu tonul pastrat.' },
  // ── NIVEL 3 — DEZVOLTARE SI INTRETINEREA APLICATIEI (o tin in viata) ──
  { id: 'constructor', nume: 'Agent Constructor', rol: 'Cod: ordin -> cloneaza, modifica, testeaza, PR. Bara 0-100%.' },
  { id: 'deploy', nume: 'Agent Deploy CI', rol: 'Build, teste, deploy, verificarea live==master.' },
  { id: 'monitor', nume: 'Agent Monitorizare', rol: 'Health-checks, loguri, alarme pe praguri masurate.' },
  { id: 'debug', nume: 'Depanator avansat', rol: 'Debugging: loguri, reproducere, modulul vinovat, fix minim.' },
  { id: 'doctor-kelion', nume: 'Agent Doctor Kelion', rol: 'Consultul aplicatiei: simptome din loguri, diagnostic pe dovezi, trimite la specialistul potrivit (debug, vps, monitor).' },
  { id: 'vps', nume: 'Agent VPS Infrastructura', rol: 'VPS: docker, env-file, nginx, certificate, disc. Nimic pe ghicite - doar din masuratori.' },
  { id: 'securitate', nume: 'Agent Securitate', rol: 'Paza: sesiuni, chei doar prin Secrets, acces, alarme la abuz. Nu cere si nu arata secrete.' },
  { id: 'imunitate', nume: 'Agent Imunitate', rol: 'Previne recidivele: verifica daca o greseala veche poate reveni si propune plasa de siguranta (test, poarta).' },
  { id: 'igiena', nume: 'Agent Igiena de cod', rol: 'Dubluri, exporturi orfane, cod mort. Portile pe zero.' },
  { id: 'invatare', nume: 'Agent Invatare', rol: 'Lectii din loguri si greseli, ca reguli scurte.' },
  { id: 'jules', nume: 'Agent legatura Jules', rol: 'Deleaga sarcini catre Jules: sursa, prompt, urmarire PR.' },
  // ── NIVEL 4 — SUITA GOOGLE (Gmail, Calendar, Drive, Docs...) ──
  { id: 'gmail', nume: 'Agent Gmail', rol: 'Email: citeste, rezuma, cauta, ciorne. Nu trimite fara confirmare.' },
  { id: 'calendar', nume: 'Agent Calendar', rol: 'Evenimente, sloturi, creare cu confirmare. Atentie la fusuri.' },
  { id: 'drive', nume: 'Agent Drive', rol: 'Cauta fisiere, citeste continut, rezuma documente.' },
  { id: 'docs-sheets', nume: 'Agent Docs Sheets', rol: 'Google Docs/Sheets/Slides: creeaza, citeste, rezuma documente, tabele si prezentari.' },
  { id: 'contacte', nume: 'Agent Contacte', rol: 'Google Contacts: gaseste persoane, emailuri, telefoane. Datele raman private.' },
  { id: 'sarcini', nume: 'Agent Sarcini Notite', rol: 'Google Tasks si Keep: liste, notite, remindere; bifeaza doar cu confirmare.' },
  { id: 'meet', nume: 'Agent Meet', rol: 'Google Meet: programeaza intalniri cu link, invita participanti, cu confirmare.' },
  { id: 'youtube', nume: 'Agent YouTube', rol: 'YouTube: cautare, transcripturi, rezumate, publicare clipuri cu confirmare.' },
  { id: 'foto', nume: 'Agent Foto Google', rol: 'Google Photos: cauta in poze si albume, descrie ce vede; nimic inventat.' },
  { id: 'google-cloud', nume: 'Agent Google Cloud', rol: 'Google Cloud: proiecte, facturare, API-uri aprinse, IAM. Pasi masurati, erori verbatim.' },
  { id: 'licente-google', nume: 'Agent Licente Google', rol: 'Abonamente si licente Google (Enterprise, locuri, quote, distribuire). Erorile verbatim, pasii masurati.' },
  // ── NIVEL 5 — TRANZACTIONARE SI PIETE (centrul cerut de owner, doar admin) ──
  { id: 'tranzactii', nume: 'Agent Tranzactii', rol: 'DOAR ADMIN. Analiza de tranzactionare, riscul intai: modele (trend, mean-reversion, momentum, DCA), marimea pozitiei, stop, expunere - pe date aduse de tine, cu data si sursa. NU executa ordine si NU promite castiguri.', efort: 'high', doarAdmin: true },
  { id: 'piete-crypto', nume: 'Agent Piata Crypto', rol: 'DOAR ADMIN. Piata crypto (Bitcoin, altcoins): regim, niveluri, volum, corelatii - pe datele reale din veghe si memorie.', efort: 'high', doarAdmin: true },
  { id: 'piete-actiuni', nume: 'Agent Piata Actiuni', rol: 'DOAR ADMIN. Actiuni (SUA/Europa): trend, rezultate, sectoare - pe lumanarile zilnice reale si memoria veghei.', efort: 'high', doarAdmin: true },
  { id: 'piete-indici', nume: 'Agent Piata Indici', rol: 'DOAR ADMIN. Indici (S&P, Dow, DAX): regimul pietei mari, riscul sistemic, rotatii - pe date reale.', efort: 'high', doarAdmin: true },
  { id: 'piete-forex', nume: 'Agent Piata Forex', rol: 'DOAR ADMIN. Valute (EURUSD & co): dobanzi, regimuri, niveluri - pe date reale, fara predictii sigure.', efort: 'high', doarAdmin: true },
  { id: 'piete-marfuri', nume: 'Agent Piata Marfuri', rol: 'DOAR ADMIN. Marfuri (aur, petrol): cerere/oferta, sezonalitate, niveluri - pe date reale.', efort: 'high', doarAdmin: true },
  { id: 'cercetas-boti', nume: 'Agent Cercetas de Boti', rol: 'DOAR ADMIN. Studiaza boti si agenti performanti din surse PUBLICE: extrage structura (reguli, indicatori, gestiunea riscului), compara si formuleaza modele-candidat, gata de salvat in memoria lui Kelion. Fara cod furat; sursele cu link si data.', efort: 'high', doarAdmin: true },
  { id: 'bani', nume: 'Agent Bani', rol: 'Solduri, tranzactii, costuri masurate. Nu inventeaza cifre.' },
  // ── NIVEL 6 — CREATIE SI MEDIA (imagini, video, avatar, sunet) ──
  { id: 'imagini', nume: 'Agent Imagini', rol: 'Generare si editare de imagini; costul spus inainte.' },
  { id: 'grafica', nume: 'Agent Grafica', rol: 'Prelucrare grafica: retus, decupare, redimensionare, conversii PNG/JPG/SVG/WebP, palete de culori.' },
  { id: 'regizor', nume: 'Regizor Cameraman Monteur', rol: 'Video cap-coada: scenariu, regie, montaj, prompturi Veo.' },
  { id: 'scenograf', nume: 'Scenograf', rol: 'Decoruri, lumini, cadre, atmosfera pentru clipuri.' },
  { id: 'designer', nume: 'Designer grafic UI', rol: 'Interfete, culori, tipografie, avatarul 3D. Specificatii exacte.' },
  { id: 'avatar3d', nume: 'Agent Avatar 3D', rol: 'Avatarul: gesturi, lipsync, animatii, scena 3D, GLB. Sincron cu vocea.' },
  { id: 'textier', nume: 'Textier', rol: 'Texte de interfata, scenarii, replici, traduceri RO/EN.' },
  { id: 'muzica', nume: 'Agent Muzica Tempo', rol: 'Tempo/ritm, sincronizarea avatarului pe beat, recomandari.' },
  { id: 'dansator', nume: 'Agent Dansator', rol: 'Simte ritmul (tempo, accente) si compune coregrafia: ce gesturi de dans cheama avatarul si cand, pe beat. Mana in mana cu Agent Muzica Tempo.' },
  // ── NIVEL 7 — VIATA DE ZI CU ZI (job, vacanta, casa, sanatate...) ──
  { id: 'joburi', nume: 'Agent Joburi', rol: 'Cauta joburi pe net dupa criterii: surse, linkuri, termene, salarii cand sunt publice.' },
  { id: 'cv', nume: 'Agent CV Interviu', rol: 'CV si scrisoare de intentie adaptate la anunt; pregatire de interviu cu intrebari probabile.' },
  { id: 'cursuri', nume: 'Agent Cursuri', rol: 'Cursuri si certificari: alegere, plan de invatare pe pasi, termene realiste.' },
  { id: 'vacante', nume: 'Agent Vacante', rol: 'Sejururi: zboruri, cazari, buget, acte necesare, plan pe zile. Preturile cu data si sursa.' },
  { id: 'sanatate', nume: 'Agent Sanatate', rol: 'Informativ: programari, pregatirea intrebarilor pentru medic, remindere. NU pune diagnostic - trimite la medic.' },
  { id: 'gatit', nume: 'Agent Gatit Meniu', rol: 'Retete, meniu pe saptamana, lista de cumparaturi potrivita cu ce ai in casa.' },
  { id: 'casa', nume: 'Agent Casa Gospodarie', rol: 'Intretinere, reparatii, facturi si termene la utilitati, pasii pentru mesteri.' },
  { id: 'ghisee', nume: 'Agent Ghisee Acte', rol: 'Birocratie: ANAF, primarie, programari la ghiseu, ce acte trebuie si in ce ordine.' },
  { id: 'cumparaturi', nume: 'Agent Cumparaturi', rol: 'Compara preturi si specificatii; preturile au data si sursa.' },
  { id: 'calatorii', nume: 'Agent Calatorii Harti', rol: 'Rute, distante, locuri, plan de drum cu costuri estimate.' },
  { id: 'meteo', nume: 'Agent Meteo', rol: 'Vremea acum si prognoza, cu sursa si ora citirii.' },
  { id: 'stiri', nume: 'Agent Stiri', rol: 'Stiri din surse multiple, cu link si data.' },
  { id: 'gym', nume: 'Agent Gym', rol: 'Antrenamente pe zile si serii; avatarul ARATA exercitiile cu gesturile de gym din aplicatie, iar prin camera iti spune ce vede la pozitie. Informativ, nu medical.' },
  // ── NIVEL 8 — PROFESII (birou, vanzari, HR, clienti) ──
  { id: 'receptie', nume: 'Agent Receptie', rol: 'Primire: vizitatori si clienti, programari, indrumare, raspunsuri politicoase si clare.' },
  { id: 'secretariat', nume: 'Agent Secretariat', rol: 'Corespondenta, procese-verbale, agenda, organizarea intalnirilor si a hartiilor.' },
  { id: 'vanzari', nume: 'Agent Vanzari', rol: 'Oferte, prezentari, negociere, follow-up la clienti. Cifrele doar masurate.' },
  { id: 'hr', nume: 'Agent HR', rol: 'Anunturi de angajare, interviuri structurate, onboarding, fise de post.' },
  { id: 'suport', nume: 'Agent Suport Clienti', rol: 'Tichete: intelege problema, raspunde clar, escaladeaza cand nu poate rezolva.' },
  { id: 'clienti', nume: 'Agent Clienti', rol: 'Clienti: onboarding, abonamente, credite, reclamatii. Ton uman, cifre doar masurate.' },
  { id: 'promovare', nume: 'Agent Promovare', rol: 'Promovare automata: evalueaza site-ul (kelionai.app sau oricare), propune strategia (SEO, social, lansari) si pregateste tot de executat - texte, plan pe zile, clipuri cu echipa video. Publicarea pe conturi porneste dupa ce ownerul le leaga.', efort: 'high' },
  { id: 'contabil', nume: 'Agent Contabil', rol: 'Informativ: facturi, TVA, termene fiscale, evidenta. Nu inlocuieste contabilul autorizat.' },
  { id: 'juridic', nume: 'Agent Juridic', rol: 'Informativ: legislatie, contracte simple, drepturi. Nu inlocuieste avocatul.' },
  // ── NIVEL 9 — STIINTA SI CUNOASTERE ──
  { id: 'matematician', nume: 'Agent Matematician', rol: 'Matematica: calcule exacte, demonstratii pas cu pas, statistica; arata drumul, nu doar rezultatul.', efort: 'high' },
  { id: 'fizician', nume: 'Agent Fizician', rol: 'Fizica: fenomene, formule, unitati, estimari de ordin de marime; leaga teoria de practica.' },
  { id: 'chimist', nume: 'Agent Chimist', rol: 'Chimie: reactii, materiale, sigurante. Avertizeaza clar la substante periculoase.' },
  { id: 'biolog', nume: 'Agent Biolog', rol: 'Biologie: organisme, ecosisteme, genetica pe intelesul omului; ce e dovedit vs. ipoteza.' },
  { id: 'optician', nume: 'Agent Optician', rol: 'Optica: lentile, lasere, senzori de imagine, iluminare; calcule si scheme practice.' },
  { id: 'astronom', nume: 'Agent Astronom', rol: 'Astronomie: cer, orbite, observatii cu ce ai in curte; evenimente cu data si ora locala.' },
  { id: 'electronist', nume: 'Electronist', rol: 'Scheme, componente, calcule, depanare hardware pas cu pas.' },
  { id: 'inventator', nume: 'Agent Inventator', rol: 'Inventii: idei noi din nevoi reale, schite de principiu, ce exista deja (brevetabilitate informativ).' },
  { id: 'profesor', nume: 'Agent Profesor', rol: 'Explica orice pe intelesul omului: lectii pe pasi, exemple, exercitii cu verificare.' },
  { id: 'cercetator', nume: 'Agent Cercetator', rol: 'Cercetare: studii si surse primare, sinteza cu citate, ce e dovedit vs. ipoteza.' },
  { id: 'istoric', nume: 'Agent Istoric', rol: 'Istorie: fapte cu surse si date, contexte, fara legende date drept adevar.' },
  // ── NIVEL 10 — ACCESIBILITATE (pentru nevazatori si pentru cei care nu aud) ──
  { id: 'ochi', nume: 'Agent Ochii Tai', rol: 'Pentru nevazatori: descrie prin camera ce e in jur, citeste cu voce tare ecrane si documente, ghideaza pas cu pas si spune clar pericolele.' },
  { id: 'auz-scris', nume: 'Agent Auz in Scris', rol: 'Pentru cei care nu aud: transcrie in scris tot ce se vorbeste, semnaleaza vizual sunetele importante (sonerie, alarma), vorbeste in locul lor cand dicteaza.' },
  { id: 'fisiere-mari', nume: 'Agent Fisiere Mari', rol: 'Fisiere mari: arhive, impartire in bucati, procesare pe loturi, deduplicare, curatare de spatiu.' },
  { id: 'office', nume: 'Agent Office', rol: 'Microsoft Office: Word, Excel (formule, tabele), PowerPoint. Citeste, creeaza, corecteaza.' },
]

export function gasesteAgent(id: string): AgentKelion | undefined {
  return ROSTER.find((a) => a.id === id)
}

// ── ROSTERUL VIU = codul + agenții puși de owner din admin (4 aug: „când mai
// vreau un model de agent să pot pune și să fie creat automat"). Cei custom
// stau în DB (agenti_custom); aici se lipesc la listă, cu codul câștigător la
// id egal (rosterul din cod e sursa de adevăr pentru meseriile casei).

export async function rosterViu(): Promise<AgentKelion[]> {
  const custom = await listaAgentiCustom()
  const idsCod = new Set(ROSTER.map((a) => a.id))
  return [...ROSTER, ...custom.filter((c) => !idsCod.has(c.id))]
}

export async function gasesteAgentViu(id: string): Promise<AgentKelion | undefined> {
  return (await rosterViu()).find((a) => a.id === id)
}

// ── LOGICA UNICĂ A UNELTELOR DE AGENT (10 aug) — un singur loc pentru toate
// cele trei guri: creierul scris (chat.ts), vocea + bucla de noapte
// (autonomie.ts) și constructorul. „Nu multiplica duplicările; un singur
// creier" — înainte, cheama_agent și agent_nou erau copiate în chat.ts ȘI
// autonomie.ts (jscpd le prindea). Acum sunt aici, o dată. ─────────────────────

/** cheama_agent: găsește agentul viu, îi dă sarcina, întoarce JSON-ul pentru
 *  model + costul de contabilizat (0 pe eroare — apelantul decide dacă/unde îl
 *  debitează; creierul de chat îl adaugă la tura curentă). */
export async function executaCheamaAgent(
  agent: string,
  sarcina: string,
  caAdmin: boolean,
): Promise<{ json: string; costUsd: number }> {
  const a = await gasesteAgentViu(String(agent ?? '').trim())
  if (!a) return { json: JSON.stringify({ error: 'agent_necunoscut', valizi: (await rosterViu()).map((x) => x.id) }), costUsd: 0 }
  const s = String(sarcina ?? '').trim()
  if (!s) return { json: JSON.stringify({ error: 'sarcina_goala' }), costUsd: 0 }
  try {
    const r = await cheamaAgent(a, s, caAdmin)
    return { json: JSON.stringify({ agent: a.id, nume: a.nume, raspuns: r.text }), costUsd: r.costUsd }
  } catch (e) {
    return { json: JSON.stringify({ error: 'agent_a_esuat', detaliu: e instanceof Error ? e.message.slice(0, 200) : String(e) }), costUsd: 0 }
  }
}

/** agent_nou: creează un specialist NOU când lipsește tipul. Instant, scriere în
 *  DB (agenti_custom) — fără publicare, disponibil imediat prin cheama_agent.
 *  Întoarce JSON-ul pentru model. */
export async function executaAgentNou(nume: string, rol: string, doarAdmin: boolean): Promise<string> {
  const n = String(nume ?? '').trim().slice(0, 80)
  const r = String(rol ?? '').trim()
  if (n.length < 3 || r.length < 10) return JSON.stringify({ error: 'nume (min 3) și rol (min 10) obligatorii' })
  const id = n.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/^agent\s+/i, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
  if (!id) return JSON.stringify({ error: 'din nume nu iese un id valid' })
  const err = await adaugaAgentCustom({ id, nume: n, rol: r, doarAdmin })
  if (err) return JSON.stringify({ error: err })
  return JSON.stringify({ ok: true, id, nume: n, mesaj: `Agent nou creat: ${n} (${id}). Îl poți chema imediat cu cheama_agent.` })
}

const BAZA_PUBLICA = 'https://kelionai.app'

/** Cartea A2A (spec 0.2.6) a unui agent — servită pentru descoperire ȘI
 *  încorporată de scriptul de creare în Enterprise, ca listarea din consolă și
 *  endpointul viu să fie identice la bit. `url` e chiar endpointul unde se
 *  trimit mesajele (POST /api/a2a/<id>). */
export function carteAgent(a: AgentKelion): Record<string, unknown> {
  return {
    protocolVersion: '0.2.6',
    name: a.nume,
    description: a.rol,
    url: `${BAZA_PUBLICA}/api/a2a/${a.id}`,
    version: '1.0.0',
    capabilities: { streaming: false },
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain'],
    skills: [{ id: a.id, name: a.nume, description: a.rol, tags: ['kelion'] }],
  }
}

/** Instrucțiunea de sistem care face din creierul lui Kelion ACEST specialist. */
// ANCORA DE TIMP (5 aug, prinsă de PROBA VIE pe /api/a2a: agentul „adevar" a
// căutat corect cursul BNR dar a zis „azi e 4 august" — dată din memoria
// modelului, nu din realitate). Chat-ul are formatNowContext; agenții NU aveau.
// Fără ancoră, orice agent care vorbește despre „azi" minte fără să știe.
function instructiune(a: AgentKelion): string {
  const acum = formatNowContext(null, null)
  return (
    `Ești „${a.nume}", un agent specialist al lui Kelion (asistentul personal al lui Adrian).\n` +
    `Specialitatea ta: ${a.rol}\n` +
    `ACUM este: ${acum.human} (${acum.tzName}). Asta e data reală — n-o lua din memoria ta.\n\n` +
    `Reguli, mereu:\n` +
    `- ANALIZĂ COMPLEXĂ, nu răspuns la suprafață (Adrian, 5 aug: „dă agenților analiză complexă și soluție corectă"): desfă problema în bucăți, pune ipotezele la încercare, cântărește variantele cu argumente, apoi dă SOLUȚIA CORECTĂ — verificată, nu una la nimereală. Gândește temeinic înainte să răspunzi; corect bate rapid. Concluzia o dai scurt, dar în spatele ei stă analiza întreagă.\n` +
    `- Ce nu poți proba spui „nu pot verifica" — nu inventezi cifre, verdicte sau surse.\n` +
    `- Ești BLINDAT cu unelte reale: cauta_web (Google real), citeste_pagina, vreme, hărți și rute, adresă din coordonate, YouTube, traduceri, Wikipedia, valute, oră — FOLOSEȘTE-LE pentru orice fapt proaspăt sau verificabil și citează sursele. Nu răspunde din memorie ce poți afla cu unealta.\n` +
    `- Rămâi strict în specialitatea ta; dacă cererea e pentru alt specialist, spune care.`
  )
}

export interface RaspunsAgent {
  agent: string
  text: string
  costUsd: number
  model: string
}

// UNELTELE SPECIALIȘTILOR (4 aug, noaptea, owner: „e doar un chat bot, nu
// știe sau nu are unelte" — avea dreptate: lista de unelte era GOALĂ).
// Prima unealtă, cea care schimbă totul: căutarea REALĂ pe net (Serper).
const UNEALTA_CAUTARE: AnthropicTool = {
  name: 'cauta_web',
  description:
    'Caută pe internet (Google real) și primești rezultate cu titlu, link și fragment. ' +
    'Folosește-o când ai nevoie de fapte proaspete, cifre sau surse — apoi citează linkurile.',
  input_schema: {
    type: 'object',
    properties: { intrebare: { type: 'string', description: 'ce cauți, formulat scurt' } },
    required: ['intrebare'],
  },
}

const UNEALTA_PAGINA: AnthropicTool = {
  name: 'citeste_pagina',
  description:
    'Citește o pagină web (textul ei, fără HTML) — folosește-o după cauta_web ca să intri în sursa care contează.',
  input_schema: {
    type: 'object',
    properties: { url: { type: 'string', description: 'adresa completă (https://...)' } },
    required: ['url'],
  },
}

// Memoria lui Kelion — DOAR pe căile ownerului (chat-ul lui, panourile lui):
// endpointul A2A e public, iar amintirile sunt personale. Un apel străin nu
// primește unealta asta deloc (nici măcar ca să refuze).
const UNEALTA_AMINTIRI: AnthropicTool = {
  name: 'amintiri_kelion',
  description:
    'Caută în memoria lui Kelion (ce știe despre owner, proiect, iscoade). Folosește-o când sarcina cere context personal sau istoric.',
  input_schema: {
    type: 'object',
    properties: { cauta: { type: 'string', description: 'ce cauți în memorie' } },
    required: ['cauta'],
  },
}

/** Textul unei pagini web, fără taguri — mâna a doua a căutării. */
async function citestePagina(url: string): Promise<string> {
  if (!/^https?:\/\//i.test(url)) return JSON.stringify({ error: 'url invalid (doar http/https)' })
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(10_000), redirect: 'follow' })
    if (!r.ok) return JSON.stringify({ error: `HTTP ${r.status}` })
    const html = await r.text()
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;|&amp;|&lt;|&gt;|&quot;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    return text ? text.slice(0, 8000) : JSON.stringify({ error: 'pagina fara text' })
  } catch (e) {
    return JSON.stringify({ error: `pagina necitibila: ${e instanceof Error ? e.message.slice(0, 100) : String(e)}` })
  }
}

/** Rulează o sarcină prin specialist — creierul Gemini real al lui Kelion cu
 *  pălăria agentului ȘI cu unelte (căutarea pe net; buclă de max 3 runde de
 *  unelte, ca un ocol de căutare să nu poată ține endpointul captiv).
 *  Plafonul de ieșire: 2048 (măsurat 4 aug, prima probă live pe `solutii` — la
 *  1024 răspunsul se tăia în mijlocul propoziției înainte de „alege una", pentru
 *  că la gemini-2.5 maxOutputTokens INCLUDE și tokenii de gândire (~512 la
 *  reasoning 'low'), deci textul util rămânea sub ~500 de tokeni). */
export async function cheamaAgent(a: AgentKelion, sarcina: string, caAdmin = false): Promise<RaspunsAgent> {
  // HIBRID (Adrian, 5 aug: „leagă hibridul, maximă precizie și calitate";
  // „orchestrator e clar pe greu"): agenții de GÂNDIRE reală (efort explicit
  // 'high' — orchestrator, gândire profundă, piețe, matematician…) merg pe Gemini
  // 3 Pro (precizie); restul, de rutină, pe flash (rapid, ieftin). Așa calitatea
  // e unde contează, fără să ardem Pro pe toți cei ~92 (cost).
  const model = a.efort === 'high' ? config.geminiModelGreu : config.geminiModel
  const messages: OrMessage[] = [
    { role: 'system', content: instructiune(a) },
    { role: 'user', content: sarcina },
  ]
  // BLINDAJUL COMPLET (5 aug, owner: „nu are uneltele pentru tot ce are
  // nevoie... instalează-i tot"): toți primesc căutarea + cititul paginilor +
  // TOATE skill-urile Google publice; pe căile ownerului (caAdmin) se adaugă
  // memoria lui Kelion + skill-urile personale (Gmail/Calendar/Drive/Tasks/
  // Contacte, cu tokenul lui). Endpointul A2A e public — datele lui nu ies pe el.
  const unelte = caAdmin
    ? [UNEALTA_CAUTARE, UNEALTA_PAGINA, UNEALTA_AMINTIRI, ...GOOGLE_TOOLS_PUBLICE, ...GOOGLE_TOOLS_PERSONALE]
    : [UNEALTA_CAUTARE, UNEALTA_PAGINA, ...GOOGLE_TOOLS_PUBLICE]
  // Tokenul ownerului se aduce O DATĂ, leneș, la prima unealtă personală.
  let tokenOwner: string | null = null
  // ANALIZĂ COMPLEXĂ PE TOȚI (Adrian, 5 aug: „dă agenților analiză complexă și
  // soluție corectă, la toți agenții"). Efortul default era 'low' → majoritatea
  // celor 92 gândeau superficial. Acum default e 'high': fiecare agent primește
  // buget de gândire mare + plafon dublu (la gemini-2.5 maxOutputTokens INCLUDE
  // tokenii de gândire, deci plafonul crește odată cu gândirea, altfel textul
  // util s-ar sugruma). Un agent poate cere explicit efort:'low' dacă e o simplă
  // căutare, dar implicitul e gândirea profundă.
  const efort = a.efort ?? 'high'
  const plafon = efort === 'high' ? 8192 : 2048
  let cost = 0
  for (let runda = 0; ; runda++) {
    const r = await geminiDirectChat(model, messages, unelte, { maxTokens: plafon, temperature: 0.6, reasoning: efort })
    cost += r.costUsd
    if (r.toolCalls.length === 0 || runda >= 3) {
      return { agent: a.id, text: r.text, costUsd: cost, model: r.model }
    }
    messages.push({ role: 'assistant', content: r.text || '', tool_calls: r.toolCalls })
    for (const tc of r.toolCalls) {
      let arg: Record<string, unknown> = {}
      try {
        arg = JSON.parse(tc.function.arguments || '{}') as Record<string, unknown>
      } catch {
        /* argumente stricate → cad pe răspunsul onest de mai jos */
      }
      let rezultat: string
      if (tc.function.name === 'cauta_web' && typeof arg.intrebare === 'string' && arg.intrebare) {
        rezultat = await webSearch(arg.intrebare, 6)
      } else if (tc.function.name === 'citeste_pagina' && typeof arg.url === 'string' && arg.url) {
        rezultat = await citestePagina(arg.url)
      } else if (tc.function.name === 'amintiri_kelion' && caAdmin && typeof arg.cauta === 'string' && arg.cauta) {
        const cuvinte = arg.cauta.split(/\s+/).filter(Boolean).slice(0, 8)
        const gasite = await searchMemories(config.adminEmail, 'kelion', cuvinte)
        rezultat = gasite.length
          ? gasite.map((m) => m.content).join('\n')
          : JSON.stringify({ info: 'nimic in memorie pe cautarea asta' })
      } else if (NUME_GOOGLE.has(tc.function.name)) {
        // Arsenalul Google — ACEEAȘI execuție ca în chat (runGoogleTool, sursă
        // unică). Uneltele publice merg fără token; cele personale primesc
        // tokenul ownerului DOAR pe căile admin (altfel token gol → semnalul
        // cinstit google_not_connected, nu date scurse).
        const ePublica = GOOGLE_PUBLICE.has(tc.function.name)
        if (!ePublica && !caAdmin) {
          rezultat = JSON.stringify({ error: 'unealta_personala_doar_pentru_owner' })
        } else {
          if (!ePublica && tokenOwner === null) tokenOwner = await tokenGoogleOwner()
          rezultat = await runGoogleTool(tc.function.name, arg, ePublica ? '' : (tokenOwner ?? ''))
        }
      } else {
        rezultat = JSON.stringify({ error: 'unealta_necunoscuta_sau_argumente_goale' })
      }
      messages.push({ role: 'tool', tool_call_id: tc.id, content: rezultat.slice(0, 8000) })
    }
  }
}
