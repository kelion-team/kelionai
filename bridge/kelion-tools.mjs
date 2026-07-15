// kelion-tools.mjs — Unelte native pentru Kelion
// Kelion poate folosi aceste functii direct, fara sa astepte ordine de la exterior

import { execSync, spawn } from 'child_process';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const REPO_DIR = '/root/kelion/repo';

// ── Shell ──
export function exec(cmd, cwd = REPO_DIR) {
  try {
    const out = execSync(cmd, { cwd, encoding: 'utf8', timeout: 120000 });
    return { ok: true, stdout: out };
  } catch (e) {
    return { ok: false, error: e.stderr || e.message };
  }
}

// ── Fișiere ──
export function read(path) {
  const full = resolve(REPO_DIR, path);
  if (!existsSync(full)) return { ok: false, error: 'not_found' };
  return { ok: true, content: readFileSync(full, 'utf8') };
}

export function write(path, content) {
  const full = resolve(REPO_DIR, path);
  writeFileSync(full, content, 'utf8');
  return { ok: true };
}

// ── Git ──
export function gitAdd(files = '.') {
  return exec(`git add ${files}`);
}

export function gitCommit(msg) {
  return exec(`git commit -m "${msg.replace(/"/g, '\\"')}"`);
}

export function gitPush(branch = 'master') {
  return exec(`git push origin ${branch}`);
}

export function gitPull() {
  return exec('git pull origin master');
}

// ── npm ──
export function npmInstall(pkg) {
  return exec(pkg ? `npm install ${pkg}` : 'npm ci');
}

export function npmBuild() {
  return exec('npm run build');
}

export function npmTest() {
  return exec('npm test');
}

// ── API Kimi ──
export async function callKimi(prompt, model = 'kimi-latest') {
  const key = process.env.KIMI_API_KEY;
  if (!key) return { ok: false, error: 'KIMI_API_KEY missing' };
  const res = await fetch('https://api.moonshot.cn/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], max_tokens: 4000 })
  });
  const data = await res.json();
  return { ok: res.ok, data };
}

// ── API GLM ──
export async function callGlm(prompt, model = 'glm-4-flash') {
  const key = process.env.GLM_API_KEY;
  if (!key) return { ok: false, error: 'GLM_API_KEY missing' };
  const res = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], max_tokens: 4000 })
  });
  const data = await res.json();
  return { ok: res.ok, data };
}

// ── Căutare în cod ──
export function grep(pattern, dir = 'backend/src') {
  return exec(`grep -rni "${pattern.replace(/"/g, '\\"')}" ${dir} --include="*.ts" --include="*.tsx" --include="*.js" --include="*.mjs"`);
}

// ── Status sistem ──
export function systemStatus() {
  return exec('top -bn1 | head -20 && df -h && free -h');
}

// ── Deploy Railway via kelion-github ──
export function deploy() {
  return exec('npx kelion-github deploy');
}

// ── Log util ──
export function log(msg) {
  console.log(`[KELION ${new Date().toISOString()}] ${msg}`);
}
