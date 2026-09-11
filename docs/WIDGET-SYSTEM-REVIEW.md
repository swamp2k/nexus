# Widget system robustness review

## Architecture and ownership

```text
widgetRegistry / widgetCatalog (supported widths, row units, renderer)
    -> LayoutItem[] (stable instance id, size, optional type/config)
    -> HomePage / DisplaysPage / DisplayDashboard (surface and data context)
    -> dashboard.css grid (column spans, stable row dimensions, visual order)
    -> WidgetCard (fixed header slot, bounded scrollable content)
    -> widget renderer -> ChartFrame (measure allocated space, draw SVG pixels)
```

`dashboard.css` is the authoritative owner of dashboard width and height.
`small`/`medium`/`wide` control column spans; `wide` is the existing persisted large
size. Registry `rows` reserves one or two 150px units, with a 14px gap. Content does
not determine these dimensions. Home and the editor use host-width breakpoints;
the kiosk keeps its screen-width breakpoints and omits navigation/configuration.
They share row semantics without forcing the kiosk through app chrome or sidebar
breakpoints. A layout that exceeds the viewport scrolls; spare screen height does
not inflate widgets.

## Root causes and changes

- Content-grown grid tracks stretched neighboring widgets. Display independently
  overrode row spans and chart flex behavior in `displays.css`. Stable row units and
  all surface sizing now live in `dashboard.css`. This intentionally supersedes the
  old content-grown-row rule in AGENTS/UI-GUIDE.
- SVG intrinsic size could feed back into flex sizing; Display's non-growing chart
  frame then left unused space. SVGs are positioned inside their measured frame.
  Dashboard chart frames consume the card's remaining usable height, with room for
  summaries, axes, legends and freshness notes.
- Viewport rules in content styles competed with card container queries; identical
  specificity let later imports silently override responsive rules. Card-scoped
  rules now own responsive forecast/stat layout. Forecasts and heat-pump content
  explicitly claim two registry row units. One-row cards prioritize primary data.
- Edit labels increased intrinsic header height. Labels now use existing padding;
  controls overlay the title when needed and stay within the card. Entering edit
  mode does not resize cards or reduce their content allocation.
- Home had no drag controller; Display used whole-card HTML dragging and could only
  insert before targets. Both editors now use `useWidgetDrag`: dedicated pointer
  handle, movement threshold, stable grid until drop, target-edge feedback, before
  and after insertion, edge scrolling and cancellation. Arrow controls remain.
- Home grouped containers visually but ordinary arrow edits moved raw array entries.
  All Home reorder paths now operate on visual groups and preserve member instances.
- Normalization discarded unavailable definitions, while Display omitted instance
  config/title resolution. Unavailable items now retain data and render a placeholder;
  Display passes configuration through. Saves prevent edits to an in-flight snapshot,
  and failed saves retain drafts for retry.

## Storage and compatibility

No schema, migration, API DTO or authentication change. Home remains in
`user_home_layout.layout_json`, scoped by `user_id`; displays remain in
`display_dashboards.layout_json`, scoped by dashboard ID and `user_id`.
Existing `id`, `size`, `type`, and `config` survive edits. Container groups retain
their individual stored records. No production data was accessed or changed.

The intentional visual change is that content no longer grows shared grid rows.
Long lists, link collections and journals scroll inside their card. Forecast and
heat-pump widgets reserve two rows. Column changes still necessarily reflow later
items, but do not resize their cards. Sparse placement respects saved order.

## Validation

Final local run on 2026-09-10: **27 tests passed** (52.7s). `npm run build`
passed Worker type generation, TypeScript and both production bundles. The existing
large-client-chunk warning remains. Mobile light, editor dark and desktop kiosk
screenshots were visually reviewed after the final content/header fixes.

Automated suite: `tools/widget-tests` (see its README for commands and precise
coverage). It exercises real React/CSS/renderers through synthetic HTTP responses.
Screenshots are reviewed in addition to rectangle assertions. Worker type generation,
TypeScript and the production Vite build are separate checks.

The browser matrix covers Home/editor/kiosk, mobile/desktop, all chart widths and
reload/rotation. Additional cases cover repeated drag cycles, mouse and native
Chromium touch input, cancellation, scrolling, keyboard-accessible arrow controls,
failed saves and configuration retention. Database durability is not implied by the
mocked API tests.

## Changed files

- `src/dashboard/dashboard.css`, `WidgetCard.tsx`, `layoutEditing.ts`,
  `useWidgetDrag.ts`: geometry, bounded content, controls and shared reorder logic.
- `src/HomePage.tsx`, `src/DisplaysPage.tsx`, `src/DisplayDashboard.tsx`: integration,
  grouped ordering, save protection and configured rendering.
- `src/widgets/widgetRegistry.tsx`, `src/widgets/unavailableWidget.tsx`: row metadata
  and preservation of unavailable saved instances.
- `src/displays.css`, `src/home.css`, `src/melcloud.css`: remove competing sizing and
  viewport-based widget content overrides.
- `AGENTS.md`, `docs/UI-GUIDE.md`, `docs/ARCHITECTURE.md`, this review: ownership rules,
  actual behavior and validation/manual follow-up.
- `tools/widget-tests/{dashboard.spec.ts,layout.spec.ts,fixtures.ts,
  playwright.config.ts,serve.mjs,package.json,package-lock.json,.gitignore,README.md}`:
  isolated regression suite and instructions.

## Manual checklist

1. On a physical Android phone and iPad, open an existing Home layout and a paired
   display. Check small controls, long titles and light/dark themes.
2. Use the mixed order: small metric, wide chart, medium weather, small metric, wide
   chart, medium forecast. Resize each chart through every size and back.
3. Drag before/after neighbors and to the last position repeatedly; drag to the
   viewport edge. Verify page scrolling away from the handle and internal list scroll.
4. Cancel a drag, rotate during a drag, and use arrow controls with keyboard focus.
5. Save, reload, switch between Home/Displays/kiosk and verify order/configuration.
   Repeat with a grouped Unraid container card and a five-link collection.
6. Disconnect the network during save; confirm the draft remains and retry works.
7. Inspect real long journal/list content, no-data states and stale source data.
   Content must remain accessible inside the card without resizing neighbors.

## Remaining limits

- Automated interaction coverage uses Chromium, including native touch emulation;
  physical Android/iPad and Safari/Firefox have not been validated here.
- Extra-long content can require internal scrolling. Kiosk layouts exceeding screen
  capacity scroll instead of shrinking primary data or hiding widgets.
- Drop targets are card halves; dropping in an empty grid gap cancels. Pointer drag
  uses edge feedback with no floating clone. Keyboard reordering uses the arrows.
- Existing last-writer-wins behavior across separate devices/tabs remains; there is
  no new cross-client conflict protocol. Production D1 persistence was not exercised.
