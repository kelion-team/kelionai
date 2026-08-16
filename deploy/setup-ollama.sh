#!/usr/bin/env bash
# ── PROCEDURA: CREIERUL LOCAL AL CONSTRUCTORULUI PE VPS (Ollama + model de cod) ──
# Owner, 16 aug: „aider pe un model LOCAL pe VPS (Ollama)… pe serverul linux si de
# acolo sa lucreze aider… scrie-i lui aider procedura sa instaleze pe serverul
# linux si ce mai trebuie."
#
# CE FACE: pune pe VPS tot ce-i trebuie constructorului ca să lucreze INDEPENDENT —
# fără Gemini, fără cheie, fără cotă, fără bani: Ollama (serviciul de model local)
# + un model de cod + Aider pe host + variabilele din kelionai.env. Rulezi O
# SINGURĂ DATĂ, ca root, pe VPS:  bash deploy/setup-ollama.sh
# (Aider poate rula acest script singur: „rulează deploy/setup-ollama.sh".)
#
# CE MAI TREBUIE (resurse) — verifică ÎNAINTE:
#   • RAM: qwen2.5-coder:7b ≈ 6 GB liberi la rulare; 14b ≈ 10-12 GB. `free -h`.
#   • Disc: modelul ocupă ~4-9 GB în /root/.ollama. `df -h /`.
#   • Constructorul rulează pe HOST (cron → constructor-agent.mjs), deci Ollama
#     ȘI Aider trebuie pe HOST, nu în containerul aplicației. Scriptul le pune pe host.
set -euo pipefail

MODEL="${CONSTRUCTOR_OLLAMA_MODEL:-qwen2.5-coder:7b}"
ENVFILE="${KELION_ENVFILE:-/root/kelion/kelionai.env}"
OLLAMA_URL="http://127.0.0.1:11434"

echo "== 1/6) Ollama instalat pe VPS? =="
if command -v ollama >/dev/null 2>&1; then
  echo "  DEJA instalat: $(ollama --version 2>/dev/null || echo '?')"
else
  echo "  lipsește — îl instalez (curl oficial)..."
  curl -fsSL https://ollama.com/install.sh | sh
fi

echo "== 2/6) serviciul Ollama pornit? =="
if systemctl list-unit-files 2>/dev/null | grep -q '^ollama.service'; then
  systemctl enable --now ollama || true
else
  # fără systemd → pornim în fundal, o singură instanță
  pgrep -x ollama >/dev/null 2>&1 || (nohup ollama serve >/var/log/ollama.log 2>&1 & echo "  ollama serve pornit (log: /var/log/ollama.log)")
fi
echo -n "  aștept API-ul Ollama"
for i in $(seq 1 30); do
  if curl -sf "$OLLAMA_URL/api/tags" >/dev/null 2>&1; then echo " — VIU"; break; fi
  echo -n "."; sleep 1
  [ "$i" = 30 ] && { echo " — NU pornește; vezi /var/log/ollama.log"; exit 1; }
done

echo "== 3/6) modelul de cod ($MODEL) tras? =="
if ollama list 2>/dev/null | awk 'NR>1{print $1}' | grep -qx "$MODEL"; then
  echo "  DEJA tras: $MODEL"
else
  echo "  îl trag (câteva GB, poate dura)..."
  ollama pull "$MODEL"
fi

echo "== 4/6) Aider instalat pe HOST? (constructorul rulează pe host) =="
if command -v aider >/dev/null 2>&1; then
  echo "  DEJA: $(aider --version 2>/dev/null || echo '?')"
else
  echo "  lipsește — îl instalez..."
  pip3 install --break-system-packages aider-chat 2>/dev/null || pipx install aider-chat
fi

echo "== 5/6) variabilele constructorului în $ENVFILE =="
touch "$ENVFILE"
grep -q '^CONSTRUCTOR_AIDER_MODEL=' "$ENVFILE" || { echo "CONSTRUCTOR_AIDER_MODEL=ollama_chat/${MODEL}" >> "$ENVFILE"; echo "  + CONSTRUCTOR_AIDER_MODEL=ollama_chat/${MODEL}"; }
grep -q '^OLLAMA_API_BASE=' "$ENVFILE" || { echo "OLLAMA_API_BASE=${OLLAMA_URL}" >> "$ENVFILE"; echo "  + OLLAMA_API_BASE=${OLLAMA_URL}"; }

echo "== 6/6) proba finală =="
echo "  modele Ollama pe VPS:"; ollama list
echo ""
echo "GATA. Constructorul (Aider) lucrează acum pe creierul LOCAL Ollama — independent de Gemini."
echo "Panoul Admin → Constructor arată becul: „creier LOCAL Ollama ($MODEL)" verde."
