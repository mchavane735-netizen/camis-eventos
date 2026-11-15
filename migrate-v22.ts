/* Migração v22 — foto dos pacotes de buffet (apresentação visual)
   Executar uma vez: npx tsx db/migrate-v22.ts
   (no servidor em produção corre sozinha no arranque — ver api/seed-auto.ts) */
import { getDb } from "../api/queries/connection";
import { sql } from "drizzle-orm";

export const MIGRATE_V22 = [
  `ALTER TABLE buffet_pacotes ADD COLUMN foto VARCHAR(120) NULL`,
  `UPDATE buffet_pacotes SET foto = '/fotos/buffet-mini.jpg' WHERE nome = 'Buffet Mini' AND foto IS NULL`,
  `UPDATE buffet_pacotes SET foto = '/fotos/buffet-medio.jpg' WHERE nome = 'Buffet Médio' AND foto IS NULL`,
  `UPDATE buffet_pacotes SET foto = '/fotos/buffet-max.jpg' WHERE nome = 'Buffet Max' AND foto IS NULL`,
];

async function run() {
  const db = getDb();
  for (const a of MIGRATE_V22) {
    try { await db.execute(sql.raw(a)); console.log("OK:", a.slice(0, 60)); }
    catch (e: any) { console.log("SKIP/ERRO:", a.slice(0, 60), "-", e?.message?.slice(0, 120)); }
  }
  process.exit(0);
}
run().catch((e) => { console.error(e); process.exit(1); });
