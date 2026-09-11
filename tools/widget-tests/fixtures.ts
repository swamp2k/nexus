import type { Page } from '@playwright/test';
import type { LayoutItem } from '../../src/dashboard/layoutEditing';

export const mixedLayout: LayoutItem[] = [
  { id: 'energy.price.current', size: 'small' },
  { id: 'energy.price.next24h', size: 'wide' },
  { id: 'weather.current', size: 'medium' },
  { id: 'energy.price.todayRange', size: 'small' },
  { id: 'energy.usage.week', size: 'wide' },
  { id: 'weather.nextHours', size: 'medium' },
];

export async function mockApi(page: Page, initial = mixedLayout) {
  let home = structuredClone(initial);
  let display = structuredClone(initial);
  const dashboard = () => ({ id: 'test', name: 'Widget regression', theme: 'light', layout: display });
  await page.route('**/api/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/api/display/data/', '/api/');
    const now = Date.now();
    let body: unknown = {};
    if (path === '/api/auth/me') body = { authenticated: true, user: { id: 'test', email: 'test@example.invalid', displayName: 'Test', role: 'admin' } };
    else if (path === '/api/settings') body = { settings: {} };
    else if (path === '/api/navigation') body = { order: [] };
    else if (path === '/api/home-layout') {
      if (request.method() === 'PUT') home = request.postDataJSON().layout;
      body = { layout: home, isDefault: false, updatedAt: '2026-09-10' };
    } else if (path === '/api/display/dashboards/test') {
      if (request.method() === 'PUT') display = request.postDataJSON().layout;
      body = { dashboard: dashboard() };
    } else if (path === '/api/display/dashboards') body = { dashboards: [dashboard()] };
    else if (path === '/api/display/devices') body = { devices: [] };
    else if (path === '/api/display/me') body = { paired: true, device: { id: 'test' }, dashboard: dashboard() };
    else if (path.endsWith('/energy/prices')) body = { data: { intervals: Array.from({ length: 96 }, (_, i) => ({ timeUtc: new Date(now + (i - 1) * 900_000).toISOString(), totalDkkPerKwh: 1 + (i % 12) / 4 })) } };
    else if (path.endsWith('/energy/usage')) body = { stale: true, data: { days: Array.from({ length: 7 }, (_, i) => ({ date: `2026-09-0${i + 1}`, kwh: 5 + i * 2 })) } };
    else if (path.endsWith('/weather')) body = { data: { location: { label: 'Test town' }, current: { temperature: 19, symbol: 'cloudy', windSpeed: 3, windDirection: 120, precipitationMm: 0 }, hourly: Array.from({ length: 6 }, (_, i) => ({ time: new Date(now + i * 3600_000).toISOString(), temperature: 19 + i, symbol: 'cloudy', windSpeed: 3, windDirection: 120, precipitationMm: 0 })), daily: [] } };
    else { await route.fulfill({ status: 503, json: { error: 'fixture_unavailable' } }); return; }
    await route.fulfill({ json: body });
  });
  return { home: () => home, display: () => display };
}
