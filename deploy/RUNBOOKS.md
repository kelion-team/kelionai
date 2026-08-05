# RUNBOOK-URI — proceduri numite, comenzi EXACTE (AI-HANDOFF §14.b C)

**Regula:** operațiunile care trebuie să fie exacte și repetabile (publicare,
diagnostic, repornire, curățenie) NU se „interpretează" de un LLM — se rulează
runbook-ul numit. LLM-ul doar RECUNOAȘTE care runbook se potrivește. Toate se
declanșează din GitHub → Actions, fără parole (SSH-ul folosește secretul
`VPS_SSH_KEY`). Dovada = jurnalul jobului, nu o afirmație.

| Runbook | Când îl folosești | Cum |
|---|---|---|
| **publish-master** | publici un release aprobat / re-publici master | Actions → workflow **`deploy`** → Run workflow. Rulează AUTOMAT și la fiecare push pe master (merge = aprobarea). Verifică singur anti-fantoma: live `v` == sha `origin/master` + health 200; fără dovadă → roșu. |
| **diagnostic** | ORICE eșec sau comportament ciudat — întâi faptele | Actions → **`vps-diag`** → Run workflow. Nu trage concluzii înainte să citești ieșirea. Doar citire, nu modifică nimic. |
| **sentinel-now** | vrei verificarea de sănătate imediat (nu aștepți cron-ul de 30 min) | Actions → **`sentinel`** → Run workflow. |
| **comandă-liberă** | orice altă operațiune punctuală pe VPS | Actions → **`vps-run`** → `cmd`: comanda bash exactă (rulează ca root). |
| **set-env / chei** | pui/rotești un secret pe VPS (mascat, nu prin chat) | Actions → **`vps-set-env`** / **`vps-set-key`** / **`vps-keys`**. |

## Comenzi utile prin `vps-run` (exacte, copiabile)

- Repornește aplicația: `docker restart kelionai-app`
- Ultimele loguri ale aplicației: `docker logs --tail 100 kelionai-app`
- Repornește Caddy: `docker restart kelion-caddy`
- Backup DB acum: `/root/kelion/backup.sh`
- Curăță procese-zombie: `pkill -9 -f 'kelion-repairer-pool|kelion-builder-server|kelion-bridge-linux' || true`

## Publicare manuală (SSH de pe mașina lui Adrian, fără workflow)

```bash
cd /root/kelion/repo && git fetch origin master \
  && git show origin/master:deploy/deploy.sh > /tmp/kelion-deploy.sh \
  && KELION_DEPLOY_COPY=1 bash /tmp/kelion-deploy.sh master
```

**Nu rula `deploy.sh` direct din clonă**: pasul lui de `git checkout` rescrie
fișierul chiar în timp ce bash îl execută (execuție coruptă). Scriptul are și el
o gardă pentru asta (se copiază singur în /tmp), dar forma de mai sus e cea
canonică — rulează exact versiunea din `origin/master`.

## 9. `instaleaza-pachet-sistem` — instalare pachet apt de sistem
- **Workflow**: `vps-run.yml`
- **Descriere**: Instalează un pachet de sistem pe VPS (`apt-get`) în mod securizat.
- **Parametri**: `pachet` (ex: `ffmpeg`, `htop`). Numele este validat cu regex strict (`/^[a-zA-Z0-9_+.-]+$/`).
- **Rol**: Operație privilegiată pe VPS executată prin runbook.

