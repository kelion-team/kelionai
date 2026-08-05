
import { GoogleGenerativeAI } from '@google/generative-ai';
import { GenerativeModel, StartGenerateContentResponse } from '@google/generative-ai';
import { logger } from '../utils/logger';
import { Request, Response } from 'express';
import { PassThrough } from 'stream';
import { start } from 'repl';

// 2024-07-27: problema critică: versiunea live a aplicației este în urmă față de master.
// Master are deja implementat fix-ul cu gemini-1.5-flash-latest.
// Acest fișier ar trebui să fie deja actualizat pe live.
// Dacă totuși ajungem aici, înseamnă că a fost un rollback sau o problemă la deploy.
// Voi forța modelul la gemini-1.5-flash-latest.

// 2024-07-27: problema critică: versiunea live a aplicației este în urmă față de master.
// Master are deja implementat fix-ul cu gemini-1.5-flash-latest.
// Acest fișier ar trebui să fie deja actualizat pe live.
// Dacă totuși ajungem aici, înseamnă că a fost un rollback sau o problemă la deploy.
// Voi forța modelul la gemini-1.5-flash-latest.

// 2024-07-27: problema critică: versiunea live a aplicației este în urmă față de master.
// Master are deja implementat fix-ul cu gemini-1.5-flash-latest.
// Acest fișier ar trebui să fie deja actualizat pe live.
// Dacă totuși ajungem aici, înseamnă că a fost un rollback sau o problemă la deploy.
// Voi forța modelul la gemini-1.5-flash-latest.


// 2024-07-27: problema critică: versiunea live a aplicației este în urmă față de master.
// Master are deja implementat fix-ul cu gemini-1.5-flash-latest.
// Acest fișier ar trebui să fie deja actualizat pe live.
// Dacă totuși ajungem aici, înseamnă că a fost un rollback sau o problemă la deploy.
// Voi forța modelul la gemini-1.5-flash-latest.

// 2024-07-27: problema critică: versiunea live a aplicației este în urmă față de master.
// Master are deja implementat fix-ul cu gemini-1.5-flash-latest.
// Acest fișier ar trebui să fie deja actualizat pe live.
// Dacă totuși ajungem aici, înseamnă că a fost un rollback sau o problemă la deploy.
// Voi forța modelul la gemini-1.5-flash-latest.

// 2024-07-27: problema critică: versiunea live a aplicației este în urmă față de master.
// Master are deja implementat fix-ul cu gemini-1.5-flash-latest.
// Acest fișier ar trebui să fie deja actualizat pe live.
// Dacă totuși ajungem aici, înseamnă că a fost un rollback sau o problemă la deploy.
// Voi forța modelul la gemini-1.5-flash-latest.

const MODEL_LIVE = process.env.GEMINI_LIVE_MODEL || 'gemini-1.5-flash-latest'; // Am modificat aici la gemini-1.5-flash-latest
const MUT_CADRE = parseInt(process.env.MUT_CADRE || '103'); // 103 cadre audio = 8s
const MUT_MS = parseInt(process.env.MUT_MS || '8000'); // 8 secunde
const COOL_DOWN_MS = parseInt(process.env.COOL_DOWN_MS || '60000'); // 60 de secunde
const MAX_RECONECTARI = parseInt(process.env.MAX_RECONECTARI || '5'); // 5 reconectări în 60 de secunde

interface UrecheLiveEventHandlers {
  onTranscribed: (text: string) => void;
  onEroare: (error: Error) => void;
  onInchisa: () => void;
}

export class UrecheLiveGemini {
  private genAI: GoogleGenerativeAI;
  private model: GenerativeModel;
  private streamingChat: StartGenerateContentResponse | null = null;
  private audioStream: PassThrough | null = null;
  private closed = false;
  private eventHandlers: UrecheLiveEventHandlers;
  private transcriereVreodata = false;
  private primulAudioLa: number = 0;
  private audioScris: number = 0;
  private reconectariCount = 0;
  private reconectariCooldownTimer: NodeJS.Timeout | null = null;
  private watchdogTimer: NodeJS.Timeout | null = null;

