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

Feature views are now represented by reusable widgets with stable internal IDs. Current widgets include:

- `garmin.steps.today`
- `garmin.steps.week`
- `garmin.sleep.lastNight`
- `garmin.sleep.week`
- `garmin.bodyBattery.today`
- `wellbeing.today`
- `energy.price.current`
- `energy.price.todayRange`
- `energy.price.next24h`
- `weather.current`
- `weather.nextHours`
- `weather.week`

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

Trend-style widgets live separately in `src/widgets/extendedWidgets.tsx` so the registry remains primarily declarative.

### Shared data access

`src/data/queryCache.ts` provides a small shared in-memory JSON query cache. Widgets using the same endpoint share the in-flight request and cached result rather than independently fetching identical source data.

This is intentionally small and dependency-free; introduce a larger query library only if a concrete requirement justifies it.

### Per-user layout

D1 migration `0015_home_layout.sql` adds `user_home_layout`.

`GET /api/home-layout` returns the user's saved layout or a default layout. `PUT /api/home-layout` validates and stores the ordered widget list and size choices.

### Home editing

`Rediger Hjem` supports:

- add/remove widgets from the catalogue
- change supported widget size
- direct `−/+` resize controls on each widget
- direct desktop drag-and-drop reorder using the widget handle
- inline earlier/later buttons as a deterministic fallback, including touch/mobile use
- save layout per user

The original selector + move controls remain available as a fallback rather than making drag/drop the only way to edit the dashboard.

Widget sizing has explicit semantics on desktop:

- small = 1 of 4 columns
- medium = 2 of 4 columns
- wide = full row

Responsive breakpoints collapse these predictably to two columns and then one column on mobile.

The stored format remains the intentionally simple `{ id, size }` model; no new migration was needed for direct editing.

### First polish pass

After the first real deployment screenshot:

- removed the duplicate Home sub-heading hierarchy, leaving the global `Hjem` heading as the page introduction
- tightened Home vertical spacing and widget row height
- made sizing behaviour explicit and predictable
- expanded `wellbeing.today` with completion status and journal-state information so the widget earns its space instead of showing only two chips

### Widget expansion pass

Added compact dashboard views for data that benefits from short trends rather than only a single current value:

- Garmin 7-day steps
- Garmin 7-night sleep duration
- today's electricity min/average/max
- electricity price chart for the next 24 hours, deliberately keeping the same fixed 0–6 kr/kWh visual reference scale as the Strøm page
- next-hours weather
- 7-day weather

`weather.current` now keeps wind strength/direction and current precipitation amount together in the same default widget size.

### Dynamic-content pass

Home widgets use CSS container queries so content responds to the actual widget width rather than only the browser viewport:

- compact widgets prioritize the glanceable value and trim tertiary detail
- medium widgets expose useful context
- wide widgets expose richer trends, longer forecasts and journal content
- rich widgets can use small/medium/wide sizes where the content can degrade gracefully

This means resizing a widget changes information density, not only card width.

### Next Home work

After direct reorder/resize is tested on real desktop/mobile layouts, next layout work can be driven by observed friction rather than introducing a heavier grid library pre-emptively. Candidates include row-height tuning, smarter packing, and pointer-based touch drag only if the button fallback proves insufficient.

### Next widget work

As new visualizations are built on Garmin, Strøm, Vejr, Velbefindende, Unraid and later integrations, create them as registered reusable widgets rather than page-only components where practical.

Existing page-owned visualizations do not all need to be refactored immediately; do that when each area is touched again.

## Phase C — Revisit Air Audit 🚧

With Modular Home v1 in place, the audit is now being applied selectively against the current product rather than copied blindly.

### Completed so far

