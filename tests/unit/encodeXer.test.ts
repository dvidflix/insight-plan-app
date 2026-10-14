import { describe, expect, it } from 'vitest';
import { encodeXer } from '../../src/schedule/exportXer';

describe('the XER written as Windows-1252, as P6 reads it', () => {
  it('turns every character of the code page into its own byte, and back', () => {
    const all = Array.from({ length: 256 }, (_, i) => i).filter((i) => ![0x81, 0x8d, 0x8f, 0x90, 0x9d].includes(i));
    const text = String.fromCharCode(...all.filter((i) => i < 0x80 || i >= 0xa0));
    expect(new TextDecoder('windows-1252').decode(encodeXer(text))).toBe(text);
    expect([...encodeXer('Survey – setting out €')]).toEqual([...'Survey '].map((c) => c.charCodeAt(0)).concat([0x96, 0x20], [...'setting out '].map((c) => c.charCodeAt(0)), [0x80]));
  });

  it('writes a character the code page has not got as a question mark', () => {
    expect([...encodeXer('a中b\u{1f600}')]).toEqual([0x61, 0x3f, 0x62, 0x3f]);
  });
});
