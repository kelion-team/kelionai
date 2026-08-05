import { GoogleGenerativeAI } from '@google/generative-ai';
import { GoogleGenerativeAIStream, Message, StreamingTextResponse } from 'ai';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { PassThrough } from 'stream';
import { toFile } from 'openai/uploads';

// import { getAudioDurationInSeconds } from 'get-audio-duration';
// import { ffprobe } from '@dropb/ffprobe';
// import { ffprobe as ffprobeStatic } from 'ffprobe-static';

// ffprobe.path = ffprobeStatic.path;

// === Urechea Live Gemini ===
// Este o implementare a urechii cu Google Gemini, care folosește streaming bidirecțional
// pentru a transcrie audio în timp real (aproape).
//
// Rezultat live: 25 erori „urechea silent" într-o oră — jurnalul serverului arată sesiuni
// care se deschid, primesc 180+ cadre audio (16s) și se închid cu ZERO transcriere,
// fără nicio eroare = MUT, exact ca 3.1-flash-live.
//
// Soluția: pentru Live, comutăm pe un model dovedit că transcrie (gemini-1.5-flash-latest)
// și lăsăm urechea Chirp 3 să prindă fluxul audio real.
//
// === Modele ===
// gemini-1.5-flash-latest - modelul rapid, dovedit că transcrie.
// gemini-2.5-flash-native-audio-preview-12-2025 - modelul vechi, cu probleme de "muțenie".
// gemini-1.5-pro-latest - modelul de bază, mai lent, dar mai capabil.
//
// === Câine de pază (watchdog) ===
// Dacă urechea primește audio, dar nu returnează nicio transcriere pentru o perioadă,
// o declarăm „mută" și comutăm pe un mecanism de rezervă (rafale Gemini),
// pentru a nu bloca conversația.
//
const MUT_CADRE = 180; // Câte cadre audio (100ms) trebuie să primească pentru a fi considerată "mută"
const MUT_MS = 8000; // Câte milisecunde trebuie să treacă fără transcriere pentru a fi considerată "mută"

export class UrecheLiveGemini {
  private genAI: GoogleGenerativeAI;
  private streamingChat: any;
  private audioStream: PassThrough;
  private ws: WebSocket;
  private ev: any; // Event emitter pentru erori și transcrieri
  private audioScris: number = 0;
  private primulAudioLa: number = 0;
  private transcriereVreodata: boolean = false;
  private audioBuffer: Buffer[] = [];
  private audioBufferSize: number = 0;
  private bufferFlushTimeout: NodeJS.Timeout | null = null;
  private lastTranscriptionTime: number = 0;
  private lastAudioTime: number = 0;

  constructor(ws: WebSocket, ev: any) {
    this.ws = ws;
    this.ev = ev;
    this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
    const MODEL_LIVE = process.env.GEMINI_LIVE_MODEL || 'gemini-1.5-flash-latest'; // << AICI E MODIFICAREA
    const model = this.genAI.getGenerativeModel({ model: MODEL_LIVE });

    this.streamingChat = model.startChat({
      history: [],
      generationConfig: {
        maxOutputTokens: 200,
      },
    });

    this.audioStream = new PassThrough();

    this.handleStream();
  }

  private async handleStream() {
    try {
      const result = await this.streamingChat.sendMessageStream([
        {
          inlineData: {
            mimeType: 'audio/webm', // Sau 'audio/wav', 'audio/ogg'
            data: Buffer.concat(this.audioBuffer).toString('base64'),
          },
        },
      ]);

      for await (const chunk of result.stream) {
        const candidate = chunk.candidates[0];
        if (candidate && candidate.content && candidate.content.parts.length > 0) {
          const text = candidate.content.parts[0].text;
          if (text) {
            this.ev.emit('transcriere', text);
            this.transcriereVreodata = true;
            this.lastTranscriptionTime = Date.now();
          }
        }
      }
    } catch (error) {
      console.error('Eroare în sendMessageStream:', error);
      this.ev.emit('eroare', 'Eroare la procesarea audio live cu Gemini.');
    }
  }

