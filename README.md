# Nexus

Nexus is a personal and family-facing PWA that brings together data and status from otherwise separate tools and projects into one simple place.

The goal is not to replace those systems. Nexus is the presentation, integration, and analysis layer above them.

## Core principles

- **Keep existing projects independent.** DBA Gold, Unraid Watch, PC Watch, Home Assistant, and future tools remain separate systems.
- **Keep Nexus core small.** Authentication, users, permissions, navigation, PWA behaviour, notifications, module registration, and shared UI belong in core.
- **Modules own their domain.** Garmin, weather, electricity, DBA, Unraid, PC monitoring, etc. are modules or integrations with clear boundaries.
- **Simple enough for non-technical family members.** The UI and login flow must be understandable without technical knowledge.
- **KISS over architecture theatre.** Prefer a modular monolith and boring infrastructure over unnecessary microservices.
- **Data stays useful outside the source system.** Imported data should be normalized where practical so Nexus can analyse and combine it across modules.

## Initial platform direction

Target stack:

- Cloudflare-hosted web/PWA frontend
- Cloudflare Worker API
- D1 for structured application and normalized module data
- R2 for large/raw imports such as Garmin exports, FIT, TCX, GPX, JSON, and other blobs
- Cron / Queues only where they solve a concrete requirement

The exact frontend framework and authentication implementation are intentionally not locked yet.

## MVP

1. PWA application shell
2. Multi-user authentication
3. Simple roles and module permissions
4. Dashboard with module widgets
5. Garmin import pipeline
6. Garmin history and charts
7. Weather widget/module
8. Electricity-price widget/module
9. Stable integration contract for existing external projects

DBA Gold, Unraid Watch, PC Watch, and Home Assistant integrations come after the integration contract is proven.

## First module: Garmin

Garmin is the first real data module because it exercises the important platform concerns:

- per-user data ownership
- historical imports
- raw-file retention
- normalization
- charts and long-term trends
- future automated synchronization
- cross-module analysis

Initial data domains may include:

- daily health summaries
- activities
- heart-rate samples
- sleep sessions
- body metrics
- source/import metadata

Raw Garmin exports should be retained separately from normalized data so imports can be reprocessed later without requiring another export.

## Repository status

Architecture and data modelling come before feature implementation. See `docs/ARCHITECTURE.md` and `docs/MVP.md`.
