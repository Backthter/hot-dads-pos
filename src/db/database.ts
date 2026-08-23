import Database from "@tauri-apps/plugin-sql";

let dbInstance: Awaited<ReturnType<typeof Database.load>> | null = null;

export async function getDb() {
  if (!dbInstance) {
    dbInstance = await Database.load("sqlite:hotdads.db");
  }
  return dbInstance;
}
