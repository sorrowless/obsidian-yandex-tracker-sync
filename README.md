# Obsidian Yandex Tracker Sync

Bidirectional sync between Obsidian checklist tasks and [Yandex Tracker](https://tracker.yandex.ru/) boards.

> **Status:** Core bidirectional sync is implemented (Phase 4). See [docs/dev/roadmap.md](docs/dev/roadmap.md) for post-v1 work.

**Author:** Stan Bogatkin · **License:** Apache-2.0

## What it will do

Map selected Obsidian notes to Tracker boards (optionally filtered by tags and/or recent activity) and keep tasks in sync in both directions:

- Create missing tasks on either side
- Filter a shared board across notes with per-mapping tag lists (OR match; empty = whole board) and optional “last N days/months” windows
- Update title, description, start/due dates, optional Dataview `[assignee:: …]` / `[timespent:: …]`, coarse status, and nested subtasks
- Keep status tags aligned with the board column (column wins over conflicting status tags)
- Resolve simultaneous edits with a Prefer Obsidian / Prefer Tracker setting
- Run on demand, on a timer, at startup, or shortly after you edit a mapped note

Synced Obsidian lines use a Markdown link to the Tracker issue page (configurable site base URL):

```markdown
- [ ] [Task title](https://tracker.yandex.ru/QUEUE-123) 🛫 2026-10-02 📅 2026-10-05
    - description line
    - [ ] [Child title](https://tracker.yandex.ru/QUEUE-124)
```

## v1 sync scope

| Included | Not in v1 |
| --- | --- |
| Title, description, nesting (`parent`) | Priority, components |
| Issue-link identity (`{site}/QUEUE-123`) | Automatic delete on either side |
| Start (`🛫` ↔ `start`) + due (`📅` → `deadline`; `end` wins on pull) | Rich HTML description round-trip |
| Status via checkbox + board column + tags (`[?]` ↔ Review) | Arbitrary extra columns beyond To Do / In Progress / Review / Done |
| Assignee via Dataview mappings; time spent pull-only | Mapping one note to multiple boards |
| Conflict preference setting | |

## Documentation

**Users**

- [Getting started](docs/user/getting-started.md)
- [Task format](docs/user/task-format.md)
- [Settings](docs/user/settings.md)
- [Syncing](docs/user/syncing.md)

**Developers**

- [Architecture](docs/dev/architecture.md)
- [Sync rules](docs/dev/sync-rules.md)
- [Roadmap](docs/dev/roadmap.md)

## Development

```bash
make install          # npm ci
make build            # typecheck + production bundle → main.js
make test
make ci               # docs check + install + build + test
make version show     # print current version
make version bump     # bump patch (or: bump patch|minor|major)
make release          # build + zip under dist/
make release bump=patch   # bump version, then release zip
make install-vault VAULT="$HOME/path/to/vault"
make clean
```

Watch mode: `make dev`.

Plugin id: `obsidian-yandex-tracker-sync`.

### Manual install in Obsidian

```bash
make install-vault VAULT="/path/to/your/vault"
```

Or copy `main.js`, `manifest.json`, and `styles.css` into  
`Vault/.obsidian/plugins/obsidian-yandex-tracker-sync/` after `make build`.

Then enable **Yandex Tracker Sync** under Community plugins.

## Commands

| Command | Action |
| --- | --- |
| **Sync now** | Run bidirectional sync for all mappings (respects “Dry-run by default”) |
| **Preview sync (dry run)** | Classify and report what would change without writing notes or Tracker |

A ribbon **sync** icon also starts **Sync now**.

Automatic triggers (startup / interval / file change) always perform a real sync.

## Requirements

- Obsidian with community plugins enabled
- Yandex Tracker organization with an [OAuth token](https://yandex.ru/dev/tracker/doc/ru/concepts/access) and organization id (`X-Org-ID` or `X-Cloud-Org-ID`)
- Optional: [Obsidian Tasks](https://github.com/obsidian-tasks-group/obsidian-tasks) for richer task workflows in the vault
- Optional: [Dataview](https://github.com/blacksmithgu/obsidian-dataview) if you use `[assignee:: …]` / `[timespent:: …]` inline fields

## CI

`make ci` validates the docs layout, then runs `make install`, `make build`, and `make test` (via [`scripts/ci-check.sh`](scripts/ci-check.sh)).

GitHub Actions: [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

## License

Apache License 2.0. See [LICENSE](LICENSE).
