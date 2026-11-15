/* ============================================================
   DÍVIDAS DE CLIENTES — FIADO (v19)
   · Uma dívida nasce no fecho da conta quando o cliente não paga tudo
     (ou é registada manualmente pela equipa).
   · Fica SEMPRE visível na página 🧾 Dívidas até ser paga por completo.
   · Pagamentos podem ser parciais; cada amortização entra no Financeiro
     do dia como receita ("Dívida DIV-XXXX").
   · A dívida só desaparece da lista de abertas quando o saldo chega a zero
     (status "Liquidada", com data de liquidação).
   ============================================================ */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { desc, eq, sql } from "drizzle-orm";
import { createRouter, publicQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { usuarios, dividas, dividasPagamentos, pagamentos, contadores, despesas } from "@db/schema";

const DIA = () => new Date(Date.now() + 2 * 3600e3).toISOString().slice(0, 10); // hora de Moçambique
const r2 = (n: number) => Math.round(n * 100) / 100;

async function requireUsuario(userId: number) {
  const u = await getDb().query.usuarios.findFirst({ where: eq(usuarios.id, userId) });
  if (!u || !u.ativo) throw new TRPCError({ code: "UNAUTHORIZED", message: "Utilizador inválido" });
  return u;
}

async function nextCodigo(chave: string, prefix: string) {
  const db = getDb();
  await db.insert(contadores).values({ chave, valor: 1 })
    .onDuplicateKeyUpdate({ set: { valor: sql`${contadores.valor} + 1` } });
  const c = await db.query.contadores.findFirst({ where: eq(contadores.chave, chave) });
  return prefix + String(c?.valor ?? 1).padStart(4, "0");
}

/** Soma já amortizada numa dívida */
async function pagoDe(dividaId: number): Promise<number> {
  const db = getDb();
  const rows = await db
    .select({ s: sql<number>`COALESCE(SUM(${dividasPagamentos.valor}),0)` })
    .from(dividasPagamentos)
    .where(eq(dividasPagamentos.dividaId, dividaId));
  return r2(Number(rows[0]?.s ?? 0));
}

/** Regista uma dívida (usada também pelo fecho de vendas em camis.ts) */
export async function registarDivida(opts: {
  pedidoId?: number | null;
  clienteNome: string;
  clienteTel?: string | null;
  obs?: string | null;
  valor: number;
  criadoPor: number;
}): Promise<{ codigo: string }> {
  const db = getDb();
  const codigo = await nextCodigo("divida", "DIV-");
  await db.insert(dividas).values({
    codigo,
    pedidoId: opts.pedidoId ?? null,
    clienteNome: opts.clienteNome.trim(),
    clienteTel: opts.clienteTel?.trim() || null,
    obs: opts.obs?.trim() || null,
    valorTotal: r2(opts.valor),
    status: "Aberta",
    dataDia: DIA(),
    criadoPor: opts.criadoPor,
  });
  return { codigo };
}

export const dividasRouter = createRouter({
  /** Lista todas as dívidas (abertas primeiro), com pago/saldo/dias em aberto */
  list: publicQuery
    .input(z.object({ usuarioId: z.number().int().positive() }))
    .query(async ({ input }) => {
      await requireUsuario(input.usuarioId);
      const db = getDb();
      const rows = await db.select().from(dividas).orderBy(desc(dividas.id)).limit(400);
      const hoje = DIA();
      const out = [];
      for (const d of rows) {
        const pago = await pagoDe(d.id);
        const saldo = r2(d.valorTotal - pago);
        const diasEmAberto = Math.max(0, Math.floor((Date.parse(hoje) - Date.parse(d.dataDia)) / 86400e3));
        out.push({ ...d, pago, saldo, diasEmAberto });
      }
      out.sort((a, b) => (a.status === b.status ? b.id - a.id : a.status === "Aberta" ? -1 : 1));
      return out;
    }),

  /** Resumo para o painel/badge: dívidas abertas e valor total em dívida */
  resumo: publicQuery
    .input(z.object({ usuarioId: z.number().int().positive() }))
    .query(async ({ input }) => {
      await requireUsuario(input.usuarioId);
      const db = getDb();
      const rows = await db.select().from(dividas).where(eq(dividas.status, "Aberta"));
      let total = 0;
      let maisAntiga: string | null = null;
      for (const d of rows) {
        total = r2(total + r2(d.valorTotal - (await pagoDe(d.id))));
        if (!maisAntiga || d.dataDia < maisAntiga) maisAntiga = d.dataDia;
      }
      // dívidas da empresa a fornecedores (despesas a crédito/em parcelas)
      const desps = await db.select().from(despesas);
      let fornAbertas = 0, fornTotal = 0;
      for (const d of desps) {
        const falta = r2(d.valor - (d.valorPago ?? 0));
        if (falta > 0.004) { fornAbertas++; fornTotal = r2(fornTotal + falta); }
      }
      return { abertas: rows.length, totalEmDivida: total, maisAntiga, fornAbertas, fornTotal };
    }),

  /** Dívidas da EMPRESA a fornecedores — despesas a crédito/em parcelas por pagar */
  fornecedores: publicQuery
    .input(z.object({ usuarioId: z.number().int().positive() }))
    .query(async ({ input }) => {
      await requireUsuario(input.usuarioId);
      const db = getDb();
      const rows = await db.select().from(despesas).orderBy(desc(despesas.id)).limit(400);
      const hoje = DIA();
      return rows
        .map((d) => {
          const saldo = r2(d.valor - (d.valorPago ?? 0));
          const diasEmAberto = Math.max(0, Math.floor((Date.parse(hoje) - Date.parse(d.dataDia)) / 86400e3));
          return { ...d, saldo, diasEmAberto };
        })
        .filter((d) => d.saldo > 0.004)
        .sort((a, b) => b.saldo - a.saldo || b.id - a.id);
    }),

  /** Registo manual de dívida (sem venda associada) */
  criar: publicQuery
    .input(z.object({
      usuarioId: z.number().int().positive(),
      clienteNome: z.string().min(2, "Indique o nome do cliente"),
      clienteTel: z.string().max(30).optional(),
      valor: z.number().positive("O valor deve ser maior que zero"),
      obs: z.string().max(255).optional(),
    }))
    .mutation(async ({ input }) => {
      const u = await requireUsuario(input.usuarioId);
      const { codigo } = await registarDivida({
        clienteNome: input.clienteNome,
        clienteTel: input.clienteTel,
        valor: input.valor,
        obs: input.obs,
        criadoPor: u.id,
      });
      return { ok: true as const, codigo };
    }),

  /** Amortização/pagamento (parcial ou total) — entra no Financeiro do dia */
  pagar: publicQuery
    .input(z.object({
      usuarioId: z.number().int().positive(),
      dividaId: z.number().int().positive(),
      valor: z.number().positive("O valor deve ser maior que zero"),
      metodo: z.string().min(2).max(160),
      // dia em que o valor foi EFECTIVAMENTE recebido (por defeito hoje) —
      // a receita entra no Financeiro DESSE dia, não do dia do registo no sistema
      dataDia: z.string().length(10).optional(),
    }))
    .mutation(async ({ input }) => {
      const u = await requireUsuario(input.usuarioId);
      const db = getDb();
      const d = await db.query.dividas.findFirst({ where: eq(dividas.id, input.dividaId) });
      if (!d) throw new TRPCError({ code: "NOT_FOUND", message: "Dívida não encontrada" });
      if (d.status === "Liquidada") throw new TRPCError({ code: "BAD_REQUEST", message: "Esta dívida já está liquidada." });
      const pago = await pagoDe(d.id);
      const saldo = r2(d.valorTotal - pago);
      const valor = r2(input.valor);
      if (valor - saldo > 0.009)
        throw new TRPCError({ code: "BAD_REQUEST", message: `O valor (${valor.toFixed(2)} MT) ultrapassa o saldo em dívida (${saldo.toFixed(2)} MT).` });

      // dia de entrada da receita: por defeito o momento actual; se o dinheiro foi
      // recebido noutro dia (registo atrasado), entra na receita DESSE dia.
      const quandoPag = input.dataDia ? new Date(input.dataDia + "T12:00:00+02:00") : new Date();
      if (input.dataDia && input.dataDia > DIA())
        throw new TRPCError({ code: "BAD_REQUEST", message: "A data de recebimento não pode ser futura." });

      await db.transaction(async (tx) => {
        await tx.insert(dividasPagamentos).values({
          dividaId: d.id, valor, metodo: input.metodo, usuarioId: u.id, criadoEm: quandoPag,
        });
        // receita do dia no Financeiro
        const codPag = await nextCodigo("pagamento", "PG-");
        await tx.insert(pagamentos).values({
          codigo: codPag,
          tipoVenda: `Dívida ${d.codigo} — ${d.clienteNome}`,
          cliente: d.clienteNome,
          valor,
          metodo: input.metodo,
          status: "Recebido",
          criadoEm: quandoPag,
        });
        if (r2(pago + valor) >= d.valorTotal - 0.009) {
          await tx.update(dividas)
            .set({ status: "Liquidada", liquidadaEm: new Date(Date.now() + 2 * 3600e3) })
            .where(eq(dividas.id, d.id));
        }
      });
      const novoSaldo = r2(saldo - valor);
      return { ok: true as const, liquidada: novoSaldo <= 0.009, saldo: Math.max(0, novoSaldo) };
    }),

  /** Histórico de amortizações de uma dívida */
  historico: publicQuery
    .input(z.object({ usuarioId: z.number().int().positive(), dividaId: z.number().int().positive() }))
    .query(async ({ input }) => {
      await requireUsuario(input.usuarioId);
      const db = getDb();
      const rows = await db.select({
        id: dividasPagamentos.id,
        valor: dividasPagamentos.valor,
        metodo: dividasPagamentos.metodo,
        criadoEm: dividasPagamentos.criadoEm,
        usuario: usuarios.nome,
      })
        .from(dividasPagamentos)
        .leftJoin(usuarios, eq(dividasPagamentos.usuarioId, usuarios.id))
        .where(eq(dividasPagamentos.dividaId, input.dividaId))
        .orderBy(desc(dividasPagamentos.id));
      return rows;
    }),

  /** Anular uma dívida registada por engano (Admin/Gestor; só sem pagamentos) */
  anular: publicQuery
    .input(z.object({ usuarioId: z.number().int().positive(), dividaId: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const u = await requireUsuario(input.usuarioId);
      if (!["Admin", "Gestor"].includes(u.perfil))
        throw new TRPCError({ code: "FORBIDDEN", message: "Ação reservada a: Admin, Gestor" });
      const db = getDb();
      const d = await db.query.dividas.findFirst({ where: eq(dividas.id, input.dividaId) });
      if (!d) throw new TRPCError({ code: "NOT_FOUND", message: "Dívida não encontrada" });
      const pago = await pagoDe(d.id);
      if (pago > 0)
        throw new TRPCError({ code: "BAD_REQUEST", message: "Esta dívida já tem pagamentos — não pode ser anulada." });
      await db.delete(dividas).where(eq(dividas.id, d.id));
      return { ok: true as const };
    }),
});
