import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { createRouter, publicQuery } from "./middleware";
import { getDb } from "./queries/connection";
import {
  config, contadores, documentos, pedidos, pedidoItens, produtos, stockMov, usuarios,
  type DocItem,
} from "@db/schema";
import { EMPRESA, HORARIOS_PADRAO, BAIRROS_CHIMOIO, type EmpresaCfg, type HorarioDia, type IvaModo } from "@contracts/types";

/* ---------- helpers ---------- */
async function requirePerfil(userId: number, perfis: string[]) {
  const u = await getDb().query.usuarios.findFirst({ where: eq(usuarios.id, userId) });
  if (!u || !u.ativo) throw new TRPCError({ code: "UNAUTHORIZED", message: "Utilizador inválido" });
  if (!perfis.includes(u.perfil))
    throw new TRPCError({ code: "FORBIDDEN", message: "Ação reservada a: " + perfis.join(", ") });
  return u;
}

export async function nextCodigo(chave: string, prefix: string) {
  const db = getDb();
  await db
    .insert(contadores)
    .values({ chave, valor: 1 })
    .onDuplicateKeyUpdate({ set: { valor: sql`${contadores.valor} + 1` } });
  const c = await db.query.contadores.findFirst({ where: eq(contadores.chave, chave) });
  return prefix + String(c?.valor ?? 1).padStart(4, "0");
}

/** Lê a configuração da empresa da base de dados, completando com os valores por defeito */
export async function getEmpresa(): Promise<EmpresaCfg> {
  const rows = await getDb().select().from(config);
  const mapa = new Map(rows.map((r) => [r.chave, r.valor ?? ""]));
  const out = {} as Record<string, string>;
  for (const k of Object.keys(EMPRESA)) out[k] = mapa.get(k) || String(EMPRESA[k as keyof typeof EMPRESA]);
  return out as EmpresaCfg;
}

/** Cálculo de totais com IVA — Moçambique: taxa padrão 16% */
function calcTotais(subtotal: number, descontoPct: number, ivaModo: IvaModo, ivaTaxa: number) {
  const descValor = Math.round(subtotal * (descontoPct / 100) * 100) / 100;
  const base = Math.round((subtotal - descValor) * 100) / 100;
  let ivaValor = 0;
  let total = base;
  if (ivaModo === "incluido") {
    // IVA já está dentro dos preços — valor informativo do IVA contido
    ivaValor = Math.round((base * ivaTaxa) / (100 + ivaTaxa) * 100) / 100;
  } else if (ivaModo === "adicional") {
    ivaValor = Math.round(base * (ivaTaxa / 100) * 100) / 100;
    total = Math.round((base + ivaValor) * 100) / 100;
  }
  return { descValor, base, ivaValor, total };
}

/* ============================================================
   CONFIGURAÇÃO DA EMPRESA
   ============================================================ */
export const configRouter = createRouter({
  get: publicQuery.query(() => getEmpresa()),

  set: publicQuery
    .input(z.object({
      adminId: z.number().int().positive(),
      dados: z.record(z.string(), z.string()),
    }))
    .mutation(async ({ input }) => {
      await requirePerfil(input.adminId, ["Admin"]);
      const db = getDb();
      const permitidas = new Set(Object.keys(EMPRESA));
      for (const [chave, valor] of Object.entries(input.dados)) {
        if (!permitidas.has(chave)) continue;
        await db.insert(config).values({ chave, valor })
          .onDuplicateKeyUpdate({ set: { valor } });
      }
      return { ok: true };
    }),
});

/** Lê uma lista JSON da tabela config, com valor por defeito */
async function getJsonCfg<T>(chave: string, padrao: T): Promise<T> {
  const row = await getDb().query.config.findFirst({ where: eq(config.chave, chave) });
  if (!row?.valor) return padrao;
  try { return JSON.parse(row.valor) as T; } catch { return padrao; }
}

export async function setJsonCfg(chave: string, valor: unknown) {
  const v = JSON.stringify(valor);
  await getDb().insert(config).values({ chave, valor: v })
    .onDuplicateKeyUpdate({ set: { valor: v } });
}

/* ---------- Estado do estabelecimento + horário-limite do delivery ---------- */
export type EstadoEstab = { estado: "auto" | "aberto" | "fechado"; dia: string; por?: string; em?: string };

const mzHoje = () => new Date(Date.now() + 2 * 3600e3).toISOString().slice(0, 10);

/** Estado do estabelecimento: "auto" segue os horários; "fechado" rejeita todos os
    pedidos online; "aberto" (declarado pela equipa) permite delivery fora do limite.
    O estado manual reinicia automaticamente no dia seguinte. */
