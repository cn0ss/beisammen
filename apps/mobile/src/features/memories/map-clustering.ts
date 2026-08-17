/**
 * Screen-space grid clustering for the memories map, in the spirit of Apple
 * Photos: markers merge into counted stacks while zoomed out and split apart
 * as the region shrinks. Pure functions so the grouping is unit-testable.
 *
 * Stability matters more than precision here: clusters are computed from a
 * zoom bucket (not the exact viewport), and each cluster is keyed by its cover
 * item. Panning therefore never regroups or remounts markers — only crossing
 * a zoom bucket does — which keeps marker thumbnails from flickering.
 */

export interface MapRegion {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
}

export interface MapClusterPoint {
  _id: string;
  latitude: number;
  longitude: number;
  timelineAt: number;
}

export interface MapCluster<T extends MapClusterPoint> {
  /** The cover item's id — stable across pans and small zoom jitter. */
  key: string;
  latitude: number;
  longitude: number;
  count: number;
  /** Most recent item — its preview is the marker thumbnail. */
  newest: T;
}

/** Items get clustered when their markers would overlap within this many px. */
const CLUSTER_CELL_PX = 76;

/**
 * Snaps a region delta to half-log2 steps, so tiny delta jitter from the map
 * settling after a pan never triggers a re-cluster.
 */
export function bucketedZoomDelta(delta: number): number {
  return 2 ** (Math.round(Math.log2(Math.max(delta, 1e-5)) * 2) / 2);
}

export function isWithinRegion(
  point: { latitude: number; longitude: number },
  region: MapRegion,
  marginFactor = 1,
): boolean {
  const latSpan = (region.latitudeDelta / 2) * marginFactor;
  const lngSpan = (region.longitudeDelta / 2) * marginFactor;

  return (
    Math.abs(point.latitude - region.latitude) <= latSpan &&
    Math.abs(point.longitude - region.longitude) <= lngSpan
  );
}

export function clusterMapItems<T extends MapClusterPoint>(
  items: T[],
  zoom: { latitudeDelta: number; longitudeDelta: number },
  mapSize: { width: number; height: number },
): MapCluster<T>[] {
  if (mapSize.width <= 0 || mapSize.height <= 0) {
    return [];
  }

  const cellLat = Math.max(zoom.latitudeDelta * (CLUSTER_CELL_PX / mapSize.height), 1e-6);
  const cellLng = Math.max(zoom.longitudeDelta * (CLUSTER_CELL_PX / mapSize.width), 1e-6);
  const cells = new Map<string, { latSum: number; lngSum: number; count: number; newest: T }>();

  for (const item of items) {
    const key = `${Math.floor(item.latitude / cellLat)}:${Math.floor(item.longitude / cellLng)}`;
    const cell = cells.get(key);

    if (!cell) {
      cells.set(key, {
        latSum: item.latitude,
        lngSum: item.longitude,
        count: 1,
        newest: item,
      });
      continue;
    }

    cell.latSum += item.latitude;
    cell.lngSum += item.longitude;
    cell.count += 1;

    if (item.timelineAt > cell.newest.timelineAt) {
      cell.newest = item;
    }
  }

  return [...cells.values()].map((cell) => ({
    key: cell.newest._id,
    latitude: cell.latSum / cell.count,
    longitude: cell.lngSum / cell.count,
    count: cell.count,
    newest: cell.newest,
  }));
}

/** Region that zooms into a pressed cluster, splitting it on the next render. */
export function zoomedRegionForCluster(
  cluster: { latitude: number; longitude: number },
  region: MapRegion,
): MapRegion {
  return {
    latitude: cluster.latitude,
    longitude: cluster.longitude,
    latitudeDelta: Math.max(region.latitudeDelta / 4, 0.0005),
    longitudeDelta: Math.max(region.longitudeDelta / 4, 0.0005),
  };
}

/** Region that frames every located item, for the map's initial camera. */
export function regionForItems(
  items: Array<{ latitude: number; longitude: number }>,
  fallback: MapRegion,
): MapRegion {
  if (items.length === 0) {
    return fallback;
  }

  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;

  for (const item of items) {
    minLat = Math.min(minLat, item.latitude);
    maxLat = Math.max(maxLat, item.latitude);
    minLng = Math.min(minLng, item.longitude);
    maxLng = Math.max(maxLng, item.longitude);
  }

  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta: Math.max((maxLat - minLat) * 1.4, 0.02),
    longitudeDelta: Math.max((maxLng - minLng) * 1.4, 0.02),
  };
}
