/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AUDIT_ENDPOINT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
