import { getDb } from "../api/queries/connection";
import { sql } from "drizzle-orm";

async function main() {
  const db = getDb();
  await db.execute(sql`ALTER TABLE notificacoes ADD COLUMN autor VARCHAR(120) NULL`)
    .catch(() => console.log("• autor já existe"));
  console.log("✔ migração v14 concluída");
  process.exit(0);
}
main();
