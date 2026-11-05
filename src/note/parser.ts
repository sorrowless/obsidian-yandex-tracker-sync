import { extractIssueKeyFromUrl, parseMarkdownLinkAtStart } from '../tracker/urls';
import { parseAssigneeField } from './assignee';
import { parseTaskDates } from './dates';
import { parseUnknownInlineFields } from './inline-fields';
import { parseTimeSpentField } from './timespent';
import type { ParseNoteOptions, ParsedTaskNode } from './types';
import { parseYtrackerField } from './ytracker';
import {
  doneFlagFromStatus,
  statusFromCheckbox,
  type TaskStatus,
} from '../sync/status';

const TASK_LINE =
  /^([\t >]*)([-*]|[0-9]+\.)\s+\[(.)\]\s+(.*)$/u;
const BULLET_LINE =
  /^([\t >]*)([-*]|[0-9]+\.)\s+(.*)$/u;

interface FlatTask {
  lineIndex: number;
  indent: string;
  indentWidth: number;
  listMarker: string;
  checkboxChar: string;
  done: boolean | null;
  status: TaskStatus | null;
  title: string;
  issueKey: string | null;
  titleLinkUrl: string | null;
  ytrackerIssueKey: string | null;
  unknownInlineFields: string[];
  startDate: string | null;
  dueDate: string | null;
  assignee: string | null;
  timeSpentSeconds: number | null;
  descriptionLines: string[];
  descriptionLineIndices: number[];
}

interface FlatBullet {
  lineIndex: number;
  indentWidth: number;
  text: string;
}

/**
 * Parse Obsidian checklist tasks from a Markdown note into a forest.
 * Nested checklist items become children; indented bullets without checkboxes
 * become description lines on the nearest less-indented task.
 */
export function parseNoteTasks(markdown: string, options: ParseNoteOptions): ParsedTaskNode[] {
  const lines = markdown.split(/\r?\n/);
  const tasks: FlatTask[] = [];
  const bullets: FlatBullet[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    const taskMatch = line.match(TASK_LINE);
    if (taskMatch) {
      const indent = taskMatch[1] ?? '';
      const listMarker = taskMatch[2] ?? '-';
      const checkboxChar = taskMatch[3] ?? ' ';
      const body = (taskMatch[4] ?? '').trimEnd();
      const resolved = resolveTaskBody(body, options.trackerSiteBaseUrl);
      const status = statusFromCheckbox(checkboxChar);

      tasks.push({
        lineIndex: i,
        indent,
        indentWidth: indentWidth(indent),
        listMarker,
        checkboxChar,
        done: status === null ? null : doneFlagFromStatus(status),
        status,
        title: resolved.title,
        issueKey: resolved.issueKey,
        titleLinkUrl: resolved.titleLinkUrl,
        ytrackerIssueKey: resolved.ytrackerIssueKey,
        unknownInlineFields: resolved.unknownInlineFields,
        startDate: resolved.startDate,
        dueDate: resolved.dueDate,
        assignee: resolved.assignee,
        timeSpentSeconds: resolved.timeSpentSeconds,
        descriptionLines: [],
        descriptionLineIndices: [],
      });
      continue;
    }

    const bulletMatch = line.match(BULLET_LINE);
    if (bulletMatch) {
      const body = (bulletMatch[3] ?? '').trim();
      if (/^\[.\]\s+/.test(body)) {
        continue;
      }
      bullets.push({
        lineIndex: i,
        indentWidth: indentWidth(bulletMatch[1] ?? ''),
        text: body,
      });
    }
  }

  assignDescriptions(tasks, bullets);
  const roots = buildTree(tasks);
  assignEndLines(roots);
  return roots;
}

export function indentWidth(indent: string): number {
  let width = 0;
  for (const ch of indent) {
    if (ch === '\t') {
      width += 4;
    } else if (ch === ' ') {
      width += 1;
    }
  }
  return width;
}

