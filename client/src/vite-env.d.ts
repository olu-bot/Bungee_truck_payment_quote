/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CONNECT_GUEST_MODE?: string;
  /** Auto-generated at build time: YYYY.MM.DD.HHmm (e.g. "2026.04.02.1423"). */
  readonly VITE_APP_VERSION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
