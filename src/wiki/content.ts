import { renderMarkdown } from './render';
export { anchorOf, REPO_URL } from './render';

/** The Wiki's pages: Markdown files in the repo at docs/wiki/<section>/<page>.md
    (read at build time, so they ship with the app and its updates; the dev
    server's /api/wiki writes them), with images and videos in
    docs/wiki/media. A page's title is its first "# " heading; an optional
    first-line comment <!-- order: n --> places it in its section, and an
    optional <!-- group: Name --> files it under a collapsible group there. */

const RAW = import.meta.glob('/docs/wiki/*/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const MEDIA = import.meta.glob('/docs/wiki/media/*', { query: '?url', import: 'default', eager: true }) as Record<string, string>;

export interface WikiPage {
  /** "section/page" */
  slug: string;
  section: string;
  page: string;
  title: string;
  order: number;
  /** Group within its section, '' for none. */
  group: string;
  markdown: string;
}

export interface WikiSection {
  id: string;
  title: string;
  pages: WikiPage[];
}

/** Sections listed first, in this order; any other folder follows. */
const SECTION_ORDER = ['standards', 'assumptions', 'calculations', 'app-guide'];

const titleOf = (md: string, fallback: string) => /^#\s+(.+)$/m.exec(md)?.[1].trim() ?? fallback;
const orderOf = (md: string) => Number(/^<!--\s*order:\s*(-?\d+)\s*-->/.exec(md)?.[1] ?? 1000);
const groupOf = (md: string) => /^<!--\s*group:\s*(.+?)\s*-->/m.exec(md)?.[1] ?? '';

export function wikiSections(): WikiSection[] {
  const bySection = new Map<string, WikiPage[]>();
  for (const [file, markdown] of Object.entries(RAW)) {
    const m = /\/docs\/wiki\/([^/]+)\/([^/]+)\.md$/.exec(file);
    if (!m || m[1] === 'media') continue;
    const [, section, page] = m;
    const p: WikiPage = { slug: `${section}/${page}`, section, page, title: titleOf(markdown, page), order: page === 'index' ? -1 : orderOf(markdown), group: page === 'index' ? '' : groupOf(markdown), markdown };
    (bySection.get(section) ?? bySection.set(section, []).get(section)!).push(p);
  }
  const ids = [...bySection.keys()].sort((a, b) => {
    const ia = SECTION_ORDER.indexOf(a);
    const ib = SECTION_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  });
  return ids.map((id) => {
    const pages = bySection.get(id)!.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
    return { id, title: pages.find((p) => p.page === 'index')?.title ?? id, pages };
  });
}

/** A media path as written in a page ("media/x.png") → a URL the app can load. */
export function mediaUrl(src: string): string {
  const name = src.replace(/^(\.\.\/)*media\//, '');
  return MEDIA[`/docs/wiki/media/${name}`] ?? `/docs/wiki/media/${name}`;
}

/** Markdown → safe HTML for a page in `section` (see render.ts). */
export const renderPage = (markdown: string, section: string) => renderMarkdown(markdown, section, mediaUrl);
