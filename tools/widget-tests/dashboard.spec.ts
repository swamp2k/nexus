import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { mixedLayout, mockApi } from './fixtures';

const cards = (page: Page) => page.locator('.home-widget-grid > .home-widget');
const card = (page: Page, id: string) => page.locator(`.home-widget-grid > [data-widget-id="${id}"]`);
const order = (page: Page) => cards(page).evaluateAll(nodes => nodes.map(n => n.getAttribute('data-widget-id')));

async function bounds(page: Page) {
  await expect(page.locator('.chart-frame svg')).toHaveCount(2);
  // ResizeObserver and React each need a frame to settle after grid changes.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const errors = await cards(page).evaluateAll(nodes => nodes.flatMap(node => {
    const errors: string[] = [];
    const box = node.getBoundingClientRect();
    const id = node.getAttribute('data-widget-id');
    const grid = node.parentElement!.getBoundingClientRect();
    if (box.left < grid.left - 1 || box.right > grid.right + 1) errors.push(`${id}: outside grid`);
    const expected = node.classList.contains('home-widget--rows-2') ? 314 : 150;
    if (Math.abs(box.height - expected) > 1) errors.push(`${id}: height ${box.height}, expected ${expected}`);
    const content = node.querySelector('.home-widget-content')!;
    if (content.querySelector('.home-metric, .home-weather, .home-three-stats, .home-weather-hours') && content.scrollHeight > content.clientHeight + 1) errors.push(`${id}: primary content needs scrolling (${content.scrollHeight}/${content.clientHeight})`);
    const forecast = content.querySelector('.home-weather-hours');
    if (forecast) {
      const expectedColumns = content.clientWidth <= 650 ? 3 : 6;
      if (getComputedStyle(forecast).gridTemplateColumns.split(' ').length !== expectedColumns) errors.push(`${id}: responsive forecast overridden`);
    }
    for (const frame of node.querySelectorAll('.chart-frame')) {
      const rect = frame.getBoundingClientRect();
      const content = node.querySelector('.home-widget-content')!.getBoundingClientRect();
      const svg = frame.querySelector('svg')!.getBoundingClientRect();
      if (rect.bottom > box.bottom - 10 || rect.top < box.top || rect.height < 80) errors.push(`${id}: chart overflow/height`);
      if (Math.abs(rect.width - content.width) > 1) errors.push(`${id}: chart does not fill width`);
      if (Math.abs(svg.height - rect.height) > 1 || Math.abs(svg.width - rect.width) > 1) errors.push(`${id}: SVG/frame mismatch`);
      const fill = frame.parentElement!.getBoundingClientRect();
      if (Math.abs(fill.bottom - content.bottom) > 2) errors.push(`${id}: phantom space ${content.bottom - fill.bottom}`);
    }
    for (const button of node.querySelectorAll('.home-widget-direct-controls button')) {
      const rect = button.getBoundingClientRect();
      if (rect.left < box.left || rect.right > box.right || rect.top < box.top || rect.bottom > box.bottom) errors.push(`${id}: control clipped`);
    }
    return errors;
  }));
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
}

async function openEditor(page: Page, mode: 'home' | 'editor') {
  await page.goto('/');
  if (mode === 'home') await page.getByRole('button', { name: 'Rediger Hjem', exact: true }).click();
  else await page.locator('nav button:visible').filter({ hasText: 'Displays' }).first().click();
  await expect(cards(page)).toHaveCount(6);
}

