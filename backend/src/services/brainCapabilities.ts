// ── THE SINGLE REGISTRY OF KELION'S CAPABILITIES (SINGLE BRAIN §5) ───────────
// Adrian, Jul 29: "if the brain doesn't REALLY store everything the software
// has, there's no point". This is the SINGLE source of truth: every function
// of the software, once, with where it reaches (chat / voice) and whether it's
// admin-only. From here derive (in the next steps) both the chat's tool list
// and the voice's — without duplication.
//
// THE GUARD (brainCapabilities.test.ts): if a function exists but the brain
// can't reach it, the test FAILS. The final target (§1/§6): ALL on BOTH paths.
// Today voice is capped at 31 (OpenAI Realtime's measured limit) →
// `dormantOnVoice` lists exactly what's left to bring to voice; never hidden.

export interface Capability {
  /** The tool's name, exactly as the model sees it. */
  readonly name: string
  /** The group, for display and audit. */
  readonly category: string
  /** What it does, briefly (one sentence). */
  readonly does: string
  /** Can the CHAT brain reach it? */
  readonly chat: boolean
  /** Can the DIRECT VOICE brain reach it? (the Realtime session list, capped
   *  at 31 tools by OpenAI — that's why they don't all fit here). */
  readonly voice: boolean
  /** Can it be reached by speaking, through the ESCALATED BRAIN (the same
   *  orchestrator as typing, without the 31 cap)? §1 "what typing can do,
   *  voice can do too": a capability is dormant on voice only if it reaches
   *  NONE of the paths. */
  readonly voiceViaBrain?: boolean
  /** Owner only (destructive tools / introspection). */
  readonly admin: boolean
}

