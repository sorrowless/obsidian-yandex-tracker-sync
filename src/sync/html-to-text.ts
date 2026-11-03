/**
 * Convert Vikunja task descriptions (often HTML from the rich-text editor)
 * into plain text suitable for Obsidian list bullets.
 */
export function htmlToPlainText(input: string): string {
  if (!input) {
    return '';
  }

  let text = input;

  // Common block/line breaks → newlines before stripping tags.
  text = text.replace(/<\s*br\s*\/?>/gi, '\n');
  text = text.replace(/<\s*\/\s*p\s*>/gi, '\n');
  text = text.replace(/<\s*\/\s*div\s*>/gi, '\n');
  text = text.replace(/<\s*\/\s*h[1-6]\s*>/gi, '\n');
  text = text.replace(/<\s*\/\s*li\s*>/gi, '\n');
  text = text.replace(/<\s*\/\s*tr\s*>/gi, '\n');
  text = text.replace(/<\s*li[^>]*>/gi, '- ');
  text = text.replace(/<\s*\/\s*ul\s*>/gi, '\n');
  text = text.replace(/<\s*\/\s*ol\s*>/gi, '\n');

  // Drop remaining tags.
  text = text.replace(/<[^>]+>/g, '');

  text = decodeBasicEntities(text);

  // Normalize whitespace / blank lines.
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  text = text
    .split('\n')
    .map((line) => line.replace(/[ \t\u00a0]+/g, ' ').trim())
    .filter((line, index, lines) => {
      if (line.length > 0) {
        return true;
      }
      // Keep at most one blank line between paragraphs.
      const prev = lines[index - 1];
      return Boolean(prev && prev.length > 0);
    })
    .join('\n')
    .trim();

  return text;
}

function decodeBasicEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#(\d+);/g, (_, code: string) => {
      const value = Number.parseInt(code, 10);
      return Number.isFinite(value) ? String.fromCodePoint(value) : '';
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => {
      const value = Number.parseInt(hex, 16);
      return Number.isFinite(value) ? String.fromCodePoint(value) : '';
    });
}
