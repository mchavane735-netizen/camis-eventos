/* Migração v6 — perfil Logistica, extras com cotação (pedidos_online), tabela despesas.
   Uso: npx tsx db/migrate-v6.ts  (idempotente) */
import { sql } from "drizzle-orm";
import { getDb } from "../api/queries/connection";

const db = getDb();

async function main() {
  await db.execute(sql`
    ALTER TABLE usuarios
    MODIFY perfil ENUM('Admin','Gestor','Vendedor','Cozinha','Logistica') NOT NULL DEFAULT 'Vendedor'
  `).catch((e) => console.log("perfil enum:", e.message));

  await db.execute(sql`ALTER TABLE pedidos_online ADD COLUMN extras JSON NULL AFTER proposta`)
    .catch((e) => console.log("extras col:", e.message));

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS despesas (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      data_dia VARCHAR(10) NOT NULL,
      categoria VARCHAR(80) NOT NULL,
      descricao VARCHAR(255) NOT NULL,
      fornecedor VARCHAR(160) NULL,
      valor DOUBLE NOT NULL DEFAULT 0,
      usuario_id BIGINT UNSIGNED NOT NULL,
      criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX desp_dia_idx (data_dia)
    )
  `).catch((e) => console.log("despesas table:", e.message));

  const cols = await db.execute(sql`SHOW COLUMNS FROM pedidos_online LIKE 'extras'`);
  console.log("extras:", (cols[0] as unknown as Array<{ Field: string }>).length ? "OK" : "FALHOU");
  const tabs = await db.execute(sql`SHOW TABLES LIKE 'despesas'`);
  console.log("despesas:", (tabs[0] as unknown as unknown[]).length ? "OK" : "FALHOU");
  const perfilCol = await db.execute(sql`SHOW COLUMNS FROM usuarios LIKE 'perfil'`);
  console.log("perfil:", (perfilCol[0] as unknown as Array<{ Type: string }>)[0]?.Type);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
