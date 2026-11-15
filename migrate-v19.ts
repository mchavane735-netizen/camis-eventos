/* Migração v19 — Dívidas de clientes (fiado): dívidas visíveis até liquidação total,
   amortizações parciais, ligação ao fecho de vendas e ao Financeiro.
   Executar uma vez: npx tsx db/migrate-v19.ts
   (no servidor em produção corre sozinha no arranque — ver api/seed-auto.ts) */
import { getDb } from "../api/queries/connection";
import { sql } from "drizzle-orm";

export const MIGRATE_V19 = [
  `ALTER TABLE pedidos ADD COLUMN divida_gerada DOUBLE NOT NULL DEFAULT 0`,
  `CREATE TABLE IF NOT EXISTS dividas (
    id INT AUTO_INCREMENT PRIMARY KEY,
    codigo VARCHAR(12) NOT NULL UNIQUE,
    pedido_id BIGINT UNSIGNED NULL,
    cliente_nome VARCHAR(160) NOT NULL,
    cliente_tel VARCHAR(30) NULL,
    obs VARCHAR(255) NULL,
    valor_total DOUBLE NOT NULL DEFAULT 0,
    status VARCHAR(12) NOT NULL DEFAULT 'Aberta',
    data_dia VARCHAR(10) NOT NULL,
    criado_por BIGINT UNSIGNED NOT NULL,
    criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    liquidada_em TIMESTAMP NULL
  )`,
  `CREATE TABLE IF NOT EXISTS dividas_pagamentos (
    id INT AUTO_INCREMENT PRIMARY KEY,
    divida_id BIGINT UNSIGNED NOT NULL,
    valor DOUBLE NOT NULL,
    metodo VARCHAR(160) NOT NULL,
    usuario_id BIGINT UNSIGNED NOT NULL,
    criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
];

async function run() {
  const db = getDb();
  for (const a of MIGRATE_V19) {
    try { await db.execute(sql.raw(a)); console.log("OK:", a.slice(0, 60)); }
    catch (e: any) { console.log("SKIP/ERRO:", a.slice(0, 60), "-", e?.message?.slice(0, 120)); }
  }
  process.exit(0);
}
run().catch((e) => { console.error(e); process.exit(1); });
