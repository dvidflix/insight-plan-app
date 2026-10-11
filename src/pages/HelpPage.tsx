import { useEffect, useMemo, useRef, useState } from 'react';
import { usePersistedState } from '../utils/persistedState';
import { helpTopics, renderHelp } from '../help/content';
import { anchorOf } from '../wiki/render';
import { queryMatcher } from '../schedule/search';
import { ResizeHandle, useResizableWidth } from '../components/ResizeHandle';

/** Help: how to work with each tab, section and tool, written for the people who use the app (docs/help). Same layout as the
    Wiki: a menu with search, the page, and "On this page". Read only. */
export function HelpPage() {
  const topics = useMemo(helpTopics, []);
  const navWidth = useResizableWidth('help.navWidth', 260, 180, 480);
  const [slug, setSlug] = usePersistedState('help.page', 'getting-started');
  const [search, setSearch] = useState('');
  const pendingAnchor = useRef<string | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  const topic = topics.find((t) => t.slug === slug) ?? topics[0];
  const html = useMemo(() => (topic ? renderHelp(topic.markdown) : ''), [topic]);
  const hit = queryMatcher(search);
  const shown = topics.filter((t) => !search.trim() || hit(t.title) || hit(t.markdown));

  const go = (next: string, anchor?: string) => {
    pendingAnchor.current = anchor ?? null;
    setSlug(next);
    if (!anchor) bodyRef.current?.scrollTo({ top: 0 });
  };

  // After navigating to "page#anchor", scroll the heading into view.
  useEffect(() => {
    const a = pendingAnchor.current;
    if (!a) return;
    pendingAnchor.current = null;
    requestAnimationFrame(() => document.getElementById(a)?.scrollIntoView({ block: 'start' }));
  }, [slug, html]);

  const onContentClick = (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest('a');
    if (!a) return;
    const page = a.getAttribute('data-wiki')?.replace(/^help\//, '');
    const anchor = a.getAttribute('data-anchor');
    if (page && topics.some((t) => t.slug === page)) {
      e.preventDefault();
      go(page, anchor ?? undefined);
    } else if (anchor && !page) {
      e.preventDefault();
      document.getElementById(anchor)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
  };

  const headings = useMemo(() => [...(topic?.markdown ?? '').matchAll(/^(##|###) (.+)$/gm)].map((m) => ({ level: m[1].length, text: m[2].replace(/[*_`]/g, '') })), [topic]);

  return (
    <div className="wiki">
      <nav className="wiki__nav" style={{ width: navWidth.width }}>
        <input className="wiki__search" type="search" placeholder="Search the help…" value={search} onChange={(e) => setSearch(e.target.value)} />
        {shown.map((t) => (
          <button key={t.slug} type="button" className={`wiki__link${t.slug === topic?.slug ? ' active' : ''}`} onClick={() => go(t.slug)}>
            {t.title}
          </button>
        ))}
        {shown.length === 0 && <div className="wiki__link">Nothing found.</div>}
      </nav>
      <ResizeHandle onMouseDown={navWidth.startDrag(false)} />

      <main className="wiki__main">
        <div className="wiki__body" ref={bodyRef}>
          {topic ? <article className="wiki__content md" onClick={onContentClick} dangerouslySetInnerHTML={{ __html: html }} /> : <div className="wiki__content">No help pages.</div>}
          {headings.length > 2 && (
            <aside className="wiki__toc">
              <div className="wiki__toc-title">On this page</div>
              {headings.map((h, i) => (
                <a key={i} href={`#${anchorOf(h.text)}`} className={h.level === 3 ? 'wiki__toc-sub' : undefined} onClick={(e) => { e.preventDefault(); document.getElementById(anchorOf(h.text))?.scrollIntoView({ block: 'start', behavior: 'smooth' }); }}>
                  {h.text}
                </a>
              ))}
            </aside>
          )}
        </div>
      </main>
    </div>
  );
}
