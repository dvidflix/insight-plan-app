# core/work_items.py
"""Work items: units of work that are not concrete pours.

The generator builds a record for each pour of a model (the objects that carry the pour property set) and makes activities from the recipe of the pour's
group. A work item is the same thing for any kind of object: a group of objects (a search set, a set of objects with the same value of a property)
at one building and level, made by the app and sent with the request. It needs no model: the app says what the item is, where it is and how much of
it there is, and the generator makes the record a pour would have, so everything downstream (recipes, rates, crews, resources, links, the XML) reads it
the same way.

An item is {id, group, building?, level?, zone?, name?, quantity?, quantities?: {name: number}, properties?: {name: value}, x?, y?, z?}:

  id          the item's identity (the GlobalId of a pour): it must be unique, and the request's sequence names it
  group       what the item is, the name of its group: a recipe and the rules' groups find it by this
  label       what activity names, the WBS and the type letter of Activity IDs call it (Generate's package name); the group stays the key
              recipes and rules match
  quantity    the number the pour's volume is (0 when there is none): a duration worked out from "the pour's volume" reads it
  quantities  more numbers, as a rule can take them from a property (set "Work item")
  properties  more properties as the pour property set would hold them (a level or a zone under another name, say)

A work item has no model behind it: it has no coordinates unless given, and it is always in the programme (the smallest-volume rule is for pours).
With no recipe, an item is one activity, "Work", of the default days. The generator's pour code never sees the group's words: an item whose group is called
"Retaining wall" is not treated as a wall.
"""

WORK_ITEM_PROPERTY_SET = "Work item"

# What a work item with no recipe is: one activity.
WORK_ITEM_CHAIN = [{"phase": "Work", "suffix": "-W", "label": "Work", "order": 1}]


class WorkItemElement:
    """Stands in for the model element of a pour: the generator reads its GlobalId (and Name) only."""

    def __init__(self, global_id, name=""):
        self.GlobalId = global_id
        self.Name = name

    def __repr__(self):
        return f"WorkItemElement({self.GlobalId!r})"


def _text(value):
    return str(value if value is not None else "").strip()


def _number(value):
    try:
        if isinstance(value, bool) or value is None:
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def clean(items):
    """The usable items, in order: a dict with an id and a group, the first of an id kept."""
    out, seen = [], set()
    for item in items or []:
        if not isinstance(item, dict):
            continue
        ident, group = _text(item.get("id")), _text(item.get("group"))
        if not ident or not group or ident in seen:
            continue
        seen.add(ident)
        out.append(item)
    return out


def properties_of(item, number):
    """The pour property set an item stands in for (the names the pour record is made from)."""
    p = {k: v for k, v in (item.get("properties") or {}).items() if _text(k)}
    p["Pour Type"] = _text(item.get("group"))
    if _text(item.get("label")):
        p["Display Type"] = _text(item.get("label"))
    p["Level"] = _text(item.get("level"))
    p["Building"] = _text(item.get("building"))
    p["Building Zone"] = _text(item.get("zone"))
    p["Pour Volume m3"] = _number(item.get("quantity")) or 0.0
    p["Pour ID Number"] = str(number)
    return p


def numbers_of(item):
    """What a rule can take a quantity from: {property set: {name: number}}."""
    values = {k: n for k, v in (item.get("quantities") or {}).items() if _text(k) and (n := _number(v)) is not None}
    if (q := _number(item.get("quantity"))) is not None:
        values.setdefault("quantity", q)
    return {WORK_ITEM_PROPERTY_SET: values} if values else {}


def geometry_of(item):
    return {
        "coords": tuple(_number(item.get(k)) or 0.0 for k in ("x", "y", "z")),
        "bbox_height": _number(item.get("height")) or 0.0,
        "original_building_name": "",
    }


def with_groups(request):
    """The request with a rule group for every group of its work items that its rules do not have: the group of the items, found by their type (their
    group name). A recipe or a rule that names the group then finds them."""
    items = clean(request.get("workItems"))
    if not items:
        return request
    rules = dict(request.get("rules") or {})
    have = {_text(g.get("id")).upper() for g in rules.get("groups") or [] if isinstance(g, dict)}
    added = []
    for name in dict.fromkeys(_text(i.get("group")) for i in items):
        if name.upper() in have:
            continue
        added.append({"id": name, "filters": [{"id": "work-item", "field": "type", "op": "equals", "value": name, "conj": "and"}]})
    if not added:
        return request
    rules["groups"] = [*(rules.get("groups") or []), *added]
    return {**request, "rules": rules}
