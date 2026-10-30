# finance-specs

The canonical home for FlashyFinancial's OpenAPI contracts.

## What is in here

| What | Where | Purpose |
|---|---|---|
| `wallet.v1.yaml` | `specs/` | The service-to-service credit path into the gold ledger — `POST /wallet/credit`. The one spec this repository publishes. |
| `specs/index.json` | `specs/` | The generated `openapi-index/1` table of contents for every spec under `specs/` (name, version, path, sha256). |

## Where this came from

`specs/wallet.v1.yaml` is a byte-identical copy of
`flashy-contracts/specs/wallet.v1.yaml` (digest
`c156c125c34186b037b0da1eca6812ce65e678fc7da101c6060cf2ea83c2e1cf`), moved
here as part of splitting the estate's contracts by owning organisation.
flashy-contracts is a shared seam across several repositories and holds
specs for more than one business — `hunter-identity.v1.yaml` (ClaimYour.Gold's
own gamification record) and `ledger.v1.yaml` (going to FlashyNetwork) stay
there; `wallet.v1.yaml` moved here because it is specifically
FlashyFinancial's: the service-to-service write path into the gold ledger.

**flashy-contracts itself still has a copy of `wallet.v1.yaml` as of this
writing.** This repository is the new canonical home going forward; a
follow-up change in flashy-contracts — adding a note that the canonical copy
moved here, and deciding whether to vendor-reference this repository's copy
or remove its own — is still pending and is **not** made by this commit. Do
not treat the presence of `wallet.v1.yaml` in both repositories as a fork:
until that follow-up lands, flashy-contracts' copy is the one being
deprecated, not a second source of truth.

A breaking change to the contract mints `wallet.v2.yaml` here, never an edit
to `v1` — a consumer that cannot be redeployed in lockstep is the normal
case, not the exception. `info.version` inside the file moves with
compatible changes.

## The `openapi-index/1` pattern

This repository runs the same `openapi-index/1` pattern flashy-contracts
uses for its own `specs/index.json`, carried over verbatim
(`scripts/index-specs.mjs`, `schema/openapi-index-1.json`, and the two test
files in `test/`):

```json
{ "contract": "openapi-index/1", "generated": "<ISO 8601>",
  "specs": [ { "name": "wallet.v1", "version": "1.0.0",
               "path": "specs/wallet.v1.yaml", "sha256": "<hex of the file's bytes>" } ] }
```

It is written by `node scripts/index-specs.mjs` (`npm run specs:index`) from
the files themselves — name from the filename, version from `info.version`,
digest over the exact bytes — never hand-edited.
`test/specs-index.test.mjs` fails if the committed index disagrees with any
file under `specs/`. `npm run specs:check` (`node scripts/index-specs.mjs
--check`) is the same comparison from a shell, for CI or a pre-commit check.

The index's own shape is published as
[`schema/openapi-index-1.json`](./schema/openapi-index-1.json) (JSON Schema
2020-12), for a consumer who wants to validate the index they fetched.
`test/openapi-index-schema.test.mjs` holds it to the generator: a key the
generator writes that the schema does not name, or a committed index that
fails to validate, fails the suite.

**Where it would be served.** If this repository ever gains a served
surface, the index belongs at `https://<host>/.well-known/openapi-index.json`
and the spec at `https://<host>/<path>` — `path` values in the index are
relative to the repository root for exactly that reason.

**Nothing serves them today.** There is no deployment here; the committed
files are the whole of it, and a consumer reads them from the repository.

## Commands

```bash
npm install
npm test             # node --test test/*.test.mjs
npm run specs:index  # regenerate specs/index.json from specs/*.yaml
npm run specs:check  # exit 1 if specs/index.json disagrees with specs/
npm run lint:specs   # redocly lint specs/*.yaml
```

CI (`.github/workflows/ci.yml`) runs the test suite and `lint:specs` on
every push and pull request.

## Don't

- Edit `specs/index.json` by hand — run `npm run specs:index`.
- Edit `wallet.v1.yaml` incompatibly. Mint `wallet.v2.yaml`.
- Put a secret in a spec example, a test fixture or a workflow. The spec
  documents `x-internal-key`; it never contains one.
- Claim the specs are served until a URL actually answers.

## House rules — true in every repository in this estate

**`main` is not necessarily the default branch.** Ask, every time:

```bash
git symbolic-ref --short refs/remotes/origin/HEAD
```

Work pushed to `main` in a repository that deploys from another branch
deploys nothing and is read by nobody, and the failure is silent — the push
succeeds.

**Say which branch you measured.** Reading `git ls-files` or the working
tree tells you about your checkout, not about the repository. If a claim is
about what ships, read the ref.

**No secret in a file, a repo, or an artifact.** Secret Manager only. A
committed credential is burned the moment it lands and stays burned after
the file is deleted, because history keeps it — removal is not rotation.

**A generated file is regenerated, never hand-edited.** `specs/index.json`
is an output of `scripts/index-specs.mjs`. Editing it directly is a change
the next run silently discards.

**Report what happened, including when it is worse than expected.** A
number somebody assumed is worth less than a number somebody measured.
