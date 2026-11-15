import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createHash, randomBytes } from "crypto";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { createRouter, publicQuery } from "./middleware";
import { getDb } from "./queries/connection";
import {
  afiliados, afiliadoTokens, afiliadoLeads, afiliadoComissoes, afiliadoRecibos,
  usuarios, contadores, despesas, reservas, pedidos, pedidosOnline,
} from "@db/schema";
import {
  AF_BONUS_INDICACAO, AF_BONUS_MES, AF_BONUS_META, AF_COMISSAO_ALTA, AF_COMISSAO_BASE,
  AF_INDICACAO_MIN, AF_LIMITE_ACTIVOS, AF_PROTECAO_DIAS, AF_INTERESSES, afNivelPorVendas,
} from "@contracts/types";
import { getEmpresa } from "./camis3";

/* ---------- helpers ---------- */
const DIA = () => new Date(Date.now() + 2 * 3600e3).toISOString().slice(0, 10); // Moçambique UTC+2
const MES = () => DIA().slice(0, 7);
const somaDias = (iso: string, dias: number) => {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
};
const r2 = (v: number) => Math.round(v * 100) / 100;
const hashSenha = (tel: string, senha: string) =>
  createHash("sha256").update(`camis-af:${tel}:${senha}`).digest("hex");

async function requireAdmin(userId: number) {
  const u = await getDb().query.usuarios.findFirst({ where: eq(usuarios.id, userId) });
  if (!u || !u.ativo) throw new TRPCError({ code: "UNAUTHORIZED", message: "Utilizador inválido" });
  if (u.perfil !== "Admin" && u.perfil !== "RH")
    throw new TRPCError({ code: "FORBIDDEN", message: "Área reservada à Direcção (Admin)" });
  return u;
}

async function nextCodigo(chave: string, prefix: string) {
  const db = getDb();
  await db.insert(contadores).values({ chave, valor: 1 })
    .onDuplicateKeyUpdate({ set: { valor: sql`${contadores.valor} + 1` } });
  const c = await db.query.contadores.findFirst({ where: eq(contadores.chave, chave) });
  return prefix + String(c?.valor ?? 1).padStart(4, "0");
}

async function afiliadoPorToken(token: string) {
  const db = getDb();
  const t = await db.query.afiliadoTokens.findFirst({ where: eq(afiliadoTokens.token, token) });
  if (!t) throw new TRPCError({ code: "UNAUTHORIZED", message: "Sessão inválida — entre de novo" });
  const a = await db.query.afiliados.findFirst({ where: eq(afiliados.id, t.afiliadoId) });
  if (!a) throw new TRPCError({ code: "UNAUTHORIZED", message: "Afiliado não encontrado" });
  return a;
}

const publico = (a: typeof afiliados.$inferSelect) => ({
  id: a.id, codigo: a.codigo, nome: a.nome, nivel: a.nivel, status: a.status,
  telefone: a.telefone, fotoPerfil: a.fotoPerfil, vendasTotal: a.vendasTotal,
  whatsVerificado: a.whatsVerificado,
});

/** Quantos afiliados ocupam vagas activas (Activo + Experimental) */
async function vagasOcupadas() {
  const rows = await getDb().select({ n: sql<number>`count(*)` }).from(afiliados)
    .where(inArray(afiliados.status, ["Activo", "Experimental"]));
  return Number(rows[0]?.n ?? 0);
}

/* ============ INTEGRAÇÃO COM O SISTEMA DE VENDAS ============ */

/** Lança comissão(ões) para uma venda atribuída a um afiliado.
 *  parcela1 = metade na primeira prestação; parcela2 = metade na última.
 *  Quando o pagamento é único, chama-se com ambas=true (as duas metades de uma vez). */
