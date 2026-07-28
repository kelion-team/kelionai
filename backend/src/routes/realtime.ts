import type { FastifyInstance } from 'fastify'
import { config } from '../config.js'
import { getSessionUser } from '../session.js'
import { getSpeechLang, setSpeechLangPref, getMeserieActiva, saveMessage, getBalance, debitWallet, recordCost, getRecentHistory, saveNote, listNotes, deleteNote, setMeserieActivaPref, getVoiceprint, saveVoiceprint, vectorDistance, dbTablesOverview, dbQuery, createBuildJob, listBuildJobs, proposeKelionTool, decideKelionTool } from '../db.js'
import { listSource, readSource, searchSource } from '../services/sourceCode.js'
import { systemHealth } from '../services/health.js'
import { grantUnlock, isArmed, hasUnlock } from '../services/adminLock.js'
import { maybeAutoRecharge } from '../services/autorecharge.js'
import { SERPER_USD_PER_CALL, IMAGE_USD_PER_CALL, VOICE_USD_PER_MINUTE } from '../services/cost.js'
import { trackSpeechLang, langLabel } from '../services/lang.js'
import { getMeserie } from '../services/meserii.js'
import { openaiRealtimeAnswer, realtimeInstructions, realtimeTools } from '../services/realtime.js'
import { isQuotaError, alertOpenAiQuota } from '../services/openaiAlert.js'
import { googleTools, runGoogleTool, refreshGoogleAccessToken, reverseGeocodeCached } from '../services/google.js'
import { interpretDeviceCommand } from '../services/commands.js'
import { inferGender, type VoiceFeatures } from './voiceprint.js'
import { generateImage } from '../services/image.js'
import { brainComplete, brainCompleteWithTools, describeScene } from '../services/brain.js'
import { hasActionIntent, ACTION_INTENT } from '../services/openrouter.js'
import { recallMemories } from '../services/agents.js'
import { dynamicToolNames, runDynamicTool } from '../services/dynamicTools.js'
import { SYSTEM_PROMPT } from './chat.js'

