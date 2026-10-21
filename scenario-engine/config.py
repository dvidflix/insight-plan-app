# src/config.py
"""
Central configuration values for the CWA Planning automation tool
"""
from pathlib import Path
import os
from datetime import datetime

# Project-specific values (project names, model file names, building maps) live
# in project_local.py next to this file. It is git-ignored, so none of that
# reaches the repository; without it the neutral defaults below apply.
_LOCAL = {}
_local_file = Path(__file__).with_name("project_local.py")
if _local_file.exists():
    _ns = {}
    exec(compile(_local_file.read_text(encoding="utf-8"), str(_local_file), "exec"), _ns)
    _LOCAL = {k: v for k, v in _ns.items() if not k.startswith("_")}

# ── Project paths ────────────────────────────────────────────────────────────
# Folder structure (type-based, one purpose per folder):
#   1-input-ifc      raw/enriched-ready IFCs fed into this tool
#   2-enriched-ifc   IFCs this tool writes out (pour IDs, colors, spatial structure)
#   3-schedule-xml   P6 XML schedules (per model + MASTER)
#   4-schedule-xlsx  Excel schedules + overrides (per model + MASTER)
#   5-blender-files  .blend / .cache.json produced by opening IFCs in Blender/Bonsai
#   6-output-videos  4D video renders (next workflow step)
PROJECT_ROOT = Path(__file__).parent.parent.resolve()

DEFAULT_INPUT_DIR  = PROJECT_ROOT / "1-input-ifc"
ENRICHED_IFC_DIR    = PROJECT_ROOT / "2-enriched-ifc"
XML_DIR             = PROJECT_ROOT / "3-schedule-xml"
XLSX_DIR            = PROJECT_ROOT / "4-schedule-xlsx"
BLENDER_DIR          = PROJECT_ROOT / "5-blender-files"
VIDEO_DIR            = PROJECT_ROOT / "6-output-videos"

# Kept for backward compatibility with code/tools that still expect a single
# output root (e.g. --output-dir default). New code should prefer the
# type-specific dirs above.
DEFAULT_OUTPUT_DIR = PROJECT_ROOT

# Default input files (used when no command-line arguments are provided)
DEFAULT_IFC_FILE   = DEFAULT_INPUT_DIR / _LOCAL.get("DEFAULT_IFC_NAME", "model.ifc")

INPUT_FILE         = str(DEFAULT_IFC_FILE)

# ── Project constants ────────────────────────────────────────────────────────
WBS_PREFIX          = _LOCAL.get("WBS_PREFIX", "{BUILDING_CODE}")      # will be formatted later
PROJECT_SHORT       = _LOCAL.get("PROJECT_SHORT", "PRJ")   # first part of every activity ID (PRJ-HVD-L2-B-0049-I)
# Name of the model property that holds the alternative pour ID
ALT_POUR_ID_PROP    = _LOCAL.get("ALT_POUR_ID_PROP", "Alt Pour ID")
CLEARANCE_MM        = 5

# Per-building starting ObjectId block for XML WBS generation.
# The first generated WBS ObjectId for a building will be this value.
WBS_BUILDING_ROOT_OBJECT_ID = {
    "DEFAULT": 1,
    "CRX": 2,
    "1HR": 3,
    "1HK": 4,
    "1HL1": 5,
    "1HL4": 6,
    "1HL23": 7,
    "1HW": 8,
    "1HDAB": 9,
    "1HDCD": 10,
    "HHI": 11,
    "1HN": 12,
    "1HQA": 13,
    "1HQB": 14,
    "2HQC": 15,
    "1HVD": 16,
    "1HXA": 17,
    "1HVL": 18,
    "HR": 3,
    "HK": 4,
    "HL1": 5,
    "HL4": 6,
    "HL23": 7,
    "HW": 8,
    "HDAB": 9,
    "HDCD": 10,
    "HN": 12,
    "HQA": 13,
    "HQB": 14,
    "HQC": 15,
}

