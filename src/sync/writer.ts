import { issueBrowseUrl } from '../tracker/urls';
import { formatAssigneeSuffix } from '../note/assignee';
import { formatTaskDatesSuffix } from '../note/dates';
import { formatTimeSpentSuffix } from '../note/timespent';
import { checkboxFromStatus } from './status';

export interface RenderableTask {
  indent: string;
  listMarker: string;
  checkboxChar: string;
  title: string;
  issueKey: string | null;
  startDate?: string | null;
  dueDate?: string | null;
  assignee?: string | null;
  timeSpentSeconds?: number | null;
  descriptionLines: string[];
  children: RenderableTask[];
}

const DEFAULT_INDENT_UNIT = '    ';

export function renderTaskForest(
  tasks: RenderableTask[],
  baseUrl: string,
  indentUnit = DEFAULT_INDENT_UNIT,
): string {
  return tasks.map((task) => renderTask(task, baseUrl, indentUnit)).join('\n');
}

export function renderTask(
  task: RenderableTask,
  baseUrl: string,
  indentUnit = DEFAULT_INDENT_UNIT,
): string {
  const lines: string[] = [];
  const linkOrTitle =
    task.issueKey !== null
      ? `[${task.title}](${issueBrowseUrl(baseUrl, task.issueKey)})`
      : task.title;
  const body = `${linkOrTitle}${formatTaskDatesSuffix(task.startDate ?? null, task.dueDate ?? null)}${formatAssigneeSuffix(task.assignee ?? null)}${formatTimeSpentSuffix(task.timeSpentSeconds ?? null)}`;
  lines.push(`${task.indent}${task.listMarker} [${task.checkboxChar}] ${body}`);

  const childIndent = `${task.indent}${indentUnit}`;
  for (const desc of task.descriptionLines) {
    lines.push(`${childIndent}- ${desc}`);
  }
  for (const child of task.children) {
    const renderedChild = renderTask(
      {
        ...child,
        indent: child.indent || childIndent,
      },
      baseUrl,
      indentUnit,
    );
    lines.push(renderedChild);
  }
  return lines.join('\n');
}

export function applyRootReplacements(
  markdown: string,
  replacements: Array<{
    lineIndex: number | null;
    endLineIndex: number | null;
    rendered: string;
  }>,
): string {
  const lines = markdown.split(/\r?\n/);
  const existing = replacements
    .filter((item) => item.lineIndex !== null && item.endLineIndex !== null)
    .sort((a, b) => (b.lineIndex as number) - (a.lineIndex as number));

  for (const item of existing) {
    const start = item.lineIndex as number;
    const end = item.endLineIndex as number;
    const blockLines = item.rendered.split(/\r?\n/);
    lines.splice(start, end - start + 1, ...blockLines);
  }

  const appended = replacements
    .filter((item) => item.lineIndex === null)
    .map((item) => item.rendered);

  if (appended.length === 0) {
    return lines.join('\n');
  }

  let result = lines.join('\n');
  if (result.length > 0 && !result.endsWith('\n')) {
    result += '\n';
  }
  if (result.length > 0) {
    result += '\n';
  }
  result += appended.join('\n');
  if (!result.endsWith('\n')) {
    result += '\n';
  }
  return result;
}

export function checkboxCharForStatus(status: import('./status').TaskStatus): string {
  return checkboxFromStatus(status);
}

export function defaultNewTask(title: string, issueKey: string, done: boolean): RenderableTask {
  return {
    indent: '',
    listMarker: '-',
    checkboxChar: done ? 'x' : ' ',
    title,
    issueKey,
    descriptionLines: [],
    children: [],
  };
}
