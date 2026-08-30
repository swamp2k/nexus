#!/bin/sh
set -eu

CONFIG_FILE="/root/.GarminDb/GarminConnectConfig.json"

if [ -z "${NEXUS_URL:-}" ]; then
  echo "[nexus] Missing NEXUS_URL" >&2
  exit 2
fi

if [ -z "${NEXUS_GARMIN_AGENT_TOKEN:-}" ]; then
  echo "[nexus] Missing NEXUS_GARMIN_AGENT_TOKEN" >&2
  exit 2
fi

mkdir -p /root/.GarminDb /data

if [ ! -f "$CONFIG_FILE" ]; then
  echo "[nexus] GarminDB config is missing: $CONFIG_FILE" >&2
  echo "[nexus] Mount persistent Unraid appdata to /root/.GarminDb and place GarminConnectConfig.json there." >&2
  exit 2
fi

if ! command -v garmindb_cli.py >/dev/null 2>&1; then
  echo "[nexus] garmindb_cli.py not found in container" >&2
  exit 2
fi

if ! grep -q '"base_dir"[[:space:]]*:[[:space:]]*"/data"' "$CONFIG_FILE"; then
  echo "[nexus] WARNING: GarminConnectConfig.json does not appear to use directories.base_dir=/data." >&2
  echo "[nexus] Garmin data may end up outside the persistent /data mount." >&2
fi

if ! grep -q '"relative_to_home"[[:space:]]*:[[:space:]]*false' "$CONFIG_FILE"; then
  echo "[nexus] WARNING: directories.relative_to_home should be false for the /data bind mount." >&2
fi

echo "[nexus] Persistent config: /root/.GarminDb"
echo "[nexus] Persistent Garmin data: /data"
exec python3 /opt/nexus/nexus-garmin-agent.py