export async function lancarComissao(opts: {
  afiliadoId: number;
  origem: "Reserva" | "Pedido" | "Online";
  origemId: number;
  origemRef: string;
  descricao: string;
  valorVenda: number;
  alta: boolean; // true = 10% (pacotes de salão, piscina, decoração) | false = 3%
  parcela: 1 | 2 | 0; // 0 = pagamento único (lança as duas metades)
  leadId?: number | null;
}) {
  const db = getDb();
  const af = await db.query.afiliados.findFirst({ where: eq(afiliados.id, opts.afiliadoId) });
  if (!af || !["Activo", "Experimental"].includes(af.status)) return;
  const pct = opts.alta ? AF_COMISSAO_ALTA : AF_COMISSAO_BASE;
  const metade = r2((opts.valorVenda * pct) / 100 / 2);
  const mes = MES();
  const base = {
    afiliadoId: af.id, leadId: opts.leadId ?? null, origem: opts.origem,
    origemId: opts.origemId, origemRef: opts.origemRef, descricao: opts.descricao.slice(0, 290),
    valorVenda: r2(opts.valorVenda), pct, mesReferencia: mes,
  };
  if (opts.parcela === 1 || opts.parcela === 0) {
    // evita duplicar parcela 1 (ex.: re-confirmação)
    const dup = await db.query.afiliadoComissoes.findFirst({
      where: and(eq(afiliadoComissoes.origem, opts.origem), eq(afiliadoComissoes.origemId, opts.origemId), eq(afiliadoComissoes.parcela, 1), inArray(afiliadoComissoes.estado, ["Pendente", "Paga"])),
    });
    if (!dup) await db.insert(afiliadoComissoes).values({ ...base, valorComissao: metade, parcela: 1 });
  }
  if (opts.parcela === 2 || opts.parcela === 0) {
    const dup = await db.query.afiliadoComissoes.findFirst({
      where: and(eq(afiliadoComissoes.origem, opts.origem), eq(afiliadoComissoes.origemId, opts.origemId), eq(afiliadoComissoes.parcela, 2), inArray(afiliadoComissoes.estado, ["Pendente", "Paga"])),
    });
    if (!dup) await db.insert(afiliadoComissoes).values({ ...base, valorComissao: r2(opts.valorVenda * pct / 100) - metade, parcela: 2 });
  }
  // nível do afiliado sobe com o nº de vendas
  await db.update(afiliados).set({
    vendasTotal: sql`${afiliados.vendasTotal} + 1`,
    nivel: afNivelPorVendas((af.vendasTotal ?? 0) + 1),
  }).where(eq(afiliados.id, af.id));
  // marca o lead como convertido e renova protecção de 90 dias
  if (opts.leadId) {
    await db.update(afiliadoLeads).set({
      estado: "Convertido", protegidoAte: somaDias(DIA(), AF_PROTECAO_DIAS),
      ...(opts.origem === "Reserva" ? { reservaId: opts.origemId } : {}),
      ...(opts.origem !== "Reserva" ? { pedidoId: opts.origemId } : {}),
    }).where(eq(afiliadoLeads.id, opts.leadId));
  }
}

/** Estorna comissões ainda pendentes de uma venda cancelada/anulada. */
export async function estornarComissoes(origem: "Reserva" | "Pedido" | "Online", origemId: number) {
  await getDb().update(afiliadoComissoes).set({ estado: "Estornada" })
    .where(and(eq(afiliadoComissoes.origem, origem), eq(afiliadoComissoes.origemId, origemId), eq(afiliadoComissoes.estado, "Pendente")));
}

/** Resolve o afiliado a partir do código informado no ponto de venda (AF-0001). */
export async function afiliadoPorCodigo(codigo: string | undefined | null) {
  if (!codigo) return null;
  const a = await getDb().query.afiliados.findFirst({
    where: eq(afiliados.codigo, codigo.trim().toUpperCase()),
  });
  if (!a || !["Activo", "Experimental"].includes(a.status)) return null;
  return a;
}

/** Lead protegido deste afiliado para o contacto informado (protecção 90 dias). */
export async function leadProtegido(afiliadoId: number, contacto: string | undefined | null) {
  if (!contacto) return null;
  const dig = (s: string) => s.replace(/\D/g, "").slice(-9);
  const alvo = dig(contacto);
  if (!alvo) return null;
  const leads = await getDb().select().from(afiliadoLeads)
    .where(and(eq(afiliadoLeads.afiliadoId, afiliadoId), inArray(afiliadoLeads.estado, ["Novo", "Negociacao", "Convertido"])));
  return leads.find((l) => dig(l.clienteContacto) === alvo && (!l.protegidoAte || l.protegidoAte >= DIA())) ?? null;
}

/* ============ ROUTER ============ */
const senhaSchema = z.string().min(6).max(60);

