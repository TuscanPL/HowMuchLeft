/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
  readonly VITE_GOOGLE_AUTH?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

/** Short commit hash the app was built from (see vite.config.ts). */
declare const __APP_VERSION__: string
/** ISO time the app was built. */
declare const __BUILD_TIME__: string
