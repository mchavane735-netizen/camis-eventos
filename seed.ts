import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { getDb } from "../api/queries/connection";
import { usuarios, produtos, contadores } from "./schema";

const __dirname = dirname(fileURLToPath(import.meta.url));

type SeedProd = {
  codigo: string; nome: string; categoria: string;
  tipo: "Bebida" | "Refeição" | "Serviço";
  preco: number; estoqueMin: number; estoqueAtual: number;
};

async function seed() {
  const db = getDb();
  console.log("Seeding database...");

  // Utilizadores (só insere se a tabela estiver vazia)
  const us = await db.query.usuarios.findMany();
  if (us.length === 0) {
    await db.insert(usuarios).values([
      { nome: "Administrador", perfil: "Admin", pin: "1234" },
      { nome: "Gerente", perfil: "Gestor", pin: "2345" },
      { nome: "Vendedor 1", perfil: "Vendedor", pin: "3456" },
    ]);
    console.log("✔ 3 utilizadores criados (PINs: 1234 / 2345 / 3456)");
  } else {
    console.log(`• utilizadores já existem (${us.length}) — ignorado`);
  }

  // Produtos (só insere se a tabela estiver vazia)
  const ps = await db.query.produtos.findMany();
  if (ps.length === 0) {
    const data: SeedProd[] = JSON.parse(
      readFileSync(join(__dirname, "seed-data.json"), "utf-8"),
    );
    const CHUNK = 50;
    for (let i = 0; i < data.length; i += CHUNK) {
      await db.insert(produtos).values(data.slice(i, i + CHUNK));
    }
    console.log(`✔ ${data.length} produtos inseridos`);
  } else {
    console.log(`• produtos já existem (${ps.length}) — ignorado`);
  }

  // Contadores de códigos sequenciais
  const cs = await db.query.contadores.findMany();
  if (cs.length === 0) {
    await db.insert(contadores).values([
      { chave: "reserva", valor: 0 },
      { chave: "piscina", valor: 0 },
      { chave: "pagamento", valor: 0 },
    ]);
    console.log("✔ contadores criados");
  }

  console.log("Done.");
  process.exit(0);
}

seed().catch((e) => { console.error(e); process.exit(1); });