# ── Building name mapping (fix/merge source IfcBuilding entities) ───────────
# Maps the ORIGINAL IfcBuilding.Name values found in a source IFC (as
# authored, e.g. by Revit/Tekla) to the FINAL building code this tool should
# use. If two or more original names map to the same final value within the
# same file, their elements are merged into a single IfcBuilding in the
# generated output.
#
# Scoped PER INPUT FILE (outer key = the input .ifc filename without
# extension) because zone-style original names (EAST/WEST/CENTRAL/RAFT/...)
# are commonly reused across different files for unrelated buildings — a
# flat global table would incorrectly merge those together.
#
# Inner keys must be the original name UPPERCASED and stripped of
# surrounding spaces. The "DEFAULT" entry (optional) applies to any file not
# explicitly listed. Original names not present in the resolved mapping fall
# back to the existing "Building"/"Unit" property-based derivation.
#
# Example:
# BUILDING_NAME_MAP = {
#     "PROJECT-MODEL-FILE-NAME": {
#         "1": "1", "CONNECTION": "1", "RAFT": "1",
#         "EAST1_P": "1", "WEST1_P": "1", "CENTRAL1_P": "1",
#         "CENTRAL": "1", "CENTRAL1": "1", "EAST1": "1", "WEST1": "1",
#         "EAST": "1", "EAST_P": "1", "CENTRAL_P": "1", "WEST_P": "1",
#         "EXTERNAL": "1", "WEST": "1",
#     },
#     "DEFAULT": {},
# }
# The CWA-Building activity code only has the standard building values
# (xml_builder._CWA_BUILDING_VALUES). A model whose CWA Pour / Building is
# written differently is mapped onto the value it stands for here - e.g. the
# HNX civils model is building HN - rather than left without the code.
CWA_BUILDING_CODE_ALIASES = {
    "HNX": "HN",
}

BUILDING_NAME_MAP = _LOCAL.get("BUILDING_NAME_MAP", {})

EXCLUDED_POUR_TYPES = {"BOSS", "SCREED", "GROUT", "SPECIAL"}
MIN_VOLUME_OVERRIDE = 1
ABBREVIATE_TASKNAME = False

# ── Level property source configuration ──────────────────────────────────────
# Configure which property set and property to use for level information per building
# Format: "BUILDING_CODE": {"pset": "PropertySetName", "property": "PropertyName"}
# Default: {"pset": "CWA Pour", "property": "Level"}

LEVEL_PROPERTY_SOURCE = {
    # Default for all buildings not explicitly listed
    "DEFAULT": {"pset": "CWA Pour", "property": "Level"}
}

# Controls formatting style of activity/task names
USE_TITLE_CASE_IN_TASK_NAMES = True

# ── Level code formatting ────────────────────────────────────────────────────
USE_PADDED_LEVEL_CODES = False
LEVEL_CODE_FALLBACK    = "L0"

# ── Duration settings ────────────────────────────────────────────────────────
# The engine has no duration table: the days of every phase are Duration / Productivity rules of the scenario (the 1HDAB_TOC preset holds
# the table this project used). Where no rule fits, a phase takes these neutral days, and a component (Rebar, Embedments, Formwork, Concrete)
# of the Rebar / Formwork / Concrete activities takes its own.
DEFAULT_PHASE_DAYS = 1
DEFAULT_COMPONENT_DAYS = {"Rebar": 1, "Embedments": 0, "Formwork": 1, "Concrete": 1}

PHASE_DEFINITIONS = [
    {"name": "Rebar",      "suffix": "-R", "resource": f"{PROJECT_SHORT}-R",  "wbs_sub": "Rebar",      "duration": "Rebar"},
    {"name": "Formwork",   "suffix": "-F", "resource": None,     "wbs_sub": "Formwork",   "duration": ["Embedments", "Formwork"]},
    {"name": "Concrete",   "suffix": "-C", "resource": f"{PROJECT_SHORT}-C",  "wbs_sub": "Concrete",   "duration": "Concrete"}
]

