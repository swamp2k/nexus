#!/usr/bin/env python3
"""Outbound-only multi-user GarminDB agent for Nexus.

One container can service many Nexus users. Each user gets isolated persistent
GarminDB config/token state and downloaded data directories.
"""

from __future__ import annotations

import datetime
import hashlib
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

NEXUS_URL = os.environ.get("NEXUS_URL", "").rstrip("/")
TOKEN = os.environ.get("NEXUS_GARMIN_AGENT_TOKEN", "")
STATE_ROOT = Path(os.path.expanduser(os.environ.get("NEXUS_GARMIN_STATE_ROOT", "/state/users")))
DATA_ROOT = Path(os.path.expanduser(os.environ.get("NEXUS_GARMIN_DATA_ROOT", "/data/users")))
GARMIN_CLI = os.environ.get("NEXUS_GARMIN_CLI", "garmindb_cli.py")
POLL_SECONDS = max(5, int(os.environ.get("NEXUS_GARMIN_POLL_SECONDS", "15")))
HEARTBEAT_SECONDS = 30

CAPABILITY_FILE = ".nexus-garmin-capabilities.json"
CAPABILITY_VERSION = 2
PROBE_DAYS = 7
PROBE_RECHECK_DAYS = 7
HRV_RECHECK_DAYS = 30
DIRECT_MONITORING_DAYS = 3
STALE_DAYS = {
    "sleep": 14,
    "rhr": 14,
    "weight": 45,
    "heart_rate": 14,
    "steps": 14,
}


def request(path: str, *, method: str = "GET", data: bytes | None = None, content_type: str | None = None):
    headers = {"Authorization": f"Bearer {TOKEN}", "User-Agent": "Nexus-Garmin-Agent/0.8"}
    if content_type:
        headers["Content-Type"] = content_type
    req = urllib.request.Request(f"{NEXUS_URL}{path}", data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=180) as response:
            body = response.read()
            return response.status, json.loads(body) if body else None
    except urllib.error.HTTPError as error:
        body = error.read()
        try:
            detail = json.loads(body) if body else None
        except json.JSONDecodeError:
            detail = body.decode("utf-8", "replace")
        return error.code, detail


def upload_file(path: str, file_path: Path):
    return request(path, method="PUT", data=file_path.read_bytes(), content_type="application/zip")


def report_progress(job_id: str, message: str) -> None:
    payload = json.dumps({"message": message}).encode()
    try:
        status, body = request(
            f"/api/garmin/agent/jobs/{job_id}/progress",
            method="POST",
            data=payload,
            content_type="application/json",
        )
        if status >= 300:
            print(f"[nexus] Progress update failed ({status}): {body}", file=sys.stderr, flush=True)
    except Exception as error:
        print(f"[nexus] Progress update failed: {error}", file=sys.stderr, flush=True)


def safe_user_id(value: str) -> str:
    if not value or any(char not in "0123456789abcdef-" for char in value.lower()) or len(value) > 80:
        raise RuntimeError("Nexus returned an invalid user id")
    return value


def user_paths(user_id: str) -> tuple[Path, Path, Path]:
    safe = safe_user_id(user_id)
    home = STATE_ROOT / safe
    config_dir = home / ".GarminDb"
    data_dir = DATA_ROOT / safe
    config_dir.mkdir(parents=True, exist_ok=True)
    data_dir.mkdir(parents=True, exist_ok=True)
    return home, config_dir, data_dir


def write_json_atomic(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2), encoding="utf-8")
    os.chmod(temporary, 0o600)
    temporary.replace(path)


def utc_now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


def parse_iso_datetime(value: object) -> datetime.datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        parsed = datetime.datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=datetime.timezone.utc)
        return parsed.astimezone(datetime.timezone.utc)
    except ValueError:
        return None


def parse_date(value: object) -> datetime.date | None:
    if not isinstance(value, str):
        return None
    try:
        return datetime.date.fromisoformat(value[:10])
    except ValueError:
        return None


def read_json(path: Path) -> object | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def empty_capabilities() -> dict:
    return {
        "version": CAPABILITY_VERSION,
        "bootstrap_completed": False,
        "last_successful_sync_at": None,
        "sources": {},
    }


