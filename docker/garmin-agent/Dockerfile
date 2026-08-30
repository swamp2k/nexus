FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    TZ=Europe/Copenhagen \
    NEXUS_GARMIN_STATE_ROOT=/state/users \
    NEXUS_GARMIN_DATA_ROOT=/data/users \
    NEXUS_GARMIN_CLI=/usr/local/bin/garmindb_cli.py \
    NEXUS_GARMIN_POLL_SECONDS=15

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates tzdata tini \
    && rm -rf /var/lib/apt/lists/* \
    && pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir garmindb

RUN mkdir -p /state/users /data/users /opt/nexus

COPY tools/nexus-garmin-agent.py /opt/nexus/nexus-garmin-agent.py
COPY docker/garmin-agent/entrypoint.sh /usr/local/bin/nexus-garmin-entrypoint
RUN chmod +x /usr/local/bin/nexus-garmin-entrypoint /opt/nexus/nexus-garmin-agent.py

VOLUME ["/state", "/data"]

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/nexus-garmin-entrypoint"]
