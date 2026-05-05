import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Location from 'expo-location';
import * as MediaLibrary from 'expo-media-library';
import * as Sharing from 'expo-sharing';
import { Alert } from 'react-native';
import {
  Image as CompressorImage,
  createVideoThumbnail,
  getRealPath,
} from 'react-native-compressor';

import type { AssetKind, MediaLocation, UploadTarget } from '@beisammen/contracts';

import type { ShareAssetRecord } from '@/features/convex/api';

const LOCATION_COORDINATE_PRECISION = 4;
const DOWNLOAD_DIRECTORY = `${FileSystem.cacheDirectory ?? ''}share-downloads/`;

type RawLocation = Pick<MediaLocation, 'latitude' | 'longitude' | 'accuracyMeters' | 'source'>;
type GeocodedLocationFields = Pick<MediaLocation, 'label' | 'city' | 'region' | 'country'>;

export interface PreparedUploadAsset {
  uri: string;
  previewUri: string;
  fileName: string;
  mimeType: string;
  kind: AssetKind;
  sizeBytes?: number;
  width?: number;
  height?: number;
  durationSeconds?: number;
  location?: MediaLocation;
}

export interface PreparedPreviewAsset {
  uri: string;
  mimeType: 'image/jpeg';
  sizeBytes?: number;
  width?: number;
  height?: number;
}

function sanitizeFileName(fileName: string): string {
  return fileName.replace(/[^a-zA-Z0-9._-]+/g, '-');
}

function normalizeFileUri(uri: string): string {
  if (uri.startsWith('file://') || uri.startsWith('content://') || uri.startsWith('http')) {
    return uri;
  }

  if (uri.startsWith('/')) {
    return `file://${uri}`;
  }

  return uri;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const next = Number(value);

    if (Number.isFinite(next)) {
      return next;
    }
  }

  if (isRecord(value)) {
    const numerator = toNumber(value.numerator);
    const denominator = toNumber(value.denominator);

    if (numerator !== undefined && denominator && Number.isFinite(denominator)) {
      return numerator / denominator;
    }
  }

  return undefined;
}

function readCoordinatePart(value: unknown): number | undefined {
  if (Array.isArray(value) && value.length > 0) {
    const parts = value
      .map((entry) => toNumber(entry))
      .filter((entry): entry is number => entry !== undefined);

    if (parts.length === 0) {
      return undefined;
    }

    if (parts.length === 1) {
      return parts[0];
    }

    if (parts.length === 2) {
      return parts[0] + parts[1] / 60;
    }

    return parts[0] + parts[1] / 60 + parts[2] / 3600;
  }

  return toNumber(value);
}

function applyCoordinateRef(
  value: number | undefined,
  ref: unknown,
  negativeRef: string,
): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof ref === 'string' && ref.toUpperCase() === negativeRef) {
    return value > 0 ? -value : value;
  }

  return value;
}

function coordinateKey(latitude: number, longitude: number): string {
  return `${latitude.toFixed(LOCATION_COORDINATE_PRECISION)}:${longitude.toFixed(LOCATION_COORDINATE_PRECISION)}`;
}

function buildLocationLabel(fields: GeocodedLocationFields): string | undefined {
  const combos = [
    [fields.city, fields.region],
    [fields.city, fields.country],
    [fields.region, fields.country],
    [fields.country],
  ];

  for (const parts of combos) {
    const label = parts.filter(Boolean).join(', ').trim();

    if (label) {
      return label;
    }
  }

  return undefined;
}

async function confirmDeviceLocationFallback(): Promise<boolean> {
  return await new Promise((resolve) => {
    let didResolve = false;

    const finish = (value: boolean) => {
      if (!didResolve) {
        didResolve = true;
        resolve(value);
      }
    };

    Alert.alert(
      'Ort ergänzen?',
      'Einige Medien enthalten keine GPS-Daten. Möchtest du einmalig deinen aktuellen Standort nutzen, um diese Medien mit einem Ort zu ergänzen?',
      [
        {
          text: 'Nicht jetzt',
          style: 'cancel',
          onPress: () => finish(false),
        },
        {
          text: 'Ort ergänzen',
          onPress: () => finish(true),
        },
      ],
      {
        cancelable: true,
        onDismiss: () => finish(false),
      },
    );
  });
}

async function reverseGeocodeLocation(
  location: RawLocation,
  cache: Map<string, GeocodedLocationFields | null>,
): Promise<MediaLocation> {
  const key = coordinateKey(location.latitude, location.longitude);

  if (!cache.has(key)) {
    try {
      const [result] = await Location.reverseGeocodeAsync({
        latitude: location.latitude,
        longitude: location.longitude,
      });

      if (!result) {
        cache.set(key, null);
      } else {
        const fields: GeocodedLocationFields = {
          city: result.city ?? undefined,
          region: result.region ?? result.subregion ?? undefined,
          country: result.country ?? undefined,
        };

        fields.label = buildLocationLabel(fields);
        cache.set(key, fields);
      }
    } catch {
      cache.set(key, null);
    }
  }

  const cached = cache.get(key) ?? null;

  return {
    ...location,
    ...(cached ?? {}),
  };
}

