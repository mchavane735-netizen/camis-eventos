/**
 * CAMI'S EVENTOS — camis8: Entregas (Delivery)
 * Solicitação de entregador pelo restaurante (opcional — o restaurante pode
 * sempre contactar o entregador directamente). Quando uma solicitação é aberta,
 * os entregadores registados e ONLINE (heartbeat recente) vêem-na no seu painel
 * com som de alerta; o PRIMEIRO a aceitar fica com a entrega e os outros vêem
 * "alguém já está a caminho". Admin/Gestor podem cancelar e solicitar outro.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { createRouter, publicQuery } from "./middleware";
import { getDb } from "./queries/connection";
import {
  entregaSolicitacoes, notificacoes, pedidosOnline, usuarios,
} from "@db/schema";
import { getEmpresa } from "./camis3";

async function requirePerfil(userId: number, perfis: string[]) {
  const u = await getDb().query.usuarios.findFirst({ where: eq(usuarios.id, userId) });
  if (!u || !u.ativo) throw new TRPCError({ code: "UNAUTHORIZED", message: "Utilizador inválido" });
  if (!perfis.includes(u.perfil))
    throw new TRPCError({ code: "FORBIDDEN", message: "Ação reservada a: " + perfis.join(", ") });
  return u;
}

const GESTAO = ["Admin", "Gestor"];
const STAFF = ["Admin", "Gestor", "Vendedor"];
const COURIER = ["Entregador"];
const ONLINE_MS = 3 * 60 * 1000; // entregador "online" se deu sinal há menos de 3 min

export const entregasRouter = createRouter({
  /** Base de dados de entregadores (Admin/Gestor): quem existe e quem está online */
  entregadores: publicQuery
    .input(z.object({ usuarioId: z.number().int().positive() }))
    .query(async ({ input }) => {
      await requirePerfil(input.usuarioId, GESTAO);
      const us = await getDb().select({
        id: usuarios.id, nome: usuarios.nome, telefone: usuarios.telefone,
        ativo: usuarios.ativo, ultimoPing: usuarios.ultimoPing,
      }).from(usuarios).where(eq(usuarios.perfil, "Entregador"));
      const limite = new Date(Date.now() - ONLINE_MS);
      return us.map((u) => ({ ...u, online: !!u.ultimoPing && u.ultimoPing >= limite }));
    }),

  /** Restaurante solicita um entregador para um pedido de delivery (opcional) */
  solicitar: publicQuery
    .input(z.object({
      usuarioId: z.number().int().positive(),
      pedidoOnlineId: z.number().int().positive(),
      taxa: z.number().min(0).max(100000).optional(),
    }))
    .mutation(async ({ input }) => {
      const actor = await requirePerfil(input.usuarioId, STAFF);
      const db = getDb();
      const p = await db.query.pedidosOnline.findFirst({ where: eq(pedidosOnline.id, input.pedidoOnlineId) });
      if (!p) throw new TRPCError({ code: "NOT_FOUND", message: "Pedido não encontrado" });
      const taxa = input.taxa ?? p.taxaEntrega; // por defeito, a taxa de entrega do pedido (paga ao entregador)
      if (p.tipo !== "Delivery")
        throw new TRPCError({ code: "BAD_REQUEST", message: "Só pedidos de delivery precisam de entregador." });
      if (!["Confirmado", "Em Preparo", "Pronto"].includes(p.status))
        throw new TRPCError({ code: "BAD_REQUEST", message: "O pedido precisa de estar confirmado para pedir entregador." });
      // já existe solicitação activa para este pedido?
      const activa = await db.query.entregaSolicitacoes.findFirst({
        where: and(eq(entregaSolicitacoes.pedidoOnlineId, p.id),
          sql`${entregaSolicitacoes.estado} IN ('Aberta','Atribuida')`),
      });
      if (activa) return { ok: true, id: activa.id, estado: activa.estado, entregadorNome: activa.entregadorNome };
      const [r] = await db.insert(entregaSolicitacoes).values({
        pedidoOnlineId: p.id, codigo: p.codigo, taxa,
      });
      await db.insert(notificacoes).values({
        pedidoOnlineId: p.id, telefone: p.clienteTelefone,
        mensagem: `🛵 ${actor.nome} solicitou um entregador para o pedido ${p.codigo} (taxa de entrega ${taxa.toFixed(2)} MZN, paga ao entregador na entrega).`,
      });
      return { ok: true, id: Number(r.insertId), estado: "Aberta" as const, entregadorNome: null };
    }),

  /** Estado da solicitação de um pedido (para a página de Pedidos Online) */
  porPedido: publicQuery
    .input(z.object({ usuarioId: z.number().int().positive(), pedidoOnlineId: z.number().int().positive() }))
    .query(async ({ input }) => {
      await requirePerfil(input.usuarioId, STAFF);
      const db = getDb();
      const s = await db.query.entregaSolicitacoes.findFirst({
        where: eq(entregaSolicitacoes.pedidoOnlineId, input.pedidoOnlineId),
        orderBy: desc(entregaSolicitacoes.id),
      });
      const limiteSql = new Date(Date.now() - ONLINE_MS).toISOString().slice(0, 19).replace("T", " ");
      const online = await db.select({ n: sql<number>`COUNT(*)` }).from(usuarios)
        .where(and(eq(usuarios.perfil, "Entregador"), eq(usuarios.ativo, true),
          sql`${usuarios.ultimoPing} >= ${limiteSql}`));
      return { solicitacao: s ?? null, entregadoresOnline: Number(online[0]?.n ?? 0) };
    }),

  /** Admin/Gestor cancela a solicitação/entregador actual — pode solicitar outro */
  cancelar: publicQuery
    .input(z.object({ usuarioId: z.number().int().positive(), id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const actor = await requirePerfil(input.usuarioId, GESTAO);
      const db = getDb();
      const s = await db.query.entregaSolicitacoes.findFirst({ where: eq(entregaSolicitacoes.id, input.id) });
      if (!s) throw new TRPCError({ code: "NOT_FOUND", message: "Solicitação não encontrada" });
      if (!["Aberta", "Atribuida"].includes(s.estado))
        throw new TRPCError({ code: "BAD_REQUEST", message: "Esta solicitação já terminou." });
      await db.update(entregaSolicitacoes)
        .set({ estado: "Cancelada", atualizadoEm: new Date() })
        .where(eq(entregaSolicitacoes.id, s.id));
      if (s.estado === "Atribuida") {
        await db.update(pedidosOnline)
          .set({ entregadorNome: null, entregadorTel: null })
          .where(eq(pedidosOnline.id, s.pedidoOnlineId));
        await db.insert(notificacoes).values({
          pedidoOnlineId: s.pedidoOnlineId, telefone: "",
          mensagem: `⚠️ ${actor.nome} cancelou o entregador ${s.entregadorNome ?? ""} do pedido ${s.codigo}. Pode solicitar outro.`,
        });
      }
      return { ok: true };
    }),

  /** Painel do entregador: heartbeat + solicitações abertas + as minhas entregas */
  painel: publicQuery
    .input(z.object({ usuarioId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const u = await requirePerfil(input.usuarioId, COURIER);
      const db = getDb();
      // heartbeat — marca o entregador como online
      await db.update(usuarios).set({ ultimoPing: new Date() }).where(eq(usuarios.id, u.id));
      const abertas = await db.select().from(entregaSolicitacoes)
        .where(eq(entregaSolicitacoes.estado, "Aberta"))
        .orderBy(desc(entregaSolicitacoes.criadoEm)).limit(20);
      const abertasInfo = [];
      for (const s of abertas) {
        const p = await db.query.pedidosOnline.findFirst({ where: eq(pedidosOnline.id, s.pedidoOnlineId) });
        if (!p || !["Confirmado", "Em Preparo", "Pronto"].includes(p.status)) continue;
        abertasInfo.push({
          id: s.id, codigo: s.codigo, taxa: s.taxa, criadoEm: s.criadoEm,
          bairro: p.endereco ?? "", itens: p.itens.length, estadoPedido: p.status,
        });
      }
      const minhasSol = await db.select().from(entregaSolicitacoes)
        .where(and(eq(entregaSolicitacoes.estado, "Atribuida"), eq(entregaSolicitacoes.entregadorId, u.id)))
        .orderBy(desc(entregaSolicitacoes.criadoEm)).limit(20);
      const minhas = [];
      for (const s of minhasSol) {
        const p = await db.query.pedidosOnline.findFirst({ where: eq(pedidosOnline.id, s.pedidoOnlineId) });
        if (!p || ["Entregue", "Concluído", "Cancelado"].includes(p.status)) continue;
        minhas.push({
          solicitacaoId: s.id, pedidoId: p.id, codigo: p.codigo, taxa: s.taxa,
          clienteNome: p.clienteNome, clienteTelefone: p.clienteTelefone,
          endereco: p.endereco ?? "", status: p.status, total: p.total,
          itens: p.itens.map((i) => `${i.qtd}× ${i.nome}`),
        });
      }
      return { abertas: abertasInfo, minhas };
    }),

  /** Entregador aceita — o PRIMEIRO ganha; os outros vêem "alguém já está a caminho" */
  aceitar: publicQuery
    .input(z.object({ usuarioId: z.number().int().positive(), id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const u = await requirePerfil(input.usuarioId, COURIER);
      const db = getDb();
      const s = await db.query.entregaSolicitacoes.findFirst({ where: eq(entregaSolicitacoes.id, input.id) });
      if (!s) throw new TRPCError({ code: "NOT_FOUND", message: "Solicitação não encontrada" });
      // update atómico: só ganha se ainda estiver Aberta
      const r = await db.update(entregaSolicitacoes)
        .set({ estado: "Atribuida", entregadorId: u.id, entregadorNome: u.nome, atualizadoEm: new Date() })
        .where(and(eq(entregaSolicitacoes.id, s.id), eq(entregaSolicitacoes.estado, "Aberta")));
      if ((r as unknown as [{ affectedRows: number }])[0]?.affectedRows === 0)
        throw new TRPCError({ code: "CONFLICT", message: "🛵 Alguém já está a caminho — outro entregador aceitou primeiro." });
      await db.update(pedidosOnline)
        .set({ entregadorNome: u.nome, entregadorTel: u.telefone ?? null })
        .where(eq(pedidosOnline.id, s.pedidoOnlineId));
      const p = await db.query.pedidosOnline.findFirst({ where: eq(pedidosOnline.id, s.pedidoOnlineId) });
      if (p) {
        await db.insert(notificacoes).values({
          pedidoOnlineId: p.id, telefone: p.clienteTelefone,
          mensagem: `🛵 Entregador atribuído ao pedido ${p.codigo}: ${u.nome}${u.telefone ? ` (${u.telefone})` : ""}. Assim que o pedido sair, receberá o contacto para acompanhar a entrega.`,
        });
      }
      return { ok: true };
    }),

  /** Entregador assinala a entrega como feita */
  marcarEntregue: publicQuery
    .input(z.object({ usuarioId: z.number().int().positive(), pedidoOnlineId: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const u = await requirePerfil(input.usuarioId, COURIER);
      const db = getDb();
      const s = await db.query.entregaSolicitacoes.findFirst({
        where: and(eq(entregaSolicitacoes.pedidoOnlineId, input.pedidoOnlineId),
          eq(entregaSolicitacoes.estado, "Atribuida"), eq(entregaSolicitacoes.entregadorId, u.id)),
      });
      if (!s) throw new TRPCError({ code: "FORBIDDEN", message: "Esta entrega não está atribuída a si." });
      const p = await db.query.pedidosOnline.findFirst({ where: eq(pedidosOnline.id, input.pedidoOnlineId) });
      if (!p) throw new TRPCError({ code: "NOT_FOUND", message: "Pedido não encontrado" });
      await db.update(pedidosOnline)
        .set({ status: "Entregue", atualizadoEm: new Date(), atualizadoPor: `Entregador ${u.nome}` })
        .where(eq(pedidosOnline.id, p.id));
      await db.update(entregaSolicitacoes)
        .set({ estado: "Concluida", atualizadoEm: new Date() })
        .where(eq(entregaSolicitacoes.id, s.id));
      const emp = await getEmpresa();
      await db.insert(notificacoes).values({
        pedidoOnlineId: p.id, telefone: p.clienteTelefone,
        mensagem: `✔️ ${emp.nome}: O seu pedido ${p.codigo} foi ENTREGUE. Obrigado pela preferência — ${emp.slogan}!`,
      });
      return { ok: true };
    }),
});