export async function getEstadoEstab(): Promise<EstadoEstab> {
  const e = await getJsonCfg<EstadoEstab>("estabelecimento", { estado: "auto", dia: "" });
  if (e.estado !== "auto" && e.dia !== mzHoje()) return { estado: "auto", dia: mzHoje() };
  return e;
}

/** Limites do delivery: terça–sexta e sábado–domingo (editáveis pelo Admin) */
export async function getDeliveryHorario() {
  return getJsonCfg("delivery_horario", { semana: "16:00", fimSemana: "19:00" });
}

export async function getHorarios() {
  return getJsonCfg<HorarioDia[]>("horarios", HORARIOS_PADRAO);
}

/* ---------- Stock fraccionário (aves em 1/4 · 1/2 · inteiro; carnes por kg) ----------
   Produtos com `estoqueRefId` partilham o stock do produto "mãe" (ex.: Frango Inteiro)
   e cada venda desconta apenas a sua fracção (0.25 / 0.5 / 1). O stock fica em
   unidades inteiras fraccionáveis: 10 frangos − 1/4 = 9.75 (9 frangos + 3/4). */
type DbLike = { update: Function; insert: Function; query: any };
export async function baixarStockProduto(
  db: DbLike, prod: { id: number; tipo: string; estoqueRefId?: number | null; fraccao?: number | null },
  qtd: number, obs: string, usuarioId: number,
) {
  if (prod.tipo === "Serviço") return;
  const alvo = prod.estoqueRefId ?? prod.id;
  const delta = Math.round(qtd * (prod.fraccao ?? 1) * 10000) / 10000;
  await db.update(produtos)
    .set({ estoqueAtual: sql`${produtos.estoqueAtual} - ${delta}` })
    .where(eq(produtos.id, alvo));
  await db.insert(stockMov).values({
    produtoId: prod.id, qtd: delta, tipo: "saida", obs, usuarioId,
  });
}
export async function reporStockProduto(
  db: DbLike, prod: { id: number; tipo: string; estoqueRefId?: number | null; fraccao?: number | null },
  qtd: number, obs: string, usuarioId: number,
) {
  if (prod.tipo === "Serviço") return;
  const alvo = prod.estoqueRefId ?? prod.id;
  const delta = Math.round(qtd * (prod.fraccao ?? 1) * 10000) / 10000;
  await db.update(produtos)
    .set({ estoqueAtual: sql`${produtos.estoqueAtual} + ${delta}` })
    .where(eq(produtos.id, alvo));
  await db.insert(stockMov).values({
    produtoId: prod.id, qtd: delta, tipo: "entrada", obs, usuarioId,
  });
}

/* ============================================================
   HORÁRIOS + BAIRROS (editáveis pelo Admin)
   ============================================================ */
