import { GoogleGenerativeAI } from '@google/generative-ai';
import { GenerateContentResponse, Part } from '@google/generative-ai/dist/generative-models';
import EventEmitter from 'events';
import TypedEmitter from 'typed-emitter';
import { StreamRecorder } from './streamRecorder';
import { text } from 'stream/consumers';

// PROBLEMA: urechea Live Gemini a picat (mut: 103 cadre audio, zero transcriere în 8s — urechea Live nu aude)
//
// CONTEXT:
// Pe 2026-07-28, la 14:00 GMT, a fost deployat un fix care schimba modelul Gemini Live la
// gemini-1.5-flash-native-audio-preview-12-2025.
//
// La 14:30 GMT, serverul a început să raporteze masiv erori de tipul:
// "asr-stream: urechea Live Gemini a picat (mut: 103 cadre audio, zero transcriere în 8s — urechea Live nu aude) — comut pe rafale Gemini"
//
// Analiza logurilor arată că:
// - sesiunile se deschid și primesc audio (180+ cadre audio, ~16s de vorbire)
// - dar se închid cu ZERO transcriere
// - fără nicio eroare de API din partea Google
// - exact ca și cum modelul ar fi "mut" (problema observată anterior la 3.1-flash-live)
//
// Aparent, modelul `gemini-1.5-flash-native-audio-preview-12-2025` a devenit subit "mut" pentru audio-ul Românesc,
// sau pentru configurația noastră, sau pentru un bug nou în API.
//
// SOLUȚIA DE URGENȚĂ:
// Comutăm înapoi pe 'gemini-1.5-flash-latest' care a fost stabil și a funcționat anterior.
// Aceasta este o reparație rapidă.
// O investigație mai adâncă a problemei de "muțenie" a modelului `preview-12-2025` va urma.

const MODEL_LIVE = process.env.GEMINI_LIVE_MODEL || 'gemini-1.5-flash-latest';
const API_KEY = process.env.GEMINI_API_KEY;

// Praguri VAD (Voice Activity Detection) și Barge-in, preluate de la client prin stare_masurata
// Acestea sunt valorile implicite, dar pot fi suprascrise de cele primite de la client
const VOICE_RMS_THRESHOLD = parseFloat(process.env.VAD_VOICE_RMS || '0.012');
const DOMINANCE_THRESHOLD = parseFloat(process.env.VAD_DOMINANCE || '2.2');
const BARGE_RMS_THRESHOLD = parseFloat(process.env.VAD_BARGE_RMS || '0.024');
const BARGE_HOLD_MS = parseInt(process.env.VAD_BARGE_HOLD_MS || '180', 10);

// Detectarea "muțeniei" urechii Live: dacă primește audio, dar nu dă transcriere
const MUT_CADRE = 100; // Câte cadre audio trebuie să primească fără transcriere
const MUT_MS = 8000; // În câte milisecunde (8s)

interface UrecheLiveEvents {
  transcriere: (text: string) => void;
  finalSesiune: (motiv: string) => void;
  eroare: (eroare: Error) => void;
  status: (status: string) => void;
}

export class UrecheLiveGemini {
  private genAI: GoogleGenerativeAI;
  private chat: ReturnType<GoogleGenerativeAI['getGenerativeModel']>['startChat'];
  private stream: ReturnType<typeof StreamRecorder.prototype.stream>;
  private finalTranscript: string = '';
  private audioScris: number = 0;
  private transcriereVreodata: boolean = false;
  private primulAudioLa: number = 0;
  private watchdogTimer: NodeJS.Timeout | null = null;
  private readonly ev = new EventEmitter() as TypedEmitter<UrecheLiveEvents>;

  constructor() {
    if (!API_KEY) {
      throw new Error('GEMINI_API_KEY is not set');
    }
    this.genAI = new GoogleGenerativeAI(API_KEY);
    const model = this.genAI.getGenerativeModel({ model: MODEL_LIVE });
    this.chat = model.startChat({
      history: [],
      generationConfig: {
        maxOutputTokens: 100,
      },
    });
    console.log(`UrecheLiveGemini: Aurală activă cu modelul: ${MODEL_LIVE}`);
  }

  public on<E extends keyof UrecheLiveEvents>(event: E, listener: UrecheLiveEvents[E]): void {
    this.ev.on(event, listener);
  }

  public pipeAudio(audioStream: StreamRecorder['stream']): void {
    this.stream = audioStream;
    this.stream.on('data', async (audioChunk: Buffer) => {
      this.audioScris++;
      if (this.audioScris === 1) {
        this.primulAudioLa = Date.now();
        this.startWatchdog();
      }

      const audioPart: Part = {
        inlineData: {
          data: audioChunk.toString('base64'),
          mimeType: 'audio/webm',
        },
      };

      try {
        const result = await this.chat.sendMessageStream({
          contents: [{ role: 'user', parts: [audioPart] }],
        });

        for await (const chunk of result.stream) {
          const candidate = chunk.candidates?.[0];
          const textContent = candidate?.content?.parts?.[0]?.text;

          if (textContent) {
            this.transcriereVreodata = true;
            this.resetWatchdog();
            this.finalTranscript += textContent;
            this.ev.emit('transcriere', textContent);
          }
        }
      } catch (error) {
        console.error('UrecheLiveGemini: Eroare la sendMessageStream:', error);
        this.ev.emit('eroare', error as Error);
        this.stop();
      }
    });

    this.stream.on('end', () => {
      this.ev.emit('finalSesiune', 'Stream audio încheiat.');
      this.stop();
    });

    this.stream.on('error', (error) => {
      console.error('UrecheLiveGemini: Eroare pe stream-ul audio:', error);
      this.ev.emit('eroare', error as Error);
      this.stop();
    });
  }

  private startWatchdog(): void {
    if (this.watchdogTimer) {
      clearTimeout(this.watchdogTimer);
    }
    this.watchdogTimer = setTimeout(() => {
      if (this.audioScris >= MUT_CADRE && !this.transcriereVreodata) {
        const err = new Error(`Urechea Live Gemini a picat (mut: ${this.audioScris} cadre audio, zero transcriere în ${Date.now() - this.primulAudioLa}ms)`);
        console.error('UrecheLiveGemini:', err.message);
        this.ev.emit('eroare', err);
        this.stop();
      }
    }, MUT_MS);
  }

  private resetWatchdog(): void {
    if (this.watchdogTimer) {
      clearTimeout(this.watchdogTimer);
      this.watchdogTimer = null;
    }
    // Re-start watchdog if we continue to receive audio but no transcription
    if (this.audioScris > 0) {
      this.startWatchdog();
    }
  }

  public stop(): void {
    if (this.watchdogTimer) {
      clearTimeout(this.watchdogTimer);
      this.watchdogTimer = null;
    }
    // Aici s-ar putea adăuga logica pentru a închide chat-ul sau stream-ul Gemini dacă API-ul permite
    // Deocamdată, lăsăm chat-ul să se închidă natural cu stream-ul audio
    this.ev.emit('finalSesiune', 'Oprire manuală.');
  }

  public getFinalTranscript(): string {
    return this.finalTranscript;
  }
}
