import { describe, expect, test } from 'vitest';

import {
  buildMemoryMonthSections,
  buildMemoryViewerHref,
  formatMemoryMonthFacetTitle,
  normalizeMemoryFilter,
} from './timeline';

describe('memory timeline grouping', () => {
  test('groups memories by month while preserving item order', () => {
    const sections = buildMemoryMonthSections([
      {
        _id: 'memory-1',
        timelineAt: Date.parse('2026-04-18T09:30:00.000Z'),
      },
      {
        _id: 'memory-2',
        timelineAt: Date.parse('2026-04-02T12:00:00.000Z'),
      },
      {
        _id: 'memory-3',
        timelineAt: Date.parse('2026-03-30T18:45:00.000Z'),
      },
    ]);

    expect(sections).toEqual([
      {
        key: '2026-04',
        title: 'April 2026',
        items: [
          expect.objectContaining({ _id: 'memory-1' }),
          expect.objectContaining({ _id: 'memory-2' }),
        ],
      },
      {
        key: '2026-03',
        title: 'März 2026',
        items: [expect.objectContaining({ _id: 'memory-3' })],
      },
    ]);
  });

  test('formats month facets and normalizes memory filters', () => {
    expect(formatMemoryMonthFacetTitle('2026-04')).toBe('April 2026');
    expect(formatMemoryMonthFacetTitle('bad-key')).toBe('bad-key');
    expect(normalizeMemoryFilter({ kind: 'month', key: '2026-04' })).toEqual({
      kind: 'month',
      key: '2026-04',
    });
    expect(normalizeMemoryFilter({ kind: 'place', key: ' 52.520:13.405 ' })).toEqual({
      kind: 'place',
      key: '52.520:13.405',
    });
    expect(normalizeMemoryFilter({ kind: 'place', key: ' ' })).toBeNull();
  });

  test('builds memory viewer hrefs with circle and filter context', () => {
    expect(
      buildMemoryViewerHref({
        memoryId: 'memory 1',
        circleId: 'circle/1',
        filter: { kind: 'place', key: '52.520:13.405' },
      }),
    ).toBe(
      '/memories/viewer?memoryId=memory%201&circleId=circle%2F1&filterKind=place&filterKey=52.520%3A13.405',
    );
  });
});
