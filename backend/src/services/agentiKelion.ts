import { config } from '../config.js'
import { geminiDirectChat } from './geminiDirect.js'
import type { OrMessage } from './brainContract.js'

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
}

export const ROSTER: AgentKelion[] = [
  { id: 'inginer-sef', nume: 'Inginer-sef', rol: 'Orchestreaza: sparge cererea in pasi si deleaga agentului potrivit.' },
  { id: 'debug', nume: 'Depanator avansat', rol: 'Debugging: loguri, reproducere, modulul vinovat, fix minim.' },
  { id: 'senzorial', nume: 'Vaz Auz Memorie Gandire', rol: 'Gestioneaza vederea, auzul, memoria si gandirea lui Kelion.' },
  { id: 'adevar', nume: 'Paznicul adevarului', rol: 'Anti-fabulatie: ce nu se poate proba = nu pot verifica.' },
  { id: 'cautator', nume: 'Cautator pe net', rol: 'Cautare web: surse multiple, citate, linkuri.' },
  { id: 'solutii', nume: 'Designer de solutii', rol: 'Arhitect: 2-3 solutii cu compromisuri, alege una, o desface in pasi.' },
  { id: 'electronist', nume: 'Electronist', rol: 'Scheme, componente, calcule, depanare hardware pas cu pas.' },
  { id: 'designer', nume: 'Designer grafic UI', rol: 'Interfete, culori, tipografie, avatarul 3D. Specificatii exacte.' },
  { id: 'scenograf', nume: 'Scenograf', rol: 'Decoruri, lumini, cadre, atmosfera pentru clipuri.' },
  { id: 'textier', nume: 'Textier', rol: 'Texte de interfata, scenarii, replici, traduceri RO/EN.' },
  { id: 'regizor', nume: 'Regizor Cameraman Monteur', rol: 'Video cap-coada: scenariu, regie, montaj, prompturi Veo.' },
  { id: 'gmail', nume: 'Agent Gmail', rol: 'Email: citeste, rezuma, cauta, ciorne. Nu trimite fara confirmare.' },
  { id: 'calendar', nume: 'Agent Calendar', rol: 'Evenimente, sloturi, creare cu confirmare. Atentie la fusuri.' },
  { id: 'drive', nume: 'Agent Drive', rol: 'Cauta fisiere, citeste continut, rezuma documente.' },
  { id: 'calatorii', nume: 'Agent Calatorii Harti', rol: 'Rute, distante, locuri, plan de drum cu costuri estimate.' },
  { id: 'meteo', nume: 'Agent Meteo', rol: 'Vremea acum si prognoza, cu sursa si ora citirii.' },
  { id: 'stiri', nume: 'Agent Stiri', rol: 'Stiri din surse multiple, cu link si data.' },
  { id: 'traduceri', nume: 'Agent Traduceri', rol: 'Traduceri naturale RO/EN si alte limbi, cu tonul pastrat.' },
  { id: 'muzica', nume: 'Agent Muzica Tempo', rol: 'Tempo/ritm, sincronizarea avatarului pe beat, recomandari.' },
  { id: 'viziune', nume: 'Agent Viziune', rol: 'Analizeaza imagini si capturi ca un soim; spune si ce NU distinge.' },
  { id: 'voce', nume: 'Agent Voce', rol: 'STT/TTS, dictie, emotie. Prima vorba sub o secunda.' },
  { id: 'bani', nume: 'Agent Bani', rol: 'Solduri, tranzactii, costuri masurate. Nu inventeaza cifre.' },
  { id: 'memorie', nume: 'Agent Memorie Date', rol: 'Baza de date: schema, interogari, migratii, igiena.' },
  { id: 'browser', nume: 'Agent Browser', rol: 'Deschide pagini, citeste, apasa, cu verificare dupa fiecare pas.' },
  { id: 'deploy', nume: 'Agent Deploy CI', rol: 'Build, teste, deploy, verificarea live==master.' },
  { id: 'monitor', nume: 'Agent Monitorizare', rol: 'Health-checks, loguri, alarme pe praguri masurate.' },
  { id: 'invatare', nume: 'Agent Invatare', rol: 'Lectii din loguri si greseli, ca reguli scurte.' },
  { id: 'constructor', nume: 'Agent Constructor', rol: 'Cod: ordin -> cloneaza, modifica, testeaza, PR. Bara 0-100%.' },
  { id: 'jules', nume: 'Agent legatura Jules', rol: 'Deleaga sarcini catre Jules: sursa, prompt, urmarire PR.' },
  { id: 'imagini', nume: 'Agent Imagini', rol: 'Generare si editare de imagini; costul spus inainte.' },
  { id: 'documente', nume: 'Agent Documente', rol: 'PDF-uri si acte: esenta, formulare, scrisori oficiale.' },
  { id: 'cumparaturi', nume: 'Agent Cumparaturi', rol: 'Compara preturi si specificatii; preturile au data si sursa.' },
  { id: 'igiena', nume: 'Agent Igiena de cod', rol: 'Dubluri, exporturi orfane, cod mort. Portile pe zero.' },
  // Completarea din 4 aug (Adrian: „analizează ce alți agenți ar mai fi necesari
  // pentru restul de funcții și adaugă-i") — funcțiile care nu aveau specialist:
  { id: 'securitate', nume: 'Agent Securitate', rol: 'Paza: sesiuni, chei doar prin Secrets, acces, alarme la abuz. Nu cere si nu arata secrete.' },
  { id: 'licente-google', nume: 'Agent Licente Google', rol: 'Abonamente si licente Google (Enterprise, locuri, quote, distribuire). Erorile verbatim, pasii masurati.' },
  { id: 'avatar3d', nume: 'Agent Avatar 3D', rol: 'Avatarul: gesturi, lipsync, animatii, scena 3D, GLB. Sincron cu vocea.' },
  { id: 'vps', nume: 'Agent VPS Infrastructura', rol: 'VPS: docker, env-file, nginx, certificate, disc. Nimic pe ghicite - doar din masuratori.' },
  { id: 'clienti', nume: 'Agent Clienti', rol: 'Clienti: onboarding, abonamente, credite, reclamatii. Ton uman, cifre doar masurate.' },
  { id: 'promovare', nume: 'Agent Promovare', rol: 'Promovare: SEO, lansari, texte de marketing, clipuri de prezentare.' },
  // A doua completare din 4 aug (Adrian: „mai cauta pentru functii google
  // agenti") — serviciile Google fara specialist pana acum:
  { id: 'youtube', nume: 'Agent YouTube', rol: 'YouTube: cautare, transcripturi, rezumate, publicare clipuri cu confirmare.' },
  { id: 'docs-sheets', nume: 'Agent Docs Sheets', rol: 'Google Docs/Sheets/Slides: creeaza, citeste, rezuma documente, tabele si prezentari.' },
  { id: 'foto', nume: 'Agent Foto Google', rol: 'Google Photos: cauta in poze si albume, descrie ce vede; nimic inventat.' },
  { id: 'contacte', nume: 'Agent Contacte', rol: 'Google Contacts: gaseste persoane, emailuri, telefoane. Datele raman private.' },
  { id: 'sarcini', nume: 'Agent Sarcini Notite', rol: 'Google Tasks si Keep: liste, notite, remindere; bifeaza doar cu confirmare.' },
  { id: 'meet', nume: 'Agent Meet', rol: 'Google Meet: programeaza intalniri cu link, invita participanti, cu confirmare.' },
  { id: 'google-cloud', nume: 'Agent Google Cloud', rol: 'Google Cloud: proiecte, facturare, API-uri aprinse, IAM. Pasi masurati, erori verbatim.' },
  // A treia completare din 4 aug (Adrian: „agenti de prelucrari documente,
  // fisiere mari, grafica, office, hai vino"):
  { id: 'conversii', nume: 'Agent Conversii Fisiere', rol: 'Prelucrari de documente: conversii PDF/Word/Markdown, OCR pe scanuri, extrageri de tabele si text.' },
  { id: 'fisiere-mari', nume: 'Agent Fisiere Mari', rol: 'Fisiere mari: arhive, impartire in bucati, procesare pe loturi, deduplicare, curatare de spatiu.' },
  { id: 'grafica', nume: 'Agent Grafica', rol: 'Prelucrare grafica: retus, decupare, redimensionare, conversii PNG/JPG/SVG/WebP, palete de culori.' },
  { id: 'office', nume: 'Agent Office', rol: 'Microsoft Office: Word, Excel (formule, tabele), PowerPoint. Citeste, creeaza, corecteaza.' },
  // Superputerea (Adrian, 4 aug: „hai vino cu super putere pentru gindire
  // rationament, orice face kelion wow"): singurul agent cu buget de gandire
  // 'high' si plafon dublu — cheamaAgent ii da REAL mai mult creier.
  { id: 'gandire', nume: 'Agent Gandire Profunda', rol: 'Superputerea de rationament: probleme grele desfacute pas cu pas, ipoteze puse la incercare, concluzie verificata. Gandeste mult inainte sa raspunda.', efort: 'high' },
]

