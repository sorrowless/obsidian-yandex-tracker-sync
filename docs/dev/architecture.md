# Architecture

This document describes the architecture for the Obsidian ↔ Yandex Tracker sync plugin.

## Goals

- Bidirectional sync of tasks between mapped Obsidian notes and Yandex Tracker boards.
- Preserve Obsidian Tasks-compatible checklist syntax.
- Detect local vs remote changes without embedding sync metadata in note bodies.
- Support manual, interval, startup, and debounce-on-edit triggers.
- Talk to Tracker REST API v3 (`https://api.tracker.yandex.net/v3`) with OAuth + organization headers.

## Non-goals (v1)

- Syncing priority, components, reminders, or recurrence.
- Automatic deletion on either side when a previously synced task disappears.
- Mapping one note to multiple boards, or one board to multiple notes.
- Preserving rich Tracker description formatting (HTML) round-trip.
- Creating arbitrary board columns from Obsidian (only To Do / In Progress / Review / Done).
- Nesting via issue links (Jira-style Blocks); Tracker nesting uses the issue `parent` field.

## High-level components

```text
┌─────────────────────────────────────────────────────────────┐
│                     Obsidian Plugin                          │
│                                                              │
│  Settings UI ──► PluginSettings                               │
│       │                                                       │
│  Commands / Scheduler ──► SyncEngine                          │
│                              │                                │
│              ┌───────────────┼───────────────┐                │
│              ▼               ▼               ▼                │
│        NoteParser      TrackerClient     SyncLedger           │
│        NoteWriter           │                 │               │
│              │              ▼                 │               │
│              │   Tracker REST API v3          │               │
│              ▼                                ▼               │
│         Vault files                    Plugin data store      │
└─────────────────────────────────────────────────────────────┘
```

### Settings

Stores connection and behaviour configuration:

| Field | Purpose |
| --- | --- |
| `apiBaseUrl` | Tracker API root, default `https://api.tracker.yandex.net` (client appends `/v3`) |
| `siteBaseUrl` | Frontend site root used in note links, default `https://tracker.yandex.ru` |
| `oauthToken` | OAuth token (`Authorization: OAuth …`) |
| `orgId` | Organization id value |
| `orgIdHeader` | `X-Org-ID` or `X-Cloud-Org-ID` |
| `mappings` | Array of `{ notePath, boardId, boardName?, defaultQueue?, tags[], recencyValue, recencyUnit, recencyField }` — `boardName` is display-only; `tags` empty means all board issues (OR-filter when set); `defaultQueue` overrides the board’s `defaultQueue` for creates; recency `0` = no time window |
| `assigneeMappings` | `{ trackerUid, trackerDisplayName, trackerLogin?, obsidianValue }[]` for Dataview `[assignee:: …]` |
| `knownAssignees` | Cached board assignees for settings dropdowns |
| `conflictPolicy` | `prefer-obsidian` (default) or `prefer-tracker` |
| `syncOnStartup` | Boolean |
| `syncIntervalEnabled` | Boolean |
| `syncIntervalValue` | Number ≥ 1 |
| `syncIntervalUnit` | `minutes` or `hours` |
| `syncOnFileChange` | Boolean; debounce is fixed at 10 seconds |
| `dryRunDefault` | When true, Sync now previews without writing |

### Tracker client

Thin HTTP client over Tracker REST API v3. HTTP calls use Obsidian’s `requestUrl` (not browser `fetch`) so the API is not blocked by CORS.

| Operation | Endpoint family |
| --- | --- |
| Myself (connection test) | `GET /v3/myself` |
| List boards | `GET /v3/boards` (paginated) |
| Board (incl. `defaultQueue`) | `GET /v3/boards/{id}` |
| Board columns / statuses | `GET /v3/boards/{id}/columns` (and related status refs) |
| Search issues | `POST /v3/issues/_search` (board query + tags + recency) |
| Get issue | `GET /v3/issues/{key}` |
| Create issue | `POST /v3/issues` (queue from board `defaultQueue` or mapping override) |
| Update issue | `PATCH /v3/issues/{key}` (summary, description, parent, tags, start, deadline, assignee) |
| Transitions | `GET /v3/issues/{key}/transitions`, `POST /v3/issues/{key}/transitions/{id}` |
| Tags | via issue `tags` field updates |

Authentication on every request:

- `Authorization: OAuth <token>`
- `X-Org-ID: <id>` **or** `X-Cloud-Org-ID: <id>` (from settings)

Task identity in notes uses the site URL pattern `{siteBaseUrl}/{ISSUE-KEY}` (for example `https://tracker.yandex.ru/QUEUE-123`). The API base URL is separate from the site base URL.

Descriptions are normalized to plain text on pull; write-back sends simple text.

### Note parser / writer

- **Parser**: walk mapped note lines, recognise checklist items, build a tree from indentation, extract Tracker issue links, treat non-checkbox indented bullets as description lines, parse `🛫` / `📅` after the link.
- **Writer**: rewrite synced blocks into the canonical shape while preserving existing list marker and indent width; for new blocks use `-` and four spaces.

