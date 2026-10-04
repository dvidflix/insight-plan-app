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

# ── Building coordinate thresholds ───────────────────────────────────────────
# Configure X or Y coordinate thresholds for each building to determine cardinal zones
# Format: "BUILDING_CODE": {"axis": "X" or "Y", "threshold": float_value}
# Example: If axis="X" and threshold=2150.0, then X > 2150.0 = North, X <= 2150.0 = South
#          If axis="Y" and threshold=1000.0, then Y > 1000.0 = East, Y <= 1000.0 = West

BUILDING_COORDINATES = {
    "CRX":        {"axis": "X", "threshold": None},
    "HK":         {"axis": "X", "threshold": None},
    "HR":         {"axis": "X", "threshold": None},
    "HL1":        {"axis": "X", "threshold": None},
    "HL4":        {"axis": "X", "threshold": None},
    "HL23":       {"axis": "X", "threshold": None},
    "HW":         {"axis": "X", "threshold": None},
    "HDAB":       {"axis": "X", "threshold": 1914},
    "HDCD":       {"axis": "X", "threshold": 2088.3},
    "HHI":        {"axis": "Y", "threshold": 5851.627},
    "HN":         {"axis": "X", "threshold": 2047.048},
    "HQA":        {"axis": "X", "threshold": 2085.3501},
    "HQB":        {"axis": "X", "threshold": 2085.9501},  # Add X or Y threshold value
    "HQC":        {"axis": "X", "threshold": 1844.6501},
    "HVD":        {"axis": "X", "threshold": 2150.4501},
    "HXA":        {"axis": "X", "threshold": 2125.2501},
    "HVL":        {"axis": "X", "threshold": None},
    # Fallback for unknown buildings
    "DEFAULT":    {"axis": "X", "threshold": 2150.0}
}

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
DURATIONS = {
    "Standard External Wall":      {"Rebar": 7,   "Embedments": 2,  "Formwork": 3,  "Concrete": 1},
    "Double Height External Wall": {"Rebar": 12,  "Embedments": 4,  "Formwork": 5,  "Concrete": 1},
    "Standard Internal Wall":      {"Rebar": 4,   "Embedments": 6,  "Formwork": 3,  "Concrete": 1},
    "Double Height Internal Wall": {"Rebar": 9,   "Embedments": 8,  "Formwork": 3,  "Concrete": 1},
    "Standard Internal Slab":      {"Rebar": 18,  "Embedments": 18, "Formwork": 2,  "Concrete": 1},
    "Other":                       {"Rebar": 5,   "Embedments": 2,  "Formwork": 4,  "Concrete": 1}
}

PHASE_DEFINITIONS = [
    {"name": "Rebar",      "suffix": "-R", "resource": f"{PROJECT_SHORT}-R",  "wbs_sub": "Rebar",      "duration": "Rebar"},
    {"name": "Formwork",   "suffix": "-F", "resource": None,     "wbs_sub": "Formwork",   "duration": ["Embedments", "Formwork"]},
    {"name": "Concrete",   "suffix": "-C", "resource": f"{PROJECT_SHORT}-C",  "wbs_sub": "Concrete",   "duration": "Concrete"}
]

# Scheduling optional features
ENABLE_GROUP_MILESTONES = False  # GET/GIVE/Summary
ENABLE_BUILDING_COMPLETION = False

# Level gate master switch. False: a slab's predecessors come only from the
# clash-derived slab-support edges (pours touching below, walls beside), not
# from every pour of the level below. True: the behaviour described below.
ENABLE_LEVEL_GATE = False

# Level gate: only tie SLAB pours back to the level below; walls/columns/
# stairs follow their own slab via clash-derived slab-support edges. Set
# False for the old behaviour (every start task -> every lower-level final).
LEVEL_GATE_SLABS_ONLY = True

# When False, the slab phase sequence skips the "Works before slab" task
# entirely (Decking becomes the slab's first activity).
ENABLE_WORKS_BEFORE_SLAB = False

# Level-gate predecessors feeding a slab's first task (Decking): only the
# lower level's pure "Concrete" phase tasks count, and stage-2 pours are
# excluded. Set False to also count Stitching/Installation/combined finals
# and stage-2 pours.
LEVEL_GATE_DECKING_CONCRETE_ONLY = True

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
# Rebar tonnes per m³ of concrete, by pour type (normalised: upper case,
# spaces → underscores). "DEFAULT" covers every type not listed. 0.25 t/m³ =
# 250 kg/m³ ("rebar = 25% of the concrete volume, in tonnes"). The tonnes go
# onto each pour's Rebar activity as the <project>-R (Rebar, t) resource.
REBAR_TONNES_PER_M3 = {
    "DEFAULT": 0.25,
    "WALL": 0.25,
    "SLAB": 0.25,
    "MAIN_SLAB": 0.25,
    "RAFT": 0.25,
}

