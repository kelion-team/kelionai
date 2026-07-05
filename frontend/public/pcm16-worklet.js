// AudioWorklet — rulează pe FIRUL DE AUDIO (nu pe cel principal, zero jank).
// Ia microfonul (Float32 @ rata contextului, ex. 48kHz) și scoate PCM16 @ 16kHz
// mono, exact ce cere Google STT streaming (LINEAR16 16000). Postează cadre
// Int16 (ArrayBuffer transferat, fără copie) către firul principal, care le
// trimite pe WebSocket la /api/asr-stream.
//
// Decimare fracțională cu acumulator (merge la orice rată de intrare: 44.1k, 48k).
// Fără low-pass (aliasing minim pentru voce; Google e robust) — se poate adăuga.
class PCM16Downsampler extends AudioWorkletProcessor {
  constructor() {
    super()
    this.targetRate = 16000
    this.pos = 0 // poziția fracțională curentă în semnalul de intrare
  }

  process(inputs) {
    const input = inputs[0]
    if (!input || input.length === 0) return true
    const ch = input[0] // mono — primul canal
    if (!ch || ch.length === 0) return true

    const ratio = sampleRate / this.targetRate // ex. 48000/16000 = 3
    // câte eșantioane de ieșire încap în acest bloc
    const out = new Int16Array(Math.ceil(ch.length / ratio) + 1)
    let oi = 0
    let pos = this.pos
    while (pos < ch.length) {
      let s = ch[Math.floor(pos)]
      s = s < -1 ? -1 : s > 1 ? 1 : s // clamp
      out[oi++] = s < 0 ? s * 0x8000 : s * 0x7fff // Float32(-1..1) → Int16
      pos += ratio
    }
    this.pos = pos - ch.length // reportează restul pentru blocul următor

    if (oi > 0) {
      const frame = out.slice(0, oi) // buffer propriu, exact dimensionat
      this.port.postMessage(frame.buffer, [frame.buffer]) // transfer, nu copie
    }
    return true
  }
}

registerProcessor('pcm16-downsampler', PCM16Downsampler)
