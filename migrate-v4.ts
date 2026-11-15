import { getDb } from "../api/queries/connection";
import { sql } from "drizzle-orm";
import { HORARIOS_PADRAO, BAIRROS_CHIMOIO } from "../contracts/types";

async function main() {
  const db = getDb();
  // senha forte: PIN -> senha (até 60 chars); novo perfil Cozinha
  await db.execute(sql`ALTER TABLE usuarios MODIFY COLUMN pin varchar(60) NOT NULL`).catch((e) => console.log("pin:", e.message));
  await db.execute(sql`ALTER TABLE usuarios MODIFY COLUMN perfil enum('Admin','Gestor','Vendedor','Cozinha') NOT NULL DEFAULT 'Vendedor'`).catch((e) => console.log("perfil:", e.message));
  // pedidos online: coordenadas do mapa + watchdog de atraso
  await db.execute(sql`ALTER TABLE pedidos_online ADD COLUMN lat double NULL AFTER comprovativo`).catch((e) => console.log("lat:", e.message));
  await db.execute(sql`ALTER TABLE pedidos_online ADD COLUMN lng double NULL AFTER lat`).catch((e) => console.log("lng:", e.message));
  await db.execute(sql`ALTER TABLE pedidos_online ADD COLUMN atraso_notificado timestamp NULL AFTER fim_estimado`).catch((e) => console.log("atraso:", e.message));
  // config: horários de funcionamento + bairros de Chimoio (JSON editável pelo Admin)
  await db.execute(sql`INSERT INTO config (chave, valor) VALUES ('horarios', ${JSON.stringify(HORARIOS_PADRAO)}) ON DUPLICATE KEY UPDATE valor = valor`);
  await db.execute(sql`INSERT INTO config (chave, valor) VALUES ('bairros', ${JSON.stringify(BAIRROS_CHIMOIO)}) ON DUPLICATE KEY UPDATE valor = valor`);
  const cols = await db.execute(sql`SHOW COLUMNS FROM usuarios`);
  console.log("usuarios:", (cols[0] as unknown as any[]).map((c) => `${c.Field}:${c.Type}`).join(", "));
  const cols2 = await db.execute(sql`SHOW COLUMNS FROM pedidos_online`);
  console.log("pedidos_online:", (cols2[0] as unknown as any[]).map((c) => c.Field).join(", "));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
