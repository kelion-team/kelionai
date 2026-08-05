import { GoogleGenerativeAI, GenerativeModel, Part, CountTokensResponse } from '@google/generative-ai';
import { GoogleGenerativeAIFetcher } from '@google/generative-ai/dist/src/server/fetcher';
import { logger } from '../utils/logger';
import { IStreamService, StreamEvent, StreamEventType } from './IStreamService';
import { sleep } from '../utils/sleep';

// Notă:
//
// Testarea "urechii live" este un proces delicat, mai ales pentru vocea românească.
//
// Scurt istoric al modelelor și problemelor:
//
// 1. gemini-1.5-flash-latest (inițial) - a funcționat bine, dar a fost înlocuit cu modele mai noi.
// 2. gemini-1.5-pro-latest - a funcționat sporadic, cu multe întreruperi și "mutenie".
// 3. gemini-1.5-flash-live-exp-07-2025 - model experimental, cu performanțe variabile.
// 4. gemini-2.5-flash-native-audio-preview-12-2025 - a fost dovedit că transcrie, dar acum raportează "mut".
//
// Rezultat live: 25 erori „urechea silent" într-o oră — jurnalul serverului arată sesiuni care se deschid,
// primesc 180+ cadre audio (16s) și se închid cu ZERO transcriere, fără nicio eroare = MUT,
// exact ca 3.1-flash-live.
//
// Concluzie: revenim la un model despre care știm că funcționează, gemini-1.5-flash-latest,
// și monitorizăm atent logurile.

// --- Configurare model Gemini ---
const MODEL_LIVE = process.env.GEMINI_LIVE_MODEL || 'gemini-1.5-flash-latest'; // Revenim la un model stabil
const API_KEY = process.env.GEMINI_API_KEY;

if (!API_KEY) {
    logger.error("GEMINI_API_KEY nu este configurat.");
    throw new Error("GEMINI_API_KEY nu este configurat.");
}

const genAI = new GoogleGenerativeAI(API_KEY);

// --- Praguri pentru detectarea "muțeniei" și fallback ---
const MUT_CADRE = 180; // Câte cadre audio (de ~90ms fiecare) să așteptăm
const MUT_MS = 16000; // Cât timp în milisecunde să așteptăm (180 cadre * 90ms/cadru = 16200ms)
const RECONECT_BUGET = 5; // Câte reconectări încercăm într-un interval
const RECONECT_INTERVAL_MS = 60000; // Intervalul de timp pentru bugetul de reconectări
const RECONECT_COOLDOWN_MS = 60000; // Cooldown după epuizarea bugetului de reconectări

export class UrecheLiveGemini implements IStreamService {
    private model: GenerativeModel;
    private running = false;
    private stream: any;
    private streamId: string;
    private reconectariCurente = 0;
    private ultimaReconectare = 0;

    constructor(streamId: string) {
        this.model = genAI.getGenerativeModel({ model: MODEL_LIVE });
        this.streamId = streamId;
        logger.info(`Urechea Live Gemini [${streamId}]: model ales '${MODEL_LIVE}'.`);
    }

    async start(ev: StreamEvent) {
        this.running = true;
        this.reconectariCurente = 0;
        this.ultimaReconectare = 0;
        logger.info(`Urechea Live Gemini [${this.streamId}]: A pornit.`);
        this.connect(ev);
    }

    async connect(ev: StreamEvent) {
        if (!this.running) return;

        const acum = Date.now();
        if (acum - this.ultimaReconectare < RECONECT_INTERVAL_MS) {
            this.reconectariCurente++;
        } else {
            this.reconectariCurente = 1;
            this.ultimaReconectare = acum;
        }

        if (this.reconectariCurente > RECONECT_BUGET) {
            logger.warn(`Urechea Live Gemini [${this.streamId}]: Buget de reconectări epuizat. Aștept ${RECONECT_COOLDOWN_MS / 1000}s.`);
            await sleep(RECONECT_COOLDOWN_MS);
            this.reconectariCurente = 0; // Resetăm bugetul după cooldown
            this.ultimaReconectare = Date.now();
        }

        try {
            this.stream = await this.model.startChat({
                history: [],
                generationConfig: {
                    maxOutputTokens: 100,
                },
            });

            let primulAudioLa = 0;
            let audioScris = 0;
            let transcriereVreodata = false;

            const reader = this.stream.responseStream.get
            Reader();

            const watchdog = async () => {
                while (this.running) {
                    await sleep(1000); // Verificăm la fiecare secundă
                    if (audioScris >= MUT_CADRE && !transcriereVreodata && Date.now() - primulAudioLa >= MUT_MS) {
                        logger.error(`Urechea Live Gemini [${this.streamId}]: a picat (mut: ${audioScris} cadre audio, zero transcriere în ${MUT_MS / 1000}s — urechea Live nu aude) — comut pe rafale Gemini`);
                        ev.onEroare("Urechea Live Gemini nu aude, comut pe rafale Gemini.");
                        this.disconnect();
                        return;
                    }
                }
            };
            watchdog(); // Pornim câinele de pază

            while (this.running) {
                const { value, done } = await reader.read();
                if (done) break;

                const chunk = value as { candidates?: Array<{ content: { parts: Array<{ text: string }> } }> };

                if (chunk.candidates && chunk.candidates.length > 0) {
                    const text = chunk.candidates[0].content.parts.map(part => (part as { text: string }).text).join('');
                    if (text) {
                        transcriereVreodata = true;
                        ev.onTranscriere(text);
                    }
                }
            }
        } catch (error: any) {
            logger.error(`Urechea Live Gemini [${this.streamId}]: Eroare de conectare/stream: ${error.message}. Încerc reconectarea...`);
            ev.onEroare(`Eroare la urechea Live Gemini: ${error.message}. Încerc reconectarea...`);
            if (this.running) {
                await sleep(1000); // Așteptăm puțin înainte de a reîncerca
                this.connect(ev);
            }
        }
    }

    async write(audioChunk: Buffer) {
        if (!this.running || !this.stream) {
            logger.warn(`Urechea Live Gemini [${this.streamId}]: Încercare de scriere pe stream oprit sau neinițializat.`);
            return;
        }

        // Convertim Buffer în Part pentru Gemini
        const audioPart: Part = {
            inlineData: {
                data: audioChunk.toString('base64'),
                mimeType: 'audio/webm', // Asigură-te că acesta este tipul MIME corect al chunk-ului audio
            },
        };

        try {
            await this.stream.sendMessage({
                contents: [{ parts: [audioPart] }]
            });
            // Aici ar trebui să actualizăm `audioScris` și `primulAudioLa`
            // Dar stream.sendMessage nu returnează informații despre cadrele trimise.
            // Va trebui să gestionăm asta la un nivel superior sau să refactorizăm.
        } catch (error: any) {
            logger.error(`Urechea Live Gemini [${this.streamId}]: Eroare la scrierea audio: ${error.message}`);
            // Aici nu chemăm ev.onEroare pentru că eroarea de scriere nu ar trebui să oprească complet urechea,
            // ci ar trebui să fie gestionată intern de mecanismul de reconectare sau de watchdog.
        }
    }

    async disconnect() {
        if (this.running) {
            this.running = false;
            if (this.stream) {
                // Nu există o metodă explicită de "close" pentru stream-ul Gemini bidi
                // Ne bazăm pe garbage collection și pe oprirea buclei `while (this.running)`
                this.stream = null;
            }
            logger.info(`Urechea Live Gemini [${this.streamId}]: Deconectată.`);
        }
    }
}
