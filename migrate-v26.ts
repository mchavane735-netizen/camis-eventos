import "dotenv/config";
import mysql from "mysql2/promise";

const c = await mysql.createConnection(process.env.DATABASE_URL!);
await c.execute("ALTER TABLE usuarios ADD COLUMN pode_reabrir_reserva TINYINT(1) NOT NULL DEFAULT 0");
console.log("v26 OK: usuarios.pode_reabrir_reserva");
await c.end();
