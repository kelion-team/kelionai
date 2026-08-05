1\t// ── URECHEA LIVE GEMINI — full-duplex, ultra-rapid (4 aug 2026) ──────────────
2\t//
3\t// Adrian: „am cerut auzul pe Gemini … full duplex ultra rapid". Asta e exact
4\t// Gemini Live API: un WebSocket bidirecțional către generativelanguage
5\t// (BidiGenerateContent) — audio-ul curge în timp real, iar serverul întoarce
6\t// TRANSCRIEREA intrării în flux (inputTranscription), cu detecție de activitate
7\t// vocală făcută de model. Cheia: GEMINI_API_KEY — fără cont de serviciu, fără
8\t// IAM, fără Chirp.
9\t//
10\t// Rolul acestui serviciu: DOAR urechea (audio → text). Nu cerem modelului să
11\t// răspundă — responseModalities TEXT + un prompt care îi spune să tacă; noi
12\t// consumăm doar inputTranscription. Maparea pe contractul WS al clientului
13\t// (partial/final/speech_begin/speech_end) o face asr-stream.ts.
14\t//
15\t// Onestitate: orice eroare urcă NUMITĂ prin onEroare — niciun „merge" prefăcut.
16\t
17\timport WebSocket from 'ws'
18\timport { config } from '../config.js'
19\t
20\t// Modelul Live (bidiGenerateContent). Suprascriibil prin env fără deploy —
21\t// numele modelelor Live se schimbă des.
22\tconst MODEL_LIVE = process.env.GEMINI_LIVE_MODEL || 'gemini-1.5-flash-latest'
23\t
24\t// CÂINELE DE PAZĂ AL MUȚENIEI (5 aug — muțenia MĂSURATĂ: Live se conectează,
25\t// primește 180+ cadre (16s), întoarce ZERO transcriere, FĂRĂ nicio eroare, deci
26\t// nimeni nu declara urechea moartă și clientul murea „silent" după 15s, iar
27\t// auzul nu cădea pe rezervă). Acum: dacă a curs audio REAL (≥ MUT_CADRE cadre)
28\t// pe o fereastră de MUT_MS și n-a venit NICIO transcriere, urechea Live e MUTĂ
29\t// → eroare NUMITĂ, iar asr-stream cade pe rezerva Gemini (rafale). O ureche care
30\t// a produs măcar o transcriere e considerată VIE și nu e atinsă niciodată.
31\tconst MUT_MS = 8_000
32\tconst MUT_CADRE = 40
33\t
34\texport interface UrecheLive {
35\t  /** PCM16 mono 16kHz, exact ce trimite browserul pe /api/asr-stream. */
36\t  scrieAudio(pcm: Buffer): void
37\t  inchide(): void
38\t}
39\t
40\texport interface UrecheLiveEvenimente {
41\t  onPartial(text: string): void
42\t  onFinal(text: string): void
43\t  onVorbireIncepe(): void
44\t  onVorbireSeTermina(): void
45\t  onEroare(motiv: string): void
46\t}
47\t
48\texport function urecheLiveDisponibila(): boolean {\
49\t  return Boolean(config.geminiKey)
50\t}
51\t
52\t/** Deschide o sesiune Live cu transcrierea intrării. Întoarce null doar fără
53\t *  cheie — orice altă problemă vine prin onEroare, numită. */
54\t// GARDUL DE ALFABET (Adrian, 4 aug: urechea scria românește în greacă/arabă/
55\t// chirilic — „Και όλοι", „Чекався"). Urechea native-audio ghicește limba pe
56\t// audio scurt și scoate alt alfabet. Dacă limba așteptată e LATINĂ și
57\t// transcrierea vine majoritar în alt alfabet, e o greșeală de ureche — o
58\t// aruncăm, nu o arătăm și nu o trimitem la creier.
59\tconst LIMBI_NELATINE = /^(ru|uk|bg|sr|mk|be|el|ar|he|fa|ur|hi|bn|ta|th|zh|ja|ko|ka|hy|am)/i
60\texport function alfabetStrain(text: string, langHint: string): boolean {
61\t  if (!langHint || LIMBI_NELATINE.test(langHint)) return false // limba chiar e ne-latină → nu filtrăm
62\t  const litere = text.replace(/[^\\p{L}]/gu, '')
63\t  if (litere.length < 2) return false
64\t  const neLatine = litere.replace(/\\p{Script=Latin}/gu, '')
65\t  return neLatine.length / litere.length > 0.5
66\t}
67\t
68\texport function deschideUrecheaLive(langHint: string, ev: UrecheLiveEvenimente): UrecheLive | null {
69\t  if (!config.geminiKey) return null
70\t  const url = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${config.geminiKey}`
71\t  const ws = new WebSocket(url)
72\t  let gata = false // setup confirmat de server
73\t  let inchisa = false
74\t  let transcrierePartiala = ''
75\t  const coadaAudio: Buffer[] = [] // audio sosit înainte de setupComplete
76\t  // Starea câinelui de pază (vezi MUT_MS/MUT_CADRE sus).
77\t  let transcriereVreodata = false // a venit VREODATĂ o transcriere? (dacă da, urechea e vie)
78\t  let audioScris = 0 // câte cadre de audio REAL au plecat spre Live (după setup)
79\t  let primulAudioLa = 0 // când a plecat primul cadru real (ms)
80\t  let watchdog: ReturnType<typeof setInterval> | null = null
81\t  const opresteWatchdog = (): void => {
82\t    if (watchdog) {
83\t      clearInterval(watchdog)
84\t      watchdog = null
85\t    }
86\t  }
87\t  const declaraMuta = (): void => {
88\t    if (inchisa) return
89\t    opresteWatchdog()
90\t    inchisa = true // oprește re-firing pe 'close'
91\t    try {
92\t      ws.close()
93\t    } catch {
94\t      /* deja închis */
95\t    }
96\t    const sec = primulAudioLa ? Math.round((Date.now() - primulAudioLa) / 1000) : 0
97\t    ev.onEroare(`mut: ${audioScris} cadre audio, zero transcriere în ${sec}s — urechea Live nu aude`)
98\t  }
99\t
100\t  ws.on('open', () => {
101\t    ws.send(
102\t      JSON.stringify({
103\t        setup: {
104\t          model: `models/${MODEL_LIVE}`,
105\t          // Modelele Live moderne cer AUDIO ca modalitate de RĂSPUNS (măsurat:
106\t          // cu TEXT dau cod 1007). Nouă ne trebuie DOAR urechea, deci îi cerem să
107\t          // tacă (systemInstruction) și consumăm exclusiv `inputTranscription`;
108\t          // eventualul audio de ieșire al modelului e ignorat mai jos.
109\t          generationConfig: { responseModalities: ['AUDIO'] },
110\t          // Urechea propriu-zisă: serverul transcrie ce AUDE, în flux.
111\t          inputAudioTranscription: {},
112\t          systemInstruction: {
113\t            parts: [
114\t              {
115\t                text:
116\t                  'You are a transcription-only listener. NEVER reply, NEVER comment. Stay silent.' +
117\t                  (langHint
118\t                    ? ` The speaker speaks ${langHint}. Transcribe STRICTLY in ${langHint}, using its native alphabet (for Romanian: the Latin alphabet with ă â î ș ț). NEVER transliterate or output Greek, Cyrillic, Arabic, Hebrew, or Han characters.`
119\t                    : ''),
120\t              },
121\t            ],\
122\t          },
123\t        },\
124\t      }),\
125\t    )\
126\t  })\
127\t
128\t  ws.on('message', (data: Buffer) => {\
129\t    let m: {\
130\t      setupComplete?: unknown
131\t      serverContent?: {\
132\t        inputTranscription?: { text?: string }\
133\t        turnComplete?: boolean
134\t        interrupted?: boolean
135\t      }\
136\t    }\
137\t    try {\
138\t      m = JSON.parse(data.toString('utf8'))
139\t    } catch {\
140\t      return
141\t    }\
142\t    if (m.setupComplete !== undefined) {\
143\t      gata = true
144\t      for (const b of coadaAudio.splice(0)) trimite(b)
145\t      // Pornește câinele de pază: dacă audio curge dar nu vine nicio transcriere
146\t      // pe fereastra MUT_MS, urechea Live e mută → cădem pe rafale (onEroare).
147\t      if (!watchdog) {
148\t        watchdog = setInterval(() => {
149\t          if (inchisa || transcriereVreodata) return
150\t          if (primulAudioLa && audioScris >= MUT_CADRE && Date.now() - primulAudioLa >= MUT_MS) declaraMuta()
151\t        }, 2_000)
152\t      }
153\t      return
154\t    }
155\t    const sc = m.serverContent
156\t    if (!sc) return
157\t    const bucata = sc.inputTranscription?.text ?? ''
158\t    if (bucata) {
159\t      transcriereVreodata = true // urechea a produs text → e VIE; câinele nu mai latră
160\t      if (!transcrierePartiala) ev.onVorbireIncepe()
161\t      transcrierePartiala += bucata
162\t      // Nu arătăm în bandă transcrierea în alfabet străin (greacă/chirilic/arabă
163\t      // pe limbă latină) — e ghiceala greșită a urechii, nu ce a spus omul.
164\t      if (!alfabetStrain(transcrierePartiala, langHint)) ev.onPartial(transcrierePartiala)
165\t    }
166\t    // Sfârșitul turei de vorbire (VAD-ul modelului): ce s-a strâns devine FINAL.
167\t    if (sc.turnComplete || sc.interrupted) {
168\t      const text = transcrierePartiala.trim()
169\t      transcrierePartiala = ''
170\t      ev.onVorbireSeTermina()
171\t      // Alfabet străin = mis-transcriere → NU pleacă la creier (altfel ajunge
172\t      // „Чекався" ca mesajul userului). O aruncăm cinstit.
173\t      if (text && !alfabetStrain(text, langHint)) ev.onFinal(text)
174\t    }
175\t  })
176\t
177\t  ws.on('error', (e: Error) => {
178\t    opresteWatchdog()
179\t    if (!inchisa) ev.onEroare(`live_ws: ${String(e?.message ?? e).slice(0, 200)}`)
180\t  })
181\t  ws.on('close', (cod: number, motiv: Buffer) => {
182\t    opresteWatchdog()
183\t    if (inchisa) return
184\t    // Închiderea neanunțată (cotă, model inexistent, cheie) e o eroare NUMITĂ —
185\t    // asr-stream decide plasa (rafale), nu murim tăcut.
186\t    ev.onEroare(`live_inchis: cod ${cod} ${motiv.toString('utf8').slice(0, 160)}`)
187\t  })
188\t
189\t  const trimite = (pcm: Buffer): void => {
190\t    audioScris += 1 // câinele de pază numără audio-ul REAL trimis
191\t    if (!primulAudioLa) primulAudioLa = Date.now()
192\t    try {
193\t      ws.send(
194\t        JSON.stringify({
195\t          realtimeInput: { audio: { data: pcm.toString('base64'), mimeType: 'audio/pcm;rate=16000' } },
196\t        }),
197\t      )
198\t    } catch {
199\t      /* eroarea reală vine pe canalul 'error' al ws-ului */
200\t    }
201\t  }
202\t
203\t  return {
204\t    scrieAudio(pcm: Buffer): void {
205\t      if (inchisa) return
206\t      if (!gata) {
207\t        coadaAudio.push(pcm)
208\t        if (coadaAudio.length > 200) coadaAudio.shift() // plafon: ~20s, nu memorie infinită
209\t        return
210\t      }
211\t      trimite(pcm)
212\t    },
213\t    inchide(): void {
214\t      inchisa = true
215\t      opresteWatchdog()
216\t      try {
217\t        ws.close()
218\t      } catch {
219\t        /* deja închis */
220\t      }\
221\t    },
222\t  }\
223\t}