# Nexus UI guide

This is the design reference for every screen in Nexus: the desktop app, the same app on a phone, and the paired kiosk displays. It describes the system that exists in `src/` today. When a rule here and the code disagree, fix one of them in the same change.

`AGENTS.md` owns the product rules (compact, calm, information-dense, family-simple). This document says how those rules become pixels.

## 1. Principles

1. **The data is the interface.** Chrome exists to frame data, never to compete with it. One heading per page, one title per card, no explanatory hero panels.
2. **Compact and calm.** Density comes from small consistent spacing, not from small fonts. Do not solve an empty-space problem by shrinking everything.
3. **Predictable layout.** Stored order is visual order. Content decides height. Nothing is positioned by hand per widget.
4. **Three surfaces, one system.** Desktop, phone and kiosk share tokens, cards and charts. They differ only in column count, target size and what chrome is shown.
5. **Light and dark are equals.** Every colour comes from a token so both themes are designed, not derived.
6. **Truthful controls.** `›` navigates, `−/+` resize, arrows reorder in the direction they point, a chevron only opens something inline.

## 2. Tokens

All tokens live in `src/styles.css` on `:root` and `:root[data-theme="dark"]`. Components never hard-code a colour, radius or shadow.

| Token | Use |
|---|---|
| `--bg` | Page background |
| `--surface` | Cards, sidebar panels, inputs on `--bg` |
| `--surface-soft` | Tiles and chips inside a card, inputs inside a card |
| `--text`, `--muted-strong`, `--muted` | Primary text, secondary labels, tertiary captions and axes |
| `--border`, `--border-strong` | Dividers and card borders; strong for inputs and emphasis |
| `--accent`, `--accent-soft` | Links, active nav, primary buttons, default chart bars; soft for tinted backgrounds |
| `--success`, `--warning`, `--danger` | Status only. Never decorative |
| `--band-low`, `--band-medium`, `--band-high` | Price and usage bands in charts, legends and settings previews. `--band-medium-text` is the readable text variant of the amber |
| `--radius-lg` 22px, `--radius-md` 16px, `--radius-sm` 12px | Login card / cards and panels / inputs, buttons, tiles |
| `--shadow`, `--shadow-soft` | Floating surfaces / resting cards |

Tints are made with `color-mix(in srgb, var(--token) 12–16%, var(--surface))`, never with a second hex.

### Typography

Font: Inter with the system stack as fallback. Weights: 400 body, 700 secondary labels, 800 titles, buttons and emphasis, 900 brand and uppercase kickers.

| Role | Size | Notes |
|---|---|---|
| Page h1 | `clamp(1.8rem, 3vw, 2.1rem)` | Tight tracking `-0.035em`. The only h1 on a page |
| Card title (h3) | `0.95rem` / 800 | Single line, ellipsis |
| Big number | `clamp(1.65rem, 3vw, 2.35rem)` / 800 | Tracking `-0.045em`, line-height 1 |
| Body | `1rem` | Line-height 1.5 in prose |
| Label | `0.76–0.82rem` / 700 | `--muted-strong` when it names a value, `--muted` when it is a caption |
| Micro | `0.62–0.68rem` | Tile captions, legend chips, kicker text |
| Chart axis | `10px` fixed | Pixels on purpose. Chart text never scales with width |

Uppercase with letter-spacing `0.08–0.16em` is reserved for the brand word, section labels and editor kickers.

### Spacing

Use this scale: 4, 8, 10, 12, 14, 16, 18, 24, 28. Grid gap is 14. Card padding is 16 top/bottom, 18 sides. Compact entity cards use 11/13. Page sections stack with 14 to 18.

Numbers use Danish formatting: thousands separator `.`, decimal `,`, unit after a thin space (`19,6 kWh`, `2,14 kr`). Missing data is `—`, never `0` and never blank.

## 3. Surfaces and breakpoints

| Condition | App frame | Dashboard grid |
|---|---|---|
| Dashboard host > 900px | Sidebar follows the app viewport; content column max 1080 | 4 columns |
| Dashboard host ≤ 900px and viewport > 760px | Sidebar remains visible | 2 columns. `medium` and `wide` both span the row |
| Viewport ≤ 760px | Top bar with horizontal chip nav; avatar menu holds Settings and Log ud | 1 column, rows auto |
| Viewport ≤ 460px | Tighter paddings, full-width action buttons | Tiles collapse to 2 across |

For Home and the Displays editor preview, the 4/2-column decision is based on the **actual dashboard host width**, not the browser viewport. Sidebar and editor chrome therefore cannot leave a nominally four-column grid with unusably narrow cards. The kiosk (`/display`) ignores the app frame and sizes to its own screen. See section 8.

Page anatomy: an `h1` in `.app-header`, then content. There is no subheading under the page title. Explanations belong next to the control they explain, once.

## 4. Dashboard cards

Home, the Displays editor preview and paired displays all render `WidgetCard` (`src/dashboard/WidgetCard.tsx`) inside `.home-widget-grid`. Sizing lives only in `src/dashboard/dashboard.css`.

### Anatomy

