/**
 * The one connection the whole persistence layer goes through.
 *
 * Two things happen here and nothing else does.
 *
 * **Which file is opened.** A demo build opens `hotdads-demo.db`, a completely
 * separate file beside the real one. That separation is the whole safety
 * property of the demo dataset: `hotdads.db` is a real shop's takings, and a
 * seed script or a dev session that stamped on it would destroy data that only
 * exists here. Nothing in this file can name the real database when the demo
 * flag is set, and nothing outside this file names either.
 *
 * **Where the driver comes from.** In the app that is Tauri's SQL plugin. Under
 * `tsx` there is no Tauri and no webview, so tooling injects its own driver —
 * see `setDbDriver`. That seam is what lets `demo/build.ts` write the seed file
 * through `saveAllData`, the app's own save path, rather than through a second
 * copy of every INSERT that would drift the first time a column was added.
 */

/**
 * What the persistence layer actually needs from a database.
 *
 * Deliberately tiny, and it is the whole surface `persistence.ts` uses. Tauri's
 * `Database` satisfies it structurally; so does a thirty-line wrapper around
 * `better-sqlite3`.
 */
export interface DbLike {
  execute(sql: string, params?: unknown[]): Promise<unknown>;
  select<T>(sql: string, params?: unknown[]): Promise<T>;
}

/** True when this build should use the demo dataset. See `demo/README.md`. */
export const USING_DEMO_DB = import.meta.env?.VITE_DEMO_DB === '1';

/**
 * The real database. Never opened by a demo build, and never renamed.
 *
 * `run_migrations` in `src-tauri/src/lib.rs` creates and migrates this file by
 * name at startup. A demo file gets its schema from `demo/build.ts`, which
 * reads the same DDL out of `lib.rs` rather than keeping a copy.
 */
const REAL_DB = 'hotdads.db';
const DEMO_DB = 'hotdads-demo.db';

export const DB_FILE = USING_DEMO_DB ? DEMO_DB : REAL_DB;

let dbInstance: DbLike | null = null;
let injected: DbLike | null = null;

/**
 * Hands the persistence layer a driver, for tooling that runs outside the app.
 *
 * Only `demo/build.ts` calls this. It is exported rather than hidden because
 * the alternative — mocking a module under `tsx` — is more machinery and less
 * honest about what is happening.
 */
export function setDbDriver(driver: DbLike | null) {
  injected = driver;
  dbInstance = null;
}

export async function getDb(): Promise<DbLike> {
  if (injected) return injected;
  if (!dbInstance) {
    // Imported here rather than at the top so that Node tooling, which has no
    // webview to talk to, never loads the plugin at all.
    const { default: Database } = await import('@tauri-apps/plugin-sql');
    dbInstance = await Database.load(`sqlite:${DB_FILE}`) as unknown as DbLike;
  }
  return dbInstance;
}
