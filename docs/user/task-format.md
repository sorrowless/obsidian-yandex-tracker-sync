# Task Format

> **Status:** Implemented — this page describes the Markdown shape the plugin reads and writes for synced tasks.

Tasks live in ordinary Markdown notes as checklist items, compatible with Obsidian Tasks.

## Basic task

```markdown
- [ ] Buy milk
```

After the first sync that creates the issue in Tracker, the line becomes a link:

```markdown
- [ ] [Buy milk](https://tracker.yandex.ru/QUEUE-42)
```

The link text is the title. The URL points at the Tracker issue page (`{siteBaseUrl}/{KEY}`).

## Dual-link titles (external URL + Tracker)

When the checklist title is already a markdown link to a **non-Tracker** site (for example Jira), sync does **not** replace that URL. Instead it binds (or creates) a Tracker issue and stores the Tracker identity in a Dataview field:

```markdown
- [/] [Shared work item](https://jira.example/browse/ABC-1) [ytracker:: [CL-406](https://tracker.yandex.ru/CL-406)]
```

| Situation | Behavior |
| --- | --- |
| Title link is already this Tracker site | Classic path — key lives in the title URL; no `ytracker` field |
| Title link is external + `[ytracker:: …]` present | Bind by the key/URL inside `ytracker` |
| Title link is external, no `ytracker` | Search the mapping queue for an issue whose summary equals the link text; create if missing; write `[ytracker:: [KEY](site/KEY)]` |
| Tracker renames the issue | Only the **display text** of the external title link is updated; the external URL and the `ytracker` field stay as-is |
| Tracker status/column changes | Checkbox updates as usual via the key from `ytracker` |
| Unknown Dataview fields (`[jira:: …]`, etc.) | Ignored for sync and preserved on rewrite |

The `ytracker` value is the issue key as a browse link (`[CL-406](…)`), not the human title — queue key and number are stable.

**One Tracker key per checklist line.** If several rows reuse the same `[ytracker:: [CL-N](…)]` (for example two Jira tickets pointed at one Tracker issue), only the **first** row in the note is synced. Later duplicates are reported as skipped and left untouched — otherwise their different descriptions would thrash push/pull on every run.

## Start and due dates

Start and due dates live **after** the title link (not inside the `[...]` brackets):

```markdown
- [ ] [Team standup](https://tracker.yandex.ru/QUEUE-42) 🛫 2026-10-02 📅 2026-10-05
```

| Marker | Meaning | Tracker field |
| --- | --- | --- |
| `🛫` | Start | `start` (bidirectional) |
| `📅` | Due | Pull: `end` if set, else `deadline`. Obsidian edits write `deadline` only; `end` is never written from Obsidian |
| `[assignee:: …]` | Assignee | Dataview inline field; mapped to a Tracker user in settings |
| `[timespent:: …]` | Time spent | Seconds from Tracker `spent` (API ms → seconds; pull-only; edit time in Tracker) |

Accepted date values: `YYYY-MM-DD` or `YYYY-MM-DD HH:mm` (local time). After sync the plugin rewrites the line in this canonical form; the link text stays the title only. Due dates sent to Tracker use the calendar date only.

Example with assignee and time spent:

```markdown
- [ ] [Team standup](https://tracker.yandex.ru/QUEUE-42) 🛫 2026-10-02 📅 2026-10-05 [assignee:: Аряпов] [timespent:: 3600]
```

Unlinked tasks may use the same markers:

```markdown
- [ ] Draft proposal 🛫 2026-10-05 📅 2026-10-06
```

## Description

Description lines are indented bullets **without** checkboxes, directly under the task:

```markdown
- [ ] [Write release notes](https://tracker.yandex.ru/QUEUE-7)
    - Mention breaking changes
    - Link to the changelog
```

Those bullets sync to the Tracker issue description (joined with newlines). Descriptions coming from Tracker may include HTML; the plugin converts them to plain text before writing into the note. Rich formatting is not preserved on write-back.

## Nested tasks (parent field)

Indented checklist items are child tasks. In Obsidian, nesting is **only** indentation — no extra Dataview fields. In Tracker, nesting uses the issue **`parent`** field (the child points at the parent). The plugin does **not** use Jira-style Blocks links.

```markdown
- [ ] [Ship plugin](https://tracker.yandex.ru/QUEUE-10)
    - Outline README
    - [ ] [Write docs](https://tracker.yandex.ru/QUEUE-11)
        - Cover settings
    - [ ] [Add CI](https://tracker.yandex.ru/QUEUE-12)
```

In this example:

- `Outline README` is description text for `QUEUE-10`.
- `Write docs` and `Add CI` are Tracker issues whose `parent` is `QUEUE-10`.

### When Tracker parents become Obsidian children

On pull, a `parent` link nests the child under the parent in Obsidian only if **all** of these hold:

1. Both issues are in the current sync set for that mapping (board + tag/recency filters).
2. The parent key resolves to a linked (or soon-to-be-linked) task in the same note sync run.
3. Cycles in `parent` chains are skipped and reported as a sync error.

Unrelated parent links outside the sync set are not removed and do not change Obsidian indent.

After a rewrite, description bullets are ordered before child tasks.

## Done state and columns

| Checkbox | Meaning | Typical Tracker column |
| --- | --- | --- |
| `[ ]` | To-Do | To Do |
| `[/]` | In Progress | In Progress (other intermediate columns map here too) |
| `[?]` | Review | Review (separate status — not folded into In Progress) |
| `[x]` or `[X]` | Done family | Done, Trashed, Canceled |

Exact column names come from the mapped board. The board column is authoritative for status tags: if the ticket is in Review but still has an `in-progress` tag, sync removes `in-progress`, adds `review`, and keeps `[?]` in Obsidian.

Status tag names are derived from column names: lowercased with spaces replaced by hyphens.

New tasks created from Obsidian target To Do, In Progress, Review, or Done. Other checkbox characters (for example `[-]`) are left alone and are not treated as status sync.

## List markers and indentation

- Existing tasks may use `-`, `*`, or numbered list markers; the plugin preserves the marker when rewriting a block.
- New blocks created by sync use `-` and four spaces per nesting level.

## What to avoid

- Putting important sync metadata only in frontmatter; identity is the Tracker issue URL in the task line.
- Mixing multiple boards’ issues in one mapped note; each mapped note belongs to one board.
- Expecting plain indented bullets (no checkbox) to become nested Tracker issues — they are description lines.
- Expecting Jira-style Blocks links to drive nesting — this plugin uses Tracker `parent` only.
