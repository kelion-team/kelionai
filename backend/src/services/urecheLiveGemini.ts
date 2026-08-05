import { GoogleGenerativeAI } from '@google/generative-ai';
import { GoogleGenerativeAIFetchRuntime } from '@google/generative-ai/dist/src/types';
import { EventEmitter } from 'events';

// Kelion: 2026-08-05. Am primit o eroare "urechea Live Gemini a picat (mut: 103 cadre audio, zero transcriere în 8s — urechea Live nu aude) — comut pe rafale Gemini".
// Aceasta este o problemă critică: modelul Gemini Live nu returnează transcrieri, chiar și atunci când primește audio, deși primește cadre audio.
// Istoric:
//   - 2026-07-29: Claude a schimbat modelul la `gemini-1.5-flash-native-audio-preview-12-2025` crezând că e mai bun.
//   - 2026-07-30: Adrian a raportat că urechea moare de două ori, indicând o închidere a sesiunii de voce în timp real chiar și când sunetul este detectat.
//   - 2026-08-01: Logurile serverului arată "urechea Live Gemini a picat (mut)".
//   - 2026-08-03: Rezultat live: 25 erori „urechea silent" într-o oră — jurnalul serverului arată sesiuni care se deschid, primesc 180+ cadre audio (16s) și se închid cu ZERO transcriere, fără nicio eroare = MUT, exact ca 3.1-flash-live.
//   - 2026-08-05: Kelion investighează și decide să schimbe modelul.
//
// CONCLUZIE: Modelul `gemini-2.5-flash-native-audio-preview-12-2025` nu funcționează corect pentru transcriere.
// Acum voi schimba modelul la `gemini-1.5-flash-latest` pentru a remedia problema rapid.

const MODEL_LIVE = process.env.GEMINI_LIVE_MODEL || 'gemini-1.5-flash-latest'; // Schimbat de Kelion pentru a rezolva problema "urechea Live Gemini a picat (mut)"
const API_KEY = process.env.GEMINI_API_KEY;

export class UrecheLiveGemini {
  private genAI: GoogleGenerativeAI;
  private streamingChat: any; // Tipul exact este `StartChatResponse` din '@google/generative-ai'
  private audioStream: any; // Tipul exact este `GoogleGenerativeAIStream` din '@google/generative-ai'
  private transcriereVreodata: boolean = false;
  private primulAudioLa: number = 0;
  private audioScris: number = 0;
  private intervalVerificareMut: NodeJS.Timeout | null = null;
  private readonly ev: EventEmitter;
  private readonly MUT_CADRE: number = 10; // Câte cadre audio trebuie să fie primite înainte de a verifica "muțenia"
  private readonly MUT_MS: number = 5000; // Câte milisecunde să aștepte după primul audio înainte de a considera urechea "mută"

  constructor(ev: EventEmitter) {
    if (!API_KEY) {
      throw new Error('GEMINI_API_KEY este necesar pentru UrecheLiveGemini');
    }
    this.genAI = new GoogleGenerativeAI(API_KEY);
    this.ev = ev;
    this.ev.on('audio-data', (audioChunk: Buffer) => this.scrieAudio(audioChunk));
    this.ev.on('reset-ureche', () => this.reseteaza());
  }

  async porneste() {
    if (this.streamingChat) {
      console.warn('Urechea Live Gemini este deja pornită.');
      return;
    }
    try {
      const model = this.genAI.getGenerativeModel({ model: MODEL_LIVE });
      this.streamingChat = model.startChat({});
      this.audioStream = this.streamingChat.sendMessageStream([
        {
          inlineData: {
            mimeType: 'audio/webm',
            data: '',
          },
        },
      ]);

      this.audioStream.on('chunk', (chunk: any) => {
        if (chunk.candidates && chunk.candidates.length > 0) {
          const content = chunk.candidates[0].content;
          if (content && content.parts && content.parts.length > 0) {
            const text = content.parts[0].text;
            if (text) {
              this.transcriereVreodata = true;
              this.ev.emit('transcriere-live', text);
              this.resetareVerificareMut();
            }
          }
        }
      });

      this.audioStream.on('error', (err: Error) => {
        console.error('Eroare Ureche Live Gemini:', err);
        this.ev.emit('eroare-ureche', err);
        this.opreste();
      });

      this.audioStream.on('end', () => {
        console.log('Urechea Live Gemini s-a închis.');
        this.opreste();
      });

      console.log('Urechea Live Gemini a pornit cu modelul:', MODEL_LIVE);
      this.transcriereVreodata = false;
      this.primulAudioLa = 0;
      this.audioScris = 0;
      this.intervalVerificareMut = setInterval(() => this.verificaMut(), 1000); // Verifică la fiecare secundă
    } catch (error) {
      console.error('Eroare la pornirea Urechii Live Gemini:', error);
      this.ev.emit('eroare-ureche', error);
      this.opreste();
    }
  }

  opreste() {
    if (this.intervalVerificareMut) {
      clearInterval(this.intervalVerificareMut);
      this.intervalVerificareMut = null;
    }
    if (this.audioStream) {
      try {
        this.audioStream.end();
      } catch (e) {
        console.warn('Eroare la închiderea audioStream:', e);
      }
      this.audioStream = null;
    }
    this.streamingChat = null;
    console.log('Urechea Live Gemini oprită.');
  }

  scrieAudio(audioChunk: Buffer) {
    if (!this.streamingChat) {
      // console.warn('Încercare de a scrie audio, dar urechea nu este pornită.');
      return;
    }
    if (this.primulAudioLa === 0) {
      this.primulAudioLa = Date.now();
    }
    this.audioScris++;

    try {
      // Trimitem chunk-ul audio către model
      // Notă: GoogleGenerativeAI necesită un format specific pentru inlineData
      this.streamingChat.sendMessageStream([
        {
          inlineData: {
            mimeType: 'audio/webm', // Asigură-te că mimeType este corect
            data: audioChunk.toString('base64'), // Convertește Buffer în base64
          },
        },
      ]);
    } catch (e) {
      console.error('Eroare la scrierea audio în stream:', e);
      this.ev.emit('eroare-ureche', e);
      this.opreste();
    }
  }

  reseteaza() {
    console.log('Resetarea Urechii Live Gemini...');
    this.opreste();
    this.porneste();
  }

  private verificaMut() {
    // Verifică dacă s-a primit audio, dar nu și transcriere pe o perioadă extinsă
    if (
      this.audioScris > this.MUT_CADRE &&
      !this.transcriereVreodata &&
      Date.now() - this.primulAudioLa >= this.MUT_MS
    ) {
      console.warn(
        `asr-stream: urechea Live Gemini a picat (mut: ${this.audioScris} cadre audio, zero transcriere în ${
          (Date.now() - this.primulAudioLa) / 1000
        }s — urechea Live nu aude) — comut pe rafale Gemini`
      );
      this.ev.emit('eroare-ureche', new Error('Urechea Live Gemini este mută.'));
      this.opreste();
    }
  }

  private resetareVerificareMut() {
    this.primulAudioLa = Date.now();
    this.audioScris = 0;
  }
}
