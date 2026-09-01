# Nexus roadmap

Updated: 2026-09-01

This roadmap captures the current UI direction after the Nexus Air Audit and the decision to replace the existing Home page with a user-configurable widget dashboard.

## Phase A — UI cleanup ✅

Completed 2026-09-01:

1. Reduced global page-header chrome:
   - smaller H1
   - less top spacing
   - preserved the existing calm typography/design language rather than shrinking the whole UI
2. Restored mobile account access:
   - avatar opens a user menu
   - user menu exposes Settings and Log out
3. Restored a visible mobile-navigation affordance:
   - labels kept
   - horizontal scrolling kept
   - right-edge fade indicates hidden destinations
4. Made controls tell the truth:
   - navigation/drill-down uses `›`
   - expansion uses a down arrow only when content actually expands inline
   - Systemstatus chevron removed until there is a real status detail action

## Phase B — Modular Home ✅ foundation implemented

The old Home module-link grid has been replaced with a real per-user dashboard.

### Widget model

Feature views are now represented by reusable widgets with stable internal IDs. Initial widgets:

- `garmin.steps.today`
- `garmin.sleep.lastNight`
- `garmin.bodyBattery.today`
- `wellbeing.today`
- `energy.price.current`
- `weather.current`

The registry is deliberately independent of Home layout storage so the same widget components can increasingly be reused on feature pages as those pages are refactored.

### Registry

`src/widgets/widgetRegistry.tsx` is the central registry and stores:

- stable ID
- title and description
- source/module group
- target feature page
- component
- default size
- supported sizes

### Shared data access

`src/data/queryCache.ts` provides a small shared in-memory JSON query cache. Widgets using the same endpoint share the in-flight request and cached result rather than independently fetching identical source data.

This is intentionally small and dependency-free; introduce a larger query library only if a concrete requirement justifies it.

### Per-user layout

D1 migration `0015_home_layout.sql` adds `user_home_layout`.

`GET /api/home-layout` returns the user's saved layout or a default layout. `PUT /api/home-layout` validates and stores the ordered widget list and size choices.

### Home editing

`Rediger Hjem` currently supports:

- add/remove widgets
- change supported widget size
- move widgets up/down
- save layout per user

The stored format is already suitable for later drag/drop. Drag/drop itself is deliberately deferred until it improves the UX enough to justify the extra interaction/code complexity.

### Next widget work

As new visualizations are built on Garmin, Strøm, Vejr, Velbefindende, Unraid and later integrations, create them as registered reusable widgets rather than page-only components where practical.

Existing page-owned visualizations do not all need to be refactored immediately; do that when each area is touched again.

## Phase C — Revisit Air Audit (next review pass)

After Modular Home has had a real deployment/test pass, review the audit again and cherry-pick remaining improvements that still apply to the product.

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
