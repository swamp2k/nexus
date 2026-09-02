# Nexus GarminDB agent on Unraid

Nexus uses one shared GarminDB container for all Nexus users. Each user's GarminDB configuration/token state and downloaded Garmin data are isolated in separate persistent subdirectories.

## Persistence model

Create:

```text
/mnt/user/appdata/nexus-garmin/state
/mnt/user/appdata/nexus-garmin/data
```

Mount:

```text
/mnt/user/appdata/nexus-garmin/state -> /state
/mnt/user/appdata/nexus-garmin/data  -> /data
```

The container image itself is disposable. For a Nexus user `<user-id>`, the agent creates:

```text
/state/users/<user-id>/.GarminDb/
  GarminConnectConfig.json
  garmin_tokens.json
  ...
/state/users/<user-id>/.nexus-garmin-capabilities.json

/data/users/<user-id>/
  DBs/
  FitFiles/
  Sleep/
  RHR/
  Weight/
  ...
```

Replacing or updating the container therefore does not remove GarminDB state or downloaded data.

## Credentials

Users enter their own Garmin Connect login under **Nexus -> Indstillinger -> Garmin**.

Nexus encrypts username and password with AES-GCM before writing them to D1. The encryption key is a Worker secret and must never be committed to Git. During a sync, the authenticated installation agent receives credentials only for the specific claimed job/user.

The agent writes the credentials into that user's temporary GarminDB config before invoking GarminDB. After GarminDB returns, the plaintext password is scrubbed from the local config again. GarminDB's OAuth token store remains persistent under that user's `.GarminDb` directory.

## Capability and availability detection

Garmin users do not necessarily expose the same data. A watch may lack a feature, a user may disable a sensor to save battery, or a measurement may simply not have been used recently. Nexus therefore keeps per-user source state instead of assuming every enabled GarminDB statistic is always present.

States are:

- `supported`: Nexus has seen real data from the source.
- `inactive`: the source has worked before, or is plausible, but currently has no recent data.
- `unsupported`: reserved for strong evidence that Garmin does not expose the feature; HRV is the current example.
- `unknown`: not enough evidence yet.

The state is persisted in `/state/users/<user-id>/.nexus-garmin-capabilities.json`.

Current behavior:

- HRV is enabled only after a successful HRV capability check. Repeated valid empty HRV responses on dates with sleep data are treated as unsupported. Unsupported HRV is rechecked periodically rather than assumed permanent forever.
- Sleep and resting heart rate get a 14-day grace period before becoming inactive.
- Weight gets a 45-day grace period because weight measurements are naturally sparse.
- Inactive standalone sources are skipped during normal GarminDB syncs and cheaply rechecked later.
- Steps and wrist heart rate are tracked separately, but both share Garmin's monitoring source. Missing wrist HR is never interpreted as proof that steps or the whole watch are unsupported.
- After the historical bootstrap, if wrist HR has been inactive long enough, Nexus fetches recent daily summaries directly and temporarily skips raw GarminDB monitoring. This keeps steps/stress/body-battery style daily data flowing without letting GarminDB's heart-rate cursor grow backwards indefinitely. Normal monitoring resumes automatically when heart-rate data returns.

GarminDB also defines `--latest` using filesystem modification time. A historical bootstrap therefore makes thousands of old monitoring files appear "new" for 24 hours. Before each sync Nexus ages the existing monitoring tree to more than 24 hours old; files actually refreshed by the current Garmin download receive a fresh mtime and are the only monitoring files imported as latest.

## Cloudflare secret

Generate a random 32-byte key and store its base64 value as:

```text
GARMIN_CREDENTIALS_KEY
```

For example, on a trusted machine:

```bash
openssl rand -base64 32
npx wrangler secret put GARMIN_CREDENTIALS_KEY
```

Paste the generated value into Wrangler's secret prompt. Do not place it in `wrangler.jsonc` or source control. If this secret is lost or rotated without re-encrypting existing rows, saved Garmin credentials can no longer be decrypted and users must save them again.

## Nexus agent token

The agent token belongs to the single Unraid installation, not to an individual Garmin user.

As a Nexus admin:

1. Open **Indstillinger -> Garmin**.
2. Open/generate the shared Garmin-agent setup.
3. Copy the `nxa_...` installation token.
4. Put that token into the container environment as `NEXUS_GARMIN_AGENT_TOKEN`.

Only its SHA-256 hash is stored in Nexus. Generating a new installation token invalidates the old one immediately.

## Build on Unraid

From a clone of the Nexus repository:

```bash
docker build -f docker/garmin-agent/Dockerfile -t nexus-garmin-agent:local .
```

Example run:

```bash
docker run -d \
  --name nexus-garmin-agent \
  --restart unless-stopped \
  -e TZ=Europe/Copenhagen \
  -e NEXUS_URL=https://nexus.sr-goodjob.workers.dev \
  -e NEXUS_GARMIN_AGENT_TOKEN='nxa_REPLACE_ME' \
  -e NEXUS_GARMIN_STATE_ROOT=/state/users \
  -e NEXUS_GARMIN_DATA_ROOT=/data/users \
  -e NEXUS_GARMIN_POLL_SECONDS=15 \
  -v /mnt/user/appdata/nexus-garmin/state:/state \
  -v /mnt/user/appdata/nexus-garmin/data:/data \
  nexus-garmin-agent:local
```

Or use `docker/garmin-agent/docker-compose.example.yml` as a template.

## Runtime flow

```text
Nexus user clicks "Opdatér fra Garmin"
          |
          v
D1 job queue (user-specific)
          |
          v
shared Unraid agent claims oldest job
          |
          +-> fetches credentials for that job only
          +-> HOME=/state/users/<user-id>
          +-> detects source capability/availability
          +-> fetches today's finalized sleep directly
          +-> GarminDB data=/data/users/<user-id>
          +-> garmindb_cli.py --all --download --import --analyze --latest
          +-> uploads changed Nexus-relevant JSON to Nexus
          +-> Nexus inventories and parses it into that same user's D1 records
```

The direct current-day sleep request compensates for GarminDB `--latest`
stopping at yesterday. Nexus only writes the file when Garmin returns a
positive sleep duration for the requested date, so an empty or unfinished
response cannot replace existing sleep data.

The agent deliberately processes jobs sequentially. This keeps GarminDB state isolated and avoids multiple concurrent syncs competing for CPU, network, Garmin rate limits, or local files.

## Automatic schedule

Cloudflare wakes the Nexus scheduler once per hour. Each Garmin user controls
their own automatic schedule under **Settings -> Garmin**. The default is
09:00, 12:00, 18:00, and 22:00 in `Europe/Copenhagen`; the timezone therefore
follows Danish daylight-saving time automatically.

Schedules support one to six unique whole-hour times with at least three hours
between them. Automatic sync can be disabled without deleting the saved times.
Active jobs and recently completed jobs are still skipped, so a manual sync does
not create a duplicate scheduled job.

## First start / health

Check:

```bash
docker logs -f nexus-garmin-agent
```

A healthy idle agent reports that it is polling Nexus. Nexus should show the shared agent as **Online** within roughly one polling interval.

A user's **Opdatér fra Garmin** button is enabled once both conditions are true:

- that user has saved Garmin Connect credentials in Nexus;
- the shared Garmin agent has been registered.

The agent may be offline when the button is pressed; the job remains queued until the container returns.

## Updating

A Docker image and a Docker container are separate things. Rebuilding the tag `nexus-garmin-agent:local` does **not** make an already-created container use the new image. The container must be recreated.

From the Nexus clone:

```bash
git pull
docker stop nexus-garmin-agent
docker rm nexus-garmin-agent
docker build --pull -f docker/garmin-agent/Dockerfile -t nexus-garmin-agent:local .
# recreate with the same /state and /data mounts + environment
```

With Docker Compose, the equivalent is normally:

```bash
git pull
docker build -f docker/garmin-agent/Dockerfile -t nexus-garmin-agent:local .
docker compose up -d --force-recreate nexus-garmin-agent
```

Because `/state` and `/data` are bind-mounted from Unraid, container replacement does not remove user profiles, OAuth token stores, capability state, GarminDB databases, JSON, or FIT files.
