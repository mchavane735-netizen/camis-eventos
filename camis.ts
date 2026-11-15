import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, isNotNull, ne, sql } from "drizzle-orm";
import { createRouter, publicQuery } from "./middleware";
import { getDb } from "./queries/connection";
import {
  usuarios, produtos, pedidos, pedidoItens, pedidoItensLog, reservas,
  pagamentos, stockMov, contadores, documentos, trabalhadores, sessoes,
} from "@db/schema";
import type { TrpcContext } from "./context";
import { baixarStockProduto, reporStockProduto, getHorarios, setJsonCfg } from "./camis3";
import { afiliadoPorCodigo, leadProtegido, lancarComissao, estornarComissoes } from "./afiliados";
import { PERFIS, SENHA_RE, SENHA_REGRA , ESPACOS_COMISSAO_ALTA } from "@contracts/types";

/* ---------- helpers ---------- */
const DIA = () => {
  // Moçambique = UTC+2 (sem horário de verão)
  return new Date(Date.now() + 2 * 3600e3).toISOString().slice(0, 10);
};

/** Valida a senha forte: mín. 6 caracteres, maiúscula + minúscula + número + símbolo */
const senhaSchema = z.string().min(6).max(60).regex(SENHA_RE, SENHA_REGRA);
const senhaFraca = (s: string) => !SENHA_RE.test(s);

/* ---------- Sessão persistente por cookie de servidor (7 dias) ----------
   Resolve o caso de telemóveis com armazenamento local bloqueado: o login grava
   um cookie HttpOnly que o browser envia sozinho — ao actualizar a página a
   sessão é restaurada pelo servidor, sem depender do localStorage. */
const SESSAO_MS = 7 * 86400e3;
function tokenDoCookie(ctx: TrpcContext): string | null {
  const m = /(?:^|;\s*)camis_sess=([a-f0-9-]{32,36})/.exec(ctx.req.headers.get("cookie") || "");
  return m ? m[1] : null;
}
async function emitirSessao(ctx: TrpcContext, usuarioId: number) {
  const token = crypto.randomUUID().replace(/-/g, "");
  const db = getDb();
  await db.insert(sessoes).values({ token, usuarioId, expiraEm: new Date(Date.now() + SESSAO_MS) });
  ctx.resHeaders.append("Set-Cookie", `camis_sess=${token}; Path=/; Max-Age=${SESSAO_MS / 1000}; SameSite=Lax; HttpOnly`);
}
const perfilSchema = z.enum(PERFIS);

/** Leituras de utilizadores TOLERANTES à migração v17 pendente: se as colunas
    desbloqueado_ate / bloqueio_manual ainda não existirem na BD (servidor ainda
    não reiniciou após a actualização), cai para as colunas antigas e assume
    "sem bloqueio manual / sem desbloqueio especial" — o login nunca falha por isto. */
const USUARIO_COLS_LEGACY = {
  id: usuarios.id, nome: usuarios.nome, perfil: usuarios.perfil, pin: usuarios.pin,
  telefone: usuarios.telefone, tentativas: usuarios.tentativas, bloqueado: usuarios.bloqueado,
  ultimoPing: usuarios.ultimoPing, ativo: usuarios.ativo, criadoEm: usuarios.criadoEm,
};
const comCamposV17 = <T extends object>(u: T) => ({ ...u, desbloqueadoAte: null, bloqueioManual: false });
const ehErroColunaV17 = (e: unknown) => /desbloqueado_ate|bloqueio_manual|Unknown column/i.test(String((e as Error)?.message ?? e));

async function findUsuarioById(id: number) {
  const db = getDb();
  try { return await db.query.usuarios.findFirst({ where: eq(usuarios.id, id) }); }
  catch (e) {
    if (!ehErroColunaV17(e)) throw e;
    const [r] = await db.select(USUARIO_COLS_LEGACY).from(usuarios).where(eq(usuarios.id, id));
    return r ? comCamposV17(r) : undefined;
  }
}

async function requirePerfil(userId: number, perfis: string[]) {
  const u = await findUsuarioById(userId);
  if (!u || !u.ativo) throw new TRPCError({ code: "UNAUTHORIZED", message: "Utilizador inválido" });
  if (!perfis.includes(u.perfil))
    throw new TRPCError({ code: "FORBIDDEN", message: "Ação reservada a: " + perfis.join(", ") });
  return u;
}

/* ---------- Controlo de acesso dos VENDEDORES por horário (v17) ----------
   · Dentro do horário de funcionamento do dia (abre–fecha): acesso livre
     (o "desbloqueio de manhã" é automático à hora de abertura).
   · Chegada a hora de saída / dia fechado: acesso bloqueado automaticamente.
   · O Gerente ou o Admin podem:
       - estender o horário de fecho do dia (Config → Horários);
       - desbloquear um vendedor até uma hora específica (desbloqueadoAte);
       - bloquear manualmente no fecho da loja (bloqueioManual). */
const mzAgora = () => new Date(Date.now() + 2 * 3600e3); // relógio de Moçambique (UTC+2)

/** Data real (UTC) correspondente a HH:mm de HOJE em Moçambique */
function hojeMzAs(hora: string): Date {
  const m = mzAgora();
  const [h, min] = hora.split(":").map(Number);
  return new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth(), m.getUTCDate(), h, min, 0, 0) - 2 * 3600e3);
}

export async function verificarAcessoVendedor(u: {
  perfil: string; bloqueioManual?: boolean | null; desbloqueadoAte?: Date | string | null;
}): Promise<{ permitido: boolean; motivo?: string }> {
  if (u.perfil !== "Vendedor") return { permitido: true };
  if (u.bloqueioManual)
    return { permitido: false, motivo: "🔒 Acesso bloqueado pela gerência. Peça ao Gerente ou ao Administrador para desbloquear o seu acesso." };
  // desbloqueio excepcional concedido pela gerência até uma hora específica
  if (u.desbloqueadoAte && Date.now() <= new Date(u.desbloqueadoAte).getTime()) return { permitido: true };
  const hs = await getHorarios();
  const m = mzAgora();
  const hoje = hs[(m.getUTCDay() + 6) % 7]; // HORARIOS começam na Segunda-feira
  const hhmm = `${String(m.getUTCHours()).padStart(2, "0")}:${String(m.getUTCMinutes()).padStart(2, "0")}`;
  if (!hoje?.aberto)
    return { permitido: false, motivo: "🔒 O restaurante está fechado hoje. O acesso de vendedores só é possível com autorização da gerência." };
  if (hhmm < hoje.abre)
    return { permitido: false, motivo: `🔒 O atendimento começa às ${hoje.abre}. O seu acesso é desbloqueado automaticamente à hora de abertura.` };
  if (hhmm >= hoje.fecha)
    return { permitido: false, motivo: `🔒 Hora de saída (${hoje.fecha}) — acesso bloqueado. Se ainda há clientes, peça ao Gerente ou ao Administrador para estender o horário ou desbloquear o seu acesso.` };
  return { permitido: true };
}

async function nextCodigo(chave: string, prefix: string) {
  const db = getDb();
  await db
    .insert(contadores)
    .values({ chave, valor: 1 })
    .onDuplicateKeyUpdate({ set: { valor: sql`${contadores.valor} + 1` } });
  const c = await db.query.contadores.findFirst({ where: eq(contadores.chave, chave) });
  return prefix + String(c?.valor ?? 1).padStart(4, "0");
}

async function getPedidoComItens(pedidoId: number) {
  const db = getDb();
  const p = await db.query.pedidos.findFirst({ where: eq(pedidos.id, pedidoId) });
  if (!p) throw new TRPCError({ code: "NOT_FOUND", message: "Pedido não encontrado" });
  const itens = await db.select().from(pedidoItens).where(eq(pedidoItens.pedidoId, pedidoId));
  return { ...p, itens };
}

async function recalcPedido(pedidoId: number) {
  const db = getDb();
  const itens = await db.select().from(pedidoItens).where(eq(pedidoItens.pedidoId, pedidoId));
  const subtotal = itens.reduce((a, i) => a + i.qtd * i.precoUnit, 0);
  await db.update(pedidos).set({ subtotal }).where(eq(pedidos.id, pedidoId));
  return subtotal;
}

/** Item de cozinha = Refeição (aves, carnes, fast food, bebidas quentes, entradas,
    extras, mariscos, peixe, petiscos, sobremesas…) ou ✳️ personalizado.
    Bebidas (bar) NÃO vão para a cozinha. */
async function itemEhCozinha(produtoId: number | null): Promise<boolean> {
  if (produtoId == null) return true;
  const prod = await getDb().query.produtos.findFirst({ where: eq(produtos.id, produtoId) });
  return prod?.tipo === "Refeição";
}

/** Mantém o estado da cozinha do pedido actualizado:
    - sem itens de cozinha → null (a cozinha nem vê o pedido);
    - entrou prato novo (ou reforço depois de "Pronto") → volta a "Pendente";
    - a cozinhar → mantém "Em Preparo". */
