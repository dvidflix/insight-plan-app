import * as THREE from 'three';

/** How much of a surface X-ray leaves (below the edge pass's ghost cutoff,
    so X-rayed tiles are left out of the edge capture like ghosts). */
const XRAY_OPACITY = 0.2;

type Saved = { transparent: boolean; opacity: number; depthWrite: boolean };

/** X-ray: makes the model's own materials (see markBaseMaterials) see-through,
    or puts them back. Highlights — the selection, Ghost, 4D colours — are
    other materials and stay as they are, so they read through the model. */
export function applyXray(materials: Iterable<THREE.Material>, on: boolean) {
  for (const m of materials) {
    if (!m.userData.concreteBase || ('isLodMaterial' in m && m.isLodMaterial)) continue;
    const mat = m as THREE.Material & { opacity: number };
    const saved = m.userData.xray as Saved | undefined;
    if (on) {
      if (saved) continue;
      m.userData.xray = { transparent: m.transparent, opacity: mat.opacity, depthWrite: m.depthWrite } satisfies Saved;
      m.transparent = true;
      mat.opacity = Math.min(mat.opacity, XRAY_OPACITY);
      m.depthWrite = false;
    } else {
      if (!saved) continue;
      m.transparent = saved.transparent;
      mat.opacity = saved.opacity;
      m.depthWrite = saved.depthWrite;
      delete m.userData.xray;
    }
    m.needsUpdate = true;
  }
}