def source_entry(capabilities: dict, name: str) -> dict:
    sources = capabilities.setdefault("sources", {})
    entry = sources.get(name)
    if not isinstance(entry, dict):
        entry = {}
        sources[name] = entry
    entry.setdefault("state", "unknown")
    entry.setdefault("ever_supported", False)
    entry.setdefault("last_data_date", None)
    entry.setdefault("checked_at", None)
    return entry


def save_capabilities(home: Path, capabilities: dict) -> None:
    capabilities["version"] = CAPABILITY_VERSION
    write_json_atomic(home / CAPABILITY_FILE, capabilities)


def load_capabilities(home: Path) -> dict:
    path = home / CAPABILITY_FILE
    if not path.exists():
        return empty_capabilities()
    value = read_json(path)
    if not isinstance(value, dict):
        print("[nexus] Warning: invalid Garmin capability cache; rebuilding it", file=sys.stderr, flush=True)
        return empty_capabilities()
    if isinstance(value.get("sources"), dict):
        value.setdefault("version", CAPABILITY_VERSION)
        value.setdefault("bootstrap_completed", False)
        value.setdefault("last_successful_sync_at", None)
        return value

    migrated = empty_capabilities()
    supported = value.get("hrv_supported")
    if isinstance(supported, bool):
        entry = source_entry(migrated, "hrv")
        entry.update({
            "state": "supported" if supported else "unsupported",
            "ever_supported": supported,
            "checked_at": value.get("detected_at"),
            "source": value.get("source", "legacy-hrv-cache"),
        })
    return migrated


def latest_meaningful_file(paths, predicate) -> tuple[datetime.date | None, int]:
    checked = 0
    for path in sorted(paths, reverse=True):
        value = read_json(path)
        if not isinstance(value, dict):
            continue
        checked += 1
        if predicate(value):
            date = parse_date(value.get("calendarDate")) or parse_date(path.stem[-10:])
            return date, checked
    return None, checked


def apply_observed_source(capabilities: dict, name: str, last_data_date: datetime.date | None, *, stale_days: int | None = None, evidence_source: str = "existing-files") -> None:
    if last_data_date is None:
        return
    entry = source_entry(capabilities, name)
    entry["ever_supported"] = True
    entry["last_data_date"] = last_data_date.isoformat()
    entry["source"] = evidence_source
    if stale_days is not None and (datetime.date.today() - last_data_date).days > stale_days:
        entry["state"] = "inactive"
    else:
        entry["state"] = "supported"