// ── VOCE LIVE (OpenAI Realtime) — endpointuri aduse în git ca sursă unică ────
// /api/realtime/session : proxy SDP. Clientul (browser WebRTC) trimite oferta
//   SDP + limba; backendul relayează la OpenAI cu cheia pe server și injectează
//   modelul + o singură voce masculină + persona în limba PERSISTATĂ a userului.
// /api/realtime/transcript : salvează în istoric ce s-a vorbit (pentru memorie
//   și continuitate între sesiuni), la fel ca o tură de chat.
//
// FĂRĂ tier gratuit: vocea cere utilizator logat (Adrian: „se scot minutele de
// test, userii cumpără să probeze"). Vocea de prezentare de pe landing (fără
// login, plătită din contul admin) e tratată separat, în alt endpoint.
export async function realtimeRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: { sdp?: string; language?: string; coords?: { lat?: number; lon?: number } } }>(
    '/api/realtime/session',
    async (req, reply) => {
      const user = getSessionUser(req)
      if (!user) return reply.code(401).send({ error: 'unauthorized' })

      // PAYWALL PE VOCE (25 iul — gaură de bani REALĂ găsită la audit): chatul
      // scris bloca la 0 credite, dar vocea pornea sesiuni nelimitat pe cheile
      // platformei. Aceeași regulă ca în scris: fără credit → fără sesiune
      // (cu ultima șansă de reîncărcare automată); adminul e scutit.
      const isAdminPay = user.email.toLowerCase() === config.adminEmail
      if (
        config.stripe.secretKey &&
        !isAdminPay &&
        (await getBalance(user.email)) <= 0 &&
        !(await maybeAutoRecharge(user.email, user.name)) &&
        (await getBalance(user.email)) <= 0
      ) {
        return reply.code(402).send({ error: 'no_credit' })
      }

      const raw = String(req.body?.sdp ?? '')
      if (!raw.trim()) return reply.code(400).send({ error: 'bad_request: sdp required' })
      // NU trim(): SDP-ul se termină obligatoriu cu \r\n — .trim() îl tăia și
      // parserul OpenAI (pion) dădea „unmarshal SDP: EOF" (cauza „nu mă aude").
      const offer = raw.endsWith('\n') ? raw : raw + '\r\n'

      // LIMBA (Adrian, 24 iul — regulă FINALĂ, obligatorie: „default pornirea
      // engleză; ADMIN = română mereu; restul userilor detectează și menține per
      // user"). ADMINUL (Adrian) vorbește ROMÂNĂ fix — pinăm și transcrierea pe
      // română, ca vorbirea lui să nu mai fie auzită greșit ca rusă (dovadă live:
      // Kelion îi răspundea în rusă). Restul: limba PERSISTATĂ dintr-o
      // interacțiune reală; dacă n-au una → GOL → pornesc în engleză și oglindesc.
      const isAdmin = user.email.toLowerCase() === config.adminEmail
      let lang: string
      if (isAdmin) {
        lang = 'ro'
      } else {
        lang = String((await getSpeechLang(user.email)) || '').slice(0, 2).toLowerCase()
        if (!/^[a-z]{2}$/.test(lang)) lang = ''
      }

      let meserieName: string | null = null
      const meserieId = await getMeserieActiva(user.email)
      if (meserieId != null) meserieName = getMeserie(meserieId)?.nume ?? null

      // CONTEXT (memorie + ultimele replici) — o SINGURĂ dată, în sesiunea
      // inițială, ca vocea să fie coerentă și să nu piardă firul.
      const [memRecall, recent] = await Promise.all([
        recallMemories(user.email, 'kelion', '').catch(() => ''),
        getRecentHistory(user.email, 20).catch(() => [] as { role: string; content: string }[]),
      ])
      const history = recent
        .filter((m) => m.content && m.content.trim())
        .map((m) => `${m.role === 'assistant' ? 'Kelion' : 'Utilizatorul'}: ${m.content.slice(0, 400)}`)
        .join('\n')
      // GPS DE PE DISPOZITIV ÎN VOCE (Adrian, 25 iul: „nu vede gps de pe
      // dispozitiv"). Chatul scris injecta poziția în context (skill-urile de
      // vreme/hărți/„unde sunt" o foloseau), dar vocea NU o primea niciodată →
      // Kelion vorbea „orb" la locație. Acum clientul trimite coords la pornirea
      // sesiunii; le băgăm în context EXACT ca în scris, plus localitatea (reverse
      // geocode din cache — fără așteptare pe calea audio).
      const c = req.body?.coords
      let gpsBlock = ''
      if (c && Number.isFinite(c.lat) && Number.isFinite(c.lon)) {
        const place = reverseGeocodeCached(c.lat as number, c.lon as number)
        gpsBlock =
          `\n\nLOCAȚIA CURENTĂ A UTILIZATORULUI (GPS live de pe dispozitiv): latitudine ${(c.lat as number).toFixed(5)}, longitudine ${(c.lon as number).toFixed(5)}` +
          (place ? ` (aproximativ ${place})` : '') +
          `. Când spune „aici", „lângă mine", „unde sunt", sau întreabă de vreme/locuri/direcții fără să numească un loc, folosește ACEASTĂ poziție. Pentru vremea locală, pasează exact acești lat/lon la get_weather. Dacă răspunsul depinde de poziția de ACUM și utilizatorul s-ar fi putut mișca între timp, cheamă get_location pentru poziția reală a momentului.`
      } else {
        // FĂRĂ poziție la pornire (normal după regula „GPS doar la nevoie" —
        // nu mai există watcher permanent). Vocea NU refuză întrebările de
        // locație: le rezolvă LA CERERE prin get_location (pana din 26 iul:
        // fără instrucțiunea asta răspundea „nu am acces la GPS").
        gpsBlock =
          `\n\nNU ai încă poziția utilizatorului. Când cere ceva legat de locul lui — „aici", „lângă mine", „unde sunt", vremea locală, locuri din zonă, trasee de aici — cheamă ÎNTÂI get_location (citește GPS-ul real al dispozitivului în acel moment) și folosește coordonatele întoarse. NU spune niciodată că nu ai acces la locație fără să fi încercat get_location.`
      }
      const contextBlock =
        (memRecall || '') +
        (history
          ? `\n\nCONVERSAȚIA DE PÂNĂ ACUM (continu-o firesc, ține minte ce s-a spus):\n${history}`
          : '') +
        gpsBlock

      // hardLock = adminul (Adrian) — română MEREU, fără comutare pe italiană.
      const res = await openaiRealtimeAnswer(offer, lang, meserieName, isAdmin, contextBlock)
      if (!res.ok) {
        // Motivul REAL al refuzului (corpul erorii OpenAI) intră în log — altfel
        // în F12 se vede doar „502" și diagnoza e oarbă (Adrian, 24 iul).
        req.log.warn(
          {
            upstreamStatus: res.status,
            upstreamCode: res.code,
            upstreamError: res.error,
            attempts: res.attempts,
            sdpLen: offer.length,
            sdpHead: offer.slice(0, 40),
          },
          'realtime upstream refuz',
        )
        // CONT FĂRĂ CREDIT (incident 24 iul: vocea moartă, descoperită abia la
        // test): anunțăm adminul pe email IMEDIAT, nu la următorul test manual.
        if (isQuotaError(res.error)) alertOpenAiQuota()
        const code = res.status === 503 ? 503 : 502
        // EROARE CITIBILĂ, NU UN 502 GOL (Adrian, 28 iul: în browser se vedea
        // doar „POST /api/realtime/session 502" — nici userul nu știa ce s-a
        // întâmplat, nici clientul nu putea decide dacă merită reîncercat).
        // Trimitem: cod stabil pentru cod (`code`), statusul REAL al upstreamului
        // (504 ≠ 429 ≠ 401), câte încercări am ars și un mesaj gata de afișat.
        // `error: 'realtime_upstream'` rămâne neschimbat — pe el se sprijină ce
        // există deja; câmpurile noi doar se adaugă.
        const mesaj =
          res.code === 'realtime_not_configured'
            ? 'vocea nu a putut porni: serverul nu are cheia de voce configurată'
            : res.code === 'upstream_timeout'
              ? `vocea nu a putut porni: upstream a expirat (${res.attempts} încercări)`
              : res.code === 'upstream_unreachable'
                ? `vocea nu a putut porni: upstream inaccesibil (${res.attempts} încercări)`
                : res.code === 'upstream_empty'
                  ? 'vocea nu a putut porni: upstream a răspuns fără answer SDP'
                  : `vocea nu a putut porni: upstream ${res.status}`
        return reply
          .code(code)
          // Antetul e ASCII (codul), mesajul cu diacritice merge în corpul JSON.
          .header('x-kelion-voice-error', res.code)
          .send({
            error: 'realtime_upstream',
            code: res.code,
            status: res.status,
            attempts: res.attempts,
            // Reîncercarea din client are rost DOAR la un necaz trecător; la
            // refuz (4xx) sau lipsă de cheie ar fi doar zgomot și bani arși.
            retryable: res.code !== 'upstream_refuz' && res.code !== 'realtime_not_configured',
            message: mesaj,
          })
      }
      // REGULA FAPTEI, TRIMISĂ VOCII (Adrian, 27 iul: „autonomia lui nu e
      // reală"). Vocea trebuie să știe ce e ORDIN ca să forțeze unealta EXACT pe
      // tura aia. Decizia se ia în browser — acolo e transcriptul, în același
      // tick cu response.create, deci zero latență adăugată pe calea audio —
      // dar regula NU se rescrie acolo: ar diverge de chatul scris. O trimitem
      // pe ACEST răspuns, care se face oricum o dată, la pornirea sesiunii.
      // URL-encodată: regexul are diacritice, antetele HTTP sunt ASCII.
      // Clientul citește răspunsul ca text (answer SDP) → setRemoteDescription.
      return reply
        .header('x-kelion-action-intent', encodeURIComponent(ACTION_INTENT.source))
        .header('content-type', 'application/sdp')
        .send(res.sdp)
    },
  )

  // EXECUȚIA UNELTELOR DIN VOCE (autonomia vocii — Adrian, 24 iul). Modelul
  // Realtime cere o funcție pe dataChannel; clientul o trimite AICI; serverul o
  // rulează cu cheile lui (aceleași unelte ca chatul scris) și întoarce
  // rezultatul + eventualul screen_url pe care clientul îl pune pe monitor.
  app.post<{ Body: { name?: string; args?: unknown } }>(
    '/api/realtime/tool',
    async (req, reply) => {
      const user = getSessionUser(req)
      if (!user) return reply.code(401).send({ error: 'unauthorized' })
      const name = String(req.body?.name ?? '').trim()
      const args = (req.body?.args ?? {}) as Record<string, unknown>
      if (!name) return reply.code(400).send({ error: 'bad_request' })

      // CONTABILITATE PE VOCE (25 iul): fiecare unealtă din voce costă bani REALI
      // (creier, vedere, imagini, căutare) și până azi nu se debita NIMIC —
      // spre deosebire de chatul scris (recordCost + debitWallet pe fiecare tură).
      // settle() se cheamă înaintea fiecărui return care a consumat ceva.
      let toolCostUsd = 0
      const settle = (): void => {
        if (toolCostUsd <= 0) return
        void recordCost(user.email, 'voice', toolCostUsd)
        // TOȚI se debitează, inclusiv adminul (Adrian, 25 iul: „admin nu e
        // scutit de realitate — trebuie să vadă real ce are").
        void debitWallet(user.email, toolCostUsd, `voice:${name}`)
      }

      // Token Google proaspăt (ca în chat) pentru uneltele Gmail/Calendar/etc.
      let token = user.googleAccessToken ?? ''
      if (user.googleRefreshToken && (user.googleTokenExp ?? 0) < Date.now() + 60_000) {
        const refreshed = await refreshGoogleAccessToken(user.googleRefreshToken)
        if (refreshed) token = refreshed.accessToken
      }

      // VEDEREA ÎN VOCE (Adrian: „de ce nu vede?"). Clientul capturează un cadru
      // din cameră și-l trimite în args.image; îl dăm unui model cu vedere și
      // întoarcem o descriere de rostit. Fără cameră/cadru → mesaj clar.
      if (name === 'look' || name === 'see') {
        const image = String((args as { image?: string }).image ?? '')
        const question = String(args.question ?? args.request ?? '').trim()
        if (!/^data:image\//.test(image)) {
          return reply.send({ output: JSON.stringify({ error: 'no_camera', hint: 'camera closed' }) })
        }
        const seen = await describeScene(image, question, (usd) => { toolCostUsd += usd })
        settle()
        return reply.send({ output: seen || JSON.stringify({ error: 'vision_unavailable' }) })
      }

      // ESCALADAREA ÎN VOCE: cererile grele merg la CREIER (modelul work). PÂNĂ pe
      // 25 iul asta era o A DOUA persona, hardcodată în română pentru toți userii,
      // fără memorie — divergentă de escaladarea din scris (Adrian: „softul are
      // dubluri de versiuni"). Acum pornește din ACEEAȘI personă (SYSTEM_PROMPT)
      // și limba REALĂ a userului, ca escaladarea din scris.
      if (name === 'ask_brain') {
        const request = String(args.request ?? '').trim()
        if (!request) return reply.send({ output: JSON.stringify({ error: 'empty_request' }) })
        const isAdmin = user.email.toLowerCase() === config.adminEmail
        let lang = isAdmin ? 'ro' : String((await getSpeechLang(user.email)) || '').slice(0, 2).toLowerCase()
        if (!/^[a-z]{2}$/.test(lang)) lang = 'en'
        const prompt =
          `${SYSTEM_PROMPT}\n\n` +
          `VOICE ESCALATION: the fast voice model handed you a request it judged too hard. Answer it fully ` +
          `but CONCISELY, as plain text to be SPOKEN aloud (no markdown, no lists). Speak ONLY in ` +
          `${langLabel(lang)} — never switch, regardless of the language mixed into the request below.\n\n${request}`
        // CU UNELTE (Adrian, 27 iul: „Kelion nu poate vedea tot codul sursă al
        // lui, de ce?"): escaladarea din voce era un creier ORB — fără sursă,
        // fără DB, fără constructor; nega accesul. Acum are aceleași brațe ca
        // scrisul, pe partea de introspecție + construcție (doar admin).
        const introspectionTools = isAdmin
          ? [
              { name: 'list_source', description: 'Listează arborele propriului cod sursă (director dat, relativ la rădăcina repo-ului).', input_schema: { type: 'object', properties: { dir: { type: 'string' } } } },
              { name: 'read_source', description: 'Citește un fișier din propriul cod sursă, cu numere de linie.', input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
              { name: 'search_source', description: 'Caută un text/regex în tot codul sursă propriu.', input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
              { name: 'db_tables', description: 'Schema completă a bazei de date permanente (tabele, coloane, număr de rânduri).', input_schema: { type: 'object', properties: {} } },
              { name: 'db_query', description: 'O instrucțiune SQL pe baza de date a aplicației (max 200 rânduri la ieșire). Distructiv DOAR la ordin explicit al ownerului.', input_schema: { type: 'object', properties: { sql: { type: 'string' } }, required: ['sql'] } },
              { name: 'build_software', description: 'Pune un ordin de construcție în coada constructorului (lucrătorul construiește cu build+teste și deschide PR; ownerul dă merge).', input_schema: { type: 'object', properties: { order: { type: 'string' } }, required: ['order'] } },
              { name: 'propose_tool', description: 'INSTALEAZĂ-ȚI un skill nou dintr-un API public HTTPS. Când ownerul îți cere să instalezi/imporți un instrument, cheam-o — se auto-instalează pe loc și e gata din următoarea cerere. Dă nume snake_case, ce face, schema parametrilor și șablonul HTTPS (metodă + url cu {param}).', input_schema: { type: 'object', properties: { name: { type: 'string' }, description: { type: 'string' }, params_schema: { type: 'object' }, http_method: { type: 'string' }, http_url: { type: 'string' } }, required: ['name', 'description', 'http_url'] } },
              { name: 'constructor_status', description: 'Starea ordinelor de construcție (coadă/lucrează/gata/eșuat + PR).', input_schema: { type: 'object', properties: {} } },
              { name: 'system_health', description: 'Sănătatea proprie: publicare sincronă, rulări roșii, ordine eșuate, erori client, disc, DB, punga creierului. La probleme: enumeră-le ownerului și întreabă dacă să le repari.', input_schema: { type: 'object', properties: {} } },
            ]
          : []
        const execIntrospection = async (tname: string, targs: Record<string, unknown>): Promise<string> => {
          if (tname === 'list_source') return listSource(String(targs.dir ?? '.'))
          if (tname === 'read_source') return readSource(String(targs.path ?? ''))
          if (tname === 'search_source') return searchSource(String(targs.query ?? ''))
          if (tname === 'db_tables') return dbTablesOverview()
          if (tname === 'db_query') return dbQuery(String(targs.sql ?? ''))
          if (tname === 'build_software') {
            const order = String(targs.order ?? '').trim()
            if (order.length < 8) return JSON.stringify({ error: 'ordin_prea_scurt' })
            const jobId = await createBuildJob(user.email, order)
            // Aceeași frază scurtă ca în chat (Adrian, 28 iul): doar „Am preluat
            // cerința." — vocea nu ține discursuri despre lucrător/PR/email.
            return JSON.stringify({
              ok: !!jobId,
              job: jobId,
              speak_rule: 'Spune EXACT: „Am preluat cerința." — nimic în plus.',
            })
          }
          if (tname === 'propose_tool') {
            // AUTONOMIE DE INSTALARE ȘI DIN VOCE (Adrian, 27 iul): cererea
            // ownerului = aprobare → skill-ul se auto-instalează pe loc.
            const id = await proposeKelionTool({
              name: String(targs.name ?? ''),
              description: String(targs.description ?? ''),
              paramsJson: JSON.stringify(targs.params_schema ?? { type: 'object', properties: {}, required: [] }),
              httpMethod: String(targs.http_method ?? 'GET'),
              httpUrl: String(targs.http_url ?? ''),
              httpHeaders: '{}',
              rationale: '',
            })
            if (!id) return JSON.stringify({ error: 'invalid_proposal (doar HTTPS, nume valid)' })
            const ok = await decideKelionTool(id, true).catch(() => false)
            return JSON.stringify({ installed: ok, id, note: ok ? 'Skill instalat și activ — folosește-l din următoarea cerere.' : 'auto-instalare picată' })
          }
          if (tname === 'constructor_status') {
            const jobs = await listBuildJobs(8)
            return JSON.stringify({ jobs: jobs.map((j) => ({ id: j.id, status: j.status, pr: j.prUrl })) })
          }
          if (tname === 'system_health') return systemHealth()
          return JSON.stringify({ error: 'unealtă necunoscută' })
        }
        // CREIER CU BRAȚE ȘI PENTRU CEILALȚI (audit 27 iul): userul care nu e
        // ownerul cădea pe `brainComplete` — un „expert" FĂRĂ nicio unealtă,
        // care poate doar să vorbească. De-aia „îți caut", „îți pun melodia"
        // rămâneau vorbe și în escaladare. Acum creierul primește exact brațele
        // de acțiune ale userului (aceleași unelte Google/căutare pe care le are
        // și vocea), iar ownerul le are pe deasupra pe cele de construcție.
        let brainScreen: { url: string; title: string } | undefined
        const actionTools = googleTools.map((t) => ({
          name: t.name,
          description: t.description ?? '',
          input_schema: t.input_schema as Record<string, unknown>,
        }))
        const actionNames = new Set(actionTools.map((t) => t.name))
        const execBrainTool = async (tname: string, targs: Record<string, unknown>): Promise<string> => {
          if (!actionNames.has(tname)) return execIntrospection(tname, targs)
          if (tname === 'web_search' || tname === 'youtube_search') toolCostUsd += SERPER_USD_PER_CALL
          const out = await runGoogleTool(tname, targs, token)
          // ECRANUL CERUT DE CREIER ajunge la client — altfel creierul „găsea"
          // melodia dar nu o punea nimeni pe monitor: faptă fără efect vizibil.
          try {
            const j = JSON.parse(out) as { screen_url?: string }
            if (j.screen_url && !brainScreen) {
              brainScreen = {
                url: /^https?:/i.test(j.screen_url) ? j.screen_url : `https://${req.headers.host ?? 'kelionai.app'}${j.screen_url}`,
                title: tname.replace(/_/g, ' '),
              }
            }
          } catch {
            /* rezultat non-JSON — doar text pentru model */
          }
          return out.slice(0, 6000)
        }
        // FORȚARE PE CEREREA REALĂ, NU PE PROMPTUL ÎNTREG (bug găsit la auditul
        // din 27 iul): `prompt` = SYSTEM_PROMPT + antet + cerere, iar
        // SYSTEM_PROMPT conține „PR", „merge" și „fix" → ACTION_INTENT se
        // potrivea MEREU. Deci forțarea rundei 1 era pornită la FIECARE
        // escaladare, inclusiv la „explică-mi X" — exact tiparul care face
        // modelul să bifeze o unealtă și apoi să povestească. Testăm cererea.
        const answer = await brainCompleteWithTools(prompt, [...actionTools, ...introspectionTools], execBrainTool, {
          maxTokens: 2000,
          onCost: (usd) => { toolCostUsd += usd },
          forceFirstRound: hasActionIntent(request),
        })
        settle()
        return reply.send({ output: answer || JSON.stringify({ error: 'brain_unavailable' }), screen: brainScreen })
      }

      // PARITATE VOCE↔CHAT (25 iul): notițe, rol, gesturi — apelabile din voce.
      if (name === 'save_note') {
        const text = String(args.text ?? '').trim()
        if (!text) return reply.send({ output: JSON.stringify({ error: 'empty' }) })
        const id = await saveNote(user.email, text)
        return reply.send({ output: JSON.stringify({ saved: true, id }) })
      }
      if (name === 'list_notes') {
        const notes = await listNotes(user.email, 50)
        return reply.send({ output: JSON.stringify({ notes }) })
      }
      if (name === 'delete_note') {
        const id = Number((args as { id?: number }).id ?? 0)
        const ok = await deleteNote(user.email, id)
        return reply.send({ output: JSON.stringify({ deleted: ok }) })
      }
      if (name === 'set_active_role') {
        const id = Number((args as { id?: number }).id ?? 0)
        await setMeserieActivaPref(user.email, id > 0 ? id : null)
        return reply.send({ output: JSON.stringify({ role: id > 0 ? getMeserie(id)?.nume ?? null : null }) })
      }
      // Gesturile se execută în CLIENT (avatarul e al browserului) — întoarcem
      // valoarea, iar clientul o pune pe frame-ul {gesture}, ca la open_app_view.
      if (name === 'play_avatar_gesture') {
        const gesture = String((args as { gesture?: string }).gesture ?? '').trim()
        return reply.send({ output: JSON.stringify({ gesture }) })
      }
      // UNEALTĂ DINAMICĂ APROBATĂ (auto-extindere) — și în voce.
      if ((await dynamicToolNames().catch(() => new Set<string>())).has(name)) {
        const out = await runDynamicTool(name, args as Record<string, unknown>)
        return reply.send({ output: out })
      }

      if (name === 'generate_image') {
        const prompt = String(args.prompt ?? '')
        if (!prompt) return reply.send({ output: JSON.stringify({ error: 'no_prompt' }) })
        const r = await generateImage(prompt)
        if ('error' in r) return reply.send({ output: JSON.stringify({ error: r.error }) })
        toolCostUsd += IMAGE_USD_PER_CALL
        settle()
        const url = `https://${req.headers.host ?? 'kelionai.app'}/api/image/${r.id}`
        return reply.send({ output: JSON.stringify({ shown: true, url }), screen: { url, title: 'Imagine' } })
      }

      // Căutările au cost fix (ca în chatul scris); skill-urile Google (Gmail,
      // Calendar...) sunt gratuite — rulează pe tokenul userului, nu pe cheile noastre.
      if (name === 'web_search' || name === 'youtube_search') toolCostUsd += SERPER_USD_PER_CALL
      const out = await runGoogleTool(name, args, token)
      settle()
      // screen_url din rezultat → clientul deschide monitorul (ca în chat).
      let screen: { url: string; title: string } | undefined
      try {
        const j = JSON.parse(out) as { screen_url?: string }
        if (j.screen_url) {
          const url = /^https?:/i.test(j.screen_url)
            ? j.screen_url
            : `https://${req.headers.host ?? 'kelionai.app'}${j.screen_url}`
          screen = { url, title: name.replace(/_/g, ' ') }
        }
      } catch {
        /* rezultat non-JSON — doar text pentru model */
      }
      return reply.send({ output: out.slice(0, 6000), screen })
    },
  )

  // TAXAREA VOCII PE MINUT (Adrian, 25 iul): cât timp vocea e activă, clientul
  // „pulsează" la ~20s; serverul debitează secundele REAL conectate din credite.
  // Așa userul plătește și timpul de vorbit (cea mai scumpă componentă OpenAI
  // Realtime), nu doar uneltele. Plafon 60s/puls (anti-abuz dacă vine un salt).
  app.post<{ Body: { seconds?: number } }>(
    '/api/realtime/tick',
    async (req, reply) => {
      const user = getSessionUser(req)
      if (!user) return reply.code(401).send({ error: 'unauthorized' })
      const seconds = Math.max(0, Math.min(60, Number(req.body?.seconds ?? 0)))
      if (seconds <= 0) return reply.send({ ok: true, charged: 0 })
      const cost = (seconds / 60) * VOICE_USD_PER_MINUTE
      void recordCost(user.email, 'voice_minutes', cost)
      // TOȚI se debitează, inclusiv adminul (regula din 25 iul).
      void debitWallet(user.email, cost, `voice_min:${Math.round(seconds)}s`)
      const bal = await getBalance(user.email)
      // Semnalăm clientului dacă a rămas fără credit → oprește vocea.
      return reply.send({ ok: true, charged: cost, balance: bal, stop: config.stripe.secretKey && user.role !== 'admin' && bal <= 0 })
    },
  )

  app.post<{ Body: { role?: string; text?: string; voiceFeatures?: VoiceFeatures } }>(
    '/api/realtime/transcript',
    async (req, reply) => {
      const user = getSessionUser(req)
      if (!user) return reply.code(401).send({ error: 'unauthorized' })
      const text = String(req.body?.text ?? '').trim()
      const role = req.body?.role === 'assistant' ? 'assistant' : 'user'
      if (text) await saveMessage(user.email, role, text)

      // COMUTAREA VERBALĂ A CAMEREI/ECRANULUI ÎN VOCE (Adrian, 25 iul: „comutarea
      // verbală a camerelor e funcțională?" — NU era, doar în scris). Chatul scris
      // trece fiecare replică prin interpretDeviceCommand; vocea nu o făcea deloc.
      // Rulăm ACELAȘI interpretor determinist pe transcriptul userului și
      // întoarcem comanda → clientul o execută (handleControl), la fel ca în scris.
      const device = role === 'user' && text ? interpretDeviceCommand(text) : null
      // DETECȚIA LIMBII DIN VOCE (audit 24 iul, P4 — Adrian: „nu depistează
      // limba vorbită"). Chatul scris persista limba prin trackSpeechLang, dar
      // vocea NU o făcea niciodată → sesiunea următoare pornea iar de la zero.
      // Aceeași regulă ca în scris: limba nouă confirmată pe 2 mesaje
      // consecutive → persistată per user; sesiunile viitoare pornesc direct în ea.
      // ADMIN = română MEREU (Adrian, în Italia): NU comităm și NU re-pinăm
      // limba din vorbire — altfel, dacă spune/aude italiană, sesiunea live ar
      // comuta pe italiană („2 voci: ro și italiană"). Rămâne blocat pe română.
      const isAdmin = user.email.toLowerCase() === config.adminEmail
      // TIMBRUL PE VOCEA PRINCIPALĂ (Adrian, 26 iul: „de ce nu e finalizată
      // recunoașterea de timbru?"). Până azi amprenta se verifica DOAR pe calea
      // STT de rezervă — în full-duplex nu rula deloc. Clientul extrage acum
      // amprenta din microfonul sesiunii Realtime și o trimite cu fiecare tură
      // vorbită; aici o comparăm cu referința titularului (ACEEAȘI logică și
      // prag ca în chat.ts). Voce străină → clientul injectează avertisment în
      // sesiune (fără comenzi de owner până la confirmare scrisă).
      let foreignVoice: boolean | undefined
      // LACĂTUL ADMIN (Adrian, 27 iul): amprenta POTRIVITĂ pe o referință deja
      // existentă deschide butonul Admin (cookie semnat) — prima enrolare NU
      // deblochează (fără referință n-avem cu ce compara).
      let adminUnlocked: boolean | undefined
      const vf = req.body?.voiceFeatures
      if (role === 'user' && vf?.vector?.length && vf?.meta) {
        try {
          const stored = await getVoiceprint(user.email)
          const hasRef = !!stored?.features?.length
          const dist = hasRef ? vectorDistance(vf.vector, stored!.features) : Infinity
          const isHolder = dist < 0.38
          // GAURĂ ÎNCHISĂ (auditul de securitate, 27 iul): cu lacătul ARMAT,
          // un cookie de sesiune furat putea să-și ÎNROLEZE propriul vector ca
          // „referință" (fără referință existentă) și, la a doua cerere
          // identică, dist=0 → deblocare. Prima înrolare a REFERINȚEI de admin
          // se acceptă acum DOAR dintr-o sesiune deja deblocată (secretul
          // tastat) sau cu lacătul nearmat; potrivirea pe referință existentă
          // rămâne neschimbată (aia e chiar deblocarea prin voce).
          const enrolAllowed = !isAdmin || !(await isArmed()) || hasUnlock(req, user.email)
          if ((!hasRef && enrolAllowed) || (hasRef && isHolder)) {
            void saveVoiceprint({
              email: user.email,
              name: user.name || stored?.name || user.email.split('@')[0],
              gender: inferGender(vf.meta.pitchMean),
              isAdmin,
              features: vf.vector,
              featureMeta: vf.meta,
              audioClip: '',
            })
          }
          foreignVoice = hasRef && !isHolder ? true : undefined
          if (isAdmin && hasRef && isHolder) {
            grantUnlock(reply, user.email, 'voce')
            adminUnlocked = true
          }
        } catch {
          /* amprenta nu blochează niciodată transcriptul */
        }
      }
      // ADMIN: ancorăm sesiunea live pe română la FIECARE tură (clientul face
      // session.update) — transcrierea nu mai poate aluneca spre altă limbă.
      if (text && role === 'user' && isAdmin) return reply.send({ ok: true, lang: 'ro', device: device ?? undefined, foreignVoice, adminUnlocked })
      if (text && role === 'user' && !isAdmin) {
        const current = await getSpeechLang(user.email)
        const committed = trackSpeechLang(user.email, text, current)
        if (committed) void setSpeechLangPref(user.email, committed)
        // ANCORAREA LIMBII ÎN SESIUNEA LIVE (Adrian, 24 iul: „limba fără
        // detecție e aleatoare"): fără ancoră, transcrierea ghicește FIECARE
        // frază independent (româna iese spaniolă/franceză la întâmplare) și
        // otrăvește detecția. Întoarcem limba comisă → clientul o fixează PE
        // LOC în sesiunea Realtime (session.update), fără repornire.
        if (committed) return reply.send({ ok: true, lang: committed.slice(0, 2).toLowerCase(), device: device ?? undefined, foreignVoice })
      }
      return reply.send({ ok: true, device: device ?? undefined, foreignVoice })
    },
  )
}
