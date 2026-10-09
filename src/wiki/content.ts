import { marked } from 'marked';
import DOMPurify from 'dompurify';

/** The Wiki's pages: Markdown files in the repo at docs/wiki/<section>/<page>.md
    (read at build time, so they ship with the app and its updates; the dev
    server's /api/wiki writes them), with images and videos in
    docs/wiki/media. A page's title is its first "# " heading; an optional
    first-line comment <!-- order: n --> places it in its section, and an
    optional <!-- group: Name --> files it under a collapsible group there. */

const RAW = import.meta.glob('/docs/wiki/*/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const MEDIA = import.meta.glob('/docs/wiki/media/*', { query: '?url', import: 'default', eager: true }) as Record<string, string>;

export const REPO_URL = 'https://github.com/dvidflix/insight-plan-app/blob/main/';

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

/** GitHub-style heading anchor. */
export const anchorOf = (text: string) =>
  text
    .trim()
    .toLowerCase()
    .replace(/[^\w\- ]/g, '')
    .replace(/ /g, '-');

/** A media path as written in a page ("media/x.png") → a URL the app can load. */
export function mediaUrl(src: string): string {
  const name = src.replace(/^(\.\.\/)*media\//, '');
  return MEDIA[`/docs/wiki/media/${name}`] ?? `/docs/wiki/media/${name}`;
}

/** Markdown → safe HTML for a page in `section`: heading anchors, links
    between pages marked for in-app navigation (data-wiki / data-anchor),
    repo paths to GitHub, media to their URLs. */
export function renderPage(markdown: string, section: string): string {
  const html = DOMPurify.sanitize(marked.parse(markdown, { gfm: true, async: false }) as string, { ADD_TAGS: ['video', 'source'], ADD_ATTR: ['controls', 'target'] });
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  const root = doc.body.firstElementChild!;
  for (const h of root.querySelectorAll('h1, h2, h3, h4, h5, h6')) if (!h.id) h.id = anchorOf(h.textContent ?? '');
  for (const a of root.querySelectorAll('a[href]')) {
    const href = a.getAttribute('href') ?? '';
    if (/^[a-z]+:/i.test(href)) {
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noreferrer');
      continue;
    }
    if (href.startsWith('#')) {
      a.setAttribute('data-anchor', href.slice(1));
      continue;
    }
    const page = /^(?:\.\.\/([a-z0-9-]+)\/)?([a-z0-9-]+)\.md(?:#(.*))?$/.exec(href);
    if (page) {
      a.setAttribute('data-wiki', `${page[1] ?? section}/${page[2]}`);
      if (page[3]) a.setAttribute('data-anchor', page[3]);
      continue;
    }
    // A file in the repo (e.g. ../../../scenario-engine/config.py): on GitHub.
    const repoPath = href.replace(/^(\.\.\/)+/, '');
    a.setAttribute('href', REPO_URL + repoPath);
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noreferrer');
  }
  for (const el of root.querySelectorAll('img[src], video[src], source[src]')) {
    const src = el.getAttribute('src') ?? '';
    if (/^(\.\.\/)*media\//.test(src)) el.setAttribute('src', mediaUrl(src));
  }
  for (const v of root.querySelectorAll('video')) v.setAttribute('controls', '');
  return root.innerHTML;
}
