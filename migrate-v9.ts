/**
 * Migração v9 — Batch 5:
 * 1. pedidos_online.metodo_pagamento (M-Pesa | e-Mola | Dinheiro)
 * 2. tabela gerencia (consumo dos proprietários — stock sempre descontado)
 */
import { getDb } from "../api/queries/connection";
import { sql } from "drizzle-orm";

async function main() {
  const db = getDb();

  await db.execute(sql`ALTER TABLE pedidos_online ADD COLUMN metodo_pagamento VARCHAR(20) NULL AFTER comprovativo`)
    .catch((e: Error) => console.log("metodo_pagamento:", e.message));

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS gerencia (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      codigo VARCHAR(12) NOT NULL UNIQUE,
      itens JSON NOT NULL,
      total DOUBLE NOT NULL DEFAULT 0,
      pago TINYINT(1) NOT NULL DEFAULT 0,
      metodo VARCHAR(40) NULL,
      obs VARCHAR(255) NULL,
      usuario_id BIGINT UNSIGNED NOT NULL,
      criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`).catch((e: Error) => console.log("gerencia:", e.message));

  const c = await db.execute(sql`SHOW COLUMNS FROM pedidos_online LIKE 'metodo_pagamento'`);
  console.log("coluna metodo_pagamento:", ((c[0] as unknown) as unknown[]).length ? "OK" : "FALHOU");
  const t = await db.execute(sql`SHOW TABLES LIKE 'gerencia'`);
  console.log("tabela gerencia:", ((t[0] as unknown) as unknown[]).length ? "OK" : "FALHOU");
  process.exit(0);
}
main();
