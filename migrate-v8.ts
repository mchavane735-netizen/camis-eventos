/* Migração v8 — estado "Aguarda Consumo" nos pedidos online (reservas).
   Uso: npx tsx db/migrate-v8.ts  (idempotente) */
import { sql } from "drizzle-orm";
import { getDb } from "../api/queries/connection";

const db = getDb();

async function main() {
  await db
    .execute(
      sql`ALTER TABLE pedidos_online MODIFY status ENUM(
        'Pendente','Comprovativo Enviado','Aguarda Consumo','Confirmado','Em Preparo',
        'Pronto','Em Entrega','Entregue','Concluído','Cancelado'
      ) NOT NULL DEFAULT 'Pendente'`,
    )
    .catch((e: Error) => console.log("status enum:", e.message));
  const c = await db.execute(sql`SHOW COLUMNS FROM pedidos_online LIKE 'status'`);
  console.log("coluna status:", JSON.stringify((c[0] as unknown as unknown[])[0]).slice(0, 220));
  process.exit(0);
}
main();
