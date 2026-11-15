/* Migração v24 — reservas.online_id (ligação da Reserva Buffet ao pedido online)
   Executar uma vez: npx tsx db/migrate-v24.ts
   (no servidor em produção corre sozinha no arranque — ver api/seed-auto.ts) */
import { getDb } from "../api/queries/connection";
import { sql } from "drizzle-orm";

export const MIGRATE_V24 = [
  `ALTER TABLE reservas ADD online_id BIGINT UNSIGNED NULL`,
];

async function run() {
  const db = getDb();
  for (const a of MIGRATE_V24) {
    try { await db.execute(sql.raw(a)); console.log("OK:", a.slice(0, 60)); }
    catch (e: any) { console.log("SKIP/ERRO:", a.slice(0, 60), "-", e?.message?.slice(0, 120)); }
  }
  process.exit(0);
}
run().catch((e) => { console.error(e); process.exit(1); });