  public write(audioChunk: Buffer) {
    if (this.primulAudioLa === 0) {
      this.primulAudioLa = Date.now();
    }
    this.audioScris++;
    this.lastAudioTime = Date.now();

    this.audioBuffer.push(audioChunk);
    this.audioBufferSize += audioChunk.length;

    // Flush buffer every second or if it gets too large
    if (!this.bufferFlushTimeout) {
      this.bufferFlushTimeout = setTimeout(() => {
        this.flushAudioBuffer();
      }, 1000); // Flush every 1 second
    } else if (this.audioBufferSize > 1024 * 1024) {
      // 1MB buffer size
      this.flushAudioBuffer();
    }

    // Câine de pază pentru "urechea mută"
    if (
      this.audioScris >= MUT_CADRE &&
      Date.now() - this.primulAudioLa >= MUT_MS &&
      !this.transcriereVreodata
    ) {
      console.warn(
        `asr-stream: urechea Live Gemini a picat (mut: ${this.audioScris} cadre audio, zero transcriere în ${MUT_MS / 1000}s) — comut pe rafale Gemini`
      );
      this.ev.emit(
        'eroare',
        'Urechea Live nu aude. Comutăm pe un mod de recunoaștere mai robust.'
      );
      this.stop();
    }
  }

  private flushAudioBuffer() {
    if (this.audioBuffer.length > 0) {
      const audioData = Buffer.concat(this.audioBuffer);
      this.audioStream.write(audioData);
      this.audioBuffer = [];
      this.audioBufferSize = 0;
    }
    if (this.bufferFlushTimeout) {
      clearTimeout(this.bufferFlushTimeout);
      this.bufferFlushTimeout = null;
    }
  }

  public stop() {
    this.flushAudioBuffer();
    this.audioStream.end();
    // Nu închideți streamingChat direct aici, lăsați-l să se termine natural
  }
}

// === Modul de rezervă: Rafale Gemini ===
// Pentru cazurile în care streaming-ul live e problematic, putem folosi
// un mod bazat pe "rafale" de audio, unde trimitem bucăți mai mari de audio
// și așteptăm o transcriere.
export class RafaleGemini {
  private genAI: GoogleGenerativeAI;
  private ev: any;
  private audioBuffer: Buffer[] = [];
  private bufferSize: number = 0;
  private processingTimeout: NodeJS.Timeout | null = null;
  private lastTranscriptionTime: number = 0;

  constructor(ev: any) {
    this.ev = ev;
    this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
  }

  public write(audioChunk: Buffer) {
    this.audioBuffer.push(audioChunk);
    this.bufferSize += audioChunk.length;

    if (this.processingTimeout) {
      clearTimeout(this.processingTimeout);
    }

    this.processingTimeout = setTimeout(() => {
      this.processAudioBuffer();
    }, 500); // Process audio after 500ms of silence or continuous audio
  }

  private async processAudioBuffer() {
    if (this.audioBuffer.length === 0) {
      return;
    }

    const audioData = Buffer.concat(this.audioBuffer);
    this.audioBuffer = [];
    this.bufferSize = 0;

    try {
      // Convert Buffer to a File-like object
      const audioFile = await toFile(audioData, 'audio.webm', {
        type: 'audio/webm',
      });

      const model = this.genAI.getGenerativeModel({ model: 'gemini-1.5-flash-latest' });
      const result = await model.generateContent([audioFile]);
      const response = await result.response;
      const text = response.text();

      if (text) {
        this.ev.emit('transcriere', text);
        this.lastTranscriptionTime = Date.now();
      }
    } catch (error) {
      console.error('Eroare în RafaleGemini la procesarea audio:', error);
      this.ev.emit('eroare', 'Eroare la procesarea audio în modul rafale.');
    }
  }

  public stop() {
    if (this.processingTimeout) {
      clearTimeout(this.processingTimeout);
    }
    this.processAudioBuffer(); // Process any remaining audio
  }
}
