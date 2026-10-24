"""The sample building (public/sample/sample-building.ifc, made by scripts/make-sample-ifc.py) in a real project folder, run the way the app runs it
(vite-plugins/scenarios.ts): the one-time preparation (main.py --stage schedule), then the long-running generator (serve.py) asked for the pour list
(what opening a plan reads) and for a programme from work packages (what Generate sends). Generate's "Try the sample building" depends on all three."""
import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

ENGINE = Path(__file__).resolve().parents[1]
SAMPLE = ENGINE.parent / "public" / "sample" / "sample-building.ifc"
STEM = "sample-building"


def items():
    """Two packages, the second after the first, each with one activity of fixed days (as a standard method is sent)."""
    work = [
        {"id": "WP|A", "group": "WP-01 First", "building": "Sample building", "level": "Ground floor", "name": "WP-01 First", "quantity": 9.2, "quantities": {"count": 6, "area": 0}},
        {"id": "WP|B", "group": "WP-02 Second", "building": "Sample building", "level": "Ground floor", "name": "WP-02 Second", "quantity": 3.1, "quantities": {"count": 6, "area": 0}},
    ]
    rules = {
        "sequences": [{"id": "STEPS", "name": "Work packages", "steps": [{"group": "WP-01 First"}, {"group": "WP-02 Second"}]}],
        "recipes": [
            {"id": "m1", "group": "WP-01 First", "priority": 1000, "tasks": [{"phase": "Build", "name": "Build", "formula": "2"}]},
            {"id": "m2", "group": "WP-02 Second", "priority": 1000, "tasks": [{"phase": "Build", "name": "Build", "formula": "3"}]},
        ],
    }
    return work, rules


@pytest.mark.skipif(not SAMPLE.exists(), reason="the sample model is not built (scripts/make-sample-ifc.py)")
def test_the_sample_prepares_opens_and_generates_from_packages(tmp_path):
    root = tmp_path / "Sample project"
    (root / "models").mkdir(parents=True)
    ifc = root / "models" / f"{STEM}.ifc"
    shutil.copy(SAMPLE, ifc)
    base = root / "scenarios" / "_base"
    base.mkdir(parents=True)
    empty = base / f"{STEM}.scenario.json"
    empty.write_text(json.dumps({"version": 1, "building": STEM, "sequence": [], "relations": [], "crews": []}), encoding="utf-8")

    # 1. The one-time preparation.
    prep = subprocess.run([sys.executable, "-X", "utf8", "main.py", "--input", str(ifc), "--stage", "schedule", "--skip-master-excel", "--skip-excel",
                           "--output-dir", str(base), "--workers", "1", "--overrides-json", str(empty)], cwd=ENGINE, capture_output=True, text=True, encoding="utf-8", timeout=600)
    assert prep.returncode == 0, prep.stdout[-3000:] + prep.stderr[-3000:]
    assert (base / "2-enriched-ifc" / f"{STEM}.geometry_cache.json").exists()

    # 2 and 3. The generator: the pour list, then a programme from two work packages.
    work, rules = items()
    plan = root / "scenarios" / "Sample plan"
    requests = [
        {"id": 1, "op": "pours", "input": str(ifc), "scenarioDir": str(base), "startDate": None},
        {"id": 2, "op": "generate", "input": str(ifc), "scenarioDir": str(plan), "startDate": "2026-11-02", "workItems": work,
         "sequence": [], "relations": [], "crews": [], "extras": [], "rules": rules},
    ]
    run = subprocess.run([sys.executable, "-X", "utf8", "serve.py"], cwd=ENGINE, input="\n".join(json.dumps(r) for r in requests) + "\n",
                         capture_output=True, text=True, encoding="utf-8", timeout=600)
    replies = {r["id"]: r for r in (json.loads(line) for line in run.stdout.splitlines() if line.strip())}
    assert replies[1]["ok"], replies[1]
    assert "GUID" in replies[1]["headers"]
    assert replies[2]["ok"], replies[2]
    xml = Path(replies[2]["xml"]).read_text(encoding="utf-8")
    # Each package's activity carries its work item, so the app can tell whose it is (Compare's critical path, the 4D links).
    assert "<TextValue>WP|A</TextValue>" in xml and "<TextValue>WP|B</TextValue>" in xml