for (const width of [320, 390, 768, 900, 1024, 1280]) {
  for (const mode of ['home', 'editor', 'display'] as const) {
    test(`${mode} bounds, all chart sizes, reload and rotation at ${width}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 1000 });
      const api = await mockApi(page);
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      if (mode === 'display') await page.goto('/display/kitchen');
      else await openEditor(page, mode);
      await bounds(page);
      if (mode !== 'display') {
        const chart = card(page, 'energy.price.next24h');
        const unchanged = await card(page, 'energy.price.current').boundingBox();
        for (const title of ['Mindre', 'Mindre', 'Større', 'Større']) {
          await chart.getByTitle(title, { exact: true }).click();
          await bounds(page);
          const now = await card(page, 'energy.price.current').boundingBox();
          expect(now!.width).toBeCloseTo(unchanged!.width, 1);
          expect(now!.height).toBeCloseTo(unchanged!.height, 1);
        }
        await page.getByRole('button', { name: mode === 'home' ? 'Gem layout' : 'Gem dashboard', exact: true }).click();
        await expect.poll(() => mode === 'home' ? api.home() : api.display()).toEqual(mixedLayout);
        if (mode === 'editor') await page.goto('/display');
        else await page.reload();
        await bounds(page);
      }
      await page.screenshot({ path: testInfo.outputPath(`${mode}-${width}.png`), fullPage: true });
      await page.setViewportSize({ width: width === 390 ? 1280 : 390, height: 1000 });
      await bounds(page);
      await page.setViewportSize({ width, height: 1000 });
      await bounds(page);
      expect(errors).toEqual([]);
    });
  }
}

for (const mode of ['home', 'editor'] as const) {
  test(`${mode} pointer reorder stays stationary, drops both sides, saves and reloads`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1000 });
    const api = await mockApi(page);
    await openEditor(page, mode);
    // Scroll the dashboard into view, leaving enough room for the next row.
    await page.locator('.home-widget-grid').evaluate(node => window.scrollTo(0, node.getBoundingClientRect().top + scrollY - 40));
    const initial = await order(page);
    const source = cards(page).first();
    const target = cards(page).nth(1);
    const handle = await source.locator('.widget-drag-handle').boundingBox();
    const targetBox = await target.boundingBox();
    const before = await cards(page).evaluateAll(nodes => nodes.map(n => ({ id: n.getAttribute('data-widget-id'), width: n.getBoundingClientRect().width, height: n.getBoundingClientRect().height })));
    await page.mouse.move(handle!.x + 10, handle!.y + 10);
    await page.mouse.down();
    await page.mouse.move(targetBox!.x + targetBox!.width - 25, targetBox!.y + 80, { steps: 8 });
    await expect(target).toHaveClass(/widget-drop--after/);
    expect(await order(page)).toEqual(initial);
    expect(await cards(page).evaluateAll(nodes => nodes.map(n => ({ id: n.getAttribute('data-widget-id'), width: n.getBoundingClientRect().width, height: n.getBoundingClientRect().height })))).toEqual(before);
    await page.mouse.up();
    await expect.poll(() => order(page)).toEqual([initial[1], initial[0], ...initial.slice(2)]);
    // A before-target drop restores order, including moving the final item.
    const movedHandle = await card(page, initial[0]!).locator('.widget-drag-handle').boundingBox();
    const firstBox = await cards(page).first().boundingBox();
    await page.mouse.move(movedHandle!.x + 10, movedHandle!.y + 10); await page.mouse.down();
    await page.mouse.move(firstBox!.x + 10, firstBox!.y + 70, { steps: 8 });
    await expect(cards(page).first()).toHaveClass(/widget-drop--before/);
    await page.mouse.up();
    await expect.poll(() => order(page)).toEqual(initial);
    const h = await cards(page).first().locator('.widget-drag-handle').boundingBox();
    await page.mouse.move(h!.x + 10, h!.y + 10); await page.mouse.down();
    await page.mouse.move(h!.x + 30, h!.y + 50);
    await page.keyboard.press('Escape'); await page.mouse.up();
    expect(await order(page)).toEqual(initial);
    await cards(page).first().getByTitle('Flyt senere', { exact: true }).click();
    const expected = await order(page);
    await page.getByRole('button', { name: mode === 'home' ? 'Gem layout' : 'Gem dashboard', exact: true }).click();
    await expect.poll(() => (mode === 'home' ? api.home() : api.display()).map(x => x.id)).toEqual(expected);
    await page.reload();
    if (mode === 'editor') await page.locator('nav button:visible').filter({ hasText: 'Displays' }).first().click();
    await expect.poll(() => order(page)).toEqual(expected);
    await bounds(page);
  });
}

for (const mode of ['home', 'editor'] as const) test(`${mode} native touch drag, cancellation, normal page scroll and dark theme`, async ({ browser }, testInfo) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 900 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  await mockApi(page);
  await openEditor(page, mode);
  await page.locator('.home-widget-grid').evaluate(node => window.scrollTo(0, node.getBoundingClientRect().top + scrollY - 40));
  const initial = await order(page);
  const handle = await cards(page).first().locator('.widget-drag-handle').boundingBox();
  const target = await cards(page).nth(1).boundingBox();
  const cdp = await context.newCDPSession(page);
  const touch = (type: string, x = 0, y = 0) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' || type === 'touchCancel' ? [] : [{ x, y, id: 1 }] });
  const scroll = await page.evaluate(() => scrollY);
  await touch('touchStart', handle!.x + 10, handle!.y + 10);
  await touch('touchMove', target!.x + 30, target!.y + target!.height - 25);
  await expect(cards(page).nth(1)).toHaveClass(/widget-drop--after/);
  await touch('touchEnd');
  await expect.poll(() => order(page)).toEqual([initial[1], initial[0], ...initial.slice(2)]);
  expect(await page.evaluate(() => scrollY)).toBe(scroll);
  const nextHandle = await cards(page).first().locator('.widget-drag-handle').boundingBox();
  const secondBox = await cards(page).nth(1).boundingBox();
  const after = await order(page);
  await touch('touchStart', nextHandle!.x + 10, nextHandle!.y + 10);
  await touch('touchMove', secondBox!.x + 30, secondBox!.y + 50);
  await touch('touchCancel');
  expect(await order(page)).toEqual(after);
  await expect(page.locator('.is-dragging')).toHaveCount(0);
  // Outside the handle a touch swipe still scrolls normally.
  const oldScroll = await page.evaluate(() => scrollY);
  await touch('touchStart', 350, 700);
  for (const y of [650, 600, 550, 500]) await touch('touchMove', 350, y);
  await touch('touchEnd');
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(oldScroll);
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  await bounds(page);
  await page.locator('.home-widget-grid').screenshot({ path: testInfo.outputPath('touch-dark.png') });
  await context.close();
});

test('configured and unavailable widgets survive reorder, failed save, retry and reload', async ({ page }) => {
  const configured = { id: 'links.collection.test', type: 'links.collection', size: 'small' as const, config: { title: 'Family links', links: [{ id: 'one', label: 'Example', url: 'https://example.com' }] } };
  const unavailable = { id: 'future.widget', size: 'medium' as const, config: { keep: ['unchanged'] } };
  const api = await mockApi(page, [configured, unavailable, ...mixedLayout]);
  await page.goto('/');
  await page.getByRole('button', { name: 'Rediger Hjem', exact: true }).click();
  await expect(card(page, unavailable.id)).toContainText('Indstillingerne er bevaret');
  await card(page, configured.id).getByTitle('Flyt senere', { exact: true }).click();
  await page.route('**/api/home-layout', async route => {
    if (route.request().method() === 'PUT') await route.fulfill({ status: 503, json: { error: 'test_failure' } });
    else await route.fallback();
  });
  const expected = await order(page);
  await page.getByRole('button', { name: 'Gem layout', exact: true }).click();
  await expect(page.locator('.home-layout-note--error')).toBeVisible();
  expect(await order(page)).toEqual(expected);
  await page.unroute('**/api/home-layout');
  await page.getByRole('button', { name: 'Gem layout', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Rediger Hjem', exact: true })).toBeVisible();
  expect(api.home().find(x => x.id === configured.id)).toEqual(configured);
  expect(api.home().find(x => x.id === unavailable.id)).toEqual(unavailable);
  await page.reload();
  await expect.poll(() => order(page)).toEqual(expected);
  await expect(card(page, configured.id)).toContainText('Family links');
});

test('kiosk small/medium/wide charts have the same row contract', async ({ page }) => {
  for (const size of ['small', 'medium', 'wide'] as const) {
    await page.unroute('**/api/**');
    await mockApi(page, mixedLayout.map(item => item.id === 'energy.price.next24h' || item.id === 'energy.usage.week' ? { ...item, size } : item));
    for (const width of [390, 1024]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/display');
      await bounds(page);
    }
  }
});

test('repeated first-to-last drags preserve dimensions and visual saved order', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1800 });
  const api = await mockApi(page);
  await openEditor(page, 'home');
  await page.locator('.home-widget-grid').evaluate(node => window.scrollTo(0, node.getBoundingClientRect().top + scrollY - 40));
  const initial = await order(page);
  for (let i = 0; i < 12; i++) {
    const current = await order(page);
    const handle = await cards(page).first().locator('.widget-drag-handle').boundingBox();
    const target = await cards(page).last().boundingBox();
    await page.mouse.move(handle!.x + 10, handle!.y + 10); await page.mouse.down();
    await page.mouse.move(target!.x + target!.width - 15, target!.y + 70, { steps: 6 });
    await expect(cards(page).last()).toHaveClass(/widget-drop--after/);
    await page.mouse.up();
    await expect.poll(() => order(page)).toEqual([...current.slice(1), current[0]]);
    await bounds(page);
  }
  expect(await order(page)).toEqual(initial);
  await page.getByRole('button', { name: 'Gem layout', exact: true }).click();
  await expect.poll(() => api.home()).toEqual(mixedLayout);
  await page.reload();
  await expect.poll(() => order(page)).toEqual(initial);
});

test('Display failed save retains the draft, blocks edits while pending, and allows retry', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  const api = await mockApi(page);
  await openEditor(page, 'editor');
  await cards(page).first().getByTitle('Flyt senere', { exact: true }).click();
  const expected = await order(page);
  let release: () => void = () => {};
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/display/dashboards/test', async route => {
    await pending;
    await route.abort('failed');
  });
  await page.getByRole('button', { name: 'Gem dashboard', exact: true }).click();
  await expect(page.locator('.displays-page')).toHaveAttribute('inert', '');
  release();
  await expect(page.locator('.home-layout-note')).toContainText('Dine ændringer er bevaret');
  expect(await order(page)).toEqual(expected);
  await page.unroute('**/api/display/dashboards/test');
  await page.getByRole('button', { name: 'Gem dashboard', exact: true }).click();
  await expect.poll(() => api.display().map(x => x.id)).toEqual(expected);
  await page.goto('/display');
  await expect.poll(() => order(page)).toEqual(expected);
});
