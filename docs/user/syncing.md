# Syncing

> **Status:** Implemented for v1 fields (title, description, dates, status/tags, nesting, assignee, time spent).

## Overview

For each mapped note, the plugin will:

1. Read checklist tasks from the note
2. Fetch issues and columns from the mapped Tracker board (optionally filtered by the mapping’s Tags and/or Recent-only window)
3. Compare both sides to a private sync ledger (stored in plugin data, not in the note)
4. Create, update, or report issues according to the rules below
5. Reconcile status tags so they match the board column (column wins)
6. Rewrite linked task lines into the [canonical format](task-format.md)

## Create rules

**Obsidian only (new, unlinked task)**  
Create a Tracker issue in the board `defaultQueue` (or the mapping’s queue override), set status from the checkbox (To Do / In Progress / Review / Done), then rewrite the note line as a link to that issue.

**Tracker only (never synced before)**  
Append a linked task block to the note (under its parent when the parent already exists).

## Update rules

**Changed only in Obsidian**  
Update summary, description, dates, parent, and transition if the checkbox coarse status changed.

**Changed only in Tracker**  
Update the corresponding lines in the Obsidian note.

**Changed on both sides**  
Apply your [conflict policy](settings.md#conflict-policy).

## Status, columns, and tags

- `[ ]` / `[/]` / `[?]` / `[x]` map to To Do / In Progress / Review / Done family.
- Review is a **separate** coarse status (`[?]`), not folded into In Progress.
- Board column is the source of truth for which status tag the issue should have.
- Status tag names come from column names: lowercased, spaces → hyphens (`In Progress` → `in-progress`).
- Example: column Review with leftover tag `in-progress` → remove `in-progress`, add `review`, keep `[?]` in Obsidian.
- Non-status tags are left alone (except mapping filter tags, which are re-applied when missing).

## Nesting

- Indenting a checklist item under another sets Tracker **`parent`** on the child to the parent issue.
- Un-indenting clears that `parent` between the pair.
- On pull, hierarchy follows `parent` when both issues are in the mapping sync set.
- Indented bullets without checkboxes are description text, not children.

## Deletions (v1)

If a task was synced before and then disappears on only one side, the plugin will **not**:

- delete it on the other side, or
- recreate the missing copy.

The remaining side is left alone, and the sync report lists the case as unresolved.

To start over after wiping synced lines from a note: open settings → **Clear sync state**, then run **Sync now**. Tracker issues will be imported again as new local tasks.

## When sync runs

- **Manual:** command palette → **Yandex Tracker Sync: Sync now**, or the ribbon sync icon
- **Preview:** command palette → **Yandex Tracker Sync: Preview sync (dry run)**
- **Startup:** optional
- **Interval:** optional, at least every 1 minute
- **After editing a mapped file:** optional, 10 seconds after the last change to that file

Only one sync runs at a time; overlapping triggers coalesce into a single follow-up run. Writes performed by the plugin do not re-trigger file-change sync.

## After a sync

You should see:

- New or updated Tracker issue links in the mapped note
- Matching issues on the Tracker board
- Status tags aligned with columns
- A short notice or detailed report (created / updated / unresolved / errors)