def scan_existing_capabilities(data_dir: Path, capabilities: dict) -> dict:
    sleep_dir = data_dir / "Sleep"
    if sleep_dir.is_dir():
        sleep_date, _ = latest_meaningful_file(sleep_dir.glob("sleep_????-??-??.json"), lambda value: isinstance(value.get("dailySleepDTO"), dict) and value["dailySleepDTO"].get("sleepTimeSeconds") is not None)
        apply_observed_source(capabilities, "sleep", sleep_date, stale_days=STALE_DAYS["sleep"])

    rhr_dir = data_dir / "RHR"
    if rhr_dir.is_dir():
        def has_rhr(value: dict) -> bool:
            try:
                rows = value["allMetrics"]["metricsMap"]["WELLNESS_RESTING_HEART_RATE"]
                return bool(rows and rows[0].get("value") is not None)
            except (KeyError, TypeError, IndexError):
                return False

        rhr_date, _ = latest_meaningful_file(rhr_dir.glob("rhr_????-??-??.json"), has_rhr)
        apply_observed_source(capabilities, "rhr", rhr_date, stale_days=STALE_DAYS["rhr"])

        hrv_files = sorted(rhr_dir.glob("hrv_????-??-??.json"), reverse=True)
        hrv_checked = 0
        hrv_date = None
        for path in hrv_files:
            value = read_json(path)
            if not isinstance(value, dict):
                continue
            hrv_checked += 1
            if value.get("hrvSummary"):
                hrv_date = parse_date(path.stem[-10:])
                break
        if hrv_date is not None:
            apply_observed_source(capabilities, "hrv", hrv_date)
        elif hrv_checked >= 3:
            entry = source_entry(capabilities, "hrv")
            if not entry.get("ever_supported"):
                entry["state"] = "unsupported"
                entry["source"] = "existing-empty-hrv-files"

    weight_dir = data_dir / "Weight"
    if weight_dir.is_dir():
        weight_date, _ = latest_meaningful_file(weight_dir.glob("weight_????-??-??.json"), lambda value: bool(value.get("dateWeightList")))
        apply_observed_source(capabilities, "weight", weight_date, stale_days=STALE_DAYS["weight"])

    monitoring_dir = data_dir / "FitFiles" / "Monitoring"
    if monitoring_dir.is_dir():
        summary_files = list(monitoring_dir.rglob("daily_summary_????-??-??.json"))
        monitoring_date, _ = latest_meaningful_file(summary_files, lambda value: value.get("calendarDate") is not None)
        apply_observed_source(capabilities, "monitoring", monitoring_date)
        steps_date, _ = latest_meaningful_file(summary_files, lambda value: value.get("totalSteps") is not None)
        apply_observed_source(capabilities, "steps", steps_date, stale_days=STALE_DAYS["steps"])
        heart_date, _ = latest_meaningful_file(summary_files, lambda value: any(value.get(key) is not None for key in ("minHeartRate", "maxHeartRate", "restingHeartRate")))
        apply_observed_source(capabilities, "heart_rate", heart_date, stale_days=STALE_DAYS["heart_rate"])
        if monitoring_date is not None:
            if steps_date is None and not source_entry(capabilities, "steps").get("ever_supported"):
                source_entry(capabilities, "steps")["state"] = "inactive"
            if heart_date is None and not source_entry(capabilities, "heart_rate").get("ever_supported"):
                source_entry(capabilities, "heart_rate")["state"] = "inactive"

    activities_dir = data_dir / "FitFiles" / "Activities"
    if activities_dir.is_dir():
        activity_files = [path for path in activities_dir.glob("activity_*.json") if path.stem.removeprefix("activity_").isdigit()]
        if activity_files:
            entry = source_entry(capabilities, "activities")
            entry["state"] = "supported"
            entry["ever_supported"] = True
            entry["source"] = "existing-files"

    for name, stale_days in STALE_DAYS.items():
        entry = source_entry(capabilities, name)
        last_date = parse_date(entry.get("last_data_date"))
        if entry.get("ever_supported") and last_date is not None and (datetime.date.today() - last_date).days > stale_days:
            entry["state"] = "inactive"
    return capabilities


def capability_probe_due(entry: dict, *, hrv: bool = False) -> bool:
    if entry.get("state") == "supported":
        return False
    checked = parse_iso_datetime(entry.get("checked_at"))
    if checked is None:
        return True
    interval = HRV_RECHECK_DAYS if hrv else PROBE_RECHECK_DAYS
    return utc_now() - checked >= datetime.timedelta(days=interval)


def mark_probe_result(capabilities: dict, name: str, state: str, *, last_data_date: datetime.date | None = None, source: str = "preflight") -> None:
    entry = source_entry(capabilities, name)
    entry["state"] = state
    entry["checked_at"] = utc_now().isoformat()
    entry["source"] = source
    if state == "supported":
        entry["ever_supported"] = True
    if last_data_date is not None:
        entry["last_data_date"] = last_data_date.isoformat()


def garmin_login(config_dir: Path):
    from garmindb import GarminConnectConfigManager
    from garmindb.garmin_connect_auth_adapter import GarminConnectAuthAdapter
    config = GarminConnectConfigManager(str(config_dir))
    garmin = GarminConnectAuthAdapter(config)
    garmin.login()
    return garmin


def recent_probe_dates() -> list[datetime.date]:
    today = datetime.date.today()
    return [today - datetime.timedelta(days=offset) for offset in range(1, PROBE_DAYS + 1)]


