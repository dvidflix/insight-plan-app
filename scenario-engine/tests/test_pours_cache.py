"""core/pours_cache.py: the pour list kept on disk while the model and the generator are the same."""
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core import pours_cache  # noqa: E402


def files(tmp_path):
    src, enriched, geo = tmp_path / "m.ifc", tmp_path / "m_enriched.ifc", tmp_path / "m.geometry_cache.json"
    for f in (src, enriched, geo):
        f.write_text("x")
    return src, enriched, geo


def test_a_pour_list_is_read_back_while_nothing_changed(tmp_path):
    key = pours_cache.key_for(*files(tmp_path), engine_dir=tmp_path)
    assert pours_cache.read(tmp_path, "m", key) is None
    pours_cache.write(tmp_path, "m", key, {"headers": ["a"], "rows": [["1"]]})
    assert pours_cache.read(tmp_path, "m", key) == {"headers": ["a"], "rows": [["1"]]}


def test_another_model_file_or_a_newer_generator_makes_it_stale(tmp_path):
    src, enriched, geo = files(tmp_path)
    key = pours_cache.key_for(src, enriched, geo, engine_dir=tmp_path)
    pours_cache.write(tmp_path, "m", key, {"rows": []})
    later = time.time() + 50
    os.utime(src, (later, later))                                  # the source IFC was replaced
    assert pours_cache.read(tmp_path, "m", pours_cache.key_for(src, enriched, geo, engine_dir=tmp_path)) is None
    key2 = pours_cache.key_for(src, enriched, geo, engine_dir=tmp_path)
    pours_cache.write(tmp_path, "m", key2, {"rows": []})
    code = tmp_path / "rules.py"
    code.write_text("x")
    os.utime(code, (later + 100, later + 100))                     # the generator's code changed
    assert pours_cache.read(tmp_path, "m", pours_cache.key_for(src, enriched, geo, engine_dir=tmp_path)) is None


def test_a_missing_file_means_nothing_is_cached(tmp_path):
    src, enriched, geo = files(tmp_path)
    geo.unlink()
    assert pours_cache.key_for(src, enriched, geo, engine_dir=tmp_path) is None
    pours_cache.write(tmp_path, "m", None, {"rows": []})
    assert not list(tmp_path.glob("pours.*"))


def test_an_unreadable_cache_is_ignored(tmp_path):
    key = pours_cache.key_for(*files(tmp_path), engine_dir=tmp_path)
    (tmp_path / "pours.m.cache.json").write_text("{not json")
    assert pours_cache.read(tmp_path, "m", key) is None
