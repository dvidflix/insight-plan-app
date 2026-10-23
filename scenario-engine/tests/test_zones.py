"""The zone definition: which property is the zone, and which zones are connected or disconnected (core/zones.py)."""
import copy

from core import levels, zones


def rec(zone, building="B1", level="L2", **extra):
    """A record as build_pour_records makes it, for a pour whose zone is `zone`."""
    text = str(zone or "")
    dis = "DISCONNECTED" in text.upper()
    con = "CONNECTED" in text.upper() and not dis
    code = "D" if dis else "C" if con else ""
    label = "Disconnected - " if dis else "Connected - " if con else ""
    base = f"PRJ-{building}-{level}" + (f"-{code}" if code else "") + "-WL-0012"
    return {
        "building": building, "level_int": 2, "level_code": level, "level_display": level,
        "lg2": f"{building}-{level} - {label}External Wall".strip(" -"), "lg3": f"{building}-{level} - External Wall",
        "task_id_base": base, "general_level_3": f"{building}/{level}/{text}/W", "concrete_wbs_name": "B - L2 - Walls",
        "building_zone": text, "is_connected": con, "is_disconnected": dis,
        "pour_pset": {"Building Zone": text, "Wing": extra.get("wing", "")},
    }


def key(records):
    return [(r["building_zone"], r["is_connected"], r["is_disconnected"], r["task_id_base"], r["lg2"], r["general_level_3"]) for r in records]


def test_with_no_setting_nothing_changes():
    records = [rec("Connected"), rec("Disconnected"), rec("")]
    before = key(records)
    zones.apply(records, {})
    zones.apply(records, {"zoneProperty": ""})
    assert key(records) == before


def test_a_list_names_the_connected_and_disconnected_zones():
    records = [rec("North"), rec("South"), rec("Core")]
    zones.apply(records, {"zoneConnected": ["North"], "zoneDisconnected": ["south"]})
    assert [(r["is_connected"], r["is_disconnected"]) for r in records] == [(True, False), (False, True), (False, False)]
    # called what the ordering of the programme knows them by, whatever the text says
    assert [r["building_zone"] for r in records] == ["CONNECTED", "DISCONNECTED", "Core"]


def test_what_is_made_from_the_zone_follows_it():
    r = rec("North")
    zones.apply([r], {"zoneConnected": ["North"]})
    assert r["task_id_base"] == "PRJ-B1-L2-C-WL-0012"
    assert r["lg2"] == "B1-L2 - Connected - External Wall"
    assert r["general_level_3"] == "B1/L2/North/W"


def test_a_zone_that_stops_being_one_loses_what_it_made():
    r = rec("Connected")
    assert r["task_id_base"] == "PRJ-B1-L2-C-WL-0012"
    zones.apply([r], {"zoneDisconnected": ["Connected"]})
    assert r["task_id_base"] == "PRJ-B1-L2-D-WL-0012" and r["lg2"] == "B1-L2 - Disconnected - External Wall"
    zones.apply([r], {"zoneConnected": ["Nowhere"]})
    assert r["task_id_base"] == "PRJ-B1-L2-WL-0012" and r["lg2"] == "B1-L2 - External Wall"
    assert (r["is_connected"], r["is_disconnected"]) == (False, False)


def test_another_property_is_read_for_the_zone_and_its_words_decide_without_a_list():
    records = [rec("", wing="Connected East"), rec("", wing="Disconnected West"), rec("", wing="Tower")]
    zones.apply(records, {"zoneProperty": "Wing"})
    assert [(r["is_connected"], r["is_disconnected"]) for r in records] == [(True, False), (False, True), (False, False)]
    assert records[0]["task_id_base"] == "PRJ-B1-L2-C-WL-0012"


def test_a_value_in_both_lists_is_disconnected():
    r = rec("X")
    zones.apply([r], {"zoneConnected": ["X"], "zoneDisconnected": ["X"]})
    assert (r["is_connected"], r["is_disconnected"]) == (False, True)


def test_clearing_the_definition_puts_the_original_reading_back():
    records = [rec("Connected"), rec("Disconnected"), rec("North")]
    before = key(records)
    levels.apply(records, {})  # (the generator takes its snapshot of the level texts first, every time)
    zones.apply(records, {"zoneConnected": ["North"], "zoneDisconnected": ["Connected"]})
    assert key(records) != before
    # the level step puts every text made from the level back, then the zones are applied again (as _refresh_records does)
    levels.apply(records, {})
    zones.apply(records, {})
    assert key(records) == before


def test_a_level_code_that_is_also_in_another_token_is_not_confused():
    r = rec("Connected", level="L1")
    r["task_id_base"] = "PRJ-B1-L1-C-WL-0012"
    zones.apply([r], {"zoneConnected": ["Nowhere"]})
    assert r["task_id_base"] == "PRJ-B1-L1-WL-0012"
