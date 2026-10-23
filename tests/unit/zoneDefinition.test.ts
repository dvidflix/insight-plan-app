import { describe, expect, it } from 'vitest';
import { withZoneDefinition, withZoneKind, zoneDefinition, zoneKindOf } from '../../src/prs/zoneDefinition';

describe('the zone definition', () => {
  it('is empty when nothing is set', () => {
    expect(zoneDefinition(undefined)).toEqual({ property: '', connected: [], disconnected: [] });
    expect(zoneDefinition({ zoneProperty: '  ', zoneConnected: [] })).toEqual({ property: '', connected: [], disconnected: [] });
  });
  it('takes the definition out of the settings when it is the default, and leaves the other settings alone', () => {
    expect(withZoneDefinition({ minPourVolumeM3: 1, zoneProperty: 'Wing' }, { property: 'Building Zone', connected: [], disconnected: [] })).toEqual({ minPourVolumeM3: 1 });
    expect(withZoneDefinition({}, { property: 'Wing', connected: ['A'], disconnected: ['B'] })).toEqual({ zoneProperty: 'Wing', zoneConnected: ['A'], zoneDisconnected: ['B'] });
  });
  it('reads the words in the text until a list names the zones', () => {
    const none = zoneDefinition({});
    expect(zoneKindOf('Connected HK', none)).toBe('connected');
    expect(zoneKindOf('Disconnected', none)).toBe('disconnected');
    expect(zoneKindOf('North', none)).toBe('none');
    const listed = { property: '', connected: ['North'], disconnected: ['South'] };
    expect(zoneKindOf('north', listed)).toBe('connected');
    expect(zoneKindOf('Connected HK', listed)).toBe('none');
  });
  it('keeps what the words already said when the first zone is named, and moves a value between kinds', () => {
    const present = ['Connected HK', 'Disconnected', 'North'];
    const first = withZoneKind(zoneDefinition({}), 'North', 'connected', present);
    expect(first).toEqual({ property: '', connected: ['Connected HK', 'North'], disconnected: ['Disconnected'] });
    expect(withZoneKind(first, 'North', 'disconnected', present)).toEqual({ property: '', connected: ['Connected HK'], disconnected: ['Disconnected', 'North'] });
    expect(withZoneKind(first, 'North', 'none', present).connected).toEqual(['Connected HK']);
  });
});
