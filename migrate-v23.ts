/* Migração v23 — Recursos Humanos (trabalhadores, presenças, licenças, salários)
   Executar uma vez: npx tsx db/migrate-v23.ts
   (no servidor em produção corre sozinha no arranque — ver api/seed-auto.ts) */
import { getDb } from "../api/queries/connection";
import { sql } from "drizzle-orm";

export const MIGRATE_V23 = [
  `CREATE TABLE IF NOT EXISTS trabalhadores (id INT AUTO_INCREMENT PRIMARY KEY, codigo VARCHAR(12) NOT NULL UNIQUE, nome VARCHAR(160) NOT NULL, telefone VARCHAR(40) NULL, bi_numero VARCHAR(60) NULL, regime VARCHAR(12) NOT NULL DEFAULT 'Permanente', area VARCHAR(12) NOT NULL DEFAULT 'Restaurante', cargo VARCHAR(120) NOT NULL, atividades TEXT NULL, data_inicio VARCHAR(10) NOT NULL, salario_mensal DOUBLE NOT NULL DEFAULT 0, diaria DOUBLE NOT NULL DEFAULT 500, afiliado_id BIGINT UNSIGNED NULL, notas VARCHAR(255) NULL, ativo TINYINT(1) NOT NULL DEFAULT 1, criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS rh_presencas (id INT AUTO_INCREMENT PRIMARY KEY, trabalhador_id BIGINT UNSIGNED NOT NULL, data_dia VARCHAR(10) NOT NULL, status VARCHAR(10) NOT NULL DEFAULT 'Presente', area VARCHAR(12) NOT NULL DEFAULT 'Restaurante', justificativa VARCHAR(255) NULL, criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, INDEX rhp_trdia_idx (trabalhador_id, data_dia), INDEX rhp_dia_idx (data_dia))`,
  `CREATE TABLE IF NOT EXISTS rh_licencas (id INT AUTO_INCREMENT PRIMARY KEY, trabalhador_id BIGINT UNSIGNED NOT NULL, tipo VARCHAR(12) NOT NULL DEFAULT 'Anual', motivo VARCHAR(255) NOT NULL, inicio VARCHAR(10) NOT NULL, fim VARCHAR(10) NOT NULL, criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, INDEX rhl_tr_idx (trabalhador_id))`,
  `CREATE TABLE IF NOT EXISTS rh_salario_pagamentos (id INT AUTO_INCREMENT PRIMARY KEY, trabalhador_id BIGINT UNSIGNED NOT NULL, mes_referencia VARCHAR(7) NOT NULL, valor DOUBLE NOT NULL, metodo VARCHAR(60) NULL, obs VARCHAR(255) NULL, pago_por VARCHAR(120) NULL, pago_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, INDEX rhs_trmes_idx (trabalhador_id, mes_referencia))`,
];

async function run() {
  const db = getDb();
  for (const a of MIGRATE_V23) {
    try { await db.execute(sql.raw(a)); console.log("OK:", a.slice(0, 60)); }
    catch (e: any) { console.log("SKIP/ERRO:", a.slice(0, 60), "-", e?.message?.slice(0, 120)); }
  }
  process.exit(0);
}
run().catch((e) => { console.error(e); process.exit(1); });
