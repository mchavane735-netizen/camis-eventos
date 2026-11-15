import { getDb } from "../api/queries/connection";
import { sql } from "drizzle-orm";

async function main() {
  const db = getDb();
  await db.execute(sql`ALTER TABLE pedidos ADD COLUMN cozinha_status VARCHAR(20) NULL`)
    .catch(() => console.log("• cozinha_status já existe"));
  console.log("✔ migração v13 concluída");
  process.exit(0);
}
main();
