import * as THREE from 'three';
import * as OBCF from '@thatopen/components-front';

/** Render quality of one 3D view: the visual style, ambient occlusion, the
    resolution it draws at and whether that follows a target frame rate. */
export interface RenderQuality {
  /** Ambient occlusion: reach of the shading around corners (scene units). */
  aoRadius: number;
  /** How strongly occlusion darkens (0.2 – 2). */
  aoScale: number;
  /** Thickness assumed behind a surface; higher darkens thin objects less. */
  aoThickness: number;
  /** Samples per pixel (more = smoother, slower). */
  aoSamples: number;
  /** Multiplier of the screen's native resolution (1 = native, 2 = supersampled). */
  renderScale: number;
  /** Lower the resolution while the frame rate is under the target, raise it again when there is room. */
  adaptive: boolean;
  targetFps: number;
  /** Edge line colour, '' = the default. */
  edgeColor: string;
}

export const DEFAULT_QUALITY: RenderQuality = {
  aoRadius: 0.4, aoScale: 0.85, aoThickness: 2, aoSamples: 24, renderScale: 1, adaptive: false, targetFps: 30, edgeColor: '',
};

export const QUALITY_PRESETS: { id: string; label: string; tip: string; values: Partial<RenderQuality> }[] = [
  { id: 'fast', label: 'Fast', tip: 'Lower resolution and few occlusion samples, for big models and weak graphics cards.', values: { renderScale: 0.75, aoSamples: 12, adaptive: true, targetFps: 30 } },
  { id: 'balanced', label: 'Balanced', tip: 'The default: native resolution, 24 occlusion samples.', values: { renderScale: 1, aoSamples: 24, adaptive: false } },
  { id: 'presentation', label: 'Presentation', tip: 'Supersampled and smoother occlusion, for stills and recording.', values: { renderScale: 1.5, aoSamples: 48, aoRadius: 0.5, adaptive: false } },
];

/** Holds the frame rate near a target by lowering the pixel ratio when frames
    are slow and raising it again (up to the wanted ratio) when they are fast. */
export class AdaptiveResolution {
  private last = 0;
  private times: number[] = [];
  private current: number;

  constructor(private wanted: number, private target: number, private readonly onChange: (ratio: number) => void) {
    this.current = wanted;
  }

  setTarget(wanted: number, target: number) {
    this.wanted = wanted;
    this.target = target;
    this.current = Math.min(this.current, wanted);
    this.times = [];
  }

  get ratio() {
    return this.current;
  }

  /** Call once per rendered frame. */
  tick() {
    const now = performance.now();
    const dt = now - this.last;
    this.last = now;
    // A paused tab or a long stall says nothing about how fast frames are.
    if (dt <= 0 || dt > 250) return;
    this.times.push(dt);
    if (this.times.length < 45) return;
    const avg = this.times.reduce((a, b) => a + b, 0) / this.times.length;
    this.times = [];
    const fps = 1000 / avg;
    const floor = Math.max(0.5, this.wanted * 0.4);
    let next = this.current;
    if (fps < this.target * 0.9) next = Math.max(floor, this.current * 0.85);
    else if (fps > this.target * 1.25 && this.current < this.wanted) next = Math.min(this.wanted, this.current * 1.12);
    if (Math.abs(next - this.current) > 0.02) {
      this.current = next;
      this.onChange(next);
    }
  }
}

/** Applies a view's quality to its postproduction renderer: the occlusion
    settings, edge colour and the resolution. `native` is the screen's own
    pixel ratio. Returns the adaptive controller for the caller to tick (or
    null when the resolution is fixed). */
export function applyRenderQuality(
  renderer: OBCF.PostproductionRenderer,
  q: RenderQuality,
  native: number,
  previous: AdaptiveResolution | null,
  defaultEdgeColor: string,
): AdaptiveResolution | null {
  const post = renderer.postproduction;
  post.aoPass.updateGtaoMaterial({
    radius: q.aoRadius,
    distanceExponent: 2,
    thickness: q.aoThickness,
    scale: q.aoScale,
    samples: Math.max(4, Math.round(q.aoSamples)),
    distanceFallOff: 1,
    screenSpaceRadius: true,
  });
  post.edgesPass.color = new THREE.Color(q.edgeColor || defaultEdgeColor);

  const wanted = Math.max(0.5, native * q.renderScale);
  const setRatio = (ratio: number) => {
    renderer.three.setPixelRatio(ratio);
    renderer.resize(undefined);
  };
  if (!q.adaptive) {
    setRatio(wanted);
    return null;
  }
  if (previous) {
    previous.setTarget(wanted, q.targetFps);
    setRatio(previous.ratio);
    return previous;
  }
  setRatio(wanted);
  return new AdaptiveResolution(wanted, q.targetFps, setRatio);
}
