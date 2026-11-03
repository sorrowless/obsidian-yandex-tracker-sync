# Getting Started

> **Status:** Implemented for v1. Configure settings, run **Test connection**, then **Sync now** (or enable automatic triggers).

This plugin syncs checklist tasks between Obsidian notes and boards on [Yandex Tracker](https://tracker.yandex.ru/).

## Prerequisites

- Obsidian desktop (community plugins enabled)
- A Yandex Tracker organization (Yandex 360 or Cloud org)
- Credentials:
  - [OAuth token](https://yandex.ru/dev/tracker/doc/ru/concepts/access) with Tracker API access
  - Organization id for header `X-Org-ID` or `X-Cloud-Org-ID`
- Optional but recommended: the [Obsidian Tasks](https://github.com/obsidian-tasks-group/obsidian-tasks) plugin
- Optional: [Dataview](https://github.com/blacksmithgu/obsidian-dataview) for `[assignee:: …]` / `[timespent:: …]` fields

## Install steps

1. Install the plugin from Community Plugins (or manually from a release zip).
2. Enable **Yandex Tracker Sync**.
3. Open plugin settings and enter:
   - API base URL (default `https://api.tracker.yandex.net`)
   - Site base URL for note links (default `https://tracker.yandex.ru`)
   - OAuth token
   - Organization id and header type (`X-Org-ID` or `X-Cloud-Org-ID`)
4. Add a mapping: **Browse note**, then **Browse board**. Optionally set a queue override, Tags, and/or a Recent-only window when the board is large.
5. Choose a conflict policy (default: Prefer Obsidian).
6. Enable the sync triggers you want (startup, interval, file change). Manual sync remains available as a command.
7. Run **Test connection**, then **Sync now**, and confirm tasks appear with Tracker issue links.

## What gets synced in v1

- Task title (summary) as a Markdown link to `{site}/{KEY}`
- Description (plain text bullets)
- Start (`🛫` ↔ `start`) and due (`📅` → `deadline`; `end` wins on pull)
- Nested subtasks via Tracker `parent`
- Workflow status via checkbox, board column, and status tags (column wins)
- Optional assignee mappings and pull-only time spent

Not synced: priority, automatic deletes, rich HTML description formatting.

## Next reading

- [Task format](task-format.md)
- [Settings](settings.md)
- [Syncing](syncing.md)
