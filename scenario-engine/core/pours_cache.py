# core/pours_cache.py
"""The pour list of a building kept on disk, so opening a scenario does not start from the IFC every time.

Opening a scenario asks the generator for the building's pours and its automatic order. That means opening the enriched IFC, building every
pour record and generating a whole programme once: a minute or more on a big model. The answer only changes when the model or the generator
does, so it is written next to the building's other caches (<scenario dir>/pours.<stem>.cache.json) and read back while these are the same:

  the source IFC and the enriched IFC and geometry cache the generator wrote from it (modified time and size), and
  the generator's own code (the newest .py of the engine, project_local.py included).
"""
import json
import os
from pathlib import Path

_ENGINE_DIR = Path(__file__).resolve().parents[1]


def code_version(engine_dir: Path = _ENGINE_DIR) -> float:
    """The newest modification time of the engine's code (its .py files, and project_local.py), as a number."""
    newest = 0.0
    for folder in (engine_dir, engine_dir / "core"):
        try:
            for entry in os.scandir(folder):
                if entry.name.endswith(".py"):
                    newest = max(newest, entry.stat().st_mtime)
        except OSError:
            continue
    return newest


def _stamp(path: Path):
    try:
        st = path.stat()
    except OSError:
        return None
    return [st.st_mtime, st.st_size]


def key_for(source_ifc: Path, enriched_ifc: Path, geometry_cache: Path, engine_dir: Path = _ENGINE_DIR):
    """What the cached pour list depends on; None when a file is missing (nothing to cache against: the generator must run)."""
    stamps = [_stamp(source_ifc), _stamp(enriched_ifc), _stamp(geometry_cache)]
    if any(s is None for s in stamps):
        return None
    return {"files": stamps, "code": code_version(engine_dir)}


def _file(scenario_dir: Path, stem: str) -> Path:
    return Path(scenario_dir) / f"pours.{stem}.cache.json"


def read(scenario_dir: Path, stem: str, key):
    """The cached pour list, or None when there is none or it was made from other files or another version of the generator."""
    if key is None:
        return None
    try:
        saved = json.loads(_file(scenario_dir, stem).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return saved.get("pours") if isinstance(saved, dict) and saved.get("key") == key else None


def write(scenario_dir: Path, stem: str, key, pours) -> None:
    if key is None:
        return
    try:
        _file(scenario_dir, stem).write_text(json.dumps({"key": key, "pours": pours}), encoding="utf-8")
    except (OSError, TypeError, ValueError):
        pass  # a cache that cannot be written is just a slower next time
