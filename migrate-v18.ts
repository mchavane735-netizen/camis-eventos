/* Migração v18 — Vagas & Recrutamento (concursos públicos, candidaturas com CV,
   subscritores de notificações)
   Executar uma vez: npx tsx db/migrate-v18.ts
   (no servidor em produção corre sozinha no arranque — ver api/seed-auto.ts) */
import { getDb } from "../api/queries/connection";
import { sql } from "drizzle-orm";

export const MIGRATE_V18 = [
  `CREATE TABLE IF NOT EXISTS vagas (
    id INT AUTO_INCREMENT PRIMARY KEY,
    titulo VARCHAR(120) NOT NULL,
    area VARCHAR(80) NOT NULL DEFAULT 'Cozinha',
    tipo VARCHAR(60) NOT NULL DEFAULT 'Tempo inteiro',
    local VARCHAR(120) NOT NULL DEFAULT 'Chimoio — CAMI''S Eventos',
    salario VARCHAR(80) NULL,
    descricao TEXT NULL,
    requisitos TEXT NULL,
    oferecemos TEXT NULL,
    estado VARCHAR(12) NOT NULL DEFAULT 'Aberta',
    criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS candidaturas (
    id INT AUTO_INCREMENT PRIMARY KEY,
    codigo VARCHAR(12) NOT NULL UNIQUE,
    vaga_id BIGINT UNSIGNED NOT NULL,
    nome VARCHAR(160) NOT NULL,
    telefone VARCHAR(30) NOT NULL,
    email VARCHAR(120) NULL,
    idade INT NULL,
    residencia VARCHAR(120) NULL,
    experiencia_anos DOUBLE NOT NULL DEFAULT 0,
    disponibilidade VARCHAR(40) NOT NULL DEFAULT 'Imediata',
    apresentacao TEXT NULL,
    cv MEDIUMTEXT NULL,
    cv_nome VARCHAR(160) NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'Nova',
    pontuacao INT NULL,
    pontuacao_detalhe TEXT NULL,
    nota_interna VARCHAR(255) NULL,
    criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX cand_vaga_idx (vaga_id),
    INDEX cand_status_idx (status)
  )`,
  `CREATE TABLE IF NOT EXISTS vagas_subscritores (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nome VARCHAR(160) NOT NULL,
    contacto VARCHAR(60) NOT NULL,
    canal VARCHAR(10) NOT NULL DEFAULT 'WhatsApp',
    criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
];

async function run() {
  const db = getDb();
  for (const a of MIGRATE_V18) {
    try { await db.execute(sql.raw(a)); console.log("OK:", a.slice(0, 60)); }
    catch (e: any) { console.log("SKIP/ERRO:", a.slice(0, 60), "-", e?.message?.slice(0, 120)); }
  }
  process.exit(0);
}
run().catch((e) => { console.error(e); process.exit(1); });
