# Settings

> **Status:** Settings fields and **Test connection** are implemented in the v1 UI.

## Connection

| Setting | Description |
| --- | --- |
| API base URL | Tracker API host, without a trailing `/v3` path. Default: `https://api.tracker.yandex.net` |
| Site base URL | Frontend root used in Obsidian issue links. Default: `https://tracker.yandex.ru` |
| OAuth token | Token sent as `Authorization: OAuth <token>` |
| Org id header | **X-Org-ID** or **X-Cloud-Org-ID** |
| Organization id | Value for the chosen org header |

A **Test connection** button verifies that the saved API URL, token, and org header can call `/v3/myself`.

## Dates

Tracker date fields are fixed (no custom field ids):

| Obsidian | Tracker |
| --- | --- |
| `🛫` Start | `start` (read and write) |
| `📅` Due | Pull: `end` if set, else `deadline`. Push: write `deadline` only. `end` is **never** written from Obsidian |

Due date resolution from Tracker: **end** if set, else **deadline**, else no 📅.

## Time spent

| Behaviour | Detail |
| --- | --- |
| Source | Tracker `spent` (milliseconds in the API) |
| Note field | Pull-only `[timespent:: <seconds>]` (`floor(ms / 1000)`) |

Sync is **Tracker → Obsidian only** on open tasks (skipped when both sides are done). Changes to `[timespent:: …]` in Obsidian are **not** written back — edit spent time in Tracker.

## Assignee mappings

Map Tracker users (already assigned on your boards) to Dataview inline values written as `[assignee:: …]` on checklist lines.

| Control | Purpose |
| --- | --- |
| **Refresh assignees** | Load users currently assigned on issues of your mapped boards (not the full directory) |
| Tracker user dropdown | Pick a loaded assignee |
| Obsidian value | Text for the Dataview field, e.g. `Аряпов` → `[assignee:: Аряпов]` |

Sync rules (open tasks only — skipped when **both** Obsidian and Tracker are done):

- Obsidian empty, Tracker mapped → set `[assignee:: …]` in the note
- Obsidian mapped, Tracker empty → set Tracker assignee
- Both set and differ → Obsidian wins (updates Tracker)
- Unmapped user/value → no change for that side

## Note ↔ board mappings

Each mapping pairs one Obsidian note with one Tracker **board**.

| Control | Purpose |
| --- | --- |
| **Browse note** | Pick a vault markdown file (stores Obsidian’s exact path — important for spaces / Cyrillic names) |
| **Browse board** | Load boards from Tracker and pick one. Fills the numeric board id for you |
| Board id field | Still editable manually if you already know the id |
| **Queue** | Optional create queue override. Empty = board `defaultQueue` |
| **Tags** | Optional tag filter (see below) |
| **Recent only** | Optional recency window (see below) |

You do **not** need to dig the board id out of a Tracker URL. Use **Browse board** after **Test connection** succeeds.

New issues created from the note go into the board’s **default queue**, unless you set a per-mapping queue key.

Optional **Tags** filter which issues from that board participate in the mapping:

| Tags field | Behaviour |
| --- | --- |
| Empty | Sync **all** issues on the board (subject to recency, if set) |
| One or more tags | Sync issues that have **any** of those tags (OR). Comparison is case-insensitive |

Use this to split one board across several notes (for example board `12` + `project-a` → note A, board `12` + `project-b` → note B).

Type tags as a comma-separated list (including tags that do not exist in Tracker yet). **Add from board** loads tags currently present on issues of that board and lets you pick one.

New tasks created from the note receive the mapping’s filter tags (in addition to the status tag). Status tags (`to-do`, `in-progress`, `review`, …) are managed separately and are not used as the filter.

Optional **Recent only** narrows the fetch further:

| Control | Behaviour |
| --- | --- |
| Number | `0` = no recency limit. Positive N keeps issues with `Updated` or `Created` in the last N days/months |
| Days / Months | Unit for N (`Updated: >today()-30d` or `Created: >today()-3M`) |
| Updated / Created | Which timestamp field to compare |

Tags and recency combine with AND (an issue must match the tag filter **and** fall inside the window).

Column names for status tags still come from the board configuration.

## Conflict policy

When the same linked task changed both in Obsidian and in Tracker since the last successful sync:

| Option | Behaviour |
| --- | --- |
| Prefer Obsidian (default) | Push Obsidian title, description, dates, status, and nesting to Tracker |
| Prefer Tracker | Pull Tracker fields into the note |

## Sync triggers

These options are independent. The manual **Sync now** command is always available.

| Setting | Description |
| --- | --- |
| Sync on startup | Run once after Obsidian finishes loading the plugin |
| Sync on interval | Run periodically |
| Interval value | Number ≥ 1 |
| Interval unit | Minutes or hours |
| Sync on file change | After you edit a mapped note, wait 10 seconds from the last change, then sync |
| Dry-run by default | When enabled, **Sync now** / ribbon only preview. Automatic triggers still perform a real sync. |

Minimum interval is one minute.

Commands:

- **Sync now** — run sync (or dry-run if the setting above is on)
- **Preview sync (dry run)** — always preview without writing

## Maintenance

| Setting | Description |
| --- | --- |
| Clear sync state | Deletes the local sync ledger and pending links. Settings and mappings are kept. After clearing, the next sync imports Tracker issues into empty notes again instead of listing them as unresolved removals. |
