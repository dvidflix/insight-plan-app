/** Which models are linked to a scene: an explicit list of model names, ticked in the Files panel. Opening a scene loads exactly these.
    The scene you are in keeps its list in the browser key `models.loaded` (the scene saves it with its layout); another scene's list
    is edited in its snapshot (scenes.setLinked). Loading a model does not link it and unloading one does not unlink it: only ticking does
    (and opening a model from the model store, or importing a file, which tick it for the scene you are in). */

import { useCallback, useEffect, useState } from 'react';
import { scenes } from './scenes';

const KEY = 'models.loaded';
const EVENT = 'ip-linked-models';

/** The scene you are in: its linked models (null: it has no list yet, see ModelsRestoreSync). */
export function activeLinked(): string[] | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    return Array.isArray(v) ? (v as string[]) : null;
  } catch {
    return null;
  }
}

export function setActiveLinked(names: string[]) {
  try { localStorage.setItem(KEY, JSON.stringify([...new Set(names)])); } catch { /* not kept */ }
  window.dispatchEvent(new Event(EVENT));
}

/** Ticks / unticks a model for the scene you are in. */
export function linkToActive(name: string, on = true) {
  const now = activeLinked() ?? [];
  if (now.includes(name) === on) return;
  setActiveLinked(on ? [...now, name] : now.filter((n) => n !== name));
}

/** The linked models of a scene (the one chosen on Home; none given: the scene you are in), and a way to change them. */
export function useSceneLinks(sceneId: string | null) {
  const isActive = !sceneId || sceneId === scenes.get().activeId;
  const [, bump] = useState(0);
  const [other, setOther] = useState<string[]>([]);
  useEffect(() => {
    const on = () => bump((n) => n + 1);
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  useEffect(() => {
    if (isActive || !sceneId) return;
    let live = true;
    setOther([]);
    void scenes.linkedOf(sceneId).then((l) => { if (live) setOther(l ?? []); });
    return () => { live = false; };
  }, [sceneId, isActive]);
  const linked = new Set(isActive ? activeLinked() ?? [] : other);
  const set = useCallback((names: string[], on: boolean) => {
    if (isActive) {
      const now = new Set(activeLinked() ?? []);
      for (const n of names) { if (on) now.add(n); else now.delete(n); }
      setActiveLinked([...now]);
      return;
    }
    if (!sceneId) return;
    setOther((cur) => {
      const next = new Set(cur);
      for (const n of names) { if (on) next.add(n); else next.delete(n); }
      void scenes.setLinked(sceneId, [...next]);
      return [...next];
    });
  }, [isActive, sceneId]);
  return { linked, set, isActive };
}