# In-situ stair pours under this volume (m3) are taken to be steps cast with a stair flight:
# each is linked to the stair it touches (core/stair_steps.py), scheduled in that stair's WBS
# and named "... (part of stair <pour ID>)".
STAIR_STEP_MAX_VOLUME_M3 = 0.09

# Scheduling optional features
ENABLE_GROUP_MILESTONES = False  # GET/GIVE/Summary
ENABLE_BUILDING_COMPLETION = False

# Level gate master switch. False: a slab's predecessors come only from the
# clash-derived slab-support edges (pours touching below, walls beside), not
# from every pour of the level below. True: the behaviour described below.
# On, so each level's slabs wait for the level below's concrete (otherwise a slab
# with nothing above touching it is left with no successor).
ENABLE_LEVEL_GATE = True
# How what supports a slab (walls, columns, pedestals under or beside it) is linked to the slab's first activity. False: finish-to-start (the slab
# starts after they are cast). True: finish-to-finish, the slab's first activity finishing SUPPORT_LAG_PCT % of its own duration after they finish
# (so it can start earlier and overlap them, as the programme the team builds by hand does; normally 80).
SUPPORT_LINK_FF = False
SUPPORT_LAG_PCT = 0.0
# How the user's sequence steps follow each other: False = each step starts when the previous one is finished; True = a step starts SEQUENCE_LEAD_DAYS
# working days after the previous one starts and the concrete is poured in step order (core/xml_builder.py).
SEQUENCE_FLOW = False
SEQUENCE_LEAD_DAYS = 3.0
# With SEQUENCE_FLOW: True = a step's concrete also waits for the previous step's to finish, so the pours go in exactly the order of the steps (a pour
# that is not ready yet holds up every pour after it); False = the order only sets when each step starts, and a pour is cast when it is ready.
SEQUENCE_CONCRETE_FOLLOWS = True

# Close-out: a "<project>-<building>-COMPLETION" finish milestone per building, which
# every activity left with no successor feeds (FS), so the programme has no open ends.
ENABLE_COMPLETION_CLOSEOUT = True

# Before the close-out, an activity left with no successor (a column, a wall, a removable element, a landing...)
# precedes the start of the slab sitting on it, so it is part of the sequence; only pours with nothing above
# them (the roof) end on the completion milestone. A slab counts as "on it" within this reach (m, plan gap and
# vertical gap, like the level gate).
ENABLE_OPEN_END_SEQUENCING = True
OPEN_END_MAX_DISTANCE_M = 0.3
# With none in reach, precede the nearest slab above instead (only the roof's pours then end on the completion milestone).
OPEN_END_NEAREST_SLAB_FALLBACK = True

# Level gate: only tie SLAB pours back to the level below; walls/columns/
# stairs follow their own slab via clash-derived slab-support edges. Set
# False for the old behaviour (every start task -> every lower-level final).
LEVEL_GATE_SLABS_ONLY = True

# Level-gate predecessors feeding a slab's first task (Decking): only the
# lower level's pure "Concrete" phase tasks count, and stage-2 pours are
# excluded. Set False to also count Stitching/Installation/combined finals
# and stage-2 pours.
LEVEL_GATE_DECKING_CONCRETE_ONLY = True

# Level gate reach (m): a slab only waits for lower-level pours whose 3D gap to it
# (plan gap and vertical gap, measured from the geometry) is within this, instead
# of every pour of the level below across the building (which gave a slab's Decking
# dozens of far-away predecessors). If none is that close, the nearest one is used;
# pours whose geometry can't be measured are kept. None/0 = no limit (old behaviour).
LEVEL_GATE_MAX_DISTANCE_M = 0.05

# Curing is an activity of the slab and raft chains (Rules > Chains), with its days and its 7-day calendar from Assignments.
# False: what follows a slab (the pours it supports, the slab on the level above) waits for the slab's Concrete only,
# and Curing runs alongside. True: it waits for the Curing to finish.
SLAB_CURING_GATES_SUCCESSORS = False
# Every pool (equipment, cranes, materials) and every labour trade has no limit: the programme the logic alone allows (a scenario's "Maximize resource availability").
MAXIMIZE_RESOURCES = False

