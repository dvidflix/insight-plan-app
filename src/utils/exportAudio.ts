/** Sound for exported videos: the MP3s of src/sounds, decoded in the browser and encoded to AAC
    (WebCodecs) for the MP4's audio track. */

const files = import.meta.glob('../sounds/*.mp3', { query: '?url', import: 'default', eager: true }) as Record<string, string>;

export interface SoundOption { id: string; label: string; url: string }

/** "2 Corporate Ambient - AShamaluevMusic.mp3" -> "Corporate Ambient". */
const labelOf = (path: string) =>
  (path.split('/').pop() ?? path).replace(/\.mp3$/i, '').replace(/\s*-\s*AShamaluevMusic$/i, '').replace(/^\d+\s+/, '').replace(/^MP3\s+/i, '').trim();

export const SOUNDS: SoundOption[] = Object.entries(files)
  .map(([path, url]) => ({ id: path.split('/').pop() ?? path, label: labelOf(path), url }))
  .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));

export const NO_SOUND = 'none';
export const DEFAULT_SOUND_ID = SOUNDS.find((s) => s.id.startsWith('2 Corporate Ambient'))?.id ?? SOUNDS[0]?.id ?? NO_SOUND;

export const audioEncodingSupported = typeof window !== 'undefined' && 'AudioEncoder' in window && 'AudioData' in window;

const SAMPLE_RATE = 48000;
const CODEC = 'mp4a.40.2';

export interface LoadedSound { buffer: AudioBuffer; channels: number }

/** Reads and decodes a sound (resampled to 48 kHz, at most stereo). */
export async function loadSound(url: string): Promise<LoadedSound> {
  const bytes = await (await fetch(url)).arrayBuffer();
  const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
  try {
    const buffer = await ctx.decodeAudioData(bytes);
    return { buffer, channels: Math.min(2, buffer.numberOfChannels) };
  } finally {
    void ctx.close();
  }
}

export async function audioConfig(sound: LoadedSound): Promise<AudioEncoderConfig | null> {
  const config: AudioEncoderConfig = { codec: CODEC, sampleRate: SAMPLE_RATE, numberOfChannels: sound.channels, bitrate: 192_000 };
  return (await AudioEncoder.isConfigSupported(config)).supported ? config : null;
}

/** Encodes `seconds` of the sound (looped if shorter, faded out over the last 2 s) and hands each chunk to `onChunk`. */
export async function encodeSound(
  sound: LoadedSound,
  config: AudioEncoderConfig,
  seconds: number,
  onChunk: (chunk: EncodedAudioChunk, meta?: EncodedAudioChunkMetadata) => void,
): Promise<void> {
  let failure: Error | null = null;
  const encoder = new AudioEncoder({ output: onChunk, error: (e) => (failure = e) });
  encoder.configure(config);
  const { buffer, channels } = sound;
  const source = Array.from({ length: channels }, (_, c) => buffer.getChannelData(c));
  const totalFrames = Math.max(1, Math.round(seconds * SAMPLE_RATE));
  const fade = Math.min(2 * SAMPLE_RATE, totalFrames);
  const block = 4800;
  for (let start = 0; start < totalFrames; start += block) {
    const n = Math.min(block, totalFrames - start);
    const data = new Float32Array(n * channels);
    for (let c = 0; c < channels; c++) {
      for (let i = 0; i < n; i++) {
        const at = start + i;
        const gain = at >= totalFrames - fade ? (totalFrames - at) / fade : 1;
        data[c * n + i] = source[c][at % buffer.length] * gain;
      }
    }
    const audio = new AudioData({ format: 'f32-planar', sampleRate: SAMPLE_RATE, numberOfFrames: n, numberOfChannels: channels, timestamp: Math.round((start / SAMPLE_RATE) * 1e6), data });
    encoder.encode(audio);
    audio.close();
    if (failure) throw failure;
    while (encoder.encodeQueueSize > 16) await new Promise((r) => setTimeout(r, 5));
  }
  await encoder.flush();
  encoder.close();
  if (failure) throw failure;
}
