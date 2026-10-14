import { describe, expect, it } from 'vitest';
import { normalizeXml } from '../../src/schedule/parsers/normalizeXml';
import type { XmlTables } from '../../src/schedule/parsers/xml';

/** A scenario's pools (equipment, cranes and counted materials) reach the app as P6 resources whose max units is their count: the Resources view
    charts them against it. Concrete and rebar (max 0.125) are not pools. */
const resource = (ObjectId: string, Id: string, Name: string, ResourceType: string, max: string) => [
  { ObjectId, Id, Name, ResourceType },
  { ResourceObjectId: ObjectId, EffectiveDate: '1970-01-02T00:00:00', MaxUnitsPerTime: max },
];

describe('the capacity of a resource read from a P6 XML', () => {
  const rows = [
    resource('1', 'P-C', 'Concrete (m3)', 'Material', '0.125'),
    resource('2', 'P-L-SF', 'Steel fixers', 'Labor', '24'),
    resource('3', 'P-K-TC1', 'Tower crane 1', 'Nonlabor', '2'),
    resource('4', 'P-M-FWSET', 'Slab formwork sets', 'Material', '3'),
    resource('5', 'P-E-LIGHT', 'Lighting tower', 'Nonlabor', '0'),
  ];
  const tables: XmlTables = {
    Project: [{ ObjectId: '1', Id: 'P', Name: 'P', DataDate: '2030-01-01T00:00:00', PlannedStartDate: '2030-01-01T00:00:00' }],
    Resource: rows.map((r) => r[0]),
    ResourceRate: rows.map((r) => r[1]),
  };
  const catalog = normalizeXml(tables, 'x.xml').resourceCatalog ?? [];
  const capacity = (name: string) => catalog.find((r) => r.name === name)?.capacity;

  it('is the count for labour, equipment and counted materials', () => {
    expect(capacity('Steel fixers')).toBe(24);
    expect(capacity('Tower crane 1')).toBe(2);
    expect(capacity('Slab formwork sets')).toBe(3);
  });

  it('is nothing for concrete and rebar, or for a resource with no limit', () => {
    expect(capacity('Concrete (m3)')).toBeNull();
    expect(capacity('Lighting tower')).toBeNull();
  });
});
