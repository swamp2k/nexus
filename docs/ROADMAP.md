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

## Phase B — Modular Home v1 ✅

The old Home module-link grid has been replaced with a real per-user dashboard and has had its first deployed visual polish pass.

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

Widget sizing has explicit semantics on desktop:

- small = 1 of 4 columns
- medium = 2 of 4 columns
- wide = full row

Responsive breakpoints collapse these predictably to two columns and then one column on mobile.

The stored format is already suitable for later drag/drop. Drag/drop itself is deliberately deferred until it improves the UX enough to justify the extra interaction/code complexity.

### First polish pass

After the first real deployment screenshot:

- removed the duplicate Home sub-heading hierarchy, leaving the global `Hjem` heading as the page introduction
- tightened Home vertical spacing and widget row height
- made sizing behaviour explicit and predictable
- expanded `wellbeing.today` with completion status and journal-state information so the widget earns its space instead of showing only two chips

### Next widget work

As new visualizations are built on Garmin, Strøm, Vejr, Velbefindende, Unraid and later integrations, create them as registered reusable widgets rather than page-only components where practical.

Existing page-owned visualizations do not all need to be refactored immediately; do that when each area is touched again.

## Phase C — Revisit Air Audit 🚧

With Modular Home v1 in place, the audit is now being applied selectively against the current product rather than copied blindly.

### Completed so far

- Garmin A4: removed the two redundant historical-count cards; day/night counts now live as one compact caption in the overview heading.
- Garmin B2: detail navigation uses one clear close action, truthful chevrons, and now opens on the more useful 4w range by default. Users can still switch to 1d for a specific day/night.
- Motion A5: replaced repeated stat labels with a real aligned activity table, one sticky header, month grouping, tabular numbers, and progressive `Vis flere` in 30-row chunks.
- Motion scanability follow-up: month/year dividers use normal foreground text plus a subtle accent marker/background so long histories are easier to skim without increasing font size.
- Velbefindende A3: today's recorded values and latest journal note now appear directly on the page instead of only inside the editing dialog. Closing a historical check-in returns the page state to today so the summary remains truthful.

### Next candidates

- Check-in B4: one clear save action and unsaved-change protection.
- Strøm B5: combine the price breakdown so `I alt` is not buried under `Øvrigt`; add scroll affordance to the 15-minute strip. Keep the deliberate fixed 0–6 kr/kWh chart scale.
- Vejr B6: tighten wide forecast column alignment and make horizontal overflow discoverable where needed.
- Garmin D1: improve long-range chart labelling/aggregation where useful.
- Velbefindende follow-up: add short trend views where the history endpoint supports it cleanly and the visual adds real value.
- Mobile C3: revisit which destinations belong in the mobile nav once placeholder/roadmap modules are actually useful.

Items for modules that are not implemented yet should not create placeholder work merely to satisfy the audit.

## Deliberate non-change: electricity chart scale

The electricity-price chart keeps its fixed vertical scale (currently up to 6 kr/kWh) by design.

A dynamic `max(data)` axis would use plot area more efficiently, but it would make the same bar height mean different absolute price levels from day to day. Nexus prioritizes quick visual comparison of today's price level against a stable reference scale, so this audit recommendation is intentionally rejected.

## Design rule

Do not solve isolated empty-space problems by globally shrinking fonts or compressing every component. Keep the existing visual language and fix local causes: hard minimum heights, excessive fixed padding, hidden useful content, misleading controls, and poor responsive affordances.
