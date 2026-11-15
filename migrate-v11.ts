/**
 * Migração v11 — adiciona a coluna `obs` a pedido_itens
 * (acompanhamentos escolhidos nos pratos de aves/carnes/peixe/marisco).
 */
import { getDb } from "../api/queries/connection";

const db = await getDb();
await db.execute(`ALTER TABLE pedido_itens ADD COLUMN obs VARCHAR(255) NULL AFTER qtd`).catch((e: Error) => {
  if (!e.message.includes("Duplicate column")) throw e;
});
const [r] = await db.execute("SHOW COLUMNS FROM pedido_itens LIKE 'obs'") as unknown as [unknown[]];
console.log("obs:", r.length ? "OK" : "FALHOU");
process.exit(0);