Canonical block:

```markdown
- [ ] [Task title](https://tracker.yandex.ru/QUEUE-123) 🛫 2026-10-02 📅 2026-10-05
    - description line
    - [ ] [Child title](https://tracker.yandex.ru/QUEUE-124)
        - child description
```

On rewrite, description lines come first, then child tasks.

### Sync ledger

Persisted in plugin data (not in notes). One entry per Tracker issue key that has been successfully synced for a mapping.

```ts
interface LedgerEntry {
  issueKey: string;
  mappingKey: string; // notePath + boardId (+ tags when filtered)
  title: string;
  description: string;
  status: 'todo' | 'in_progress' | 'review' | 'done';
  trackerStatusId: string;
  trackerStatusName: string; // board column / status name
  parentIssueKey: string | null;
  startDate: string | null;
  dueDate: string | null;
  contentHash: string;
  trackerUpdated: string; // ISO from issue updatedAt
  lastSyncedAt: string;
}
```

The ledger distinguishes local-only change, remote-only change, conflict, and unchanged. Storing `trackerStatusId` / `trackerStatusName` detects column moves (e.g. Review → In Progress) which also change the Obsidian checkbox (`[?]` ↔ `[/]`).

### Sync engine

For each mapping:

1. Read and parse the note.
2. Fetch board configuration (columns → status ids, `defaultQueue`) and issues in scope for the board.
3. Load ledger entries for that mapping.
4. Classify every local task and every remote issue.
5. Apply actions (create remote, create local, push, pull, conflict policy, reconcile status tags, report unresolved removals).
6. Write the note once per mapping (if changed).
7. Persist the updated ledger.
8. Emit a sync report.

See [sync-rules.md](sync-rules.md) for classification and status rules.

### Scheduler

Independent triggers:

- Manual command always available.
- Optional interval timer (minimum 1 minute).
- Optional run on Obsidian load.
- Optional vault `modify` listener for mapped files, debounced 10 seconds after the last change to that file.

Only one sync run may execute at a time; overlapping triggers queue or coalesce into a single follow-up run.

## Data flow

```text
Read mapped note ──┐
Read Tracker board ┼──► Classify against ledger ──► Apply mutations ──► Save note + ledger
Load sync ledger ──┘
```

| Outcome | Action |
| --- | --- |
| Local only (unlinked, never in ledger) | Create in Tracker; rewrite note with link |
| Remote only (never in ledger) | Append linked task to note |
| Local changed | Update Tracker |
| Remote changed | Update note |
| Both changed | Apply conflict policy |
| Previously synced, missing on one side | Report unresolved; do not delete or recreate |
| Unchanged | No-op (still reconcile status tags if column wins) |

## Mapping model

- One note ↔ one Tracker **board**, optionally narrowed by tag and/or recency filters.
- Several mappings may share the same board with different tag filters (and different notes).
- Empty `tags` → all issues on the board (subject to recency). Non-empty → issue must carry at least one listed tag (OR).
- Optional recency narrows fetch with Tracker query (`Updated` or `Created` relative to `today()-Nd` / `today()-NM`).
- New issues are created in the board’s `defaultQueue`, unless the mapping sets an override queue key.
- Settings store `boardId`, `tags` (string array), optional `defaultQueue`, and recency fields.
- Ledger `mappingKey` is `notePath::boardId` when unfiltered, or `notePath::boardId::tag1+tag2` when tag-filtered (recency is not part of the key).

## Nesting model

Obsidian nested checklist items map to Tracker’s issue **`parent`** field (not Jira Blocks links):

- Direction: child has `parent` = parent issue; parent has children via Tracker hierarchy.
- Create/update from Obsidian: create/update the issue and set `parent` to the parent key; un-indent clears `parent`.
- Pull: derive Obsidian indent from `parent` when both issues are in the same mapping sync set.
- Plain indented bullets without checkboxes are description content, not child tasks.

## Conflict detection

For a paired task (linked in the note and present in Tracker):

1. Compute local content hash from note title, description, coarse status, parent, start, due.
2. Compare local hash to ledger `contentHash`.
3. Compare Tracker `updatedAt` and/or remote content hash (including status id / column name) to ledger.
4. If only local differs → push.
5. If only remote differs → pull.
6. If both differ → conflict policy.
7. If neither differs → skip content write; still run column→tag reconciliation.

## Error handling

- Network / auth failures abort the current mapping and report the error; other mappings may continue.
- Partial write failure within a mapping should leave the ledger unchanged for failed issue keys so the next run can retry.
- The engine must not leave a newly created Tracker issue unlinked in the note if the create API call succeeded; rewrite the note before considering that create complete (`pendingLinks` recovery).

## Testing strategy

- Unit tests for parser, writer, hash, status/column/tag mapping, and classification (no Obsidian or network).
- Integration tests against a mocked Tracker HTTP layer.
- Manual vault fixture for end-to-end checks in Obsidian.
