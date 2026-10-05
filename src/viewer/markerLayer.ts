import * as THREE from 'three';
import * as OBC from '@thatopen/components';
import * as OBCF from '@thatopen/components-front';
import { markerIcon } from './markerIcons';
import type { Marker } from '../state/markersStore';
import { isEmptyNote, sanitizeNote } from '../utils/richText';

/** The viewer's markers (That Open's Marker component: markers that overlap on
    screen merge into a numbered cluster). Each is a round icon bubble; its
    name and coordinates show on hover. Positions are the markers' IFC
    coordinates (project axes), shifted by the same global offset as the models. */
const SVG = 'http://www.w3.org/2000/svg';

function elementOf(m: Marker): HTMLElement {
  const def = markerIcon(m.icon);
  const el = document.createElement('div');
  el.className = `mk${def.path ? '' : ' mk--point'}`;
  el.style.setProperty('--mk', m.color ?? def.color);
  if (def.path) {
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    const path = document.createElementNS(SVG, 'path');
    path.setAttribute('d', def.path);
    svg.appendChild(path);
    el.appendChild(svg);
  }
  const label = document.createElement('div');
  label.className = 'mk__label';
  const title = document.createElement('b');
  title.textContent = m.name || def.label;
  if (m.activityId) {
    const act = document.createElement('span');
    act.className = 'mk__activity';
    act.textContent = [m.activityCode, m.activityName].filter(Boolean).join(' — ');
    label.append(title, act);
  } else label.append(title);
  if (!isEmptyNote(m.note)) {
    const note = document.createElement('div');
    note.className = 'mk__note';
    note.innerHTML = sanitizeNote(m.note!);
    label.appendChild(note);
  }
  const coords = document.createElement('span');
  coords.textContent = `X ${m.x.toFixed(3)}  Y ${m.y.toFixed(3)}  Z ${m.z.toFixed(3)}`;
  label.appendChild(coords);
  el.appendChild(label);
  if (m.topicId) {
    el.style.cursor = 'pointer';
    el.addEventListener('click', () => window.dispatchEvent(new CustomEvent('ip-open-topic', { detail: m.topicId })));
  }
  // Presses on a marker must not start an orbit or place a point.
  for (const type of ['pointerdown', 'mousedown', 'dblclick']) el.addEventListener(type, (e) => e.stopPropagation());
  return el;
}

export class MarkerLayer {
  private readonly marker: OBCF.Marker;
  private ids: string[] = [];

  constructor(components: OBC.Components, private readonly world: OBC.World, private readonly offset: () => { x: number; y: number; z: number }) {
    this.marker = components.get(OBCF.Marker);
    this.marker.threshold = 36;
    this.marker.autoCluster = true;
    // Markers that overlap merge into a small dark badge with their count.
    this.marker.clusterElementFactory = () => {
      const el = document.createElement('div');
      el.style.cssText = 'min-width: 22px; padding: 3px 8px; border-radius: 12px; border: 2px solid #ffffff; background: #212529; color: #ffffff; font: 700 12px/1.2 sans-serif; text-align: center; box-shadow: 0 1px 5px rgba(0, 0, 0, 0.45); cursor: pointer; pointer-events: auto;';
      el.addEventListener('pointerover', () => { el.style.background = '#008d6e'; });
      el.addEventListener('pointerout', () => { el.style.background = '#212529'; });
      return el;
    };
  }

  /** The scene position of a marker (IFC X east, Y north, Z up -> the viewer's Y-up scene). */
  scenePoint(m: { x: number; y: number; z: number }): THREE.Vector3 {
    const g = this.offset();
    return new THREE.Vector3(m.x - g.x, m.z - g.z, -(m.y - g.y));
  }

  /** Draws exactly these markers (none when not visible). */
  sync(list: Marker[], visible: boolean) {
    for (const id of this.ids) this.marker.delete(id);
    this.ids = [];
    if (!visible) return;
    for (const m of list) {
      if (![m.x, m.y, m.z].every(Number.isFinite)) continue;
      const id = this.marker.create(this.world, elementOf(m), this.scenePoint(m));
      if (id) this.ids.push(id);
    }
  }
}
