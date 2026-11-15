/**
 * CAMI'S EVENTOS — camis7: Conta Gerência
 * Regista o consumo dos proprietários/gerência. O stock é SEMPRE descontado,
 * mesmo quando o consumo não é pago. Se for pago (no acto ou mais tarde),
 * o valor entra nas receitas (tabela pagamentos, tipoVenda "Gerência GR-XXXX").
 */
import { baixarStockProduto } from "./camis3";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { desc, eq, sql } from "drizzle-orm";
import { createRouter, publicQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { contadores, gerencia, pagamentos, produtos, stockMov, usuarios, type DocItem } from "@db/schema";

async function requirePerfil(userId: number, perfis: string[]) {
  const u = await getDb().query.usuarios.findFirst({ where: eq(usuarios.id, userId) });
  if (!u || !u.ativo) throw new TRPCError({ code: "UNAUTHORIZED", message: "Utilizador inválido" });
  if (!perfis.includes(u.perfil))
    throw new TRPCError({ code: "FORBIDDEN", message: "Ação reservada a: " + perfis.join(", ") });
  return u;
}

const GESTAO = ["Admin", "Gestor"];

async function nextCodigo(chave: string, prefix: string) {
  const db = getDb();
  await db.insert(contadores).values({ chave, valor: 1 })
    .onDuplicateKeyUpdate({ set: { valor: sql`${contadores.valor} + 1` } });
  const c = await db.query.contadores.findFirst({ where: eq(contadores.chave, chave) });
  return prefix + String(c?.valor ?? 1).padStart(4, "0");
}

export const gerenciaRouter = createRouter({
  /** Regista um consumo da gerência/proprietários. Stock descontado SEMPRE. */
  registar: publicQuery
    .input(z.object({
      usuarioId: z.number().int().positive(),
      itens: z.array(z.object({ produtoId: z.number().int().positive(), qtd: z.number().int().min(1).max(500) })).min(1).max(60),
      pago: z.boolean().default(false),
      metodo: z.string().max(40).optional(),
      obs: z.string().max(255).optional(),
      dataConsumo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), // consumo atrasado: dia real do consumo (não pode ser futuro)
    }))
    .mutation(async ({ input }) => {
      const u = await requirePerfil(input.usuarioId, GESTAO);
      const db = getDb();
      const hojeMZ = new Date(Date.now() + 2 * 3600e3).toISOString().slice(0, 10);
      if (input.dataConsumo && input.dataConsumo > hojeMZ)
        throw new TRPCError({ code: "BAD_REQUEST", message: "A data do consumo não pode ser no futuro." });
      const atrasado = !!input.dataConsumo && input.dataConsumo !== hojeMZ;
      const itens: DocItem[] = [];
      for (const it of input.itens) {
        const p = await db.query.produtos.findFirst({ where: eq(produtos.id, it.produtoId) });
        if (!p || !p.ativo) throw new TRPCError({ code: "NOT_FOUND", message: "Produto não encontrado" });
        itens.push({ nome: p.nome, qtd: it.qtd, precoUnit: p.preco, total: Math.round(p.preco * it.qtd * 100) / 100 });
      }
      const total = Math.round(itens.reduce((a, i) => a + i.total, 0) * 100) / 100;
      const codigo = await nextCodigo("gerencia", "GR-");
      await db.transaction(async (tx) => {
        await tx.insert(gerencia).values({
          codigo, itens, total,
          dataConsumo: input.dataConsumo ?? null,
          pago: input.pago, metodo: input.pago ? (input.metodo || "Dinheiro") : null,
          obs: input.obs || null, usuarioId: u.id,
        });
        // baixa de stock — sempre, pago ou não (serviços não têm stock)
        for (let k = 0; k < input.itens.length; k++) {
          const p = await tx.query.produtos.findFirst({ where: eq(produtos.id, input.itens[k].produtoId) });
          if (p) await baixarStockProduto(tx, p, input.itens[k].qtd,
            `Gerência ${codigo}${atrasado ? ` (consumo de ${input.dataConsumo})` : ""}`, u.id);
        }
      });
      if (input.pago) {
        const cod = await nextCodigo("pagamento", "PG-");
        await db.insert(pagamentos).values({
          codigo: cod, tipoVenda: `Gerência ${codigo}`, cliente: "Conta Gerência",
          valor: total, metodo: input.metodo || "Dinheiro",
          // consumo atrasado já pago: a receita entra no dia do consumo (meio-dia em Maputo)
          ...(atrasado ? { criadoEm: new Date(input.dataConsumo + "T12:00:00+02:00") } : {}),
        });
      }
      return { ok: true, codigo, total };
    }),

  /** Marca um consumo como pago (a posteriori) — passa a contar nas receitas */
  marcarPago: publicQuery
    .input(z.object({
      usuarioId: z.number().int().positive(),
      id: z.number().int().positive(),
      metodo: z.string().min(2).max(40).default("Dinheiro"),
    }))
    .mutation(async ({ input }) => {
      await requirePerfil(input.usuarioId, GESTAO);
      const db = getDb();
      const g = await db.query.gerencia.findFirst({ where: eq(gerencia.id, input.id) });
      if (!g) throw new TRPCError({ code: "NOT_FOUND", message: "Registo não encontrado" });
      if (g.pago) throw new TRPCError({ code: "BAD_REQUEST", message: "Este consumo já foi pago" });
      await db.update(gerencia).set({ pago: true, metodo: input.metodo }).where(eq(gerencia.id, g.id));
      const cod = await nextCodigo("pagamento", "PG-");
      await db.insert(pagamentos).values({
        codigo: cod, tipoVenda: `Gerência ${g.codigo}`, cliente: "Conta Gerência",
        valor: g.total, metodo: input.metodo,
      });
      return { ok: true };
    }),

  /** Lista os consumos da gerência (mais recentes primeiro) + totais */
  list: publicQuery
    .input(z.object({ usuarioId: z.number().int().positive() }))
    .query(async ({ input }) => {
      await requirePerfil(input.usuarioId, GESTAO);
      const db = getDb();
      const rows = await db.select().from(gerencia).orderBy(desc(gerencia.criadoEm)).limit(100);
      const comNome = await Promise.all(rows.map(async (g) => {
        const u = await db.query.usuarios.findFirst({ where: eq(usuarios.id, g.usuarioId) });
        return { ...g, usuarioNome: u?.nome ?? "—" };
      }));
      const totGeral = Math.round(rows.reduce((a, g) => a + g.total, 0) * 100) / 100;
      const totPago = Math.round(rows.filter((g) => g.pago).reduce((a, g) => a + g.total, 0) * 100) / 100;
      return { rows: comNome, totGeral, totPago, totPorPagar: Math.round((totGeral - totPago) * 100) / 100 };
    }),
});