def probe_capabilities(garmin, data_dir: Path, capabilities: dict) -> None:
    due_sleep = capability_probe_due(source_entry(capabilities, "sleep"))
    due_rhr = capability_probe_due(source_entry(capabilities, "rhr"))
    due_weight = capability_probe_due(source_entry(capabilities, "weight"))
    due_hrv = capability_probe_due(source_entry(capabilities, "hrv"), hrv=True)
    if not any((due_sleep, due_rhr, due_weight, due_hrv)):
        return

    display_name = getattr(garmin, "display_name", None)
    if not display_name:
        raise RuntimeError("Garmin login did not provide a display name")

    dates = recent_probe_dates()
    sleep_dates: list[datetime.date] = []
    if due_sleep or due_hrv:
        sleep_found = None
        valid_sleep_responses = 0
        for day in dates:
            try:
                value = garmin.connectapi(f"/wellness-service/wellness/dailySleepData/{display_name}", params={"date": day.isoformat(), "nonSleepBufferMinutes": 60})
            except Exception:
                continue
            if not isinstance(value, dict):
                continue
            valid_sleep_responses += 1
            daily = value.get("dailySleepDTO")
            if isinstance(daily, dict) and daily.get("sleepTimeSeconds") is not None:
                sleep_dates.append(day)
                sleep_found = day if sleep_found is None else max(sleep_found, day)
        if due_sleep and valid_sleep_responses:
            mark_probe_result(capabilities, "sleep", "supported" if sleep_found else "inactive", last_data_date=sleep_found)

    if due_rhr:
        rhr_found = None
        valid_rhr_responses = 0
        for day in dates:
            try:
                value = garmin.connectapi(f"/userstats-service/wellness/daily/{display_name}", params={"fromDate": day.isoformat(), "untilDate": day.isoformat(), "metricId": 60})
                if not isinstance(value, dict):
                    continue
                valid_rhr_responses += 1
                rows = value["allMetrics"]["metricsMap"]["WELLNESS_RESTING_HEART_RATE"]
            except Exception:
                continue
            if rows and rows[0].get("value") is not None:
                rhr_found = day if rhr_found is None else max(rhr_found, day)
        if valid_rhr_responses:
            mark_probe_result(capabilities, "rhr", "supported" if rhr_found else "inactive", last_data_date=rhr_found)

    if due_weight:
        end = datetime.date.today()
        start = end - datetime.timedelta(days=180)
        try:
            value = garmin.connectapi("/weight-service/weight/dateRange", params={"startDate": start.isoformat(), "endDate": end.isoformat()})
            rows = value.get("dateWeightList") if isinstance(value, dict) else None
        except Exception:
            rows = None
        if rows:
            latest = None
            for row in rows:
                if isinstance(row, dict):
                    row_date = parse_date(row.get("calendarDate") or row.get("date"))
                    if row_date is not None and (latest is None or row_date > latest):
                        latest = row_date
            mark_probe_result(capabilities, "weight", "supported", last_data_date=latest)
        elif rows == []:
            mark_probe_result(capabilities, "weight", "inactive")

    if due_hrv:
        candidates = sleep_dates
        if not candidates:
            candidates = []
            sleep_dir = data_dir / "Sleep"
            if sleep_dir.is_dir():
                for path in sorted(sleep_dir.glob("sleep_????-??-??.json"), reverse=True):
                    value = read_json(path)
                    if isinstance(value, dict) and isinstance(value.get("dailySleepDTO"), dict):
                        day = parse_date(path.stem[-10:])
                        if day is not None:
                            candidates.append(day)
                    if len(candidates) >= PROBE_DAYS:
                        break
        valid_responses = 0
        hrv_found = None
        for day in candidates[:PROBE_DAYS]:
            try:
                value = garmin.connectapi(f"/hrv-service/hrv/{day.isoformat()}")
            except Exception:
                continue
            if not isinstance(value, dict):
                continue
            valid_responses += 1
            if value.get("hrvSummary"):
                hrv_found = day
                break
        if hrv_found is not None:
            mark_probe_result(capabilities, "hrv", "supported", last_data_date=hrv_found)
        elif valid_responses >= 3:
            mark_probe_result(capabilities, "hrv", "unsupported")
        elif valid_responses:
            mark_probe_result(capabilities, "hrv", "inactive")


def update_daily_summary_capabilities(capabilities: dict, value: dict, day: datetime.date) -> None:
    if value.get("calendarDate") is not None:
        apply_observed_source(capabilities, "monitoring", day, evidence_source="direct-summary")
    if value.get("totalSteps") is not None:
        apply_observed_source(capabilities, "steps", day, stale_days=STALE_DAYS["steps"], evidence_source="direct-summary")
    if any(value.get(key) is not None for key in ("minHeartRate", "maxHeartRate", "restingHeartRate")):
        apply_observed_source(capabilities, "heart_rate", day, stale_days=STALE_DAYS["heart_rate"], evidence_source="direct-summary")


