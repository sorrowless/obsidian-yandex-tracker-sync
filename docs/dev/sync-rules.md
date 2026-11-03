# Sync Rules

Behavioral contract for bidirectional sync. The plugin implementation must follow these rules.

## Scope (v1)

Synced fields:

- Title (Tracker `summary`)
- Description (plain text ↔ indented bullets)
- Coarse workflow status via checkbox + board column + status tags
- Parent / child nesting (Tracker `parent` field)
- Tracker issue URL in the Obsidian task line
- Start date (`🛫` ↔ Tracker `start`)
- Due date (`📅` ← Tracker `end` if set, else `deadline`; → `deadline` only)
- Assignee (`[assignee:: …]` ↔ Tracker `assignee` via mappings)
- Time spent (`[timespent:: seconds]` ← Tracker `spent`, milliseconds → seconds; pull-only)

Not synced in v1:

- Priority, components (non-status tags are not edited except to preserve them / re-apply filter tags)
- Automatic deletion
- Arbitrary column creation from Obsidian beyond To Do / In Progress / Review / Done

## Mapping tag filters

Each note↔board mapping may list zero or more Tracker **tags**:

1. Empty list → every issue on the board is in scope (subject to recency below).
2. Non-empty list → an issue is in scope if it has **any** of the listed tags (OR, case-insensitive).
3. New issues created from Obsidian for a filtered mapping receive those filter tags (plus the status tag).
4. On sync, missing filter tags are re-applied so issues stay in the mapping’s scope.
5. Status tags derived from board columns are separate and still follow the column-wins rules below.

## Mapping recency filters

Each mapping may also set an optional **recency** window (`recencyValue` / `recencyUnit` / `recencyField`):

1. `recencyValue` ≤ 0 → no recency clause.
2. Positive N with unit days/months → Tracker query `Updated: >today()-Nd` / `Created: >today()-NM` (or months with `M`).
3. Combined with tags using AND when both are set.
4. Recency is applied server-side in issue search and is **not** part of the ledger `mappingKey`.

## Task identity

A task is linked when its Obsidian line contains a Markdown link (at the start of the checklist body) whose URL matches:

```text
{siteBaseUrl}/{ISSUE-KEY}
```

Example: `https://tracker.yandex.ru/QUEUE-123`. Issue keys are case-insensitive letters/digits/underscores with a hyphen (e.g. `QUEUE-123`). Trailing slashes and query fragments are ignored. The link text is the Obsidian title. Optional start/due markers after the link do **not** break identity.

Unlinked checklist items are candidates for create-in-Tracker.

## Canonical Markdown

After any successful sync write, a synced task block looks like:

```markdown
- [ ] [Task title](https://tracker.yandex.ru/QUEUE-123) 🛫 2026-10-02 📅 2026-10-05
    - description line one
    - description line two
    - [ ] [Child title](https://tracker.yandex.ru/QUEUE-124)
        - child description
```

Rules:

1. The primary line is a checklist item whose body starts with a link `[title](url)`, optionally followed by start/due date markers.
2. Start (`🛫`) and due (`📅`) times are written after the link; they are not part of the link text.
3. Description is represented as indented bullets **without** checkboxes.
4. Child tasks are indented checklist items (with checkboxes).
5. On rewrite, description lines come first, then child tasks.
6. Existing list marker (`-`, `*`, or numbered) and indent style are preserved for an existing block.
7. Newly created blocks use `-` and four spaces per indent level.
8. New Obsidian tasks created from Tracker are appended at the end of the mapped note (or under the parent block when present).

## Dates

| Marker | Meaning | Tracker field |
| --- | --- | --- |
| `🛫` | Start | `start` (bidirectional) |
| `📅` | Due | On pull: `end` if set, else `deadline`. On push: write `deadline` only; never write `end` |
| `[assignee:: value]` | Assignee | Dataview field ↔ Tracker `assignee` via `assigneeMappings` |
| `[timespent:: seconds]` | Time spent | Pull-only from Tracker `spent` (API milliseconds → note seconds) |

Accepted note values: `YYYY-MM-DD` or `YYYY-MM-DD HH:mm` (local time). Due/deadline writes to Tracker use the date portion only.

### Assignee sync

1. Only complete mappings (Tracker id/login + Obsidian value) participate.
2. Skip when both local and remote status are `done`.
3. Empty local + mapped remote → write Dataview field in the note.
4. Mapped local + empty remote → set Tracker assignee.
5. Both set and differ → Obsidian wins (update Tracker when local value is mapped).
6. Unmapped identities → no-op for that direction.

### Time spent sync

1. Source field is Tracker `spent` (milliseconds in the API).
2. Convert to whole seconds for Obsidian (`floor(ms / 1000)`).
3. Skip when both local and remote status are `done`.
4. If Tracker has spent time and Obsidian is empty or differs → set `[timespent:: N]` in the note.
5. Never push Obsidian → Tracker.

## Done / workflow status

### Coarse Obsidian checkbox

| Obsidian | Meaning |
| --- | --- |
| `[ ]` | To Do |
| `[/]` | In Progress |
| `[?]` | Review |
| `[x]` or `[X]` | Done family |

Mapping from Tracker status / column name (case-insensitive):

- To Do / Todo, or status type `new` → `[ ]`
- Review → `[?]` (synced as its **own** coarse status, not as In Progress)
- Done, Trashed, Canceled / Cancelled, or status type `done` / `cancelled` → `[x]`
- Everything else (In Progress, QA, …) → `[/]`

Other Obsidian checkbox characters (for example `[-]`) are not mapped.

### Column wins over status tags

