import { getDb } from "../api/queries/connection";
import { sql } from "drizzle-orm";

async function main() {
  const db = getDb();
  await db.execute(sql`ALTER TABLE produtos ADD COLUMN foto mediumtext NULL AFTER preco`).catch((e) => console.log("foto:", e.message));
  await db.execute(sql`CREATE TABLE IF NOT EXISTS clientes (
    id bigint unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY,
    nome varchar(160) NOT NULL,
    telefone varchar(30) NOT NULL UNIQUE,
    email varchar(160),
    senha_hash varchar(128) NOT NULL,
    criado_em timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  await db.execute(sql`CREATE TABLE IF NOT EXISTS cliente_tokens (
    id bigint unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY,
    token varchar(80) NOT NULL UNIQUE,
    cliente_id bigint unsigned NOT NULL,
    criado_em timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  await db.execute(sql`CREATE TABLE IF NOT EXISTS pedidos_online (
    id bigint unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY,
    codigo varchar(12) NOT NULL UNIQUE,
    cliente_id bigint unsigned,
    cliente_nome varchar(160) NOT NULL,
    cliente_telefone varchar(30) NOT NULL,
    cliente_email varchar(160),
    tipo enum('Local','Delivery','TakeAway','Reserva') NOT NULL,
    mesa varchar(20),
    endereco text,
    data_agendada varchar(10),
    itens json NOT NULL,
    subtotal double NOT NULL DEFAULT 0,
    taxa_entrega double NOT NULL DEFAULT 0,
    total double NOT NULL DEFAULT 0,
    adiant double NOT NULL DEFAULT 0,
    status enum('Pendente','Comprovativo Enviado','Confirmado','Em Preparo','Pronto','Em Entrega','Entregue','Concluído','Cancelado') NOT NULL DEFAULT 'Pendente',
    comprovativo mediumtext,
    tempo_estimado int,
    inicio_estimado varchar(5),
    fim_estimado varchar(5),
    criado_em timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    atualizado_em timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX ol_tel_idx (cliente_telefone),
    INDEX ol_status_idx (status)
  )`);
  await db.execute(sql`CREATE TABLE IF NOT EXISTS notificacoes (
    id bigint unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY,
    pedido_online_id bigint unsigned NOT NULL,
    telefone varchar(30) NOT NULL,
    mensagem text NOT NULL,
    criado_em timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX not_ped_idx (pedido_online_id)
  )`);
  const r = await db.execute(sql`SHOW TABLES`);
  console.log("tabelas:", (r[0] as unknown as any[]).map((x) => Object.values(x)[0]).join(", "));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