# Labour trades: resource Id suffix -> name and site capacity (people per day,
# written to P6 as the resource's max units/time and used by the app as the
# levelling limit until changed there). PLACEHOLDER capacities — set them to
# the gangs actually available.
LABOUR_TRADES = {
    "SF": {"name": "Steel fixers",          "capacity": 24},
    "CP": {"name": "Carpenters / formwork", "capacity": 24},
    "CG": {"name": "Concrete gang",         "capacity": 12},
    "GO": {"name": "General operatives",    "capacity": 12},
    "EM": {"name": "Embedments fixers",     "capacity": 8},
    "PE": {"name": "Precast erection crew", "capacity": 8},
}
LABOUR_RESOURCE_PREFIX = f"{PROJECT_SHORT}-L-"   # resource Id = prefix + trade code, e.g. PRJ-L-SF

# Crew per activity phase: [(trade code, crew size), ...] — people working on
# that activity every day of its duration (man-hours = crew × duration × 8 h,
# as in Labour_Resource_Assignment_and_Levelling.xlsx). Keyed by phase name as
# activity_generator.py names them; "<phase>|<POUR_TYPE>" rows win over the
# plain phase for that pour type. An empty list = no labour (e.g. Curing).
# PLACEHOLDER crew sizes — tune here, or per scenario in the Overrides
# workbook's "Crews" sheet (columns Phase, PourType, Trade, Crew).
CREW_TABLE = {
    "Rebar":                        [("SF", 6)],
    "Rebar|SLAB":                   [("SF", 8)],
    "Rebar|MAIN_SLAB":              [("SF", 8)],
    "Rebar|RAFT":                   [("SF", 10)],
    "Formwork":                     [("CP", 6)],
    "Works before slab":            [("GO", 4)],
    "Decking":                      [("CP", 6)],
    "Under Slab":                   [("GO", 4)],
    "EOP on Slab":                  [("EM", 3)],
    "FWK":                          [("CP", 4)],
    "Concrete":                     [("CG", 6)],
    "Rebar, Formwork and Concrete": [("SF", 3), ("CP", 3), ("CG", 3)],
    "Propping":                     [("PE", 4)],
    "Installation":                 [("PE", 6)],
    "Stitching":                    [("SF", 2), ("CG", 3)],
    "Curing":                       [],
    "Propping Removal":             [("PE", 4)],
}

# Note: For slabs we override "Formwork" → "Decking" / "-D" in activity_generator.py

PRECAST_ACTIVITY_DEFINITIONS = [
    {
        "name": "Installation",
        "suffix": "-I",
        "resource": "",
        "duration_days": 1,
        "task_name_suffix": " - Precast Installation"
    },
    {
        "name": "Stitching",
        "suffix": "-S",
        "resource": "",
        "duration_days": 2,
        "task_name_suffix": " - Stitching"
    }
]

# Heavy Precast only: an extra activity ahead of Installation. Not part of
# PRECAST_ACTIVITY_DEFINITIONS because Removable Element / Stair precast
# pours (which also route through the PRECAST conc_stage branch) don't get
# it — see activity_generator.create_activities' _is_heavy_precast_rec check.
PRECAST_PROPPING_DEFINITION = {
    "name": "Propping",
    "suffix": "-PR",
    "resource": "",
    "duration_days": 1,
    "task_name_suffix": " - Propping"
}

# Heavy Precast only, appended after Stitching:
#   Curing   — the walls underneath reaching 28d strength. A CALENDAR-day
#              count, not a working-day count (concrete cures on weekends
#              too), so this phase's Activity is written onto the 7-day
#              calendar (CalendarObjectId "2" — see
#              xml_builder.add_detailed_calendar / cpm_apply._CWA_CURING_CALENDAR)
#              instead of the normal Mon-Fri one every other phase uses.
#              Its predecessor is cross-record (the underlying wall's own
#              Concrete finishing), not the precast's own Stitching — see
#              xml_builder._build_heavy_precast_wall_predecessors_from_clashes.
#   Propping Removal — dismantling the temporary supports, once Curing
#              finishes.
PRECAST_CURING_DEFINITION = {
    "name": "Curing",
    "suffix": "-CU",
    "resource": "",
    "duration_days": 28,
    "task_name_suffix": " - Curing (walls under)"
}

PRECAST_PROPPING_REMOVAL_DEFINITION = {
    "name": "Propping Removal",
    "suffix": "-RP",
    "resource": "",
    "duration_days": 1,
    "task_name_suffix": " - Propping Removal"
}

# Project start / data date for the CPM. None = today. The insight-plan-app
# Scenarios tab passes CWA_START_DATE (YYYY-MM-DD) so every scenario of a
# comparison shares one start date instead of drifting with the run day.
START_DATE = datetime.strptime(os.environ["CWA_START_DATE"], "%Y-%m-%d") if os.environ.get("CWA_START_DATE") else None


# -- Wall classes and rates (SeaTable "Insight Plan Rates") --
# Local copy written by `python seatable_sync.py pull-rates`. The generator writes each
# wall class and its rate assumptions on the wall activities as user fields (the
# INSIGHT_RATES_FILE environment variable overrides this path). No file: no fields.
RATES_FILE = r"C:\insight-stack\data\rates.json"
