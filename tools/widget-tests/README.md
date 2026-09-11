# Widget regression tests

Run from the repository root after installing the application's dependencies:

```sh
npm ci --prefix tools/widget-tests
cd tools/widget-tests
npx playwright install chromium
npm test
```

On Windows with PowerShell execution policy restrictions, use `npm.cmd` and `npx.cmd`.
An existing Chromium executable can be selected with `WIDGET_TEST_BROWSER`.
The test dependencies and lockfile are isolated here; no production dependency is added.

The suite serves the real app with Vite on `127.0.0.1:5178`. Every API request is
intercepted with synthetic data. It never starts Worker bindings or reads/writes D1.
The in-memory API retains PUT payloads across reloads, testing the client persistence
contract, not production database durability or authentication.

Coverage includes Home, the Displays editor and `/display`/`/display/kitchen`, six
viewport widths (320, 390, 768, 900, 1024, 1280), all chart sizes, rotations,
card/chart/content bounds, usable controls, responsive forecast columns, mouse and
native Chromium touch dragging, before/after insertion, cancellation, normal touch
scroll, arrow fallback, repeated first-to-last moves, failed-save recovery and
preservation of configured/unavailable widgets. Pure tests cover grouped container
movement and immutable configuration preservation.

Screenshots are generated in `test-results/`; failures also retain Playwright traces.
The dark screenshots capture each editor's widget grid. These are regression
artifacts for visual review, not screenshot-baseline comparisons.

Physical Android Chrome and iPad Safari checks remain part of the manual checklist
in `docs/WIDGET-SYSTEM-REVIEW.md`.