async function syncCozinha(pedidoId: number, entrouItem: boolean) {
  const db = getDb();
  const p = await db.query.pedidos.findFirst({ where: eq(pedidos.id, pedidoId) });
  if (!p || p.status !== "Aberto") return;
  const itens = await db.select().from(pedidoItens).where(eq(pedidoItens.pedidoId, pedidoId));
  let tem = false;
  for (const i of itens) { if (await itemEhCozinha(i.produtoId)) { tem = true; break; } }
  let novo: string | null;
  if (!tem) novo = null;
  else if (p.cozinhaStatus == null) novo = "Pendente";
  else if (p.cozinhaStatus === "Pronto" && entrouItem) novo = "Pendente";
  else novo = p.cozinhaStatus;
  if (p.cozinhaStatus !== novo)
    await db.update(pedidos).set({ cozinhaStatus: novo }).where(eq(pedidos.id, pedidoId));
}

const usuarioInput = z.object({ usuarioId: z.number().int().positive() });

/* ============================================================
   UTILIZADORES
   ============================================================ */
export const usuariosRouter = createRouter({
  list: publicQuery.query(async () => {
    const us = await getDb().select({
      id: usuarios.id, nome: usuarios.nome, perfil: usuarios.perfil, ativo: usuarios.ativo,
    }).from(usuarios).where(eq(usuarios.ativo, true));
    return us;
  }),

  login: publicQuery
    .input(z.object({ usuarioId: z.number().int().positive(), pin: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const u = await findUsuarioById(input.usuarioId);
      if (!u || !u.ativo)
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Senha incorrecta" });
      if (u.bloqueado)
        throw new TRPCError({ code: "FORBIDDEN", message: "🔒 Conta bloqueada após 3 tentativas falhadas. Peça ao Administrador para desbloquear a sua conta." });
      if (u.pin !== input.pin) {
        // Admin nunca bloqueia; os restantes bloqueiam à 3.ª falha seguida
        if (u.perfil !== "Admin") {
          const n = u.tentativas + 1;
          await db.update(usuarios).set({ tentativas: n, bloqueado: n >= 3 }).where(eq(usuarios.id, u.id));
          if (n >= 3)
            throw new TRPCError({ code: "FORBIDDEN", message: "🔒 Conta bloqueada após 3 tentativas falhadas. Peça ao Administrador para desbloquear a sua conta." });
          throw new TRPCError({ code: "UNAUTHORIZED", message: `Senha incorrecta — tentativa ${n} de 3. Ao 3.º erro a conta bloqueia.` });
        }
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Senha incorrecta" });
      }
      await emitirSessao(ctx, u.id);
      if (u.tentativas > 0)
        await db.update(usuarios).set({ tentativas: 0 }).where(eq(usuarios.id, u.id));
      // vendedores: fora do horário ou com bloqueio manual não entram
      const acesso = await verificarAcessoVendedor(u);
      if (!acesso.permitido) throw new TRPCError({ code: "FORBIDDEN", message: acesso.motivo });
      // senhaFraca=true obriga a definir uma senha forte no primeiro acesso
      return { id: u.id, nome: u.nome, perfil: u.perfil, senhaFraca: senhaFraca(u.pin), podeReabrirReserva: !!(u as { podeReabrirReserva?: boolean | null }).podeReabrirReserva, podeEditarStock: !!(u as { podeEditarStock?: boolean | null }).podeEditarStock, podeEditarNomes: !!(u as { podeEditarNomes?: boolean | null }).podeEditarNomes };
    }),

  /** Entrar com NOME + senha — a lista de utilizadores não é exposta na tela de login */
  loginNome: publicQuery
    .input(z.object({ nome: z.string().min(1), pin: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const nomeNorm = input.nome.trim().toLowerCase();
      let todosUsuarios;
      try {
        todosUsuarios = await db.select().from(usuarios).where(eq(usuarios.ativo, true));
      } catch (e) {
        if (!ehErroColunaV17(e)) throw e;
        // migração v17 ainda não aplicada — login continua a funcionar
        todosUsuarios = (await db.select(USUARIO_COLS_LEGACY).from(usuarios).where(eq(usuarios.ativo, true))).map(comCamposV17);
      }
      const u = todosUsuarios
        .find((x) => x.nome.trim().toLowerCase() === nomeNorm);
      if (!u)
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Nome ou senha incorrectos" });
      if (u.bloqueado)
        throw new TRPCError({ code: "FORBIDDEN", message: "🔒 Conta bloqueada após 3 tentativas falhadas. Peça ao Administrador para desbloquear a sua conta." });
      if (u.pin !== input.pin) {
        if (u.perfil !== "Admin") {
          const n = u.tentativas + 1;
          await db.update(usuarios).set({ tentativas: n, bloqueado: n >= 3 }).where(eq(usuarios.id, u.id));
          if (n >= 3)
            throw new TRPCError({ code: "FORBIDDEN", message: "🔒 Conta bloqueada após 3 tentativas falhadas. Peça ao Administrador para desbloquear a sua conta." });
          throw new TRPCError({ code: "UNAUTHORIZED", message: `Nome ou senha incorrectos — tentativa ${n} de 3. Ao 3.º erro a conta bloqueia.` });
        }
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Nome ou senha incorrectos" });
      }
      await emitirSessao(ctx, u.id);
      if (u.tentativas > 0)
        await db.update(usuarios).set({ tentativas: 0 }).where(eq(usuarios.id, u.id));
      // vendedores: fora do horário ou com bloqueio manual não entram
      const acessoNome = await verificarAcessoVendedor(u);
      if (!acessoNome.permitido) throw new TRPCError({ code: "FORBIDDEN", message: acessoNome.motivo });
      return { id: u.id, nome: u.nome, perfil: u.perfil, senhaFraca: senhaFraca(u.pin), podeReabrirReserva: !!(u as { podeReabrirReserva?: boolean | null }).podeReabrirReserva, podeEditarStock: !!(u as { podeEditarStock?: boolean | null }).podeEditarStock, podeEditarNomes: !!(u as { podeEditarNomes?: boolean | null }).podeEditarNomes };
    }),

  /** Restaura a sessão a partir do cookie de servidor (ao actualizar a página) */
  sessaoActual: publicQuery.query(async ({ ctx }) => {
    const token = tokenDoCookie(ctx);
    if (!token) return null;
    const db = getDb();
    const s = await db.query.sessoes.findFirst({ where: eq(sessoes.token, token) });
    if (!s || new Date(s.expiraEm).getTime() < Date.now()) return null;
    const u = await findUsuarioById(s.usuarioId);
    if (!u || !u.ativo || u.bloqueado) return null;
    return { id: u.id, nome: u.nome, perfil: u.perfil, senhaFraca: senhaFraca(u.pin), podeReabrirReserva: !!(u as { podeReabrirReserva?: boolean | null }).podeReabrirReserva, podeEditarStock: !!(u as { podeEditarStock?: boolean | null }).podeEditarStock, podeEditarNomes: !!(u as { podeEditarNomes?: boolean | null }).podeEditarNomes };
  }),

  /** Termina a sessão no servidor e limpa o cookie */
  terminarSessao: publicQuery.mutation(async ({ ctx }) => {
    const token = tokenDoCookie(ctx);
    if (token) await getDb().delete(sessoes).where(eq(sessoes.token, token));
    ctx.resHeaders.append("Set-Cookie", "camis_sess=; Path=/; Max-Age=0; SameSite=Lax; HttpOnly");
    return { ok: true };
  }),

  /** Verificação periódica de acesso (o ecrã do vendedor chama isto a cada minuto;
      quando o acesso expira — hora de saída, bloqueio manual ou fim do desbloqueio
      excepcional — a sessão é terminada automaticamente) */
  checkAcesso: publicQuery
    .input(z.object({ usuarioId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const u = await findUsuarioById(input.usuarioId);
      if (!u || !u.ativo) return { permitido: false, motivo: "Utilizador inválido" };
      return verificarAcessoVendedor(u);
    }),

  /** Vendedores com o estado de acesso actual (para o cartão de controlo na página
      de Configurações — visível para Admin e Gestor) */
  listarAcessoVendedores: publicQuery
    .input(z.object({ usuarioId: z.number().int().positive() }))
    .query(async ({ input }) => {
      await requirePerfil(input.usuarioId, ["Admin", "Gestor"]);
      const hs = await getHorarios();
      const m = mzAgora();
      const hoje = hs[(m.getUTCDay() + 6) % 7];
      const vs = await (async () => {
        try {
          return await getDb().select({
            id: usuarios.id, nome: usuarios.nome, bloqueioManual: usuarios.bloqueioManual,
            desbloqueadoAte: usuarios.desbloqueadoAte,
          }).from(usuarios).where(and(eq(usuarios.perfil, "Vendedor"), eq(usuarios.ativo, true)));
        } catch (e) {
          if (!ehErroColunaV17(e)) throw e;
          // migração v17 pendente — listar sem as colunas novas
          return (await getDb().select({ id: usuarios.id, nome: usuarios.nome }).from(usuarios)
            .where(and(eq(usuarios.perfil, "Vendedor"), eq(usuarios.ativo, true))))
            .map((v) => ({ ...v, bloqueioManual: false, desbloqueadoAte: null }));
        }
      })();
      const rows = await Promise.all(vs.map(async (v) => ({
        ...v, permitidoAgora: (await verificarAcessoVendedor({ perfil: "Vendedor", bloqueioManual: v.bloqueioManual, desbloqueadoAte: v.desbloqueadoAte })).permitido,
      })));
      return { vendedores: rows, hoje };
    }),

  /** Controlo de acesso dos vendedores (Admin e Gestor):
      · desbloquearAte — liberta o vendedor até uma hora de HOJE (ex.: clientes ainda a consumir);
      · bloquearManual — bloqueia/liberta manualmente no fecho ou abertura da loja;
      · estenderFecho — prolonga a hora de fecho de HOJE (vale para todos os vendedores). */
  controloAcesso: publicQuery
    .input(z.object({
      usuarioId: z.number().int().positive(),
      accao: z.enum(["desbloquearAte", "bloquearManual", "estenderFecho"]),
      vendedorId: z.number().int().positive().optional(),
      hora: z.string().regex(/^\d{2}:\d{2}$/).optional(), // HH:mm (hoje, hora de Moçambique)
      bloquear: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      await requirePerfil(input.usuarioId, ["Admin", "Gestor"]);
      const db = getDb();
      if (input.accao === "estenderFecho") {
        if (!input.hora) throw new TRPCError({ code: "BAD_REQUEST", message: "Indique a nova hora de fecho" });
        const hs = await getHorarios();
        const idx = (mzAgora().getUTCDay() + 6) % 7;
        hs[idx] = { ...hs[idx], fecha: input.hora, aberto: true };
        await setJsonCfg("horarios", hs);
        return { ok: true };
      }
      if (!input.vendedorId) throw new TRPCError({ code: "BAD_REQUEST", message: "Indique o vendedor" });
      const v = await findUsuarioById(input.vendedorId);
      if (!v || v.perfil !== "Vendedor") throw new TRPCError({ code: "BAD_REQUEST", message: "Vendedor inválido" });
      if (input.accao === "desbloquearAte") {
        if (!input.hora) throw new TRPCError({ code: "BAD_REQUEST", message: "Indique até que horas fica desbloqueado" });
        try {
          await db.update(usuarios).set({ desbloqueadoAte: hojeMzAs(input.hora), bloqueioManual: false }).where(eq(usuarios.id, v.id));
        } catch (e) {
          if (ehErroColunaV17(e)) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "⚠️ A base de dados ainda não foi actualizada. Reinicie o sistema (a migração corre no arranque) e tente de novo." });
          throw e;
        }
        return { ok: true };
      }
      // bloquearManual
      try {
        await db.update(usuarios).set({ bloqueioManual: input.bloquear !== false, ...(input.bloquear !== false ? { desbloqueadoAte: null } : {}) }).where(eq(usuarios.id, v.id));
      } catch (e) {
        if (ehErroColunaV17(e)) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "⚠️ A base de dados ainda não foi actualizada. Reinicie o sistema (a migração corre no arranque) e tente de novo." });
        throw e;
      }
      return { ok: true };
    }),

  /** Desbloquear conta após 3 tentativas falhadas (apenas Admin) */
  desbloquear: publicQuery
    .input(z.object({ adminId: z.number().int().positive(), id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      await requirePerfil(input.adminId, ["Admin"]);
      await getDb().update(usuarios).set({ bloqueado: false, tentativas: 0 }).where(eq(usuarios.id, input.id));
      return { ok: true };
    }),

  /** Troca de senha — APENAS o Administrador pode alterar PINs (a sua, aqui; a dos outros, na edição de utilizadores) */
  trocarSenha: publicQuery
    .input(z.object({
      usuarioId: z.number().int().positive(),
      senhaAntiga: z.string().min(1),
      senhaNova: senhaSchema,
    }))
    .mutation(async ({ input }) => {
      const u = await getDb().query.usuarios.findFirst({ where: eq(usuarios.id, input.usuarioId) });
      if (!u || !u.ativo) throw new TRPCError({ code: "UNAUTHORIZED", message: "Utilizador inválido" });
      if (u.perfil !== "Admin")
        throw new TRPCError({ code: "FORBIDDEN", message: "Só o Administrador pode alterar PINs. Peça ao Administrador para redefinir o seu PIN." });
      if (u.pin !== input.senhaAntiga)
        throw new TRPCError({ code: "UNAUTHORIZED", message: "A senha actual está incorrecta" });
      await getDb().update(usuarios).set({ pin: input.senhaNova }).where(eq(usuarios.id, u.id));
      return { ok: true };
    }),

  create: publicQuery
    .input(z.object({
      adminId: z.number().int().positive(),
      nome: z.string().min(2),
      perfil: perfilSchema,
      pin: senhaSchema,
      telefone: z.string().max(30).optional(),
    }))
    .mutation(async ({ input }) => {
      await requirePerfil(input.adminId, ["Admin"]);
      await getDb().insert(usuarios).values({ nome: input.nome, perfil: input.perfil, pin: input.pin, telefone: input.telefone || null });
      return { ok: true };
    }),

  /** Todos os utilizadores, incluindo inativos (apenas Admin) */
  listAll: publicQuery
    .input(z.object({ adminId: z.number().int().positive() }))
    .query(async ({ input }) => {
      await requirePerfil(input.adminId, ["Admin"]);
      return getDb().select({
        id: usuarios.id, nome: usuarios.nome, perfil: usuarios.perfil, ativo: usuarios.ativo,
        bloqueado: usuarios.bloqueado, telefone: usuarios.telefone,
        podeReabrirReserva: usuarios.podeReabrirReserva, podeEditarStock: usuarios.podeEditarStock,
        podeEditarNomes: usuarios.podeEditarNomes,
      }).from(usuarios);
    }),

  /** Editar utilizador: nome, perfil, repor senha, reativar (apenas Admin) */
  atualizar: publicQuery
    .input(z.object({
      adminId: z.number().int().positive(),
      id: z.number().int().positive(),
      nome: z.string().min(2).optional(),
      perfil: perfilSchema.optional(),
      pin: senhaSchema.optional(),
      ativo: z.boolean().optional(),
      telefone: z.string().max(30).nullable().optional(),
      bloqueado: z.boolean().optional(),
      podeReabrirReserva: z.boolean().optional(),
      podeEditarStock: z.boolean().optional(),
      podeEditarNomes: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      await requirePerfil(input.adminId, ["Admin"]);
      if (input.id === input.adminId && input.ativo === false)
        throw new TRPCError({ code: "BAD_REQUEST", message: "Não pode desativar a sua própria conta" });
      const { adminId, id, ...data } = input;
      if (data.bloqueado === false) (data as Record<string, unknown>).tentativas = 0;
      await getDb().update(usuarios).set(data).where(eq(usuarios.id, id));
      return { ok: true };
    }),

  desativar: publicQuery
    .input(z.object({ adminId: z.number().int().positive(), id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      await requirePerfil(input.adminId, ["Admin"]);
      await getDb().update(usuarios).set({ ativo: false }).where(eq(usuarios.id, input.id));
      return { ok: true };
    }),
});

/* ============================================================
   PRODUTOS
   ============================================================ */
export const produtosRouter = createRouter({
  list: publicQuery
    .input(z.object({ leve: z.boolean().optional() }).optional())
    .query(({ input }) => {
      const db = getDb();
      // leve=true: sem a foto base64 — usado no POS para respostas rápidas
      if (input?.leve)
        return db.select({
          id: produtos.id, codigo: produtos.codigo, nome: produtos.nome,
          categoria: produtos.categoria, tipo: produtos.tipo, preco: produtos.preco,
          foto: sql<string | null>`NULL`.as("foto"),
          ingredientes: produtos.ingredientes,
          estoqueMin: produtos.estoqueMin, estoqueAtual: produtos.estoqueAtual,
          estoqueRefId: produtos.estoqueRefId, fraccao: produtos.fraccao, qtdDecimal: produtos.qtdDecimal,
          ativo: produtos.ativo, criadoEm: produtos.criadoEm,
        }).from(produtos).where(eq(produtos.ativo, true)).orderBy(produtos.categoria, produtos.nome);
      return db.select().from(produtos).where(eq(produtos.ativo, true)).orderBy(produtos.categoria, produtos.nome);
    }),

  create: publicQuery
    .input(z.object({
      usuarioId: z.number().int().positive(),
      nome: z.string().min(2),
      categoria: z.string().min(2),
      tipo: z.enum(["Bebida", "Refeição", "Serviço"]),
      preco: z.number().min(0),
      precoCompra: z.number().min(0).optional(),
      foto: z.string().max(2_000_000).optional(), // data URL da foto do produto
      ingredientes: z.string().trim().max(500).optional(), // ingredientes/acompanhantes (ex.: Pizza) — menu + loja
      estoqueMin: z.number().int().min(0).default(0),
      estoqueAtual: z.number().min(0).default(0), // aceita decimais (kg / fraccões)
      estoqueRefId: z.number().int().positive().nullable().optional(), // produto «mãe» dono do stock
      fraccao: z.number().min(0.01).max(1).optional(), // 0.25 | 0.5 | 1
      qtdDecimal: z.boolean().optional(), // vendido a peso (kg)
    }))
    .mutation(async ({ input }) => {
      await requirePerfil(input.usuarioId, ["Admin", "Gestor"]);
      const db = getDb();
      // IDs auto-incremento não são sequenciais nesta base — derivar do próprio código
      const codigos = await db.select({ codigo: produtos.codigo }).from(produtos);
      let max = 0;
      for (const r of codigos) {
        const n = parseInt(r.codigo.replace(/\D/g, ""), 10);
        if (!isNaN(n) && n > max) max = n;
      }
      const codigo = "PROD-" + String(max + 1).padStart(3, "0");
      const [{ id }] = await db.insert(produtos).values({
        codigo, nome: input.nome, categoria: input.categoria, tipo: input.tipo,
        preco: input.preco, precoCompra: input.precoCompra ?? 0, foto: input.foto || null,
        ingredientes: input.ingredientes?.trim() ? input.ingredientes.trim() : null,
        estoqueMin: input.estoqueMin, estoqueAtual: input.estoqueAtual,
        estoqueRefId: input.estoqueRefId ?? null,
        fraccao: input.fraccao ?? 1,
        qtdDecimal: input.qtdDecimal ?? false,
      }).$returningId();
      return { id, codigo };
    }),

  update: publicQuery
    .input(z.object({
      usuarioId: z.number().int().positive(),
      id: z.number().int().positive(),
      nome: z.string().min(2).optional(),
      categoria: z.string().min(2).optional(),
      tipo: z.enum(["Bebida", "Refeição", "Serviço"]).optional(), // corrige o grupo do menu (bebidas/refeições/serviços)
      preco: z.number().min(0).optional(),
      precoCompra: z.number().min(0).optional(),
      foto: z.string().max(2_000_000).nullable().optional(), // data URL; null remove a foto
      ingredientes: z.string().trim().max(500).nullable().optional(), // null/"" limpa os ingredientes
      estoqueMin: z.number().int().min(0).optional(),
      estoqueRefId: z.number().int().positive().nullable().optional(), // null = stock próprio
      fraccao: z.number().min(0.01).max(1).optional(),
      qtdDecimal: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      await requirePerfil(input.usuarioId, ["Admin", "Gestor"]);
      const { usuarioId, id, ...data } = input;
      if (data.ingredientes !== undefined)
        data.ingredientes = data.ingredientes?.trim() ? data.ingredientes.trim() : null;
      await getDb().update(produtos).set(data).where(eq(produtos.id, id));
      return { ok: true };
    }),

  desativar: publicQuery
    .input(z.object({ usuarioId: z.number().int().positive(), id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      await requirePerfil(input.usuarioId, ["Admin", "Gestor"]);
      await getDb().update(produtos).set({ ativo: false }).where(eq(produtos.id, input.id));
      return { ok: true };
    }),

  /** Eliminar definitivamente um produto/serviço do menu (apenas Admin).
      Se o produto já tiver histórico de vendas, exige desativação em vez de eliminar. */
  eliminar: publicQuery
    .input(z.object({ usuarioId: z.number().int().positive(), id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      await requirePerfil(input.usuarioId, ["Admin"]);
      const db = getDb();
      const usado = await db.select({ id: pedidoItens.id }).from(pedidoItens)
        .where(eq(pedidoItens.produtoId, input.id)).limit(1);
      if (usado.length > 0)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Este produto já tem histórico de vendas. Use «Desativar» para o retirar do menu sem perder o histórico.",
        });
      await db.delete(stockMov).where(eq(stockMov.produtoId, input.id));
      await db.delete(produtos).where(eq(produtos.id, input.id));
      return { ok: true };
    }),
});

/* ============================================================
   PEDIDOS (comandas com nº sequencial diário)
   ============================================================ */
/** Crédito AINDA disponível de uma reserva para deduzir no fecho de um pedido:
    · BRAAI → 0 (a taxa é do espaço, NÃO consumível — o pedido é consumo novo, cobrado por inteiro)
    · BUFFET → 0 (o item do pedido já cobra apenas o remanescente por pagar)
    · NORMAL (taxa consumível) → tudo o que o cliente já pagou (adiantamento + parcelas,
      líquido do desconto) MENOS o que pedidos ANTERIORES da mesma reserva já consumiram —
      assim um pedido novo depois do crédito esgotado é cobrado por inteiro. */
/** Regista um movimento de item no «caderno» de auditoria (histórico do pedido). */
async function logItemMov(db: ReturnType<typeof getDb>, mov: {
  pedidoId: number; produtoId: number | null; nome: string; delta: number;
  qtdFinal: number; origem: "menu" | "ajuste" | "adicional"; usuarioId?: number;
}) {
  let usuarioNome: string | null = null;
  if (mov.usuarioId) {
    const u = await db.query.usuarios.findFirst({ where: eq(usuarios.id, mov.usuarioId) });
    usuarioNome = u?.nome ?? null;
  }
  await db.insert(pedidoItensLog).values({
    pedidoId: mov.pedidoId, produtoId: mov.produtoId, nome: mov.nome,
    delta: mov.delta, qtdFinal: mov.qtdFinal, origem: mov.origem, usuarioNome,
  });
}

async function creditoReservaDisponivel(reservaId: number, excluirPedidoId?: number): Promise<number> {
  const db = getDb();
  const rv = await db.query.reservas.findFirst({ where: eq(reservas.id, reservaId) });
  if (!rv || rv.status !== "Confirmada" || rv.braai || rv.tipo === "Buffet" || rv.adiant <= 0) return 0;
  const pagoReserva = Math.max(rv.adiant, Math.round((rv.valor - rv.saldo) * 100) / 100);
  const whereUsado = excluirPedidoId
    ? and(eq(pedidos.reservaId, rv.id), eq(pedidos.status, "Fechado"), ne(pedidos.id, excluirPedidoId))
    : and(eq(pedidos.reservaId, rv.id), eq(pedidos.status, "Fechado"));
  const [{ usado }] = await db.select({ usado: sql<number>`COALESCE(SUM(${pedidos.adiantDeduzido}),0)` })
    .from(pedidos).where(whereUsado);
  return Math.max(0, Math.round((pagoReserva - Number(usado ?? 0)) * 100) / 100);
}

/* Trava por pedido: serializa lançamentos simultâneos do MESMO pedido neste processo.
   Sem ela, dois cliques rápidos liam a mesma quantidade e um incremento perdia-se
   (o caixa clicava 11 vezes e ficavam 9). Pedidos diferentes continuam em paralelo. */
const travaPedidos = new Map<number, Promise<unknown>>();
async function comLockPedido<T>(pedidoId: number, fn: () => Promise<T>): Promise<T> {
  const anterior = travaPedidos.get(pedidoId) ?? Promise.resolve();
  const actual = anterior.then(fn, fn);
  travaPedidos.set(pedidoId, actual);
  try { return await actual; }
  finally { if (travaPedidos.get(pedidoId) === actual) travaPedidos.delete(pedidoId); }
}

export const pedidosRouter = createRouter({
  abertos: publicQuery.query(async () => {
    const db = getDb();
    const ps = await db.select().from(pedidos)
      .where(eq(pedidos.status, "Aberto")).orderBy(desc(pedidos.criadoEm));
    return Promise.all(ps.map((p) => getPedidoComItens(p.id)));
  }),

  fechadosDia: publicQuery
    .input(z.object({ dataDia: z.string().length(10).optional(), usuarioId: z.number().int().positive().optional() }))
    .query(async ({ input }) => {
      const db = getDb();
      const dia = input.dataDia ?? DIA();
      // os PRODUTOS/SERVIÇOS de pedidos fechados são visíveis APENAS pelo Administrador
      let ehAdmin = false;
      if (input.usuarioId) {
        const u = await db.query.usuarios.findFirst({ where: eq(usuarios.id, input.usuarioId) });
        ehAdmin = u?.perfil === "Admin";
      }
      const ps = await db.select().from(pedidos)
        .where(and(eq(pedidos.dataDia, dia), eq(pedidos.status, "Fechado")))
        .orderBy(desc(pedidos.fechadoEm));
      const lista = await Promise.all(ps.map((p) => getPedidoComItens(p.id)));
      return lista.map((p) => ehAdmin
        ? { ...p, itensCount: p.itens.reduce((a, i) => a + i.qtd, 0) }
        : { ...p, itens: [], itensCount: p.itens.reduce((a, i) => a + i.qtd, 0) });
    }),

  get: publicQuery
    .input(z.object({ id: z.number().int().positive() }))
    .query(({ input }) => getPedidoComItens(input.id)),

  criar: publicQuery
    .input(usuarioInput.extend({
      referencia: z.string().max(120).optional(),
      reservaId: z.number().int().positive().optional(),
      area: z.string().max(80).optional(),
      atendente: z.string().max(120).optional(),
      afiliadoCodigo: z.string().max(12).optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const dia = DIA();
      const [{ maxN }] = await db.select({ maxN: sql<number>`COALESCE(MAX(numero),0)` })
        .from(pedidos).where(eq(pedidos.dataDia, dia));
      // afiliado: código directo OU herdado da reserva ligada
      let afiliadoId: number | null = null;
      if (input.reservaId) {
        const rv = await db.query.reservas.findFirst({ where: eq(reservas.id, input.reservaId) });
        afiliadoId = rv?.afiliadoId ?? null;
      }
      if (!afiliadoId && input.afiliadoCodigo)
        afiliadoId = (await afiliadoPorCodigo(input.afiliadoCodigo))?.id ?? null;
      const [{ id }] = await db.insert(pedidos).values({
        numero: maxN + 1, dataDia: dia,
        referencia: input.referencia || null,
        reservaId: input.reservaId ?? null,
        area: input.area || null,
        atendente: input.atendente || null,
        usuarioId: input.usuarioId,
        afiliadoId,
      }).$returningId();
      if (input.reservaId)
        await db.update(reservas).set({ pedidoId: id }).where(eq(reservas.id, input.reservaId));
      return getPedidoComItens(id);
    }),

  /** Item personalizado / pedido adicional fora do menu (nome + preço livres) */
  addItemPersonalizado: publicQuery
    .input(z.object({
      usuarioId: z.number().int().positive(),
      pedidoId: z.number().int().positive(),
      nome: z.string().min(2).max(255),
      preco: z.number().min(0),
      qtd: z.number().int().min(1).default(1),
    }))
    .mutation(async ({ input }) => {
      await requirePerfil(input.usuarioId, ["Admin", "Gestor", "Vendedor"]);
      return comLockPedido(input.pedidoId, async () => {
      const db = getDb();
      const p = await db.query.pedidos.findFirst({ where: eq(pedidos.id, input.pedidoId) });
      if (!p || p.status !== "Aberto") throw new TRPCError({ code: "BAD_REQUEST", message: "Pedido não está aberto" });
      await db.insert(pedidoItens).values({
        pedidoId: input.pedidoId, produtoId: null, nome: input.nome,
        categoria: "Pedido adicional", precoUnit: input.preco, qtd: input.qtd,
      });
      await logItemMov(db, {
        pedidoId: input.pedidoId, produtoId: null, nome: input.nome,
        delta: input.qtd, qtdFinal: input.qtd, origem: "adicional", usuarioId: input.usuarioId,
      });
      await recalcPedido(input.pedidoId);
      await syncCozinha(input.pedidoId, true);
      return getPedidoComItens(input.pedidoId);
      });
    }),

  /** Define/altera o espaço onde o cliente está sentado (durante a estadia) */
  setArea: publicQuery
    .input(z.object({
      pedidoId: z.number().int().positive(),
      area: z.string().max(80).nullable(),
    }))
    .mutation(async ({ input }) => {
      await getDb().update(pedidos).set({ area: input.area || null }).where(eq(pedidos.id, input.pedidoId));
      return getPedidoComItens(input.pedidoId);
    }),

  /** Nomes dos funcionários activos (RH) — para escolher quem atende a mesa.
      Leitura leve, sem dados sensíveis (só nome e cargo). */
  atendentesNomes: publicQuery.query(async () => {
    const db = getDb();
    const trs = await db.select({ nome: trabalhadores.nome, cargo: trabalhadores.cargo })
      .from(trabalhadores).where(eq(trabalhadores.ativo, true)).orderBy(asc(trabalhadores.nome));
    return trs;
  }),

  /** Crédito restante da reserva para deduzir no fecho de um novo pedido (braai/buffet → 0) */
  creditoReserva: publicQuery
    .input(z.object({ reservaId: z.number().int().positive() }))
    .query(async ({ input }) => ({ credito: await creditoReservaDisponivel(input.reservaId) })),

  /** Editar referência (nº da mesa / nome) e/ou atendente de um pedido aberto */
  editarInfo: publicQuery
    .input(z.object({
      usuarioId: z.number().int().positive(),
      pedidoId: z.number().int().positive(),
      referencia: z.string().max(120).nullish(),
      atendente: z.string().max(120).nullish(),
      area: z.string().max(80).nullish(),
      afiliadoCodigo: z.string().max(12).nullish(),
    }))
    .mutation(async ({ input }) => {
      const u = await requirePerfil(input.usuarioId, ["Admin", "Gestor", "Vendedor"]);
      const db = getDb();
      const p = await db.query.pedidos.findFirst({ where: eq(pedidos.id, input.pedidoId) });
      if (!p || p.status !== "Aberto") throw new TRPCError({ code: "BAD_REQUEST", message: "Pedido não está aberto" });
      // CORRECÇÃO de nomes já registados (mesa/referência ou atendente): só o Admin
      // ou alguém com a autorização «pode editar nomes» concedida nas Configurações.
      // A PRIMEIRA identificação (pedido ainda sem referência/atendente) continua livre.
      const mudaRef = input.referencia !== undefined && !!p.referencia && (input.referencia || null) !== p.referencia;
      const mudaAtend = input.atendente !== undefined && !!p.atendente && (input.atendente || null) !== p.atendente;
      if ((mudaRef || mudaAtend) && u.perfil !== "Admin" && !(u as { podeEditarNomes?: boolean | null }).podeEditarNomes)
        throw new TRPCError({ code: "FORBIDDEN", message: "🔒 Só o Administrador (ou alguém autorizado por ele em ⚙️ Configurações) pode corrigir a mesa/referência ou o atendente de um pedido já identificado." });
      const upd: Record<string, unknown> = {};
      if (input.referencia !== undefined) upd.referencia = input.referencia || null;
      if (input.atendente !== undefined) upd.atendente = input.atendente || null;
      if (input.area !== undefined) upd.area = input.area || null;
      if (input.afiliadoCodigo) {
        const af = await afiliadoPorCodigo(input.afiliadoCodigo);
        if (!af) throw new TRPCError({ code: "BAD_REQUEST", message: "Código de afiliado não encontrado." });
        upd.afiliadoId = af.id;
      }
      if (Object.keys(upd).length === 0) return getPedidoComItens(input.pedidoId);
      await db.update(pedidos).set(upd).where(eq(pedidos.id, input.pedidoId));
      return getPedidoComItens(input.pedidoId);
    }),

  /** Transferir o pedido para OUTRA mesa (ex.: duas mesas juntaram-se).
      A referência fica com a marca «⇄ antes: …» para todos verem de onde veio. */
  transferirMesa: publicQuery
    .input(z.object({
      usuarioId: z.number().int().positive(),
      pedidoId: z.number().int().positive(),
      novaReferencia: z.string().min(1).max(100),
    }))
    .mutation(async ({ input }) => {
      await requirePerfil(input.usuarioId, ["Admin", "Gestor", "Vendedor"]);
      const db = getDb();
      const p = await db.query.pedidos.findFirst({ where: eq(pedidos.id, input.pedidoId) });
      if (!p || p.status !== "Aberto") throw new TRPCError({ code: "BAD_REQUEST", message: "Pedido não está aberto" });
      const nova = input.novaReferencia.trim();
      if (!nova) throw new TRPCError({ code: "BAD_REQUEST", message: "Indique a mesa de destino." });
      // referência base anterior (sem marcas de transferências anteriores)
      const baseAntiga = (p.referencia ?? `Pedido ${p.numero}`).split(" ⇄ antes:")[0].trim();
      if (baseAntiga.toLowerCase() === nova.toLowerCase())
        throw new TRPCError({ code: "BAD_REQUEST", message: "O pedido já está nessa mesa." });
      await db.update(pedidos).set({
        referencia: `${nova} ⇄ antes: ${baseAntiga}`.slice(0, 120),
      }).where(eq(pedidos.id, input.pedidoId));
      return getPedidoComItens(input.pedidoId);
    }),

  addItem: publicQuery
    .input(z.object({
      pedidoId: z.number().int().positive(),
      produtoId: z.number().int().positive(),
      qtd: z.number().positive().max(999).default(1),
      obs: z.string().max(255).optional(), // acompanhamentos (pratos)
      usuarioId: z.number().int().positive().optional(), // para o histórico (quem lançou)
    }))
    .mutation(async ({ input }) => {
      return comLockPedido(input.pedidoId, async () => {
      const db = getDb();
      const p = await db.query.pedidos.findFirst({ where: eq(pedidos.id, input.pedidoId) });
      if (!p || p.status !== "Aberto") throw new TRPCError({ code: "BAD_REQUEST", message: "Pedido não está aberto" });
      const prod = await db.query.produtos.findFirst({ where: eq(produtos.id, input.produtoId) });
      if (!prod) throw new TRPCError({ code: "NOT_FOUND", message: "Produto não encontrado" });
      // produtos vendidos a peso aceitam quantidades decimais; os restantes são inteiros
      if (!prod.qtdDecimal && !Number.isInteger(input.qtd))
        throw new TRPCError({ code: "BAD_REQUEST", message: "Este produto só aceita quantidades inteiras." });

      // itens com acompanhamentos diferentes ficam em linhas separadas
      const existente = (await db.select().from(pedidoItens).where(
        and(eq(pedidoItens.pedidoId, input.pedidoId), eq(pedidoItens.produtoId, input.produtoId)),
      )).find((i) => (i.obs ?? null) === (input.obs ?? null));
      const qtdNoPedido = (existente?.qtd ?? 0) + input.qtd;
      // stock fraccionário: a fracção debita no produto «mãe» (estoqueRefId)
      const fr = prod.fraccao ?? 1;
      if (prod.tipo !== "Serviço") {
        const alvo = prod.estoqueRefId
          ? await db.query.produtos.findFirst({ where: eq(produtos.id, prod.estoqueRefId) })
          : prod;
        const disp = alvo?.estoqueAtual ?? 0;
        if (qtdNoPedido * fr > disp + 1e-9)
          throw new TRPCError({ code: "BAD_REQUEST", message: `Stock insuficiente: só ${Math.floor((disp / fr) * 100) / 100} un. de ${prod.nome}.` });
      }

      if (existente) {
        await db.update(pedidoItens).set({ qtd: existente.qtd + input.qtd }).where(eq(pedidoItens.id, existente.id));
      } else {
        await db.insert(pedidoItens).values({
          pedidoId: input.pedidoId, produtoId: prod.id, nome: prod.nome,
          categoria: prod.categoria, precoUnit: prod.preco, qtd: input.qtd,
          obs: input.obs || null,
        });
      }
      await logItemMov(db, {
        pedidoId: input.pedidoId, produtoId: prod.id, nome: prod.nome,
        delta: input.qtd, qtdFinal: qtdNoPedido, origem: "menu", usuarioId: input.usuarioId,
      });
      await recalcPedido(input.pedidoId);
      await syncCozinha(input.pedidoId, true);
      return getPedidoComItens(input.pedidoId);
      });
    }),

  /** +/− POR INCREMENTO: cada toque envia o DELTA (+1 / −1 / ±0,25) e o servidor soma
      atomicamente — cliques rápidos repetidos nunca se perdem nem duplicam,
      ao contrário de enviar o valor final (dois toques rápidos mandavam o mesmo total). */
  bumpItem: publicQuery
    .input(z.object({
      itemId: z.number().int().positive(),
      delta: z.number().min(-50).max(50).refine((n) => n !== 0, "delta não pode ser 0"),
      usuarioId: z.number().int().positive().optional(),
      produtoId: z.number().int().positive().optional(), // só para a camada de toques pendentes no ecrã
      pedidoId: z.number().int().positive().optional(),
    }))
    .mutation(async ({ input }) => {
      const it0 = await getDb().query.pedidoItens.findFirst({ where: eq(pedidoItens.id, input.itemId) });
      if (!it0) throw new TRPCError({ code: "NOT_FOUND" });
      return comLockPedido(it0.pedidoId, async () => {
      const db = getDb();
      const item = await db.query.pedidoItens.findFirst({ where: eq(pedidoItens.id, input.itemId) });
      if (!item) throw new TRPCError({ code: "NOT_FOUND" });
      const p = await db.query.pedidos.findFirst({ where: eq(pedidos.id, item.pedidoId) });
      if (!p || p.status !== "Aberto") throw new TRPCError({ code: "BAD_REQUEST", message: "Pedido não está aberto" });
      const novaQtd = Math.round((item.qtd + input.delta) * 100) / 100;
      if (novaQtd > 0) {
        const prod = item.produtoId != null
          ? await db.query.produtos.findFirst({ where: eq(produtos.id, item.produtoId) })
          : undefined;
        if (prod && !prod.qtdDecimal && !Number.isInteger(novaQtd))
          throw new TRPCError({ code: "BAD_REQUEST", message: "Este produto só aceita quantidades inteiras." });
        if (prod && prod.tipo !== "Serviço" && input.delta > 0) {
          const fr = prod.fraccao ?? 1;
          const alvo = prod.estoqueRefId
            ? await db.query.produtos.findFirst({ where: eq(produtos.id, prod.estoqueRefId) })
            : prod;
          const disp = alvo?.estoqueAtual ?? 0;
          if (novaQtd * fr > disp + 1e-9)
            throw new TRPCError({ code: "BAD_REQUEST", message: `Stock insuficiente: só ${Math.floor((disp / fr) * 100) / 100} un. de ${prod.nome}.` });
        }
        await db.update(pedidoItens).set({ qtd: novaQtd }).where(eq(pedidoItens.id, item.id));
      } else {
        await db.delete(pedidoItens).where(eq(pedidoItens.id, item.id));
      }
      await logItemMov(db, {
        pedidoId: item.pedidoId, produtoId: item.produtoId, nome: item.nome,
        delta: input.delta, qtdFinal: Math.max(0, novaQtd), origem: "ajuste", usuarioId: input.usuarioId,
      });
      await recalcPedido(item.pedidoId);
      await syncCozinha(item.pedidoId, false);
      return getPedidoComItens(item.pedidoId);
      });
    }),

  /** Histórico detalhado de lançamentos do pedido (Admin/Gestor) — o «caderno». */
  historicoItens: publicQuery
    .input(z.object({ usuarioId: z.number().int().positive(), pedidoId: z.number().int().positive() }))
    .query(async ({ input }) => {
      await requirePerfil(input.usuarioId, ["Admin", "Gestor"]);
      return getDb().select().from(pedidoItensLog)
        .where(eq(pedidoItensLog.pedidoId, input.pedidoId))
        .orderBy(desc(pedidoItensLog.id));
    }),

  setItemQtd: publicQuery
    .input(z.object({ itemId: z.number().int().positive(), qtd: z.number().min(0).max(999) }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const item = await db.query.pedidoItens.findFirst({ where: eq(pedidoItens.id, input.itemId) });
      if (!item) throw new TRPCError({ code: "NOT_FOUND" });
      const p = await db.query.pedidos.findFirst({ where: eq(pedidos.id, item.pedidoId) });
      if (!p || p.status !== "Aberto") throw new TRPCError({ code: "BAD_REQUEST", message: "Pedido não está aberto" });
      if (input.qtd > 0) {
        const prod = item.produtoId != null
          ? await db.query.produtos.findFirst({ where: eq(produtos.id, item.produtoId) })
          : undefined;
        if (prod && !prod.qtdDecimal && !Number.isInteger(input.qtd))
          throw new TRPCError({ code: "BAD_REQUEST", message: "Este produto só aceita quantidades inteiras." });
        if (prod && prod.tipo !== "Serviço") {
          const fr = prod.fraccao ?? 1;
          const alvo = prod.estoqueRefId
            ? await db.query.produtos.findFirst({ where: eq(produtos.id, prod.estoqueRefId) })
            : prod;
          const disp = alvo?.estoqueAtual ?? 0;
          if (input.qtd * fr > disp + 1e-9)
            throw new TRPCError({ code: "BAD_REQUEST", message: `Stock insuficiente: só ${Math.floor((disp / fr) * 100) / 100} un. de ${prod.nome}.` });
        }
        await db.update(pedidoItens).set({ qtd: input.qtd }).where(eq(pedidoItens.id, input.itemId));
      } else {
        await db.delete(pedidoItens).where(eq(pedidoItens.id, input.itemId));
      }
      await recalcPedido(item.pedidoId);
      await syncCozinha(item.pedidoId, false);
      return getPedidoComItens(item.pedidoId);
    }),

  /* ---------- COZINHA (pedidos do salão/restaurante) ---------- */

  /** Quadro da cozinha: pedidos abertos com pratos a preparar — SÓ os itens de
      cozinha aparecem (bebidas/bar ficam de fora), sem preços. */
  cozinha: publicQuery
    .input(usuarioInput)
    .query(async ({ input }) => {
      await requirePerfil(input.usuarioId, ["Admin", "Gestor", "Vendedor", "Cozinha"]);
      const db = getDb();
      const ps = await db.select().from(pedidos)
        .where(and(eq(pedidos.status, "Aberto"), isNotNull(pedidos.cozinhaStatus)))
        .orderBy(pedidos.criadoEm);
      const out = [];
      for (const p of ps) {
        const itens = (await db.select().from(pedidoItens).where(eq(pedidoItens.pedidoId, p.id)));
        const coz = [];
        for (const i of itens)
          if (await itemEhCozinha(i.produtoId))
            coz.push({ id: i.id, nome: i.nome, qtd: i.qtd, obs: i.obs, categoria: i.categoria, personalizado: i.produtoId == null });
        if (coz.length > 0)
          out.push({ id: p.id, numero: p.numero, referencia: p.referencia, area: p.area, criadoEm: p.criadoEm, cozinhaStatus: p.cozinhaStatus, itens: coz });
      }
      // cozinha primeiro: Pendente → Em Preparo → Pronto
      const ord = (s: string | null) => (s === "Pendente" ? 0 : s === "Em Preparo" ? 1 : 2);
      return out.sort((a, b) => ord(a.cozinhaStatus) - ord(b.cozinhaStatus));
    }),

  /** Cozinha inicia o preparo dos pratos do pedido */
  cozinhaIniciar: publicQuery
    .input(usuarioInput.extend({ pedidoId: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const u = await requirePerfil(input.usuarioId, ["Admin", "Gestor", "Cozinha"]);
      const db = getDb();
      const p = await db.query.pedidos.findFirst({ where: eq(pedidos.id, input.pedidoId) });
      if (!p || p.status !== "Aberto") throw new TRPCError({ code: "BAD_REQUEST", message: "Pedido não está aberto" });
      if (p.cozinhaStatus !== "Pendente") throw new TRPCError({ code: "BAD_REQUEST", message: "Este pedido não está pendente na cozinha." });
      await db.update(pedidos).set({ cozinhaStatus: "Em Preparo" }).where(eq(pedidos.id, p.id));
      return { ok: true, por: u.nome };
    }),

  /** Cozinha marca os pratos como prontos → sinal para o garçom levantar */
  cozinhaPronto: publicQuery
    .input(usuarioInput.extend({ pedidoId: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const u = await requirePerfil(input.usuarioId, ["Admin", "Gestor", "Cozinha"]);
      const db = getDb();
      const p = await db.query.pedidos.findFirst({ where: eq(pedidos.id, input.pedidoId) });
      if (!p || p.status !== "Aberto") throw new TRPCError({ code: "BAD_REQUEST", message: "Pedido não está aberto" });
      if (p.cozinhaStatus !== "Em Preparo") throw new TRPCError({ code: "BAD_REQUEST", message: "Este pedido não está em preparo." });
      await db.update(pedidos).set({ cozinhaStatus: "Pronto" }).where(eq(pedidos.id, p.id));
      return { ok: true, por: u.nome };
    }),

  /** Garçom/vendedor confirma que levantou os pratos prontos (limpa o sinal) */
  cozinhaLevantado: publicQuery
    .input(usuarioInput.extend({ pedidoId: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      await requirePerfil(input.usuarioId, ["Admin", "Gestor", "Vendedor"]);
      await getDb().update(pedidos).set({ cozinhaStatus: null }).where(eq(pedidos.id, input.pedidoId));
      return { ok: true };
    }),

  fechar: publicQuery
    .input(usuarioInput.extend({
      pedidoId: z.number().int().positive(),
      desconto: z.number().min(0).max(100).default(0),
      metodo: z.string().min(2),
      // data de lançamento da venda — para lançamentos atrasados (não pode ser futura)
      dataDia: z.string().length(10).optional(),
      recebido: z.number().min(0).default(0),
      partes: z.array(z.object({ metodo: z.string().min(2).max(40), valor: z.number().min(0) })).max(6).optional(),
      // como o troco será/foi entregue (uma ou mais formas; a soma deve ser igual ao troco)
      trocoPartes: z.array(z.object({ forma: z.string().min(2).max(40), valor: z.number().min(0) })).max(6).optional(),
      // FIADO: o cliente fica a dever o valor em falta — a dívida fica visível até ser paga
      dividaNome: z.string().min(2).max(160).optional(),
      dividaTel: z.string().max(30).optional(),
      dividaObs: z.string().max(255).optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const p = await getPedidoComItens(input.pedidoId);
      if (p.status !== "Aberto") throw new TRPCError({ code: "BAD_REQUEST", message: "Pedido já foi fechado" });
      if (p.itens.length === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "Pedido sem itens" });

      // data de lançamento: permite registar vendas de dias anteriores (falhas de lançamento)
      const diaFecho = input.dataDia ?? p.dataDia;
      if (diaFecho > DIA())
        throw new TRPCError({ code: "BAD_REQUEST", message: "A data de lançamento não pode ser futura." });
      const quandoPag = new Date(diaFecho + "T12:00:00+02:00"); // meio-dia de Maputo → cai no dia certo nos relatórios

      const subtotal = p.itens.reduce((a, i) => a + i.qtd * i.precoUnit, 0);
      let total = Math.round(subtotal * (1 - input.desconto / 100) * 100) / 100;

      // Reserva confirmada: deduz automaticamente o CRÉDITO AINDA DISPONÍVEL da reserva.
      // · Braai: taxa NÃO consumível → o pedido é SEMPRE consumo novo (cobrado por inteiro).
      // · Buffet: o item do pedido já cobra só o remanescente → nada a deduzir.
      // · Normal (taxa consumível): deduz o que o cliente pagou (adiantamento + parcelas,
      //   líquido do desconto) MENOS o que pedidos anteriores já consumiram — um pedido
      //   aberto DEPOIS de o crédito esgotar é cobrado por inteiro (pedido novo ≠ reserva).
      let adiantDeduzido = 0;
      if (p.reservaId) {
        const credito = await creditoReservaDisponivel(p.reservaId, p.id);
        adiantDeduzido = Math.min(credito, total);
      }
      total = Math.round((total - adiantDeduzido) * 100) / 100;

      // pagamento dividido: normaliza as partes (1 método = 1 parte com o total)
      // (com fiado, o cliente pode não pagar nada agora — partes pode vir vazio de propósito)
      const partes = (input.partes ? input.partes : [{ metodo: input.metodo, valor: total }])
        .map((x) => ({ metodo: x.metodo.trim(), valor: Math.round(x.valor * 100) / 100 }))
        .filter((x) => x.metodo.length >= 2 && x.valor > 0);
      const somaPartes = Math.round(partes.reduce((a, x) => a + x.valor, 0) * 100) / 100;
      // FIADO: com nome do cliente, o fecho pode ficar com valor em falta → gera dívida
      const emFalta = Math.round((total - somaPartes) * 100) / 100;
      const comDivida = !!input.dividaNome && emFalta > 0.009;
      if (comDivida && input.dividaNome!.trim().length < 2)
        throw new TRPCError({ code: "BAD_REQUEST", message: "Indique o nome do cliente que fica a dever." });
      if (emFalta < -0.009 || (!comDivida && Math.abs(emFalta) >= 0.01))
        throw new TRPCError({ code: "BAD_REQUEST", message: `A soma das partes (${somaPartes.toFixed(2)}) não é igual ao total (${total.toFixed(2)})` });
      const metodoLbl = partes.length > 0
        ? [...new Set(partes.map((x) => x.metodo))].join(" + ") + (comDivida ? " + Dívida" : "")
        : comDivida ? "Dívida" : "Coberto pela reserva"; // total 0 = consumo dentro do valor já pago na reserva

      // VALOR LEVANTADO/RECEBIDO: pode exceder o total em QUALQUER metodo — dinheiro na mao
      // ou adiantamento por levantamento M-Pesa/e-Mola deixado em conta para consumir.
      // O que sobra e devolvido ao cliente como troco (na forma escolhida no fecho).
      if (input.recebido > 0 && input.recebido < somaPartes - 0.004)
        throw new TRPCError({ code: "BAD_REQUEST", message: `Valor recebido (${input.recebido.toFixed(2)}) insuficiente para o total pago (${somaPartes.toFixed(2)})` });
      const troco = input.recebido > 0 ? Math.max(0, Math.round((input.recebido - somaPartes) * 100) / 100) : 0;
      // formas de entrega do troco (controlo de dinheiro físico vs. contas móveis/banco)
      let trocoPartes: { forma: string; valor: number }[] = [];
      if (troco > 0) {
        trocoPartes = (input.trocoPartes && input.trocoPartes.length > 0 ? input.trocoPartes : [{ forma: "Dinheiro", valor: troco }])
          .map((x) => ({ forma: x.forma.trim(), valor: Math.round(x.valor * 100) / 100 }))
          .filter((x) => x.forma.length >= 2 && x.valor > 0);
        const somaTroco = Math.round(trocoPartes.reduce((a, x) => a + x.valor, 0) * 100) / 100;
        if (trocoPartes.length === 0 || Math.abs(somaTroco - troco) >= 0.01)
          throw new TRPCError({ code: "BAD_REQUEST", message: `A soma das formas de troco (${somaTroco.toFixed(2)}) não é igual ao troco (${troco.toFixed(2)})` });
      }
      const quem = await db.query.usuarios.findFirst({ where: eq(usuarios.id, input.usuarioId) });

      await db.transaction(async (tx) => {
        await tx.update(pedidos).set({
          status: "Fechado", dataDia: diaFecho, desconto: input.desconto, subtotal, total, adiantDeduzido,
          metodo: metodoLbl, recebido: input.recebido > 0 ? input.recebido : somaPartes, troco,
          trocoDetalhe: trocoPartes.length ? JSON.stringify(trocoPartes) : null, fechadoEm: new Date(),
          fechadoPor: quem?.nome ?? null,
          dividaGerada: comDivida ? emFalta : 0,
        }).where(eq(pedidos.id, input.pedidoId));

        // baixa de stock (itens personalizados não têm produto → ignorados)
        for (const it of p.itens) {
          if (it.produtoId == null) continue;
          const prod = await tx.query.produtos.findFirst({ where: eq(produtos.id, it.produtoId) });
          if (prod) await baixarStockProduto(tx, prod, it.qtd, `Pedido nº ${p.numero}`, input.usuarioId);
        }
      });

      // um registo de pagamento por parte — os relatórios por método ficam correctos
      for (const pt of partes) {
        const cod = await nextCodigo("pagamento", "PG-");
        await db.insert(pagamentos).values({
          codigo: cod, tipoVenda: `Pedido nº ${p.numero} (${diaFecho})`,
          cliente: p.referencia || "—", valor: pt.valor, metodo: pt.metodo,
          criadoEm: quandoPag,
        });
      }
      // FIADO: regista a dívida do valor em falta — fica visível até ser paga por completo
      if (comDivida) {
        const { registarDivida } = await import("./dividas");
        await registarDivida({
          pedidoId: p.id,
          clienteNome: input.dividaNome!,
          clienteTel: input.dividaTel ?? null,
          obs: input.dividaObs ?? `Pedido nº ${p.numero} (${diaFecho})`,
          valor: emFalta,
          criadoPor: input.usuarioId,
        });
      }
      // comissão do afiliado no fecho da conta
      if (p.afiliadoId) {
        let reservaDaComissao: typeof reservas.$inferSelect | null = null;
        if (p.reservaId)
          reservaDaComissao = await db.query.reservas.findFirst({ where: eq(reservas.id, p.reservaId) }) ?? null;
        const alta = reservaDaComissao?.pacoteNome != null
          || (reservaDaComissao?.espaco != null && ESPACOS_COMISSAO_ALTA.includes(reservaDaComissao.espaco)); // 5% no aluguer do salão (com/sem decoração); o resto = 3%
        const lead = await leadProtegido(p.afiliadoId, reservaDaComissao?.contacto ?? p.referencia);
        await lancarComissao({
          afiliadoId: p.afiliadoId, origem: "Pedido", origemId: p.id,
          origemRef: `#${p.numero} ${diaFecho}`,
          descricao: reservaDaComissao
            ? `Saldo da reserva ${reservaDaComissao.codigo} — ${reservaDaComissao.cliente}`
            : `Pedido nº ${p.numero} (${diaFecho})${p.referencia ? " — " + p.referencia : ""}`,
          valorVenda: total, alta,
          // com reserva: a 1ª metade já saiu na confirmação → só a última; sem reserva: pagamento único = as duas
          parcela: reservaDaComissao ? 2 : 0, leadId: lead?.id ?? null,
        });
      }
      return getPedidoComItens(input.pedidoId);
    }),

  anular: publicQuery
    .input(usuarioInput.extend({ pedidoId: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const p = await getPedidoComItens(input.pedidoId);
      if (p.status !== "Aberto") throw new TRPCError({ code: "BAD_REQUEST", message: "Só pedidos abertos podem ser anulados" });
      await getDb().update(pedidos).set({ status: "Anulado" }).where(eq(pedidos.id, input.pedidoId));
      return { ok: true };
    }),

  setReferencia: publicQuery
    .input(z.object({ pedidoId: z.number().int().positive(), referencia: z.string().max(120) }))
    .mutation(async ({ input }) => {
      await getDb().update(pedidos).set({ referencia: input.referencia }).where(eq(pedidos.id, input.pedidoId));
      return getPedidoComItens(input.pedidoId);
    }),

  /** Gerente/Caixa pede autorização para alterar um pedido FECHADO POR ENGANO.
      Fica registado quem pediu e o motivo; só o Admin pode autorizar (reabrirPedido). */
  solicitarReabertura: publicQuery
    .input(z.object({
      usuarioId: z.number().int().positive(),
      pedidoId: z.number().int().positive(),
      motivo: z.string().min(4).max(255),
    }))
    .mutation(async ({ input }) => {
      const u = await requirePerfil(input.usuarioId, ["Gestor", "Vendedor"]);
      const db = getDb();
      const p = await db.query.pedidos.findFirst({ where: eq(pedidos.id, input.pedidoId) });
      if (!p || p.status !== "Fechado")
        throw new TRPCError({ code: "BAD_REQUEST", message: "Só pedidos fechados podem ter pedido de alteração" });
      if (p.reaberturaPor)
        throw new TRPCError({ code: "BAD_REQUEST", message: `Já existe um pedido de alteração em espera (feito por ${p.reaberturaPor}). Aguarde a decisão do Administrador.` });
      await db.update(pedidos).set({
        reaberturaPor: u.nome, reaberturaMotivo: input.motivo.trim(),
      }).where(eq(pedidos.id, p.id));
      return { ok: true };
    }),

  /** Admin AUTORIZA a alteração: o pedido fechado volta a «Aberto» para ser corrigido
      — o stock é reposto, o pagamento é anulado, a comissão é estornada e a dívida
      gerada no fecho (se houver) é anulada. Ao fechar de novo, tudo é recalculado. */
  reabrirPedido: publicQuery
    .input(usuarioInput.extend({ pedidoId: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      await requirePerfil(input.usuarioId, ["Admin"]);
      const db = getDb();
      const p = await getPedidoComItens(input.pedidoId);
      if (p.status !== "Fechado")
        throw new TRPCError({ code: "BAD_REQUEST", message: "Só pedidos fechados podem ser reabertos" });
      await db.transaction(async (tx) => {
        // repõe o stock dos itens vendidos (o novo fecho voltará a debitar)
        for (const it of p.itens) {
          if (it.produtoId == null) continue;
          const prod = await tx.query.produtos.findFirst({ where: eq(produtos.id, it.produtoId) });
          if (prod) await reporStockProduto(tx, prod, it.qtd, `Reabertura do pedido nº ${p.numero} (autorizada pelo Admin)`, input.usuarioId);
        }
        await tx.update(pedidos).set({
          status: "Aberto", desconto: 0, total: 0, metodo: null, recebido: null, troco: null,
          trocoDetalhe: null, fechadoEm: null, fechadoPor: null, dividaGerada: 0, adiantDeduzido: 0,
          reaberturaPor: null, reaberturaMotivo: null,
        }).where(eq(pedidos.id, p.id));
        // anula o pagamento registado no fecho (fica o rasto)
        await tx.update(pagamentos).set({ status: "Anulado" })
          .where(eq(pagamentos.tipoVenda, `Pedido nº ${p.numero} (${p.dataDia})`));
        // anula a dívida gerada no fecho, se ainda estiver aberta
        await tx.execute(sql`UPDATE dividas SET status = 'Anulada', obs = CONCAT(COALESCE(obs,''), ' — ANULADA pela reabertura do pedido nº ${p.numero}') WHERE pedido_id = ${p.id} AND status = 'Aberta'`);
      });
      // estorna comissões pendentes deste pedido (serão recalculadas no novo fecho)
      await estornarComissoes("Pedido", p.id);
      return getPedidoComItens(p.id);
    }),

  /** Cancelar um pedido JÁ FECHADO (Admin/Gestor): repõe o stock e anula o pagamento */
  anularFechado: publicQuery
    .input(usuarioInput.extend({ pedidoId: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      await requirePerfil(input.usuarioId, ["Admin", "Gestor"]);
      const db = getDb();
      const p = await getPedidoComItens(input.pedidoId);
      if (p.status !== "Fechado")
        throw new TRPCError({ code: "BAD_REQUEST", message: "Só pedidos fechados podem ser cancelados aqui" });
      await db.transaction(async (tx) => {
        // repõe o stock dos itens vendidos
        for (const it of p.itens) {
          if (it.produtoId == null) continue;
          const prod = await tx.query.produtos.findFirst({ where: eq(produtos.id, it.produtoId) });
          if (prod) await reporStockProduto(tx, prod, it.qtd, `Cancelamento do pedido nº ${p.numero}`, input.usuarioId);
        }
        await tx.update(pedidos).set({ status: "Anulado" }).where(eq(pedidos.id, p.id));
        // marca o pagamento correspondente como anulado
        await tx.update(pagamentos).set({ status: "Anulado" })
          .where(eq(pagamentos.tipoVenda, `Pedido nº ${p.numero} (${p.dataDia})`));
      });
      // estorna comissões pendentes deste pedido
      await estornarComissoes("Pedido", p.id);
      return { ok: true };
    }),

  /** Eliminar DEFINITIVAMENTE um pedido e os seus rastos (apenas Admin — limpeza de testes) */
  eliminar: publicQuery
    .input(usuarioInput.extend({ pedidoId: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      await requirePerfil(input.usuarioId, ["Admin"]);
      const db = getDb();
      const p = await getPedidoComItens(input.pedidoId);
      await db.transaction(async (tx) => {
        // se estava fechado, repõe o stock antes de apagar
        if (p.status === "Fechado") {
          for (const it of p.itens) {
            if (it.produtoId == null) continue;
            const prod = await tx.query.produtos.findFirst({ where: eq(produtos.id, it.produtoId) });
            if (prod && prod.tipo !== "Serviço") {
              const alvo = prod.estoqueRefId ?? prod.id;
              const delta = Math.round(it.qtd * (prod.fraccao ?? 1) * 10000) / 10000;
              await tx.update(produtos)
                .set({ estoqueAtual: sql`${produtos.estoqueAtual} + ${delta}` })
                .where(eq(produtos.id, alvo));
            }
          }
        }
        await tx.delete(pedidoItens).where(eq(pedidoItens.pedidoId, p.id));
        await tx.delete(documentos).where(eq(documentos.pedidoId, p.id));
        await tx.delete(pagamentos)
          .where(eq(pagamentos.tipoVenda, `Pedido nº ${p.numero} (${p.dataDia})`));
        // desliga reservas ligadas a este pedido
        await tx.update(reservas).set({ pedidoId: null }).where(eq(reservas.pedidoId, p.id));
        await tx.delete(pedidos).where(eq(pedidos.id, p.id));
      });
      // comissões ligadas à venda eliminada: apaga as pendentes e estorna as restantes
      const { afiliadoComissoes } = await import("@db/schema");
      await db.delete(afiliadoComissoes)
        .where(and(eq(afiliadoComissoes.origem, "Pedido"), eq(afiliadoComissoes.origemId, p.id), eq(afiliadoComissoes.estado, "Pendente")));
      await estornarComissoes("Pedido", p.id);
      return { ok: true };
    }),
});
