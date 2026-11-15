/** v30 — pedidos.atendente: funcionário que atende a mesa/pedido */
import { getDb } from "../api/queries/connection";
import { sql } from "drizzle-orm";

export async function migrateV30() {
  const db = getDb();
  await db.execute(sql`ALTER TABLE pedidos ADD COLUMN atendente varchar(120) NULL AFTER area`).catch(() => {});
  console.log("✅ migração v30 concluída (pedidos.atendente)");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  migrateV30().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
}
