# Roadmap

Phased plan for building the plugin against the design docs.

## Phase 0 — Design contract (done)

Deliverables:

- [docs/dev/architecture.md](architecture.md)
- [docs/dev/sync-rules.md](sync-rules.md)
- [docs/user/](../user/) user guides (planned behaviour)
- [README.md](../../README.md)
- Minimal CI that validates documentation presence and, later, build/test

Outcome: a repository that can be developed against without ambiguity on v1 behaviour.

## Phase 1 — Plugin skeleton (done)

- Obsidian plugin manifest (`manifest.json`), `package.json`, TypeScript build (esbuild)
- Plugin entry that loads settings and registers a placeholder **Sync now** command
- Settings tab UI for API/site URLs, OAuth token, org id header, note↔board mappings, conflict policy, sync triggers, and queue overrides
- CI runs `npm ci`, `npm run build`, and `npm test` via `scripts/ci-check.sh`
- Make targets with `PLUGIN_ID := obsidian-yandex-tracker-sync`

## Phase 2 — Read path and Tracker client (done)

- Tracker REST client (OAuth + `X-Org-ID` / `X-Cloud-Org-ID`; boards/columns; issue search/create/update; transitions; tags; `parent`)
- Note parser for checklist trees, Tracker issue links, descriptions, done state, start/due dates
- Connection test in settings
- Unit tests for parser, URL helpers, query builders, and client request shaping

## Phase 3 — Sync engine (v1 scope) (done)

- Sync ledger in plugin data (including Tracker status id / column name)
- Classification and mutation pipeline per [sync-rules.md](sync-rules.md)
- Column-wins tag reconciliation; checkbox → To Do / In Progress / Review / Done transitions
- Nesting via Tracker `parent` field
- Dates: `start` ↔ start; due → `deadline`; `end` wins on pull
- Assignee Dataview mappings; pull-only `spent` → `[timespent:: seconds]`
- Note writer for canonical linked blocks
- Manual sync + interval + startup + 10s file-change debounce
- Sync report / notices
- Unit tests for classification, conflict policy, nesting, and Review (`[?]`) vs `in-progress` tags

## Phase 4 — Hardening (done)

- Safer concurrent-run coalescing (single-flight + one follow-up; real sync wins over dry-run)
- Better error recovery when a create succeeds but note write fails (`pendingLinks`)
- Optional dry-run / preview mode (command + settings default)
- Suppress file-change sync while the plugin writes notes
- Documentation updates reflecting actual UI labels and commands

## Phase 5 — Extended fields (post-v1)

Candidates, in likely order:

1. Priority
2. Non-status tags / components (full bidirectional without filter semantics)
3. Explicit delete policy
4. Rich description round-trip (HTML)
5. Push time spent / worklogs into Tracker

Each of these should land as a proposal under `docs/dev/` before implementation.

## Proposal process

When changing architecture or sync behaviour:

1. Add a short proposal Markdown file under `docs/dev/` (for example `docs/dev/proposal-delete-policy.md`).
2. Update [architecture.md](architecture.md) and/or [sync-rules.md](sync-rules.md) once accepted.
3. Update user docs under `docs/user/` when behaviour becomes user-visible.
4. Keep the README scope section aligned with what is actually implemented.
