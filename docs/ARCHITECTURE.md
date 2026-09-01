# Nexus Architecture

## Purpose

Nexus is an aggregation and presentation platform for personal and family data. It provides one PWA, one identity layer, one dashboard, and a set of independent modules/integrations.

Nexus should not absorb every existing project into one codebase. Existing systems remain authoritative for their own domain unless there is a specific reason to migrate responsibility.

## High-level model

```text
                    +----------------------+
                    |      Nexus PWA       |
                    | dashboard / modules  |
                    +----------+-----------+
                               |
                    +----------v-----------+
                    |    Nexus Worker API  |
                    | auth / permissions   |
                    | module registry      |
                    +----+-----------+-----+
                         |           |
                 +-------v--+   +----v----------------+
                 |    D1    |   |         R2          |
                 | metadata |   | raw imports / blobs |
                 | normalized|  | FIT / TCX / JSON    |
                 +----------+   +---------------------+
                         |
        +----------------+-------------------------------+
        |                |               |                |
   Garmin module    Weather module   Power module   Integrations
                                                   DBA / Unraid /
                                                   PC Watch / HA
```

## Core responsibilities

Core owns only shared platform concerns:

- users and identities
- households/families if required
- authentication/session lifecycle
- roles and permissions
- navigation
- PWA support
- notification plumbing
- module registration and availability
- shared UI primitives
- integration credentials/secrets references
- audit-friendly import/job metadata

Core should not contain Garmin-specific, weather-specific, DBA-specific, or other domain logic.

## Module boundaries

Each module should expose a small predictable surface. The implementation can remain inside one repository/application initially; modularity does not require microservices.

Suggested module shape:

```text
src/modules/<module>/
  api/
  db/
  jobs/
  ui/
  domain/
```

A module may provide:

- dashboard widgets
- full-page views
- API routes
- scheduled jobs
- importers/synchronizers
- database migrations/tables
- notification producers

Removal or disabling of one module should not break unrelated modules.

## Widget and Home architecture

Home is not a second module-navigation page. Its job is to show the current user's most useful data across modules.

Feature visualizations should therefore be reusable widgets rather than components owned only by a full-page view.

Each reusable widget should have a stable internal ID, for example:

```text
garmin.sleep.week
garmin.steps.week
wellbeing.today
energy.price.current
weather.current
unraid.storage
```

A central widget registry should eventually describe at least:

- stable widget ID
- display title
- source/module
- render component
- supported sizes
- permissions/availability requirements

Both feature pages and Home render registered widget components. Do not duplicate a chart or data card just because it appears in two places.

Home layout is user-owned configuration. It should store widget IDs plus layout information per user, rather than hard-coded React components. The first implementation may use a simple grid/list; drag/drop and resize controls should be layered on only after the registry and persistence model are stable.

Widgets should consume shared query/cache/data services where practical. Multiple Garmin widgets on Home should not each independently fetch overlapping Garmin datasets if one shared request/cache can serve them.

See `docs/ROADMAP.md` for the implementation sequence.

## External integrations

Existing projects stay independent by default.

Nexus should consume the narrowest useful contract, for example:

```http
GET /api/status
GET /api/summary
GET /api/events?since=<timestamp>
```

or receive pushed events where that is a better fit.

Do not couple Nexus directly to internal database schemas of external projects unless there is a compelling reason and the coupling is explicitly documented.

## Data strategy

### Normalized data

Structured data used for querying, charts, comparisons, and cross-module analysis belongs in D1.

Examples:

- daily health summaries
- activities
- sleep sessions
- hourly/daily weather observations
- electricity prices
- integration status snapshots

### Raw/source data

Original imports and large source artifacts belong in R2.

Examples:

- Garmin export archives
- FIT files
- TCX/GPX files
- JSON exports
- other source payloads worth retaining for reprocessing

Raw imports should be immutable where practical. Normalized data can then be rebuilt from source data if import logic changes.

## Identity and access

Nexus is multi-user from the beginning.

Initial conceptual roles:

- `admin` — platform/family administration
- `member` — normal personal and shared access
- `viewer` — simplified read-only or limited dashboard access

Permissions should ultimately be capability/module based rather than relying only on broad roles.

The login experience must prioritize simplicity for non-technical users. Passwordless approaches such as magic links and passkeys are preferred candidates, but the exact provider/implementation is not yet selected.

## Garmin data model direction

Do not model the system as one opaque Garmin payload table.

Suggested normalized domains:

### `health_daily`

- user_id
- date
- steps
- resting_hr
- avg_hr
- sleep_minutes
- stress_avg
- calories
- distance
- body_battery_high
- body_battery_low
- source_import_id

### `activities`

- id
- user_id
- source_activity_id
- activity_type
- started_at
- duration_seconds
- distance
- calories
- avg_hr
- max_hr
- source_import_id

### Additional domains

- `heart_rate_samples`
- `sleep_sessions`
- `body_metrics`
- `imports`
- `import_files`

This is a starting direction, not a frozen schema. Actual fields should be validated against real Garmin export/API payloads before migrations are finalized.

## Cross-module analysis

A major design goal is making independently sourced data comparable.

Examples Nexus should eventually be able to answer:

- activity trends over several years
- resting heart rate after short-sleep nights
- activity level compared with historical weather
- electricity-price patterns and household behaviours

This is why timestamps, timezone handling, ownership, units, provenance, and normalized data matter from the start.

## Deployment direction

Preferred initial architecture:

```text
Cloudflare
├── Web/PWA frontend
├── Worker API
├── D1
├── R2
└── Cron / Queues when justified
```

Avoid adding infrastructure until a concrete requirement demands it.

## Architectural rules

1. Existing projects remain independent unless intentionally migrated.
2. Core stays domain-agnostic.
3. Modules communicate through explicit contracts.
4. Raw imports are retained when valuable for later reprocessing.
5. Normalized data carries provenance.
6. Multi-user ownership is part of schemas from day one.
7. Do not introduce microservices merely to enforce code boundaries.
8. Optimize the end-user experience for ordinary family members, not developers.
9. Prefer simple reversible decisions during the MVP.
10. Validate assumptions against real source data before freezing schemas.
11. Build reusable, registered data widgets rather than separate Home-only copies of feature visualizations.
12. Keep dashboard layout user-specific and avoid hard-coded personal layouts.
