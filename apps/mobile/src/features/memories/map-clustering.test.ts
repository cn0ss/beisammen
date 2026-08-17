import { describe, expect, test } from 'vitest';

import {
  bucketedZoomDelta,
  clusterMapItems,
  isWithinRegion,
  regionForItems,
  zoomedRegionForCluster,
  type MapRegion,
} from './map-clustering';

const REGION: MapRegion = {
  latitude: 48.13,
  longitude: 11.58,
  latitudeDelta: 0.2,
  longitudeDelta: 0.2,
};

const ZOOM = { latitudeDelta: 0.2, longitudeDelta: 0.2 };
const MAP_SIZE = { width: 400, height: 800 };

function point(id: string, latitude: number, longitude: number, timelineAt = 0) {
  return { _id: id, latitude, longitude, timelineAt };
}

describe('isWithinRegion', () => {
  test('accepts points inside and rejects points outside the cutout', () => {
    expect(isWithinRegion(point('a', 48.13, 11.58), REGION)).toBe(true);
    expect(isWithinRegion(point('b', 48.2, 11.58), REGION)).toBe(true);
    expect(isWithinRegion(point('c', 48.5, 11.58), REGION)).toBe(false);
    expect(isWithinRegion(point('d', 48.13, 12.5), REGION)).toBe(false);
  });

  test('margin factor widens the accepted area', () => {
    expect(isWithinRegion(point('a', 48.25, 11.58), REGION)).toBe(false);
    expect(isWithinRegion(point('a', 48.25, 11.58), REGION, 1.4)).toBe(true);
  });
});

describe('bucketedZoomDelta', () => {
  test('absorbs small delta jitter after a pan', () => {
    expect(bucketedZoomDelta(0.2)).toBe(bucketedZoomDelta(0.203));
    expect(bucketedZoomDelta(0.2)).toBe(bucketedZoomDelta(0.198));
  });

  test('changes across real zoom steps', () => {
    expect(bucketedZoomDelta(0.2)).not.toBe(bucketedZoomDelta(0.05));
  });
});

describe('clusterMapItems', () => {
  test('groups nearby points and keeps distant points apart', () => {
    const items = [
      point('a', 48.13, 11.58, 1),
      point('b', 48.1301, 11.5801, 2),
      point('c', 48.2, 11.65, 3),
    ];
    const clusters = clusterMapItems(items, ZOOM, MAP_SIZE);

    expect(clusters).toHaveLength(2);
    const merged = clusters.find((cluster) => cluster.count === 2);
    expect(merged).toBeDefined();
    expect(merged!.newest._id).toBe('b');
  });

  test('keys clusters by their cover item so markers stay mounted across pans', () => {
    const items = [point('a', 48.13, 11.58, 1), point('b', 48.1301, 11.5801, 2)];
    const clusters = clusterMapItems(items, ZOOM, MAP_SIZE);

    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.key).toBe('b');
  });

  test('splits clusters apart when zooming in', () => {
    const items = [point('a', 48.13, 11.58, 1), point('b', 48.131, 11.581, 2)];
    const zoomedOut = clusterMapItems(items, ZOOM, MAP_SIZE);
    const zoomedIn = clusterMapItems(
      items,
      { latitudeDelta: 0.005, longitudeDelta: 0.005 },
      MAP_SIZE,
    );

    expect(zoomedOut).toHaveLength(1);
    expect(zoomedIn).toHaveLength(2);
  });

  test('clusters everything regardless of viewport — filtering is separate', () => {
    const items = [point('a', 48.13, 11.58), point('b', 50.9, 6.9)];
    const clusters = clusterMapItems(items, ZOOM, MAP_SIZE);

    expect(clusters).toHaveLength(2);
  });

  test('returns nothing before the map is measured', () => {
    expect(clusterMapItems([point('a', 48.13, 11.58)], ZOOM, { width: 0, height: 0 })).toEqual(
      [],
    );
  });
});

describe('zoomedRegionForCluster', () => {
  test('centers on the cluster and shrinks the deltas', () => {
    const zoomed = zoomedRegionForCluster({ latitude: 48.2, longitude: 11.6 }, REGION);

    expect(zoomed.latitude).toBe(48.2);
    expect(zoomed.longitude).toBe(11.6);
    expect(zoomed.latitudeDelta).toBeCloseTo(0.05);
  });
});

describe('regionForItems', () => {
  test('falls back when there are no items', () => {
    expect(regionForItems([], REGION)).toEqual(REGION);
  });

  test('frames all items with padding', () => {
    const region = regionForItems(
      [point('a', 48, 11), point('b', 49, 12)],
      REGION,
    );

    expect(region.latitude).toBeCloseTo(48.5);
    expect(region.longitude).toBeCloseTo(11.5);
    expect(region.latitudeDelta).toBeGreaterThan(1);
  });
});
