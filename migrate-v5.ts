/**
 * Migração v5 (one-off):
 * - pedido_itens.produto_id passa a aceitar NULL (itens personalizados fora do menu)
 * - pedidos + adiant_deduzido + area (local onde o cliente está sentado)
 * - pedidos_online + proposta (JSON: itens rejeitados/substitutos aguardando o cliente)
 */
import { sql } from "drizzle-orm";
import { getDb } from "../api/queries/connection.js";

async function main() {
  const db = await getDb();
  await db.execute(sql`ALTER TABLE pedido_itens MODIFY COLUMN produto_id BIGINT UNSIGNED NULL`).catch((e) => console.log("produto_id:", e.message));
  await db.execute(sql`ALTER TABLE pedidos ADD COLUMN adiant_deduzido DOUBLE NOT NULL DEFAULT 0 AFTER reserva_id`).catch((e) => console.log("adiant_deduzido:", e.message));
  await db.execute(sql`ALTER TABLE pedidos ADD COLUMN area VARCHAR(80) NULL AFTER adiant_deduzido`).catch((e) => console.log("area:", e.message));
  await db.execute(sql`ALTER TABLE pedidos_online ADD COLUMN proposta JSON NULL AFTER atraso_notificado`).catch((e) => console.log("proposta:", e.message));
  const cols = await db.execute(sql`SHOW COLUMNS FROM pedidos`);
  console.log("pedidos:", (cols[0] as unknown as Array<{ Field: string }>).map((c) => c.Field).join(", "));
  console.log("Migração v5 concluída.");
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