async function readMediaLibraryLocation(assetId: string): Promise<RawLocation | undefined> {
  try {
    const info = await MediaLibrary.getAssetInfoAsync(assetId, {
      shouldDownloadFromNetwork: false,
    });
    const latitude = toNumber(info.location?.latitude);
    const longitude = toNumber(info.location?.longitude);

    if (latitude === undefined || longitude === undefined) {
      return undefined;
    }

    return {
      latitude,
      longitude,
      source: 'embedded',
    };
  } catch {
    return undefined;
  }
}

function readImagePickerExifLocation(
  exif: ImagePicker.ImagePickerAsset['exif'],
): RawLocation | undefined {
  if (!isRecord(exif)) {
    return undefined;
  }

  const latitude = applyCoordinateRef(
    readCoordinatePart(exif.GPSLatitude),
    exif.GPSLatitudeRef,
    'S',
  );
  const longitude = applyCoordinateRef(
    readCoordinatePart(exif.GPSLongitude),
    exif.GPSLongitudeRef,
    'W',
  );

  if (latitude === undefined || longitude === undefined) {
    return undefined;
  }

  return {
    latitude,
    longitude,
    source: 'embedded',
  };
}

async function readEmbeddedLocation(
  asset: ImagePicker.ImagePickerAsset,
): Promise<RawLocation | undefined> {
  if (asset.assetId) {
    const mediaLibraryLocation = await readMediaLibraryLocation(asset.assetId);

    if (mediaLibraryLocation) {
      return mediaLibraryLocation;
    }
  }

  if (asset.type === 'image') {
    return readImagePickerExifLocation(asset.exif);
  }

  return undefined;
}

async function readDeviceFallbackLocation(
  cache: Map<string, GeocodedLocationFields | null>,
): Promise<MediaLocation | undefined> {
  const shouldUseFallback = await confirmDeviceLocationFallback();

  if (!shouldUseFallback) {
    return undefined;
  }

  const permission = await Location.requestForegroundPermissionsAsync();

  if (!permission.granted) {
    return undefined;
  }

  const lastKnown = await Location.getLastKnownPositionAsync({
    maxAge: 5 * 60 * 1000,
    requiredAccuracy: 500,
  }).catch(() => null);
  const current =
    lastKnown ??
    (await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    }).catch(() => null));

  if (!current) {
    return undefined;
  }

  return await reverseGeocodeLocation(
    {
      latitude: current.coords.latitude,
      longitude: current.coords.longitude,
      accuracyMeters: current.coords.accuracy ?? undefined,
      source: 'device-fallback',
    },
    cache,
  );
}

export async function resolvePickerAssetLocations(
  assets: ImagePicker.ImagePickerAsset[],
): Promise<Array<MediaLocation | undefined>> {
  const geocodeCache = new Map<string, GeocodedLocationFields | null>();
  const embeddedLocations = await Promise.all(assets.map((asset) => readEmbeddedLocation(asset)));
  const resolvedLocations = await Promise.all(
    embeddedLocations.map(async (location) =>
      location ? await reverseGeocodeLocation(location, geocodeCache) : undefined,
    ),
  );
  const needsFallback = resolvedLocations.some((location) => !location);

  if (!needsFallback) {
    return resolvedLocations;
  }

  const fallbackLocation = await readDeviceFallbackLocation(geocodeCache);

  if (!fallbackLocation) {
    return resolvedLocations;
  }

  return resolvedLocations.map((location) => location ?? fallbackLocation);
}

export function formatMediaLocation(location?: MediaLocation): string | null {
  if (!location) {
    return null;
  }

  if (location.label?.trim()) {
    return location.label.trim();
  }

  const parts = [location.city, location.region, location.country]
    .filter(Boolean)
    .join(', ')
    .trim();

  if (parts) {
    return parts;
  }

  return `${location.latitude.toFixed(4)}, ${location.longitude.toFixed(4)}`;
}

export function fileNameFromPickerAsset(asset: ImagePicker.ImagePickerAsset): string {
  if (asset.fileName?.trim()) {
    return sanitizeFileName(asset.fileName.trim());
  }

  const fallback = asset.type === 'video' ? 'video.mp4' : 'image.jpg';
  const tail = asset.uri.split('/').pop();
  return sanitizeFileName(tail && tail.length > 0 ? tail : fallback);
}

export function mimeTypeForPickerAsset(asset: ImagePicker.ImagePickerAsset): string {
  if (asset.mimeType?.trim()) {
    return asset.mimeType.trim();
  }

  return asset.type === 'video' ? 'video/mp4' : 'image/jpeg';
}

export function assetKind(asset: ImagePicker.ImagePickerAsset): AssetKind {
  return asset.type === 'video' ? 'video' : 'image';
}

async function getFileSize(uri: string): Promise<number | undefined> {
  const info = await FileSystem.getInfoAsync(uri);

  if (!info.exists) {
    return undefined;
  }

  return info.size;
}

