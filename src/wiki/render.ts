import { marked } from 'marked';
import DOMPurify from 'dompurify';

export const REPO_URL = 'https://github.com/dvidflix/insight-plan-app/blob/main/';

/** GitHub-style heading anchor. */
export const anchorOf = (text: string) =>
  text
    .trim()
    .toLowerCase()
    .replace(/[^\w\- ]/g, '')
    .replace(/ /g, '-');

/** Markdown → safe HTML for a page in `section`: heading anchors, links
    between pages marked for in-app navigation (data-wiki / data-anchor),
    repo paths to GitHub, media to their URLs. */
export function renderMarkdown(markdown: string, section: string, mediaUrl: (src: string) => string = (src) => src): string {
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
