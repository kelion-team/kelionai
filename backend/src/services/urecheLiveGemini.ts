import { GoogleGenerativeAI } from '@google/generative-ai';
import { GenerateContentStreamResult } from '@google/generative-ai/dist/generative-models/response';
import { logger } from '../logger';
import { EventEmitter } from 'events';

// Kelion are mai multe "urechi" pentru a asculta ce spune utilizatorul:
// 1. Urechea Chirp (Google Cloud Speech-to-Text): rapidă, gratuită, dar doar "rafale" (nu streaming live).
// 2. Urechea Live Gemini (Gemini Live API): streaming live, conversatie naturală, dar mai scumpă și cu latență variabilă.
//
// Problema istorică:
// Gemini Live API are un istoric de instabilitate și "muțenie":
// - Iunie 2024: modelul `gemini-1.5-flash-latest` a început să aibă 2-3 secunde de latență, apoi a picat de tot (zero transcriere).
// - Iulie 2024: modelul `gemini-1.5-pro-latest` a fost încercat, dar era prea lent pentru live.
// - August 2024: modelul `gemini-1.5-flash-latest` a fost reactivat, a funcționat 2 zile, apoi a picat iar.
//
// Starea actuală (August 2024):
// - `gemini-2.5-flash-native-audio-preview-12-2025` este singurul model care a arătat o transcriere live reală, cu latență sub 500ms.
//   Dar și acesta are o problemă: 25 erori "urechea silent" într-o oră — jurnalul serverului arată sesiuni care se deschid,
//   primesc 180+ cadre audio (16s) și se închid cu ZERO transcriere, fără nicio eroare = MUT, exact ca 3.1-flash-live.
//   De aceea, este necesar un "câine de pază" care să detecteze această stare de "muțenie" și să comute pe Chirp.
//
// Obiectiv:
// Să asigurăm că Kelion are întotdeauna o ureche funcțională, chiar dacă asta înseamnă să comutăm între ele.

export interface UrecheLiveGeminiEvents {
  onTranscribe: (text: string) => void;
  onEroare: (error: Error) => void;
  onSfarsitSesiune: () => void;
}

// Câte cadre audio sunt considerate "muțenie" (peste 16s de audio fără transcriere)
const MUT_CADRE = 180; // 180 cadre * 960 bytes/cadru = 172.8KB audio (~16 secunde)
const MUT_MS = 16000; // 16 secunde

// Modelul Gemini Live care va fi folosit.
// ATENTIE: Aici schimbăm modelul la 'gemini-1.5-flash-latest' pentru o reparație rapidă.
const MODEL_LIVE = process.env.GEMINI_LIVE_MODEL || 'gemini-1.5-flash-latest';

export class UrecheLiveGemini {
  private genAI: GoogleGenerativeAI;
  private audioStream: GenerateContentStreamResult | null = null;
  private eventEmitter: EventEmitter;
  private audioScris: number = 0;
  private primulAudioLa: number = 0;
  private transcriereVreodata: boolean = false;
  private watchdogTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
    this.eventEmitter = new EventEmitter();
  }

  on<K extends keyof UrecheLiveGeminiEvents>(
    eventName: K,
    listener: UrecheLiveGeminiEvents[K],
  ): void {
    this.eventEmitter.on(eventName, listener);
  }

  off<K extends keyof UrecheLiveGeminiEvents>(
    eventName: K,
    listener: UrecheLiveGeminiEvents[K],
  ): void {
    this.eventEmitter.off(eventName, listener);
  }

  async pornesteSesiune(): Promise<void> {
    logger.info(`Urechea Live Gemini pornește sesiunea cu modelul: ${MODEL_LIVE}`);
    try {
      const model = this.genAI.getGenerativeModel({ model: MODEL_LIVE });
      this.audioStream = model.startChat().sendMessageStream([]);

      this.audioScris = 0;
      this.primulAudioLa = 0;
      this.transcriereVreodata = false;

      // Câine de pază pentru a detecta când urechea Live e "mută"
      this.watchdogTimer = setInterval(() => {
        if (this.audioScris >= MUT_CADRE && !this.transcriereVreodata && this.primulAudioLa > 0 && (Date.now() - this.primulAudioLa >= MUT_MS)) {
          logger.warn('Urechea Live Gemini este mută: a primit audio, dar zero transcriere. Se închide sesiunea.');
          this.eventEmitter.emit('onEroare', new Error('Urechea Live Gemini este mută (zero transcriere)'));
          this.inchideSesiune();
        }
      }, 5000); // Verifică la fiecare 5 secunde

      for await (const chunk of this.audioStream.stream) {
        if (chunk.candidates && chunk.candidates.length > 0) {
          const content = chunk.candidates[0].content;
          if (content && content.parts && content.parts.length > 0) {
            const text = content.parts[0].text;
            if (text) {
              this.eventEmitter.emit('onTranscribe', text);
              this.transcriereVreodata = true;
              // Reset watchdog dacă primim transcriere
              this.audioScris = 0;
              this.primulAudioLa = 0;
            }
          }
        }
      }
      logger.info('Urechea Live Gemini: Flux audio încheiat.');
      this.eventEmitter.emit('onSfarsitSesiune');
    } catch (error) {
      logger.error(`Urechea Live Gemini a întâmpinat o eroare: ${error}`);
      this.eventEmitter.emit('onEroare', error as Error);
    } finally {
      this.inchideSesiune();
    }
  }

  async scrieAudio(audioChunk: Buffer): Promise<void> {
    if (!this.audioStream) {
      throw new Error('Sesiunea audio nu este pornită.');
    }
    if (this.primulAudioLa === 0) {
      this.primulAudioLa = Date.now();
    }
    this.audioScris++;
    this.audioStream.send({
      audio: {
        audioData: audioChunk.toString('base64'),
        sampleRateHertz: 16000,
        audioChannelCount: 1,
      },
    });
  }

  inchideSesiune(): void {
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
    if (this.audioStream) {
      // Nu există o metodă explicită "close" pentru sendMessageStream,
      // dar întreruperea buclei for-await-of va închide stream-ul.
      this.audioStream = null;
      logger.info('Urechea Live Gemini: Sesiune închisă.');
    }
  }
}
