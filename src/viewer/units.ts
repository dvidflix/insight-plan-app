/** Units shown next to quantity values ("14.657 m³"). The models carry
    plain numbers in metres (as the rest of the app assumes), so the unit is
    taken from what the property is called: Volume, Area, Length / Width /
    Height / Depth / Thickness / Perimeter, Weight / Mass. A name that already
    says its unit ("Pour Volume m3", "Height (mm)") is left as it is, and so
    is anything that isn't a plain number. */
const HAS_UNIT = /(\b|_)(m|mm|cm|m2|m3|m²|m³|kg|t|%|ft|in)(\b|_)|\([^)]*\)|\[[^\]]*\]/i;

export function unitOfProperty(name: string): string {
  const n = name.slice(name.lastIndexOf('.') + 1).trim();
  if (!n || HAS_UNIT.test(n)) return '';
  if (/volume/i.test(n)) return 'm³';
  if (/area/i.test(n)) return 'm²';
  if (/(^|[\s_])(net |gross )?(length|width|height|depth|thickness|perimeter)$/i.test(n)) return 'm';
  if (/weight|mass/i.test(n)) return 'kg';
  return '';
}

/** The value with its unit, when the property has one and the value is a plain number. */
export function withUnit(name: string, value: string): string {
  if (!/^-?\d+(\.\d+)?$/.test(value.trim())) return value;
  const unit = unitOfProperty(name);
  return unit ? `${value} ${unit}` : value;
}
