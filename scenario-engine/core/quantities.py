# core/quantities.py
"""
Quantities a rule can take from the model. Every pour record carries the numeric properties and quantities of its
element ("props": {property set or quantity set name: {name: number}}), so a Rules > Productivity row can say where its
quantity is read from (a property set and a name) and the duration follows it.
"""

# The attribute each IFC quantity carries its number in.
_QUANTITY_ATTRS = ("LengthValue", "AreaValue", "VolumeValue", "CountValue", "WeightValue", "TimeValue")


def _number(value):
    try:
        if isinstance(value, bool) or value is None:
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def collect_props(guid, property_cache):
    """{set name: {name: number or text}} for the element with this GUID, from the cache built in main.py
    (set name -> GUID -> IfcPropertySet / IfcElementQuantity). Quantities are numbers; a property is a number when it is one, else its text."""
    out = {}
    for set_name, by_guid in property_cache.items():
        definition = by_guid.get(guid)
        if definition is None:
            continue
        values = {}
        for prop in getattr(definition, "HasProperties", None) or []:
            nominal = getattr(prop, "NominalValue", None)
            raw = getattr(nominal, "wrappedValue", nominal)
            number = _number(raw)
            if getattr(prop, "Name", None):
                if number is not None:
                    values[prop.Name] = number
                elif isinstance(raw, str) and raw.strip():
                    values[prop.Name] = raw.strip()
        for quantity in getattr(definition, "Quantities", None) or []:
            name = getattr(quantity, "Name", None)
            for attr in _QUANTITY_ATTRS:
                number = _number(getattr(quantity, attr, None))
                if name and number is not None:
                    values[name] = number
                    break
        if values:
            out[set_name] = values
    return out


def _norm(text):
    return str(text or "").strip().lower()


def raw_property(rec, pset, name):
    """What a record has for this property, a number or text (set name and property name compared without case), or None."""
    wanted_set, wanted = _norm(pset), _norm(name)
    if not wanted:
        return None
    for set_name, values in (rec.get("props") or {}).items():
        if wanted_set and _norm(set_name) != wanted_set:
            continue
        for key, value in values.items():
            if _norm(key) == wanted:
                return value
    return None


def property_value(rec, pset, name):
    """The number a record has for this property, or None (text that is not a number counts as none)."""
    return _number(raw_property(rec, pset, name))
