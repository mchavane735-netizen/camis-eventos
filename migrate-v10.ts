/**
 * Migração v10 — Batch 6:
 * 1. usuarios: perfil enum += 'Entregador'; + telefone, tentativas, bloqueado, ultimo_ping
 * 2. clientes: + tentativas, bloqueado
 * 3. pedidos_online: metodo_pagamento VARCHAR(24); + atualizado_por, entregador_nome, entregador_tel
 * 4. pedidos: + fechado_por
 * 5. tabelas novas: despesa_anexos, entrega_solicitacoes
 * 6. config 'empresa': novos dados de pagamento (eMola, levantamento eMola, FNB) — sem M-Pesa
 */
import { getDb } from "../api/queries/connection";
import { sql } from "drizzle-orm";

async function main() {
  const db = getDb();

  // 1. usuarios
  await db.execute(sql`ALTER TABLE usuarios MODIFY perfil ENUM('Admin','Gestor','Logistica','Cozinheiro','Barman','Entregador') NOT NULL DEFAULT 'Logistica'`)
    .catch((e: Error) => console.log("usuarios.perfil:", e.message));
  await db.execute(sql`ALTER TABLE usuarios ADD COLUMN telefone VARCHAR(30) NULL`)
    .catch((e: Error) => console.log("usuarios.telefone:", e.message));
  await db.execute(sql`ALTER TABLE usuarios ADD COLUMN tentativas INT NOT NULL DEFAULT 0`)
    .catch((e: Error) => console.log("usuarios.tentativas:", e.message));
  await db.execute(sql`ALTER TABLE usuarios ADD COLUMN bloqueado TINYINT(1) NOT NULL DEFAULT 0`)
    .catch((e: Error) => console.log("usuarios.bloqueado:", e.message));
  await db.execute(sql`ALTER TABLE usuarios ADD COLUMN ultimo_ping TIMESTAMP NULL`)
    .catch((e: Error) => console.log("usuarios.ultimo_ping:", e.message));

  // 2. clientes
  await db.execute(sql`ALTER TABLE clientes ADD COLUMN tentativas INT NOT NULL DEFAULT 0`)
    .catch((e: Error) => console.log("clientes.tentativas:", e.message));
  await db.execute(sql`ALTER TABLE clientes ADD COLUMN bloqueado TINYINT(1) NOT NULL DEFAULT 0`)
    .catch((e: Error) => console.log("clientes.bloqueado:", e.message));

  // 3. pedidos_online
  await db.execute(sql`ALTER TABLE pedidos_online MODIFY metodo_pagamento VARCHAR(24) NULL`)
    .catch((e: Error) => console.log("ol.metodo:", e.message));
  await db.execute(sql`ALTER TABLE pedidos_online ADD COLUMN atualizado_por VARCHAR(120) NULL`)
    .catch((e: Error) => console.log("ol.atualizado_por:", e.message));
  await db.execute(sql`ALTER TABLE pedidos_online ADD COLUMN entregador_nome VARCHAR(120) NULL`)
    .catch((e: Error) => console.log("ol.entregador_nome:", e.message));
  await db.execute(sql`ALTER TABLE pedidos_online ADD COLUMN entregador_tel VARCHAR(30) NULL`)
    .catch((e: Error) => console.log("ol.entregador_tel:", e.message));

  // 4. pedidos
  await db.execute(sql`ALTER TABLE pedidos ADD COLUMN fechado_por VARCHAR(120) NULL`)
    .catch((e: Error) => console.log("pedidos.fechado_por:", e.message));

  // 5. tabelas novas
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS despesa_anexos (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      data_dia VARCHAR(10) NOT NULL,
      nota VARCHAR(255) NULL,
      imagem MEDIUMTEXT NULL,
      usuario_id BIGINT UNSIGNED NOT NULL,
      criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX dex_dia_idx (data_dia)
    )`).catch((e: Error) => console.log("despesa_anexos:", e.message));
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS entrega_solicitacoes (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      pedido_online_id BIGINT UNSIGNED NOT NULL,
      codigo VARCHAR(12) NOT NULL,
      taxa DOUBLE NOT NULL DEFAULT 0,
      estado ENUM('Aberta','Atribuida','Cancelada','Concluida') NOT NULL DEFAULT 'Aberta',
      entregador_id BIGINT UNSIGNED NULL,
      entregador_nome VARCHAR(120) NULL,
      criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX es_est_idx (estado)
    )`).catch((e: Error) => console.log("entrega_solicitacoes:", e.message));

  // 6. config empresa — novos métodos de pagamento
  const rows = await db.execute(sql`SELECT valor FROM config WHERE chave='empresa'`);
  const arr = ((rows[0] as unknown) as { valor: string }[]);
  if (arr.length) {
    const emp = JSON.parse(arr[0].valor);
    delete emp.mpesa; // M-Pesa removido
    emp.emola = "86 059 8335";
    emp.emolaTitular = "Milagre Chavane";
    emp.emolaLev = "461770";
    emp.emolaLevTitular = "Carla Chavane";
    emp.bancoTitular = "Cami's Eventos e Serviços";
    await db.execute(sql`UPDATE config SET valor=${JSON.stringify(emp)} WHERE chave='empresa'`);
    console.log("config empresa actualizada:", Object.keys(emp).join(","));
  }

  // verificação
  const u = await db.execute(sql`SHOW COLUMNS FROM usuarios LIKE 'ultimo_ping'`);
  console.log("usuarios.ultimo_ping:", ((u[0] as unknown) as unknown[]).length ? "OK" : "FALHOU");
  const c = await db.execute(sql`SHOW COLUMNS FROM clientes LIKE 'bloqueado'`);
  console.log("clientes.bloqueado:", ((c[0] as unknown) as unknown[]).length ? "OK" : "FALHOU");
  const p = await db.execute(sql`SHOW COLUMNS FROM pedidos LIKE 'fechado_por'`);
  console.log("pedidos.fechado_por:", ((p[0] as unknown) as unknown[]).length ? "OK" : "FALHOU");
  for (const t of ["despesa_anexos", "entrega_solicitacoes"]) {
    const r = await db.execute(sql.raw(`SHOW TABLES LIKE '${t}'`));
    console.log(`tabela ${t}:`, ((r[0] as unknown) as unknown[]).length ? "OK" : "FALHOU");
  }
  process.exit(0);
}
main();