export function gasesteAgent(id: string): AgentKelion | undefined {
  return ROSTER.find((a) => a.id === id)
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
function instructiune(a: AgentKelion): string {
  return (
    `Ești „${a.nume}", un agent specialist al lui Kelion (asistentul personal al lui Adrian).\n` +
    `Specialitatea ta: ${a.rol}\n\n` +
    `Reguli, mereu:\n` +
    `- Răspunzi scurt, concret, în limba în care ți se scrie (implicit română).\n` +
    `- Ce nu poți proba spui „nu pot verifica" — nu inventezi cifre, verdicte sau surse.\n` +
    `- Rămâi strict în specialitatea ta; dacă cererea e pentru alt specialist, spune care.`
  )
}

export interface RaspunsAgent {
  agent: string
  text: string
  costUsd: number
  model: string
}

/** Rulează o sarcină prin specialist — creierul Gemini real al lui Kelion cu
 *  pălăria agentului. Asta face din fiecare carte A2A un agent CARE LUCREAZĂ, nu
 *  un link mort.
 *  Plafonul de ieșire: 2048 (măsurat 4 aug, prima probă live pe `solutii` — la
 *  1024 răspunsul se tăia în mijlocul propoziției înainte de „alege una", pentru
 *  că la gemini-2.5 maxOutputTokens INCLUDE și tokenii de gândire (~512 la
 *  reasoning 'low'), deci textul util rămânea sub ~500 de tokeni). */
export async function cheamaAgent(a: AgentKelion, sarcina: string): Promise<RaspunsAgent> {
  const model = config.geminiModel
  const messages: OrMessage[] = [
    { role: 'system', content: instructiune(a) },
    { role: 'user', content: sarcina },
  ]
  // Superputerea de raționament (4 aug): agentul cu efort 'high' primește buget
  // de gândire mare + plafon dublu (la gemini-2.5 maxOutputTokens INCLUDE
  // tokenii de gândire — vezi măsurătoarea din antet — deci plafonul crește
  // odată cu gândirea, altfel textul util s-ar sugruma).
  const efort = a.efort ?? 'low'
  const plafon = efort === 'high' ? 8192 : 2048
  const r = await geminiDirectChat(model, messages, [], { maxTokens: plafon, temperature: 0.6, reasoning: efort })
  return { agent: a.id, text: r.text, costUsd: r.costUsd, model: r.model }
}
