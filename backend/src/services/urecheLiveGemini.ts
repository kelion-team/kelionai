import { GoogleGenerativeAI } from '@google/generative-ai';
import { GoogleGenerativeAIFetchRuntime } from '@google/generative-ai/dist/internal/fetch';

import { getLogger } from '../utils/logger';
import { Metric } from '../utils/metric';

const log = getLogger('urecheLiveGemini');

// REZULTATE LIVE (25 IUL):
// - modelul 3.1-flash-live (varianta veche) e MUT. Primeste audio, 0 transcrieri.
// - modelul 3.5-pro-live (varianta veche) e OK. Transcrie bine, dar e lent si scump.
// - modelul gemini-1.5-flash-latest e OK. Transcrie bine, rapid si ieftin.
// - modelul gemini-1.5-pro-latest e OK. Transcrie bine, rapid si scump.
//
// CONCLUZIE:
// - pentru urechea live, TREBUIE sa folosim un model care produce inputTranscription.
// - 2.5-flash-native-audio-preview-12-2025 produce inputTranscription si e eficient.
// - 25 erori "urechea silent" intr-o ora - jurnalul serverului arata sesiuni
//   care se deschid, primesc 180+ cadre audio (16s) si se inchid cu ZERO transcriere,
//   fara nicio eroare = MUT, exact ca 3.1-flash-live.
//
// SOLUTIE:
// - comutam modelul Live la gemini-1.5-flash-latest.
//
// TODO: de investigat de ce 2.5-flash-native-audio-preview-12-2025 nu mai functioneaza.
//
// Praguri VAD (Voice Activity Detection) si Barge-in:
// VOICE_RMS (0.012), DOMINANCE (2.2), BARGE_RMS (0.024) si BARGE_HOLD_MS (180ms).
// Urechea Chirp are un mecanism de auto-vindecare cu reconectare automata
// (buget de 5 reconectari in 60 de secunde) si un cooldown de 60 de secunde
// dupa care se re-verifica disponibilitatea.

const MUT_CADRE = 180; // 180 de cadre audio = 16 secunde de audio (la 100ms/cadru)
const MUT_MS = 16 * 1000; // 16 secunde

export class UrecheLiveGemini {
  private genAI: GoogleGenerativeAI;
  private metric: Metric;
  private generationConfig: { [key: string]: any };
  private safetySettings: { [key: string]: any }[];
  private model: any;
  private chat: any;

  constructor(apiKey: string, metric: Metric) {
    this.genAI = new GoogleGenerativeAI(apiKey);
    this.metric = metric;

    // TODO: de configurat generationConfig si safetySettings din .env
    this.generationConfig = {
      temperature: 0.1,
      topK: 32,
      topP: 1,
    };

    this.safetySettings = [
      {
        category: 'HARM_CATEGORY_HARASSMENT',
        threshold: 'BLOCK_MEDIUM_AND_ABOVE',
      },
      {
        category: 'HARM_CATEGORY_HATE_SPEECH',
        threshold: 'BLOCK_MEDIUM_AND_ABOVE',
      },
      {
        category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
        threshold: 'BLOCK_MEDIUM_AND_ABOVE',
      },
      {
        category: 'HARM_CATEGORY_DANGEROUS_CONTENT',
        threshold: 'BLOCK_MEDIUM_AND_ABOVE',
      },
    ];

    const MODEL_LIVE = process.env.GEMINI_LIVE_MODEL || 'gemini-1.5-flash-latest';
    log.info('Urechea Live Gemini foloseste modelul:', MODEL_LIVE);

    this.model = this.genAI.getGenerativeModel({
      model: MODEL_LIVE,
      generationConfig: this.generationConfig,
      safetySettings: this.safetySettings,
    });

    this.chat = this.model.startChat({
      history: [],
    });
  }

  async transcribeAudioStream(
    audioStream: AsyncIterable<Buffer>,
    ev: {
      onTranscriere: (transcriere: string) => void;
      onEroare: (eroare: string) => void;
      onFinal: () => void;
    },
  ): Promise<void> {
    log.info('S-a deschis urechea Live Gemini.');
    let transcriereVreodata = false;
    let primulAudioLa = 0;
    let audioScris = 0;

    const stream = this.chat.sendMessageStream({
      contents: audioStream,
    });

    for await (const chunk of stream) {
      if (!primulAudioLa) {
        primulAudioLa = Date.now();
      }
      audioScris++;

      const candAInceputAcum = Date.now();

      // Caine de paza pentru urechea muta
      if (
        audioScris >= MUT_CADRE &&
        candAInceputAcum - primulAudioLa >= MUT_MS &&
        !transcriereVreodata
      ) {
        this.metric.increment('urechea.live.muta');
        log.error(
          'asr-stream: urechea Live Gemini a picat (mut: %s cadre audio, zero transcriere in %s — urechea Live nu aude) — comut pe rafale Gemini',
          audioScris,
          (candAInceputAcum - primulAudioLa) / 1000,
        );
        ev.onEroare(
          'Urechea Live Gemini nu a detectat nicio transcriere. Comut pe modul rafale.',
        );
        break; // Iesim din bucla, fortam reconectarea pe rafale
      }

      const { candidates } = chunk;
      if (candidates && candidates.length > 0) {
        for (const candidate of candidates) {
          if (candidate.content && candidate.content.parts) {
            for (const part of candidate.content.parts) {
              if (part.text) {
                this.metric.increment('urechea.live.transcrieri');
                transcriereVreodata = true;
                ev.onTranscriere(part.text);
              }
            }
          }
        }
      }
    }

    log.info('S-a închis urechea Live Gemini.');
    ev.onFinal();
  }
}
