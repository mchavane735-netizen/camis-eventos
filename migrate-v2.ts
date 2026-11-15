import { eq } from "drizzle-orm";
import { getDb } from "../api/queries/connection";
import { config, produtos } from "./schema";
import { EMPRESA } from "../contracts/types";

const db = getDb();

// 1) Dados da empresa → tabela config (só preenche chaves em falta)
for (const [chave, valor] of Object.entries(EMPRESA)) {
  const ex = await db.query.config.findFirst({ where: eq(config.chave, chave) });
  if (!ex) await db.insert(config).values({ chave, valor: String(valor) });
}
console.log("config OK");

// 2) Piscina & Parque passam a ser produtos do menu (tipo Serviço — sem stock)
const piscinaProds = [
  { nome: "Piscina — Adulto", preco: 250 },
  { nome: "Piscina — Criança", preco: 150 },
  { nome: "Parque Infantil (por criança)", preco: 100 },
];
const existentes = await db.select({ nome: produtos.nome, codigo: produtos.codigo }).from(produtos);
let max = 0;
for (const r of existentes) {
  const n = parseInt(r.codigo.replace(/\D/g, ""), 10);
  if (!isNaN(n) && n > max) max = n;
}
for (const p of piscinaProds) {
  if (existentes.some((e) => e.nome === p.nome)) { console.log("já existe:", p.nome); continue; }
  max += 1;
  const codigo = "PROD-" + String(max).padStart(3, "0");
  await db.insert(produtos).values({
    codigo, nome: p.nome, categoria: "Piscina & Parque", tipo: "Serviço", preco: p.preco,
  });
  console.log("criado:", codigo, p.nome);
}
process.exit(0);
