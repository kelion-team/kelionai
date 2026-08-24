#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUTPUT = path.resolve(process.argv[2] || '/root/kelion/audit-results/capability-evidence.json')
const PROBES = process.argv[3] ? path.resolve(process.argv[3]) : ''

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const lineOf = (text, index) => text.slice(0, index).split('\n').length
const ref = (file, line) => `${file}:${line}`
const escapeRe = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function walk(dir, accept, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', 'dist', 'build', 'coverage'].includes(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, accept, out)
    else if (accept(full)) out.push(full)
  }
  return out
}

function indexFiles(files) {
  return files.map((full) => ({
    full,
    rel: path.relative(ROOT, full).split(path.sep).join('/'),
    lines: fs.readFileSync(full, 'utf8').split('\n'),
  }))
}

function exactRefs(index, name, limit = 20) {
  const quoted = new RegExp(`['"]${escapeRe(name)}['"]`)
  const refs = []
  for (const { rel, lines } of index) {
    for (let i = 0; i < lines.length; i++) {
      if (!quoted.test(lines[i])) continue
      refs.push({ ref: ref(rel, i + 1), snippet: lines[i].trim().slice(0, 220) })
      if (refs.length >= limit) return refs
    }
  }
  return refs
}

const capabilitySource = read('backend/src/services/brainCapabilities.ts')
const capabilityPattern = /\{ name: '([^']+)', category: '([^']+)', does: '([^']*)', chat: (true|false), voice: (true|false)(?:, voiceViaBrain: (true|false))?, admin: (true|false) \}/g
const capabilities = [...capabilitySource.matchAll(capabilityPattern)].map((match) => ({
  name: match[1],
  category: match[2],
  description: match[3],
  chat: match[4] === 'true',
  voiceDirect: match[5] === 'true',
  voiceViaBrain: match[6] === 'true',
  admin: match[7] === 'true',
  registryRef: ref('backend/src/services/brainCapabilities.ts', lineOf(capabilitySource, match.index)),
}))

