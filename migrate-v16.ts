/* Migração v16 — BRAAI (cliente traz os seus produtos — taxa não consumível)
   Executar uma vez: npx tsx db/migrate-v16.ts
   (no servidor em produção corre sozinha no arranque — ver api/seed-auto.ts) */
import { getDb } from "../api/queries/connection";
import { sql } from "drizzle-orm";

export const MIGRATE_V16_ALTERS = [
  // reservas do restaurante (POS)
  "ALTER TABLE reservas ADD braai TINYINT(1) NOT NULL DEFAULT 0",
  "ALTER TABLE reservas ADD braai_modalidade VARCHAR(1) NULL",
  "ALTER TABLE reservas ADD braai_traz VARCHAR(20) NULL",
  "ALTER TABLE reservas ADD criancas_menores INT NOT NULL DEFAULT 0",
  "ALTER TABLE reservas ADD checkin_em TIMESTAMP NULL",
  "ALTER TABLE reservas ADD checkin_por VARCHAR(120) NULL",
  "ALTER TABLE reservas ADD checkin_obs VARCHAR(255) NULL",
  "ALTER TABLE reservas ADD saldo_pago TINYINT(1) NOT NULL DEFAULT 0",
  // reservas feitas na loja online (tipo "Reserva" + braai_modalidade)
  "ALTER TABLE pedidos_online ADD braai_modalidade VARCHAR(1) NULL",
  "ALTER TABLE pedidos_online ADD braai_traz VARCHAR(20) NULL",
  "ALTER TABLE pedidos_online ADD criancas_menores INT NOT NULL DEFAULT 0",
];

async function run() {
  const db = getDb();
  for (const a of MIGRATE_V16_ALTERS) {
    try { await db.execute(sql.raw(a)); console.log("OK:", a); }
    catch (e: any) { console.log("SKIP/ERRO:", a, "-", e?.message?.slice(0, 120)); }
  }
  process.exit(0);
}
run().catch((e) => { console.error(e); process.exit(1); });