function resolveTaskBody(
  body: string,
  trackerSiteBaseUrl: string,
): {
  title: string;
  issueKey: string | null;
  titleLinkUrl: string | null;
  ytrackerIssueKey: string | null;
  unknownInlineFields: string[];
  startDate: string | null;
  dueDate: string | null;
  assignee: string | null;
  timeSpentSeconds: number | null;
} {
  const linkMatch = parseMarkdownLinkAtStart(body);
  const afterTitle = linkMatch ? linkMatch.rest : body;

  // Identity first, then known Dataview fields, then dates / unknowns.
  const withYtracker = parseYtrackerField(afterTitle, trackerSiteBaseUrl);
  const withTime = parseTimeSpentField(withYtracker.remainder);
  const withAssignee = parseAssigneeField(withTime.remainder);
  const withUnknown = parseUnknownInlineFields(withAssignee.remainder);
  const dates = parseTaskDates(withUnknown.remainder);

  const titleFromLink = linkMatch ? linkMatch.title.trim() : '';
  const titleLinkUrl = linkMatch ? linkMatch.url.trim() : null;
  const classicKey = linkMatch
    ? extractIssueKeyFromUrl(linkMatch.url, trackerSiteBaseUrl)
    : null;
  const ytrackerIssueKey = withYtracker.ytrackerIssueKey;
  const issueKey = classicKey ?? ytrackerIssueKey;

  return {
    title: titleFromLink || dates.remainder,
    issueKey,
    titleLinkUrl,
    ytrackerIssueKey,
    unknownInlineFields: withUnknown.unknownInlineFields,
    startDate: dates.startDate,
    dueDate: dates.dueDate,
    assignee: withAssignee.assignee,
    timeSpentSeconds: withTime.timeSpentSeconds,
  };
}

function assignDescriptions(tasks: FlatTask[], bullets: FlatBullet[]): void {
  for (const bullet of bullets) {
    let owner: FlatTask | null = null;
    for (let i = tasks.length - 1; i >= 0; i -= 1) {
      const task = tasks[i]!;
      if (task.lineIndex < bullet.lineIndex && task.indentWidth < bullet.indentWidth) {
        owner = task;
        break;
      }
    }
    if (!owner) {
      continue;
    }
    let stolenByChild = false;
    for (const task of tasks) {
      if (
        task.lineIndex > owner.lineIndex &&
        task.lineIndex < bullet.lineIndex &&
        task.indentWidth > owner.indentWidth &&
        task.indentWidth < bullet.indentWidth
      ) {
        stolenByChild = true;
        break;
      }
    }
    if (stolenByChild) {
      continue;
    }
    owner.descriptionLines.push(bullet.text);
    owner.descriptionLineIndices.push(bullet.lineIndex);
  }
}

function buildTree(tasks: FlatTask[]): ParsedTaskNode[] {
  const roots: ParsedTaskNode[] = [];
  const stack: ParsedTaskNode[] = [];

  for (const flat of tasks) {
    const node: ParsedTaskNode = {
      lineIndex: flat.lineIndex,
      endLineIndex: flat.lineIndex,
      indent: flat.indent,
      listMarker: flat.listMarker,
      checkboxChar: flat.checkboxChar,
      done: flat.done,
      status: flat.status,
      title: flat.title,
      issueKey: flat.issueKey,
      titleLinkUrl: flat.titleLinkUrl,
      ytrackerIssueKey: flat.ytrackerIssueKey,
      unknownInlineFields: [...flat.unknownInlineFields],
      startDate: flat.startDate,
      dueDate: flat.dueDate,
      assignee: flat.assignee,
      timeSpentSeconds: flat.timeSpentSeconds,
      descriptionLines: flat.descriptionLines,
      descriptionLineIndices: flat.descriptionLineIndices,
      children: [],
    };

    while (stack.length > 0) {
      const parent = stack[stack.length - 1]!;
      if (indentWidth(parent.indent) < indentWidth(node.indent)) {
        break;
      }
      stack.pop();
    }

    if (stack.length === 0) {
      roots.push(node);
    } else {
      stack[stack.length - 1]!.children.push(node);
    }
    stack.push(node);
  }

  return roots;
}

function assignEndLines(nodes: ParsedTaskNode[]): number {
  let max = -1;
  for (const node of nodes) {
    let end = node.lineIndex;
    for (const idx of node.descriptionLineIndices) {
      if (idx > end) {
        end = idx;
      }
    }
    if (node.children.length > 0) {
      const childEnd = assignEndLines(node.children);
      if (childEnd > end) {
        end = childEnd;
      }
    }
    node.endLineIndex = end;
    if (end > max) {
      max = end;
    }
  }
  return max;
}
