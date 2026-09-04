# Nexus

Nexus is a personal and family-facing PWA that brings data, status, and small everyday tools from otherwise separate systems into one simple place.

Nexus is deliberately an **aggregation, presentation, and analysis layer**. It should not absorb every existing service or project into one monolith.

## Principles

- **Keep existing projects independent.** DBA Gold, Unraid Watch, PC Watch, Home Assistant, and future tools remain separate unless there is a concrete reason to migrate responsibility.
- **KISS.** Prefer a modular monolith, explicit contracts, and boring infrastructure over architecture theatre.
- **Multi-user by default.** Personal data and settings belong to the authenticated user unless explicitly shared.
- **Simple for ordinary family members.** Technical complexity belongs behind the UI, not in it.
- **Normalize useful data.** Source data should become queryable Nexus data where that enables charts, history, and cross-module insights.
- **Retain source data when valuable.** Raw imports belong in R2 when reprocessing later is useful.
- **Modules own their domain.** Garmin, Motion, wellbeing, weather, electricity, and future integrations should stay cleanly separated.

## Stack

- React 19 + TypeScript
- Vite
- Cloudflare Vite plugin
- Cloudflare Worker API
- Cloudflare D1 for structured/normalized data
- Cloudflare R2 for import/source blobs
- Cloudflare Workers Builds from GitHub
- Leaflet + OpenStreetMap for Motion route maps
- PWA application shell

Cron and Queues are added only when a concrete requirement justifies them.

## Authentication

Nexus uses passwordless magic-link authentication.

- No open signup
- Multi-user from day one
- Roles: `admin`, `member`, `viewer`
- Long-lived secure session cookie
- Mail delivery through the configured mail provider

Authentication and authorization live in the Worker; module data is scoped to the authenticated user.

## Current modules

### Garmin

Garmin is the primary health-data source.

Nexus currently normalizes and displays data including:

- daily summaries
- sleep
- resting heart rate
- steps
- stress
- Body Battery
- respiration
- weight/body metrics where available
- activities

Garmin synchronization is handled by the shared `nexus-garmin-agent` container. One agent can serve multiple Nexus users while keeping GarminDB state and downloaded data isolated per user.

The agent includes capability detection so missing/disabled watch features do not cause expensive historical re-fetches. HRV, for example, can be marked unsupported, while temporarily missing signals such as wrist heart rate can become inactive and be detected again later.

### Motion

Motion is the activity/training domain. It intentionally sits beside Garmin rather than inside it so other activity sources can be added later.

Current activity views include:

- activity history
- clickable activity details
- distance, duration, moving time, calories, heart rate, elevation, steps, and related summary data
- route maps when GPS track data exists
- track charts
- laps/splits where available

Garmin FIT activity records contain richer time-series data such as GPS position, heart rate, distance, cadence, altitude, speed, respiration, and temperature. Nexus should consume normalized activity detail rather than make the browser depend directly on FIT files.

### Wellbeing

Daily subjective check-in and journal module.

- user-configurable 1–5 metrics
- sensible starter metrics
- metrics can be hidden/reactivated
- journal entries
- historical entries/backfill

The original user-entered journal/check-in data is ground truth. Future AI interpretation must remain separate from that source data.

### Weather

Weather data from MET Norway with per-user location settings, caching, and stale-data fallback.

### Electricity

Electricity-price module using Danish day-ahead prices plus configurable grid/provider components to estimate the actual variable household price.

### Planned integrations

- DBA Gold
- Unraid Watch
- PC Watch
- waste calendar
- Mitsubishi/MELCloud
- additional cross-module insights and notifications

These are reusable domain components, not systems Nexus keeps at arm's length. Each stays the source of truth for its own domain, and Nexus reuses it rather than reimplementing it.

## Paired displays

`/display` is a kiosk-style view intended for a shared tablet. A device is paired once with a code from the Displays page and then shows its assigned dashboard without a login. It has no normal app chrome, fills the screen, refreshes automatically and renders the same widgets as Home.

## Data strategy

### D1

Use D1 for structured data that Nexus needs to query, compare, chart, or correlate.

Examples:

- users and sessions
- settings
- normalized Garmin health data
- activities
- wellbeing entries
- cached source data
- electricity configuration/data
- import/job metadata

### R2

Use R2 for larger source artifacts that are useful to retain or reprocess.

Examples include Garmin import archives and other source blobs.

When reading from an external project, pick the boundary that keeps one source of truth with the least duplicated code and operational complexity — an HTTP contract, a Service Binding, a shared read model, or a directly shared Cloudflare resource. Prefer a stable contract over reaching into a schema that may churn, but do not add a service hop purely for the sake of independence.

## Development

```bash
npm install
npm run dev
```

Useful commands:

```bash
npm run check
npm run build
npm run types
npm run db:migrations:list
npm run db:migrate
```

`npm run build` runs Worker type generation, TypeScript checks, and the Vite production build.

## Deployment

Production is deployed as a Cloudflare Worker/PWA from the GitHub repository.

Workers Builds performs the application build/deploy, but **D1 migrations are not automatically applied by deploys**. Apply new migrations explicitly:

```bash
npm run db:migrate
```

Never put credentials, API keys, Garmin passwords, encryption keys, or tokens in the repository. Use Cloudflare secrets/environment bindings.

## Repository guidance for coding agents

`AGENTS.md` is the canonical repository guidance for Codex and all other coding agents.

`CLAUDE.md` and `GEMINI.md` intentionally contain only redirects to `AGENTS.md` so project instructions do not drift between tools.

## Documentation

- `AGENTS.md` — canonical coding-agent/project guidance
- `docs/ARCHITECTURE.md` — architecture and boundaries
- `docs/MVP.md` — product scope/direction
- `docs/AUTH.md` — authentication design
- `docs/GARMIN-AGENT-UNRAID.md` — Garmin agent deployment/operations
- `docs/UI-GUIDE.md` — design system: tokens, dashboard cards, charts, displays

Documentation should describe the system that actually exists. When implementation changes invalidate a documented fact, update the relevant documentation in the same workstream.
