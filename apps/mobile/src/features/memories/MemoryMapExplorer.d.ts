import type { NamedExoticComponent } from 'react';
import type { MemoryMapItem } from '@/features/convex/api';

export declare const MemoryMapExplorer: NamedExoticComponent<{
  items: MemoryMapItem[] | undefined;
  onOpenMemory: (item: MemoryMapItem) => void;
}>;