- Garmin A4: removed the two redundant historical-count cards; day/night counts now live as one compact caption in the overview heading.
- Garmin B2: detail navigation uses one clear close action, truthful chevrons, and opens on the more useful 4w range by default. Users can still switch to 1d for a specific day/night.
- Garmin D1: 1-year health charts are aggregated to weekly averages instead of rendering hundreds of daily bars; charts now include readable y-axis labels, series legends, and a clear `Ugegennemsnit · 1 år` marker while summary statistics continue to use the underlying daily data.
- Garmin mobile chart follow-up: bar charts no longer impose a fixed mobile minimum width, so they stay inside the viewport. Chart interaction disables browser text selection/touch callouts, and an optional fullscreen control expands the chart and best-effort requests landscape orientation on supported mobile browsers.
- Motion A5: replaced repeated stat labels with a real aligned activity table, one sticky header, month grouping, tabular numbers, and progressive `Vis flere` in 30-row chunks.
- Motion scanability follow-up: month/year dividers use normal foreground text plus a subtle accent marker/background so long histories are easier to skim without increasing font size.
- Velbefindende A3: today's recorded values and latest journal note appear directly on the page instead of only inside the editing dialog.
- Check-in B4: one clear `Gem` action now saves changed metric values and an optional new journal note; closing or changing date with unsaved edits asks before discarding them.
- Check-ins now have explicit value semantics via migration `0016_wellbeing_metric_types.sql`: `scale` values use 1–5, `boolean` values use 0/1, and a missing database row means not registered / not relevant. Any chosen value can be cleared again.
- Miyagi typed-check-in follow-up: analysis context now carries each metric's `valueType`. Scale metrics expose a 1–5 average; boolean metrics expose yes-rate plus yes/no counts. Miyagi's analysis/chat instructions explicitly treat missing boolean entries as unregistered rather than `Nej` and never interpret a yes-rate as a 1–5 score.
- Strøm B5: the current-price breakdown is one hierarchy with `I alt` visually separated as the total; the 15-minute strip gets a right-edge scroll affordance. The chart remains deliberately fixed at 0–6 kr/kWh.
- Vejr B6: wide 7-day rows use tighter fixed information columns rather than stretching across the whole card, and the hourly strip visually indicates horizontal overflow.

### Dashboard layout foundation (2026-09-04) ✅

Root-cause fix for charts drifting inside widgets and widgets rendering out of stored order:

- `src/dashboard/dashboard.css` is now the only owner of grid, card and chart-frame sizing. `grid-auto-flow: dense` and the fixed 56px rows with a per-widget-ID span table are gone; rows are `minmax(150px, auto)` and widgets that need two rows declare `rows: 2` in the registry.
- `src/dashboard/ChartFrame.tsx` measures its CSS-defined box with a ResizeObserver and charts draw in pixels, so axis text is a constant 10px on every screen and label density follows the available width. Used by the usage and price widgets, the Strøm page chart and the overnight sleep charts.
- `src/dashboard/WidgetCard.tsx` and `src/dashboard/layoutEditing.ts` are shared by Home, the Displays editor and paired displays. Card headers show the title and one action; the source kicker only appears while editing. Order buttons read `↑/↓` in one-column layouts.
- Paired displays fill the screen: one-line header, four columns from 900px, rows share the viewport height, charts grow into their cards.
- Colour bands are tokens (`--band-low/medium/high`), `/api/settings` has one cache TTL and is invalidated on save, API response types live in `src/data/api-types.ts`.
- Removed the unused `KitchenDisplay` view and stylesheet, `home-responsive.css` (merged) and empty stylesheets; page subheadings under the `h1` are gone.
- `docs/UI-GUIDE.md` documents the system.

Follow-ups: move the Garmin health bar chart onto `ChartFrame`; add a `config` slot to layout items so the grouped container widget becomes a real registry entry; consider one `dashboards` table with a `kind` column so Home and displays share storage and defaults.

### Next candidates

- Velbefindende follow-up: add short trend views where the history endpoint supports it cleanly and the visual adds real value.
- Mobile C3: revisit which destinations belong in the mobile nav once placeholder/roadmap modules are actually useful.
- Re-read the remaining Air Audit after these changes and close Phase C when the remaining items are either implemented, intentionally rejected, or belong to not-yet-built modules.

Items for modules that are not implemented yet should not create placeholder work merely to satisfy the audit.

## Deliberate non-change: electricity chart scale

The electricity-price chart keeps its fixed vertical scale (currently up to 6 kr/kWh) by design.

A dynamic `max(data)` axis would use plot area more efficiently, but it would make the same bar height mean different absolute price levels from day to day. Nexus prioritizes quick visual comparison of today's price level against a stable reference scale, so this audit recommendation is intentionally rejected.

## Design rule

Do not solve isolated empty-space problems by globally shrinking fonts or compressing every component. Keep the existing visual language and fix local causes: hard minimum heights, excessive fixed padding, hidden useful content, misleading controls, and poor responsive affordances.