```
┌─ header ─────────────────────────────────┐
│ Title                       Page › | −+←→× │   ← link when viewing, controls when editing
├──────────────────────────────────────────┤
│ content                                   │   ← centred number, or top-anchored fill
└──────────────────────────────────────────┘
```

- The header shows the title and either a drill-down link to the feature page or the edit controls. Never both. The source kicker (`GARMIN`, `STRØM`) appears only while editing, where the catalogue makes it useful.
- On cards ≤ 300px wide, edit controls have priority over the title. They are positioned over the right side of the header and may obscure part of the title rather than disappear, wrap or make the card overflow.
- Paired displays show no link and no kicker.
- Content is vertically centred by default. Anything that should use the whole card (charts, lists, chip groups) wraps itself in `.widget-fill`, which anchors to the top and grows.

### Sizes and rows

| Size | Desktop | Tablet | Phone |
|---|---|---|---|
| `small` | 1 of 4 columns | 1 of 2 | full |
| `medium` | 2 of 4 | full | full |
| `wide` | full row | full | full |

`rows` (1 or 2) is declared in the widget registry, not in CSS. Charts and lists claim 2 rows so two stacked number cards sit beside them; numbers claim 1. Rows are `minmax(150px, auto)`, so a card that needs more height takes it and its neighbours follow. Nothing is clipped, nothing overflows.

Rules that keep this working:

- Never `grid-auto-flow: dense`. Stored order is visual order, so the editor's arrows always do what they say. Accept an occasional gap; the editor preview shows exactly what the display will show, so gaps can be fixed by reordering.
- Never fixed-height rows and never `grid-row: span` keyed by widget ID in a stylesheet. If a widget needs two rows, set `rows: 2` in its registry entry.
- Never size `.home-widget` or `.chart-frame` outside `dashboard.css`. Widget stylesheets style their own content only.

### Size-aware content

Cards are container-query roots. Widget content adapts to the card's real width, not the viewport:

| Container width | Class of card | What changes |
|---|---|---|
| ≤ 300px | small | Detail line hidden, only the first 2 chips, 3 forecast tiles, chart 120px |
| 301–650px | medium | Journal hidden, 6 hour tiles / 7 day tiles, chart 150px |
| ≥ 651px | wide | Everything, chart 170px |

Hide tertiary detail before shrinking type. Do not add a new container query for one widget; use the existing three bands.

## 5. Widget content patterns

Use an existing pattern before inventing one. Class names are in `src/home.css`.

| Pattern | Class | Use for |
|---|---|---|
| Metric | `.home-metric` (`strong` value, `span` label, optional `small` detail) | One current value: price now, steps today, CPU |
| Three stats | `.home-three-stats` | Min / average / max of one series |
| Tiles | `.home-weather-hours`, `.home-weather-week` | Equal columns per hour or day with icon, value, two micro lines |
| Chips | `.home-wellbeing-metrics` | Several short label + value pairs (also used by Unraid system and disk temperatures) |
| List rows | `.home-waste-list` | 2 to 5 rows of icon, label, date. Use `--warning`/`--danger` tints for due states |
| Entity status | `.unraid-entity-status`, `.unraid-container-group` | Running / stopped dots with a name |
| Chart block | `.widget-fill` > `.chart-summary` + `.band-legend` + `ChartFrame` + `.chart-note` | Any bar or line chart |

Every widget renders exactly one of three states before data: `Henter …` while loading, `… kunne ikke hentes` on error, `Ingen …` when the source has nothing. Use `.home-widget-state` for all three. A stale cache is data, not an error: show it and add a `.chart-note` such as `Viser seneste kendte data`.

## 6. Charts

All SVG charts render through `ChartFrame` (`src/dashboard/ChartFrame.tsx`). The frame measures itself with a ResizeObserver and hands the chart its size in pixels.

Rules:

