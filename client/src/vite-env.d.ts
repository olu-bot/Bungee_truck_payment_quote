/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CONNECT_GUEST_MODE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
