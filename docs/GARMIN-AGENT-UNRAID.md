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

The container image itself is disposable. GarminDB configuration, OAuth/session state, downloaded JSON/FIT files and generated databases must live in those mounts.

GarminDB stores both `GarminConnectConfig.json` and its token store (`garmin_tokens.json`) below `~/.GarminDb`, so mounting the whole directory is intentional.

## GarminDB configuration

GarminDB reads:

```text
/root/.GarminDb/GarminConnectConfig.json
```

In `GarminConnectConfig.json`, ensure the `directories` section contains these values so GarminDB uses the persistent `/data` mount:

```json
"relative_to_home": false,
"base_dir": "/data"
```

Keep the rest of the user's existing `directories` settings and the rest of the GarminDB configuration intact. Do not commit this file to Git.

If GarminDB has already been configured and authenticated on another Linux machine, copy the entire existing `~/.GarminDb/` directory into:

```text
/mnt/user/appdata/nexus-garmin/config/
```

This preserves `GarminConnectConfig.json`, `garmin_tokens.json` and any other GarminDB config state. Then change only the directory settings needed to point `base_dir` at `/data`.

Existing GarminDB data can also be copied into `/mnt/user/appdata/nexus-garmin/data/` before first start, avoiding a new full historical download.

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

Because `/root/.GarminDb` and `/data` are bind-mounted from Unraid, replacing the container does not remove GarminDB configuration, tokens or downloaded data.
