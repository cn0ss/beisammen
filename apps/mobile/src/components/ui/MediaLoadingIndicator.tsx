import { ActivityIndicator, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { Radius } from '@/constants/theme';
import { enterScreen, exitFade } from '@/lib/motion';

/**
 * Centered glass spinner over a media area, shown while a slide loads or
 * rebuffers. The entrance is delayed so fast loads and sub-200ms stalls never
 * flash it; the exit is a quick fade. Matches the viewer chrome's glass
 * button surfaces, so it works on posters, photos, and plain black alike.
 */
export function MediaLoadingIndicator({ visible }: { visible: boolean }) {
  if (!visible) {
    return null;
  }

  return (
    <Animated.View
      entering={enterScreen().delay(200)}
      exiting={exitFade()}
      pointerEvents="none"
      style={styles.overlay}
    >
      <View style={styles.circle}>
        <ActivityIndicator size="small" color="#FFFFFF" />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  circle: {
    width: 52,
    height: 52,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(22,22,24,0.55)',
  },
});
