import { useEffect, useMemo, useState } from 'react';
import { useViewerEngine } from '../viewer/ViewerEngineContext';
import type { ViewId } from '../viewer/ViewerEngine';
import { useTagsStore } from '../state/tagsStore';
import { useViewTagsStore } from '../state/viewTagsStore';
import { useTagLabelStats } from '../state/tagLabelStats';
import { Btn, Split, Sep, type MenuItem } from './ViewerToolbar';
import { IconGhost, IconPin, IconTagOutline } from './icons';

/** The header over each view of a split: its title, what selecting does in it (Select / Isolate, Ghost, Pin — each view has its own),
    and its Tags menu (the tag shown on hover, the tags that label the objects shown in it). Clicking a header makes that view the one
    the toolbar's own tools work on. */
export function ViewHeaders({ page }: { page: 'model' | 'sequence' }) {
  return (
    <div className="view-heads">
      <ViewHead view="main" title="Left view" page={page} />
      <ViewHead view="second" title="Right view" page={page} />
    </div>
  );
}

function ViewHead({ view, title, page }: { view: ViewId; title: string; page: 'model' | 'sequence' }) {
  const engine = useViewerEngine();
  const read = () => ({ base: engine.getBaseMode(view), ghost: engine.getInteractionMode(view) === 'reveal', pinned: engine.isRevealPinned(view), active: engine.getActiveView() === view });
  const [state, setState] = useState(read);
  useEffect(() => {
    const sync = () => setState(read());
    engine.onViewModeChange.add(sync);
    engine.onActiveViewChange.add(sync);
    sync();
    return () => { engine.onViewModeChange.remove(sync); engine.onActiveViewChange.remove(sync); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, view]);
  const { base, ghost, pinned, active } = state;

  // Ghost is Isolate faded instead of hidden: Select never has it. The state shown is read back from the engine once it has changed.
  const apply = (nextBase: 'select' | 'isolate', wantGhost: boolean) => {
    const g = nextBase === 'isolate' && wantGhost;
    setState((s) => ({ ...s, base: nextBase, ghost: g }));
    void engine.setInteractionMode(g ? 'reveal' : nextBase, view, nextBase).then(() => setState(read()));
  };

  // Tags.
  const tags = useTagsStore((s) => s.tags);
  const mainHover = useTagsStore((s) => s.hoverTagId);
  const setMainHover = useTagsStore((s) => s.setHoverTagId);
  const secondHover = useViewTagsStore((s) => s.views.second.hover);
  const chosen = useViewTagsStore((s) => s.views[view].visible);
  const setHover = useViewTagsStore((s) => s.setHover);
  const setVisible = useViewTagsStore((s) => s.setVisible);
  const hoverId = view === 'main' ? mainHover : secondHover;
  const onVisible = useMemo(() => new Set(chosen ?? tags.filter((t) => t.source?.kind === 'visible' && !t.hidden).map((t) => t.id)), [chosen, tags]);
  const pickHover = (id: string | null) => (view === 'main' ? setMainHover(id) : setHover('second', id));
  const toggleVisible = (id: string) => {
    const next = new Set(onVisible);
    if (!next.delete(id)) next.add(id);
    setVisible(view, [...next]);
    useTagsStore.getState().setShown(true); // (the tags are drawn only while Tags is on)
  };
  // What each tag found in this view, so a tag that draws nothing says why.
  const stats = useTagLabelStats((s) => s.stats);
  const found = (id: string) => {
    const s = stats[`${id}:${view}`];
    if (!s || !onVisible.has(id)) return '';
    return s.error ? ' — error' : s.withLabel === 0 ? ' — no object has text for it' : s.shown === 0 ? ' — none of its objects is shown here' : ` — ${s.shown} shown`;
  };
  const none: MenuItem = { key: 'none', label: 'No tags yet (4D Sequencing › Label)', disabled: true };
  const items: MenuItem[] = [
    { key: 'visible', label: 'On visible objects', icon: IconTagOutline, items: tags.length ? tags.map((t) => ({ key: t.id, label: `${t.name}${found(t.id)}`, checked: onVisible.has(t.id), keepOpen: true, onClick: () => toggleVisible(t.id) })) : [none] },
    ...(page === 'model'
      ? [{ key: 'hover', label: 'On hover', icon: IconTagOutline, items: tags.length ? [{ key: 'off', label: 'Off', checked: !hoverId, onClick: () => pickHover(null) }, ...tags.map((t) => ({ key: t.id, label: t.name, checked: hoverId === t.id, onClick: () => pickHover(t.id) }))] : [none] }]
      : []),
  ];
  const anyTags = onVisible.size > 0 || !!hoverId;

  return (
    <div className={`view-head${active ? ' is-active' : ''}`} onPointerDownCapture={() => engine.setActiveView(view)}>
      <span className="view-head__title">{title}</span>
      <div className="vtb-seg" role="radiogroup" aria-label={`What selecting does in the ${title.toLowerCase()}`}>
        <button type="button" role="radio" aria-checked={base === 'select'} className={base === 'select' ? 'is-on' : ''} onClick={() => apply('select', false)} title="Selecting only highlights">Select</button>
        <button type="button" role="radio" aria-checked={base === 'isolate'} className={base === 'isolate' ? 'is-on' : ''} onClick={() => apply('isolate', base === 'isolate' ? ghost : true)} title="Only the selection stays visible">Isolate</button>
      </div>
      <Btn icon={IconGhost} tip="Ghost (with Isolate): fade everything outside the selection instead of hiding it" active={ghost} disabled={base === 'select'} onClick={() => apply(base, !ghost)} />
      <Btn icon={IconPin} tip="Pin: keep the isolated / un-ghosted objects while the selection changes" active={pinned} disabled={!ghost && base === 'select'} onClick={() => void engine.setRevealPinned(!pinned, view)} />
      <Sep />
      <Split icon={IconTagOutline} tip="Tags in this view" menuTip="Tags in this view" active={anyTags} onClick={null} items={items} />
    </div>
  );
}
