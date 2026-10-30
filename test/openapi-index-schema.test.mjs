// schema/openapi-index-1.json is the published shape of specs/index.json, and
// it is held to the generator rather than to a memory of it.
//
// What this adds, and what it does not. The key set and the patterns of the
// index are already asserted, one by one, in test/specs-index.test.mjs. Those
// assertions live inside a test file; a consumer who wants to validate the
// index they fetched cannot import them. The schema is the same claim as a file
// they can: `contract`, `generated` and `specs`, and in each row exactly `name`,
// `version`, `path` and `sha256`. So this file does not add protection to the
// index. It stops the PUBLISHED shape from drifting away from the index, which
// is the one way a schema is worse than none: a schema that admits a document
// the generator would never write, or refuses one it does, is a second opinion
// that is wrong in a way nobody sees.
//
// Dependency-free on purpose. This repository declares no JSON-Schema validator
// and a test must not pull one in transitively, so the checker below is a
// structural subset of draft 2020-12 — exactly the keywords the schema uses
// (type, const, pattern, format: date-time, minItems, items, properties,
// required, additionalProperties: false, a local $ref) and nothing more. It
// refuses a schema keyword it does not implement, so adding one to the schema
// without teaching the checker fails here instead of being silently ignored.
// A consumer should validate with a real implementation; this file proves the
// schema is worth handing them.
//
// The generator is the source. Its output is built here from the real
// `buildIndex()`, with a fixed clock, and the schema's key sets and its
// `contract` constant are compared with what that call returns. A key added to
// the generator fails here until the schema learns it.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { CONTRACT, ROOT, buildIndex, readIndex } from '../scripts/index-specs.mjs'

const SCHEMA = JSON.parse(readFileSync(join(ROOT, 'schema', 'openapi-index-1.json'), 'utf8'))
const FIXED_CLOCK = new Date('2026-01-02T03:04:05.678Z')

// ---------------------------------------------------------------------------
// A minimal draft 2020-12 structural check.

const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/
const IMPLEMENTED = new Set([
  '$schema', 'title', 'description', '$defs', '$ref',
  'type', 'const', 'pattern', 'format', 'minItems', 'items',
  'properties', 'required', 'additionalProperties',
])

const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v)

function resolve(schema, root) {
  if (!schema.$ref) return schema
  assert.ok(schema.$ref.startsWith('#/'), `only local refs are supported: ${schema.$ref}`)
  let target = root
  for (const part of schema.$ref.slice(2).split('/')) target = target?.[part]
  assert.ok(target, `dangling $ref ${schema.$ref}`)
  const { $ref, ...siblings } = schema
  void $ref
  return { ...resolve(target, root), ...siblings }
}

/** Every problem with `value` against `schemaIn`, as strings. Empty means valid. */
function problems(value, schemaIn, root = schemaIn, path = '$') {
  const schema = resolve(schemaIn, root)
  for (const keyword of Object.keys(schema)) {
    assert.ok(IMPLEMENTED.has(keyword), `the schema uses "${keyword}", which this checker does not implement — teach it before relying on the result`)
  }
  const out = []
  const actual = typeOf(value)

  if (schema.type !== undefined && schema.type !== actual) out.push(`${path}: expected ${schema.type}, got ${actual}`)
  if (schema.const !== undefined && value !== schema.const) out.push(`${path}: expected const ${JSON.stringify(schema.const)}`)

  if (actual === 'string') {
    if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)) out.push(`${path}: "${value}" does not match ${schema.pattern}`)
    if (schema.format === 'date-time' && !(DATE_TIME.test(value) && !Number.isNaN(Date.parse(value)))) {
      out.push(`${path}: "${value}" is not an RFC 3339 date-time`)
    }
  }
  if (actual === 'array') {
    if (schema.minItems !== undefined && value.length < schema.minItems) out.push(`${path}: fewer than ${schema.minItems} items`)
    if (schema.items !== undefined) value.forEach((item, i) => out.push(...problems(item, schema.items, root, `${path}[${i}]`)))
  }
  if (actual === 'object') {
    const props = schema.properties ?? {}
    for (const key of schema.required ?? []) if (!(key in value)) out.push(`${path}: missing required "${key}"`)
    for (const [key, child] of Object.entries(value)) {
      if (key in props) out.push(...problems(child, props[key], root, `${path}.${key}`))
      else if (schema.additionalProperties === false) out.push(`${path}.${key}: unknown key refused`)
    }
  }
  return out
}

const clone = (v) => JSON.parse(JSON.stringify(v))

// ---------------------------------------------------------------------------

test('the schema declares draft 2020-12 and refuses unknown keys at both levels', () => {
  assert.equal(SCHEMA.$schema, 'https://json-schema.org/draft/2020-12/schema')
  assert.equal(SCHEMA.additionalProperties, false)
  assert.equal(SCHEMA.$defs.spec.additionalProperties, false)
})

test('every property the schema declares is required, so no key is optional in the published shape', () => {
  assert.deepEqual([...SCHEMA.required].sort(), Object.keys(SCHEMA.properties).sort())
  assert.deepEqual([...SCHEMA.$defs.spec.required].sort(), Object.keys(SCHEMA.$defs.spec.properties).sort())
})

