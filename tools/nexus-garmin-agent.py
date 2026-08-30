#!/usr/bin/env python3
"""Small outbound-only GarminDB agent for Nexus.

Required environment variables:
  NEXUS_URL=https://nexus.example.com
  NEXUS_GARMIN_AGENT_TOKEN=nxa_...

Optional:
  NEXUS_GARMIN_DATA_DIR=~/HealthData
  NEXUS_GARMIN_CLI=garmindb_cli.py
  NEXUS_GARMIN_POLL_SECONDS=15
"""

from __future__ import annotations

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
DATA_DIR = Path(os.path.expanduser(os.environ.get("NEXUS_GARMIN_DATA_DIR", "~/HealthData")))
GARMIN_CLI = os.environ.get("NEXUS_GARMIN_CLI", "garmindb_cli.py")
POLL_SECONDS = max(5, int(os.environ.get("NEXUS_GARMIN_POLL_SECONDS", "15")))


def request(path: str, *, method: str = "GET", data: bytes | None = None, content_type: str | None = None):
    headers = {"Authorization": f"Bearer {TOKEN}", "User-Agent": "Nexus-Garmin-Agent/0.1"}
    if content_type:
        headers["Content-Type"] = content_type
    req = urllib.request.Request(f"{NEXUS_URL}{path}", data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=120) as response:
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


def run_garmindb() -> None:
    print("[nexus] Running GarminDB latest sync…", flush=True)
    subprocess.run(
        [GARMIN_CLI, "--all", "--download", "--import", "--analyze", "--latest"],
        check=True,
    )


def build_zip() -> Path:
    if not DATA_DIR.is_dir():
        raise RuntimeError(f"Garmin data directory does not exist: {DATA_DIR}")
    handle = tempfile.NamedTemporaryFile(prefix="nexus-garmindb-", suffix=".zip", delete=False)
    handle.close()
    zip_path = Path(handle.name)
    count = 0
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for file_path in sorted(DATA_DIR.rglob("*")):
            if not file_path.is_file():
                continue
            if file_path.suffix.lower() in {".db", ".sqlite", ".sqlite3"}:
                continue
            if file_path.name.startswith("."):
                continue
            archive.write(file_path, file_path.relative_to(DATA_DIR).as_posix())
            count += 1
    if count == 0:
        zip_path.unlink(missing_ok=True)
        raise RuntimeError(f"No Garmin files found below {DATA_DIR}")
    print(f"[nexus] Packed {count} files ({zip_path.stat().st_size / 1024 / 1024:.1f} MB)", flush=True)
    return zip_path


def fail_job(job_id: str, message: str) -> None:
    payload = json.dumps({"message": message[-1000:]}).encode()
    request(f"/api/garmin/agent/jobs/{job_id}/fail", method="POST", data=payload, content_type="application/json")


def process_job(job_id: str) -> None:
    zip_path: Path | None = None
    try:
        run_garmindb()
        zip_path = build_zip()
        status, body = upload_file(f"/api/garmin/agent/jobs/{job_id}/upload", zip_path)
        if status >= 300:
            raise RuntimeError(f"Nexus upload failed ({status}): {body}")
        print(f"[nexus] Upload ready: {body}", flush=True)

        while True:
            status, body = request(f"/api/garmin/agent/jobs/{job_id}/process", method="POST", data=b"")
            if status >= 300:
                raise RuntimeError(f"Nexus processing failed ({status}): {body}")
            processed = int((body or {}).get("processed", 0))
            failed = int((body or {}).get("failed", 0))
            print(f"[nexus] Parsed batch: {processed} processed, {failed} failed", flush=True)
            if (body or {}).get("completed"):
                print("[nexus] Sync complete.", flush=True)
                break
    except Exception as error:  # agent boundary: report all failures back to Nexus
        message = str(error)
        print(f"[nexus] Sync failed: {message}", file=sys.stderr, flush=True)
        fail_job(job_id, message)
    finally:
        if zip_path:
            zip_path.unlink(missing_ok=True)


def main() -> int:
    if not NEXUS_URL or not TOKEN:
        print("Set NEXUS_URL and NEXUS_GARMIN_AGENT_TOKEN.", file=sys.stderr)
        return 2
    print(f"[nexus] Garmin agent online; polling {NEXUS_URL} every {POLL_SECONDS}s", flush=True)
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
            job_id = str((body or {}).get("job", {}).get("id", ""))
            if not job_id:
                time.sleep(POLL_SECONDS)
                continue
            process_job(job_id)
        except KeyboardInterrupt:
            return 0
        except Exception as error:
            print(f"[nexus] Agent error: {error}", file=sys.stderr, flush=True)
            time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    raise SystemExit(main())
