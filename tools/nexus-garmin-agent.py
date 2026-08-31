#!/usr/bin/env python3
"""Outbound-only multi-user GarminDB agent for Nexus.

One container can service many Nexus users. Each user gets isolated persistent
GarminDB config/token state and downloaded data directories.

Required environment variables:
  NEXUS_URL=https://nexus.example.com
  NEXUS_GARMIN_AGENT_TOKEN=nxa_...

Optional:
  NEXUS_GARMIN_STATE_ROOT=/state/users
  NEXUS_GARMIN_DATA_ROOT=/data/users
  NEXUS_GARMIN_CLI=garmindb_cli.py
  NEXUS_GARMIN_POLL_SECONDS=15
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
HRV_CAPABILITY_FILE = ".nexus-garmin-capabilities.json"


def request(path: str, *, method: str = "GET", data: bytes | None = None, content_type: str | None = None):
    headers = {"Authorization": f"Bearer {TOKEN}", "User-Agent": "Nexus-Garmin-Agent/0.7"}
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
    data = file_path.read_bytes()
    return request(path, method="PUT", data=data, content_type="application/zip")


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
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2), encoding="utf-8")
    os.chmod(temporary, 0o600)
    temporary.replace(path)


def existing_hrv_capability(data_dir: Path) -> bool | None:
    """Infer HRV support from already-downloaded HRV JSON without any network calls."""
    files = sorted((data_dir / "RHR").glob("hrv_*.json")) if (data_dir / "RHR").is_dir() else []
    if not files:
        return None

    checked = 0
    for file_path in files:
        try:
            value = json.loads(file_path.read_text(encoding="utf-8"))
        except Exception:
            continue
        checked += 1
        if isinstance(value, dict) and value.get("hrvSummary"):
            return True

    # Do not classify a device from a single possibly-empty day. Three or more
    # valid empty responses are enough evidence that Garmin is not exposing HRV
    # Status for this account/device combination.
    if checked >= 3:
        return False
    return None


def load_hrv_capability(home: Path, data_dir: Path) -> bool | None:
    capability_path = home / HRV_CAPABILITY_FILE
    if capability_path.exists():
        try:
            value = json.loads(capability_path.read_text(encoding="utf-8"))
            supported = value.get("hrv_supported")
            if isinstance(supported, bool):
                print(f"[nexus] HRV capability cached: {'supported' if supported else 'not supported'}", flush=True)
                return supported
        except Exception as error:
            print(f"[nexus] Warning: invalid HRV capability cache: {error}", file=sys.stderr, flush=True)

    supported = existing_hrv_capability(data_dir)
    if supported is not None:
        write_json_atomic(capability_path, {
            "hrv_supported": supported,
            "detected_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "source": "existing-files",
        })
        print(
            f"[nexus] HRV capability detected from existing files: {'supported' if supported else 'not supported'}",
            flush=True,
        )
    return supported


def recent_sleep_dates(data_dir: Path, limit: int = 7) -> list[str]:
    sleep_dir = data_dir / "Sleep"
    if not sleep_dir.is_dir():
        return []
    dates: list[str] = []
    for path in sorted(sleep_dir.glob("sleep_????-??-??.json"), reverse=True):
        date = path.stem.removeprefix("sleep_")
        try:
            value = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        if isinstance(value, dict) and value.get("dailySleepDTO"):
            dates.append(date)
        if len(dates) >= limit:
            break
    return dates


def probe_hrv_capability(home: Path, config_dir: Path, data_dir: Path) -> bool | None:
    """Probe a few known sleep dates after a normal sync and persist the result."""
    dates = recent_sleep_dates(data_dir)
    if not dates:
        print("[nexus] HRV preflight deferred: no recent sleep dates available", flush=True)
        return None

    try:
        from garmindb import GarminConnectConfigManager
        from garmindb.garmin_connect_auth_adapter import GarminConnectAuthAdapter

        config = GarminConnectConfigManager(str(config_dir))
        garmin = GarminConnectAuthAdapter(config)
        garmin.login()

        saw_response = False
        for date in dates:
            value = garmin.connectapi(f"/hrv-service/hrv/{date}")
            if not isinstance(value, dict):
                continue
            saw_response = True
            if value.get("hrvSummary"):
                supported = True
                break
        else:
            supported = False if saw_response else None

        if supported is not None:
            write_json_atomic(home / HRV_CAPABILITY_FILE, {
                "hrv_supported": supported,
                "detected_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                "source": "preflight",
                "sample_dates": dates,
            })
            print(
                f"[nexus] HRV preflight: {'supported' if supported else 'not supported'} "
                f"({len(dates)} recent sleep dates checked)",
                flush=True,
            )
        return supported
    except Exception as error:
        # Capability detection must never make an otherwise healthy Garmin sync fail.
        print(f"[nexus] HRV preflight failed; leaving HRV disabled for now: {error}", file=sys.stderr, flush=True)
        return None


def write_config(config_dir: Path, data_dir: Path, username: str, password: str, *, hrv_enabled: bool) -> Path:
    config = {
        "db": {"type": "sqlite"},
        "garmin": {"domain": "garmin.com"},
        "credentials": {
            "user": username,
            "secure_password": False,
            "password": password,
            "password_file": None,
        },
        "data": {
            "weight_start_date": "12/31/2019",
            "sleep_start_date": "12/31/2019",
            "rhr_start_date": "12/31/2019",
            "hrv_start_date": "12/31/2019",
            "monitoring_start_date": "12/31/2019",
            "download_latest_activities": 25,
            "download_all_activities": 1000,
        },
        "directories": {
            "relative_to_home": False,
            "base_dir": str(data_dir),
            "mount_dir": "/nonexistent",
        },
        "enabled_stats": {
            "monitoring": True,
            "steps": True,
            "itime": True,
            "sleep": True,
            "rhr": True,
            "hrv": hrv_enabled,
            "weight": True,
            "activities": True,
        },
        "course_views": {"steps": []},
        "modes": {},
        "activities": {"display": []},
        "settings": {
            "metric": True,
            "default_display_activities": ["walking", "running", "cycling"],
        },
        "checkup": {"look_back_days": 90},
    }
    config_path = config_dir / "GarminConnectConfig.json"
    write_json_atomic(config_path, config)
    return config_path


def scrub_password(config_path: Path) -> None:
    try:
        config = json.loads(config_path.read_text(encoding="utf-8"))
        credentials = config.setdefault("credentials", {})
        credentials["password"] = ""
        write_json_atomic(config_path, config)
    except Exception as error:
        print(f"[nexus] Warning: could not scrub local Garmin password: {error}", file=sys.stderr, flush=True)


def run_garmindb(home: Path, job_id: str) -> None:
    print("[nexus] Running GarminDB latest sync…", flush=True)
    environment = os.environ.copy()
    environment["HOME"] = str(home)
    process = subprocess.Popen(
        [GARMIN_CLI, "--all", "--download", "--import", "--analyze", "--latest"],
        env=environment,
    )

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
    return (
        name.startswith("daily_summary_20")
        or relative.startswith("Sleep/sleep_20")
        or relative.startswith("RHR/rhr_20")
        or relative.startswith("Weight/weight_20")
        or (name.startswith("activity_") and name[9:-5].isdigit())
    )


def sha256_file(file_path: Path) -> str:
    digest = hashlib.sha256()
    with file_path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def snapshot_supported_files(data_dir: Path) -> dict[str, str]:
    snapshot: dict[str, str] = {}
    for file_path in sorted(data_dir.rglob("*.json")):
        if nexus_supported_file(data_dir, file_path):
            snapshot[file_path.relative_to(data_dir).as_posix()] = sha256_file(file_path)
    return snapshot


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
    if not data_dir.is_dir():
        raise RuntimeError(f"Garmin data directory does not exist: {data_dir}")

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

    # A no-op Garmin run still needs to complete its Nexus job. Re-importing the
    # newest supported file is cheap and keeps the protocol simple/non-empty.
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

    print(
        f"[nexus] Packed {len(changed)} changed Nexus files "
        f"({zip_path.stat().st_size / 1024 / 1024:.2f} MB)",
        flush=True,
    )
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


def process_job(job_id: str, user_id: str, job_status: str) -> None:
    zip_path: Path | None = None
    config_path: Path | None = None
    snapshot_path: Path | None = None
    completed = False
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

        hrv_supported = load_hrv_capability(home, data_dir)
        config_path = write_config(
            config_dir,
            data_dir,
            username,
            password,
            hrv_enabled=hrv_supported is True,
        )
        print(
            f"[nexus] Syncing isolated Garmin profile {user_id[:8]} · "
            f"HRV {'enabled' if hrv_supported is True else 'disabled'}",
            flush=True,
        )

        report_progress(job_id, "Henter data fra Garmin")
        run_garmindb(home, job_id)

        # Unknown capability is deliberately treated as disabled for this run.
        # Probe only after a successful ordinary sync, using dates where sleep
        # data proves the watch was actually worn. If HRV is supported it will
        # be enabled automatically on the next sync.
        if hrv_supported is None:
            probe_hrv_capability(home, config_dir, data_dir)

        scrub_password(config_path)

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
        if zip_path:
            zip_path.unlink(missing_ok=True)
        # Preserve the pre-sync snapshot across an abrupt container stop so the
        # resumed job still knows what changed. For a normal success or handled
        # failure, clear it so a future job starts from a fresh baseline.
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