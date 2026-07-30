// ── REGISTRUL UNIC AL CAPABILITĂȚILOR LUI KELION (CREIER UNIC §5) ────────────
// Adrian, 29 iul: „dacă creierul nu înmagazinează REAL tot ce are softul, nu are
// rost". Aici e SURSA UNICĂ de adevăr: fiecare funcție a softului, o singură
// dată, cu unde ajunge (chat / voce) și dacă e doar-admin. De aici derivă (în
// pașii următori) și lista de unelte a chatului, și a vocii — fără duplicare.
//
// PAZNICUL (brainCapabilities.test.ts): dacă o funcție există dar creierul nu
// ajunge la ea, testul PICĂ. Ținta finală (§1/§6): TOATE pe AMBELE căi. Azi
// vocea e plafonată la 31 (limită măsurată a OpenAI Realtime) → `dormantOnVoice`
// enumeră exact ce rămâne de dus pe voce; niciodată pe ascuns.

export interface Capability {
  /** Numele uneltei, exact cum îl vede modelul. */
  readonly name: string
  /** Grupa, pentru afișare și audit. */
  readonly category: string
  /** Ce face, pe scurt (o propoziție). */
  readonly does: string
  /** Ajunge la ea creierul de CHAT? */
  readonly chat: boolean
  /** Ajunge la ea creierul de VOCE DIRECT? (lista sesiunii Realtime, plafonată
   *  la 31 de unelte de către OpenAI — de aceea nu încap toate aici). */
  readonly voice: boolean
  /** Ajunge la ea vorbind, prin CREIERUL ESCALADAT (același orchestrator ca
   *  scrisul, fără plafonul de 31)? §1 „ce poate scrisul, poate și vocea":
   *  o capabilitate e adormită pe voce doar dacă NU ajunge pe NICIUNA din căi. */
  readonly voiceViaBrain?: boolean
  /** Doar owner (unelte distructive / introspecție). */
  readonly admin: boolean
}

