/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Set to `'1'` by `.env.demo`, which `vite --mode demo` loads.
   *
   * The only thing it changes is which SQLite file the app opens. See
   * `src/db/database.ts` and `demo/README.md`.
   */
  readonly VITE_DEMO_DB?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
