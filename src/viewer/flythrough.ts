import * as OBC from '@thatopen/components';
import * as THREE from 'three';

/** One camera keyframe: where the camera is and what it looks at. */
export interface CameraKey {
  position: [number, number, number];
  target: [number, number, number];
}

const PATH_COLOR = '#1b8d68';

/** A camera fly-through (That Open's "Showcaser"): keyframes captured from
    the camera, joined by smooth curves — one for the camera position, one
    for its target — that the camera travels along. Keyframe i sits at
    t = i / (n - 1), so the camera passes exactly through every keyframe.
    The path is drawn in the scene (a tube with a marker per keyframe) while
    shown. Grabbing the view (pointer or wheel) stops playback. */
export class Flythrough {
  /** The drawn path; added to the scene by the owner. */
  readonly object = new THREE.Group();
  /** Playback position 0..1, fired while playing and on seek. */
  readonly onProgress = new OBC.Event<number>();
  /** Fired when playback starts or stops. */
  readonly onPlayingChange = new OBC.Event<boolean>();

  private keys: CameraKey[] = [];
  private positionCurve: THREE.CatmullRomCurve3 | null = null;
  private targetCurve: THREE.CatmullRomCurve3 | null = null;
  private material = new THREE.MeshBasicMaterial({ color: PATH_COLOR });
  /** Screen-space line and dots, so the path still reads from far away
      where the tube is thinner than a pixel. */
  private lineMaterial = new THREE.LineBasicMaterial({ color: PATH_COLOR });
  private dotMaterial = new THREE.PointsMaterial({ color: PATH_COLOR, size: 9, sizeAttenuation: false });
  private raf = 0;
  private playing = false;
  private progress = 0;

  constructor(
    private readonly camera: OBC.OrthoPerspectiveCamera,
    /** Rough size of the loaded models (bounding radius), to size the path. */
    private readonly modelRadius: () => number,
    /** Called before each camera move while playing, e.g. to make a linked
        view follow this camera. */
    private readonly beforeMove: () => void = () => {},
  ) {
    this.object.name = 'flythrough-path';
    this.object.renderOrder = 10;
  }

  get isPlaying() {
    return this.playing;
  }

  get canPlay() {
    return this.keys.length >= 2;
  }

  /** The camera's current position and target, as a keyframe. */
  currentKey(): CameraKey {
    const p = new THREE.Vector3();
    const t = new THREE.Vector3();
    this.camera.controls.getPosition(p);
    this.camera.controls.getTarget(t);
    return { position: [p.x, p.y, p.z], target: [t.x, t.y, t.z] };
  }

  setKeys(keys: CameraKey[]) {
    this.keys = keys;
    if (keys.length >= 2) {
      const v = (a: [number, number, number]) => new THREE.Vector3(...a);
      this.positionCurve = new THREE.CatmullRomCurve3(keys.map((k) => v(k.position)), false, 'centripetal');
      this.targetCurve = new THREE.CatmullRomCurve3(keys.map((k) => v(k.target)), false, 'centripetal');
    } else {
      this.positionCurve = this.targetCurve = null;
      this.pause();
    }
    this.rebuild();
  }

  setPathVisible(visible: boolean) {
    this.object.visible = visible;
  }

  /** Puts the camera at `t` (0..1) along the path. */
  seek(t: number) {
    if (!this.positionCurve || !this.targetCurve) return;
    this.progress = Math.min(1, Math.max(0, t));
    this.beforeMove();
    const p = this.positionCurve.getPoint(this.progress);
    const g = this.targetCurve.getPoint(this.progress);
    void this.camera.controls.setLookAt(p.x, p.y, p.z, g.x, g.y, g.z, false);
    this.onProgress.trigger(this.progress);
  }

  /** Moves the camera to keyframe `i` (smoothly). */
  goTo(i: number) {
    const k = this.keys[i];
    if (!k) return;
    this.pause();
    this.beforeMove();
    void this.camera.controls.setLookAt(...k.position, ...k.target, true);
    if (this.keys.length > 1) {
      this.progress = i / (this.keys.length - 1);
      this.onProgress.trigger(this.progress);
    }
  }

  /** Plays from the current position over `duration` seconds for the whole
      path; `loop` starts over at the end, else it stops there. */
  play(duration: number, loop: boolean) {
    if (!this.canPlay || this.playing) return;
    if (this.progress >= 1) this.progress = 0;
    const span = Math.max(1, duration) * 1000;
    const startedAt = performance.now() - this.progress * span;
    this.setPlaying(true);
    const tick = (now: number) => {
      if (!this.playing) return;
      let t = (now - startedAt) / span;
      if (t >= 1 && !loop) {
        this.seek(1);
        this.setPlaying(false);
        return;
      }
      t %= 1;
      this.seek(t);
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  pause() {
    if (!this.playing) return;
    cancelAnimationFrame(this.raf);
    this.setPlaying(false);
  }

  private setPlaying(playing: boolean) {
    this.playing = playing;
    this.onPlayingChange.trigger(playing);
  }

  /** Redraws the path along the camera positions: a tube sized to the
      models (for close up), a 1px line over it and a fixed-size dot per
      keyframe (for far away). */
  private rebuild() {
    for (const child of [...this.object.children]) {
      this.object.remove(child);
      (child as THREE.Mesh).geometry?.dispose();
    }
    if (this.keys.length === 0) return;
    if (this.positionCurve) {
      const radius = Math.max(0.05, this.modelRadius() * 0.004);
      const segments = Math.min(2000, 60 * this.keys.length);
      this.object.add(new THREE.Mesh(new THREE.TubeGeometry(this.positionCurve, segments, radius, 8, false), this.material));
      this.object.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(this.positionCurve.getPoints(segments)), this.lineMaterial));
    }
    const dots = new THREE.BufferGeometry().setFromPoints(this.keys.map((k) => new THREE.Vector3(...k.position)));
    this.object.add(new THREE.Points(dots, this.dotMaterial));
  }

  dispose() {
    this.pause();
    this.setKeys([]);
    this.object.removeFromParent();
    this.material.dispose();
    this.lineMaterial.dispose();
    this.dotMaterial.dispose();
    this.onProgress.reset();
    this.onPlayingChange.reset();
  }
}
