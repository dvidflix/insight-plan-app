import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { PRESET_1HDAB_TOC } from '../../src/prs/presets';

/** scenario-engine/tests/test_preset_parity.py checks that the 1HDAB_TOC preset generates what the generator generates without rules. It reads the
    preset from this file, so the file must be the preset: run with UPDATE_PRESET_FIXTURE=1 to rewrite it after changing the preset. */
const file = path.join(__dirname, '../../scenario-engine/tests/fixtures/preset_1hdab_toc.json');
const current = JSON.stringify(PRESET_1HDAB_TOC.content.rules, null, 1) + '\n';

describe('the preset the engine parity test reads', () => {
  it('is the 1HDAB_TOC preset', () => {
    if (process.env.UPDATE_PRESET_FIXTURE) fs.writeFileSync(file, current);
    expect(fs.readFileSync(file, 'utf8')).toBe(current);
  });
});