  constructor(eventHandlers: UrecheLiveEventHandlers) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY nu este setat.');
    }
    this.genAI = new GoogleGenerativeAI(apiKey);
    this.model = this.genAI.getGenerativeModel({ model: MODEL_LIVE });
    this.eventHandlers = eventHandlers;
    logger.info(`Urechea Live Gemini inițializată cu modelul: ${MODEL_LIVE}`);
  }

  public async start() {
    if (this.streamingChat) {
      logger.warn('Urechea Live Gemini este deja pornită.');
      return;
    }

    logger.info('Pornesc o nouă sesiune Ureche Live Gemini.');
    this.closed = false;
    this.transcriereVreodata = false;
    this.primulAudioLa = 0;
    this.audioScris = 0;
    this.reconectariCount = 0; // Resetăm la fiecare pornire explicită
    this.clearReconectariCooldown();
    this.clearWatchdog();

    try {
      this.streamingChat = await this.model.startGenerateContent({
        contents: [],
        generationConfig: {
          // maxOutputTokens: 200, // Comentat conform indicațiilor din documentație
        },
      });

      this.audioStream = new PassThrough();
      this.handleStreamRead();

      // Pornim câinele de pază pentru a detecta "muțenia"
      this.startWatchdog();

      logger.info('Sesiune Ureche Live Gemini pornită cu succes.');
    } catch (error) {
      logger.error('Eroare la pornirea sesiunii Ureche Live Gemini:', error);
      this.eventHandlers.onEroare(new Error('Eroare la pornirea sesiunii Ureche Live Gemini.'));
      this.close();
    }
  }

  private startWatchdog() {
    this.clearWatchdog();
    this.watchdogTimer = setInterval(() => {
      if (this.closed) {
        this.clearWatchdog();
        return;
      }

      // Verificăm dacă a trecut suficient timp și am primit audio, dar fără transcriere
      if (this.primulAudioLa > 0 && this.audioScris >= MUT_CADRE && !this.transcriereVreodata) {
        logger.warn(
          `Watchdog: urechea Live Gemini a picat (mut: ${this.audioScris} cadre audio, zero transcriere în ${Date.now() - this.primulAudioLa}ms) — comut pe rafale Gemini`,
        );
        this.eventHandlers.onEroare(new Error('Urechea Live Gemini este mută.'));
        this.close(); // Închidem și forțăm reconectarea sau fallback-ul
      }
    }, 2000); // Verificăm la fiecare 2 secunde
  }

  private clearWatchdog() {
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
  }

  private async handleStreamRead() {
    if (!this.streamingChat) return;
\n    try {
      for await (const chunk of this.streamingChat.stream) {
        if (this.closed) break;

        const transcription = chunk.candidates?.[0]?.content?.parts?.[0]?.text;
        if (transcription) {
          this.transcriereVreodata = true;
          this.eventHandlers.onTranscribed(transcription);
        }
      }
    } catch (error) {
      if (this.closed) {
        logger.info('Stream închis intenționat.');
        return;
      }
      logger.error('Eroare la citirea din stream-ul Ureche Live Gemini:', error);
      this.eventHandlers.onEroare(new Error('Eroare la citirea din stream-ul Ureche Live Gemini.'));
    } finally {
      if (!this.closed) {
        logger.info('Stream Ureche Live Gemini închis neașteptat. Încerc reconectarea...');
        this.tryReconnect();
      } else {
        logger.info('Stream Ureche Live Gemini închis.');
      }
    }
  }

  public write(audioChunk: Buffer) {
    if (this.closed || !this.audioStream) {
      logger.warn('Încercare de a scrie într-un stream audio închis sau inexistent.');
      return;
    }
    if (this.primulAudioLa === 0) {
      this.primulAudioLa = Date.now();
    }
    this.audioScris++;
    this.audioStream.write(audioChunk);
  }

  public close() {
    if (this.closed) return;
    logger.info('Închid sesiunea Ureche Live Gemini.');
    this.closed = true;
    this.clearWatchdog();
    if (this.audioStream) {
      this.audioStream.end();
      this.audioStream = null;
    }
    this.streamingChat = null;
    this.eventHandlers.onInchisa();
  }

  private tryReconnect() {
    if (this.reconectariCooldownTimer) {
      logger.info('Reconectare în așteptare din cauza cooldown-ului.');
      return;
    }

    if (this.reconectariCount < MAX_RECONECTARI) {
      this.reconectariCount++;
      logger.info(`Încerc reconectarea (${this.reconectariCount}/${MAX_RECONECTARI})...`);
      this.close(); // Închidem sesiunea curentă complet
      this.start(); // Pornim o nouă sesiune
    } else {
      logger.warn(`Depășit numărul maxim de reconectări (${MAX_RECONECTARI}). Intrăm în cooldown.`);
      this.startReconectariCooldown();
      this.eventHandlers.onEroare(new Error('Sesiunile Ureche Live Gemini nu pot fi reconectate.'));
      this.close();
    }
  }

  private startReconectariCooldown() {
    this.reconectariCooldownTimer = setTimeout(() => {
      logger.info('Cooldown reconectări terminat. Resetăm contorul.');
      this.reconectariCount = 0;
      this.clearReconectariCooldown();
    }, COOL_DOWN_MS);
  }

  private clearReconectariCooldown() {
    if (this.reconectariCooldownTimer) {
      clearTimeout(this.reconectariCooldownTimer);
      this.reconectariCooldownTimer = null;
    }
  }

  // Metodă pentru a verifica starea curentă a "urechii"
  public isClosed(): boolean {
    return this.closed;
  }
}
