/* Migração v20 — contacto do fornecedor nas despesas (para dívidas a fornecedores)
   Executar uma vez: npx tsx db/migrate-v20.ts
   (no servidor em produção corre sozinha no arranque — ver api/seed-auto.ts) */
import { getDb } from "../api/queries/connection";
import { sql } from "drizzle-orm";

export const MIGRATE_V20 = [
  `ALTER TABLE despesas ADD COLUMN fornecedor_tel VARCHAR(30) NULL`,
];

async function run() {
  const db = getDb();
  for (const a of MIGRATE_V20) {
    try { await db.execute(sql.raw(a)); console.log("OK:", a.slice(0, 60)); }
    catch (e: any) { console.log("SKIP/ERRO:", a.slice(0, 60), "-", e?.message?.slice(0, 120)); }
  }
  process.exit(0);
}
run().catch((e) => { console.error(e); process.exit(1); });