// The single source. Order = the order in the KELION-CREIER-UNIC.md spec.
export const CAPABILITIES: readonly Capability[] = [
  // 2.1 Communication & display
  { name: 'show_on_screen', category: 'afisare', does: 'pune un URL/dată pe monitor', chat: true, voice: true, admin: false },
  { name: 'show_document', category: 'afisare', does: 'pune un text/rezultat pe monitor', chat: true, voice: false, voiceViaBrain: true, admin: false },
  { name: 'run_web_app', category: 'afisare', does: 'rulează o pagină scrisă de el (izolat)', chat: true, voice: true, admin: false },
  { name: 'generate_image', category: 'afisare', does: 'generează o imagine', chat: true, voice: true, admin: false },
  { name: 'open_app_view', category: 'afisare', does: 'deschide panourile aplicației', chat: true, voice: true, admin: false },
  { name: 'play_avatar_gesture', category: 'afisare', does: 'avatarul face un gest', chat: true, voice: true, admin: false },

  // 2.2 Google (19)
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
  { name: 'lookup_address', category: 'google', does: 'adresa+codul poștal din coordonate (sau invers)', chat: true, voice: false, voiceViaBrain: true, admin: false },

  // 2.3 Own code & autonomy (constructor + expert) — admin
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
  // HIS SETTINGS, DONE BY HIM (Adrian, Jul 30: "he should create the secrets
  // and put them where they belong, it's mine and I allow him full access").
  // Until today, every new key meant hours of the human's life in portals; and
  // I kept telling him "I don't have a tool" — a reason to BUILD the tool, not
  // to send him off.
  { name: 'secret_pune', category: 'ops', does: 'își pune singur o cheie în secretele repo-ului (valoarea nu se vede niciodată)', chat: true, voice: false, voiceViaBrain: true, admin: true },
  { name: 'secret_lista', category: 'ops', does: 'ce chei există (doar numele — GitHub nu dă valorile)', chat: true, voice: false, voiceViaBrain: true, admin: true },
  { name: 'secret_publica', category: 'ops', does: 'duce cheile pe server și repornește aplicația', chat: true, voice: false, voiceViaBrain: true, admin: true },
  // THE OWNER'S REQUIREMENTS (Jul 30): the table existed, but nobody filled
  // it — requirements stayed in chat and got lost. These three fill it from
  // speech.
  { name: 'cerinta_noua', category: 'ops', does: 'notează pe loc ce a cerut ownerul, cu criteriul de acceptare', chat: true, voice: false, voiceViaBrain: true, admin: true },
  { name: 'cerinte_lista', category: 'ops', does: 'unde stă fiecare cerință (nouă/analizată/în lucru/livrată/verificată)', chat: true, voice: false, voiceViaBrain: true, admin: true },
  { name: 'cerinta_prioritate', category: 'ops', does: 'cât de urgentă e o cerință — ordinea o dă ownerul', chat: true, voice: false, voiceViaBrain: true, admin: true },
  // THE CARD AT PROVIDERS (Jul 31): puts the owner's card on the provider's
  // page WITHOUT ever seeing the value, and only in the window after his voice
  // was recognized. "That was the requirement that proved real autonomy."
  { name: 'card_stare', category: 'ops', does: 'ce câmpuri de card sunt configurate (nu valorile) și dacă vocea e recunoscută', chat: true, voice: false, voiceViaBrain: true, admin: true },
  { name: 'card_completeaza', category: 'ops', does: 'scrie un câmp de card în pagină fără să-i vadă valoarea', chat: true, voice: false, voiceViaBrain: true, admin: true },
  { name: 'card_gata', category: 'ops', does: 'închide sesiunea discretă de card', chat: true, voice: false, voiceViaBrain: true, admin: true },
  { name: 'db_tables', category: 'cod', does: 'vede tabelele bazei de date', chat: true, voice: false, voiceViaBrain: true, admin: true },
  { name: 'db_query', category: 'cod', does: 'interoghează baza de date', chat: true, voice: false, voiceViaBrain: true, admin: true },
  { name: 'system_health', category: 'cod', does: 'sănătatea proprie', chat: true, voice: false, voiceViaBrain: true, admin: true },
  { name: 'server_logs', category: 'cod', does: 'jurnalele serverului', chat: true, voice: false, voiceViaBrain: true, admin: true },
  { name: 'ask_brain', category: 'cod', does: 'raționament profund (cod/analiză)', chat: true, voice: true, admin: false },
  { name: 'propose_tool', category: 'cod', does: 'își cere singur o unealtă nouă', chat: true, voice: false, voiceViaBrain: true, admin: false },

  // 2.4 Live browser (9) — admin
  { name: 'browser_open', category: 'browser', does: 'deschide un site', chat: true, voice: false, voiceViaBrain: true, admin: false },
  { name: 'browser_click', category: 'browser', does: 'dă click în pagină', chat: true, voice: false, voiceViaBrain: true, admin: false },
  { name: 'browser_type', category: 'browser', does: 'scrie în pagină', chat: true, voice: false, voiceViaBrain: true, admin: false },
  { name: 'browser_read', category: 'browser', does: 'citește pagina', chat: true, voice: false, voiceViaBrain: true, admin: false },
  { name: 'browser_back', category: 'browser', does: 'înapoi în istoric', chat: true, voice: false, voiceViaBrain: true, admin: false },
  { name: 'browser_scroll', category: 'browser', does: 'derulează pagina', chat: true, voice: false, voiceViaBrain: true, admin: false },
  { name: 'browser_close', category: 'browser', does: 'închide browserul', chat: true, voice: false, voiceViaBrain: true, admin: false },
  { name: 'browser_key', category: 'browser', does: 'apasă o tastă', chat: true, voice: false, voiceViaBrain: true, admin: false },
  { name: 'browser_click_at', category: 'browser', does: 'click la coordonate', chat: true, voice: false, voiceViaBrain: true, admin: false },

  // 2.5 Memory & notes
  { name: 'save_note', category: 'memorie', does: 'salvează o notiță', chat: true, voice: true, admin: false },
  { name: 'list_notes', category: 'memorie', does: 'listează notițele', chat: true, voice: true, admin: false },
  { name: 'delete_note', category: 'memorie', does: 'șterge o notiță', chat: true, voice: true, admin: false },
  { name: 'list_memories', category: 'memorie', does: 'memoria de lungă durată', chat: true, voice: false, voiceViaBrain: true, admin: false },
  { name: 'forget_memory', category: 'memorie', does: 'uită o memorie', chat: true, voice: false, voiceViaBrain: true, admin: false },
  { name: 'read_inbox', category: 'memorie', does: 'își citește propria cutie poștală (contact@kelionai.app)', chat: true, voice: false, voiceViaBrain: true, admin: true },

  // 2.6 Sight & place
  { name: 'look', category: 'vedere', does: 'camera (vede utilizatorul / ce i se arată)', chat: false, voice: true, admin: false },
  { name: 'get_monitor', category: 'vedere', does: 'ce e FAPTIC pe monitor', chat: false, voice: true, admin: false },
  { name: 'get_location', category: 'vedere', does: 'GPS-ul real al dispozitivului', chat: false, voice: true, admin: false },

  // 2.7 Money & state — admin
  { name: 'get_real_cost', category: 'bani', does: 'costul real', chat: true, voice: false, voiceViaBrain: true, admin: true },
  { name: 'list_updates', category: 'bani', does: 'ce update-uri a primit', chat: true, voice: false, voiceViaBrain: true, admin: true },
  { name: 'prepare_promo_clip', category: 'bani', does: 'pregătește un clip promo', chat: true, voice: false, voiceViaBrain: true, admin: true },

  // Miscellaneous
  { name: 'log_unsupported_request', category: 'diverse', does: 'notează o cerință imposibilă acum', chat: true, voice: false, voiceViaBrain: true, admin: false },
  { name: 'set_active_role', category: 'diverse', does: 'schimbă rolul activ', chat: true, voice: true, admin: false },
] as const