def fetch_direct_daily_summaries(garmin, data_dir: Path, capabilities: dict) -> bool:
    display_name = getattr(garmin, "display_name", None)
    if not display_name:
        raise RuntimeError("Garmin login did not provide a display name")
    saw_heart_rate = False
    today = datetime.date.today()
    for offset in range(DIRECT_MONITORING_DAYS):
        day = today - datetime.timedelta(days=offset)
        try:
            value = garmin.connectapi(f"/usersummary-service/usersummary/daily/{display_name}", params={"calendarDate": day.isoformat()})
        except Exception as error:
            print(f"[nexus] Direct daily summary failed for {day}: {error}", file=sys.stderr, flush=True)
            continue
        if not isinstance(value, dict):
            continue
        year_dir = data_dir / "FitFiles" / "Monitoring" / str(day.year)
        write_json_atomic(year_dir / f"daily_summary_{day.isoformat()}.json", value)
        update_daily_summary_capabilities(capabilities, value, day)
        if any(value.get(key) is not None for key in ("minHeartRate", "maxHeartRate", "restingHeartRate")):
            saw_heart_rate = True
    return saw_heart_rate


def fetch_current_day_sleep(garmin, data_dir: Path, capabilities: dict) -> bool:
    """Fetch today's finalized sleep directly because GarminDB --latest stops at yesterday."""
    today = datetime.date.today()
    display_name = getattr(garmin, "display_name", None)
    if not display_name:
        print("[nexus] Current-day sleep skipped: Garmin login has no display name", file=sys.stderr, flush=True)
        return False

    try:
        value = garmin.connectapi(
            f"/wellness-service/wellness/dailySleepData/{display_name}",
            params={"date": today.isoformat(), "nonSleepBufferMinutes": 60},
        )
    except Exception as error:
        print(f"[nexus] Current-day sleep fetch failed for {today}: {error}", file=sys.stderr, flush=True)
        return False

    daily = value.get("dailySleepDTO") if isinstance(value, dict) else None
    sleep_date = parse_date(daily.get("calendarDate")) if isinstance(daily, dict) else None
    sleep_seconds = daily.get("sleepTimeSeconds") if isinstance(daily, dict) else None
    if sleep_date != today or not isinstance(sleep_seconds, (int, float)) or sleep_seconds <= 0:
        print(f"[nexus] Current-day sleep is not ready for {today}; keeping existing data", flush=True)
        return False

    sleep_path = data_dir / "Sleep" / f"sleep_{today.isoformat()}.json"
    if read_json(sleep_path) == value:
        print(f"[nexus] Current-day sleep for {today} is unchanged", flush=True)
        apply_observed_source(capabilities, "sleep", today, stale_days=STALE_DAYS["sleep"], evidence_source="direct-current-day")
        return False

    write_json_atomic(sleep_path, value)
    apply_observed_source(capabilities, "sleep", today, stale_days=STALE_DAYS["sleep"], evidence_source="direct-current-day")
    print(f"[nexus] Saved current-day sleep for {today}", flush=True)
    return True


def source_enabled(capabilities: dict, name: str, *, default: bool = True) -> bool:
    state = source_entry(capabilities, name).get("state", "unknown")
    if name == "hrv":
        return state == "supported"
    if state in ("inactive", "unsupported"):
        return False
    return default


def write_config(config_dir: Path, data_dir: Path, username: str, password: str, *, capabilities: dict, monitoring_enabled: bool) -> Path:
    config = {
        "db": {"type": "sqlite"},
        "garmin": {"domain": "garmin.com"},
        "credentials": {"user": username, "secure_password": False, "password": password, "password_file": None},
        "data": {"weight_start_date": "12/31/2019", "sleep_start_date": "12/31/2019", "rhr_start_date": "12/31/2019", "hrv_start_date": "12/31/2019", "monitoring_start_date": "12/31/2019", "download_latest_activities": 25, "download_all_activities": 1000},
        "directories": {"relative_to_home": False, "base_dir": str(data_dir), "mount_dir": "/nonexistent"},
        "enabled_stats": {"monitoring": monitoring_enabled, "steps": monitoring_enabled, "itime": monitoring_enabled, "sleep": source_enabled(capabilities, "sleep"), "rhr": source_enabled(capabilities, "rhr"), "hrv": source_enabled(capabilities, "hrv"), "weight": source_enabled(capabilities, "weight"), "activities": True},
        "course_views": {"steps": []},
        "modes": {},
        "activities": {"display": []},
        "settings": {"metric": True, "default_display_activities": ["walking", "running", "cycling"]},
        "checkup": {"look_back_days": 90},
    }
    config_path = config_dir / "GarminConnectConfig.json"
    write_json_atomic(config_path, config)
    return config_path


