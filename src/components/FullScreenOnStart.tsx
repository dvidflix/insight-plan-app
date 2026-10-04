import { useEffect } from 'react';

/** localStorage key of Settings › Preferences › "Full screen on start". */
export const FULL_SCREEN_KEY = 'app.fullScreenOnStart';

export function fullScreenOnStart() {
  try {
    return localStorage.getItem(FULL_SCREEN_KEY) !== 'false';
  } catch {
    return true;
  }
}

/** Browsers only allow full screen in answer to a click or key press, never
    on load — so the app goes full screen (as F11 would) on the first one,
    unless turned off in Settings. A click that needs the gesture itself —
    a file drop area's picker, a control marked data-own-gesture (e.g.
    Duplicate's new tab) — is left alone: full screen would use it up. */
export function FullScreenOnStart() {
  useEffect(() => {
    if (!fullScreenOnStart() || !document.fullscreenEnabled) return;
    const events = ['pointerdown', 'keydown'] as const;
    const stop = () => events.forEach((t) => window.removeEventListener(t, onFirst, true));
    function onFirst(e: Event) {
      if (e.target instanceof Element && e.target.closest('.dropzone, input[type="file"], [data-own-gesture]')) return;
      if (e instanceof KeyboardEvent && e.key === 'Escape') return;
      stop();
      if (fullScreenOnStart() && !document.fullscreenElement) void document.documentElement.requestFullscreen().catch(() => {});
    }
    events.forEach((t) => window.addEventListener(t, onFirst, true));
    return stop;
  }, []);
  return null;
}
