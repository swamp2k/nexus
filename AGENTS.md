# AGENTS.md

This file is the canonical repository guidance for coding agents working on Nexus.

`CLAUDE.md` and `GEMINI.md` must only point here. Do not duplicate project guidance into tool-specific files. If guidance changes, update this file.

## What Nexus is

Nexus is a private personal/family PWA that aggregates data, status, and small tools from otherwise separate systems.

Nexus is the **aggregation, presentation, and analysis layer**. It is not a dumping ground that absorbs every existing project.

The product should feel simple enough for non-technical family members even when the implementation behind it is not.

## Core architectural rules

1. **KISS.** Prefer the smallest clear solution that solves the actual problem.
2. **Modular monolith over microservices.** Code boundaries matter; separate deployments usually do not.
3. **Existing services stay independent by default.** DBA Gold, Unraid Watch, PC Watch, Home Assistant, etc. remain authoritative for their own domains unless migration is deliberate.
4. **Use explicit integration contracts.** Prefer small APIs/events over direct coupling to another project's internal database.
5. **Multi-user from day one.** User-owned data must always be scoped by `user_id` unless explicitly shared.
6. **Raw and normalized data serve different jobs.** Normalize data Nexus needs to query/chart/correlate; retain useful source artifacts separately.
7. **Do not add infrastructure speculatively.** No Kafka, Kubernetes, extra queues, services, or databases without a concrete requirement.
8. **Make reversible decisions where practical.** Especially during feature development.
9. **Do not hide complexity in the UI.** The UI should stay calm, compact, and understandable.
10. **Inspect current code before changing it.** Repository state beats assumptions and old documentation.

## Stack

- React 19
- TypeScript
- Vite
- Cloudflare Vite plugin
- Cloudflare Worker API
- Cloudflare D1
- Cloudflare R2
- Cloudflare Workers Builds
- Leaflet + OpenStreetMap for Motion maps
- PWA frontend

Cron/Queues are optional and should only be introduced for a concrete need.

## Repository layout

Important areas:

```text
src/                     React UI
worker/                  Cloudflare Worker API
worker/auth/             sessions/authentication
worker/garmin/           Garmin routes/import/sync support
worker/settings/         per-user settings
worker/sources/          external data sources
worker/wellbeing/        wellbeing APIs
migrations/              D1 migrations
tools/                   local/shared agents and utilities
docker/                  container definitions
docs/                    architecture/operations documentation
```

Do not reorganize the whole repository simply to match a theoretical ideal. Improve structure when a real maintenance problem justifies it.

## Authentication and security

Nexus uses passwordless magic links with authenticated sessions.

Conceptual roles:

- `admin`
- `member`
- `viewer`

Security rules:

- Never commit credentials, tokens, passwords, API keys, encryption keys, or private URLs containing secrets.
- Never ask users to paste secrets into code or chat when a secret binding can be used instead.
- Use Cloudflare secrets/environment bindings for sensitive configuration.
- Every personal-data API must verify the authenticated user and scope reads/writes to that user.
- Treat imported health/wellbeing data as private personal data.
- Avoid logging sensitive payloads or credentials.

## Data/storage rules

### D1

D1 contains structured/queryable Nexus data:

- auth/users/session metadata
- user settings
- normalized Garmin health/activity data
- wellbeing entries/journal
- source caches
- electricity configuration/data
- import/job metadata

All user-owned tables should include `user_id` and indexes appropriate to the main access pattern.

### R2

Use R2 for larger raw/source artifacts worth retaining or reprocessing.

Do not put blobs in D1 merely because it is convenient.

### Provenance

Normalized imported data should retain enough provenance (`import_id`, source identifiers, timestamps, etc.) to understand where it came from and safely reprocess it later.

## D1 migrations

Migrations live in `migrations/` and are applied explicitly.

Useful commands:

```bash
npm run db:migrations:list
npm run db:migrate
```

**Deploys do not automatically apply D1 migrations.**

When adding a migration:

- never silently mutate an already-applied migration
- add a new numbered migration
- make it safe for production data
- update code and documentation in the same workstream where relevant

## Build/deploy workflow

Useful commands:

```bash
npm run dev
npm run check
npm run build
npm run types
npm run db:migrations:list
npm run db:migrate
```

`npm run build` performs Worker type generation, TypeScript checking, and the Vite production build.

Cloudflare Workers Builds deploys from GitHub.

Before considering work complete:

- ensure TypeScript/build assumptions are valid
- do not ignore Cloudflare Worker runtime differences
- do not assume Node-only APIs are available just because local Node accepts them
- fix build errors rather than hand-wave them away

## UI/product rules

Nexus UI should be:

- compact
- information-dense without being cluttered
- visually calm
- responsive
- simple enough for non-technical family members
- consistent across light and dark themes

Avoid:

- giant cards with large empty areas
- oversized touch targets when not needed
- repetitive explanatory hero panels inside modules
- duplicate page descriptions
- novelty UI that costs clarity

The compact Settings layout is the preferred reference for density and spacing.

Preserve existing successful visual patterns unless there is a concrete reason to change them.

## Module boundaries

### Garmin

Garmin is the health/body-signal domain.

It currently covers normalized data such as:

- daily summaries
- sleep
- resting heart rate
- steps
- stress
- Body Battery
- respiration
- weight/body metrics
- Garmin-sourced activities used by Motion

Do not move training/activity presentation back into the Garmin UI just because Garmin is the source.

### Motion

Motion owns **what the user does**: activities, training history, activity detail, routes, laps, charts, records, and future activity sources beyond Garmin.

Garmin is currently the data source, but Motion should not become Garmin-specific at the product/domain boundary.

Activity detail can include:

