import { memo, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import MapView, { Marker } from 'react-native-maps';

import { FontSize, Radius, Spacing } from '@/constants/theme';
import type { MemoryPlaceFacet } from '@/features/convex/api';
import { useTheme } from '@/hooks/use-theme';

interface MemoryPlacesMapProps {
  places: MemoryPlaceFacet[];
  selectedPlaceKey: string | null;
  onSelectPlace: (place: MemoryPlaceFacet) => void;
}

export const MemoryPlacesMap = memo(function MemoryPlacesMap({
  onSelectPlace,
  places,
  selectedPlaceKey,
}: MemoryPlacesMapProps) {
  const theme = useTheme();
  const initialRegion = useMemo(() => {
    const first = places[0];

    if (!first) {
      return {
        latitude: 51.1657,
        longitude: 10.4515,
        latitudeDelta: 8,
        longitudeDelta: 8,
      };
    }

    return {
      latitude: first.latitude,
      longitude: first.longitude,
      latitudeDelta: 0.18,
      longitudeDelta: 0.18,
    };
  }, [places]);

  return (
    <View style={[styles.frame, { backgroundColor: theme.surfacePressed }]}>
      <MapView
        initialRegion={initialRegion}
        style={styles.map}
        showsUserLocation={false}
        showsMyLocationButton={false}
        toolbarEnabled={false}
      >
        {places.map((place) => {
          const isSelected = place.key === selectedPlaceKey;

          return (
            <Marker
              key={place.key}
              coordinate={{
                latitude: place.latitude,
                longitude: place.longitude,
              }}
              onPress={() => onSelectPlace(place)}
            >
              <View
                style={[
                  styles.marker,
                  {
                    backgroundColor: isSelected ? theme.primary : theme.surface,
                    borderColor: isSelected ? theme.primaryText : theme.primary,
                  },
                ]}
              >
                <Text
                  allowFontScaling={false}
                  style={[
                    styles.markerCount,
                    { color: isSelected ? theme.primaryText : theme.primary },
                  ]}
                >
                  {place.itemCount}
                </Text>
              </View>
            </Marker>
          );
        })}
      </MapView>
    </View>
  );
});

const styles = StyleSheet.create({
  frame: {
    height: 260,
    overflow: 'hidden',
    borderRadius: Radius.xl,
  },
  map: {
    width: '100%',
    height: '100%',
  },
  marker: {
    minWidth: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.xs,
  },
  markerCount: {
    fontSize: FontSize.xs,
    fontWeight: '900',
  },
});
