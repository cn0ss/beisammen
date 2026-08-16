import type { ExpoConfig } from 'expo/config';

const publicEnv = {
  EXPO_PUBLIC_APP_ENV: process.env.EXPO_PUBLIC_APP_ENV ?? 'development',
  EXPO_PUBLIC_APP_SCHEME: process.env.EXPO_PUBLIC_APP_SCHEME ?? 'beisammen',
  EXPO_PUBLIC_DEFAULT_INSTANCE_ID: process.env.EXPO_PUBLIC_DEFAULT_INSTANCE_ID ?? '',
  EXPO_PUBLIC_DEFAULT_INSTANCE_NAME: process.env.EXPO_PUBLIC_DEFAULT_INSTANCE_NAME ?? '',
  EXPO_PUBLIC_DEFAULT_INSTANCE_URL: process.env.EXPO_PUBLIC_DEFAULT_INSTANCE_URL ?? '',
  EXPO_PUBLIC_DEFAULT_CONVEX_URL: process.env.EXPO_PUBLIC_DEFAULT_CONVEX_URL ?? '',
  EXPO_PUBLIC_DEFAULT_AUTH_MODE: process.env.EXPO_PUBLIC_DEFAULT_AUTH_MODE ?? '',
  EXPO_PUBLIC_DEFAULT_DEPLOYMENT_KIND:
    process.env.EXPO_PUBLIC_DEFAULT_DEPLOYMENT_KIND ?? '',
  EXPO_PUBLIC_DEFAULT_AUTH_CLIENT_ID:
    process.env.EXPO_PUBLIC_DEFAULT_AUTH_CLIENT_ID ?? '',
  EXPO_PUBLIC_DEFAULT_AUTH_SIGN_IN_URL:
    process.env.EXPO_PUBLIC_DEFAULT_AUTH_SIGN_IN_URL ?? '',
  EXPO_PUBLIC_EAS_PROJECT_ID: process.env.EXPO_PUBLIC_EAS_PROJECT_ID ?? '',
  EXPO_PUBLIC_LOG_LEVEL: process.env.EXPO_PUBLIC_LOG_LEVEL ?? '',
} as const;

const scheme = publicEnv.EXPO_PUBLIC_APP_SCHEME;
const easProjectId = publicEnv.EXPO_PUBLIC_EAS_PROJECT_ID.trim();
const mapsPluginConfig = {
  ...(process.env.GOOGLE_MAPS_ANDROID_API_KEY
    ? { androidGoogleMapsApiKey: process.env.GOOGLE_MAPS_ANDROID_API_KEY }
    : {}),
  ...(process.env.GOOGLE_MAPS_IOS_API_KEY
    ? { iosGoogleMapsApiKey: process.env.GOOGLE_MAPS_IOS_API_KEY }
    : {}),
};

const config: ExpoConfig = {
  name: 'beisammen',
  slug: 'beisammen-mobile',
  version: '0.1.0',
  scheme,
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  icon: './assets/images/icon.png',
  ios: {
    supportsTablet: true,
    bundleIdentifier: 'app.beisammen.app',
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    package: 'app.beisammen.app',
    adaptiveIcon: {
      backgroundColor: '#f4f1ea',
      foregroundImage: './assets/images/android-icon-foreground.png',
      backgroundImage: './assets/images/android-icon-background.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
    },
  },
  web: {
    output: 'static',
    favicon: './assets/images/favicon.png',
  },
  plugins: [
    'expo-dev-client',
    'expo-image',
    'expo-notifications',
    'expo-router',
    'expo-secure-store',
    'expo-sharing',
    'expo-status-bar',
    'expo-video',
    'expo-web-browser',
    [
      'expo-location',
      {
        locationWhenInUsePermission:
          'beisammen kann optional deinen aktuellen Standort nutzen, um Medien ohne eingebettete GPS-Daten mit einem Ort zu ergänzen.',
      },
    ],
    Object.keys(mapsPluginConfig).length > 0
      ? [
          'react-native-maps',
          mapsPluginConfig,
        ]
      : 'react-native-maps',
    'react-native-compressor',
    [
      'expo-image-picker',
      {
        photosPermission:
          'beisammen benötigt Zugriff auf deine Fotos, um sie mit deinem Circle zu teilen.',
        cameraPermission:
          'beisammen benötigt Zugriff auf deine Kamera, um Fotos aufzunehmen.',
        microphonePermission:
          'beisammen benötigt Zugriff auf dein Mikrofon, um Videos aufzunehmen.',
      },
    ],
    [
      'expo-media-library',
      {
        isAccessMediaLocationEnabled: true,
        photosPermission:
          'beisammen benötigt Zugriff auf deine Mediathek, um gespeicherte Fotos und Videos zu laden.',
        savePhotosPermission:
          'beisammen benötigt Zugriff, um Fotos und Videos auf deinem Gerät zu speichern.',
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
  extra: {
    publicEnv,
    ...(easProjectId ? { eas: { projectId: easProjectId } } : {}),
  },
};

export default config;
