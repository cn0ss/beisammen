/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly PUBLIC_INSTANCE_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
