import * as THREE from 'three';
import { CSS3DObject, CSS3DRenderer } from 'three/examples/jsm/renderers/CSS3DRenderer.js';

const SIZE = 64; // cube edge, CSS px
const FRAME = 104; // rendered square, CSS px

const FACES: { label: string; normal: THREE.Vector3; rotation: THREE.Euler }[] = [
  { label: 'Front', normal: new THREE.Vector3(0, 0, 1), rotation: new THREE.Euler(0, 0, 0) },
  { label: 'Back', normal: new THREE.Vector3(0, 0, -1), rotation: new THREE.Euler(0, Math.PI, 0) },
  { label: 'Right', normal: new THREE.Vector3(1, 0, 0), rotation: new THREE.Euler(0, Math.PI / 2, 0) },
  { label: 'Left', normal: new THREE.Vector3(-1, 0, 0), rotation: new THREE.Euler(0, -Math.PI / 2, 0) },
  { label: 'Top', normal: new THREE.Vector3(0, 1, 0), rotation: new THREE.Euler(-Math.PI / 2, 0, 0) },
  { label: 'Bottom', normal: new THREE.Vector3(0, -1, 0), rotation: new THREE.Euler(Math.PI / 2, 0, 0) },
];

/** Navigation cube for a 3D view: follows the camera's orientation, and
    every face, edge and corner is clickable — each one asks `onPick` to look
    at the model from that direction (the vector from target to camera). */
export class NavCube {
  readonly element: HTMLDivElement;
  private readonly renderer = new CSS3DRenderer();
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-FRAME / 2, FRAME / 2, FRAME / 2, -FRAME / 2, 1, 1000);

  constructor(private readonly onPick: (direction: THREE.Vector3) => void) {
    this.element = document.createElement('div');
    this.element.className = 'navcube';
    this.renderer.setSize(FRAME, FRAME);
    this.element.append(this.renderer.domElement);
    // Clicks on the cube must never reach the 3D canvas underneath.
    for (const type of ['pointerdown', 'pointerup', 'click', 'dblclick', 'wheel', 'contextmenu']) {
      this.element.addEventListener(type, (e) => e.stopPropagation());
    }

    for (const face of FACES) {
      const el = document.createElement('div');
      el.className = 'navcube__face';
      el.style.width = `${SIZE}px`;
      el.style.height = `${SIZE}px`;
      const obj = new CSS3DObject(el);
      obj.rotation.copy(face.rotation);
      obj.position.copy(face.normal).multiplyScalar(SIZE / 2);
      const u = new THREE.Vector3(1, 0, 0).applyEuler(face.rotation);
      const v = new THREE.Vector3(0, 1, 0).applyEuler(face.rotation);
      // 3×3 cells: centre = face, sides = edges, corners = corners.
      for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 3; col++) {
          const i = col - 1;
          const j = 1 - row;
          const dir = face.normal.clone().addScaledVector(u, i).addScaledVector(v, j);
          const cell = document.createElement('div');
          const kind = i === 0 && j === 0 ? 'face' : i === 0 || j === 0 ? 'edge' : 'corner';
          cell.className = `navcube__cell navcube__cell--${kind}`;
          cell.dataset.dir = dir.toArray().join(',');
          if (kind === 'face') cell.textContent = face.label;
          cell.title = kind === 'face' ? face.label : `${kind === 'edge' ? 'Edge' : 'Corner'} view`;
          cell.addEventListener('click', () => this.onPick(dir.clone().normalize()));
          // Light up every cell (on any face) that picks the same direction.
          cell.addEventListener('pointerenter', () => this.hover(cell.dataset.dir!, true));
          cell.addEventListener('pointerleave', () => this.hover(cell.dataset.dir!, false));
          el.append(cell);
        }
      }
      this.scene.add(obj);
    }
  }

  private hover(dir: string, on: boolean) {
    this.element.querySelectorAll<HTMLElement>(`[data-dir="${dir}"]`).forEach((c) => c.classList.toggle('is-hover', on));
  }

  /** Re-orients the cube to match `camera` (call on every camera update). */
  update(camera: THREE.Camera) {
    this.camera.quaternion.copy(camera.quaternion);
    this.camera.position.set(0, 0, 300).applyQuaternion(camera.quaternion);
    this.camera.up.copy(camera.up);
    this.camera.updateMatrixWorld();
    this.renderer.render(this.scene, this.camera);
  }

  setVisible(visible: boolean) {
    this.element.style.display = visible ? '' : 'none';
  }

  dispose() {
    this.element.remove();
  }
}
