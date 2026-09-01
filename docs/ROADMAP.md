# Nexus roadmap

Updated: 2026-09-01

This roadmap captures the current UI direction after the Nexus Air Audit and the decision to replace the existing Home page with a user-configurable widget dashboard.

## Phase A — UI cleanup (now)

1. Reduce global page-header chrome:
   - smaller H1
   - less top spacing
   - preserve the existing calm typography/design language rather than shrinking the whole UI
2. Restore mobile account access:
   - avatar opens a user menu
   - user menu exposes Settings and Log out
3. Restore a visible mobile-navigation affordance:
   - keep labels
   - keep horizontal scrolling
   - add a right-edge fade so hidden destinations are discoverable
4. Make controls tell the truth:
   - navigation/drill-down uses `›`
   - expansion uses a down arrow only when content actually expands inline
   - remove the Systemstatus chevron until there is a real status detail action

## Phase B — Modular Home (next)

Replace the current Home module-link grid with a real per-user dashboard.

### Widget model

Feature views should be reusable widgets instead of page-owned visualizations. Each widget gets a stable internal ID, for example:

- `garmin.sleep.week`
- `garmin.steps.week`
- `wellbeing.today`
- `energy.price.current`
- `weather.current`
- `unraid.storage`

The same widget component can be rendered on its feature page and on Home.

### Registry

Introduce a central widget registry with metadata such as:

- stable ID
- title
- source/module
- component
- supported sizes
- permissions/availability

The Home layout stores widget IDs and layout configuration per user rather than hard-coding components.

### Data access

Widgets must not independently duplicate fetches for the same source data. Feature pages and Home widgets should consume shared query/cache/data services where practical.

### Editing

Home should eventually support:

- add/remove widgets
- move widgets
- resize widgets
- save layout per user

Build the registry and rendering model before adding drag/drop complexity.

## Phase C — Revisit Air Audit

After Modular Home is in place, review the audit again and cherry-pick remaining improvements that still apply to the real product.

Likely candidates:

- Velbefindende: show today's recorded values and journal information inline rather than hiding useful data behind editing UI
- Garmin: remove redundant historical-count cards if they still add no value
- Garmin details: choose a useful multi-day default where a 1-day view has no meaningful chart
- Motion: compact activity history into aligned rows/table, sticky labels, and progressive `Vis flere`
- check-in editor: one clear save action and unsaved-change protection
- Strøm: reconsider information hierarchy around the total price and component breakdown
- Vejr: tighten wide forecast column alignment
- Garmin long-range charts: improve labels/aggregation where useful

Items for modules that are not implemented yet should not create placeholder work merely to satisfy the audit.

## Deliberate non-change: electricity chart scale

The electricity-price chart keeps its fixed vertical scale (currently up to 6 kr/kWh) by design.

A dynamic `max(data)` axis would use plot area more efficiently, but it would make the same bar height mean different absolute price levels from day to day. Nexus prioritizes quick visual comparison of today's price level against a stable reference scale, so this audit recommendation is intentionally rejected.

## Design rule

Do not solve isolated empty-space problems by globally shrinking fonts or compressing every component. Keep the existing visual language and fix local causes: hard minimum heights, excessive fixed padding, hidden useful content, misleading controls, and poor responsive affordances.