/** The names of all capabilities (the single source). */
export function allCapabilityNames(): string[] {
  return CAPABILITIES.map((c) => c.name)
}

/** The capabilities the CHAT has. */
export function chatCapabilityNames(): string[] {
  return CAPABILITIES.filter((c) => c.chat).map((c) => c.name)
}

/** The capabilities the VOICE has. */
export function voiceCapabilityNames(): string[] {
  return CAPABILITIES.filter((c) => c.voice).map((c) => c.name)
}

/** WHAT HE KNOWS HE HAS — his own inventory, put in the brain's head.
 *
 *  Adrian, Jul 30: "he must be aware of what he has, what capabilities he
 *  has, all of them activated in the brain and directly callable."
 *
 *  The tools were given to him (the definitions go to the model every turn),
 *  but nowhere was it written, in his language, WHAT HE CAN DO — grouped, with
 *  what each one does. An agent that doesn't know its inventory doesn't use
 *  it: it asks permission, or says "can't" for something it holds in its hand.
 *  The text is DERIVED from the registry, so it can't fall behind when a
 *  capability is added or removed.
 *
 *  `doarAdmin=false` → only what a regular user sees (no admin tools). */
export function inventarulMeu(doarAdmin = true): string {
  const vizibile = CAPABILITIES.filter((c) => c.chat && (doarAdmin || !c.admin))
  const grupe = new Map<string, string[]>()
  for (const c of vizibile) {
    const g = grupe.get(c.category) ?? []
    g.push(`${c.name} (${c.does})`)
    grupe.set(c.category, g)
  }
  const randuri = [...grupe.entries()].map(([cat, list]) => `• ${cat}: ${list.join('; ')}`)
  return (
    `CE POȚI, CONCRET — inventarul tău complet (${vizibile.length} capabilități, ` +
    `toate ACTIVE și apelabile direct, chiar acum):\n${randuri.join('\n')}\n` +
    `Nu ceri voie ca să folosești ce e în lista asta și nu spui „nu pot" pentru ` +
    `ceva ce e aici. Dacă îți lipsește ceva ce NU e în listă, notează-l cu log_gap ` +
    `sau cere-ți unealta cu propose_tool — nu te opri la „nu am".`
  )
}

/** DORMANT ON VOICE: they exist (on chat) but voice can't reach them. The
 *  §1/§6 target is for this list to become EMPTY. We expose it, not hide it. */
export function dormantOnVoice(): Capability[] {
  return CAPABILITIES.filter((c) => c.chat && !c.voice && !c.voiceViaBrain)
}

/** DORMANT ON CHAT: they exist (on voice) but chat can't reach them. */
export function dormantOnChat(): Capability[] {
  return CAPABILITIES.filter((c) => c.voice && !c.chat)
}
