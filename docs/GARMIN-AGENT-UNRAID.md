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
          +-> GarminDB data=/data/users/<user-id>
          +-> garmindb_cli.py --all --download --import --analyze --latest
          +-> uploads JSON/FIT ZIP to Nexus
          +-> Nexus inventories and parses it into that same user's D1 records
```

The agent deliberately processes jobs sequentially. This keeps GarminDB state isolated and avoids multiple concurrent syncs competing for CPU, network, Garmin rate limits, or local files.

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

Rebuild/recreate the container while keeping both appdata directories:

```bash
docker stop nexus-garmin-agent
docker rm nexus-garmin-agent
docker build --pull -f docker/garmin-agent/Dockerfile -t nexus-garmin-agent:local .
# recreate with the same /state and /data mounts + environment
```

Because `/state` and `/data` are bind-mounted from Unraid, container replacement does not remove user profiles, OAuth token stores, GarminDB databases, JSON, or FIT files.
