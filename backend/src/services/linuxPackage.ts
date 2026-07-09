// ══════════════════════════════════════════════════════════════════════════
// PACHETUL LINUX (Adrian, 9 iul: „construiește și Linux (.zip), să întoarcă 200").
// Kelionai e o aplicație web; „app-ul de Linux" e un LANSATOR nativ care deschide
// kelionai.app într-o fereastră dedicată (mod app), plus un instalator care-l pune
// în meniul de aplicații. Îl construim DINAMIC, în memorie, la /dl/Kelionai-linux.zip
// → mereu 200, mereu versiunea live (nimic de rebuild-uit, nu poate 404 niciodată).
//
// Encoder ZIP propriu (metoda STORE, fără compresie): imaginea Docker de producție
// (node slim) NU are binarul `zip`, iar pachetul e mic (fișiere text + o iconiță),
// deci store e suficient și fără dependențe noi.
// ══════════════════════════════════════════════════════════════════════════

import fs from 'node:fs'
import path from 'node:path'

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = (CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8)) >>> 0
  return (c ^ 0xffffffff) >>> 0
}

interface ZipEntry {
  name: string
  data: Buffer
  mode: number // permisiuni unix (ex. 0o755 pentru executabil)
}

function buildZip(entries: ZipEntry[]): Buffer {
  const localParts: Buffer[] = []
  const centralParts: Buffer[] = []
  let offset = 0
  const DOS_TIME = 0
  const DOS_DATE = 0x21 // 1980-01-01, dată fixă → zip determinist

  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8')
    const data = e.data
    const crc = crc32(data)
    const size = data.length

    const lh = Buffer.alloc(30)
    lh.writeUInt32LE(0x04034b50, 0) // semnătură local file header
    lh.writeUInt16LE(20, 4) // versiune necesară
    lh.writeUInt16LE(0, 6) // flaguri
    lh.writeUInt16LE(0, 8) // metoda: STORE
    lh.writeUInt16LE(DOS_TIME, 10)
    lh.writeUInt16LE(DOS_DATE, 12)
    lh.writeUInt32LE(crc, 14)
    lh.writeUInt32LE(size, 18) // dimensiune comprimată
    lh.writeUInt32LE(size, 22) // dimensiune necomprimată
    lh.writeUInt16LE(name.length, 26)
    lh.writeUInt16LE(0, 28) // lungime extra
    localParts.push(lh, name, data)

    const ch = Buffer.alloc(46)
    ch.writeUInt32LE(0x02014b50, 0) // semnătură central directory
    ch.writeUInt16LE(0x031e, 4) // făcut de: unix (3), zip 3.0
    ch.writeUInt16LE(20, 6)
    ch.writeUInt16LE(0, 8)
    ch.writeUInt16LE(0, 10)
    ch.writeUInt16LE(DOS_TIME, 12)
    ch.writeUInt16LE(DOS_DATE, 14)
    ch.writeUInt32LE(crc, 16)
    ch.writeUInt32LE(size, 20)
    ch.writeUInt32LE(size, 24)
    ch.writeUInt16LE(name.length, 28)
    ch.writeUInt16LE(0, 30) // extra
    ch.writeUInt16LE(0, 32) // comentariu
    ch.writeUInt16LE(0, 34) // disc
    ch.writeUInt16LE(0, 36) // atribute interne
    // atribute externe: modul unix în cei 16 biți superiori (bit 0o100000 = fișier normal)
    ch.writeUInt32LE(((((e.mode & 0xfff) | 0o100000) & 0xffff) << 16) >>> 0, 38)
    ch.writeUInt32LE(offset, 42) // offset-ul local header-ului
    centralParts.push(ch, name)

    offset += lh.length + name.length + data.length
  }

  const central = Buffer.concat(centralParts)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0) // end of central directory
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(central.length, 12)
  eocd.writeUInt32LE(offset, 16) // offset-ul central directory
  eocd.writeUInt16LE(0, 20)

  return Buffer.concat([...localParts, central, eocd])
}

const DESKTOP = `[Desktop Entry]
Version=1.0
Type=Application
Name=Kelionai
GenericName=Asistent AI
Comment=Asistentul tău AI — kelionai.app
Exec=sh -c 'u=https://kelionai.app; for b in google-chrome google-chrome-stable chromium chromium-browser microsoft-edge brave-browser vivaldi-stable; do command -v "$b" >/dev/null 2>&1 && exec "$b" --app="$u"; done; xdg-open "$u"'
Icon=kelionai
Terminal=false
Categories=Utility;Network;Chat;
StartupWMClass=kelionai.app
Keywords=AI;asistent;chat;voce;
`

const INSTALL = `#!/bin/sh
# Instalează Kelionai ca aplicație Linux (deschide kelionai.app într-o fereastră dedicată).
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
APPS="$HOME/.local/share/applications"
ICONS="$HOME/.local/share/icons/hicolor/512x512/apps"
mkdir -p "$APPS" "$ICONS"
if [ -f "$DIR/kelionai.png" ]; then
  cp "$DIR/kelionai.png" "$ICONS/kelionai.png"
  sed "s|^Icon=kelionai$|Icon=$ICONS/kelionai.png|" "$DIR/Kelionai.desktop" > "$APPS/Kelionai.desktop"
else
  cp "$DIR/Kelionai.desktop" "$APPS/Kelionai.desktop"
fi
chmod +x "$APPS/Kelionai.desktop" 2>/dev/null || true
update-desktop-database "$APPS" 2>/dev/null || true
echo "Kelionai instalat. Caută 'Kelionai' în meniul de aplicații."
`

const README = `Kelionai — aplicația pentru Linux
=================================

Kelionai este o aplicație web. Acest pachet instalează un lansator nativ care
deschide Kelionai într-o fereastră dedicată (mod „app"), folosind browserul tău.

INSTALARE (un singur pas):
  1. Dezarhivează.
  2. Rulează:  sh install.sh
  3. Caută „Kelionai" în meniul de aplicații.

Sau, fără instalare, deschide direct: https://kelionai.app

Aplicația se actualizează singură — încarcă mereu ultima versiune live.
`

let cached: Buffer | null = null

// Construiește (o dată, apoi cache) pachetul .zip pentru Linux. `distPath` = folderul
// frontend-ului servit, de unde luăm iconița dacă există.
export function buildLinuxZip(distPath: string): Buffer {
  if (cached) return cached
  const entries: ZipEntry[] = [
    { name: 'Kelionai.desktop', data: Buffer.from(DESKTOP, 'utf8'), mode: 0o644 },
    { name: 'install.sh', data: Buffer.from(INSTALL, 'utf8'), mode: 0o755 },
    { name: 'README.txt', data: Buffer.from(README, 'utf8'), mode: 0o644 },
  ]
  try {
    const logo = path.resolve(distPath, 'kelion-logo.png')
    if (fs.existsSync(logo)) {
      entries.push({ name: 'kelionai.png', data: fs.readFileSync(logo), mode: 0o644 })
    }
  } catch {
    /* fără iconiță — lansatorul cade pe iconița temei */
  }
  cached = buildZip(entries)
  return cached
}
