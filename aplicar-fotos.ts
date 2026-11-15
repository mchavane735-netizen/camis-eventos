/** Aplica fotos geradas por IA aos produtos sem foto (one-off). */
import { readFileSync } from "fs";
import { eq } from "drizzle-orm";
import { produtos } from "@db/schema";
import { getDb } from "../api/queries/connection.js";

async function main() {
  const mapa = JSON.parse(readFileSync("/tmp/fotos-map.json", "utf8")) as Array<{ id: number; foto: string }>;
  const db = await getDb();
  let n = 0;
  for (const m of mapa) {
    await db.update(produtos).set({ foto: m.foto }).where(eq(produtos.id, m.id));
    n++;
  }
  console.log(`Fotos aplicadas a ${n} produtos.`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
