import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/** A glTF / GLB loaded as site context (terrain with aerial photo, surroundings…). */
export interface ContextMeshInfo {
  id: string;
  name: string;
  triangles: number;
  /** Project axes (X east, Y north, Z up, metres), before the offset. */
  bounds: { min: [number, number, number]; max: [number, number, number] } | null;
}

export interface ContextOffset {
  x: number;
  y: number;
  z: number;
}

interface Entry {
  info: ContextMeshInfo;
  group: THREE.Group;
  offset: ContextOffset;
}

/** Context meshes in the main 3D view, beside the IFC models. The file is read
    in the usual glTF axes (Y up; Blender's exporter turns its X east / Y north /
    Z up into X / -Z / Y), so its coordinates are the project's own: they line up
    with the IFC models by the same global offset the models use. Not part of 4D
    (never hidden by date), not pickable, no shadows. */
export class ContextMeshes {
  private entries = new Map<string, Entry>();

  constructor(
    private scene: () => THREE.Scene,
    private globalOffset: () => { x: number; y: number; z: number },
  ) {}

  async load(buffer: ArrayBuffer, name: string): Promise<ContextMeshInfo> {
    const gltf = await new GLTFLoader().parseAsync(buffer, '');
    const group = new THREE.Group();
    group.name = name;
    group.add(gltf.scene);
    let triangles = 0;
    gltf.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.raycast = () => {}; // a click goes through to the model behind it
      const g = mesh.geometry;
      triangles += Math.round((g.index ? g.index.count : g.getAttribute('position').count) / 3);
    });
    const id = `${name}#${crypto.randomUUID().slice(0, 8)}`;
    const box = new THREE.Box3().setFromObject(gltf.scene);
    const bounds = box.isEmpty()
      ? null
      : { min: [box.min.x, -box.max.z, box.min.y] as [number, number, number], max: [box.max.x, -box.min.z, box.max.y] as [number, number, number] };
    const info: ContextMeshInfo = { id, name, triangles, bounds };
    this.entries.set(id, { info, group, offset: { x: 0, y: 0, z: 0 } });
    this.scene().add(group);
    this.place(this.entries.get(id)!);
    return info;
  }

  private place(e: Entry) {
    const g = this.globalOffset();
    // Scene = project minus the global offset, in the viewer's axes (X, Z up -> Y, north -> -Z).
    e.group.position.set(-g.x + e.offset.x, -g.z + e.offset.z, g.y - e.offset.y);
    e.group.updateMatrixWorld(true);
  }

  /** Re-places every mesh (the global offset changes when the first IFC loads). */
  refresh() {
    for (const e of this.entries.values()) this.place(e);
  }

  setOffset(id: string, offset: ContextOffset) {
    const e = this.entries.get(id);
    if (!e) return;
    e.offset = offset;
    this.place(e);
  }

  setVisible(id: string, visible: boolean) {
    const e = this.entries.get(id);
    if (e) e.group.visible = visible;
  }

  remove(id: string) {
    const e = this.entries.get(id);
    if (!e) return;
    this.entries.delete(id);
    e.group.removeFromParent();
    e.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry.dispose();
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        for (const v of Object.values(m)) if (v instanceof THREE.Texture) v.dispose();
        m.dispose();
      }
    });
  }
}