test('the schema names exactly the keys the generator writes, and its contract constant', () => {
  const built = buildIndex(ROOT, FIXED_CLOCK)
  assert.ok(built.specs.length > 0, 'the generator found no spec, so there is no row to compare')
  assert.deepEqual(Object.keys(SCHEMA.properties).sort(), Object.keys(built).sort())
  assert.deepEqual(Object.keys(SCHEMA.$defs.spec.properties).sort(), Object.keys(built.specs[0]).sort())
  assert.equal(SCHEMA.properties.contract.const, CONTRACT)
  assert.equal(SCHEMA.properties.contract.const, 'openapi-index/1')
})

test('an index built now by the real generator validates', () => {
  const built = buildIndex(ROOT, FIXED_CLOCK)
  assert.deepEqual(problems(built, SCHEMA), [])
})

test('the committed specs/index.json validates', () => {
  const committed = readIndex()
  assert.deepEqual(problems(committed, SCHEMA), [])
})

// Each bad case starts from a VALID index and changes one thing, so the only
// reason it can be refused is that thing. A case that also broke something
// else would still fail when its own rule was deleted from the schema.
const GOOD = buildIndex(ROOT, FIXED_CLOCK)
const mutate = (fn) => {
  const doc = clone(GOOD)
  fn(doc)
  return doc
}

const REFUSED = [
  ['a different contract identifier', (d) => { d.contract = 'openapi-index/2' }, /\$\.contract: expected const/],
  ['no contract', (d) => { delete d.contract }, /missing required "contract"/],
  ['no generated', (d) => { delete d.generated }, /missing required "generated"/],
  ['generated as a number', (d) => { d.generated = 1767323045678 }, /\$\.generated: expected string, got number/],
  ['generated as a date with no time', (d) => { d.generated = '2026-01-02' }, /not an RFC 3339 date-time/],
  ['generated with no zone', (d) => { d.generated = '2026-01-02T03:04:05' }, /not an RFC 3339 date-time/],
  ['specs missing', (d) => { delete d.specs }, /missing required "specs"/],
  ['specs as an object', (d) => { d.specs = { wallet: {} } }, /\$\.specs: expected array, got object/],
  ['specs empty', (d) => { d.specs = [] }, /fewer than 1 items/],
  ['an unknown top-level key', (d) => { d.note = 'hi' }, /\$\.note: unknown key refused/],
  ['an x- extension at the top, which the schema does not admit', (d) => { d['x-note'] = 'hi' }, /\$\.x-note: unknown key refused/],
  ['an unknown key in a row', (d) => { d.specs[0].etag = 'abc' }, /\$\.specs\[0\]\.etag: unknown key refused/],
  ['an x- extension in a row, which drift() also refuses', (d) => { d.specs[0]['x-owner'] = 'a' }, /unknown key refused/],
  ['a row with no name', (d) => { delete d.specs[0].name }, /missing required "name"/],
  ['a row with no version', (d) => { delete d.specs[0].version }, /missing required "version"/],
  ['a row with no path', (d) => { delete d.specs[0].path }, /missing required "path"/],
  ['a row with no sha256', (d) => { delete d.specs[0].sha256 }, /missing required "sha256"/],
  ['a name with no major', (d) => { d.specs[0].name = 'wallet' }, /\.name: "wallet" does not match/],
  ['a name in upper case', (d) => { d.specs[0].name = 'Wallet.v1' }, /does not match/],
  ['a name with a minor in it', (d) => { d.specs[0].name = 'wallet.v1.0' }, /does not match/],
  ['a version with two parts', (d) => { d.specs[0].version = '1.0' }, /\.version: "1.0" does not match/],
  ['a version with a prefix', (d) => { d.specs[0].version = 'v1.0.0' }, /does not match/],
  ['a pre-release version', (d) => { d.specs[0].version = '1.0.0-beta' }, /does not match/],
  ['a version that is a number', (d) => { d.specs[0].version = 1 }, /\.version: expected string, got number/],
  ['an absolute path', (d) => { d.specs[0].path = '/specs/wallet.v1.yaml' }, /\.path: .* does not match/],
  ['a path that climbs out', (d) => { d.specs[0].path = '../specs/wallet.v1.yaml' }, /does not match/],
  ['a path outside specs/', (d) => { d.specs[0].path = 'docs/wallet.v1.yaml' }, /does not match/],
  ['a path that is not a YAML file', (d) => { d.specs[0].path = 'specs/wallet.v1.json' }, /does not match/],
  ['a digest with a prefix', (d) => { d.specs[0].sha256 = `sha256:${'a'.repeat(64)}` }, /\.sha256: .* does not match/],
  ['a digest one character short', (d) => { d.specs[0].sha256 = 'a'.repeat(63) }, /does not match/],
  ['a digest in upper case', (d) => { d.specs[0].sha256 = 'A'.repeat(64) }, /does not match/],
  ['a digest that is not hex', (d) => { d.specs[0].sha256 = 'g'.repeat(64) }, /does not match/],
]

for (const [label, change, reason] of REFUSED) {
  test(`the schema refuses ${label}, and for exactly that reason`, () => {
    const found = problems(mutate(change), SCHEMA)
    assert.equal(found.length, 1, `expected exactly one problem, got:\n  ${found.join('\n  ')}`)
    assert.match(found[0], reason)
  })
}

test('the checker refuses a schema keyword it does not implement, rather than ignoring it', () => {
  // Otherwise a stricter keyword added to the schema would validate nothing
  // here and the suite would stay green.
  const stricter = { ...clone(SCHEMA), uniqueItems: true }
  assert.throws(() => problems(GOOD, stricter), /does not implement/)
})
