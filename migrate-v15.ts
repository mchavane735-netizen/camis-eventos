/* Migração v15 — stock fraccionário + reservas online por pessoas
   Executar uma vez: npx tsx db/migrate-v15.ts */
import { getDb } from "../api/queries/connection";
import { sql } from "drizzle-orm";

async function run() {
  const db = getDb();
  const alters = [
    "ALTER TABLE produtos MODIFY estoque_atual DOUBLE NOT NULL DEFAULT 0",
    "ALTER TABLE produtos ADD estoque_ref_id INT NULL",
    "ALTER TABLE produtos ADD fraccao DOUBLE NOT NULL DEFAULT 1",
    "ALTER TABLE produtos ADD qtd_decimal TINYINT(1) NOT NULL DEFAULT 0",
    "ALTER TABLE stock_mov MODIFY qtd DOUBLE NOT NULL",
    "ALTER TABLE pedido_itens MODIFY qtd DOUBLE NOT NULL DEFAULT 1",
    "ALTER TABLE pedidos_online ADD hora_agendada VARCHAR(5) NULL",
    "ALTER TABLE pedidos_online ADD pessoas INT NULL",
    "ALTER TABLE pedidos_online ADD vinda_confirmada TINYINT(1) NOT NULL DEFAULT 0",
  ];
  for (const a of alters) {
    try { await db.execute(sql.raw(a)); console.log("OK:", a); }
    catch (e: any) { console.log("SKIP/ERRO:", a, "-", e?.message?.slice(0, 120)); }
  }
  // grupos de stock partilhado: fracções apontam para o produto "mãe" (unidade inteira)
  const grupos: [number, number, number][] = [
    // [produtoId, refId (mãe), fracção]
    [116, 115, 0.25], [117, 115, 0.5],          // Frango
    [119, 118, 0.25], [120, 118, 0.5],          // Galinha Cafreal
    [122, 121, 0.25], [123, 121, 0.5],          // Galinha Zambeziana
    [127, 126, 0.25], [128, 126, 0.5],          // Pato
  ];
  for (const [id, ref, f] of grupos) {
    try {
      await db.execute(sql.raw(`UPDATE produtos SET estoque_ref_id=${ref}, fraccao=${f} WHERE id=${id}`));
      console.log(`OK: produto ${id} → ref ${ref} (${f})`);
    } catch (e: any) { console.log("ERRO update", id, e?.message?.slice(0, 120)); }
  }
  // carnes vendidas por kg (quantidade com decimais)
  try {
    await db.execute(sql.raw("UPDATE produtos SET qtd_decimal=1 WHERE id IN (162,163)"));
    console.log("OK: porco/vaca em kg com decimais");
  } catch (e: any) { console.log("ERRO kg", e?.message?.slice(0, 120)); }
  process.exit(0);
}
run().catch((e) => { console.error(e); process.exit(1); });
