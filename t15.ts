import { getDb } from "../api/queries/connection";
import { pedidosOnline, produtos } from "./schema";
import { eq } from "drizzle-orm";
async function main() {
  const db = getDb();
  const agora = new Date(Date.now() + 2*3600e3);
  const pad = (n:number)=>String(n).padStart(2,"0");
  const data = `${agora.getUTCFullYear()}-${pad(agora.getUTCMonth()+1)}-${pad(agora.getUTCDate())}`;
  const hora = `${pad(agora.getUTCHours()+2)}:${pad(agora.getUTCMinutes())}`;
  await db.update(pedidosOnline).set({ dataAgendada: data, horaAgendada: hora }).where(eq(pedidosOnline.codigo,"OL-0047"));
  const p = await db.query.produtos.findFirst({ where: eq(produtos.id, 115) });
  console.log("data/hora:", data, hora, "| frango-inteiro stock antes:", p?.estoqueAtual);
  process.exit(0);
}
main();
