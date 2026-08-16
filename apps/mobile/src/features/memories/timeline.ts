const MEMORY_MONTH_FORMAT = new Intl.DateTimeFormat('de-DE', {
  month: 'long',
  year: 'numeric',
});

export type MemoryFilter =
  | {
      kind: 'month';
      key: string;
    }
  | {
      kind: 'place';
      key: string;
    };

export interface MemoryTimelineItem {
  _id: string;
  timelineAt: number;
}

export interface MemoryMonthSection<T extends MemoryTimelineItem> {
  key: string;
  title: string;
  items: T[];
}

function monthKey(timestamp: number): string {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');

  return `${year}-${month}`;
}

export function formatMemoryMonthFacetTitle(key: string): string {
  const match = key.match(/^(\d{4})-(\d{2})$/);

  if (!match) {
    return key;
  }

  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;

  if (!Number.isInteger(year) || monthIndex < 0 || monthIndex > 11) {
    return key;
  }

  return MEMORY_MONTH_FORMAT.format(new Date(Date.UTC(year, monthIndex, 1)));
}

export function normalizeMemoryFilter(filter?: MemoryFilter | null): MemoryFilter | null {
  if (!filter) {
    return null;
  }

  const key = filter.key.trim();

  if (!key) {
    return null;
  }

  return {
    kind: filter.kind,
    key,
  };
}

export function buildMemoryViewerHref(input: {
  memoryId: string;
  circleId?: string | null;
  filter?: MemoryFilter | null;
}): string {
  const params = [`memoryId=${encodeURIComponent(input.memoryId)}`];
  const filter = normalizeMemoryFilter(input.filter);

  if (input.circleId) {
    params.push(`circleId=${encodeURIComponent(input.circleId)}`);
  }

  if (filter) {
    params.push(`filterKind=${encodeURIComponent(filter.kind)}`);
    params.push(`filterKey=${encodeURIComponent(filter.key)}`);
  }

  return `/memories/viewer?${params.join('&')}`;
}

export function buildMemoryMonthSections<T extends MemoryTimelineItem>(
  items: T[],
): Array<MemoryMonthSection<T>> {
  const sections: Array<MemoryMonthSection<T>> = [];

  for (const item of items) {
    const key = monthKey(item.timelineAt);
    let section = sections[sections.length - 1];

    if (!section || section.key !== key) {
      section = {
        key,
        title: MEMORY_MONTH_FORMAT.format(new Date(item.timelineAt)),
        items: [],
      };
      sections.push(section);
    }

    section.items.push(item);
  }

  return sections;
}
