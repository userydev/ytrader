/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_INDUSTRY_PREVIEW_URL?: string;
  readonly VITE_EDITORIAL?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