# Pour ID behavior
# True: generate new planning proposed pour IDs (current workflow).
# False: use model-provided proposed IDs / existing Pour ID values.
GENERATE_NEW_POUR_IDS = True

# Controls how P6 ActivityCode assignments are sourced in XML output.
# False keeps the current record/building-derived mapping.
# True derives the code source from the activity identifier on the activity itself.
USE_ACTIVITY_BASED_ACTIVITY_CODES = True

# Fraction of the smaller clashing pour's own height that must vertically
# overlap the other pour's height for the pair to be classified "Side"
# (roughly level with each other) instead of "Majority Below"/"Majority
# Above" — see core/clash_position.classify_vertical_position(). Tune this
# if real clash data shows the boundary is landing wrong.
CLASH_POSITION_SIDE_OVERLAP_THRESHOLD = 0.5

# ── Resources: rebar and labour ─────────────────────────────────────────────
# Rebar tonnes per m³ of concrete are Rebar rate rules of the scenario (none: no rebar quantity). The tonnes go onto each pour's Rebar
# activity as the <project>-R (Rebar, t) resource.
# The labour trades (code, name, people per day on site) are Trade rules of the scenario (Rules panel): the engine has none of its own.
LABOUR_RESOURCE_PREFIX = f"{PROJECT_SHORT}-L-"   # resource Id = prefix + trade code, e.g. PRJ-L-SF

# Crews are Crews and Assignments of the scenario's rules (the engine has no crew table of its own; the Overrides workbook's "Crews" sheet
# still adds rows by phase and pour type).

# The activity chains are Chain rules of the scenario (Rules > Chains): the phases of a pour, in order. Where no chain fits, an in-situ pour
# has these and a precast pour (concrete stage PRECAST) has the second.
DEFAULT_CHAIN = [
    {"phase": "Rebar", "suffix": "-R", "label": "Rebar"},
    {"phase": "Formwork", "suffix": "-F", "label": "E/P and Formwork"},
    {"phase": "Concrete", "suffix": "-C", "label": "Concrete"},
]
# Precast pours: installed, then stitched (the joints between the units). Heavy precast (the walls the slabs sit on) is propped while it
# is installed, stitched, cured (28 days, under the walls above) and then its props come out once the wall concrete above has gained
# strength (core/xml_builder.py links these). "days" is what each takes without a rule (Rules > Assignments set their own).
DEFAULT_PRECAST_CHAIN = [
    {"phase": "Installation", "suffix": "-I", "label": "Installation", "days": 1},
    {"phase": "Stitching", "suffix": "-S", "label": "Stitching", "days": 2},
]
DEFAULT_HEAVY_PRECAST_CHAIN = [
    {"phase": "Propping", "suffix": "-PR", "label": "Propping", "days": 1},
    {"phase": "Installation", "suffix": "-I", "label": "Installation", "days": 1},
    {"phase": "Stitching", "suffix": "-S", "label": "Stitching", "days": 2},
    {"phase": "Curing", "suffix": "-CU", "label": "Curing (walls under)", "days": 28},
    {"phase": "Propping Removal", "suffix": "-RP", "label": "Propping Removal", "days": 1},
]

# Project start / data date for the CPM. None = today. The insight-plan-app
# Scenarios tab passes CWA_START_DATE (YYYY-MM-DD) so every scenario of a
# comparison shares one start date instead of drifting with the run day.
START_DATE = datetime.strptime(os.environ["CWA_START_DATE"], "%Y-%m-%d") if os.environ.get("CWA_START_DATE") else None


# The SeaTable copies (the wall-class rates, and the retired / extra activities) are found through the INSIGHT_RATES_FILE and
# INSIGHT_ADJUSTMENTS_FILE environment variables, which the app sets (vite-plugins/engineFiles.ts); no variable, no file, no fields.
