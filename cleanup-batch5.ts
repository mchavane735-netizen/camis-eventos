import { getDb } from "../api/queries/connection";
import { sql } from "drizzle-orm";

async function main() {
  const db = getDb();
  // pedidos de teste
  const rows = await db.execute(sql`SELECT id FROM pedidos_online WHERE codigo IN ('OL-0024','OL-0025')`);
  const ids = ((rows[0] as unknown) as Array<{ id: number }>).map((r) => r.id);
  for (const id of ids) {
    await db.execute(sql`DELETE FROM notificacoes WHERE pedido_online_id = ${id}`);
    await db.execute(sql`DELETE FROM avaliacoes WHERE pedido_online_id = ${id}`);
    await db.execute(sql`DELETE FROM pedidos_online WHERE id = ${id}`);
  }
  await db.execute(sql`DELETE FROM pagamentos WHERE tipo_venda IN ('Online OL-0024','Online OL-0025','Gerência GR-0001')`);
  await db.execute(sql`DELETE FROM gerencia WHERE codigo = 'GR-0001'`);
  await db.execute(sql`DELETE FROM stock_mov WHERE obs LIKE 'Online OL-0024%' OR obs LIKE 'Online OL-0025%' OR obs = 'Gerência GR-0001'`);
  // repõe stock dos produtos usados nos testes (84 já reposto pelo cancelamento; 83 e 85 ainda descontados)
  await db.execute(sql`UPDATE produtos SET estoque_atual = estoque_atual + 1 WHERE id = 83`);
  await db.execute(sql`UPDATE produtos SET estoque_atual = estoque_atual + 3 WHERE id = 85`);
  await db.execute(sql`UPDATE contadores SET valor = 0 WHERE chave = 'gerencia'`);
  console.log("limpeza OK, pedidos removidos:", ids.length);
  process.exit(0);
}
main();
