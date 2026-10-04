"""Sets one activity code value on every activity of a programme in the
project database (insight-plan.db), replacing whatever value of that code
type the activities had.

    python tools/set_activity_code.py <db> "<programme name>" "<code type>" "<value>" [--apply]

Example (dry run first, then --apply):

    python tools/set_activity_code.py "C:/.../insight-plan.db" ^
        "<programme name>" ^
        "CWA-Building" "HN" --apply

The programme is found by its name as the Inputs list shows it (the whole
name, or a unique part of it). The value is created in the code type if
missing. A copy of the database is saved next to it before anything is
written (insight-plan.db.bak-<time>). Reload the app afterwards.

Note: a scenario programme is replaced on its next Update 4D, so fix the
generator's input too (e.g. config.py CWA_BUILDING_CODE_ALIASES).
"""

import argparse
import sqlite3
import sys
from datetime import datetime
from pathlib import Path


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("db", help="path to insight-plan.db")
    ap.add_argument("programme", help="programme name, or a unique part of it")
    ap.add_argument("code_type", help='activity code type, e.g. "CWA-Building"')
    ap.add_argument("value", help='code value (short name), e.g. "HN"')
    ap.add_argument("--apply", action="store_true", help="write the change (without it: only report what would change)")
    args = ap.parse_args()

    db_path = Path(args.db)
    if not db_path.exists():
        sys.exit(f"No database at {db_path}")
    db = sqlite3.connect(db_path)
    db.execute("PRAGMA busy_timeout = 10000")

    progs = db.execute("SELECT id, name FROM ip_programme WHERE name = ?", (args.programme,)).fetchall()
    if not progs:
        progs = db.execute("SELECT id, name FROM ip_programme WHERE name LIKE ?", (f"%{args.programme}%",)).fetchall()
    if len(progs) != 1:
        names = "\n  ".join(n for _, n in progs) or "(none)"
        sys.exit(f"Expected one programme matching '{args.programme}', found {len(progs)}:\n  {names}")
    pid, name = progs[0]

    types = db.execute(
        "SELECT actv_code_type_id FROM ACTVTYPE WHERE ip_programme_id = ? AND actv_code_type = ?", (pid, args.code_type)
    ).fetchall()
    if len(types) != 1:
        have = [r[0] for r in db.execute("SELECT actv_code_type FROM ACTVTYPE WHERE ip_programme_id = ?", (pid,))]
        sys.exit(f"Code type '{args.code_type}' not found once in '{name}'. It has: {', '.join(have) or '(none)'}")
    type_id = types[0][0]

    code = db.execute(
        "SELECT actv_code_id FROM ACTVCODE WHERE ip_programme_id = ? AND actv_code_type_id = ? AND short_name = ?",
        (pid, type_id, args.value),
    ).fetchone()
    tasks = db.execute("SELECT task_id, proj_id FROM TASK WHERE ip_programme_id = ?", (pid,)).fetchall()
    before = db.execute(
        "SELECT COUNT(*) FROM TASKACTV WHERE ip_programme_id = ? AND actv_code_type_id = ?", (pid, type_id)
    ).fetchone()[0]

    print(f"Programme: {name} (id {pid})")
    print(f"Code type: {args.code_type} (id {type_id}); value '{args.value}' {'exists' if code else 'will be created'}")
    print(f"Activities: {len(tasks)}; with a {args.code_type} value now: {before}")
    if not args.apply:
        print("\nDry run: nothing written. Add --apply to set the value.")
        return

    backup = db_path.with_name(f"{db_path.name}.bak-{datetime.now():%Y%m%d-%H%M%S}")
    with sqlite3.connect(backup) as dst:
        db.backup(dst)
    print(f"Backup: {backup}")

    with db:
        if code:
            code_id = code[0]
        else:
            code_id = (db.execute("SELECT COALESCE(MAX(CAST(actv_code_id AS INTEGER)), 0) + 1 FROM ACTVCODE WHERE ip_programme_id = ?", (pid,)).fetchone()[0])
            seq = db.execute("SELECT COALESCE(MAX(seq_num), 0) + 1 FROM ACTVCODE WHERE ip_programme_id = ? AND actv_code_type_id = ?", (pid, type_id)).fetchone()[0]
            db.execute(
                "INSERT INTO ACTVCODE (ip_programme_id, actv_code_id, parent_actv_code_id, actv_code_type_id, actv_code_name, short_name, seq_num) VALUES (?, ?, NULL, ?, ?, ?, ?)",
                (pid, code_id, type_id, args.value, args.value, seq),
            )
        db.execute("DELETE FROM TASKACTV WHERE ip_programme_id = ? AND actv_code_type_id = ?", (pid, type_id))
        db.executemany(
            "INSERT INTO TASKACTV (ip_programme_id, task_id, actv_code_type_id, actv_code_id, proj_id) VALUES (?, ?, ?, ?, ?)",
            [(pid, task_id, type_id, code_id, proj_id) for task_id, proj_id in tasks],
        )
    after = db.execute(
        "SELECT COUNT(*) FROM TASKACTV WHERE ip_programme_id = ? AND actv_code_type_id = ? AND actv_code_id = ?", (pid, type_id, code_id)
    ).fetchone()[0]
    print(f"Done: {after} activities now have {args.code_type} = {args.value}. Reload the app to see it.")


if __name__ == "__main__":
    main()
