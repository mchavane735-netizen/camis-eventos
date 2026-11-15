import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { createRouter, publicQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { config, despesaAnexos, despesaPagamentos, despesas, pagamentos, pedidos, pedidoItens, piscina, pedidosOnline, produtos, stockMov, usuarios, reservas, afiliadoComissoes, agenteMovimentos } from "@db/schema";
import { CATS_DESPESA } from "@contracts/types";
import { getEmpresa } from "./camis3";

/* ---------- helpers ---------- */
async function requirePerfil(userId: number, perfis: string[]) {
  const u = await getDb().query.usuarios.findFirst({ where: eq(usuarios.id, userId) });
  if (!u || !u.ativo) throw new TRPCError({ code: "UNAUTHORIZED", message: "Utilizador inválido" });
  if (!perfis.includes(u.perfil))
    throw new TRPCError({ code: "FORBIDDEN", message: "Ação reservada a: " + perfis.join(", ") });
  return u;
}

/** Dia (YYYY-MM-DD) em Moçambique (UTC+2) de uma data/hora */
export const mzDia = (d: Date | string) =>
  new Date(new Date(d).getTime() + 2 * 3600e3).toISOString().slice(0, 10);

const DIA = () => mzDia(new Date());

const GESTAO = ["Admin", "Gestor"];
const LANCA_DESPESAS = ["Admin", "Gestor", "Logistica"];

const r2 = (n: number) => Math.round(n * 100) / 100;

/* ============================================================
   AGENTE eMola / M-Pesa — a CAMI'S é agente; cada levantamento
   ou depósito do cliente gera uma comissão para a empresa
   ============================================================ */
export const agenteRouter = createRouter({
  /** Registar um movimento de cliente (levantamento ou depósito) — comissão automática
      calculada com a taxa configurada em Configurações (snapshot guardado no registo) */
  registar: publicQuery
    .input(z.object({
      usuarioId: z.number().int().positive(),
      sistema: z.enum(["eMola", "Mpesa"]),
      tipo: z.enum(["Levantamento", "Deposito"]),
      valor: z.number().positive().max(1000000),
    }))
    .mutation(async ({ input }) => {
      const u = await requirePerfil(input.usuarioId, ["Admin", "Gestor", "Vendedor"]);
      const emp = await getEmpresa();
      const chave = `taxaAgente${input.sistema === "eMola" ? "Emola" : "Mpesa"}${input.tipo === "Levantamento" ? "Lev" : "Dep"}` as keyof typeof emp;
      const taxaPct = Number(emp[chave]) || 0;
      const comissao = r2((input.valor * taxaPct) / 100);
      await getDb().insert(agenteMovimentos).values({
        dataDia: DIA(), sistema: input.sistema, tipo: input.tipo,
        valor: r2(input.valor), taxaPct, comissao, usuarioId: u.id,
      });
      return { ok: true, taxaPct, comissao };
    }),

  /** Movimentos de um dia (por defeito hoje) + totais de comissão por sistema */
  listar: publicQuery
    .input(z.object({ usuarioId: z.number().int().positive(), dataDia: z.string().length(10).optional() }))
    .query(async ({ input }) => {
      await requirePerfil(input.usuarioId, ["Admin", "Gestor", "Vendedor"]);
      const dia = input.dataDia || DIA();
      const db = getDb();
      const movs = await db.select().from(agenteMovimentos)
        .where(eq(agenteMovimentos.dataDia, dia)).orderBy(desc(agenteMovimentos.criadoEm));
      const out = await Promise.all(movs.map(async (m) => {
        const us = await db.query.usuarios.findFirst({ where: eq(usuarios.id, m.usuarioId) });
        return { ...m, usuarioNome: us?.nome ?? "—" };
      }));
      const comissao = r2(out.reduce((a, m) => a + m.comissao, 0));
      return {
        itens: out, comissao,
        valorTotal: r2(out.reduce((a, m) => a + m.valor, 0)),
      };
    }),

  /** Comissões ainda por receber, agrupadas por mês (a operadora paga na 1ª semana do mês seguinte) */
  pendentes: publicQuery
    .input(z.object({ usuarioId: z.number().int().positive() }))
    .query(async ({ input }) => {
      await requirePerfil(input.usuarioId, ["Admin", "Gestor", "Vendedor"]);
      const todos = await getDb().select().from(agenteMovimentos);
      const porMes = new Map<string, { comissao: number; valor: number; n: number }>();
      for (const m of todos) {
        if (m.recebidoEm) continue;
        const mes = m.dataDia.slice(0, 7);
        const cur = porMes.get(mes) ?? { comissao: 0, valor: 0, n: 0 };
        porMes.set(mes, { comissao: r2(cur.comissao + m.comissao), valor: r2(cur.valor + m.valor), n: cur.n + 1 });
      }
      return [...porMes.entries()].map(([mes, v]) => ({ mes, ...v })).sort((a, b) => (a.mes < b.mes ? -1 : 1));
    }),

  /** Confirmar o RECEBIMENTO das comissões de um mês (GESTAO) —
      a partir daqui contam como receita do dia em que foram recebidas */
  receber: publicQuery
    .input(z.object({ usuarioId: z.number().int().positive(), mes: z.string().regex(/^\d{4}-\d{2}$/) }))
    .mutation(async ({ input }) => {
      await requirePerfil(input.usuarioId, GESTAO);
      const db = getDb();
      const todos = await db.select().from(agenteMovimentos);
      const doMes = todos.filter((m) => !m.recebidoEm && m.dataDia.startsWith(input.mes));
      if (!doMes.length) throw new TRPCError({ code: "BAD_REQUEST", message: "Não há comissões por receber neste mês" });
      const total = r2(doMes.reduce((a, m) => a + m.comissao, 0));
      const hoje = DIA();
      for (const m of doMes)
        await db.update(agenteMovimentos).set({ recebidoEm: hoje }).where(eq(agenteMovimentos.id, m.id));
      return { ok: true, total, n: doMes.length, recebidoEm: hoje };
    }),

  /** Remover um movimento registado por engano (Admin/Gestor) */
  eliminar: publicQuery
    .input(z.object({ usuarioId: z.number().int().positive(), id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      await requirePerfil(input.usuarioId, GESTAO);
      await getDb().delete(agenteMovimentos).where(eq(agenteMovimentos.id, input.id));
      return { ok: true };
    }),
});

/* Categorias de despesa consideradas CUSTO FIXO por defeito */
const CATS_CUSTO_FIXO = ["Salários & Pessoal", "Energia Eléctrica", "Água", "Comunicações (Net/Telefone)", "Renda & Arrendamento", "Seguros & Licenças"];

/* ============================================================
   DESPESAS DIÁRIAS — lançadas pela Logística / Gestão
   ============================================================ */
export const despesasRouter = createRouter({
  criar: publicQuery
    .input(z.object({
      usuarioId: z.number().int().positive(),
      dataDia: z.string().length(10).optional(), // por defeito: hoje
      categoria: z.enum(CATS_DESPESA),
      descricao: z.string().min(2).max(255),
      fornecedor: z.string().max(160).optional(),
      fornecedorTel: z.string().max(30).optional(), // contacto do fornecedor (cobranças/combinados)
      valor: z.number().min(0.01),
      tipoCusto: z.enum(["Fixo", "Variavel"]).optional(),
      // pagamento: total à vista, a crédito (nada pago) ou em parcelas (valorPago parcial)
      formaPagamento: z.enum(["Pago", "Credito", "Parcelado"]).optional(),
      valorPago: z.number().min(0).optional(),
      // compra de mercadoria → entrada automática no stock
      produtoId: z.number().int().positive().optional(),
      quantidade: z.number().min(0.01).optional(),
    }))
    .mutation(async ({ input }) => {
      const u = await requirePerfil(input.usuarioId, LANCA_DESPESAS);
      const db = getDb();
      let categoria: string = input.categoria;
      const tipoCusto = input.tipoCusto ?? (CATS_CUSTO_FIXO.includes(input.categoria) ? "Fixo" : "Variavel");
      const formaPagamento = input.formaPagamento ?? "Pago";
      // quanto fica pago já: Pago = tudo · Crédito = 0 · Parcelado = valor parcial
      let valorPago = formaPagamento === "Pago" ? r2(input.valor) : formaPagamento === "Credito" ? 0 : r2(input.valorPago ?? 0);
      if (formaPagamento === "Parcelado" && !(valorPago > 0 && valorPago < input.valor))
        throw new TRPCError({ code: "BAD_REQUEST", message: "Pagamento em parcelas: o valor já pago deve ser maior que 0 e menor que o total." });
      if (valorPago > input.valor) valorPago = r2(input.valor);
      let stockMsg: string | null = null;
      // entrada automática no stock quando a despesa é uma compra de produto controlável
      if (input.produtoId && input.quantidade) {
        const prod = await db.query.produtos.findFirst({ where: eq(produtos.id, input.produtoId) });
        if (!prod) throw new TRPCError({ code: "NOT_FOUND", message: "Produto não encontrado" });
        if (prod.tipo === "Serviço") throw new TRPCError({ code: "BAD_REQUEST", message: "Serviços não têm stock — escolha um produto controlável (bebida, frango, peixe…)" });
        // a área da compra segue o produto: bebidas → Compras — Bar · comida → Compras — Cozinha
        // (evita lançar produtos do bar na cozinha e vice-versa)
        const area = prod.tipo === "Bebida" ? "Compras — Bar" : prod.tipo === "Refeição" ? "Compras — Cozinha" : null;
        if (area && categoria.startsWith("Compras") && categoria !== area) categoria = area;
        const alvo = prod.estoqueRefId ?? prod.id;
        const delta = Math.round(input.quantidade * (prod.fraccao ?? 1) * 10000) / 10000;
        await db.update(produtos)
          .set({ estoqueAtual: sql`${produtos.estoqueAtual} + ${delta}` })
          .where(eq(produtos.id, alvo));
        await db.insert(stockMov).values({
          produtoId: prod.id, qtd: input.quantidade, tipo: "entrada",
          obs: `Compra — ${input.descricao.trim().slice(0, 180)}`,
          usuarioId: u.id,
        });
        // se a despesa trouxer o custo real por unidade, actualiza o preço de compra do produto
        const custoUnit = r2(input.valor / input.quantidade);
        if (custoUnit > 0 && custoUnit !== prod.precoCompra)
          await db.update(produtos).set({ precoCompra: custoUnit }).where(eq(produtos.id, alvo));
        stockMsg = `Stock de «${prod.nome}» +${input.quantidade}`;
      }
      const [{ id }] = await db.insert(despesas).values({
        dataDia: input.dataDia || DIA(),
        categoria,
        descricao: input.descricao.trim(),
        fornecedor: input.fornecedor?.trim() || null,
        fornecedorTel: input.fornecedorTel?.trim() || null,
        valor: r2(input.valor),
        tipoCusto,
        formaPagamento: valorPago >= r2(input.valor) ? "Pago" : formaPagamento,
        valorPago,
        produtoId: input.produtoId ?? null,
        quantidade: input.quantidade ?? null,
        usuarioId: u.id,
      }).$returningId();
      // regista a primeira parcela no histórico de pagamentos da despesa
      if (valorPago > 0)
        await db.insert(despesaPagamentos).values({ despesaId: id, valor: valorPago, dataDia: DIA(), usuarioId: u.id });
      return { ok: true, id, stockMsg, categoria };
    }),

  /** Definir/actualizar nome e contacto do fornecedor (ex.: dívida já lançada sem contacto) */
  fornecedorContacto: publicQuery
    .input(z.object({
      usuarioId: z.number().int().positive(),
      id: z.number().int().positive(),
      fornecedor: z.string().min(2).max(160),
      fornecedorTel: z.string().max(30).optional(),
    }))
    .mutation(async ({ input }) => {
      await requirePerfil(input.usuarioId, GESTAO);
      const db = getDb();
      await db.update(despesas).set({
        fornecedor: input.fornecedor.trim(),
        fornecedorTel: input.fornecedorTel?.trim() || null,
      }).where(eq(despesas.id, input.id));
      return { ok: true };
    }),

  /** Amortizar uma despesa a crédito/em parcelas (regista pagamento e actualiza o pago) */
  amortizar: publicQuery
    .input(z.object({
      usuarioId: z.number().int().positive(),
      id: z.number().int().positive(),
      valor: z.number().min(0.01),
    }))
    .mutation(async ({ input }) => {
      const u = await requirePerfil(input.usuarioId, GESTAO);
      const db = getDb();
      const d = await db.query.despesas.findFirst({ where: eq(despesas.id, input.id) });
      if (!d) throw new TRPCError({ code: "NOT_FOUND", message: "Despesa não encontrada" });
      const falta = r2(d.valor - (d.valorPago ?? 0));
      if (falta <= 0) throw new TRPCError({ code: "BAD_REQUEST", message: "Esta despesa já está paga na totalidade." });
      const pago = Math.min(r2(input.valor), falta);
      const novoPago = r2((d.valorPago ?? 0) + pago);
      await db.update(despesas).set({
        valorPago: novoPago,
        formaPagamento: novoPago >= d.valor ? "Pago" : "Parcelado",
      }).where(eq(despesas.id, d.id));
      await db.insert(despesaPagamentos).values({ despesaId: d.id, valor: pago, dataDia: DIA(), usuarioId: u.id });
      return { ok: true, pago: novoPago, quitado: novoPago >= d.valor };
    }),

  /** Histórico de parcelas de uma despesa */
  pagamentosDe: publicQuery
    .input(z.object({ usuarioId: z.number().int().positive(), id: z.number().int().positive() }))
    .query(async ({ input }) => {
      await requirePerfil(input.usuarioId, LANCA_DESPESAS);
      const rows = await getDb().select().from(despesaPagamentos)
        .where(eq(despesaPagamentos.despesaId, input.id)).orderBy(despesaPagamentos.criadoEm);
      return rows;
    }),

  /** Relatório de despesas de um período: fixos × variáveis × por categoria (para imprimir/baixar) */
  relatorio: publicQuery
    .input(z.object({
      usuarioId: z.number().int().positive(),
      de: z.string().length(10),
      ate: z.string().length(10),
    }))
    .query(async ({ input }) => {
      await requirePerfil(input.usuarioId, GESTAO);
      const db = getDb();
      const rows = await db.select().from(despesas)
        .where(and(gte(despesas.dataDia, input.de), lte(despesas.dataDia, input.ate)))
        .orderBy(despesas.dataDia, despesas.categoria).limit(2000);
      let fixo = 0, variavel = 0, pago = 0, emDivida = 0;
      const porCat = new Map<string, { tipoCusto: string; total: number; qtd: number }>();
      for (const d of rows) {
        if (d.tipoCusto === "Fixo") fixo = r2(fixo + d.valor); else variavel = r2(variavel + d.valor);
        pago = r2(pago + Math.min(d.valorPago ?? 0, d.valor));
        emDivida = r2(emDivida + Math.max(0, d.valor - (d.valorPago ?? 0)));
        const cur = porCat.get(d.categoria) ?? { tipoCusto: d.tipoCusto, total: 0, qtd: 0 };
        porCat.set(d.categoria, { tipoCusto: cur.tipoCusto, total: r2(cur.total + d.valor), qtd: cur.qtd + 1 });
      }
      return {
        de: input.de, ate: input.ate,
        total: r2(fixo + variavel), fixo, variavel, pago, emDivida,
        porCategoria: [...porCat.entries()].map(([categoria, v]) => ({ categoria, ...v })).sort((a, b) => b.total - a.total),
        itens: rows,
      };
    }),

  list: publicQuery
    .input(z.object({
      usuarioId: z.number().int().positive(),
      de: z.string().length(10),
      ate: z.string().length(10),
    }))
    .query(async ({ input }) => {
      await requirePerfil(input.usuarioId, LANCA_DESPESAS);
      const db = getDb();
      const rows = await db.select().from(despesas)
        .where(and(gte(despesas.dataDia, input.de), lte(despesas.dataDia, input.ate)))
        .orderBy(desc(despesas.dataDia), desc(despesas.criadoEm)).limit(500);
      return Promise.all(rows.map(async (d) => {
        const u = await db.query.usuarios.findFirst({ where: eq(usuarios.id, d.usuarioId) });
        return { ...d, usuarioNome: u?.nome ?? "—" };
      }));
    }),

  /** Anexar comprovativo de compra do dia (foto) — área de comprovativos, não por produto */
  anexarComprovativo: publicQuery
    .input(z.object({
      usuarioId: z.number().int().positive(),
      dataDia: z.string().length(10).optional(),
      imagem: z.string().min(50).max(6_000_000), // data URL
      nota: z.string().max(255).optional(),
    }))
    .mutation(async ({ input }) => {
      const u = await requirePerfil(input.usuarioId, LANCA_DESPESAS);
      const db = getDb();
      await db.insert(despesaAnexos).values({
        dataDia: input.dataDia || DIA(), imagem: input.imagem,
        nota: input.nota?.trim() || null, usuarioId: u.id,
      });
      return { ok: true };
    }),

  /** Registar compra SEM comprovativo (nota obrigatória) */
  semComprovativo: publicQuery
    .input(z.object({
      usuarioId: z.number().int().positive(),
      dataDia: z.string().length(10).optional(),
      nota: z.string().min(3).max(255),
    }))
    .mutation(async ({ input }) => {
      const u = await requirePerfil(input.usuarioId, LANCA_DESPESAS);
      const db = getDb();
      await db.insert(despesaAnexos).values({
        dataDia: input.dataDia || DIA(), imagem: null,
        nota: input.nota.trim(), usuarioId: u.id,
      });
      return { ok: true };
    }),

  /** Comprovativos (e notas sem comprovativo) de um dia */
  anexosDia: publicQuery
    .input(z.object({
      usuarioId: z.number().int().positive(),
      dataDia: z.string().length(10).optional(),
    }))
    .query(async ({ input }) => {
      await requirePerfil(input.usuarioId, LANCA_DESPESAS);
      const db = getDb();
      const rows = await db.select().from(despesaAnexos)
        .where(eq(despesaAnexos.dataDia, input.dataDia || DIA()))
        .orderBy(desc(despesaAnexos.criadoEm));
      return Promise.all(rows.map(async (a) => {
        const u = await db.query.usuarios.findFirst({ where: eq(usuarios.id, a.usuarioId) });
        return { id: a.id, nota: a.nota, imagem: a.imagem, usuarioNome: u?.nome ?? "—", criadoEm: a.criadoEm };
      }));
    }),

  /** Eliminar anexo de comprovativo (Admin/Gestor, ou o próprio no mesmo dia) */
  eliminarAnexo: publicQuery
    .input(z.object({ usuarioId: z.number().int().positive(), id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const u = await requirePerfil(input.usuarioId, LANCA_DESPESAS);
      const db = getDb();
      const a = await db.query.despesaAnexos.findFirst({ where: eq(despesaAnexos.id, input.id) });
      if (!a) throw new TRPCError({ code: "NOT_FOUND", message: "Anexo não encontrado" });
      const isGestao = GESTAO.includes(u.perfil);
      if (!isGestao && (a.usuarioId !== u.id || a.dataDia !== DIA()))
        throw new TRPCError({ code: "FORBIDDEN", message: "Só pode eliminar os seus anexos de hoje" });
      await db.delete(despesaAnexos).where(eq(despesaAnexos.id, input.id));
      return { ok: true };
    }),

  /** Admin/Gestor eliminam qualquer lançamento; Logística só os seus, do próprio dia */
  eliminar: publicQuery
    .input(z.object({ usuarioId: z.number().int().positive(), id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const u = await requirePerfil(input.usuarioId, LANCA_DESPESAS);
      const db = getDb();
      const d = await db.query.despesas.findFirst({ where: eq(despesas.id, input.id) });
      if (!d) throw new TRPCError({ code: "NOT_FOUND", message: "Lançamento não encontrado" });
      const isGestao = GESTAO.includes(u.perfil);
      if (!isGestao && (d.usuarioId !== u.id || d.dataDia !== DIA()))
        throw new TRPCError({ code: "FORBIDDEN", message: "Só pode eliminar os seus lançamentos de hoje" });
      await db.delete(despesaPagamentos).where(eq(despesaPagamentos.despesaId, input.id));
      await db.delete(despesas).where(eq(despesas.id, input.id));
      return { ok: true };
    }),
});

/* ============================================================
   RELATÓRIO FINANCEIRO DIÁRIO — receitas, métodos, categorias,
   despesas, saldo, comparação com o dia anterior (Admin/Gestor)
   ============================================================ */
const ESTADOS_PAGOS_ONLINE = ["Aguarda Consumo", "Confirmado", "Em Preparo", "Pronto", "Em Entrega", "Entregue", "Concluído"];

async function apurarDia(data: string) {
  const db = getDb();

  /* --- 1. POS: pedidos fechados no dia --- */
  const fechados = await db.select().from(pedidos)
    .where(and(eq(pedidos.dataDia, data), eq(pedidos.status, "Fechado")));
  const porMetodo = new Map<string, number>();
  const porCategoria = new Map<string, { total: number; qtd: number }>();
  const addMetodo = (m: string, v: number) => porMetodo.set(m, r2((porMetodo.get(m) ?? 0) + v));
  /* Pagamentos recebidos via LEVANTAMENTO (eMola/M-Pesa) — para o quadro de agente do relatório.
     NÃO existe pagamento por depósito: o cliente deposita na conta pessoal dele e depois paga
     por levantamento/transferência. Método «M-Pesa» conta como levantamento M-Pesa;
     «Transferência eMola» NÃO é levantamento. */
  const levPag = { emola: 0, mpesa: 0 };
  const classeLev = (m: string | null | undefined): "emola" | "mpesa" | null => {
    if (!m) return null;
    if (/levantamento\s*e-?mola/i.test(m)) return "emola";
    if (/transfer[eê]ncia\s*m-?pesa/i.test(m)) return null; // transferência M-Pesa NÃO é levantamento
    if (/m-?pesa/i.test(m)) return "mpesa"; // «M-Pesa» genérico = levantamento (regra da casa)
    return null;
  };

  /* Resumo por FORMA DE RECEBIMENTO (pedido da Direcção): discrimina quanto entrou
     em dinheiro vivo, transferências M-Pesa/eMola, levantamentos M-Pesa/eMola, banco,
     cartão e crédito — independentemente da origem (POS, online, reservas, bilhetes…).
     Usa o método REAL de cada pagamento (as partes do POS ficam separadas). */
  const RECEB_ROTULO: Record<string, string> = {
    dinheiro: "💵 Dinheiro (em caixa)",
    tr_mpesa: "📲 Transferência M-Pesa",
    tr_emola: "📲 Transferência eMola",
    lev_mpesa: "🏧 Levantamento M-Pesa",
    lev_emola: "🏧 Levantamento eMola",
    fnb: "🏦 Transferência bancária / FNB",
    cartao: "💳 Cartão",
    credito: "📝 Crédito",
    sem_metodo: "❔ Sem método registado",
    outros: "Outros",
  };
  const RECEB_ORDEM = ["dinheiro", "tr_mpesa", "tr_emola", "lev_mpesa", "lev_emola", "fnb", "cartao", "credito", "sem_metodo", "outros"];
  const classeReceb = (m: string | null | undefined): string => {
    if (!m || m === "—") return "sem_metodo";
    const x = m.toLowerCase();
    if (/dinheiro|numer[aá]rio/.test(x)) return "dinheiro";
    if (/levantamento\s*m-?pesa/.test(x)) return "lev_mpesa";
    if (/levantamento\s*e-?mola/.test(x)) return "lev_emola";
    if (/transfer[eê]ncia\s*m-?pesa/.test(x)) return "tr_mpesa";
    if (/m-?pesa/.test(x)) return "lev_mpesa"; // «M-Pesa» genérico = levantamento (coerente com o quadro de agente)
    if (/e-?mola/.test(x)) return "tr_emola"; // «Transferência eMola» e variantes
    if (/fnb|banco/.test(x)) return "fnb";
    if (/cart[aã]o/.test(x)) return "cartao";
    if (/cr[eé]dito/.test(x)) return "credito";
    return "outros";
  };
  const resumoReceb = new Map<string, number>();
  const addReceb = (m: string | null | undefined, v: number) => {
    const c = classeReceb(m);
    resumoReceb.set(c, r2((resumoReceb.get(c) ?? 0) + v));
  };
  const addLevPag = (m: string | null | undefined, v: number) => {
    const c = classeLev(m);
    if (c === "emola") levPag.emola = r2(levPag.emola + v);
    else if (c === "mpesa") levPag.mpesa = r2(levPag.mpesa + v);
  };
  const addCategoria = (c: string, v: number, q: number) => {
    const cur = porCategoria.get(c) ?? { total: 0, qtd: 0 };
    porCategoria.set(c, { total: r2(cur.total + v), qtd: cur.qtd + q });
  };

  let receitaPOS = 0;
  let adiantDeduzidoHoje = 0;
  const contaProd = new Map<string, { qtd: number; total: number }>();
  /* Grupos comerciais pedidos pela Direcção + CMV (custo da mercadoria vendida) */
  const grupos = { refeicoes: 0, bebidas: 0, piscina: 0, parque: 0, servicos: 0 };
  let cmv = 0; // custo estimado das mercadorias vendidas (preço de compra)
  const prodCache = new Map<number, { tipo: string; categoria: string; custo: number } | null>();
  const prodPorNome = new Map<string, { tipo: string; categoria: string; custo: number } | null>();
  const custoDe = async (produtoId: number | null, nome: string) => {
    let info: { tipo: string; categoria: string; custo: number } | null | undefined;
    if (produtoId != null) {
      if (!prodCache.has(produtoId)) {
        const p = await db.query.produtos.findFirst({ where: eq(produtos.id, produtoId) });
        if (!p) prodCache.set(produtoId, null);
        else {
          let custo = p.precoCompra ?? 0;
          if (!custo && p.estoqueRefId) {
            const mae = await db.query.produtos.findFirst({ where: eq(produtos.id, p.estoqueRefId) });
            custo = mae?.precoCompra ?? 0;
          }
          prodCache.set(produtoId, { tipo: p.tipo, categoria: p.categoria, custo: custo * (p.fraccao ?? 1) });
        }
      }
      info = prodCache.get(produtoId);
    } else {
      if (!prodPorNome.has(nome)) {
        const p = await db.query.produtos.findFirst({ where: eq(produtos.nome, nome) });
        prodPorNome.set(nome, p ? { tipo: p.tipo, categoria: p.categoria, custo: (p.precoCompra ?? 0) * (p.fraccao ?? 1) } : null);
      }
      info = prodPorNome.get(nome);
    }
    return info ?? null;
  };
  const classificar = (cat: string, tipo: string | null, valor: number) => {
    if (cat === "Piscina") grupos.piscina = r2(grupos.piscina + valor);
    else if (cat === "Parque") grupos.parque = r2(grupos.parque + valor);
    else if (tipo === "Bebida") grupos.bebidas = r2(grupos.bebidas + valor);
    else if (tipo === "Refeição") grupos.refeicoes = r2(grupos.refeicoes + valor);
    else grupos.servicos = r2(grupos.servicos + valor);
  };
  const ids = fechados.map((p) => p.id);
  const itensPos = ids.length
    ? await db.select().from(pedidoItens).where(inArray(pedidoItens.pedidoId, ids))
    : [];
  for (const p of fechados) {
    // fiado: o valor ficado a dever NÃO é receita — só entra quando for pago (secção 4a3)
    const pagoEfetivo = r2(p.total - (p.dividaGerada ?? 0));
    receitaPOS = r2(receitaPOS + pagoEfetivo);
    adiantDeduzidoHoje = r2(adiantDeduzidoHoje + p.adiantDeduzido);
    addMetodo(p.metodo ?? "—", pagoEfetivo);
  }

  /* --- 1b. Troco entregue no dia, por forma (controlo da circulação do dinheiro
         físico vs. contas móveis/banco) --- */
  const trocoPorForma = new Map<string, number>();
  let trocoTotal = 0;
  for (const p of fechados) {
    if (!p.troco || p.troco <= 0) continue;
    trocoTotal = r2(trocoTotal + p.troco);
    let partesT: { forma: string; valor: number }[] = [];
    try { partesT = p.trocoDetalhe ? JSON.parse(p.trocoDetalhe) : []; } catch { partesT = []; }
    if (!partesT.length) partesT = [{ forma: "Dinheiro", valor: p.troco }];
    for (const tp of partesT)
      trocoPorForma.set(tp.forma, r2((trocoPorForma.get(tp.forma) ?? 0) + tp.valor));
  }
  for (const it of itensPos) {
    const tot = r2(it.qtd * it.precoUnit);
    addCategoria(it.produtoId == null ? "✳️ Pedidos adicionais" : it.categoria, tot, it.qtd);
    const info = await custoDe(it.produtoId, it.nome);
    classificar(it.categoria, info?.tipo ?? null, tot);
    if (info?.custo) cmv = r2(cmv + info.custo * it.qtd);
    const cp = contaProd.get(it.nome) ?? { qtd: 0, total: 0 };
    contaProd.set(it.nome, { qtd: cp.qtd + it.qtd, total: r2(cp.total + tot) });
  }

  /* --- 2. Loja online: pedidos com pagamento confirmado, criados no dia --- */
  const onlineTodos = await db.select().from(pedidosOnline)
    .where(gte(pedidosOnline.criadoEm, new Date(new Date(data + "T00:00:00Z").getTime() - 3 * 86400e3)));
  const onlineDia = onlineTodos.filter((o) =>
    ESTADOS_PAGOS_ONLINE.includes(o.status) && mzDia(o.criadoEm) === data);
  let receitaOnline = 0;
  const catPorNome = new Map<string, string>();
  for (const o of onlineDia) {
    const valor = o.tipo === "Reserva" && o.adiant > 0 ? o.adiant : o.total;
    receitaOnline = r2(receitaOnline + valor);
    // separa por método real: M-Pesa, Transferência eMola, Levantamento eMola, FNB, Dinheiro
    const metOn = o.metodoPagamento ?? "Transferência eMola";
    addMetodo(`Online — ${metOn}`, valor);
    addLevPag(metOn, valor);
    addReceb(metOn, valor);
    for (const i of o.itens) {
      let cat: string;
      if (i.personalizado || i.nome.startsWith("✳️")) cat = "✳️ Pedidos especiais (online)";
      else {
        if (!catPorNome.has(i.nome)) {
          const pr = await db.query.produtos.findFirst({ where: eq(produtos.nome, i.nome) });
          catPorNome.set(i.nome, pr?.categoria ?? "Outros");
        }
        cat = catPorNome.get(i.nome)!;
      }
      addCategoria(cat, i.total, i.qtd);
      const info = await custoDe(null, i.nome);
      classificar(cat, info?.tipo ?? null, i.total);
      if (info?.custo) cmv = r2(cmv + info.custo * i.qtd);
      const cp = contaProd.get(i.nome) ?? { qtd: 0, total: 0 };
      contaProd.set(i.nome, { qtd: cp.qtd + i.qtd, total: r2(cp.total + i.total) });
    }
  }

  /* --- 3. Piscina & Parque --- */
  const pisTodos = await db.select().from(piscina)
    .where(gte(piscina.criadoEm, new Date(new Date(data + "T00:00:00Z").getTime() - 3 * 86400e3)));
  const pisDia = pisTodos.filter((x) => mzDia(x.criadoEm) === data);
  let receitaPiscina = 0;
  for (const x of pisDia) {
    receitaPiscina = r2(receitaPiscina + x.total);
    addMetodo(x.metodo, x.total);
    addLevPag(x.metodo, x.total);
    addReceb(x.metodo, x.total);
    addCategoria("Piscina & Parque", x.total, x.adultos + x.criancas + x.brinquedos);
    grupos.piscina = r2(grupos.piscina + x.total);
  }

  /* --- 4. Adiantamentos de reservas recebidos no dia (tabela pagamentos) ---
     Divididos em: EVENTOS (com pacote de salão) × CONSUMO LOCAL (reserva simples) */
  const pagsTodos = await db.select().from(pagamentos)
    .where(gte(pagamentos.criadoEm, new Date(new Date(data + "T00:00:00Z").getTime() - 3 * 86400e3)));
  const adiantDia = pagsTodos.filter((pg) =>
    pg.status !== "Anulado" && pg.tipoVenda.startsWith("Adiantamento") && mzDia(pg.criadoEm) === data);
  let receitaAdiant = 0;
  let adiantEventos = 0, adiantLocal = 0;
  for (const pg of adiantDia) {
    receitaAdiant = r2(receitaAdiant + pg.valor);
    addMetodo(pg.metodo === "—" ? "Adiantamento (reserva)" : pg.metodo, pg.valor);
    addLevPag(pg.metodo, pg.valor);
    addReceb(pg.metodo, pg.valor);
    const cod = pg.tipoVenda.replace(/^Adiantamento\s+/, "").trim();
    const rv = await db.query.reservas.findFirst({ where: eq(reservas.codigo, cod) });
    if (rv?.pacoteNome) adiantEventos = r2(adiantEventos + pg.valor);
    else adiantLocal = r2(adiantLocal + pg.valor);
  }

  /* --- 4a1. BRAAI: taxas NÃO consumíveis (adiantamento + saldo pago na entrada) ---
     Receita própria, separada das vendas e dos adiantamentos consumíveis. */
  const braaiDia = pagsTodos.filter((pg) =>
    pg.status !== "Anulado" && pg.tipoVenda.startsWith("Braai") && mzDia(pg.criadoEm) === data);
  let receitaBraai = 0;
  for (const pg of braaiDia) {
    receitaBraai = r2(receitaBraai + pg.valor);
    addMetodo(pg.metodo === "—" ? "Braai (reserva)" : pg.metodo, pg.valor);
    addLevPag(pg.metodo, pg.valor);
    addReceb(pg.metodo, pg.valor);
    addCategoria("Braai (taxa de uso do espaço)", pg.valor, 1);
  }

  /* --- 4a2. POS: pagamentos por parte (combinados ficam separados por método real) --- */
  const pagsPos = pagsTodos.filter((pg) =>
    pg.status !== "Anulado" && pg.tipoVenda.startsWith("Pedido n") && mzDia(pg.criadoEm) === data);
  for (const pg of pagsPos) { addLevPag(pg.metodo, pg.valor); addReceb(pg.metodo, pg.valor); }

  /* --- 4a3. DÍVIDAS liquidadas/amortizadas no dia (fiado cobrado) ---
     Cada pagamento de dívida é receita do dia em que é recebido. */
  const divDia = pagsTodos.filter((pg) =>
    pg.status !== "Anulado" && pg.tipoVenda.startsWith("Dívida ") && mzDia(pg.criadoEm) === data);
  let receitaDividas = 0;
  for (const pg of divDia) {
    receitaDividas = r2(receitaDividas + pg.valor);
    addMetodo(pg.metodo === "—" ? "Dívida (fiado)" : pg.metodo, pg.valor);
    addLevPag(pg.metodo, pg.valor);
    addReceb(pg.metodo, pg.valor);
    addCategoria("Dívidas liquidadas", pg.valor, 1);
  }

  /* --- 4a4. BILHETES DE EVENTOS vendidos no dia (bilheteira) — receita própria --- */
  const bilDia = pagsTodos.filter((pg) =>
    pg.status !== "Anulado" && pg.tipoVenda.startsWith("Bilhete ") && mzDia(pg.criadoEm) === data);
  let receitaBilhetes = 0;
  for (const pg of bilDia) {
    receitaBilhetes = r2(receitaBilhetes + pg.valor);
    addMetodo(pg.metodo === "—" ? "Bilhete (evento)" : pg.metodo, pg.valor);
    addLevPag(pg.metodo, pg.valor);
    addReceb(pg.metodo, pg.valor);
    addCategoria("Bilhetes de eventos", pg.valor, 1);
  }

  /* --- 4a5. SALDO de reservas cobrado no dia (caixa — «Cobrar saldo») ---
     Receita do consumo local: soma junto dos adiantamentos consumíveis. */
  const saldoDia = pagsTodos.filter((pg) =>
    pg.status !== "Anulado" && pg.tipoVenda.startsWith("Saldo ") && mzDia(pg.criadoEm) === data);
  let receitaSaldos = 0;
  for (const pg of saldoDia) {
    receitaSaldos = r2(receitaSaldos + pg.valor);
    receitaAdiant = r2(receitaAdiant + pg.valor);
    adiantLocal = r2(adiantLocal + pg.valor);
    addMetodo(pg.metodo === "—" ? "Saldo (reserva)" : pg.metodo, pg.valor);
    addLevPag(pg.metodo, pg.valor);
    addReceb(pg.metodo, pg.valor);
  }

  /* --- 4b. Conta Gerência paga no dia (consumo dos proprietários que foi pago) --- */
  const gerDia = pagsTodos.filter((pg) =>
    pg.status !== "Anulado" && pg.tipoVenda.startsWith("Gerência") && mzDia(pg.criadoEm) === data);
  let receitaGerencia = 0;
  for (const pg of gerDia) {
    receitaGerencia = r2(receitaGerencia + pg.valor);
    addMetodo(pg.metodo, pg.valor);
    addLevPag(pg.metodo, pg.valor);
    addReceb(pg.metodo, pg.valor);
    addCategoria("Conta Gerência", pg.valor, 1);
  }

  /* --- 5. Despesas do dia --- */
  const despDia = await db.select().from(despesas).where(eq(despesas.dataDia, data))
    .orderBy(desc(despesas.criadoEm));
  const porCatDesp = new Map<string, number>();
  let totDespesas = 0, despFixo = 0, despVariavel = 0, totalAfiliados = 0, despPago = 0, despEmDivida = 0;
  for (const d of despDia) {
    totDespesas = r2(totDespesas + d.valor);
    despPago = r2(despPago + Math.min(d.valorPago ?? 0, d.valor));
    despEmDivida = r2(despEmDivida + Math.max(0, d.valor - (d.valorPago ?? 0)));
    if (d.tipoCusto === "Fixo") despFixo = r2(despFixo + d.valor); else despVariavel = r2(despVariavel + d.valor);
    if (d.categoria === "Afiliados — Comissões") totalAfiliados = r2(totalAfiliados + d.valor);
    porCatDesp.set(d.categoria, r2((porCatDesp.get(d.categoria) ?? 0) + d.valor));
  }

  /* --- 6. Comissões de agente eMola / M-Pesa (a empresa é agente) ---
     Diariamente ficam como RECEITA A RECEBER (não entram no total);
     só entram na receita do dia em que a operadora as paga (confirmado no ecrã Agente,
     regra geral na 1ª semana do mês seguinte). */
  const agMovsTodos = await db.select().from(agenteMovimentos);
  const agMovs = agMovsTodos.filter((m) => m.dataDia === data); // registados hoje (a receber)
  const agRecebidos = agMovsTodos.filter((m) => m.recebidoEm === data); // pagos pela operadora hoje
  let comissaoAgente = 0, comissaoEmola = 0, comissaoMpesa = 0, valorAgente = 0;
  for (const m of agRecebidos) {
    comissaoAgente = r2(comissaoAgente + m.comissao);
    valorAgente = r2(valorAgente + m.valor);
    if (m.sistema === "eMola") comissaoEmola = r2(comissaoEmola + m.comissao);
    else comissaoMpesa = r2(comissaoMpesa + m.comissao);
  }
  /* Totais do dia por sistema/tipo — pedido da Direcção:
     depósitos e levantamentos eMola/M-Pesa no relatório financeiro.
     Os levantamentos somam: (a) pagamentos de clientes via levantamento (vendas do dia)
     + (b) levantamentos EXCLUSIVOS lançados na página Agente (uso pessoal do cliente). */
  const agTot = {
    depEmola: 0, depMpesa: 0, levExclEmola: 0, levExclMpesa: 0,
    nDepEmola: 0, nDepMpesa: 0, nLevEmola: 0, nLevMpesa: 0,
  };
  for (const m of agMovs) {
    if (m.tipo === "Deposito") {
      if (m.sistema === "eMola") { agTot.depEmola = r2(agTot.depEmola + m.valor); agTot.nDepEmola++; }
      else { agTot.depMpesa = r2(agTot.depMpesa + m.valor); agTot.nDepMpesa++; }
    } else {
      if (m.sistema === "eMola") { agTot.levExclEmola = r2(agTot.levExclEmola + m.valor); agTot.nLevEmola++; }
      else { agTot.levExclMpesa = r2(agTot.levExclMpesa + m.valor); agTot.nLevMpesa++; }
    }
  }
  // TROCO entregue ao cliente via DEPÓSITO eMola/M-Pesa: esse valor sai do canal —
  // desconta automaticamente nos levantamentos do dia desse sistema.
  const trocoDepEmola = r2(trocoPorForma.get("Depósito eMola") ?? 0);
  const trocoDepMpesa = r2(trocoPorForma.get("Depósito Mpesa") ?? 0);
  const totalLevEmola = r2(Math.max(0, levPag.emola + agTot.levExclEmola - trocoDepEmola));
  const totalLevMpesa = r2(Math.max(0, levPag.mpesa + agTot.levExclMpesa - trocoDepMpesa));

  const agAReceber = r2(agMovs.filter((m) => !m.recebidoEm).reduce((a, m) => a + m.comissao, 0));
  const agAReceberTotal = r2(agMovsTodos.filter((m) => !m.recebidoEm).reduce((a, m) => a + m.comissao, 0));
  const valorAgenteDia = r2(agMovs.reduce((a, m) => a + m.valor, 0));

  /* --- totais --- */
  const receitaVendas = r2(receitaPOS + receitaOnline + receitaPiscina + receitaGerencia);
  const receitaTotal = r2(receitaVendas + receitaAdiant + receitaBraai + receitaDividas + receitaBilhetes + comissaoAgente);
  const nVendas = fechados.length + onlineDia.length + pisDia.length + gerDia.length;

  /* --- Análise de rentabilidade (previsão): CMV pelo preço de compra, EBITDA, IVA 16% ---
     ATENÇÃO: as despesas NÃO são descontadas da receita (usa-se valor guardado para mercadorias);
     o EBITDA abaixo é apenas uma previsão informativa da margem do negócio. */
  const margemBruta = r2(receitaVendas - cmv);
  const ebitda = r2(margemBruta + comissaoAgente - totDespesas);
  const iva = r2(receitaTotal * 0.16);
  const margemPct = receitaVendas > 0 ? r2((margemBruta / receitaVendas) * 100) : 0;
  const ebitdaPct = receitaTotal > 0 ? r2((ebitda / receitaTotal) * 100) : 0;

  return {
    data,
    receitaTotal,
    receitaVendas,
    fontes: {
      pos: receitaPOS, online: receitaOnline, piscina: receitaPiscina, adiantamentos: receitaAdiant,
      braai: receitaBraai,
      dividas: receitaDividas,
      gerencia: receitaGerencia,
      bilhetes: receitaBilhetes,
      saldosReserva: receitaSaldos,
    },
    porRecebimento: RECEB_ORDEM
      .filter((c) => (resumoReceb.get(c) ?? 0) > 0)
      .map((c) => ({ classe: RECEB_ROTULO[c], total: resumoReceb.get(c)! })),
    grupos: {
      refeicoes: grupos.refeicoes, bebidas: grupos.bebidas,
      piscina: grupos.piscina, parque: grupos.parque, servicos: grupos.servicos,
      lojaOnline: receitaOnline,
      adiantEventos, adiantLocal,
      totalAfiliados,
      agente: comissaoAgente,
    },
    troco: {
      total: trocoTotal,
      porForma: [...trocoPorForma.entries()].map(([forma, total]) => ({ forma, total })).sort((a, b) => b.total - a.total),
    },
    agente: {
      comissao: comissaoAgente, emola: comissaoEmola, mpesa: comissaoMpesa,
      valorMovimentado: valorAgente, n: agRecebidos.length,
      aReceberHoje: agAReceber, aReceberTotal: agAReceberTotal,
      movimentosHoje: agMovs.length, valorHoje: valorAgenteDia,
      totais: {
        depEmola: agTot.depEmola, depMpesa: agTot.depMpesa,
        nDepEmola: agTot.nDepEmola, nDepMpesa: agTot.nDepMpesa,
        levPagEmola: levPag.emola, levPagMpesa: levPag.mpesa,
        trocoDepEmola, trocoDepMpesa, // troco entregue por depósito — já descontado dos totais de levantamento
        levExclEmola: agTot.levExclEmola, levExclMpesa: agTot.levExclMpesa,
        nLevEmola: agTot.nLevEmola, nLevMpesa: agTot.nLevMpesa,
        totalLevEmola, totalLevMpesa,
      },
    },
    analise: {
      cmv, margemBruta, margemPct, ebitda, ebitdaPct, iva,
      semCustoRegistado: cmv === 0, // verdadeiro enquanto os preços de compra não estiverem preenchidos
    },
    adiantDeduzidoHoje,
    porMetodo: [...porMetodo.entries()].map(([metodo, total]) => ({ metodo, total })).sort((a, b) => b.total - a.total),
    porCategoria: [...porCategoria.entries()].map(([categoria, v]) => ({ categoria, total: v.total, qtd: v.qtd })).sort((a, b) => b.total - a.total),
    nVendas,
    ticketMedio: nVendas ? r2(receitaVendas / nVendas) : 0,
    topProdutos: [...contaProd.entries()].map(([nome, v]) => ({ nome, qtd: v.qtd, total: v.total }))
      .sort((a, b) => b.qtd - a.qtd).slice(0, 5),
    despesas: {
      total: totDespesas, fixo: despFixo, variavel: despVariavel, pago: despPago, emDivida: despEmDivida,
      porCategoria: [...porCatDesp.entries()].map(([categoria, total]) => ({ categoria, total })).sort((a, b) => b.total - a.total),
      itens: despDia,
    },
    saldo: r2(receitaTotal - totDespesas),
  };
}

export const financeiroRouter = createRouter({
  /** Relatório financeiro de um dia (por defeito hoje) + comparação com o dia anterior */
  dia: publicQuery
    .input(z.object({ usuarioId: z.number().int().positive(), data: z.string().length(10).optional() }))
    .query(async ({ input }) => {
      await requirePerfil(input.usuarioId, GESTAO);
      const data = input.data || DIA();
      const ontem = new Date(new Date(data + "T12:00:00Z").getTime() - 86400e3).toISOString().slice(0, 10);
      const [hoje, antes] = await Promise.all([apurarDia(data), apurarDia(ontem)]);
      const variacao = antes.receitaTotal > 0
        ? r2(((hoje.receitaTotal - antes.receitaTotal) / antes.receitaTotal) * 100)
        : null;
      return { ...hoje, ontem: { data: ontem, receitaTotal: antes.receitaTotal, despesasTotal: antes.despesas.total }, variacao };
    }),

  /** Mini-série dos últimos 7 dias (receita, despesas, saldo) */
  semana: publicQuery
    .input(z.object({ usuarioId: z.number().int().positive() }))
    .query(async ({ input }) => {
      await requirePerfil(input.usuarioId, GESTAO);
      const dias: string[] = [];
      for (let i = 6; i >= 0; i--)
        dias.push(new Date(Date.now() + 2 * 3600e3 - i * 86400e3).toISOString().slice(0, 10));
      const res = [];
      for (const d of dias) {
        const a = await apurarDia(d);
        res.push({ data: d, receita: a.receitaTotal, despesas: a.despesas.total, saldo: a.saldo });
      }
      return res;
    }),

  /** DRE — Demonstração de Resultados do período (intervalo de datas, máx. 93 dias).
      Soma os apuramentos diários: receitas por fonte, CMV, despesas (fixas/variáveis e por
      categoria), EBITDA, IVA estimado e resultado líquido estimado + série diária p/ gráfico. */
  periodo: publicQuery
    .input(z.object({
      usuarioId: z.number().int().positive(),
      de: z.string().length(10),
      ate: z.string().length(10),
    }))
    .query(async ({ input }) => {
      await requirePerfil(input.usuarioId, GESTAO);
      const de = input.de <= input.ate ? input.de : input.ate;
      const ate = input.de <= input.ate ? input.ate : input.de;
      const nDias = Math.round((new Date(ate + "T12:00:00Z").getTime() - new Date(de + "T12:00:00Z").getTime()) / 86400e3) + 1;
      if (nDias > 93) throw new TRPCError({ code: "BAD_REQUEST", message: "O intervalo máximo do DRE é de 93 dias (3 meses)." });

      const serie: { data: string; receita: number; despesas: number; saldo: number; depEmola: number; depMpesa: number; nDepEmola: number; nDepMpesa: number }[] = [];
      const T = {
        receitaVendas: 0, receitaTotal: 0, cmv: 0, margemBruta: 0, ebitda: 0, iva: 0,
        despFixo: 0, despVariavel: 0, despPago: 0, despEmDivida: 0, despTotal: 0,
        nVendas: 0, diasComMovimento: 0,
        fontes: { pos: 0, online: 0, piscina: 0, adiantamentos: 0, braai: 0, dividas: 0, gerencia: 0, agente: 0, bilhetes: 0, saldosReserva: 0 },
        // depósitos de agente eMola/M-Pesa (valor movimentado — não é receita, é fluxo do agente)
        agenteDeps: { depEmola: 0, depMpesa: 0, nDepEmola: 0, nDepMpesa: 0 },
      };
      const catDesp = new Map<string, number>();
      const porMetodo = new Map<string, number>();
      const porCategoria = new Map<string, { total: number; qtd: number }>();

      for (let i = 0; i < nDias; i++) {
        const d = new Date(new Date(de + "T12:00:00Z").getTime() + i * 86400e3).toISOString().slice(0, 10);
        const a = await apurarDia(d);
        if (a.receitaTotal > 0 || a.despesas.total > 0) T.diasComMovimento++;
        serie.push({
          data: d, receita: a.receitaTotal, despesas: a.despesas.total, saldo: a.saldo,
          depEmola: a.agente.totais.depEmola, depMpesa: a.agente.totais.depMpesa,
          nDepEmola: a.agente.totais.nDepEmola, nDepMpesa: a.agente.totais.nDepMpesa,
        });
        T.agenteDeps.depEmola = r2(T.agenteDeps.depEmola + a.agente.totais.depEmola);
        T.agenteDeps.depMpesa = r2(T.agenteDeps.depMpesa + a.agente.totais.depMpesa);
        T.agenteDeps.nDepEmola += a.agente.totais.nDepEmola;
        T.agenteDeps.nDepMpesa += a.agente.totais.nDepMpesa;
        T.receitaVendas = r2(T.receitaVendas + a.receitaVendas);
        T.receitaTotal = r2(T.receitaTotal + a.receitaTotal);
        T.cmv = r2(T.cmv + a.analise.cmv);
        T.margemBruta = r2(T.margemBruta + a.analise.margemBruta);
        T.ebitda = r2(T.ebitda + a.analise.ebitda);
        T.iva = r2(T.iva + a.analise.iva);
        T.despFixo = r2(T.despFixo + a.despesas.fixo);
        T.despVariavel = r2(T.despVariavel + a.despesas.variavel);
        T.despPago = r2(T.despPago + a.despesas.pago);
        T.despEmDivida = r2(T.despEmDivida + a.despesas.emDivida);
        T.despTotal = r2(T.despTotal + a.despesas.total);
        T.nVendas += a.nVendas;
        T.fontes.pos = r2(T.fontes.pos + a.fontes.pos);
        T.fontes.online = r2(T.fontes.online + a.fontes.online);
        T.fontes.piscina = r2(T.fontes.piscina + a.fontes.piscina);
        T.fontes.adiantamentos = r2(T.fontes.adiantamentos + a.fontes.adiantamentos);
        T.fontes.braai = r2(T.fontes.braai + a.fontes.braai);
        T.fontes.dividas = r2(T.fontes.dividas + a.fontes.dividas);
        T.fontes.gerencia = r2(T.fontes.gerencia + a.fontes.gerencia);
        T.fontes.agente = r2(T.fontes.agente + a.grupos.agente);
        T.fontes.bilhetes = r2(T.fontes.bilhetes + (a.fontes.bilhetes ?? 0));
        T.fontes.saldosReserva = r2(T.fontes.saldosReserva + (a.fontes.saldosReserva ?? 0));
        for (const c of a.despesas.porCategoria)
          catDesp.set(c.categoria, r2((catDesp.get(c.categoria) ?? 0) + c.total));
        for (const m of a.porMetodo)
          porMetodo.set(m.metodo, r2((porMetodo.get(m.metodo) ?? 0) + m.total));
        for (const c of a.porCategoria) {
          const cur = porCategoria.get(c.categoria) ?? { total: 0, qtd: 0 };
          porCategoria.set(c.categoria, { total: r2(cur.total + c.total), qtd: cur.qtd + c.qtd });
        }
      }

      const resultadoLiquido = r2(T.ebitda - T.iva);
      return {
        de, ate, nDias,
        ...T,
        resultadoLiquido,
        margemBrutaPct: T.receitaVendas > 0 ? r2((T.margemBruta / T.receitaVendas) * 100) : 0,
        ebitdaPct: T.receitaTotal > 0 ? r2((T.ebitda / T.receitaTotal) * 100) : 0,
        liquidoPct: T.receitaTotal > 0 ? r2((resultadoLiquido / T.receitaTotal) * 100) : 0,
        semCustoRegistado: T.cmv === 0,
        despesasPorCategoria: [...catDesp.entries()].map(([categoria, total]) => ({ categoria, total })).sort((a, b) => b.total - a.total),
        porMetodo: [...porMetodo.entries()].map(([metodo, total]) => ({ metodo, total })).sort((a, b) => b.total - a.total),
        porCategoria: [...porCategoria.entries()].map(([categoria, v]) => ({ categoria, total: v.total, qtd: v.qtd })).sort((a, b) => b.total - a.total),
        serie,
      };
    }),

  /** Resumo diário das 23:00 (hora de Moçambique): quando a hora chega, prepara o texto
      do resumo do dia para envio por WhatsApp (um toque) ao número configurado.
      Se ninguém estiver com o sistema aberto às 23:00, o resumo aparece no acesso seguinte. */
  resumoPendente: publicQuery
    .input(z.object({ usuarioId: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      await requirePerfil(input.usuarioId, GESTAO);
      const db = getDb();
      const emp = await getEmpresa();

      // hora de Moçambique (UTC+2)
      const agoraMZ = new Date(Date.now() + 2 * 3600e3);
      const hoje = agoraMZ.toISOString().slice(0, 10);
      const minutos = Number(agoraMZ.toISOString().slice(11, 13)) * 60 + Number(agoraMZ.toISOString().slice(14, 16));
      // alvo: hoje se já passaram as 23:00; senão ontem (resumo em atraso)
      const target = minutos >= 23 * 60
        ? hoje
        : new Date(agoraMZ.getTime() - 86400e3).toISOString().slice(0, 10);

      const row = await db.query.config.findFirst({ where: eq(config.chave, "ultimo_resumo_dia") });
      const ultimo = row?.valor ?? "";
      if (ultimo >= target) return { pendente: false as const };

      const a = await apurarDia(target);
      await db.insert(config).values({ chave: "ultimo_resumo_dia", valor: target })
        .onDuplicateKeyUpdate({ set: { valor: target } });

      const [dd, mm, aa] = [target.slice(8, 10), target.slice(5, 7), target.slice(0, 4)];
      const f = (n: number) => n.toFixed(2);
      const top = a.topProdutos.slice(0, 3).map((t) => `${t.qtd}× ${t.nome}`).join(", ");
      const linhas = [
        `🌙 *${emp.nome} — Resumo do dia ${dd}/${mm}/${aa}*`,
        ``,
        `💰 Receita total: *${f(a.receitaTotal)} MZN*`,
        `   • Salão / POS: ${f(a.fontes.pos)} MZN`,
        `   • Loja online: ${f(a.fontes.online)} MZN`,
        `   • Piscina & Parque: ${f(a.fontes.piscina)} MZN`,
        `   • Adiantamentos de reservas: ${f(a.fontes.adiantamentos)} MZN`,
        `   • 🔥 Braai (taxa de uso do espaço): ${f(a.fontes.braai)} MZN`,
        ...(a.fontes.dividas > 0 ? [`   • 🧾 Dívidas liquidadas: ${f(a.fontes.dividas)} MZN`] : []),
        `💸 Despesas do dia: *${f(a.despesas.total)} MZN*`,
        `✅ Saldo do dia: *${f(a.saldo)} MZN*`,
        ``,
        `🛒 Vendas: ${a.nVendas} · Ticket médio: ${f(a.ticketMedio)} MZN`,
      ];
      if (top) linhas.push(`🏆 Mais vendidos: ${top}`);
      linhas.push(``, `_Resumo automático do sistema de gestão — ${emp.slogan}_`);
      return { pendente: true as const, data: target, texto: linhas.join("\n"), destino: emp.resumoWhats };
    }),
});
