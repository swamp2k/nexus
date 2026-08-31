#!/usr/bin/env python3
"""Export compact Nexus activity detail JSON from GarminDB's activity SQLite DB."""

from __future__ import annotations

import json
import math
import os
import sqlite3
from pathlib import Path

MAX_ACTIVITIES = 25
MAX_TRACK_POINTS = 2500


def read_config() -> dict:
    home = Path(os.environ.get("HOME", "~")).expanduser()
    path = home / ".GarminDb" / "GarminConnectConfig.json"
    return json.loads(path.read_text(encoding="utf-8"))


def compact_row(row: sqlite3.Row) -> dict:
    return {key: row[key] for key in row.keys() if row[key] is not None}


def downsample(rows: list[sqlite3.Row]) -> list[sqlite3.Row]:
    if len(rows) <= MAX_TRACK_POINTS:
        return rows
    stride = math.ceil((len(rows) - 2) / (MAX_TRACK_POINTS - 2))
    sampled = [rows[0], *rows[1:-1:stride], rows[-1]]
    return sampled[:MAX_TRACK_POINTS - 1] + [rows[-1]] if sampled[-1] is not rows[-1] else sampled


def export() -> int:
    config = read_config()
    base_dir = Path(config["directories"]["base_dir"])
    db_path = base_dir / "DBs" / "garmin_activities.db"
    if not db_path.exists():
        print(f"[nexus] Activity detail export skipped; DB not found: {db_path}")
        return 0

    out_dir = base_dir / "ActivityDetails"
    out_dir.mkdir(parents=True, exist_ok=True)

    connection = sqlite3.connect(db_path)
    connection.row_factory = sqlite3.Row
    try:
        activities = connection.execute(
            "SELECT activity_id, start_time FROM activities ORDER BY start_time DESC LIMIT ?",
            (MAX_ACTIVITIES,),
        ).fetchall()

        exported = 0
        for activity in activities:
            activity_id = str(activity["activity_id"])
            records = connection.execute(
                "SELECT timestamp, position_lat, position_long, distance, cadence, hr, rr, altitude, speed, temperature "
                "FROM activity_records WHERE activity_id = ? ORDER BY record",
                (activity_id,),
            ).fetchall()
            laps = connection.execute(
                "SELECT lap, start_time, stop_time, elapsed_time, moving_time, start_lat, start_long, stop_lat, stop_long, "
                "distance, avg_hr, max_hr, calories, avg_cadence, max_cadence, avg_speed, max_speed, ascent, descent, "
                "max_temperature, min_temperature, avg_temperature "
                "FROM activity_laps WHERE activity_id = ? ORDER BY lap",
                (activity_id,),
            ).fetchall()

            sampled = downsample(records)
            track = [compact_row(row) for row in sampled]
            payload = {
                "version": 1,
                "activityId": activity_id,
                "sourceRecords": len(records),
                "track": track,
                "laps": [compact_row(row) for row in laps],
                "hasGps": any(row.get("position_lat") is not None and row.get("position_long") is not None for row in track),
            }
            target = out_dir / f"activity_{activity_id}.json"
            temporary = target.with_suffix(".json.tmp")
            temporary.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
            temporary.replace(target)
            exported += 1

        print(f"[nexus] Exported {exported} normalized activity detail file(s)")
        return 0
    finally:
        connection.close()


if __name__ == "__main__":
    raise SystemExit(export())