export const operacaoRouter = createRouter({
  /** Horário de funcionamento (público — usado também na loja) */
  horarios: publicQuery.query(() => getJsonCfg<HorarioDia[]>("horarios", HORARIOS_PADRAO)),

  setHorarios: publicQuery
    .input(z.object({
      adminId: z.number().int().positive(),
      horarios: z.array(z.object({
        dia: z.string().min(3),
        abre: z.string().regex(/^\d{2}:\d{2}$/),
        fecha: z.string().regex(/^\d{2}:\d{2}$/),
        aberto: z.boolean(),
      })).length(7),
    }))
    .mutation(async ({ input }) => {
      await requirePerfil(input.adminId, ["Admin"]);
      await setJsonCfg("horarios", input.horarios);
      return { ok: true };
    }),

  /** Bairros de Chimoio para o dropdown de delivery (público — usado na loja) */
  bairros: publicQuery.query(() => getJsonCfg<string[]>("bairros", BAIRROS_CHIMOIO)),

  /** Categorias de produtos (config + as usadas nos produtos existentes) */
  categorias: publicQuery.query(async () => {
    const extra = await getJsonCfg<string[]>("categorias", []);
    const usadas = await getDb().selectDistinct({ categoria: produtos.categoria }).from(produtos);
    const todas = new Set<string>([...extra, ...usadas.map((r) => r.categoria)]);
    return [...todas].filter(Boolean).sort((a, b) => a.localeCompare(b, "pt"));
  }),

  addCategoria: publicQuery
    .input(z.object({ usuarioId: z.number().int().positive(), nome: z.string().min(2).max(60) }))
    .mutation(async ({ input }) => {
      await requirePerfil(input.usuarioId, ["Admin", "Gestor"]);
      const nome = input.nome.trim();
      const lista = await getJsonCfg<string[]>("categorias", []);
      if (lista.some((c) => c.toLowerCase() === nome.toLowerCase()))
        throw new TRPCError({ code: "BAD_REQUEST", message: "Esta categoria já existe." });
      await setJsonCfg("categorias", [...lista, nome]);
      return { ok: true };
    }),

  renomearCategoria: publicQuery
    .input(z.object({ usuarioId: z.number().int().positive(), de: z.string().min(1), para: z.string().min(2).max(60) }))
    .mutation(async ({ input }) => {
      await requirePerfil(input.usuarioId, ["Admin", "Gestor"]);
      const db = getDb();
      const para = input.para.trim();
      await db.update(produtos).set({ categoria: para }).where(eq(produtos.categoria, input.de));
      const lista = await getJsonCfg<string[]>("categorias", []);
      await setJsonCfg("categorias", [...lista.filter((c) => c !== input.de && c !== para), para]);
      return { ok: true };
    }),

  removerCategoria: publicQuery
    .input(z.object({ usuarioId: z.number().int().positive(), nome: z.string().min(1) }))
    .mutation(async ({ input }) => {
      await requirePerfil(input.usuarioId, ["Admin", "Gestor"]);
      const db = getDb();
      const emUso = await db.select({ n: sql<number>`COUNT(*)` }).from(produtos)
        .where(eq(produtos.categoria, input.nome));
      if (Number(emUso[0]?.n ?? 0) > 0)
        throw new TRPCError({ code: "BAD_REQUEST", message: `A categoria «${input.nome}» tem produtos associados — mude a categoria desses produtos primeiro.` });
      const lista = await getJsonCfg<string[]>("categorias", []);
      await setJsonCfg("categorias", lista.filter((c) => c !== input.nome));
      return { ok: true };
    }),

  /** Estado do estabelecimento (público — a loja mostra popup quando fechado) */
  estabelecimento: publicQuery.query(async () => {
    const e = await getEstadoEstab();
    return { estado: e.estado, fechado: e.estado === "fechado", por: e.por ?? null };
  }),

  /** Admin/Gestor/Caixa declara o fecho (ou reabertura / modo automático) do estabelecimento */
  setEstabelecimento: publicQuery
    .input(z.object({
      usuarioId: z.number().int().positive(),
      estado: z.enum(["auto", "aberto", "fechado"]),
    }))
    .mutation(async ({ input }) => {
      const u = await requirePerfil(input.usuarioId, ["Admin", "Gestor", "Vendedor"]);
      const novo: EstadoEstab = { estado: input.estado, dia: mzHoje(), por: u.nome, em: new Date().toISOString() };
      await setJsonCfg("estabelecimento", novo);
      return { ok: true };
    }),

  /** Horário-limite do delivery (público — a loja informa o cliente) */
  deliveryHorario: publicQuery.query(() => getDeliveryHorario()),

  setDeliveryHorario: publicQuery
    .input(z.object({
      adminId: z.number().int().positive(),
      semana: z.string().regex(/^\d{2}:\d{2}$/),
      fimSemana: z.string().regex(/^\d{2}:\d{2}$/),
    }))
    .mutation(async ({ input }) => {
      await requirePerfil(input.adminId, ["Admin"]);
      await setJsonCfg("delivery_horario", { semana: input.semana, fimSemana: input.fimSemana });
      return { ok: true };
    }),

  setBairros: publicQuery
    .input(z.object({
      adminId: z.number().int().positive(),
      bairros: z.array(z.string().min(2).max(80)).min(1).max(120),
    }))
    .mutation(async ({ input }) => {
      await requirePerfil(input.adminId, ["Admin"]);
      const limpos = [...new Set(input.bairros.map((b) => b.trim()).filter(Boolean))];
      await setJsonCfg("bairros", limpos);
      return { ok: true };
    }),
});

/* ============================================================
   DOCUMENTOS — PRO-FORMA E FACTURA
   ============================================================ */
const clienteInput = {
  clienteNome: z.string().max(160).optional(),
  clienteEmail: z.string().max(160).optional(),
  clienteNuit: z.string().max(20).optional(),
  representante: z.string().max(160).optional(),
};

