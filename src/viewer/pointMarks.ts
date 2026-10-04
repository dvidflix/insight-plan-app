import * as THREE from 'three';
import * as OBC from '@thatopen/components';
import * as OBCF from '@thatopen/components-front';

/** Coordinates of a scene point in project axes (X east, Y north, Z up, metres):
    the viewer is Y-up, so scene (x, y, z) is project (x, -z, y). */
export const projectCoords = (p: THREE.Vector3, offset = { x: 0, y: 0, z: 0 }) => ({ x: p.x + offset.x, y: -p.z + offset.y, z: p.y + offset.z });

const plain = (p: THREE.Vector3, offset?: { x: number; y: number; z: number }) => {
  const c = projectCoords(p, offset);
  return `${c.x.toFixed(3)}, ${c.y.toFixed(3)}, ${c.z.toFixed(3)}`;
};

/** Copies text to the clipboard (falls back to a hidden text box where the
    Clipboard API is refused). */
export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    // fall through
  }
  const box = document.createElement('textarea');
  box.value = text;
  box.style.position = 'fixed';
  box.style.opacity = '0';
  document.body.appendChild(box);
  box.select();
  document.execCommand('copy');
  box.remove();
}

const COPY_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2m0 16H8V7h11z"/></svg>';

/** Point markers for the viewer's "Point coordinates" tool: a dot with a
    label beside it (X, Y, Z in large type) and a button that copies them. */
export class PointMarks {
  private readonly marks: OBCF.Mark[] = [];

  constructor(private readonly world: OBC.World, private readonly offset: () => { x: number; y: number; z: number }) {}

  get size() {
    return this.marks.length;
  }

  add(point: THREE.Vector3) {
    const at = this.offset();
    const c = projectCoords(point, at);
    const anchor = document.createElement('div');
    anchor.className = 'pt-mark';
    const dot = document.createElement('span');
    dot.className = 'pt-mark__dot';
    const label = document.createElement('div');
    label.className = 'pt-mark__label';
    const text = document.createElement('span');
    text.innerHTML = `<b>X</b> ${c.x.toFixed(3)} &nbsp;<b>Y</b> ${c.y.toFixed(3)} &nbsp;<b>Z</b> ${c.z.toFixed(3)}`;
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'pt-mark__copy';
    copy.title = 'Copy X, Y, Z';
    copy.setAttribute('aria-label', 'Copy X, Y, Z');
    copy.innerHTML = COPY_ICON;
    copy.addEventListener('click', (e) => {
      e.stopPropagation();
      void copyText(plain(point, at)).then(() => {
        copy.classList.add('is-copied');
        setTimeout(() => copy.classList.remove('is-copied'), 1200);
      });
    });
    // Don't let presses on the label start an orbit or place a point.
    for (const type of ['pointerdown', 'mousedown', 'dblclick']) label.addEventListener(type, (e) => e.stopPropagation());
    label.append(text, copy);
    anchor.append(dot, label);

    const mark = new OBCF.Mark(this.world, anchor);
    mark.three.position.copy(point);
    this.marks.push(mark);
  }

  removeLast() {
    this.marks.pop()?.dispose();
  }

  clear() {
    while (this.marks.length) this.marks.pop()!.dispose();
  }
}

export const formatCoords = plain;
