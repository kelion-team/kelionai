import { config } from '../config.js'
import { formatNowContext } from './timeContext.js'
import { listaAgentiCustom, searchMemories, getGoogleRefreshToken, adaugaAgentCustom } from '../db.js'
import { rationeazaMesaje } from './creierRationament.js'
import { webSearch, googleTools, runGoogleTool, refreshGoogleAccessToken } from './google.js'
// adminTools se aduce DINAMIC la execuție (jos, în ramura măsurătorilor):
// importul static ar închide ciclul agentiKelion → adminTools → autonomie →
// brainToolDefs → agentiKelion și ROSTER ar fi undefined la încărcare.
import {
  clasificaRezultatUnealta,
  pretentiiFaraFapta,
  textulDemascarii,
  unelteCuSucces,
  type DovadaUnealta,
} from './poartaFaptelor.js'
import type { OrMessage, BrainTool } from './brainContract.js'

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
const caBrainTool = (t: { name: string; description?: string; input_schema: unknown }): BrainTool => ({
  name: t.name,
  description: t.description ?? '',
  input_schema: t.input_schema as Record<string, unknown>,
})
const GOOGLE_TOOLS_PUBLICE: BrainTool[] = googleTools.filter((t) => GOOGLE_PUBLICE.has(t.name)).map(caBrainTool)
const GOOGLE_TOOLS_PERSONALE: BrainTool[] = googleTools
  .filter((t) => !GOOGLE_PUBLICE.has(t.name) && t.name !== 'web_search')
  .map(caBrainTool)
const NUME_GOOGLE = new Set(googleTools.map((t) => t.name))

/** Tokenul Google al ownerului — DOAR pe căile admin, pentru uneltele personale.
 *  Lipsă/expirat → runGoogleTool întoarce semnalul cinstit google_not_connected.
 *  Exportat: refolosit de autoverificarea LIVE (probează uneltele Google real). */