export const documentosRouter = createRouter({
  list: publicQuery.query(() =>
    getDb().select().from(documentos).orderBy(desc(documentos.criadoEm)).limit(300),
  ),

  get: publicQuery
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }) => {
      const d = await getDb().query.documentos.findFirst({ where: eq(documentos.id, input.id) });
      if (!d) throw new TRPCError({ code: "NOT_FOUND", message: "Documento não encontrado" });
      return d;
    }),

  /** Pro-forma a partir de um pedido (aberto ou fechado), com dados do cliente */
  criarProforma: publicQuery
    .input(z.object({
      usuarioId: z.number().int().positive(),
      pedidoId: z.number().int().positive(),
      desconto: z.number().min(0).max(100).default(0),
      ivaModo: z.enum(["incluido", "adicional", "isento"]).default("incluido"),
      ...clienteInput,
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const p = await db.query.pedidos.findFirst({ where: eq(pedidos.id, input.pedidoId) });
      if (!p) throw new TRPCError({ code: "NOT_FOUND", message: "Pedido não encontrado" });
      if (p.status === "Anulado") throw new TRPCError({ code: "BAD_REQUEST", message: "Pedido anulado" });
      const its = await db.select().from(pedidoItens).where(eq(pedidoItens.pedidoId, p.id));
      if (its.length === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "Pedido sem itens" });

      const itens: DocItem[] = its.map((i) => ({
        nome: i.nome, qtd: i.qtd, precoUnit: i.precoUnit,
        total: Math.round(i.qtd * i.precoUnit * 100) / 100,
      }));
      const subtotal = itens.reduce((a, i) => a + i.total, 0);
      const emp = await getEmpresa();
      const { ivaValor, total } = calcTotais(subtotal, input.desconto, input.ivaModo, parseFloat(emp.iva) || 16);
      const codigo = await nextCodigo("proforma", "PF-");

      const [{ id }] = await db.insert(documentos).values({
        codigo, tipo: "Proforma", pedidoId: p.id,
        pedidoRef: `Pedido nº ${p.numero} — ${p.dataDia}`,
        clienteNome: input.clienteNome || p.referencia || null,
        clienteEmail: input.clienteEmail || null,
        clienteNuit: input.clienteNuit || null,
        representante: input.representante || null,
        ivaModo: input.ivaModo, desconto: input.desconto,
        subtotal, ivaValor, total, itens,
        usuarioId: input.usuarioId,
      }).$returningId();
      return db.query.documentos.findFirst({ where: eq(documentos.id, id) });
    }),

  /** Factura de um pedido já fechado (pago). Se já existir, devolve a existente. */
  criarFactura: publicQuery
    .input(z.object({
      usuarioId: z.number().int().positive(),
      pedidoId: z.number().int().positive(),
      ivaModo: z.enum(["incluido", "adicional", "isento"]).default("incluido"),
      ...clienteInput,
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const p = await db.query.pedidos.findFirst({ where: eq(pedidos.id, input.pedidoId) });
      if (!p) throw new TRPCError({ code: "NOT_FOUND", message: "Pedido não encontrado" });
      if (p.status !== "Fechado")
        throw new TRPCError({ code: "BAD_REQUEST", message: "A factura só pode ser emitida após o pagamento (pedido fechado)" });

      const existente = await db.query.documentos.findFirst({
        where: and(eq(documentos.tipo, "Factura"), eq(documentos.pedidoId, p.id)),
      });
      if (existente) return existente;

      const its = await db.select().from(pedidoItens).where(eq(pedidoItens.pedidoId, p.id));
      const itens: DocItem[] = its.map((i) => ({
        nome: i.nome, qtd: i.qtd, precoUnit: i.precoUnit,
        total: Math.round(i.qtd * i.precoUnit * 100) / 100,
      }));
      const emp = await getEmpresa();
      const { ivaValor, total } = calcTotais(p.subtotal, p.desconto, input.ivaModo, parseFloat(emp.iva) || 16);
      const codigo = await nextCodigo("factura", "FT-");

      const [{ id }] = await db.insert(documentos).values({
        codigo, tipo: "Factura", pedidoId: p.id,
        pedidoRef: `Pedido nº ${p.numero} — ${p.dataDia}`,
        clienteNome: input.clienteNome || p.referencia || null,
        clienteEmail: input.clienteEmail || null,
        clienteNuit: input.clienteNuit || null,
        representante: input.representante || null,
        ivaModo: input.ivaModo, desconto: p.desconto,
        subtotal: p.subtotal, ivaValor, total, itens,
        usuarioId: input.usuarioId,
      }).$returningId();
      return db.query.documentos.findFirst({ where: eq(documentos.id, id) });
    }),

  /** Apagar documento (apenas Admin) — ex.: pro-forma emitida por engano */
  eliminar: publicQuery
    .input(z.object({ adminId: z.number().int().positive(), id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      await requirePerfil(input.adminId, ["Admin"]);
      await getDb().delete(documentos).where(eq(documentos.id, input.id));
      return { ok: true };
    }),
});
