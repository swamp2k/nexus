import { test, expect } from '@playwright/test';
import { changeSize, moveVisualWidget, normalizeLayout, stepVisualWidget } from '../../src/dashboard/layoutEditing';

test('group movement follows visual order and preserves instance configuration', () => {
  const layout = [
    { id: 'a', size: 'small' as const, type: 'links', config: { title: 'Keep me', links: [{ url: 'https://example.com' }] } },
    { id: 'container.1', size: 'medium' as const },
    { id: 'b', size: 'wide' as const },
    { id: 'container.2', size: 'medium' as const },
    { id: 'c', size: 'small' as const },
  ];
  const visualId = (id: string) => id.startsWith('container.') ? 'group' : id;
  const moved = stepVisualWidget(layout, 'b', -1, visualId);
  expect(moved.map(x => x.id)).toEqual(['a', 'b', 'container.1', 'container.2', 'c']);
  expect(moveVisualWidget(layout, 'group', 'c', true, visualId).map(x => x.id)).toEqual(['a', 'b', 'c', 'container.1', 'container.2']);
  expect(moveVisualWidget(layout, 'a', 'c', true, visualId).at(-1)).toBe(layout[0]);
  expect(moveVisualWidget(layout, 'a', 'a', true, visualId)).toBe(layout);
  expect(moveVisualWidget(layout, 'missing', 'c', true, visualId)).toBe(layout);
  expect(stepVisualWidget(layout, 'a', -1, visualId)).toBe(layout);
  expect(JSON.parse(JSON.stringify(moved)).find(x => x.id === 'a')).toEqual(layout[0]);
  expect(normalizeLayout(layout, () => undefined)).toEqual(layout);
  expect(changeSize(layout, 'a', 'wide', () => undefined)).toBe(layout);
});
