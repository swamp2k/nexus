# Nexus GarminDB agent on Unraid

The GarminDB agent is designed to survive container updates and restarts without losing GarminDB configuration or downloaded data.

## Persistent paths

Create these Unraid directories:

```text
/mnt/user/appdata/nexus-garmin/config
/mnt/user/appdata/nexus-garmin/data
```

Mount them as:

```text
/mnt/user/appdata/nexus-garmin/config -> /root/.GarminDb
/mnt/user/appdata/nexus-garmin/data   -> /data
```

The container image itself is disposable. GarminDB configuration, downloaded JSON/FIT files and generated databases must live in those mounts.

## GarminDB configuration

GarminDB reads:

```text
/root/.GarminDb/GarminConnectConfig.json
```

In `GarminConnectConfig.json`, configure the directories section to use the persistent `/data` mount:

```json
"directories": {
  "relative_to_home": false,
  "base_dir": "/data"
}
```

Keep the rest of the user's existing GarminDB configuration, including Garmin Connect credentials and date settings. Do not commit this file to Git.

If GarminDB has already been configured on another machine, copying the existing `~/.GarminDb/GarminConnectConfig.json` into the Unraid config directory is the simplest starting point, then change its directory settings to `/data`.

## Nexus settings

In Nexus:

1. Open **Indstillinger -> Garmin**.
2. Open **Vis setup**.
3. Generate a new agent token if required.
4. Copy the `nxa_...` token. Nexus only stores its SHA-256 hash, so the plaintext token cannot be shown again later.

Container environment variables:

```text
NEXUS_URL=https://nexus.sr-goodjob.workers.dev
NEXUS_GARMIN_AGENT_TOKEN=nxa_...
NEXUS_GARMIN_DATA_DIR=/data
NEXUS_GARMIN_POLL_SECONDS=15
TZ=Europe/Copenhagen
```

## Build on Unraid

Clone/pull the Nexus repository somewhere convenient, then from the repository root:

```bash
docker build -f docker/garmin-agent/Dockerfile -t nexus-garmin-agent:local .
```

Create the container:

```bash
docker run -d \
  --name nexus-garmin-agent \
  --restart unless-stopped \
  -e TZ=Europe/Copenhagen \
  -e NEXUS_URL=https://nexus.sr-goodjob.workers.dev \
  -e NEXUS_GARMIN_AGENT_TOKEN='nxa_REPLACE_ME' \
  -e NEXUS_GARMIN_DATA_DIR=/data \
  -e NEXUS_GARMIN_POLL_SECONDS=15 \
  -v /mnt/user/appdata/nexus-garmin/config:/root/.GarminDb \
  -v /mnt/user/appdata/nexus-garmin/data:/data \
  nexus-garmin-agent:local
```

Or use `docker/garmin-agent/docker-compose.example.yml` as a template.

## First start

The container deliberately refuses to start if `GarminConnectConfig.json` is missing. This prevents an apparently healthy but non-persistent GarminDB setup.

After start, check:

```bash
docker logs -f nexus-garmin-agent
```

A healthy idle agent should report that it is polling Nexus. Nexus should change the agent status from **Offline** to **Online** within roughly one polling interval.

Then press **Opdatér fra Garmin** in Nexus. The agent will run GarminDB's incremental command:

```text
garmindb_cli.py --all --download --import --analyze --latest
```

and upload the resulting GarminDB files to Nexus for inventory and parsing.

## Updating the container

Rebuild and recreate it. Do not delete the two Unraid appdata directories.

```bash
docker stop nexus-garmin-agent
docker rm nexus-garmin-agent
docker build --pull -f docker/garmin-agent/Dockerfile -t nexus-garmin-agent:local .
# run/create again with the same mounts and environment variables
```

Because `/root/.GarminDb` and `/data` are bind-mounted from Unraid, replacing the container does not remove GarminDB configuration or data.