// Sursa unică. Ordinea = ordinea din specificația KELION-CREIER-UNIC.md.
export const CAPABILITIES: readonly Capability[] = [
  // 2.1 Comunicare & afișare
  { name: 'show_on_screen', category: 'afisare', does: 'pune un URL/dată pe monitor', chat: true, voice: true, admin: false },
  { name: 'show_document', category: 'afisare', does: 'pune un text/rezultat pe monitor', chat: true, voice: false, voiceViaBrain: true, admin: false },
  { name: 'run_web_app', category: 'afisare', does: 'rulează o pagină scrisă de el (izolat)', chat: true, voice: true, admin: false },
  { name: 'generate_image', category: 'afisare', does: 'generează o imagine', chat: true, voice: true, admin: false },
  { name: 'open_app_view', category: 'afisare', does: 'deschide panourile aplicației', chat: true, voice: true, admin: false },
  { name: 'play_avatar_gesture', category: 'afisare', does: 'avatarul face un gest', chat: true, voice: true, admin: false },

  // 2.2 Google (18)
  { name: 'get_recent_emails', category: 'google', does: 'citește antetele emailurilor recente', chat: true, voice: true, admin: false },
  { name: 'read_email', category: 'google', does: 'citește corpul COMPLET al unui email (după căutare)', chat: true, voice: false, voiceViaBrain: true, admin: false },
  { name: 'send_email', category: 'google', does: 'trimite email', chat: true, voice: true, admin: false },
  { name: 'get_calendar_events', category: 'google', does: 'citește calendarul', chat: true, voice: true, admin: false },
  { name: 'create_calendar_event', category: 'google', does: 'pune un eveniment în calendar', chat: true, voice: true, admin: false },
  { name: 'delete_calendar_event', category: 'google', does: 'șterge un eveniment din calendar (după id)', chat: true, voice: false, voiceViaBrain: true, admin: false },
  { name: 'complete_task', category: 'google', does: 'bifează un task ca terminat (după id)', chat: true, voice: false, voiceViaBrain: true, admin: false },
  { name: 'get_drive_files', category: 'google', does: 'listează fișierele Drive', chat: true, voice: true, admin: false },
  { name: 'read_drive_file', category: 'google', does: 'citește conținutul unui fișier Drive (după căutare)', chat: true, voice: false, voiceViaBrain: true, admin: false },
  { name: 'get_tasks', category: 'google', does: 'citește task-urile', chat: true, voice: true, admin: false },
  { name: 'add_task', category: 'google', does: 'adaugă un task', chat: true, voice: true, admin: false },
  { name: 'search_contacts', category: 'google', does: 'caută contacte', chat: true, voice: true, admin: false },
  { name: 'add_contact', category: 'google', does: 'adaugă un contact', chat: true, voice: true, admin: false },
  { name: 'web_search', category: 'google', does: 'căutare web', chat: true, voice: true, admin: false },
  { name: 'youtube_search', category: 'google', does: 'caută + redă YouTube', chat: true, voice: true, admin: false },
  { name: 'get_weather', category: 'google', does: 'vremea (cu GPS-ul real)', chat: true, voice: true, admin: false },
  { name: 'maps_search', category: 'google', does: 'caută locuri pe hartă', chat: true, voice: true, admin: false },
  { name: 'maps_directions', category: 'google', does: 'trasee pe hartă', chat: true, voice: true, admin: false },
  { name: 'translate_text', category: 'google', does: 'traduce text', chat: true, voice: true, admin: false },
  { name: 'wikipedia_lookup', category: 'google', does: 'caută pe Wikipedia', chat: true, voice: true, admin: false },
  { name: 'convert_currency', category: 'google', does: 'schimb valutar', chat: true, voice: true, admin: false },
  { name: 'get_time', category: 'google', does: 'ora/data', chat: true, voice: true, admin: false },

  // 2.3 Propriul cod & autonomie (constructor + expert) — admin
  { name: 'list_source', category: 'cod', does: 'listează directoare din codul lui', chat: true, voice: false, voiceViaBrain: true, admin: true },
  { name: 'read_source', category: 'cod', does: 'citește un fișier din codul lui', chat: true, voice: false, voiceViaBrain: true, admin: true },
  { name: 'search_source', category: 'cod', does: 'caută în tot codul lui', chat: true, voice: false, voiceViaBrain: true, admin: true },
  { name: 'build_software', category: 'cod', does: 'dă un ordin de construcție', chat: true, voice: false, voiceViaBrain: true, admin: true },
  { name: 'constructor_status', category: 'cod', does: 'starea ordinelor de construcție', chat: true, voice: false, voiceViaBrain: true, admin: true },
  { name: 'repo_write', category: 'cod', does: 'scrie cod în repo', chat: true, voice: false, voiceViaBrain: true, admin: true },
  { name: 'repo_open_pr', category: 'cod', does: 'deschide un PR', chat: true, voice: false, voiceViaBrain: true, admin: true },
  { name: 'repo_merge_pr', category: 'cod', does: 'face merge unui PR', chat: true, voice: false, voiceViaBrain: true, admin: true },
  { name: 'request_repair', category: 'cod', does: 'notează un ordin de reparație durabil', chat: true, voice: false, voiceViaBrain: true, admin: true },
  { name: 'run_runbook', category: 'ops', does: 'operații VPS (diagnostic/restart/backup...)', chat: true, voice: false, voiceViaBrain: true, admin: true },
  { name: 'runbook_status', category: 'ops', does: 'starea rulărilor', chat: true, voice: false, voiceViaBrain: true, admin: true },
  { name: 'runbook_log', category: 'ops', does: 'jurnalul unei rulări', chat: true, voice: false, voiceViaBrain: true, admin: true },
  // SETĂRILE LUI, FĂCUTE DE EL (Adrian, 30 iul: „să creeze secretele și să le
  // pună unde trebuie, e al meu și îi permit full acces"). Până azi, fiecare
  // cheie nouă însemna ore din viața omului prin portaluri; iar eu îi spuneam
  // că „nu am unealtă" — motiv să CONSTRUIESC unealta, nu să-l trimit pe el.
  { name: 'secret_pune', category: 'ops', does: 'își pune singur o cheie în secretele repo-ului (valoarea nu se vede niciodată)', chat: true, voice: false, voiceViaBrain: true, admin: true },
  { name: 'secret_lista', category: 'ops', does: 'ce chei există (doar numele — GitHub nu dă valorile)', chat: true, voice: false, voiceViaBrain: true, admin: true },
  { name: 'secret_publica', category: 'ops', does: 'duce cheile pe server și repornește aplicația', chat: true, voice: false, voiceViaBrain: true, admin: true },
  { name: 'db_tables', category: 'cod', does: 'vede tabelele bazei de date', chat: true, voice: false, voiceViaBrain: true, admin: true },
  { name: 'db_query', category: 'cod', does: 'interoghează baza de date', chat: true, voice: false, voiceViaBrain: true, admin: true },
  { name: 'system_health', category: 'cod', does: 'sănătatea proprie', chat: true, voice: false, voiceViaBrain: true, admin: true },
  { name: 'server_logs', category: 'cod', does: 'jurnalele serverului', chat: true, voice: false, voiceViaBrain: true, admin: true },
  { name: 'ask_brain', category: 'cod', does: 'raționament profund (cod/analiză)', chat: true, voice: true, admin: false },
  { name: 'propose_tool', category: 'cod', does: 'își cere singur o unealtă nouă', chat: true, voice: false, voiceViaBrain: true, admin: false },

  // 2.4 Browser live (9) — admin
  { name: 'browser_open', category: 'browser', does: 'deschide un site', chat: true, voice: false, voiceViaBrain: true, admin: false },
  { name: 'browser_click', category: 'browser', does: 'dă click în pagină', chat: true, voice: false, voiceViaBrain: true, admin: false },
  { name: 'browser_type', category: 'browser', does: 'scrie în pagină', chat: true, voice: false, voiceViaBrain: true, admin: false },
  { name: 'browser_read', category: 'browser', does: 'citește pagina', chat: true, voice: false, voiceViaBrain: true, admin: false },
  { name: 'browser_back', category: 'browser', does: 'înapoi în istoric', chat: true, voice: false, voiceViaBrain: true, admin: false },
  { name: 'browser_scroll', category: 'browser', does: 'derulează pagina', chat: true, voice: false, voiceViaBrain: true, admin: false },
  { name: 'browser_close', category: 'browser', does: 'închide browserul', chat: true, voice: false, voiceViaBrain: true, admin: false },
  { name: 'browser_key', category: 'browser', does: 'apasă o tastă', chat: true, voice: false, voiceViaBrain: true, admin: false },
  { name: 'browser_click_at', category: 'browser', does: 'click la coordonate', chat: true, voice: false, voiceViaBrain: true, admin: false },

  // 2.5 Memorie & note
  { name: 'save_note', category: 'memorie', does: 'salvează o notiță', chat: true, voice: true, admin: false },
  { name: 'list_notes', category: 'memorie', does: 'listează notițele', chat: true, voice: true, admin: false },
  { name: 'delete_note', category: 'memorie', does: 'șterge o notiță', chat: true, voice: true, admin: false },
  { name: 'list_memories', category: 'memorie', does: 'memoria de lungă durată', chat: true, voice: false, voiceViaBrain: true, admin: false },
  { name: 'forget_memory', category: 'memorie', does: 'uită o memorie', chat: true, voice: false, voiceViaBrain: true, admin: false },
  { name: 'read_inbox', category: 'memorie', does: 'își citește propria cutie poștală (contact@kelionai.app)', chat: true, voice: false, voiceViaBrain: true, admin: true },

  // 2.6 Vedere & loc
  { name: 'look', category: 'vedere', does: 'camera (vede utilizatorul / ce i se arată)', chat: false, voice: true, admin: false },
  { name: 'get_monitor', category: 'vedere', does: 'ce e FAPTIC pe monitor', chat: false, voice: true, admin: false },
  { name: 'get_location', category: 'vedere', does: 'GPS-ul real al dispozitivului', chat: false, voice: true, admin: false },

  // 2.7 Bani & stare — admin
  { name: 'get_real_cost', category: 'bani', does: 'costul real', chat: true, voice: false, voiceViaBrain: true, admin: true },
  { name: 'list_updates', category: 'bani', does: 'ce update-uri a primit', chat: true, voice: false, voiceViaBrain: true, admin: true },
  { name: 'prepare_promo_clip', category: 'bani', does: 'pregătește un clip promo', chat: true, voice: false, voiceViaBrain: true, admin: true },

  // Diverse
  { name: 'log_unsupported_request', category: 'diverse', does: 'notează o cerință imposibilă acum', chat: true, voice: false, voiceViaBrain: true, admin: false },
  { name: 'set_active_role', category: 'diverse', does: 'schimbă rolul activ', chat: true, voice: true, admin: false },
] as const

/** Numele tuturor capabilităților (sursa unică). */
export function allCapabilityNames(): string[] {
  return CAPABILITIES.map((c) => c.name)
}

/** Capabilitățile pe care le are CHATUL. */
export function chatCapabilityNames(): string[] {
  return CAPABILITIES.filter((c) => c.chat).map((c) => c.name)
}

/** Capabilitățile pe care le are VOCEA. */
export function voiceCapabilityNames(): string[] {
  return CAPABILITIES.filter((c) => c.voice).map((c) => c.name)
}

/** ADORMITE PE VOCE: există (pe chat) dar vocea nu ajunge la ele. Ținta §1/§6
 *  e ca lista asta să ajungă GOALĂ. O expunem, nu o ascundem. */
export function dormantOnVoice(): Capability[] {
  return CAPABILITIES.filter((c) => c.chat && !c.voice && !c.voiceViaBrain)
}

/** ADORMITE PE CHAT: există (pe voce) dar chatul nu ajunge la ele. */
export function dormantOnChat(): Capability[] {
  return CAPABILITIES.filter((c) => c.voice && !c.chat)
}
