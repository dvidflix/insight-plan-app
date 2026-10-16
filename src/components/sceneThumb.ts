import type { ViewerEngine } from '../viewer/ViewerEngine';
import { captureFrame } from '../viewer/frameCapture';

const WIDTH = 360;
const HEIGHT = 200;
const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

/** Any picture (a canvas or an image) as a small JPEG data URL, cropped to the tile's shape. */
function shrink(source: CanvasImageSource, w: number, h: number): string {
  const out = document.createElement('canvas');
  out.width = WIDTH;
  out.height = HEIGHT;
  const g = out.getContext('2d');
  if (!g) throw new Error('The picture could not be made.');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, WIDTH, HEIGHT);
  const k = Math.max(WIDTH / w, HEIGHT / h);
  g.drawImage(source, (WIDTH - w * k) / 2, (HEIGHT - h * k) / 2, w * k, h * k);
  return out.toDataURL('image/jpeg', 0.72);
}

/** The 3D view as it is now, for the scene you are in. */
export async function thumbFromView(engine: ViewerEngine): Promise<string> {
  await nextFrame();
  const canvas = document.createElement('canvas');
  captureFrame(engine, canvas, { scale: 1, timeline: null });
  return shrink(canvas, canvas.width, canvas.height);
}

/** A picture file the user chose. */
export async function thumbFromFile(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  try {
    return shrink(bitmap, bitmap.width, bitmap.height);
  } finally {
    bitmap.close();
  }
}
