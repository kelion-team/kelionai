#!/bin/bash
# Instalare Aider pentru Kelion — rulează pe VPS ca root
set -e

echo "=== Instalare Aider pentru Kelion ==="

# Verifică Python și pip
python3 --version || { echo "Python3 lipsește — instalează: apt update && apt install -y python3 python3-pip"; exit 1; }

# Instalează Aider
pip3 install aider-chat || pip install aider-chat

# Verifică instalarea
aider --version || { echo "Aider nu s-a instalat corect"; exit 1; }

# Creează director config dacă nu există
mkdir -p /root/kelion/.aider

# Copiază configurațiile
REPO=/root/kelion/repo
if [ -f "$REPO/.aider.conf.yml" ]; then
    cp "$REPO/.aider.conf.yml" /root/kelion/.aider/kimi.conf.yml
fi
if [ -f "$REPO/.aider-glm.conf.yml" ]; then
    cp "$REPO/.aider-glm.conf.yml" /root/kelion/.aider/glm.conf.yml
fi

# Aliasuri pentru Kelion
cat > /root/kelion/.aider/aid << 'EOF'
#!/bin/bash
# Aider cu Kimi (primar)
cd /root/kelion/repo
KEY_KIMI=$(cat /root/kelion/kimi-key.txt 2>/dev/null || echo "")
if [ -z "$KEY_KIMI" ]; then
    echo "Cheia Kimi lipsește — folosesc GLM"
    KEY_GLM=$(cat /root/kelion/glm-key.txt 2>/dev/null || echo "")
    aider --config /root/kelion/.aider/glm.conf.yml "$@"
else
    aider --config /root/kelion/.aider/kimi.conf.yml "$@"
fi
EOF
chmod +x /root/kelion/.aider/aid

# Link în PATH
ln -sf /root/kelion/.aider/aid /usr/local/bin/aid 2>/dev/null || true

echo "=== Aider instalat ==="
echo "Folosește: aid [fișiere] — pornește Aider cu Kimi/GLM"
echo "Config: /root/kelion/.aider/kimi.conf.yml (Kimi)"
echo "Config: /root/kelion/.aider/glm.conf.yml (GLM fallback)"
