/**
 * In-memory stand-in for both expo-file-system APIs (the modern File/FileMode
 * classes used by file-crypto and the legacy promise API used by the media
 * modules), so media tests can run real BSE1 crypto end to end without
 * touching the disk or native modules.
 *
 * Usage inside a test file:
 *
 *   vi.mock('expo-file-system', async () =>
 *     (await import('@/test/fake-file-system')).createModernFileSystemMock());
 *   vi.mock('expo-file-system/legacy', async () =>
 *     (await import('@/test/fake-file-system')).createLegacyFileSystemMock());
 */

export interface FakeFileSystemState {
  files: Map<string, Uint8Array>;
  modifiedAt: Map<string, number>;
  downloads: Map<string, Uint8Array>;
  downloadCount: number;
  copyCount: number;
}

export const fakeFsState: FakeFileSystemState = {
  files: new Map(),
  modifiedAt: new Map(),
  downloads: new Map(),
  downloadCount: 0,
  copyCount: 0,
};

let clock = 1;

function touch(uri: string, at?: number): void {
  fakeFsState.modifiedAt.set(uri, at ?? clock);
  clock += 1;
}

export function resetFakeFileSystem(): void {
  fakeFsState.files.clear();
  fakeFsState.modifiedAt.clear();
  fakeFsState.downloads.clear();
  fakeFsState.downloadCount = 0;
  fakeFsState.copyCount = 0;
  clock = 1;
}

export function seedFile(uri: string, bytes: Uint8Array, modifiedAt?: number): void {
  fakeFsState.files.set(uri, bytes.slice());
  touch(uri, modifiedAt);
}

export function readFile(uri: string): Uint8Array | undefined {
  return fakeFsState.files.get(uri);
}

export function listFiles(prefix: string): string[] {
  return [...fakeFsState.files.keys()].filter((uri) => uri.startsWith(prefix));
}

export function registerDownload(url: string, bytes: Uint8Array): void {
  fakeFsState.downloads.set(url, bytes.slice());
}

class FakeFileHandle {
  private offset = 0;

  constructor(private readonly uri: string) {}

  readBytes(length: number): Uint8Array {
    const bytes = fakeFsState.files.get(this.uri) ?? new Uint8Array(0);
    const chunk = bytes.slice(this.offset, this.offset + length);

    this.offset += chunk.length;

    return chunk;
  }

  writeBytes(bytes: Uint8Array): void {
    const current = fakeFsState.files.get(this.uri) ?? new Uint8Array(0);
    const next = new Uint8Array(current.length + bytes.length);

    next.set(current);
    next.set(bytes, current.length);
    fakeFsState.files.set(this.uri, next);
    touch(this.uri);
  }

  close(): void {}
}

export class FakeFile {
  readonly uri: string;

  constructor(uri: string | { uri: string }) {
    this.uri = typeof uri === 'string' ? uri : uri.uri;
  }

  get exists(): boolean {
    return fakeFsState.files.has(this.uri);
  }

  get size(): number {
    return fakeFsState.files.get(this.uri)?.length ?? 0;
  }

  create(): void {
    fakeFsState.files.set(this.uri, new Uint8Array(0));
    touch(this.uri);
  }

  delete(): void {
    fakeFsState.files.delete(this.uri);
    fakeFsState.modifiedAt.delete(this.uri);
  }

  open(_mode: string): FakeFileHandle {
    return new FakeFileHandle(this.uri);
  }
}

export const FakeFileMode = { ReadOnly: 'r', WriteOnly: 'w' } as const;

export function createModernFileSystemMock() {
  return {
    File: FakeFile,
    FileMode: FakeFileMode,
  };
}

export function createLegacyFileSystemMock() {
  return {
    cacheDirectory: 'file:///cache/',
    FileSystemUploadType: { BINARY_CONTENT: 'BINARY_CONTENT' },
    makeDirectoryAsync: async () => undefined,
    getInfoAsync: async (uri: string) => {
      if (uri.endsWith('/')) {
        return { exists: true, isDirectory: true, uri };
      }

      const bytes = fakeFsState.files.get(uri);

      if (!bytes) {
        return { exists: false, isDirectory: false, uri };
      }

      return {
        exists: true,
        isDirectory: false,
        uri,
        size: bytes.length,
        modificationTime: fakeFsState.modifiedAt.get(uri) ?? 0,
      };
    },
    readDirectoryAsync: async (dir: string) => {
      const prefix = dir.endsWith('/') ? dir : `${dir}/`;

      return [...fakeFsState.files.keys()]
        .filter((uri) => uri.startsWith(prefix))
        .map((uri) => uri.slice(prefix.length))
        .filter((rest) => rest.length > 0 && !rest.includes('/'));
    },
    deleteAsync: async (uri: string, options?: { idempotent?: boolean }) => {
      if (!fakeFsState.files.has(uri) && !options?.idempotent) {
        throw new Error(`File not found: ${uri}`);
      }

      fakeFsState.files.delete(uri);
      fakeFsState.modifiedAt.delete(uri);
    },
    moveAsync: async ({ from, to }: { from: string; to: string }) => {
      const bytes = fakeFsState.files.get(from);

      if (!bytes) {
        throw new Error(`File not found: ${from}`);
      }

      fakeFsState.files.set(to, bytes);
      touch(to);
      fakeFsState.files.delete(from);
      fakeFsState.modifiedAt.delete(from);
    },
    copyAsync: async ({ from, to }: { from: string; to: string }) => {
      const bytes = fakeFsState.files.get(from);

      if (!bytes) {
        throw new Error(`File not found: ${from}`);
      }

      fakeFsState.copyCount += 1;
      fakeFsState.files.set(to, bytes.slice());
      touch(to);
    },
    downloadAsync: async (url: string, target: string) => {
      fakeFsState.downloadCount += 1;

      const bytes = fakeFsState.downloads.get(url);

      if (!bytes) {
        throw new Error(`No fake download registered for ${url}`);
      }

      fakeFsState.files.set(target, bytes.slice());
      touch(target);

      return { uri: target, status: 200 };
    },
  };
}