- summary stats
- pace/speed derived from distance/time
- heart rate
- elevation
- route maps
- track charts
- laps/splits
- future comparisons and records

Prefer normalized activity-detail data over making the browser parse Garmin FIT files directly.

### Wellbeing

Wellbeing contains subjective user-entered metrics and journal entries.

Important rule: original user input is ground truth. Future AI follow-ups, interpretations, or summaries must remain separate and must not overwrite original entries.

### Weather

Weather currently uses MET Norway. Respect caching and stale-data fallback rather than making unnecessary repeated external calls.

### Electricity

Electricity combines spot/day-ahead prices with configurable grid/provider components to estimate the actual variable price.

Keep fixed subscriptions separate from variable per-kWh cost unless the UX explicitly asks for an all-in monthly calculation.

### Future integrations

DBA Gold, Unraid Watch, PC Watch, waste calendar, MELCloud, etc. should remain independent services/sources and integrate through narrow contracts.

## Garmin shared agent

`tools/nexus-garmin-agent.py` is a shared outbound-only multi-user Garmin synchronization agent, typically run as one Unraid container.

Principles:

- one agent installation can service multiple Nexus users
- GarminDB config/token state is isolated per Nexus user
- downloaded Garmin data is isolated per Nexus user
- the agent receives credentials only for the claimed job
- credentials are scrubbed from generated config after use
- sync jobs run sequentially
- keep GarminDB GPL code as an external dependency; do not copy large upstream implementations into Nexus

### Capability handling

Missing data is not automatically unsupported.

Capability states include concepts equivalent to:

- `supported`
- `inactive`
- `unsupported`
- `unknown`

Examples:

- HRV may legitimately become `unsupported` when Garmin repeatedly returns valid empty responses and the device does not expose HRV Status.
- Wrist heart rate may become `inactive` when the user disables the sensor, removes the watch, or saves battery. It must be allowed to return later.
- Do not permanently disable a source merely because a few days are empty.

The agent includes a workaround for GarminDB `--latest` using file mtime: old monitoring files are aged before sync so historical FIT files are not reprocessed on every run.

Do not undo this without understanding why it exists.

### Garmin sync performance

Current intent is approximately:

```text
Garmin download -> GarminDB import -> package changed Nexus-relevant JSON -> upload -> D1 normalization
```

GarminDB `--analyze` is intentionally not part of the normal agent sync because Nexus does not consume GarminDB's analysis output.

Do not optimize small remaining sync costs at the expense of correctness or maintainability.

## Motion activity data

Garmin activity summary JSON is normalized into `garmin_activities`.

Garmin FIT activity records can contain richer samples such as:

- timestamp
- latitude/longitude
- distance
- cadence
- heart rate
- respiration
- altitude
- speed
- temperature

GarminDB also parses laps/splits and activity-specific details.

When extending Motion:

- keep activity list cards clickable
- use a dedicated activity-detail view/API
- provide maps only when usable GPS points exist
- degrade gracefully for indoor/no-GPS activities
- downsample large tracks if needed rather than shipping pathological payloads
- avoid exposing raw device/source formats directly to UI components

## Kitchen display

`/display/kitchen` is a dedicated kiosk/tablet experience.

It should:

- avoid normal app chrome
- be glanceable
- remain usable by touch
- refresh automatically
- show freshness/last-known-good state where relevant

Do not force normal desktop navigation patterns into this view.

## Coding style

- Prefer clear boring code over clever abstractions.
- Keep functions/modules reasonably small and domain-focused.
- Use explicit types for API/domain boundaries.
- Avoid `any` unless there is a very good reason.
- Treat external JSON as `unknown` and validate/narrow it.
- Handle missing/partial external data gracefully.
- Preserve backwards compatibility with existing user data where practical.
- Avoid broad refactors while fixing a narrow bug unless the refactor is truly required.
- Do not add dependencies for trivial functionality already easy to implement safely.

## External-source reliability

Garmin, weather, electricity, and other external sources can be partial, delayed, rate-limited, or temporarily unavailable.

Prefer:

- cached/last-known-good data
- bounded retries
- explicit freshness metadata
- graceful partial UI

Avoid turning a temporary source failure into a broken entire Nexus page.

## AI and cross-domain insights

A future Nexus goal is cross-domain analysis such as sleep vs activity, wellbeing vs health, weather vs activity, etc.

Rules:

- deterministic feature engineering first
- AI explains/interprets prepared data rather than being the only analysis engine
- association is not causation
- keep source facts distinguishable from inference
- do not overwrite user-authored source data with AI output

## Documentation discipline

Documentation must describe the system that actually exists.

Important docs:

- `README.md` — project overview and current status
- `AGENTS.md` — canonical coding-agent guidance
- `docs/ARCHITECTURE.md` — architecture/boundaries
- `docs/MVP.md` — product scope/direction
- `docs/AUTH.md` — authentication
- `docs/GARMIN-AGENT-UNRAID.md` — Garmin agent operations

When implementation makes a documented statement false, update the relevant document in the same workstream.

Do not copy the contents of `AGENTS.md` into `CLAUDE.md`, `GEMINI.md`, or other tool-specific instruction files. Reference this file instead.

## Working style for agents

When asked to make a change:

1. Inspect the latest relevant files before editing.
2. Understand the existing data/API path end-to-end.
3. Prefer a concrete implementation over a speculative plan when the request is clear.
4. Keep the change focused.
5. Call out real risks/gotchas before destructive or hard-to-reverse changes.
6. Do not ask unnecessary clarifying questions when the repository already answers them.
7. Do not claim runtime/API compatibility without evidence.
8. If an assumption matters, verify it in source/code where possible.
9. Keep secrets out of commits and logs.
10. Leave the repository simpler or at least no more confusing than you found it.

Nexus should remain **simple by design**.
