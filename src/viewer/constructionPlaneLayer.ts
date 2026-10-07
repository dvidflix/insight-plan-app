import * as THREE from 'three';
import type * as OBC from '@thatopen/components';
import type { ConstructionPlane } from '../state/constructionPlanesStore';

/** The viewer's construction planes: each a translucent box (flat when min and max meet on an axis)
    with an outline, between the plane's min and max corners in IFC coordinates (project axes),
    shifted by the same global offset as the models and the markers. */
export class ConstructionPlaneLayer {
  private group = new THREE.Group();

  constructor(world: OBC.World, private readonly offset: () => { x: number; y: number; z: number }) {
    this.group.name = 'construction-planes';
    world.scene.three.add(this.group);
  }

  /** The plane's box in the viewer's Y-up scene (IFC X east, Y north, Z up -> x, z = -y, y = z). */
  box(p: ConstructionPlane): THREE.Box3 {
    const g = this.offset();
    const a = new THREE.Vector3(p.minX - g.x, p.minZ - g.z, -(p.minY - g.y));
    const b = new THREE.Vector3(p.maxX - g.x, p.maxZ - g.z, -(p.maxY - g.y));
    return new THREE.Box3().setFromPoints([a, b]);
  }

  private clear() {
    for (const child of [...this.group.children]) {
      this.group.remove(child);
      child.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        (Array.isArray(m.material) ? m.material : m.material ? [m.material] : []).forEach((x) => x.dispose());
      });
    }
  }

  /** Draws exactly these planes (none when not visible). */
  sync(list: ConstructionPlane[], visible: boolean) {
    this.clear();
    if (!visible) return;
    for (const p of list) {
      if (!p.visible || ![p.minX, p.minY, p.minZ, p.maxX, p.maxY, p.maxZ].every(Number.isFinite)) continue;
      const box = this.box(p);
      const size = box.getSize(new THREE.Vector3());
      const geometry = new THREE.BoxGeometry(size.x, size.y, size.z);
      const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
        color: p.color, transparent: true, opacity: p.opacity, side: THREE.DoubleSide, depthWrite: false,
      }));
      mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometry), new THREE.LineBasicMaterial({ color: p.color })));
      mesh.position.copy(box.getCenter(new THREE.Vector3()));
      mesh.renderOrder = 2;
      this.group.add(mesh);
    }
  }
}
