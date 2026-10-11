import { renderMarkdown } from '../wiki/render';

/** The Help tab's pages: Markdown files in docs/help, written for the people who use the app (not the team's wiki).
    A page's title is its first "# " heading; a first-line comment <!-- order: n --> places it in the menu. */

const RAW = import.meta.glob('/docs/help/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

export interface HelpTopic {
  slug: string;
  title: string;
  order: number;
  markdown: string;
}

export function helpTopics(): HelpTopic[] {
  return Object.entries(RAW)
    .map(([file, markdown]) => {
      const slug = /\/([^/]+)\.md$/.exec(file)![1];
      return {
        slug,
        title: /^#\s+(.+)$/m.exec(markdown)?.[1].trim() ?? slug,
        order: Number(/^<!--\s*order:\s*(-?\d+)\s*-->/.exec(markdown)?.[1] ?? 1000),
        markdown,
      };
    })
    .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
}

/** Links between help pages are written `[text](other-page.md#heading)`. */
export const renderHelp = (markdown: string) => renderMarkdown(markdown, 'help');
