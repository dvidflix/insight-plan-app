import * as THREE from 'three';

/** Surfaces for the 4D view: an Appearance Profile stage can draw its objects as brick, rebar mesh,
    glass, timber... instead of a flat colour. The class decides the surface pattern, how reflective
    it is and (for rebar) that the gaps are see-through. */
export const MATERIAL_CLASSES = [
  'concrete', 'glass', 'metal', 'grass', 'brick', 'timber', 'asphalt', 'stone', 'gravel', 'soil', 'tile', 'render', 'painted-metal', 'rebar',
] as const;
export type MaterialClass = typeof MATERIAL_CLASSES[number];

export const MATERIAL_CLASS_LABELS: Record<MaterialClass, string> = {
  concrete: 'Cast concrete',
  glass: 'Glass',
  metal: 'Exposed metal',
  grass: 'Grass / green roof',
  brick: 'Brick',
  timber: 'Timber',
  asphalt: 'Asphalt / tarmac',
  stone: 'Stone / paving',
  gravel: 'Gravel',
  soil: 'Soil / earth',
  tile: 'Tiles',
  render: 'Smooth render',
  'painted-metal': 'Painted metal',
  rebar: 'Rebar mesh (see-through)',
};

/** The colour a surface is drawn in when its stage sets none (patterns like brick ignore it). */
export const MATERIAL_CLASS_COLOURS: Record<MaterialClass, string> = {
  concrete: '#8f8d85',
  glass: '#9fc4d6',
  metal: '#a8adb2',
  grass: '#4f8a2e',
  brick: '#8c3d2b',
  timber: '#9a6b3c',
  asphalt: '#2f2f2f',
  stone: '#8a8782',
  gravel: '#6b6a66',
  soil: '#4d3623',
  tile: '#b9b3a6',
  render: '#d8d4cb',
  'painted-metal': '#7d8a99',
  rebar: '#7a6a5c',
};

/** The shader's class number (0 = no class: a flat colour). */
export const classNumber = (c: MaterialClass) => MATERIAL_CLASSES.indexOf(c) + 1;

// Painting an element (a 4D stage) gives it a material of the painted colour, shared by every
// element painted that way — so a surface can't be told apart by colour alone. Its class rides in
// the lowest two bits of red and green instead (a shift of at most 3/255, invisible), and is read
// back from this registry.

const paintedClass = new Map<string, number>();

/** `colour` (any CSS colour) with the class of `surface` encoded in it. */
export function encodeSurfaceInColour(colour: string, surface: MaterialClass): string {
  const cls = classNumber(surface);
  const hex = new THREE.Color(colour).getHexString();
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const out = `#${[(r & ~3) | (cls & 3), (g & ~3) | ((cls >> 2) & 3), b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  paintedClass.set(out, cls);
  return out;
}

/** The class number encoded in a painted material's colour (0 = a plain colour). */
export const classNumberForPainted = (color: THREE.Color): number => paintedClass.get(`#${color.getHexString()}`) ?? 0;
