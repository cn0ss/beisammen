import type { NamedExoticComponent } from 'react';
import type { MemoryPlaceFacet } from '@/features/convex/api';

export declare const MemoryPlacesMap: NamedExoticComponent<{
  places: MemoryPlaceFacet[];
  selectedPlaceKey: string | null;
  onSelectPlace: (place: MemoryPlaceFacet) => void;
}>;
