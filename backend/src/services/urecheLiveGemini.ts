import { GoogleGenerativeAI } from '@google/generative-ai';
import { GoogleGenerativeAIStream, Message, StreamingTextResponse } from 'ai';
import { PassThrough } from 'stream';
import { performance } from 'perf_hooks';
import { log } from '../../lib/logger';
import { v4 as uuidv4 } from 'uuid';
import { IWebsocketService } from '../websocket/IWebsocketService';
import { ITelemetryService } from '../telemetry/ITelemetryService';
import { ISessionService } from '../session/ISessionService';
import { ISpeechRecognitionService } from './ISpeechRecognitionService';
import { SpeechRecognitionEvent } from './SpeechRecognitionEvent';

// NOTĂ ADRIAN:
//
// 1. Probleme live cu 3.1-flash-live:
//    - Rezultat live: 25 erori „urechea silent" într-o oră — jurnalul serverului arată sesiuni care se deschid, primesc 180+ cadre audio (16s) și se închid cu ZERO transcriere, fără nicio eroare = MUT, exact ca 3.1-flash-live.
//    - Soluția de avarie: comut pe modelul „rafale Gemini" (care nu e live, ci transcrie la final de frază) atunci când urechea live e mută.
//    - Concluzie: 3.1-flash-live nu mai e bun pentru live audio.
//
// 2. Probleme live cu 1.5-pro-latest:
//    - Rezultat live: 1.5-pro-latest e LENT. Latenta pana la prima transcriere e de 3-4 secunde, apoi alte 3-4 secunde la fiecare replica. Inacceptabil pentru o conversatie live.
//    - Concluzie: 1.5-pro-latest nu e bun pentru live audio.
//
// 3. Probleme live cu 1.5-flash-latest:
//    - Rezultat live: 1.5-flash-latest e RAPID. Latenta pana la prima transcriere e sub 1 secunda. Dar are momente de "mutenie" - cand primeste audio dar nu transcrie nimic.
//    - Soluția de avarie: comut pe modelul „rafale Gemini" (care nu e live, ci transcrie la final de frază) atunci când urechea live e mută.
//    - Concluzie: 1.5-flash-latest e cel mai bun de departe, dar are nevoie de câine de pază pe "mutenie".
//
// 4. Concluzie generală (27 iulie 2026):
//    - NICIUN model Gemini Live nu e perfect pentru live audio. Toate au probleme.
//    - Cel mai bun compromis e 1.5-flash-latest cu un câine de pază solid pe "mutenie".
//    - Câinele de pază e activat.

// Modelul live principal. Dacă acesta e mut, comutăm pe rafale.
const MODEL_LIVE = process.env.GEMINI_LIVE_MODEL || 'gemini-1.5-flash-latest';

// Praguri pentru detectarea muțeniei (când urechea primește audio dar nu transcrie)
const MUT_CADRE = 100; // Câte cadre audio trebuie să primească pentru a considera că e "mută"
const MUT_MS = 6000; // Câte milisecunde trebuie să treacă fără transcriere pentru a considera că e "mută"

export class UrecheLiveGemini implements ISpeechRecognitionService {
  private genAI: GoogleGenerativeAI;
  private websocketService: IWebsocketService;
  private telemetryService: ITelemetryService;
  private sessionService: ISessionService;