def scrub_password(config_path: Path) -> None:
    try:
        config = json.loads(config_path.read_text(encoding="utf-8"))
        config.setdefault("credentials", {})["password"] = ""
        write_json_atomic(config_path, config)
    except Exception as error:
        print(f"[nexus] Warning: could not scrub local Garmin password: {error}", file=sys.stderr, flush=True)


def age_existing_monitoring_files(data_dir: Path) -> None:
    root = data_dir / "FitFiles" / "Monitoring"
    if not root.is_dir():
        return
    old_timestamp = time.time() - (48 * 60 * 60)
    changed = 0
    for path in root.rglob("*"):
        if not path.is_file():
            continue
        try:
            if path.stat().st_mtime > old_timestamp:
                os.utime(path, (old_timestamp, old_timestamp))
                changed += 1
        except OSError:
            continue
    if changed:
        print(f"[nexus] Aged {changed} existing monitoring files before GarminDB latest import", flush=True)


def run_garmindb(home: Path, job_id: str) -> None:
    print("[nexus] Running GarminDB latest sync…", flush=True)
    environment = os.environ.copy()
    environment["HOME"] = str(home)
    process = subprocess.Popen([GARMIN_CLI, "--all", "--download", "--import", "--latest"], env=environment)
    while True:
        try:
            return_code = process.wait(timeout=HEARTBEAT_SECONDS)
            if return_code != 0:
                raise subprocess.CalledProcessError(return_code, process.args)
            return
        except subprocess.TimeoutExpired:
            report_progress(job_id, "Henter data fra Garmin")


def nexus_supported_file(data_dir: Path, file_path: Path) -> bool:
    if not file_path.is_file() or file_path.suffix.lower() != ".json":
        return False
    relative = file_path.relative_to(data_dir).as_posix()
    name = file_path.name
    return name.startswith("daily_summary_20") or relative.startswith("Sleep/sleep_20") or relative.startswith("RHR/rhr_20") or relative.startswith("Weight/weight_20") or (name.startswith("activity_") and name[9:-5].isdigit())


def sha256_file(file_path: Path) -> str:
    digest = hashlib.sha256()
    with file_path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def snapshot_supported_files(data_dir: Path) -> dict[str, str]:
    return {file_path.relative_to(data_dir).as_posix(): sha256_file(file_path) for file_path in sorted(data_dir.rglob("*.json")) if nexus_supported_file(data_dir, file_path)}


def load_or_create_snapshot(snapshot_path: Path, data_dir: Path) -> dict[str, str]:
    if snapshot_path.exists():
        try:
            value = json.loads(snapshot_path.read_text(encoding="utf-8"))
            if isinstance(value, dict) and all(isinstance(k, str) and isinstance(v, str) for k, v in value.items()):
                print(f"[nexus] Reusing pre-sync snapshot with {len(value)} files", flush=True)
                return value
        except Exception as error:
            print(f"[nexus] Warning: invalid sync snapshot, rebuilding it: {error}", file=sys.stderr, flush=True)
    snapshot = snapshot_supported_files(data_dir)
    write_json_atomic(snapshot_path, snapshot)
    print(f"[nexus] Captured pre-sync snapshot of {len(snapshot)} Nexus-relevant files", flush=True)
    return snapshot


def build_incremental_zip(data_dir: Path, user_id: str, before: dict[str, str]) -> Path:
    changed: list[Path] = []
    newest: Path | None = None
    for file_path in sorted(data_dir.rglob("*.json")):
        if not nexus_supported_file(data_dir, file_path):
            continue
        if newest is None or file_path.stat().st_mtime_ns > newest.stat().st_mtime_ns:
            newest = file_path
        relative = file_path.relative_to(data_dir).as_posix()
        if before.get(relative) != sha256_file(file_path):
            changed.append(file_path)
    if not changed and newest is not None:
        changed.append(newest)
        print("[nexus] No data changed; sending one current file as a no-op sync marker", flush=True)
    if not changed:
        raise RuntimeError(f"No Nexus-supported Garmin files found below {data_dir}")
    handle = tempfile.NamedTemporaryFile(prefix=f"nexus-garmindb-{user_id[:8]}-", suffix=".zip", delete=False)
    handle.close()
    zip_path = Path(handle.name)
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for file_path in changed:
            archive.write(file_path, file_path.relative_to(data_dir).as_posix())
    print(f"[nexus] Packed {len(changed)} changed Nexus files ({zip_path.stat().st_size / 1024 / 1024:.2f} MB)", flush=True)
    return zip_path