export const afiliadosRouter = createRouter({
  /* ----- público: candidatura ----- */
  candidatura: publicQuery
    .input(z.object({
      nome: z.string().min(5).max(160),
      biNumero: z.string().min(3).max(60),
      biDocumento: z.string().max(4_500_000), // data URL da foto do BI
      dataNascimento: z.string().length(10).optional(),
      residencia: z.string().min(3).max(200),
      email: z.string().email().max(160).optional().or(z.literal("")),
      telefone: z.string().min(9).max(40),
      telefoneAlternativo: z.string().max(40).optional().or(z.literal("")),
      fotoPerfil: z.string().max(4_500_000).optional(),
      senha: senhaSchema,
      disponibilidade: z.string().max(120).optional(),
      experiencia: z.string().max(500).optional(),
      redesSociais: z.string().max(300).optional(),
      metodoPagamento: z.string().max(60).optional(),
      contaPagamento: z.string().max(120).optional(),
      nuit: z.string().max(30).optional(),
      indicadoPorCodigo: z.string().max(12).optional().or(z.literal("")),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const existe = await db.query.afiliados.findFirst({ where: eq(afiliados.telefone, input.telefone.trim()) });
      if (existe) throw new TRPCError({ code: "CONFLICT", message: "Já existe uma candidatura com este telefone." });
      let indicadoPorId: number | null = null, indicadoPorNome: string | null = null;
      if (input.indicadoPorCodigo) {
        const ind = await afiliadoPorCodigo(input.indicadoPorCodigo);
        if (ind) { indicadoPorId = ind.id; indicadoPorNome = ind.nome; }
      }
      const codigo = await nextCodigo("afiliado", "AF-");
      const codigoVerificacao = String(Math.floor(100000 + Math.random() * 900000));
      const ocupadas = await vagasOcupadas();
      const status = ocupadas >= AF_LIMITE_ACTIVOS ? "ListaEspera" as const : "Pendente" as const;
      const [{ id }] = await db.insert(afiliados).values({
        codigo, nome: input.nome.trim(), biNumero: input.biNumero.trim(),
        biDocumento: input.biDocumento || null,
        dataNascimento: input.dataNascimento || null,
        residencia: input.residencia.trim(), email: input.email?.trim() || null,
        telefone: input.telefone.trim(), telefoneAlternativo: input.telefoneAlternativo?.trim() || null,
        fotoPerfil: input.fotoPerfil || null, senhaHash: hashSenha(input.telefone.trim(), input.senha),
        codigoVerificacao, status,
        disponibilidade: input.disponibilidade || null, experiencia: input.experiencia || null,
        redesSociais: input.redesSociais || null, metodoPagamento: input.metodoPagamento || null,
        contaPagamento: input.contaPagamento || null, nuit: input.nuit || null,
        indicadoPorId, indicadoPorNome,
      }).$returningId();
      return { ok: true, id, codigo, status, codigoVerificacao, listaEspera: status === "ListaEspera" };
    }),

  login: publicQuery
    .input(z.object({ telefone: z.string().min(9).max(40), senha: z.string().min(1).max(60) }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const a = await db.query.afiliados.findFirst({ where: eq(afiliados.telefone, input.telefone.trim()) });
      if (!a) throw new TRPCError({ code: "NOT_FOUND", message: "Telefone não cadastrado." });
      if (a.bloqueado) throw new TRPCError({ code: "FORBIDDEN", message: "Conta bloqueada por tentativas falhadas. Fale com a Direcção." });
      if (a.senhaHash !== hashSenha(input.telefone.trim(), input.senha)) {
        const t = (a.tentativas ?? 0) + 1;
        await db.update(afiliados).set({ tentativas: t, bloqueado: t >= 5 }).where(eq(afiliados.id, a.id));
        throw new TRPCError({ code: "UNAUTHORIZED", message: t >= 5 ? "Conta bloqueada. Fale com a Direcção." : `Senha incorrecta (${t}/5 tentativas).` });
      }
      await db.update(afiliados).set({ tentativas: 0 }).where(eq(afiliados.id, a.id));
      const token = randomBytes(24).toString("hex");
      await db.insert(afiliadoTokens).values({ token, afiliadoId: a.id });
      return { ok: true, token, afiliado: publico(a) };
    }),

  sair: publicQuery
    .input(z.object({ token: z.string() }))
    .mutation(async ({ input }) => {
      await getDb().delete(afiliadoTokens).where(eq(afiliadoTokens.token, input.token));
      return { ok: true };
    }),

  /* ----- público: resolver código de afiliado do link da loja (?loja=1&ref=AF-XXXX) ----- */
  resolverCodigo: publicQuery
    .input(z.object({ codigo: z.string().min(3).max(20) }))
    .query(async ({ input }) => {
      const a = await afiliadoPorCodigo(input.codigo);
      if (!a) return { valido: false as const };
      return { valido: true as const, codigo: a.codigo, nome: a.nome.split(" ")[0] };
    }),

  me: publicQuery
    .input(z.object({ token: z.string() }))
    .query(async ({ input }) => {
      const a = await afiliadoPorToken(input.token);
      return { afiliado: { ...publico(a), residencia: a.residencia, email: a.email, metodoPagamento: a.metodoPagamento, contaPagamento: a.contaPagamento, dataNascimento: a.dataNascimento } };
    }),

  /* ----- afiliado: painel próprio (só os seus dados) ----- */
  painel: publicQuery
    .input(z.object({ token: z.string() }))
    .query(async ({ input }) => {
      const db = getDb();
      const a = await afiliadoPorToken(input.token);
      const comissoes = await db.select().from(afiliadoComissoes)
        .where(eq(afiliadoComissoes.afiliadoId, a.id)).orderBy(desc(afiliadoComissoes.id)).limit(100);
      const leads = await db.select().from(afiliadoLeads)
        .where(eq(afiliadoLeads.afiliadoId, a.id)).orderBy(desc(afiliadoLeads.id)).limit(100);
      const recibos = await db.select({
        id: afiliadoRecibos.id, codigo: afiliadoRecibos.codigo, mesReferencia: afiliadoRecibos.mesReferencia,
        totalComissoes: afiliadoRecibos.totalComissoes, bonusMeta: afiliadoRecibos.bonusMeta,
        bonusMes: afiliadoRecibos.bonusMes, bonusIndicacao: afiliadoRecibos.bonusIndicacao,
        total: afiliadoRecibos.total, metodo: afiliadoRecibos.metodo, estado: afiliadoRecibos.estado,
        assinadoEm: afiliadoRecibos.assinadoEm, pagoEm: afiliadoRecibos.pagoEm,
      }).from(afiliadoRecibos).where(eq(afiliadoRecibos.afiliadoId, a.id)).orderBy(desc(afiliadoRecibos.id)).limit(24);
      // ranking do mês (sem valores dos outros — só posição)
      const mes = MES();
      const somas = await db.select({ afiliadoId: afiliadoComissoes.afiliadoId, tot: sql<number>`sum(valor_comissao)` })
        .from(afiliadoComissoes)
        .where(and(eq(afiliadoComissoes.mesReferencia, mes), inArray(afiliadoComissoes.estado, ["Pendente", "Paga"])))
        .groupBy(afiliadoComissoes.afiliadoId);
      somas.sort((x, y) => Number(y.tot) - Number(x.tot));
      const posicao = somas.findIndex((s) => s.afiliadoId === a.id) + 1;
      const meuMes = Number(somas.find((s) => s.afiliadoId === a.id)?.tot ?? 0);
      const pendente = comissoes.filter((c) => c.estado === "Pendente").reduce((s, c) => s + c.valorComissao, 0);
      const pago = comissoes.filter((c) => c.estado === "Paga").reduce((s, c) => s + c.valorComissao, 0);
      // meta mensal: valor total de vendas comissionadas no mês (meta configurada em Configurações)
      const emp = await getEmpresa();
      const metaMes = Number(emp.metaAfiliadoMes) || 80000;
      const bonusCfg = {
        meta: Number(emp.bonusAfMeta) || AF_BONUS_META,
        mes: Number(emp.bonusAfMes) || AF_BONUS_MES,
        indicacao: Number(emp.bonusAfIndicacao) || AF_BONUS_INDICACAO,
        minIndicacao: Number(emp.minVendaIndicacao) || AF_INDICACAO_MIN,
      };
      const vendasMes = comissoes.filter((c) => c.mesReferencia === mes && c.estado !== "Estornada").reduce((s, c) => s + c.valorVenda, 0);
      return {
        afiliado: { ...publico(a), residencia: a.residencia, email: a.email, metodoPagamento: a.metodoPagamento, contaPagamento: a.contaPagamento },
        comissoes, leads, recibos,
        kpis: { pendente: r2(pendente), pago: r2(pago), mes: r2(meuMes), posicao: posicao || null, concorrentes: somas.length,
          vendasMes: r2(vendasMes), metaMes, faltaMeta: Math.max(0, r2(metaMes - vendasMes)),
          bonusMeta: bonusCfg.meta, bonusMes: bonusCfg.mes,
          bonusIndicacao: bonusCfg.indicacao, minIndicacao: bonusCfg.minIndicacao },
      };
    }),

  registarLead: publicQuery
    .input(z.object({
      token: z.string(), clienteNome: z.string().min(3).max(160),
      clienteContacto: z.string().min(9).max(60),
      interesse: z.enum(AF_INTERESSES), obs: z.string().max(500).optional(),
    }))
    .mutation(async ({ input }) => {
      const a = await afiliadoPorToken(input.token);
      if (!["Activo", "Experimental"].includes(a.status))
        throw new TRPCError({ code: "FORBIDDEN", message: "A sua conta ainda não está activa para registar clientes." });
      // outro afiliado já protege este contacto?
      const dig = (s: string) => s.replace(/\D/g, "").slice(-9);
      const alvo = dig(input.clienteContacto);
      const todos = await getDb().select().from(afiliadoLeads)
        .where(inArray(afiliadoLeads.estado, ["Novo", "Negociacao"]));
      const conflito = todos.find((l) => l.afiliadoId !== a.id && dig(l.clienteContacto) === alvo && (!l.protegidoAte || l.protegidoAte >= DIA()));
      if (conflito) throw new TRPCError({ code: "CONFLICT", message: "Este cliente já está protegido por outro afiliado." });
      const proprio = await leadProtegido(a.id, input.clienteContacto);
      if (proprio) {
        // renova a protecção por mais 90 dias
        await getDb().update(afiliadoLeads).set({ protegidoAte: somaDias(DIA(), AF_PROTECAO_DIAS) }).where(eq(afiliadoLeads.id, proprio.id));
        return { ok: true, renovado: true, protegidoAte: somaDias(DIA(), AF_PROTECAO_DIAS) };
      }
      const protegidoAte = somaDias(DIA(), AF_PROTECAO_DIAS);
      const [{ id }] = await getDb().insert(afiliadoLeads).values({
        afiliadoId: a.id, clienteNome: input.clienteNome.trim(), clienteContacto: input.clienteContacto.trim(),
        interesse: input.interesse, obs: input.obs?.trim() || null, protegidoAte,
      }).$returningId();
      return { ok: true, id, protegidoAte };
    }),

  leadEstadoProprio: publicQuery
    .input(z.object({ token: z.string(), leadId: z.number().int().positive(), estado: z.enum(["Novo", "Negociacao", "Perdido"]) }))
    .mutation(async ({ input }) => {
      const a = await afiliadoPorToken(input.token);
      const l = await getDb().query.afiliadoLeads.findFirst({ where: eq(afiliadoLeads.id, input.leadId) });
      if (!l || l.afiliadoId !== a.id) throw new TRPCError({ code: "NOT_FOUND" });
      if (l.estado === "Convertido") throw new TRPCError({ code: "BAD_REQUEST", message: "Lead já convertido." });
      await getDb().update(afiliadoLeads).set({ estado: input.estado }).where(eq(afiliadoLeads.id, l.id));
      return { ok: true };
    }),

  assinarRecibo: publicQuery
    .input(z.object({ token: z.string(), reciboId: z.number().int().positive(), nomeAssinatura: z.string().min(5).max(160) }))
    .mutation(async ({ input }) => {
      const a = await afiliadoPorToken(input.token);
      const r = await getDb().query.afiliadoRecibos.findFirst({ where: eq(afiliadoRecibos.id, input.reciboId) });
      if (!r || r.afiliadoId !== a.id) throw new TRPCError({ code: "NOT_FOUND", message: "Recibo não encontrado." });
      if (r.estado !== "Emitido") throw new TRPCError({ code: "BAD_REQUEST", message: "Este recibo já foi assinado ou pago." });
      await getDb().update(afiliadoRecibos).set({
        estado: "Assinado", assinadoPor: input.nomeAssinatura.trim(), assinadoEm: new Date(),
      }).where(eq(afiliadoRecibos.id, r.id));
      return { ok: true };
    }),

  /* ----- ADMIN (só a Direcção vê comissões e a lista completa) ----- */
  listar: publicQuery
    .input(z.object({ adminId: z.number().int().positive(), status: z.string().optional() }))
    .query(async ({ input }) => {
      await requireAdmin(input.adminId);
      const db = getDb();
      const rows = await db.select().from(afiliados).orderBy(desc(afiliados.id)).limit(300);
      const ocupadas = await vagasOcupadas();
      return {
        vagas: { ocupadas, limite: AF_LIMITE_ACTIVOS },
        afiliados: rows.map((a) => ({
          id: a.id, codigo: a.codigo, nome: a.nome, telefone: a.telefone, telefoneAlternativo: a.telefoneAlternativo,
          email: a.email, residencia: a.residencia, biNumero: a.biNumero, biDocumento: a.biDocumento,
          fotoPerfil: a.fotoPerfil, nivel: a.nivel, status: a.status, whatsVerificado: a.whatsVerificado,
          codigoVerificacao: a.whatsVerificado ? null : a.codigoVerificacao,
          vendasTotal: a.vendasTotal, metodoPagamento: a.metodoPagamento, contaPagamento: a.contaPagamento,
          nuit: a.nuit, indicadoPorNome: a.indicadoPorNome, disponibilidade: a.disponibilidade,
          experiencia: a.experiencia, redesSociais: a.redesSociais, bloqueado: a.bloqueado,
          dataNascimento: a.dataNascimento, criadoEm: a.criadoEm, aprovadoEm: a.aprovadoEm,
        })).filter((a) => !input.status || a.status === input.status),
      };
    }),

  decidir: publicQuery
    .input(z.object({
      adminId: z.number().int().positive(), afiliadoId: z.number().int().positive(),
      accao: z.enum(["aprovar", "experimental", "suspender", "rejeitar", "reativar", "promover", "desbloquear"]),
    }))
    .mutation(async ({ input }) => {
      await requireAdmin(input.adminId);
      const db = getDb();
      const a = await db.query.afiliados.findFirst({ where: eq(afiliados.id, input.afiliadoId) });
      if (!a) throw new TRPCError({ code: "NOT_FOUND" });
      const ocupadas = await vagasOcupadas();
      let status: typeof a.status | null = null;
      if (input.accao === "aprovar") {
        if (ocupadas >= AF_LIMITE_ACTIVOS && a.status !== "Activo")
          throw new TRPCError({ code: "BAD_REQUEST", message: `Limite de ${AF_LIMITE_ACTIVOS} vagas activas atingido — o candidato fica em lista de espera.` });
        status = "Activo";
      }
      if (input.accao === "experimental") {
        if (ocupadas >= AF_LIMITE_ACTIVOS) throw new TRPCError({ code: "BAD_REQUEST", message: "Sem vagas activas." });
        status = "Experimental";
      }
      if (input.accao === "suspender") status = "Suspenso";
      if (input.accao === "rejeitar") status = "Rejeitado";
      if (input.accao === "reativar") {
        if (ocupadas >= AF_LIMITE_ACTIVOS) throw new TRPCError({ code: "BAD_REQUEST", message: "Sem vagas activas." });
        status = "Activo";
      }
      if (input.accao === "promover") { // da lista de espera para activo
        if (a.status !== "ListaEspera") throw new TRPCError({ code: "BAD_REQUEST", message: "Só se promove quem está na lista de espera." });
        if (ocupadas >= AF_LIMITE_ACTIVOS) throw new TRPCError({ code: "BAD_REQUEST", message: "Sem vagas activas." });
        status = "Activo";
      }
      if (input.accao === "desbloquear") {
        await db.update(afiliados).set({ bloqueado: false, tentativas: 0 }).where(eq(afiliados.id, a.id));
        return { ok: true, status: a.status };
      }
      await db.update(afiliados).set({ status: status!, ...(status === "Activo" && !a.aprovadoEm ? { aprovadoEm: new Date() } : {}) }).where(eq(afiliados.id, a.id));
      return { ok: true, status };
    }),

  verificarWhats: publicQuery
    .input(z.object({ adminId: z.number().int().positive(), afiliadoId: z.number().int().positive(), verificado: z.boolean() }))
    .mutation(async ({ input }) => {
      await requireAdmin(input.adminId);
      await getDb().update(afiliados).set({ whatsVerificado: input.verificado, codigoVerificacao: input.verificado ? null : undefined })
        .where(eq(afiliados.id, input.afiliadoId));
      return { ok: true };
    }),

  leads: publicQuery
    .input(z.object({ adminId: z.number().int().positive() }))
    .query(async ({ input }) => {
      await requireAdmin(input.adminId);
      const db = getDb();
      const rows = await db.select().from(afiliadoLeads).orderBy(desc(afiliadoLeads.id)).limit(300);
      const afs = await db.select({ id: afiliados.id, nome: afiliados.nome, codigo: afiliados.codigo }).from(afiliados);
      const mapa = new Map(afs.map((x) => [x.id, x]));
      return rows.map((l) => ({ ...l, afiliadoNome: mapa.get(l.afiliadoId)?.nome, afiliadoCodigo: mapa.get(l.afiliadoId)?.codigo }));
    }),

  leadEstado: publicQuery
    .input(z.object({ adminId: z.number().int().positive(), leadId: z.number().int().positive(), estado: z.enum(["Novo", "Negociacao", "Convertido", "Perdido"]) }))
    .mutation(async ({ input }) => {
      await requireAdmin(input.adminId);
      await getDb().update(afiliadoLeads).set({ estado: input.estado }).where(eq(afiliadoLeads.id, input.leadId));
      return { ok: true };
    }),

  comissoes: publicQuery
    .input(z.object({ adminId: z.number().int().positive(), mes: z.string().length(7).optional() }))
    .query(async ({ input }) => {
      await requireAdmin(input.adminId);
      const db = getDb();
      const rows = await db.select().from(afiliadoComissoes).orderBy(desc(afiliadoComissoes.id)).limit(500);
      const afs = await db.select({ id: afiliados.id, nome: afiliados.nome, codigo: afiliados.codigo }).from(afiliados);
      const mapa = new Map(afs.map((x) => [x.id, x]));
      return rows.filter((c) => !input.mes || c.mesReferencia === input.mes)
        .map((c) => ({ ...c, afiliadoNome: mapa.get(c.afiliadoId)?.nome, afiliadoCodigo: mapa.get(c.afiliadoId)?.codigo }));
    }),

  estornarComissao: publicQuery
    .input(z.object({ adminId: z.number().int().positive(), comissaoId: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      await requireAdmin(input.adminId);
      await getDb().update(afiliadoComissoes).set({ estado: "Estornada" })
        .where(and(eq(afiliadoComissoes.id, input.comissaoId), eq(afiliadoComissoes.estado, "Pendente")));
      return { ok: true };
    }),

  /** Fecho do mês: calcula comissões + bónus e emite recibos RAF- (pagamento no dia 5). */
  fecharMes: publicQuery
    .input(z.object({ adminId: z.number().int().positive(), mes: z.string().length(7) }))
    .mutation(async ({ input }) => {
      const admin = await requireAdmin(input.adminId);
      const db = getDb();
      const emp = await getEmpresa();
      const metaMes = Number(emp.metaAfiliadoMes) || 80000; // meta mensal de vendas (MZN) — configurável em Configurações
      const BONUS_META = Number(emp.bonusAfMeta) || AF_BONUS_META;
      const BONUS_MES = Number(emp.bonusAfMes) || AF_BONUS_MES;
      const BONUS_IND = Number(emp.bonusAfIndicacao) || AF_BONUS_INDICACAO;
      const MIN_IND = Number(emp.minVendaIndicacao) || AF_INDICACAO_MIN;
      const ja = await db.query.afiliadoRecibos.findFirst({ where: eq(afiliadoRecibos.mesReferencia, input.mes) });
      if (ja) throw new TRPCError({ code: "CONFLICT", message: `O mês ${input.mes} já foi fechado (recibo ${ja.codigo}).` });
      const pendentes = await db.select().from(afiliadoComissoes)
        .where(and(eq(afiliadoComissoes.mesReferencia, input.mes), eq(afiliadoComissoes.estado, "Pendente"), isNull(afiliadoComissoes.reciboId)));
      if (!pendentes.length) throw new TRPCError({ code: "BAD_REQUEST", message: "Sem comissões pendentes nesse mês." });
      const porAf = new Map<number, typeof pendentes>();
      for (const c of pendentes) {
        const arr = porAf.get(c.afiliadoId) ?? []; arr.push(c); porAf.set(c.afiliadoId, arr);
      }
      // Afiliado do Mês = maior total de comissões do mês
      let topId = 0, topTot = -1;
      for (const [id, arr] of porAf) {
        const t = arr.reduce((s, c) => s + c.valorComissao, 0);
        if (t > topTot) { topTot = t; topId = id; }
      }
      const recibosCriados: { codigo: string; afiliadoId: number; total: number }[] = [];
      for (const [afId, arr] of porAf) {
        const af = await db.query.afiliados.findFirst({ where: eq(afiliados.id, afId) });
        if (!af) continue;
        const totalComissoes = r2(arr.reduce((s, c) => s + c.valorComissao, 0));
        // bónus de meta: vendas do mês (soma do valor das vendas comissionadas) ≥ meta configurada
        const vendasMes = r2(arr.filter((c) => c.estado !== "Estornada").reduce((s, c) => s + c.valorVenda, 0));
        const bonusMeta = vendasMes >= metaMes ? BONUS_META : 0;
        const bonusMes = afId === topId ? BONUS_MES : 0;
        // bónus de indicação: afiliados indicados por este cuja 1ª venda (> 2.000 MZN) caiu neste mês
        const indicados = await db.select().from(afiliados).where(eq(afiliados.indicadoPorId, afId));
        let bonusIndicacao = 0;
        for (const ind of indicados) {
          const primeira = await db.select({ mes: afiliadoComissoes.mesReferencia, valor: afiliadoComissoes.valorVenda })
            .from(afiliadoComissoes)
            .where(eq(afiliadoComissoes.afiliadoId, ind.id)).orderBy(afiliadoComissoes.id).limit(1);
          if (primeira[0]?.mes === input.mes && primeira[0].valor > MIN_IND) bonusIndicacao += BONUS_IND;
        }
        const total = r2(totalComissoes + bonusMeta + bonusMes + bonusIndicacao);
        const codigo = await nextCodigo("reciboAf", "RAF-");
        const [{ id: reciboId }] = await db.insert(afiliadoRecibos).values({
          codigo, afiliadoId: afId, mesReferencia: input.mes, totalComissoes,
          bonusMeta, bonusMes, bonusIndicacao, total, metodo: af.metodoPagamento,
        }).$returningId();
        await db.update(afiliadoComissoes).set({ reciboId })
          .where(and(eq(afiliadoComissoes.afiliadoId, afId), eq(afiliadoComissoes.mesReferencia, input.mes), eq(afiliadoComissoes.estado, "Pendente"), isNull(afiliadoComissoes.reciboId)));
        recibosCriados.push({ codigo, afiliadoId: afId, total });
      }
      return { ok: true, recibos: recibosCriados, adminNome: admin.nome };
    }),

  /** Pagar recibo: marca comissões como pagas e lança a despesa (categoria Afiliados — Comissões). */
  pagarRecibo: publicQuery
    .input(z.object({ adminId: z.number().int().positive(), reciboId: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const admin = await requireAdmin(input.adminId);
      const db = getDb();
      const r = await db.query.afiliadoRecibos.findFirst({ where: eq(afiliadoRecibos.id, input.reciboId) });
      if (!r) throw new TRPCError({ code: "NOT_FOUND" });
      if (r.estado === "Pago") throw new TRPCError({ code: "BAD_REQUEST", message: "Recibo já pago." });
      const af = await db.query.afiliados.findFirst({ where: eq(afiliados.id, r.afiliadoId) });
      const [{ id: despesaId }] = await db.insert(despesas).values({
        dataDia: DIA(), categoria: "Afiliados — Comissões",
        descricao: `Comissões ${r.mesReferencia} — ${af?.nome ?? ""} (${r.codigo})`,
        fornecedor: af?.nome ?? null, valor: r.total, usuarioId: admin.id,
        formaPagamento: "Pago", valorPago: r.total, // comissões pagas na totalidade
      }).$returningId();
      await db.update(afiliadoRecibos).set({ estado: "Pago", pagoEm: new Date(), despesaId }).where(eq(afiliadoRecibos.id, r.id));
      await db.update(afiliadoComissoes).set({ estado: "Paga", pagoEm: new Date() })
        .where(eq(afiliadoComissoes.reciboId, r.id));
      return { ok: true, despesaId, total: r.total };
    }),

  recibos: publicQuery
    .input(z.object({ adminId: z.number().int().positive() }))
    .query(async ({ input }) => {
      await requireAdmin(input.adminId);
      const db = getDb();
      const rows = await db.select().from(afiliadoRecibos).orderBy(desc(afiliadoRecibos.id)).limit(200);
      const afs = await db.select({ id: afiliados.id, nome: afiliados.nome, codigo: afiliados.codigo, telefone: afiliados.telefone, metodoPagamento: afiliados.metodoPagamento, contaPagamento: afiliados.contaPagamento }).from(afiliados);
      const mapa = new Map(afs.map((x) => [x.id, x]));
      return rows.map((r) => ({ ...r, afiliado: mapa.get(r.afiliadoId) }));
    }),

  dashboard: publicQuery
    .input(z.object({ adminId: z.number().int().positive() }))
    .query(async ({ input }) => {
      await requireAdmin(input.adminId);
      const db = getDb();
      const mes = MES();
      const afs = await db.select().from(afiliados);
      const coms = await db.select().from(afiliadoComissoes).where(eq(afiliadoComissoes.mesReferencia, mes));
      const leadsNovos = await db.select({ n: sql<number>`count(*)` }).from(afiliadoLeads).where(eq(afiliadoLeads.estado, "Novo"));
      const porAf = new Map<number, number>();
      for (const c of coms.filter((x) => x.estado !== "Estornada")) porAf.set(c.afiliadoId, (porAf.get(c.afiliadoId) ?? 0) + c.valorComissao);
      const ranking = [...porAf.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id, tot]) => {
        const a = afs.find((x) => x.id === id);
        return { codigo: a?.codigo, nome: a?.nome, nivel: a?.nivel, total: r2(tot) };
      });
      return {
        mes,
        vagas: { ocupadas: afs.filter((a) => ["Activo", "Experimental"].includes(a.status)).length, limite: AF_LIMITE_ACTIVOS },
        pendentes: afs.filter((a) => a.status === "Pendente").length,
        listaEspera: afs.filter((a) => a.status === "ListaEspera").length,
        leadsNovos: Number(leadsNovos[0]?.n ?? 0),
        comissoesMes: r2(coms.filter((c) => c.estado !== "Estornada").reduce((s, c) => s + c.valorComissao, 0)),
        ranking,
      };
    }),

  interesses: publicQuery.query(() => AF_INTERESSES),
});
