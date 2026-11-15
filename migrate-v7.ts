/* Migração v7 — tabela avaliacoes (estrelas + comentário dos clientes online).
   Uso: npx tsx db/migrate-v7.ts  (idempotente) */
import { sql } from "drizzle-orm";
import { getDb } from "../api/queries/connection";

const db = getDb();

async function main() {
  await db
    .execute(
      sql`CREATE TABLE IF NOT EXISTS avaliacoes (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        pedido_online_id BIGINT UNSIGNED NOT NULL,
        cliente_nome VARCHAR(160) NOT NULL,
        estrelas INT NOT NULL,
        comentario VARCHAR(500),
        criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX aval_ped_idx (pedido_online_id)
      )`,
    )
    .catch((e: Error) => console.log("avaliacoes:", e.message));
  const t = await db.execute(sql`SHOW TABLES LIKE 'avaliacoes'`);
  console.log("tabela avaliacoes:", ((t[0] as unknown) as unknown[]).length ? "OK" : "FALHOU");
  process.exit(0);
}
main();
