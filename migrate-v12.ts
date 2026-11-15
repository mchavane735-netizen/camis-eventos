import { getDb } from "../api/queries/connection";
import { sql } from "drizzle-orm";

async function main() {
  const db = getDb();
  const add = async (ddl: string, col: string) => {
    const [rows]: any = await db.execute(sql`SHOW COLUMNS FROM reservas LIKE ${col}`);
    if (Array.isArray(rows) && rows.length > 0) { console.log(`✓ ${col} já existe`); return; }
    await db.execute(sql.raw(ddl));
    console.log(`+ ${col} adicionada`);
  };
  await add("ALTER TABLE reservas ADD COLUMN tipo_outro VARCHAR(160) NULL AFTER tipo", "tipo_outro");
  await add("ALTER TABLE reservas ADD COLUMN pacote_nome VARCHAR(160) NULL AFTER servicos", "pacote_nome");
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
