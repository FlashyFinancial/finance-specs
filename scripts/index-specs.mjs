#!/usr/bin/env node
// openapi-index/1 — the machine-readable table of contents for specs/.
//
// A consumer generating a client, or a survey asking "which contracts does
// this repository publish and at what version", should not have to list a
// directory and parse YAML to find out. `specs/index.json` answers in one
// read: for every OpenAPI document under specs/, its name (the filename stem,
// which carries the major: `wallet.v1`), its `info.version`, its path
// relative to the repository root, and the sha256 of its exact bytes — so a
// copy somewhere else can be checked against what this repository holds.
//
// Dependency-free: node: builtins only, so it runs on a checkout with no
// node_modules. The YAML "parser" reads exactly one thing — the top-level
// `info:` block's `version:` line — and refuses a file where it cannot find
// it, rather than guessing. That is deliberately not a YAML parser; a spec
// exotic enough to defeat it is a spec `npm run lint:specs` should look at.
//
//   node scripts/index-specs.mjs            # write specs/index.json
//   node scripts/index-specs.mjs --check    # exit 1 if it disagrees with specs/
//
// `generated` is the one field that changes on every write, so --check and
// test/specs-index.test.mjs compare everything except it.
//
// Nothing serves this file today. If this repository ever gains a served
// surface the index belongs at /.well-known/openapi-index.json and each spec
// at /<path> — the `path` values are already relative to a root for that
// reason. Until then the committed file is the whole of it.

import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const CONTRACT = 'openapi-index/1'
export const SPECS_DIR = 'specs'
export const INDEX_FILE = 'index.json'

const HERE = dirname(fileURLToPath(import.meta.url))
export const ROOT = resolve(HERE, '..')

const SPEC_FILE = /\.ya?ml$/

/** `info.<field>` from the top-level info block, unquoted. Throws if absent. */
export function infoField(yaml, field, file = '<yaml>') {
  const lines = yaml.split(/\r?\n/)
  const start = lines.findIndex((l) => /^info:\s*$/.test(l))
  if (start === -1) throw new Error(`${file}: no top-level "info:" block`)
  const want = new RegExp(`^  ${field}:\\s*(.+?)\\s*$`)
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]
    if (line.length > 0 && /^\S/.test(line)) break // left the info block
    const m = want.exec(line)
    if (m) return m[1].replace(/^(['"])(.*)\1$/, '$2')
  }
  throw new Error(`${file}: info.${field} not found in the info block`)
}

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

/** The index as computed from the files under <root>/specs, right now. */
export function buildIndex(root = ROOT, now = new Date()) {
  const dir = join(root, SPECS_DIR)
  const files = readdirSync(dir).filter((f) => SPEC_FILE.test(f)).sort()
  if (files.length === 0) throw new Error(`${dir}: no OpenAPI documents found`)
  const specs = files.map((file) => {
    const bytes = readFileSync(join(dir, file))
    const text = bytes.toString('utf8')
    if (!/^openapi:\s*3\./m.test(text)) throw new Error(`${file}: not an OpenAPI 3 document`)
    return {
      name: file.replace(SPEC_FILE, ''),
      version: infoField(text, 'version', file),
      path: `${SPECS_DIR}/${file}`,
      sha256: sha256(bytes),
    }
  })
  return { contract: CONTRACT, generated: now.toISOString(), specs }
}

export function readIndex(root = ROOT) {
  return JSON.parse(readFileSync(join(root, SPECS_DIR, INDEX_FILE), 'utf8'))
}

/** Every way `committed` disagrees with `computed`, ignoring `generated`. */
export function drift(committed, computed) {
  const out = []
  if (committed.contract !== computed.contract) {
    out.push(`contract: committed ${JSON.stringify(committed.contract)}, expected ${JSON.stringify(computed.contract)}`)
  }
  if (typeof committed.generated !== 'string' || Number.isNaN(Date.parse(committed.generated))) {
    out.push('generated: not an ISO 8601 timestamp')
  }
  const byName = (list) => new Map((list ?? []).map((s) => [s.name, s]))
  const have = byName(committed.specs)
  const want = byName(computed.specs)
  for (const [name, spec] of want) {
    const c = have.get(name)
    if (!c) { out.push(`${name}: missing from the index`); continue }
    for (const key of ['version', 'path', 'sha256']) {
      if (c[key] !== spec[key]) out.push(`${name}.${key}: committed ${JSON.stringify(c[key])}, file says ${JSON.stringify(spec[key])}`)
    }
    const extra = Object.keys(c).filter((k) => !['name', 'version', 'path', 'sha256'].includes(k))
    if (extra.length) out.push(`${name}: unknown keys ${extra.join(', ')}`)
  }
  for (const name of have.keys()) {
    if (!want.has(name)) out.push(`${name}: in the index but no such file under ${SPECS_DIR}/`)
  }
  const order = (committed.specs ?? []).map((s) => s.name)
  if (order.join('\n') !== [...order].sort().join('\n')) out.push('specs are not sorted by name')
  return out
}

function main(argv) {
  const check = argv.includes('--check')
  const computed = buildIndex()
  const target = join(ROOT, SPECS_DIR, INDEX_FILE)
  if (check) {
    let committed
    try {
      committed = readIndex()
    } catch (err) {
      console.error(`specs/index.json: cannot read (${err.message}). Run: node scripts/index-specs.mjs`)
      return 1
    }
    const problems = drift(committed, computed)
    if (problems.length) {
      console.error('specs/index.json disagrees with specs/:')
      for (const p of problems) console.error(`  - ${p}`)
      console.error('Run: node scripts/index-specs.mjs')
      return 1
    }
    console.log(`specs/index.json agrees with ${computed.specs.length} spec(s)`)
    return 0
  }
  writeFileSync(target, `${JSON.stringify(computed, null, 2)}\n`)
  console.log(`wrote ${target} (${computed.specs.map((s) => `${s.name}@${s.version}`).join(', ')})`)
  return 0
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)))
}