Board columns define the set of **status tags**. A status tag title is the column name lowercased with spaces replaced by hyphens (`In Progress` → `in-progress`, `Review` → `review`).

On every sync for a linked issue:

1. Determine the issue’s current board column from its workflow status.
2. Compute the desired status tag from that column name.
3. Among tags that belong to the board’s status-tag set, remove any that are not the desired one and ensure the desired tag is present.
4. Never remove non-status tags (e.g. `bug`, `backend`).

Example: issue is in column **Review** but still has tag `in-progress` → remove `in-progress`, add `review`, keep Obsidian checkbox as `[?]`.

### Checkbox changes from Obsidian

When the user changes the checkbox on an already-linked task:

| New checkbox | Target column on the board |
| --- | --- |
| `[ ]` | To Do (or first `new` type column) |
| `[/]` | In Progress (name match, else first non-todo/done/review column) |
| `[?]` | Review (name match) |
| `[x]` | Done (or first `done` type column) |

The plugin transitions the issue toward that column and then reconciles status tags to match.

### New tasks from Obsidian

Unlinked checklist items create issues in To Do, In Progress, Review, or Done according to the checkbox. After create, attach the matching status tag. Queue is the board’s `defaultQueue`, unless the mapping overrides it.

## Nesting

- Indentation of checklist items defines parent/child trees in the note.
- Nested checklist items become Tracker issues with `parent` set to the parent issue key (same queue/board sync set).
- Changing indentation of an already-linked task sets or clears `parent`; unrelated hierarchy is untouched.
- On pull, `parent` → Obsidian indent only when both issues are in the mapping sync set.
- Description bullets must not be treated as children.

## Classification

For each mapping, build three sets:

1. **Local tasks** — checklist items in the note (tree).
2. **Remote issues** — issues on the Tracker board (after tag/recency filters).
3. **Ledger entries** — last successful sync snapshot for that mapping.

### Create remote (Obsidian → Tracker)

Condition: local checklist item has no Tracker link **and** is not already represented by a ledger entry.

Action:

1. Create a Tracker issue in the mapping/board queue with summary = local title, description = joined description bullets, deadline/start when set, initial status from checkbox; if nested, set `parent` to the parent key.
2. Rewrite the Obsidian line to the canonical linked form.
3. Attach the status tag for the target column.
4. Write a ledger entry.

### Create local (Tracker → Obsidian)

Condition: remote issue exists on the board, has no matching linked line in the note, and has **no** ledger entry (never synced).

Action:

1. Append a canonical block to the end of the note (or under the parent block if the parent is already present).
2. Title and URL from Tracker; description split into bullets by newlines.
3. Reconcile status tags to the column.
4. Write a ledger entry.

### Push (Obsidian wins for this change)

Condition: linked local task exists; remote exists; local content differs from ledger; remote matches ledger.

Action: update Tracker summary, description, dates, parent, and transition if checkbox coarse status changed; reconcile tags; update ledger.

### Pull (Tracker wins for this change)

Condition: linked local task exists; remote exists; remote differs from ledger; local matches ledger.

Action: rewrite the Obsidian block from Tracker; reconcile tags; update ledger.

### Conflict

Condition: both local and remote differ from the ledger.

Action:

- If `conflictPolicy === prefer-obsidian`: same as Push.
- If `conflictPolicy === prefer-tracker`: same as Pull.

Default policy: `prefer-obsidian`.

### Unchanged

Condition: local and remote both match the ledger for content.

Action: no content mutation; still run column→tag reconciliation when tags disagree with the column.

### Unresolved removal

Condition: a ledger entry exists, but the task is missing on exactly one side.

Action:

- Do **not** delete the remaining side.
- Do **not** recreate the missing side.
- Leave the remaining side as-is.
- Mark the ledger entry unresolved and include it in the sync report.

## Sync triggers

| Trigger | Behaviour |
| --- | --- |
| Manual | Always available via command |
| Interval | Optional; value ≥ 1; unit minutes or hours |
| Startup | Optional; run after plugin load when settings allow |
| File change | Optional; 10 seconds after the last modification of a mapped file |

Triggers are independent. Concurrent runs coalesce. Plugin note writes do not re-trigger file-change sync.

## Worked examples

### Example A — new Obsidian task

Before:

```markdown
- [ ] Buy milk
```

After sync:

```markdown
- [ ] [Buy milk](https://tracker.yandex.ru/QUEUE-42)
```

Tracker has a new issue in To Do (in the board `defaultQueue`) with status tag `to-do`.

### Example B — column wins over tag

Issue `QUEUE-7` is in column Review, tags `in-progress` + `bug`.

After sync: tags `review` + `bug`; note checkbox stays `[?]` if already so (or becomes `[?]` when pulling Review from Tracker).

### Example C — nested child

Note:

```markdown
- [ ] [Parent](https://tracker.yandex.ru/QUEUE-1)
    - [ ] Child idea
```

After sync, child is a Tracker issue with `parent` = `QUEUE-1`, and the note becomes:

```markdown
- [ ] [Parent](https://tracker.yandex.ru/QUEUE-1)
    - [ ] [Child idea](https://tracker.yandex.ru/QUEUE-2)
```

### Example D — unresolved deletion

Ledger knows `QUEUE-7`. Note still has the linked line. Tracker no longer returns `QUEUE-7` on the board.

Result: note unchanged; sync report lists `QUEUE-7` as unresolved removal; no recreate.

## Sync report

Each run should report at least:

- Mapping identity (note path, board id)
- Counts: created remote, created local, pushed, pulled, conflicts resolved, unchanged, unresolved removals, tag reconciliations
- Errors (including missing queue when creating)

Presentation can be an Obsidian Notice for short summaries and a more detailed modal/log for debugging.
