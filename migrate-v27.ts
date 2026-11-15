import "dotenv/config";
import mysql from "mysql2/promise";

const c = await mysql.createConnection(process.env.DATABASE_URL!);
await c.execute(`CREATE TABLE IF NOT EXISTS trabalho_vagas (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  codigo VARCHAR(12) NOT NULL UNIQUE,
  data_trabalho VARCHAR(10) NOT NULL,
  hora_inicio VARCHAR(5),
  area ENUM('Restaurante','Decoração','Catering','Apoio em eventos') NOT NULL,
  descricao VARCHAR(255),
  vagas INT NOT NULL DEFAULT 1,
  diaria DOUBLE NOT NULL DEFAULT 500,
  limite_aceite VARCHAR(16),
  status ENUM('Aberta','Preenchida','Cancelada','Concluída') NOT NULL DEFAULT 'Aberta',
  criado_por VARCHAR(120),
  criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
)`);
await c.execute(`CREATE TABLE IF NOT EXISTS trabalho_vaga_destinos (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  vaga_id BIGINT UNSIGNED NOT NULL,
  afiliado_id BIGINT UNSIGNED NOT NULL,
  estado ENUM('Pendente','Aceite','Recusado') NOT NULL DEFAULT 'Pendente',
  resposta_em TIMESTAMP NULL,
  criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX tvd_vgaf_idx (vaga_id, afiliado_id)
)`);
console.log("v27 OK: trabalho_vagas + trabalho_vaga_destinos");
await c.end();
