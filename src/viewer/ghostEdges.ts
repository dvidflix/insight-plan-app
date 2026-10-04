import * as THREE from 'three';

type Opaque = THREE.Material & { opacity: number };
const faded = (m: THREE.Material | undefined, cutoff: number) => !!m && m.transparent && (m as Opaque).opacity < cutoff;

/** Leaves the faded (ghost / X-ray) parts of the fragment tiles out of the
    edge pass, so only the solid elements are outlined; call the returned
    function right after the pass to put everything back.

    A tile can hold solid and faded elements at once (one geometry group per
    material). The edge pass swaps in its own material per group, so hiding
    the whole tile would drop the solid elements' edges too: such a tile only
    has its faded groups taken out for the pass. A tile that is all faded is
    hidden. */
export function hideFadedFromEdges(tiles: Iterable<THREE.Object3D>, cutoff: number): () => void {
  const hidden: THREE.Object3D[] = [];
  const regrouped: { geometry: THREE.BufferGeometry; groups: THREE.BufferGeometry['groups'] }[] = [];
  for (const obj of tiles) {
    const tile = obj as THREE.Mesh;
    if (!tile.visible || !tile.material) continue;
    if (!Array.isArray(tile.material)) {
      if (faded(tile.material, cutoff)) {
        tile.visible = false;
        hidden.push(tile);
      }
      continue;
    }
    const materials = tile.material;
    if (!materials.some((m) => faded(m, cutoff))) continue;
    const { geometry } = tile;
    const keep = geometry.groups.filter((g) => !faded(materials[g.materialIndex ?? 0], cutoff));
    if (!keep.length) {
      tile.visible = false;
      hidden.push(tile);
    } else {
      regrouped.push({ geometry, groups: geometry.groups });
      geometry.groups = keep;
    }
  }
  return () => {
    for (const tile of hidden) tile.visible = true;
    for (const { geometry, groups } of regrouped) geometry.groups = groups;
  };
}
