import "dotenv/config";
import mysql from "mysql2/promise";
const c = await mysql.createConnection(process.env.DATABASE_URL!);
await c.execute("ALTER TABLE usuarios ADD COLUMN pode_editar_stock TINYINT(1) NOT NULL DEFAULT 0");
console.log("v28 OK: usuarios.pode_editar_stock");
await c.end();
