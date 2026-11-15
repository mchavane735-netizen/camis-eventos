import "dotenv/config";
import mysql from "mysql2/promise";
const c = await mysql.createConnection(process.env.DATABASE_URL!);
await c.execute("ALTER TABLE usuarios MODIFY COLUMN perfil ENUM('Admin','Gestor','Vendedor','Cozinha','Logistica','Entregador','RH') NOT NULL DEFAULT 'Vendedor'");
console.log("v29 OK: perfil RH");
await c.end();
