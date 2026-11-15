/* Migração v17 — Controlo de acesso dos vendedores por horário
   Executar uma vez: npx tsx db/migrate-v17.ts
   (no servidor em produção corre sozinha no arranque — ver api/seed-auto.ts) */
import { getDb } from "../api/queries/connection";
import { sql } from "drizzle-orm";

export const MIGRATE_V17_ALTERS = [
  "ALTER TABLE usuarios ADD desbloqueado_ate TIMESTAMP NULL",
  "ALTER TABLE usuarios ADD bloqueio_manual TINYINT(1) NOT NULL DEFAULT 0",
];

async function run() {
  const db = getDb();
  for (const a of MIGRATE_V17_ALTERS) {
    try { await db.execute(sql.raw(a)); console.log("OK:", a); }
    catch (e: any) { console.log("SKIP/ERRO:", a, "-", e?.message?.slice(0, 120)); }
  }
  process.exit(0);
}
run().catch((e) => { console.error(e); process.exit(1); });
