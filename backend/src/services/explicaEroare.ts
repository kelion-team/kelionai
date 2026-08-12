// ── CE ESTE, DE FAPT, EROAREA ASTA? (Adrian, 12 aug: „Kelion nu știe by default
// că are probleme… nu are sisteme să-i zică automat ce probleme are") ─────────
//
// Erorile brute („WebSocket closed 1006", „Failed to fetch", „NotAllowedError")
// nu spun nimic unui om — și, mai grav, nici lui Kelion: întrebat „ce e eroarea
// asta?", răspundea „încearcă din nou". Aici traducem semnătura tehnică într-o
// propoziție clară — ce e, cât de grav, din ce cauză probabilă. Clasificatorul
// e folosit de autodiagnostic (ca Kelion să-și CUNOASCĂ singur defectele) și de
// lista de erori din admin.
//
// Regula #1 se respectă: NU inventăm un verdict. Când semnătura nu se recunoaște,
// spunem „eroare neclasificată" și lăsăm textul brut la vedere — nu deghizăm
// necunoscutul într-o explicație plauzibilă dar falsă.

export type Severitate = 'critic' | 'important' | 'minor'

export interface EroareExplicata {
  /** Explicația în clar: ce este și (când se știe) din ce cauză. */
  ceEste: string
  /** Cât de grav e pentru utilizator. */
  severitate: Severitate
  /** Grupa: Voce / Rețea / Permisiuni / Sesiune / Server / Benign / Necunoscut. */
  categorie: string
}

interface Regula {
  categorie: string
  severitate: Severitate
  ceEste: string
  /** Semnătura: un regex peste textul erorii (case-insensitive). */
  potriveste: RegExp
}

// Ordinea CONTEAZĂ: prima regulă care se potrivește câștigă. Cele mai specifice
// (voce 1006) înaintea celor generice (Failed to fetch).
const REGULI: Regula[] = [
  {
    categorie: 'Voce',
    severitate: 'important',
    potriveste: /1006|sesiunea vocal[ăa] s-a [îi]nchis|voce live.*[îi]nchis|websocket.*clos/i,
    ceEste:
      'Conexiunea vocală live s-a întrerupt brusc (cod 1006 = socketul s-a închis fără un cod de la server). ' +
      'De regulă: o publicare nouă a repornit serverul (taie sesiunea în curs), rețea instabilă, ori tabul lăsat în fundal. Se reconectează singură; dacă se repetă des în afara publicărilor, e o problemă reală pe calea vocală.',
  },
  {
    categorie: 'Permisiuni',
    severitate: 'important',
    potriveste: /notallowed|permission denied|getusermedia|microfon|microphone|camera.*(denied|blocat)/i,
    ceEste:
      'Utilizatorul (sau browserul) a refuzat accesul la microfon/cameră. Fără el, vocea și avatarul cu față nu pot porni. Se rezolvă din permisiunile site-ului, nu din cod.',
  },
  {
    categorie: 'Sesiune',
    severitate: 'important',
    potriveste: /\b401\b|unauthorized|sesiune.*expirat|token.*(expirat|invalid)/i,
    ceEste: 'Sesiunea a expirat sau lipsește autentificarea (401). Utilizatorul trebuie să se reconecteze; dacă apare fără să fi ieșit, e o problemă de sesiune pe server.',
  },
  {
    categorie: 'Sesiune',
    severitate: 'minor',
    potriveste: /\b403\b|forbidden|acces refuzat/i,
    ceEste: 'Acces refuzat (403): s-a cerut ceva nepermis (ex. o rută de admin fără drept). De obicei normal; suspect doar dacă apare pe o acțiune care ar trebui permisă.',
  },
  {
    categorie: 'Server',
    severitate: 'critic',
    potriveste: /\b5\d\d\b|internal server error|502|503|504/i,
    ceEste: 'Serverul a răspuns cu eroare (5xx): aplicația a picat pe cererea aceea, sau containerul se repornea (Caddy dă 502/503 cât timp urcă). Critic dacă persistă — înseamnă cod stricat pe server.',
  },
  {
    categorie: 'Rețea',
    severitate: 'minor',
    potriveste: /failed to fetch|networkerror|load failed|net::err|fetch.*fail|err_network|err_internet/i,
    ceEste: 'O cerere de rețea a eșuat (Failed to fetch): net căzut la utilizator, server jos o clipă, ori CORS. Adesea tranzitoriu; important doar dacă se repetă pe aceeași cerere.',
  },
  {
    categorie: 'Rețea',
    severitate: 'minor',
    potriveste: /aborterror|the operation was aborted|signal.*abort/i,
    ceEste: 'O cerere a fost anulată (AbortError): timeout depășit sau utilizatorul a navigat înainte să se termine. Rareori un bug real.',
  },
  {
    categorie: 'Rețea',
    severitate: 'minor',
    potriveste: /chunkloaderror|loading chunk|failed to (load|fetch).*(module|dynamically imported)|importing a module script failed/i,
    ceEste: 'Browserul a cerut o bucată de cod (chunk) dintr-o versiune veche, ținută în cache după un deploy nou. O reîncărcare a paginii rezolvă. Dacă apare des imediat după publicări, cache-ul nu se invalidează corect.',
  },
  {
    categorie: 'Permisiuni',
    severitate: 'minor',
    potriveste: /securityerror|blocked by.*security|only secure origins|https required/i,
    ceEste: 'Browserul a blocat o operațiune din motive de securitate (ex. microfonul cere HTTPS). Se verifică că pagina rulează pe HTTPS și că API-ul folosit e permis în context.',
  },
  {
    categorie: 'Benign',
    severitate: 'minor',
    potriveste: /resizeobserver loop|resizeobserver.*undelivered/i,
    ceEste: 'Zgomot benign de layout de la ResizeObserver (browserul n-a apucat să livreze toate măsurătorile într-un cadru). NU afectează utilizatorul — se poate ignora.',
  },
  {
    categorie: 'Benign',
    severitate: 'minor',
    potriveste: /quotaexceeded|exceeded the quota|localstorage.*full/i,
    ceEste: 'Stocarea locală a browserului e plină (QuotaExceeded). Rar; se rezolvă golind ce nu mai e nevoie din localStorage.',
  },
  {
    categorie: 'Necunoscut',
    severitate: 'minor',
    potriveste: /^script error\.?$|^script error\b/i,
    ceEste: 'Eroare cross-origin opacă („Script error"): browserul ascunde detaliile fiindcă vine dintr-un script de pe alt domeniu (ex. o extensie). Nu avem ce diagnostica din ea.',
  },
]

/** Traduce o eroare brută în „ce este" clar. Când nu recunoaște semnătura, spune
 *  cinstit că e neclasificată — nu inventează o cauză (regula #1). */
export function explicaEroare(mesaj: string): EroareExplicata {
  const text = String(mesaj ?? '').trim()
  if (!text) {
    return { ceEste: 'Eroare fără text — nu s-a capturat niciun mesaj.', severitate: 'minor', categorie: 'Necunoscut' }
  }
  for (const r of REGULI) {
    if (r.potriveste.test(text)) {
      return { ceEste: r.ceEste, severitate: r.severitate, categorie: r.categorie }
    }
  }
  return {
    ceEste: 'Eroare neclasificată — semnătura nu e recunoscută încă. Vezi textul brut pentru diagnostic.',
    severitate: 'important',
    categorie: 'Necunoscut',
  }
}

/** Ordinea gravității, pentru sortare (critic întâi). */
export function rangSeveritate(s: Severitate): number {
  return s === 'critic' ? 0 : s === 'important' ? 1 : 2
}