  constructor(
    websocketService: IWebsocketService,
    telemetryService: ITelemetryService,
    sessionService: ISessionService,
  ) {
    this.genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY || 'YOUR_API_KEY');
    this.websocketService = websocketService;
    this.telemetryService = telemetryService;
    this.sessionService = sessionService;
  }

  async startRecognition(sessionId: string): Promise<SpeechRecognitionEvent> {
    const model = this.genAI.getGenerativeModel({ model: MODEL_LIVE });
    const chat = model.startChat({
      history: [],
    });

    const audioStream = new PassThrough({ objectMode: true });
    let transcriereAcum = '';
    let transcriereTotalaSesiune = '';
    let primulAudioLa = 0;
    let ultimulAudioLa = 0;
    let audioScris = 0;
    let transcriereVreodata = false;
    let watchdogTimer: NodeJS.Timeout | null = null;
    let lastLogTime = 0;
    const LOG_INTERVAL_MS = 2000; // Log la fiecare 2 secunde

    const ev = new SpeechRecognitionEvent();

    const configureWatchdog = () => {
      if (watchdogTimer) {
        clearTimeout(watchdogTimer);
      }
      watchdogTimer = setTimeout(() => {
        if (audioScris > MUT_CADRE && !transcriereVreodata) {
          log.warn(`asr-stream: urechea Live Gemini a picat (mut: ${audioScris} cadre audio, zero transcriere în ${MUT_MS / 1000}s) — comut pe rafale Gemini`);
          ev.onEroare(new Error('Urechea Live Gemini e mută. Comut pe rafale.'));
          this.telemetryService.recordEvent(sessionId, 'asr_live_mute_fallback', { model: MODEL_LIVE, audioFrames: audioScris });
        }
      }, MUT_MS);
    };

    // Inițializează câinele de pază la început
    configureWatchdog();

    const processAudio = async () => {
      try {
        const result = await chat.sendMessageStream({
          generateContent: audioStream
        });

        for await (const chunk of result.stream) {
          const currentTime = performance.now();
          if (currentTime - lastLogTime > LOG_INTERVAL_MS) {
            log.debug(`asr-stream: Live Gemini primește chunk, status: ${chunk.candidates?.[0]?.finishReason}, text: ${chunk.text}`);
            lastLogTime = currentTime;
          }

          const newText = chunk.text;
          if (newText) {
            transcriereAcum += newText;
            transcriereVreodata = true;
            configureWatchdog(); // Resetează câinele de pază la fiecare transcriere
            ev.onResult(transcriereAcum);
            this.websocketService.sendMessage(sessionId, JSON.stringify({ type: 'asr_live_result', text: transcriereAcum }));
            this.telemetryService.recordEvent(sessionId, 'asr_live_transcription_chunk', { textLength: newText.length, model: MODEL_LIVE });
          }
        }
      } catch (error) {
        log.error(`asr-stream: Eroare în procesarea streamului Gemini Live: ${error.message}`);
        this.telemetryService.recordEvent(sessionId, 'asr_live_error', { error: error.message, model: MODEL_LIVE });
        ev.onEroare(error);
      }
    };

    processAudio();

    ev.on('audio', (audioChunk: Buffer) => {
      if (audioChunk.length > 0) {
        if (primulAudioLa === 0) {
          primulAudioLa = Date.now();
        }
        ultimulAudioLa = Date.now();
        audioScris++;
        audioStream.write({
          inlineData: {
            data: audioChunk.toString('base64'),
            mimeType: 'audio/webm', // Sau 'audio/wav', depinde de formatul audio
          },
        });
        // Resetează câinele de pază la fiecare chunk audio primit pentru a evita declanșarea falsă
        configureWatchdog();
      }
    });

    ev.on('end', () => {
      if (watchdogTimer) {
        clearTimeout(watchdogTimer);
      }
      audioStream.end();
      transcriereTotalaSesiune = transcriereAcum;
      log.info(`asr-stream: Sesiune Gemini Live încheiată pentru ${sessionId}. Transcriere finală: "${transcriereTotalaSesiune}"`);
      this.telemetryService.recordEvent(sessionId, 'asr_live_session_end', { finalTranscriptionLength: transcriereTotalaSesiune.length, model: MODEL_LIVE });
    });

    ev.on('close', () => {
      if (watchdogTimer) {
        clearTimeout(watchdogTimer);
      }
      audioStream.destroy();
      log.info(`asr-stream: Stream Gemini Live distrus pentru ${sessionId}.`);
    });

    return ev;
  }
}
