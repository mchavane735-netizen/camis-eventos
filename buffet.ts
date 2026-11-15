/* ============================================================
   BUFFET (v21)
   · Pacotes por pessoa (600 / 800 / 1200 MZN) — editáveis pelo Admin/Gestor
     (acrescentar/remover elementos, alterar preço, criar novos pacotes)
   · Venda no restaurante (POS): cria um pedido com o item do buffet
     (fecha-se e paga-se como qualquer conta — inclui fiado)
   · Loja online: o cliente escolhe o pacote na reserva (ver camis4.ts,
     criarPedido com buffetPacoteId) — paga adiantado como reserva
   ============================================================ */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { asc, eq, sql } from "drizzle-orm";
import { createRouter, publicQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { usuarios, buffetPacotes, pedidos, pedidoItens, reservas, pagamentos, contadores } from "@db/schema";

const DIA = () => new Date(Date.now() + 2 * 3600e3).toISOString().slice(0, 10); // Moçambique
const r2 = (n: number) => Math.round(n * 100) / 100;
const GESTAO = ["Admin", "Gestor"];

async function requirePerfil(userId: number, perfis: string[]) {
  const u = await getDb().query.usuarios.findFirst({ where: eq(usuarios.id, userId) });
  if (!u || !u.ativo) throw new TRPCError({ code: "UNAUTHORIZED", message: "Utilizador inválido" });
  if (!perfis.includes(u.perfil))
    throw new TRPCError({ code: "FORBIDDEN", message: "Ação reservada a: " + perfis.join(", ") });
  return u;
}

const limparItens = (arr: string[]) =>
  arr.map((x) => x.trim()).filter((x) => x.length >= 2).slice(0, 40);

async function nextCodigo(chave: string, prefix: string): Promise<string> {
  const db = getDb();
  await db.insert(contadores).values({ chave, valor: 1 })
    .onDuplicateKeyUpdate({ set: { valor: sql`${contadores.valor} + 1` } });
  const c = await db.query.contadores.findFirst({ where: eq(contadores.chave, chave) });
  return prefix + String(c?.valor ?? 1).padStart(4, "0");
}

export const buffetRouter = createRouter({
  /** Pacotes activos — usado pela página Buffet (equipa) e pela loja online */
  list: publicQuery.query(async () => {
    return getDb().select().from(buffetPacotes)
      .where(eq(buffetPacotes.ativo, true))
      .orderBy(asc(buffetPacotes.ordem), asc(buffetPacotes.preco));
  }),

  /** Todos os pacotes (inclui inactivos) — gestão */
  listTodos: publicQuery
    .input(z.object({ usuarioId: z.number().int().positive() }))
    .query(async ({ input }) => {
      await requirePerfil(input.usuarioId, GESTAO);
      return getDb().select().from(buffetPacotes)
        .orderBy(asc(buffetPacotes.ordem), asc(buffetPacotes.preco));
    }),

  /** Criar ou editar um pacote (nome, preço/pessoa, elementos, ordem, activo) */
  guardar: publicQuery
    .input(z.object({
      usuarioId: z.number().int().positive(),
      id: z.number().int().positive().optional(),
      nome: z.string().min(2).max(80),
      preco: z.number().min(1, "O preço por pessoa deve ser maior que zero"),
      itens: z.array(z.string().max(80)).min(1, "O pacote precisa de pelo menos um elemento"),
      // menu por secções (Menus do Chefe 2026) — quando presente, a lista plana «itens» é derivada dele
      categorias: z.array(z.object({
        nome: z.string().min(2).max(40),
        itens: z.array(z.string().max(80)).min(1),
      })).max(10).optional(),
      descricao: z.string().max(255).optional(),
      ordem: z.number().int().min(0).max(99).optional(),
      ativo: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      await requirePerfil(input.usuarioId, GESTAO);
      const db = getDb();
      // secções limpas (sem vazios); a lista plana acompanha para recibos/notificações
      const categorias = (input.categorias ?? [])
        .map((c) => ({ nome: c.nome.trim(), itens: limparItens(c.itens) }))
        .filter((c) => c.nome.length >= 2 && c.itens.length > 0)
        .slice(0, 10);
      const itens = categorias.length > 0
        ? categorias.flatMap((c) => c.itens).slice(0, 60)
        : limparItens(input.itens);
      if (itens.length === 0)
        throw new TRPCError({ code: "BAD_REQUEST", message: "O pacote precisa de pelo menos um elemento válido." });
      const vals = {
        nome: input.nome.trim(),
        preco: r2(input.preco),
        itens,
        ...(input.categorias ? { categorias: categorias.length > 0 ? categorias : null } : {}),
        descricao: input.descricao?.trim() || null,
        ordem: input.ordem ?? 0,
        ativo: input.ativo ?? true,
      };
      if (input.id) {
        const cur = await db.query.buffetPacotes.findFirst({ where: eq(buffetPacotes.id, input.id) });
        if (!cur) throw new TRPCError({ code: "NOT_FOUND", message: "Pacote não encontrado" });
        await db.update(buffetPacotes).set(vals).where(eq(buffetPacotes.id, input.id));
        return { ok: true as const, id: input.id };
      }
      const [{ id }] = await db.insert(buffetPacotes).values(vals).$returningId();
      return { ok: true as const, id };
    }),

  /** Remover um pacote (Admin/Gestor) */
  remover: publicQuery
    .input(z.object({ usuarioId: z.number().int().positive(), id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      await requirePerfil(input.usuarioId, GESTAO);
      await getDb().delete(buffetPacotes).where(eq(buffetPacotes.id, input.id));
      return { ok: true as const };
    }),

  /** Vender buffet no restaurante: cria um pedido POS com o pacote (item sem stock) */
  vender: publicQuery
    .input(z.object({
      usuarioId: z.number().int().positive(),
      pacoteId: z.number().int().positive(),
      pessoas: z.number().int().min(1, "Indique o número de pessoas").max(1000),
      referencia: z.string().max(120).optional(),
      area: z.string().max(80).optional(),
      // elementos extra pedidos pelo cliente (fora do pacote), com valor combinado
      extras: z.array(z.object({
        nome: z.string().min(2).max(120),
        valor: z.number().min(0),
      })).max(20).optional(),
    }))
    .mutation(async ({ input }) => {
      const u = await requirePerfil(input.usuarioId, ["Admin", "Gestor", "Vendedor"]);
      const db = getDb();
      const pac = await db.query.buffetPacotes.findFirst({ where: eq(buffetPacotes.id, input.pacoteId) });
      if (!pac || !pac.ativo) throw new TRPCError({ code: "NOT_FOUND", message: "Pacote de buffet não encontrado" });
      const dia = DIA();
      const [{ maxN }] = await db.select({ maxN: sql<number>`COALESCE(MAX(numero),0)` })
        .from(pedidos).where(eq(pedidos.dataDia, dia));
      const [{ id: pid }] = await db.insert(pedidos).values({
        numero: maxN + 1, dataDia: dia,
        referencia: input.referencia?.trim() || `Buffet — ${input.pessoas} pessoas`,
        area: input.area?.trim() || null,
        usuarioId: u.id,
      }).$returningId();
      const extras = (input.extras ?? []).filter((x) => x.nome.trim().length >= 2 && x.valor > 0);
      const totalExtras = r2(extras.reduce((a, x) => a + x.valor, 0));
      const total = r2(pac.preco * input.pessoas + totalExtras);
      await db.insert(pedidoItens).values({
        pedidoId: pid, produtoId: null,
        nome: `🍽 ${pac.nome} — ${input.pessoas} pessoa${input.pessoas > 1 ? "s" : ""} (${pac.itens.join(", ")})`,
        categoria: "Buffet",
        precoUnit: pac.preco, qtd: input.pessoas,
      });
      // elementos acrescentados a pedido do cliente (valor combinado com a equipa)
      for (const ex of extras) {
        await db.insert(pedidoItens).values({
          pedidoId: pid, produtoId: null,
          nome: `➕ Extra buffet: ${ex.nome.trim()}`,
          categoria: "Buffet",
          precoUnit: r2(ex.valor), qtd: 1,
        });
      }
      await db.update(pedidos).set({ subtotal: total, total }).where(eq(pedidos.id, pid));
      return { ok: true as const, pedidoId: pid, numero: maxN + 1, total };
    }),

  /** Buffet para data futura NO RESTAURANTE — o mesmo fluxo de pagamento da loja online:
      adiantamento de 50% a 100% (valor que o cliente tem disponível, % calculada),
      recomendação de liquidar o remanescente até 48h antes do evento,
      e a informação passa para a página «Reservas» como «Reserva Buffet» (Confirmada).
      No dia do consumo, o caixa/garçon abre o pedido a partir da página de Reservas. */
  reservar: publicQuery
    .input(z.object({
      usuarioId: z.number().int().positive(),
      pacoteId: z.number().int().positive(),
      pessoas: z.number().int().min(1).max(1000),
      referencia: z.string().min(2, "Indique o nome do cliente / grupo").max(120),
      telefone: z.string().max(40).optional(),
      area: z.string().max(80).optional(),
      dataEvento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      hora: z.string().max(5).optional(),
      adiantValor: z.number().min(0.01, "Indique o valor do adiantamento"),
      metodo: z.string().max(60).optional(),
      extras: z.array(z.object({
        nome: z.string().min(2).max(120),
        valor: z.number().min(0),
      })).max(20).optional(),
    }))
    .mutation(async ({ input }) => {
      const u = await requirePerfil(input.usuarioId, ["Admin", "Gestor", "Vendedor"]);
      const db = getDb();
      if (input.dataEvento <= DIA())
        throw new TRPCError({ code: "BAD_REQUEST", message: "Para o buffet de HOJE use «Criar pedido» — o pagamento faz-se no fecho da conta." });
      const pac = await db.query.buffetPacotes.findFirst({ where: eq(buffetPacotes.id, input.pacoteId) });
      if (!pac || !pac.ativo) throw new TRPCError({ code: "NOT_FOUND", message: "Pacote de buffet não encontrado" });

      const extras = (input.extras ?? []).filter((x) => x.nome.trim().length >= 2 && x.valor > 0);
      const totalExtras = r2(extras.reduce((a, x) => a + x.valor, 0));
      const total = r2(pac.preco * input.pessoas + totalExtras);
      const adiant = Math.min(total, r2(input.adiantValor));
      const pct = total > 0 ? Math.round((adiant / total) * 100) : 0;
      if (adiant < r2(total * 0.5) - 0.009)
        throw new TRPCError({ code: "BAD_REQUEST", message: `O adiantamento mínimo do buffet é 50% (${r2(total * 0.5)} MZN).` });

      const codigo = await nextCodigo("reserva", "R-");
      await db.insert(reservas).values({
        codigo, cliente: input.referencia.trim(), contacto: input.telefone?.trim() || null,
        dataReserva: DIA(), dataConsumo: input.dataEvento, hora: input.hora || null,
        area: input.area || null,
        tipo: "Buffet", tipoOutro: pac.nome, pacoteNome: pac.nome,
        pessoas: input.pessoas,
        valor: total, adiantPct: pct, adiant, saldo: r2(total - adiant),
        status: "Confirmada",
        condicoes: `Reserva Buffet — ${pac.nome} (${pac.itens.join(", ")})${extras.length ? ` · Extras: ${extras.map((x) => `${x.nome.trim()} (${r2(x.valor)} MZN)`).join(", ")}` : ""}. ${pct < 100
          ? "⏰ O remanescente deve ser liquidado até 48 HORAS antes do evento, sob pena de não abertura da mesa."
          : "Pago integralmente (100%)."} No dia do consumo, abra o pedido aqui mesmo para levantar os pratos e acrescentar outros produtos da casa.`,
        usuarioId: u.id,
      });
      // o adiantamento entra logo como receita do dia (pago ao balcão)
      const cod = await nextCodigo("pagamento", "PG-");
      await db.insert(pagamentos).values({
        codigo: cod, tipoVenda: `Adiantamento ${codigo}`,
        cliente: input.referencia.trim(),
        valor: adiant, metodo: input.metodo || "—",
      });
      return { ok: true as const, codigo, total, adiant, pct, saldo: r2(total - adiant) };
    }),
});