def fail_job(job_id: str, message: str) -> None:
    payload = json.dumps({"message": message[-1000:]}).encode()
    request(f"/api/garmin/agent/jobs/{job_id}/fail", method="POST", data=payload, content_type="application/json")


def process_import(job_id: str, user_id: str, *, resumed: bool = False) -> None:
    if resumed:
        print(f"[nexus] Resuming Nexus import for {user_id[:8]}…", flush=True)
        report_progress(job_id, "Genoptager Nexus-import efter agent-genstart")
    else:
        report_progress(job_id, "Importerer data i Nexus")
    total_processed = 0
    while True:
        status, body = request(f"/api/garmin/agent/jobs/{job_id}/process", method="POST", data=b"")
        if status >= 300:
            raise RuntimeError(f"Nexus processing failed ({status}): {body}")
        processed = int((body or {}).get("processed", 0))
        failed = int((body or {}).get("failed", 0))
        total_processed += processed + failed
        print(f"[nexus] Parsed batch: {processed} processed, {failed} failed", flush=True)
        if (body or {}).get("completed"):
            print(f"[nexus] Sync complete for {user_id[:8]}.", flush=True)
            break
        report_progress(job_id, f"Importerer data i Nexus · {total_processed} filer behandlet")


def capability_summary(capabilities: dict) -> str:
    names = ("monitoring", "steps", "heart_rate", "sleep", "rhr", "hrv", "weight", "activities")
    return ", ".join(f"{name}={source_entry(capabilities, name).get('state', 'unknown')}" for name in names)