export async function tokenGoogleOwner(): Promise<string> {
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
// Agenții sunt implementați în creierul lui Kelion, fiecare purtând pălăria
// unui specialist și servit la
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
  { id: 'regizor', nume: 'Regizor Cameraman Monteur', rol: 'Video cap-coada: scenariu, regie, montaj și prompturi pentru generatorul configurat.' },
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
  { id: 'promovare', nume: 'Agent Promovare', rol: `Promovare: evalueaza site-ul (${new URL(config.publicOrigin).hostname} sau altul), propune strategia (SEO, social, lansari) si pregateste texte, planuri si clipuri. Publicarea pe conturi porneste numai dupa conectarea si confirmarea lor.`, efort: 'high' },
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
  userEmail = 'system',
): Promise<{ json: string; costUsd?: number }> {
  const a = await gasesteAgentViu(String(agent ?? '').trim())
  if (!a) return { json: JSON.stringify({ error: 'agent_necunoscut', valizi: (await rosterViu()).map((x) => x.id) }) }
  const s = String(sarcina ?? '').trim()
  if (!s) return { json: JSON.stringify({ error: 'sarcina_goala' }) }
  try {
    const r = await cheamaAgent(a, s, caAdmin, userEmail)
    // DOVADA la vedere (owner, 16 aug: „aduci dovezi ca ai facut"): creierul
    // mare primește NEGRU PE ALB ce unelte a executat agentul — pe listă goală
    // știe că răspunsul e vorbă nemăsurată și nu-l vinde drept verificare.
    return {
      json: JSON.stringify({
        agent: a.id,
        nume: a.nume,
        raspuns: r.text,
        unelte_executate: r.unelteExecutate,
        dovezi_unelte: r.doveziUnelte,
      }),
      costUsd: r.costUsd,
    }
  } catch (e) {
    return { json: JSON.stringify({ error: 'agent_a_esuat', detaliu: e instanceof Error ? e.message.slice(0, 200) : String(e) }) }
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

const BAZA_PUBLICA = config.publicOrigin

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
function instructiune(a: AgentKelion, caAdmin: boolean): string {
  const acum = formatNowContext(null, null)
  return (
    `Ești „${a.nume}", un agent specialist al asistentului Kelion.\n` +
    `Specialitatea ta: ${a.rol}\n` +
    `ACUM este: ${acum.human} (${acum.tzName}). Asta e data reală — n-o lua din memoria ta.\n\n` +
    `Reguli, mereu:\n` +
    `- ANALIZĂ COMPLEXĂ, nu răspuns la suprafață (Adrian, 5 aug: „dă agenților analiză complexă și soluție corectă"): desfă problema în bucăți, pune ipotezele la încercare, cântărește variantele cu argumente, apoi dă SOLUȚIA CORECTĂ — verificată, nu una la nimereală. Gândește temeinic înainte să răspunzi; corect bate rapid. Concluzia o dai scurt, dar în spatele ei stă analiza întreagă.\n` +
    `- Ce nu poți proba spui „nu pot verifica" — nu inventezi cifre, verdicte sau surse.\n` +
    `- Ai unelte reale pentru căutare, vreme, hărți și rute, adresă din coordonate, YouTube, traduceri, Wikipedia, valute și oră. Folosește-le pentru fapte proaspete sau verificabile și citează numai sursele întoarse de unealtă.\n` +
    `- LEGEA UNELTEI PE JOB: când faci o verificare, folosești unealta necesară. ${caAdmin ? 'Starea aplicației se verifică numai prin uneltele de observabilitate oferite explicit; codul și porțile rulează exclusiv în workerul Constructor separat. ' : ''}Faptele de pe net se verifică prin cauta_web. Uneltele executate intră în jurnalul dovezii, iar o pretenție fără dovadă este marcată ca neverificată.\n` +
    `- Rămâi strict în specialitatea ta; dacă cererea e pentru alt specialist, spune care.`
  )
}

export interface RaspunsAgent {
  agent: string
  text: string
  costUsd?: number
  model: string
  /** DOVADA (owner, 16 aug: „aduci dovezi ca ai facut"): uneltele chiar
   *  REUȘITE de agent în rularea asta — jurnalul pe care se judecă vorbele. */
  unelteExecutate: string[]
  /** Și tentativele eșuate/blocate, ca apelantul să nu piardă motivul real. */
  doveziUnelte: DovadaUnealta[]
}

// UNELTELE SPECIALIȘTILOR (4 aug, noaptea, owner: „e doar un chat bot, nu
// știe sau nu are unelte" — avea dreptate: lista de unelte era GOALĂ).
// Prima unealtă, cea care schimbă totul: căutarea REALĂ pe net (Serper).
const UNEALTA_CAUTARE: BrainTool = {
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

// Memoria lui Kelion — DOAR pe căile ownerului (chat-ul lui, panourile lui):
// endpointul A2A e public, iar amintirile sunt personale. Un apel străin nu
// primește unealta asta deloc (nici măcar ca să refuze).
const UNEALTA_AMINTIRI: BrainTool = {
  name: 'amintiri_kelion',
  description:
    'Caută în memoria lui Kelion (ce știe despre owner, proiect, iscoade). Folosește-o când sarcina cere context personal sau istoric.',
  input_schema: {
    type: 'object',
    properties: { cauta: { type: 'string', description: 'ce cauți în memorie' } },
    required: ['cauta'],
  },
}

// ── UNELTELE DE VERIFICARE — MĂSURĂTORILE REALE (owner, 16 aug, verbatim:
// „Orice agent din cei 91, trebuie cind face verificari trebuie sa foloseasca
// unealta necesara jobului alocat, sau daca e cazul mai multe unelte" + „nu te
// misti pina fiecare agent primeste uneltele real, nu doar text"). Până azi,
// agenții de întreținere (monitor, debug, doctor-kelion, igienă, adevăr, vps,
// deploy) puteau DOAR să povestească despre sistem — n-aveau nicio unealtă de
// măsurare, deci „verificarea" lor era fabulație cu ton tehnic. DOAR pe căile
// ownerului (caAdmin): sunt unelte de operare, nu ies pe endpointul public A2A.
// (Definițiile sunt scrise aici pe scurt, pentru agenți — cele complete ale
// creierului stau în brainToolDefs.ts, care importă din fișierul ăsta, deci
// importul invers ar face ciclu.)
const UNELTE_MASURARE: BrainTool[] = [
  { name: 'stare_masurata', description: 'Starea REALĂ a aplicației, măsurată ACUM pe server (versiune, becuri, sănătate). La ORICE verificare de sistem pornești de aici — nu povesti starea din memorie.', input_schema: { type: 'object', properties: {} } },
  { name: 'server_logs', description: 'Logurile REALE ale serverului. Pentru diagnostic: citește-le, nu presupune.', input_schema: { type: 'object', properties: { limit: { type: 'number', description: 'câte rânduri (implicit 60)' }, errorsOnly: { type: 'boolean', description: 'doar erori' } } } },
  { name: 'client_errors', description: 'Erorile REALE din browserele utilizatorilor (F12), adunate pe server. Pentru verificări de interfață.', input_schema: { type: 'object', properties: { hours: { type: 'number', description: 'fereastra în ore (implicit 24)' }, limit: { type: 'number' } } } },
]
const NUME_MASURARE = new Set(UNELTE_MASURARE.map((t) => t.name))

/** Rulează o sarcină prin specialist — creierul OpenAI real al lui Kelion cu
 *  pălăria agentului ȘI cu unelte (căutarea pe net; buclă de max 3 runde de
 *  unelte, ca un ocol de căutare să nu poată ține endpointul captiv).
 *  Plafonul de ieșire: 2048 (măsurat 4 aug, prima probă live pe `solutii` — la
 *  1024 răspunsul se tăia în mijlocul propoziției înainte de „alege una", pentru
 *  a păstra răspunsul complet. */
export async function cheamaAgent(a: AgentKelion, sarcina: string, caAdmin = false, userEmail = 'system'): Promise<RaspunsAgent> {
  // HIBRID (Adrian, 5 aug: „leagă hibridul, maximă precizie și calitate";
  // „orchestrator e clar pe greu"): agenții de GÂNDIRE reală (efort explicit
  // Sol pentru specialiștii de analiză, Luna pentru sarcinile de rutină.
  const model = `openai/${a.efort === 'high' ? config.openai.heavy : config.openai.luna}`
  const messages: OrMessage[] = [
    { role: 'system', content: instructiune(a, caAdmin) },
    { role: 'user', content: sarcina },
  ]
  // BLINDAJUL COMPLET (5 aug, owner: „nu are uneltele pentru tot ce are
  // nevoie... instalează-i tot"): toți primesc căutarea și skill-urile Google
  // publice; pe căile ownerului (caAdmin) se adaugă
  // memoria lui Kelion + skill-urile personale (Gmail/Calendar/Drive/Tasks/
  // Contacte, cu tokenul lui). Endpointul A2A e public — datele lui nu ies pe el.
  const unelte = caAdmin
    ? [UNEALTA_CAUTARE, UNEALTA_AMINTIRI, ...GOOGLE_TOOLS_PUBLICE, ...GOOGLE_TOOLS_PERSONALE, ...UNELTE_MASURARE]
    : [UNEALTA_CAUTARE, ...GOOGLE_TOOLS_PUBLICE]
  // Fiecare intrare în jurnal arată rezultatul real. Un apel refuzat sau cu
  // eroare rămâne în dovezi, dar nu poate satisface poarta faptelor.
  const doveziUnelte: DovadaUnealta[] = []
  // Tokenul ownerului se aduce O DATĂ, leneș, la prima unealtă personală.
  let tokenOwner: string | null = null
  // ANALIZĂ COMPLEXĂ PE TOȚI (Adrian, 5 aug: „dă agenților analiză complexă și
  // soluție corectă, la toți agenții"). Efortul default era 'low' → majoritatea
  // celor 92 gândeau superficial. Acum default e 'high': fiecare agent primește
  // buget de gândire mare + plafon dublu. Un agent poate cere explicit efort:'low' dacă e o simplă
  // căutare, dar implicitul e gândirea profundă.
  const efort = a.efort ?? 'high'
  const plafon = efort === 'high' ? 8192 : 2048
  let cost: number | undefined
  for (let runda = 0; ; runda++) {
    const r = await rationeazaMesaje(messages, {
      ruta: 'service.agentiKelion', model, maxTokens: plafon, temperature: 0.6,
      reasoning: efort, treapta: 'lucru', tools: unelte,
      usageContext: { userEmail, surface: `agent:${a.id}` },
    })
    if (typeof r.costUsd === 'number') cost = (cost ?? 0) + r.costUsd
    if (r.toolCalls.length === 0 || runda >= 3) {
      // POARTA FAPTELOR ȘI PE AGENT (owner, 16 aug: „kelion zice ca face el
      // dar nu intreprinde nimic... aduci dovezi ca ai facut"): vorbele
      // agentului se judecă pe JURNALUL LUI de unelte, exact ca la creierul
      // mare. Pretenția nedovedită pleacă spre apelant DEMASCATĂ, nu curată.
      const nedovedite = pretentiiFaraFapta(r.text, doveziUnelte)
      const text = nedovedite.length ? r.text + textulDemascarii(nedovedite) : r.text
      if (nedovedite.length) console.error(`[POARTA FAPTELOR][agent ${a.id}] pretenții fără faptă: ${nedovedite.join('; ')}`)
      return {
        agent: a.id,
        text,
        ...(typeof cost === 'number' ? { costUsd: cost } : {}),
        model: r.model,
        unelteExecutate: unelteCuSucces(doveziUnelte),
        doveziUnelte,
      }
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
      } else if (NUME_MASURARE.has(tc.function.name) && caAdmin) {
        // MĂSURĂTORILE — aceiași executori ca la creierul mare (sursă unică:
        // adminTools), pe legitimația ownerului (agenții pe căile lui admin).
        const { execSharedAdminTool, execUserScopedTool } = await import('./adminTools.js')
        if (tc.function.name === 'server_logs' || tc.function.name === 'client_errors') {
          rezultat = (await execUserScopedTool(tc.function.name, arg, userEmail, true)) ?? JSON.stringify({ error: 'unealta_indisponibila' })
        } else {
          rezultat = (await execSharedAdminTool(tc.function.name, arg, { email: userEmail })) ?? JSON.stringify({ error: 'unealta_indisponibila' })
        }
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
      doveziUnelte.push(clasificaRezultatUnealta(tc.function.name, rezultat))
      messages.push({ role: 'tool', tool_call_id: tc.id, content: rezultat.slice(0, 8000) })
    }
  }
}
