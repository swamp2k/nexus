#!/bin/sh
set -eu
/usr/local/bin/garmindb_cli.py "$@"
python3 /opt/nexus/export-activity-details.py
