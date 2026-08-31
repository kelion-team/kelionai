# Checkpoint operațional curent

Actualizat: `2026-08-31T07:25:00Z`

## Stare verificată

- `origin/master` este la `58f39cfef1ae38157a29d1a0810a334263926c0e`.
- AI Constructor rămâne separat de Kelion și folosește exclusiv OpenCode
  `1.18.25` cu llama.cpp și `Qwen3.6-35B-A3B Q4_K_M` local pe Contabo.
- Modelul canonic este Qwen open-weight, licență Apache-2.0; fișierul GGUF
  instalat are `20,419,565,568` bytes și SHA-256
  `671e47e0ec53c665d048b98c3ecbfd5236b5ca9c3e02ed19fc8f81f7b85140c7`.
- Run-ul `33364953572` a verificat baza AI, accesul full-host, executorul
  OpenCode și heartbeat-ul HMAC, apoi a făcut rollback deoarece
  `kelion-constructor-sync.service` a încercat un `runuser` blocat de sandbox.
- Laptopul nu găzduiește modelul. Clientul Windows trebuie să folosească
  `https://kelionai.app` și aceeași coadă procesată de workerul Contabo.

## Schimbarea în curs

- Serviciul de sincronizare rulează direct ca `kelion-codex`, fără schimbare
  de UID în interiorul unui serviciu sandboxat.
- `NoNewPrivileges`, `RestrictSUIDSGID`, `ProtectSystem=strict` și seturile
  goale de capabilități rămân fail-closed.
- Unitatea systemd este transportată, instalată atomic, inclusă în rollback și
  verificată prin SHA-256, stare efectivă systemd, jurnal și claim real de coadă.

## Prag de finalizare

Nu se raportează finalizat până când finalizerul Contabo, claimul real al
workerului și verificarea clientului Windows nu sunt toate verzi pentru același
commit. Installerul Windows se publică numai semnat, după integrarea canonică.

## Legături canonice

- Finalizare Contabo: <https://github.com/kelion-team/kelionai/actions/workflows/private-ai-finalize.yml>
- Cerință/client: <https://github.com/kelion-team/kelionai/pull/1554>
- Aplicație: <https://kelionai.app>

