#!/bin/sh
set -eu

if [ -z "${NEXUS_URL:-}" ]; then
  echo "[nexus] Missing NEXUS_URL" >&2
  exit 2
fi

if [ -z "${NEXUS_GARMIN_AGENT_TOKEN:-}" ]; then
  echo "[nexus] Missing NEXUS_GARMIN_AGENT_TOKEN" >&2
  exit 2
fi

mkdir -p "${NEXUS_GARMIN_STATE_ROOT:-/state/users}" "${NEXUS_GARMIN_DATA_ROOT:-/data/users}"

if ! command -v garmindb_cli.py >/dev/null 2>&1; then
  echo "[nexus] garmindb_cli.py not found in container" >&2
  exit 2
fi

echo "[nexus] Shared GarminDB agent"
echo "[nexus] Persistent per-user state: ${NEXUS_GARMIN_STATE_ROOT:-/state/users}"
echo "[nexus] Persistent per-user data: ${NEXUS_GARMIN_DATA_ROOT:-/data/users}"
exec python3 /opt/nexus/nexus-garmin-agent.py