def process_job(job_id: str, user_id: str, job_status: str) -> None:
    zip_path: Path | None = None
    config_path: Path | None = None
    snapshot_path: Path | None = None
    completed = False
    capabilities: dict | None = None
    home: Path | None = None
    try:
        if job_status == "processing":
            process_import(job_id, user_id, resumed=True)
            completed = True
            return
        report_progress(job_id, "Forbereder Garmin-konto")
        status, body = request(f"/api/garmin/agent/jobs/{job_id}/credentials")
        if status >= 300:
            raise RuntimeError(f"Could not fetch Garmin credentials ({status}): {body}")
        credentials = body or {}
        returned_user_id = safe_user_id(str(credentials.get("userId", "")))
        if returned_user_id != safe_user_id(user_id):
            raise RuntimeError("Nexus returned credentials for a different user")
        username = str(credentials.get("username", ""))
        password = str(credentials.get("password", ""))
        if not username or not password:
            raise RuntimeError("Garmin credentials are incomplete")

        home, config_dir, data_dir = user_paths(user_id)
        snapshot_path = home / ".nexus-garmin-pre-sync.json"
        before = load_or_create_snapshot(snapshot_path, data_dir)
        capabilities = scan_existing_capabilities(data_dir, load_capabilities(home))
        config_path = write_config(config_dir, data_dir, username, password, capabilities=capabilities, monitoring_enabled=True)
        due_probe = any((capability_probe_due(source_entry(capabilities, "sleep")), capability_probe_due(source_entry(capabilities, "rhr")), capability_probe_due(source_entry(capabilities, "weight")), capability_probe_due(source_entry(capabilities, "hrv"), hrv=True)))
        bootstrap_completed = bool(capabilities.get("bootstrap_completed"))
        heart_inactive = source_entry(capabilities, "heart_rate").get("state") == "inactive"
        direct_monitoring = bootstrap_completed and heart_inactive
        garmin = None
        if due_probe or direct_monitoring:
            try:
                garmin = garmin_login(config_dir)
            except Exception as error:
                print(f"[nexus] Garmin capability preflight failed: {error}", file=sys.stderr, flush=True)
        if garmin is not None and due_probe:
            probe_capabilities(garmin, data_dir, capabilities)
        if direct_monitoring and garmin is None:
            direct_monitoring = False
        elif garmin is not None and direct_monitoring:
            saw_heart_rate = fetch_direct_daily_summaries(garmin, data_dir, capabilities)
            if saw_heart_rate:
                direct_monitoring = False
                print("[nexus] Wrist HR data returned; normal GarminDB monitoring re-enabled", flush=True)
            else:
                print("[nexus] Wrist HR remains inactive; using direct daily summaries and skipping raw monitoring sync", flush=True)
        if garmin is None:
            try:
                garmin = garmin_login(config_dir)
            except Exception as error:
                print(f"[nexus] Current-day sleep login failed: {error}", file=sys.stderr, flush=True)
        if garmin is not None:
            fetch_current_day_sleep(garmin, data_dir, capabilities)
        config_path = write_config(config_dir, data_dir, username, password, capabilities=capabilities, monitoring_enabled=not direct_monitoring)
        save_capabilities(home, capabilities)
        print(f"[nexus] Syncing isolated Garmin profile {user_id[:8]} · {capability_summary(capabilities)}", flush=True)
        age_existing_monitoring_files(data_dir)
        report_progress(job_id, "Henter data fra Garmin")
        run_garmindb(home, job_id)
        scrub_password(config_path)
        capabilities = scan_existing_capabilities(data_dir, capabilities)
        capabilities["bootstrap_completed"] = True
        capabilities["last_successful_sync_at"] = utc_now().isoformat()
        save_capabilities(home, capabilities)
        report_progress(job_id, "Pakker ændrede Garmin-data")
        zip_path = build_incremental_zip(data_dir, user_id, before)
        report_progress(job_id, "Uploader Garmin-data til Nexus")
        status, body = upload_file(f"/api/garmin/agent/jobs/{job_id}/upload", zip_path)
        if status >= 300:
            raise RuntimeError(f"Nexus upload failed ({status}): {body}")
        print(f"[nexus] Upload ready: {body}", flush=True)
        process_import(job_id, user_id)
        completed = True
    except Exception as error:
        message = str(error)
        print(f"[nexus] Sync failed: {message}", file=sys.stderr, flush=True)
        fail_job(job_id, message)
    finally:
        if config_path:
            scrub_password(config_path)
        if capabilities is not None and home is not None:
            try:
                save_capabilities(home, capabilities)
            except Exception as error:
                print(f"[nexus] Warning: could not save Garmin capabilities: {error}", file=sys.stderr, flush=True)
        if zip_path:
            zip_path.unlink(missing_ok=True)
        if snapshot_path and (completed or sys.exc_info()[0] is None):
            snapshot_path.unlink(missing_ok=True)


def main() -> int:
    if not NEXUS_URL or not TOKEN:
        print("Set NEXUS_URL and NEXUS_GARMIN_AGENT_TOKEN.", file=sys.stderr)
        return 2
    STATE_ROOT.mkdir(parents=True, exist_ok=True)
    DATA_ROOT.mkdir(parents=True, exist_ok=True)
    print(f"[nexus] Multi-user Garmin agent online; polling {NEXUS_URL} every {POLL_SECONDS}s", flush=True)
    print(f"[nexus] Persistent state root: {STATE_ROOT}", flush=True)
    print(f"[nexus] Persistent data root: {DATA_ROOT}", flush=True)
    while True:
        try:
            status, body = request("/api/garmin/agent/jobs/next")
            if status == 204:
                time.sleep(POLL_SECONDS)
                continue
            if status == 401:
                print("[nexus] Agent token rejected.", file=sys.stderr)
                return 3
            if status >= 300:
                print(f"[nexus] Poll failed ({status}): {body}", file=sys.stderr, flush=True)
                time.sleep(POLL_SECONDS)
                continue
            job = (body or {}).get("job", {})
            job_id = str(job.get("id", ""))
            user_id = str(job.get("userId", ""))
            job_status = str(job.get("status", "running"))
            if not job_id or not user_id:
                time.sleep(POLL_SECONDS)
                continue
            process_job(job_id, user_id, job_status)
        except KeyboardInterrupt:
            return 0
        except Exception as error:
            print(f"[nexus] Agent error: {error}", file=sys.stderr, flush=True)
            time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    raise SystemExit(main())
