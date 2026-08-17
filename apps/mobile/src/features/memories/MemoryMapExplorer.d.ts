import type { NamedExoticComponent } from 'react';
import type { LocatedMemoryItem } from '@/features/memories/use-located-memory-items';

export declare const MemoryMapExplorer: NamedExoticComponent<{
  items: LocatedMemoryItem[] | undefined;
  onOpenMemory: (item: LocatedMemoryItem) => void;
}>;
