import { describe, expect, it } from 'vitest';
import { PRESET_KEYS, SHIPPED_PRESETS, activePresets, applyPreset, matches, presetFromSettings } from '../../src/prs/sequencingPresets';
import { summariseProgramme } from '../../src/schedule/programmeSummary';
import type { ScheduleModel } from '../../src/schedule/types';

const preset = (id: string) => SHIPPED_PRESETS.find((p) => p.id === id)!;

describe('sequencing presets', () => {
  it('sets only the keys it names, and null puts the generator\'s value back', () => {
    const out = applyPreset({ levelGate: false, minPourVolumeM3: 1, sequenceLeadDays: 9 }, preset('overlap-in-order'));
    expect(out).toEqual({ levelGate: false, minPourVolumeM3: 1, sequenceFlow: true, sequenceLeadDays: 3, sequenceConcreteFollows: true });
    expect(applyPreset(out, preset('relay'))).toEqual({ levelGate: false, minPourVolumeM3: 1, sequenceFlow: false });
  });
  it('combines presets of different things', () => {
    const s = applyPreset(applyPreset({}, preset('overlap-when-ready')), preset('unlimited'));
    expect(matches(s, preset('overlap-when-ready'))).toBe(true);
    expect(activePresets(s, SHIPPED_PRESETS).map((p) => p.id).sort()).toEqual(['overlap-when-ready', 'unlimited']);
  });
  it('the defaults preset clears every behaviour switch and keeps the rest', () => {
    const s = applyPreset({ sequenceFlow: true, maximizeResources: true, minPourVolumeM3: 2 }, preset('default'));
    expect(s).toEqual({ minPourVolumeM3: 2 });
    expect(PRESET_KEYS).toContain('levelGate');
  });
  it('saves the scenario\'s switches under a unique id', () => {
    const p = presetFromSettings('My way', { sequenceFlow: true, minPourVolumeM3: 3 }, ['my-way']);
    expect(p.id).toBe('my-way-2');
    expect(p.settings.sequenceFlow).toBe(true);
    expect(p.settings.minPourVolumeM3).toBeUndefined();
  });
});

describe('programme summary', () => {
  it('counts the span and the critical activities', () => {
    const a = (id: string, s: string, f: string, isCritical: boolean) => ({ id, name: id, udf: {}, type: 'task', earlyStart: new Date(s), earlyFinish: new Date(f), targetStart: null, targetFinish: null, actualStart: null, actualFinish: null, isCritical, resources: [], calendarId: null, wbsPath: '' });
    const model = { activities: [a('1', '2026-01-01', '2026-01-10', true), a('2', '2026-01-05', '2026-01-31', false)], resourceCatalog: [], calendars: [] } as unknown as ScheduleModel;
    const r = summariseProgramme(model);
    expect(r.activities).toBe(2);
    expect(r.days).toBe(30);
    expect(r.critical).toBe(1);
    expect(r.criticalShare).toBe(0.5);
  });
});