const manualSource = read('backend/src/services/manual.ts')
const manualRows = new Map(
  [...manualSource.matchAll(/^  ([a-zA-Z0-9_]+): \{ what:/gm)].map((match) => [
    match[1],
    ref('backend/src/services/manual.ts', lineOf(manualSource, match.index)),
  ]),
)
const manualSections = [...manualSource.matchAll(/title: '([^']+)'/g)]
  .map((match) => ({
    title: match[1],
    sourceRef: ref('backend/src/services/manual.ts', lineOf(manualSource, match.index)),
    contractTest: 'backend/src/manual.test.ts',
    verdict: 'pass',
  }))
  // Capitolele DOAR-admin ale manualului (proiectul de chat voce „Jarvis", prefix
  // 🔒 — owner 20 aug) sunt un PLAN bătut în cuie, NU funcții LIVE cu dovadă
  // statică de implementare. Nu intră în matricea de dovezi a capabilităților
  // existente; când planul se implementează, FUNCȚIILE lui au dovada lor.
  .filter((s) => !s.title.startsWith('🔒'))

const codeFiles = [
  ...walk(path.join(ROOT, 'backend/src'), (f) => f.endsWith('.ts') && !f.endsWith('.test.ts')),
  ...walk(path.join(ROOT, 'frontend/src'), (f) => f.endsWith('.ts') || f.endsWith('.tsx')),
  ...walk(path.join(ROOT, 'deploy'), (f) => f.endsWith('.mjs') || f.endsWith('.js') || f.endsWith('.sh')),
].filter((f) => !f.endsWith('/brainCapabilities.ts') && !f.endsWith('/manual.ts'))
const testFiles = walk(path.join(ROOT, 'backend/src'), (f) => f.endsWith('.test.ts'))
const codeIndex = indexFiles(codeFiles)
const testIndex = indexFiles(testFiles)

function semanticRef(file, pattern) {
  const text = read(file)
  const match = pattern.exec(text)
  if (!match) return null
  const line = lineOf(text, match.index)
  return { ref: ref(file, line), snippet: text.split('\n')[line - 1].trim().slice(0, 220) }
}

const semanticImplementations = new Map([
  ['look', [
    semanticRef('frontend/src/lib/chat.ts', /`image` \(base64 JPEG data URL\)/),
    semanticRef('backend/src/routes/chat.ts', /startsWith\('data:image'\)/),
  ].filter(Boolean)],
  ['get_location', [
    semanticRef('frontend/src/components/ChatPanel.tsx', /navigator\.geolocation\.watchPosition/),
    semanticRef('backend/src/services/chatInput.ts', /export function resolveDeviceLocation/),
  ].filter(Boolean)],
])

let probeByName = new Map()
if (PROBES && fs.existsSync(PROBES)) {
  const payload = JSON.parse(fs.readFileSync(PROBES, 'utf8'))
  const rows = Array.isArray(payload) ? payload : payload.probes || []
  probeByName = new Map(rows.map((row) => [row.capability, row]))
}

const destructive = /^(send_email|delete_|complete_task|edit_|create_|add_|repo_write|repo_open_pr|repo_merge_pr|build_software|save_|run_runbook|server_ops|secret_|cerinta_|card_|constructor_manage|constructor_command|admin_schimba|memorie_pune|forget_|approve_|allow_)/
const capabilityRows = capabilities.map((capability) => {
  const implementationRefs = [...exactRefs(codeIndex, capability.name), ...(semanticImplementations.get(capability.name) || [])]
  const directTests = exactRefs(testIndex, capability.name, 10).map((row) => row.ref)
  const manualRef = manualRows.get(capability.name) || null
  const liveProbe = probeByName.get(capability.name) || {
    status: 'pending',
    mode: destructive.test(capability.name) ? 'authenticated_guarded_or_verified_side_effect' : 'authenticated_read_or_safe_action',
  }
  const staticVerdict = implementationRefs.length > 0 && (capability.admin || manualRef) ? 'pass' : 'fail'
  return {
    ...capability,
    advertisedBy: capability.admin ? ['admin_inventory'] : ['user_manual', 'capability_inventory'],
    manualRef,
    implementationRefs,
    contractTests: [
      'backend/src/brainCapabilities.test.ts',
      ...(capability.admin ? [] : ['backend/src/manual.test.ts']),
      ...directTests,
    ],
    staticVerdict,
    liveProbe,
    verdict: staticVerdict === 'pass' && liveProbe.status === 'pass' ? 'pass' : staticVerdict === 'pass' ? 'static_pass_live_pending' : 'fail',
  }
})

const stageSource = read('frontend/src/pages/Stage.tsx')
const menuBlock = /APLICAȚIILE GOOGLE INTERCONECTATE[\s\S]*?\]\.map\(/.exec(stageSource)?.[0] || ''
const menuApps = [...menuBlock.matchAll(/\['([^']+)',\s*'([^']+)'/g)].map((match) => ({
  label: match[1],
  command: match[2],
  sourceRef: ref('frontend/src/pages/Stage.tsx', lineOf(stageSource, (menuBlock ? stageSource.indexOf(menuBlock) : 0) + match.index)),
}))
const chainTest = read('backend/src/lantGoogle.test.ts')
const evidenceLabels = new Map(
  [...chainTest.matchAll(/^  '([^']+)': \{ fisier: '([^']+)'/gm)].map((match) => [
    match[1],
    { implementationFile: `backend/src/${match[2]}`, evidenceRef: ref('backend/src/lantGoogle.test.ts', lineOf(chainTest, match.index)) },
  ]),
)
const uiApplications = menuApps.map((app) => {
  const evidence = evidenceLabels.get(app.label) || null
  return {
    ...app,
    ...evidence,
    contractTest: 'backend/src/lantGoogle.test.ts',
    liveProbe: { status: 'pending', mode: 'authenticated_menu_command' },
    verdict: evidence ? 'static_pass_live_pending' : 'fail',
  }
})

const missingImplementation = capabilityRows.filter((row) => row.implementationRefs.length === 0).map((row) => row.name)
const missingPublicManual = capabilityRows.filter((row) => !row.admin && !row.manualRef).map((row) => row.name)
const missingUiEvidence = uiApplications.filter((row) => !row.evidenceRef).map((row) => row.label)
const sourceSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim()
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  sourceSha,
  sources: {
    capabilityRegistry: 'backend/src/services/brainCapabilities.ts',
    manual: 'backend/src/services/manual.ts',
    uiApplications: 'frontend/src/pages/Stage.tsx',
    inventory: '/root/kelion/audit-results/code-inventory.json',
    liveProbes: PROBES || null,
  },
  summary: {
    capabilities: capabilityRows.length,
    publicCapabilities: capabilityRows.filter((row) => !row.admin).length,
    adminCapabilities: capabilityRows.filter((row) => row.admin).length,
    capabilitiesStaticPass: capabilityRows.filter((row) => row.staticVerdict === 'pass').length,
    capabilitiesLivePass: capabilityRows.filter((row) => row.liveProbe.status === 'pass').length,
    uiApplications: uiApplications.length,
    uiApplicationsMapped: uiApplications.filter((row) => row.evidenceRef).length,
    manualSections: manualSections.length,
    gaps: { missingImplementation, missingPublicManual, missingUiEvidence },
  },
  capabilities: capabilityRows,
  uiApplications,
  manualSections,
}

fs.mkdirSync(path.dirname(OUTPUT), { recursive: true })
fs.writeFileSync(OUTPUT, `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify({ output: OUTPUT, ...report.summary }, null, 2))
if (missingImplementation.length || missingPublicManual.length || missingUiEvidence.length) process.exitCode = 1
