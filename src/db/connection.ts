import { getDb } from "./database";
import { drizzle } from "drizzle-orm/sqlite-proxy";

export { getDb };

export const db = drizzle(
  async (sql, params, method) => {
    const db = await getDb();

    if (method === "run") {
      const result = await db.execute(sql, params);
      return { rows: result as unknown as Record<string, unknown>[] };
    }

    const rows = await db.select(sql, params);
    return { rows: rows as Record<string, unknown>[] };
  },
  { logger: true },
);
