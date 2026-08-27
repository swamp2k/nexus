# Nexus MVP

## Goal

Prove that Nexus can operate as a simple family-facing PWA with one login, modular dashboard content, and one meaningful historical data pipeline without turning into a replacement for every underlying system.

## Phase 0 — Foundations

Before feature work:

- choose frontend framework
- choose authentication implementation
- establish local/dev/deploy workflow
- define D1 migration strategy
- define module registration contract
- define environment/secrets conventions

Deliverable: deployable empty Nexus shell with documented development workflow.

## Phase 1 — Application shell

Build the minimum usable PWA:

- responsive application shell
- installable PWA manifest/service worker
- mobile/tablet/desktop navigation
- dashboard route
- module route convention
- loading/error/empty states
- accessible touch targets and readable typography

Do not build a configurable drag-and-drop dashboard yet.

Deliverable: an installable Nexus app with static placeholder modules.

## Phase 2 — Identity and permissions

Implement multi-user identity before importing personal data.

Requirements:

- user records
- secure sessions
- admin/member/viewer concepts
- module-level access checks
- logout/session revocation
- simple login UX suitable for non-technical family members

Preferred direction: passwordless login, with magic links/passkeys evaluated before implementation.

Deliverable: two users can sign in independently and receive different permitted module sets.

## Phase 3 — Module contract

Establish a deliberately small module interface.

A module should be able to register:

- id
- name
- icon/visual identity
- dashboard widget(s)
- route(s)
- required permissions
- optional jobs/importers

Deliverable: at least two trivial modules can be added/removed without editing unrelated application logic.

## Phase 4 — Garmin import spike

Before freezing schemas, obtain a real Garmin export and inspect it.

Tasks:

1. document Garmin export contents and formats
2. identify which historical data is actually present
3. preserve raw source files
4. build an idempotent import process
5. normalize a deliberately small initial subset
6. record provenance and import status/errors

Initial normalized target:

- daily health summaries
- activities
- sleep sessions where available

Do not prematurely import every possible metric.

Deliverable: one user's historical Garmin data can be imported repeatedly without duplication.

## Phase 5 — Garmin UI

Create useful views rather than reproducing Garmin Connect.

Initial views:

- today/latest summary
- date-range overview
- steps trend
- resting heart-rate trend
- sleep trend
- activity list
- simple year-over-year comparison

Deliverable: the imported history is genuinely easier to inspect/analyse than raw export files.

## Phase 6 — Simple live modules

Add two comparatively low-risk modules to validate that Nexus handles data that is not Garmin-shaped.

### Weather

- current/forecast summary
- warnings when a suitable source is available
- historical observations later

### Electricity

- current day prices
- cheapest/most expensive periods
- next-day prices when published

Deliverable: dashboard contains personal historical data plus live external data through the same module system.

## Phase 7 — External project integration contract

Only after the module model is proven, define how existing projects connect.

Candidate integrations:

- DBA Gold
- Unraid Watch
- PC Watch
- Home Assistant

Prefer narrow APIs or event payloads. Do not copy those applications into Nexus.

Deliverable: integrate one existing project through the documented contract, then use that experience to refine the contract.

## Explicitly out of MVP

- recreating Home Assistant
- drag-and-drop dashboard builders
- arbitrary user-authored automation engine
- microservices
- generalized analytics/AI chat over every dataset
- importing every Garmin metric before useful views exist
- moving existing projects into the Nexus repository
- complex organization/tenant administration

## Definition of MVP success

The MVP is successful when:

1. Nexus installs and behaves well as a PWA.
2. A non-technical family member can log in without assistance after initial setup.
3. Users only see modules/data they are allowed to see.
4. Garmin history can be safely imported and reprocessed.
5. Garmin trends are useful enough to answer real personal questions.
6. Weather and electricity prove the module design is not Garmin-specific.
7. At least one existing external project can surface useful information in Nexus without being absorbed into it.
8. Adding the next module feels routine rather than architectural.

## Immediate next action

Obtain and inspect a real Garmin account export before designing production Garmin migrations. In parallel, make the two remaining platform choices needed for the shell: frontend stack and authentication approach.
