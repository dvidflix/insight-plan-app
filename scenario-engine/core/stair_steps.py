# core/stair_steps.py
"""In-situ stair steps: a small in-situ stair pour (volume under STAIR_STEP_MAX_VOLUME_M3)
is most likely a step cast with a stair flight (in-situ or precast). Using the clash results (pours within
CLEARANCE_MM of each other = touching), each step is linked to the stair flight it touches:

  rec["stair_parent"]          the flight's record
  rec["stair_parent_pour_id"]  the flight's pour ID, for the activity name
                               ("... (part of stair 0043)")

A linked step is scheduled at its stair: on the stair's level, in the "In-situ Stair
Steps" WBS group (activity_generator / xml_builder read stair_parent / is_stair_step). Stairs are never left out for being small (main.py's
volume rule skips them), so steps are scheduled like any other stair pour. A step touching only other steps is linked through them. A step touching no stair stays
an ordinary stair pour."""
from config import STAIR_STEP_MAX_VOLUME_M3
from core import rules as _rules


def _is_stair(rec):
    return "STAIR" in str(rec.get("pour_type", "") or "").replace(" ", "_").upper()


def _is_insitu_stair(rec):
    ptype = str(rec.get("pour_type", "") or "").replace(" ", "_").upper()
    return "STAIR" in ptype and str(rec.get("conc_stage", "") or "").strip().upper() != "PRECAST"


def stair_group_label(rec):
    """The WBS group an in-situ stair pour goes in: its steps have a group of their own."""
    return "In-situ Stair Steps" if rec.get("is_stair_step") else "In-situ Stairs"


def _volume(rec):
    try:
        return float(rec.get("volume") or 0.0)
    except (TypeError, ValueError):
        return 0.0


def _distance(clash):
    try:
        return float(clash.get("Distance (m)", clash.get("Distance (mm)", 0.0) / 1000.0))
    except (TypeError, ValueError):
        return 0.0


def link_stair_steps(records, clashes):
    """Sets stair_parent / stair_parent_pour_id on the in-situ stair steps that touch a stair
    flight (directly or through other steps). Returns how many steps were linked."""
    by_guid = {}
    for rec in records:
        guid = str(getattr(rec.get("element"), "GlobalId", "") or "").strip()
        if guid:
            by_guid[guid] = rec

    # Every stair pour can be a flight (precast flights included); a step is a small in-situ one.
    stairs = {guid: rec for guid, rec in by_guid.items() if _is_stair(rec)}
    def step(rec):
        if not _is_insitu_stair(rec):
            return False
        by_group = _rules.active().is_stair_step(rec)  # the rule groups treated as stair steps, when the rules have any
        return by_group if by_group is not None else _volume(rec) < STAIR_STEP_MAX_VOLUME_M3

    is_step = {guid: step(rec) for guid, rec in stairs.items()}
    # Every small in-situ stair pour is a step (linked to a stair or not): it has its own WBS group.
    for guid, rec in stairs.items():
        rec["is_stair_step"] = is_step[guid]
        if not is_step[guid]:
            rec.pop("stair_parent", None)
            rec.pop("stair_parent_pour_id", None)
    if not stairs or not clashes:
        return 0

    # Touching stair pours: guid -> [(other guid, distance)]
    touching = {guid: [] for guid in stairs}
    for clash in clashes:
        a = str(clash.get("Pour A GUID") or "").strip()
        b = str(clash.get("Pour B GUID") or "").strip()
        if a in stairs and b in stairs and a != b:
            d = _distance(clash)
            touching[a].append((b, d))
            touching[b].append((a, d))

    # root[guid] = the flight a step belongs to (a flight is its own root). Grown outwards
    # from the flights so a step touching only another step is still reached.
    root = {guid: guid for guid, step in is_step.items() if not step}
    linked = 0
    changed = True
    while changed:
        changed = False
        for guid, step in is_step.items():
            if not step or guid in root:
                continue
            # The nearest touching pour that already has a flight; the larger flight on a tie.
            options = [(d, -_volume(stairs[other]), root[other]) for other, d in touching[guid] if other in root]
            if not options:
                continue
            root[guid] = min(options)[2]
            changed = True

    for guid, step in is_step.items():
        if not step or guid not in root:
            continue
        step_rec = stairs[guid]
        parent = stairs[root[guid]]
        step_rec["stair_parent"] = parent
        step_rec["stair_parent_pour_id"] = str(parent.get("task_pour_id") or parent.get("pour_id") or "").strip()
        linked += 1
    return linked