async function processImageAsset(
  asset: ImagePicker.ImagePickerAsset,
  location?: MediaLocation,
): Promise<PreparedUploadAsset> {
  return {
    uri: asset.uri,
    previewUri: asset.uri,
    fileName: fileNameFromPickerAsset(asset),
    mimeType: mimeTypeForPickerAsset(asset),
    kind: 'image',
    sizeBytes: asset.fileSize ?? (await getFileSize(asset.uri)),
    width: asset.width,
    height: asset.height,
    location,
  };
}

async function processVideoAsset(
  asset: ImagePicker.ImagePickerAsset,
  location?: MediaLocation,
): Promise<PreparedUploadAsset> {
  const originalDurationSeconds =
    asset.duration !== null && asset.duration !== undefined ? asset.duration / 1000 : undefined;

  return {
    uri: asset.uri,
    previewUri: asset.uri,
    fileName: fileNameFromPickerAsset(asset),
    mimeType: mimeTypeForPickerAsset(asset),
    kind: 'video',
    sizeBytes: asset.fileSize ?? (await getFileSize(asset.uri)),
    width: asset.width,
    height: asset.height,
    durationSeconds: originalDurationSeconds,
    location,
  };
}

export async function optimizePickerAsset(
  asset: ImagePicker.ImagePickerAsset,
  location?: MediaLocation,
): Promise<PreparedUploadAsset> {
  if (assetKind(asset) === 'image') {
    return await processImageAsset(asset, location);
  }

  return await processVideoAsset(asset, location);
}

export async function uploadPreparedFile(input: {
  target: UploadTarget;
  asset: PreparedUploadAsset;
}): Promise<{ storageId?: string; objectKey?: string }> {
  const response = await fetch(input.asset.uri);
  const blob = await response.blob();

  const uploadResponse = await fetch(input.target.uploadUrl, {
    method: 'PUT',
    headers: { ...(input.target.headers ?? {}), 'content-type': input.asset.mimeType },
    body: blob,
  });

  if (!uploadResponse.ok) {
    throw new Error(`S3 upload failed with status ${uploadResponse.status}.`);
  }

  return { objectKey: input.target.objectKey };
}

function fallbackExtensionForAsset(asset: ShareAssetRecord): string {
  if (asset.kind === 'video') {
    return 'mp4';
  }

  if (asset.mimeType.includes('png')) {
    return 'png';
  }

  return 'jpg';
}

export async function downloadAssetToCache(input: {
  asset: ShareAssetRecord;
  url: string;
}): Promise<string> {
  if (!DOWNLOAD_DIRECTORY) {
    throw new Error('Cache directory unavailable.');
  }

  await FileSystem.makeDirectoryAsync(DOWNLOAD_DIRECTORY, {
    intermediates: true,
  });

  const baseName = input.asset.fileName?.trim()
    ? sanitizeFileName(input.asset.fileName.trim())
    : `${input.asset._id}.${fallbackExtensionForAsset(input.asset)}`;
  const targetUri = `${DOWNLOAD_DIRECTORY}${Date.now()}-${baseName}`;
  const result = await FileSystem.downloadAsync(input.url, targetUri);

  return result.uri;
}

export async function saveAssetToDeviceLibrary(localUri: string): Promise<void> {
  const permission = await MediaLibrary.requestPermissionsAsync(true);

  if (!permission.granted) {
    throw new Error('Speicherzugriff für die Mediathek wurde nicht erlaubt.');
  }

  await MediaLibrary.saveToLibraryAsync(localUri);
}

export async function shareLocalFile(localUri: string): Promise<void> {
  const isAvailable = await Sharing.isAvailableAsync();

  if (!isAvailable) {
    throw new Error('Teilen ist auf diesem Gerät nicht verfügbar.');
  }

  await Sharing.shareAsync(localUri);
}

export function formatBytes(sizeBytes?: number): string | null {
  if (!sizeBytes || sizeBytes <= 0) {
    return null;
  }

  if (sizeBytes < 1024 * 1024) {
    return `${Math.round(sizeBytes / 1024)} KB`;
  }

  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

export async function createCompressedPreview(input: {
  uri: string;
  kind: AssetKind;
}): Promise<PreparedPreviewAsset> {
  if (input.kind === 'image') {
    const uri = await CompressorImage.compress(input.uri, {
      maxHeight: 600,
      maxWidth: 600,
      quality: 0.7,
    });

    return {
      uri: normalizeFileUri(uri),
      mimeType: 'image/jpeg',
      sizeBytes: await getFileSize(normalizeFileUri(uri)),
    };
  }

  const realPath = await getRealPath(input.uri, 'video').catch(() => input.uri);
  const thumbnail = await createVideoThumbnail(realPath);

  return {
    uri: normalizeFileUri(thumbnail.path),
    mimeType: 'image/jpeg',
    sizeBytes: thumbnail.size,
    width: thumbnail.width,
    height: thumbnail.height,
  };
}
