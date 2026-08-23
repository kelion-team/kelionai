#!/usr/bin/env python3
"""
Microserviciu Coqui TTS (XTTS v2) pentru clonare voce.

Primește text + sample audio (base64) și returnează audio sintetizat
în vocea persoanei din sample. Modelul XTTS v2 suportă clonare cu
un sample de 6+ secunde, în multiple limbi (inclusiv româna).

Rulează pe portul 5100 (intern, NU public). Backend-ul Node.js
proxy-uiește cererile prin /api/voce/sintetizeaza.

Endpoint:
  POST /sintetizeaza
  Body: { "text": "...", "sample_base64": "...", "limba": "ro" }
  Response: audio/wav (binary)
"""
import os
import sys
import base64
import tempfile
import traceback
from http.server import HTTPServer, BaseHTTPRequestHandler
import json

PORT = int(os.environ.get("COQUI_PORT", "5100"))
LANGUAGE = os.environ.get("COQUI_LANGUAGE", "ro")

# Modelul se încarcă LA PORNIRE (o singură dată, ~30s la prima pornire).
# La cererile ulterare, sinteza e rapidă (~3-5s pe CPU pentru o frază).
_tts = None

def load_model():
    global _tts
    if _tts is not None:
        return _tts
    try:
        from TTS.api import TTS
        # XTTS v2 — cel mai bun model de clonare voce de la Coqui
        # Suportă: clonare cu sample scurt (6s+), multiple limbi, CPU/GPU
        model_name = "tts_models/multilingual/multi-dataset/xtts_v2"
        _tts = TTS(model_name)
        _tts.to("cpu")  # VPS fără GPU — CPU mode
        print(f"[coqui] model XTTS v2 încărcat pe CPU", flush=True)
        return _tts
    except Exception as e:
        print(f"[coqui] EROARE încărcare model: {e}", flush=True)
        traceback.print_exc()
        return None


class CoquiHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/health":
            model = load_model()
            status = {"ok": model is not None, "model": "xtts_v2" if model else "none"}
            self._json(200, status)
        elif self.path == "/":
            self._json(200, {"service": "coqui-tts", "model": "xtts_v2", "port": PORT})
        else:
            self._json(404, {"error": "not_found"})

    def do_POST(self):
        if self.path != "/sintetizeaza":
            self._json(404, {"error": "not_found"})
            return

        try:
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length)
            data = json.loads(body)

            text = (data.get("text") or "").strip()
            sample_b64 = (data.get("sample_base64") or "").strip()
            limba = data.get("limba") or LANGUAGE

            if not text:
                self._json(400, {"error": "lipsa_text"})
                return
            if not sample_b64:
                self._json(400, {"error": "lipsa_sample"})
                return

            # Decodează sample-ul din base64 → fișier temporar
            sample_bytes = base64.b64decode(sample_b64)
            if len(sample_bytes) > 2_000_000:  # 2MB max
                self._json(413, {"error": "sample_prea_mare"})
                return

            with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f_sample:
                f_sample.write(sample_bytes)
                sample_path = f_sample.name

            with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f_out:
                out_path = f_out.name

            try:
                model = load_model()
                if model is None:
                    self._json(503, {"error": "model_neincarcat"})
                    return

                # XTTS v2: sinteză cu clonare voce
                # speaker_wav = sample-ul de referință
                # language = codul limbii (ro, en, fr, de, etc.)
                model.tts_to_file(
                    text=text,
                    speaker_wav=sample_path,
                    language=limba,
                    file_path=out_path,
                )

                # Citește audio-ul sintetizat
                with open(out_path, "rb") as f:
                    audio_bytes = f.read()

                self.send_response(200)
                self.send_header("Content-Type", "audio/wav")
                self.send_header("Content-Length", str(len(audio_bytes)))
                self.end_headers()
                self.wfile.write(audio_bytes)
                print(f"[coqui] sinteză OK: {len(text)} chars → {len(audio_bytes)} bytes", flush=True)

            finally:
                # Curățăm fișierele temporare
                try:
                    os.unlink(sample_path)
                    os.unlink(out_path)
                except:
                    pass

        except Exception as e:
            print(f"[coqui] EROARE sinteză: {e}", flush=True)
            traceback.print_exc()
            self._json(500, {"error": f"eroare_sinteza: {str(e)}"})

    def _json(self, code, data):
        body = json.dumps(data).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        # Suprimă log-urile HTTP default (prea zgomotoase)
        print(f"[coqui] {args[0]}", flush=True)


def main():
    print(f"[coqui] pornire pe port {PORT}...", flush=True)
    # Pre-încarcă modelul la pornire (nu la prima cerere — ca să fie rapid)
    print(f"[coqui] încărcare model XTTS v2 (prima pornire durează ~30s)...", flush=True)
    model = load_model()
    if model is None:
        print("[coqui] ATENȚIE: modelul nu s-a încărcat — cererile vor pică", flush=True)
    server = HTTPServer(("0.0.0.0", PORT), CoquiHandler)
    print(f"[coqui] server pornit pe port {PORT}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