1. **CSS decides height.** Set `--chart-h` on the frame (or inherit the card's container-query value). Never derive height from a `viewBox` aspect ratio and never fix an SVG height in JSX.
2. **Draw in pixels.** Paddings, bar widths and text positions are pixel values computed from the measured `width` and `height`. Axis text is `10px` via `.chart-axis` and never scales.
3. **Label density comes from width.** Decide how many x labels to show from the slot width, for example one label per 36 to 40px, so labels never collide on a phone or crowd on a display.
4. **Fixed reference scales where comparison matters.** Electricity price is always 0 to 6 kr/kWh; usage rounds up to the next 10 kWh. Say so in the chart summary (`Fast skala 0–6 kr/kWh`).
5. **Colour by meaning.** Band colours use `.chart-bar--low/medium/high`; a single-series chart uses `.chart-bar--accent`. Grid lines are `--border`, the baseline is `--muted`.
6. **Hover gives the exact value** through an SVG `<title>` on each bar. Cursor tooltips are for the detailed feature pages, not for dashboard cards.
7. Minimum bar height is 2px so a zero day is still visible. Bars have `rx` 3 to 4.
8. Choose the form by the data: bars for discrete days or hours, a line for a continuous overnight signal, plain `div` bars (`.home-week-bars`) only when no axis is needed.

A chart block reads top to bottom: headline number and caption, band legend, chart, optional note. The headline answers the question; the chart shows the shape.

## 7. Editing dashboards

Home and Displays use the same pure edit functions (`src/dashboard/layoutEditing.ts`) and the same inline controls.

- `Rediger Hjem` switches Home into edit mode: dashed outlines, the catalogue panel above the grid, `Annuller` and `Gem layout` in the toolbar. Nothing is saved until `Gem`.
- Per card: `−` `+` step through the widget's supported sizes, arrows move it one place, `×` removes it. Disabled buttons stay visible so the boundary is obvious.
- Arrows are `←` `→` in multi-column layouts and `↑` `↓` in the one-column phone layout. Both glyph sets are in the markup; CSS shows the truthful pair.
- The catalogue offers the same widgets grouped by source, with a size select and up/down for keyboard and touch users. The Displays catalogue only lists sources the display data alias can serve.
- The Displays preview is drag-and-drop on desktop with the same buttons as fallback. The preview renders the same grid the kiosk will show.

## 8. Paired displays (kiosk)

`/display` is for a tablet on a wall or a kitchen counter, paired with an 8-digit code and no login.

- No sidebar, no user menu, no page heading. One header line: `NEXUS` and the dashboard name on the left, clock and date on the right, theme toggle at the end.
- The grid keeps 4 columns from 900px up regardless of the app breakpoint, uses 2 columns from 761–899px, and falls to 1 column at 760px and below. A landscape iPad therefore shows the same shape as a desktop without inheriting sidebar-driven app breakpoints.
- Rows are `minmax(140px, 1fr)`: the grid takes the remaining viewport and shares it between rows, so a display fills the screen. Charts grow into the extra height through `.widget-fill`. If a layout has more rows than fit, the page scrolls rather than clipping; the editor preview is the place to fix that.
- Big numbers scale up (`clamp(2rem, 3.4vw, 3rem)`) because the reader is further away. Nothing else changes size.
- Cards show no drill-down links and no kickers. Freshness belongs inside the widget (`Viser seneste kendte data`), not in the chrome.
- The dashboard's saved theme wins over the device preference. Auto-refresh follows the refresh classes in Settings.

## 9. Feature pages and Settings

- Settings is the density reference: `.settings-card` sections, `.settings-card-heading` with a small section label and an `h2`, forms in `.settings-form` with 18px gaps, collapsible sections for advanced or rarely used groups.
- Feature pages open with their most useful current value, then trends, then detail. The Strøm page is the example: current price hero, usage, breakdown, chart, day summaries.
- Use `.primary-action` for the one main action on a page and `.secondary-action` for the rest. Buttons are 40px tall; inline card controls are 30px.
- Do not repeat the page description under the title. Do not add a "planlagt" placeholder card for something that does not exist yet beyond the single existing placeholder pattern.

## 10. Theme, accessibility, touch

- Test every change in light and dark. If a colour only looks right in one theme, the token is wrong, not the component.
- Icon-only buttons carry an `aria-label`. Charts carry `role="img"` and a Danish `aria-label` describing what is drawn.
- Primary touch targets are at least 40px. Dashboard edit controls are 30px (27px in small cards) and only appear in edit mode.
- Prefer native elements: `<details>` for collapsibles and the user menu, `<select>` for size choice, `<button type="button">` everywhere a click does something.
- Respect the viewport: wide content scrolls inside its own container, the page never scrolls horizontally.

## 11. Where styles live

| File | Owns |
|---|---|
| `src/styles.css` | Tokens, app frame, sidebar, header, login, footer |
| `src/dashboard/dashboard.css` | Grid, card, header, edit controls, chart frame, container queries, dashboard breakpoints |
| `src/home.css` | Home toolbar, editor catalogue, action buttons, widget content patterns |
| `src/displays.css`, `src/display-pairing.css` | Displays page frame, kiosk shell, pairing screen |
| `src/<module>.css` | That module's page and its own widget content (`calendar.css` owns `.home-waste-*`, `melcloud.css` owns `.home-heatpump-*`, `unraid.css` owns `.unraid-*`) |
| `src/audit-polish.css` | Small cross-page overrides from the Air Audit. Prefer moving a rule into its owner file over adding here |

One concern has one owner. A stylesheet never re-sizes another module's elements, and no shared file selects by `data-widget-id`.

## 12. Checklist for a UI change

- [ ] Colours, radii and shadows come from tokens; no new hex outside `styles.css`.
- [ ] Looks right in light and dark.
- [ ] Verified at 1280 and ~1100 app widths, 1024 kiosk, 900 and 390 wide. Nothing overflows its card; small-card edit controls remain usable; the page has no horizontal scroll.
- [ ] A new widget has `defaultSize`, `supportedSizes`, `rows` and a `refreshGroup` if its group label is not a settings key.
- [ ] A new chart uses `ChartFrame`, pixel coordinates and `.chart-axis` text.
- [ ] Loading, error, empty and stale states are all present and use the standard wording.
- [ ] No page subheading, no duplicate labels in a card header, no hero panel.
- [ ] Edit controls still say the truth in one-column layouts.
- [ ] `npm run check` and `npm run build` pass.
