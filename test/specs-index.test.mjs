// specs/index.json is derived from specs/*.yaml, and says so by agreeing
// with them. A stale index is worse than none: a consumer would pin a client
// to a version and a digest that the file no longer has, and nothing on its
// side could tell.
//
// This file, and scripts/index-specs.mjs beside it, are the openapi-index/1
// pattern carried over verbatim from flashy-contracts (see README, "Where
// this came from"). Only the repository-specific expectations below —
// which specs are published, that there is exactly one — differ from the
// source.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  CONTRACT, ROOT, SPECS_DIR, INDEX_FILE,
  buildIndex, drift, infoField, readIndex, sha256,
} from '../scripts/index-specs.mjs'

const SCRIPT = join(ROOT, 'scripts', 'index-specs.mjs')
const committed = readIndex()
const computed = buildIndex()

test('the index carries the openapi-index/1 contract and a real timestamp', () => {
  assert.equal(committed.contract, CONTRACT)
  assert.equal(committed.contract, 'openapi-index/1')
  assert.match(committed.generated, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/)
  assert.deepEqual(Object.keys(committed).sort(), ['contract', 'generated', 'specs'])
})

test('the committed index agrees with every file under specs/, byte for byte', () => {
  assert.deepEqual(drift(committed, computed), [])
  const yamls = readdirSync(join(ROOT, SPECS_DIR)).filter((f) => /\.ya?ml$/.test(f))
  assert.equal(committed.specs.length, yamls.length, 'one row per OpenAPI document, no more')
  for (const spec of committed.specs) {
    assert.deepEqual(Object.keys(spec).sort(), ['name', 'path', 'sha256', 'version'])
    assert.equal(spec.sha256, sha256(readFileSync(join(ROOT, spec.path))), `${spec.name}: digest`)
    assert.match(spec.version, /^\d+\.\d+\.\d+$/, `${spec.name}: info.version is semver`)
    assert.match(spec.name, /\.v\d+$/, `${spec.name}: the filename carries the major`)
    assert.equal(spec.path, `${SPECS_DIR}/${spec.name}.yaml`)
    // The filename's major and info.version's major are the same statement.
    assert.equal(spec.name.split('.v').pop(), spec.version.split('.')[0],
      `${spec.name}: filename major disagrees with info.version ${spec.version}`)
  }
})

test('wallet.v1 — the one spec this repository publishes — is indexed, and nothing else is', () => {
  const names = committed.specs.map((s) => s.name)
  assert.deepEqual(names, ['wallet.v1'])
})

test('the committed wallet.v1 is byte-identical to the one it was moved from', () => {
  // Pinned so a future edit here is a deliberate decision, not drift from the
  // copy — the exact digest flashy-contracts/specs/index.json recorded for
  // wallet.v1 at the moment this repository was created from it.
  const spec = committed.specs.find((s) => s.name === 'wallet.v1')
  assert.equal(spec.sha256, 'c156c125c34186b037b0da1eca6812ce65e678fc7da101c6060cf2ea83c2e1cf')
})

test('--check passes against the committed tree', () => {
  const out = execFileSync(process.execPath, [SCRIPT, '--check'], { cwd: ROOT, encoding: 'utf8' })
  assert.match(out, /agrees with \d+ spec/)
})

test('a changed byte in a spec is reported as drift, by name and field', () => {
  const dir = mkdtempSync(join(tmpdir(), 'specs-index-'))
  try {
    mkdirSync(join(dir, SPECS_DIR))
    for (const spec of committed.specs) {
      writeFileSync(join(dir, spec.path), readFileSync(join(ROOT, spec.path)))
    }
    writeFileSync(join(dir, SPECS_DIR, INDEX_FILE), JSON.stringify(committed))
    assert.deepEqual(drift(readIndex(dir), buildIndex(dir)), [], 'the copy starts in agreement')

    const target = committed.specs[0]
    const text = readFileSync(join(dir, target.path), 'utf8')
    writeFileSync(join(dir, target.path), text.replace(/^ {2}version: .*$/m, '  version: 9.9.9'))
    const problems = drift(readIndex(dir), buildIndex(dir))
    assert.ok(problems.some((p) => p.startsWith(`${target.name}.version:`)), problems.join('\n'))
    assert.ok(problems.some((p) => p.startsWith(`${target.name}.sha256:`)), problems.join('\n'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a spec that is not in the index, and an index row with no spec, are both drift', () => {
  const extra = { ...computed, specs: [...computed.specs, { name: 'ghost.v1', version: '1.0.0', path: 'specs/ghost.v1.yaml', sha256: 'f'.repeat(64) }] }
  assert.ok(drift(extra, computed).some((p) => p.startsWith('ghost.v1: in the index but no such file')))
  // There is only one spec here, so an index with none in it is the "missing"
  // case — drift() still reports it as a missing row, not an empty agreement.
  assert.ok(drift({ ...computed, specs: [] }, computed).some((p) => p.endsWith('missing from the index')))
})

test('the info reader refuses a file with no version rather than guessing one', () => {
  assert.equal(infoField('openapi: 3.1.0\ninfo:\n  title: X\n  version: "2.0.0"\npaths: {}\n', 'version'), '2.0.0')
  assert.throws(() => infoField('openapi: 3.1.0\ninfo:\n  title: X\npaths: {}\n', 'version'), /info\.version not found/)
  assert.throws(() => infoField('openapi: 3.1.0\npaths: {}\n', 'version'), /no top-level "info:" block/)
  // A `version:` under some other block is not info.version.
  assert.throws(() => infoField('info:\n  title: X\ncomponents:\n  version: 1.0.0\n', 'version'), /not found/)
})

test('the indexer imports only node: builtins, so it runs on a bare checkout', () => {
  const src = readFileSync(SCRIPT, 'utf8')
  const imports = [...src.matchAll(/^import .* from '([^']+)'/gm)].map((m) => m[1])
  assert.ok(imports.length > 0)
  assert.deepEqual(imports.filter((i) => !i.startsWith('node:')), [])
})

test('nothing in this repository claims the index is served', () => {
  // The URL pattern documented in the README is where it WOULD live if this
  // repository ever grows a served surface. There is none today — no
  // deployment, no .well-known directory — and the README says so.
  const readme = readFileSync(join(ROOT, 'README.md'), 'utf8')
  assert.match(readme, /openapi-index\/1/)
  assert.match(readme, /Nothing serves (them|it) today/i)
})
