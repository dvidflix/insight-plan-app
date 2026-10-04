import * as THREE from 'three';

const SVG = `
<svg viewBox="0 0 64 64" width="64" height="64" aria-hidden="true">
  <circle cx="32" cy="32" r="27" fill="rgba(255,255,255,0.88)" stroke="#d4d4d8" stroke-width="1.5" />
  <path d="M32 9 L39 32 L25 32 Z" fill="#27272a" />
  <path d="M32 55 L39 32 L25 32 Z" fill="#ffffff" stroke="#a1a1aa" stroke-width="1" stroke-linejoin="round" />
  <circle cx="32" cy="32" r="2.2" fill="#a1a1aa" />
  <text x="32" y="7.5" text-anchor="middle" font-size="9" font-weight="700" font-family="Segoe UI, Arial, sans-serif" fill="#27272a">N</text>
</svg>`;

/** A north arrow fixed in a 3D view's corner (under the view cube): its
    needle turns with the camera so it always points at north as seen on
    screen. North is project north (-Z in the viewer, the model's +Y — the
    same the sun & shadows use), turned by `rotation` degrees clockwise to
    override it (e.g. the site's true north). Display only; clicks pass
    through to the model. */
export class NorthArrow {
  readonly element: HTMLDivElement;
  private readonly dial: HTMLDivElement;
  private rotationDeg = 0;
  private lastCamera: THREE.Camera | null = null;

  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'north-arrow';
    this.dial = document.createElement('div');
    this.dial.className = 'north-arrow__dial';
    this.dial.innerHTML = SVG;
    this.element.append(this.dial);
  }

  /** Re-aims the needle for `camera` (call on every camera update). */
  update(camera: THREE.Camera) {
    this.lastCamera = camera;
    const t = THREE.MathUtils.degToRad(this.rotationDeg);
    // North in world space, then in camera space (x right, y up on screen).
    const north = new THREE.Vector3(Math.sin(t), 0, -Math.cos(t));
    const v = north.applyQuaternion(camera.quaternion.clone().invert());
    // Looking straight along north the on-screen direction is undefined; keep the last one.
    if (Math.hypot(v.x, v.y) < 1e-4) return;
    const angle = THREE.MathUtils.radToDeg(Math.atan2(v.x, v.y));
    this.dial.style.transform = `rotate(${angle}deg)`;
  }

  /** Degrees clockwise from project north. */
  setRotation(deg: number) {
    this.rotationDeg = deg;
    if (this.lastCamera) this.update(this.lastCamera);
  }

  setVisible(visible: boolean) {
    this.element.style.display = visible ? '' : 'none';
  }

  /** Sits under the view cube, or in the corner itself when the cube is hidden. */
  setBelowCube(below: boolean) {
    this.element.classList.toggle('north-arrow--corner', !below);
  }

  dispose() {
    this.element.remove();
  }
}
