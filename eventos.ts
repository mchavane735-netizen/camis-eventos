import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { createRouter, publicQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { eventos, eventoBilhetes, pagamentos, usuarios } from "@db/schema";
import { nextCodigo } from "./camis3";

/* ============================================================
   EVENTOS & BILHETEIRA — venda de entradas com registo de cada
   pessoa. Admin/Gestor/Gestor de Eventos: visão total.
   Caixa (Vendedor): vê apenas o que ELE vendeu (sem somatórios).
   ============================================================ */
const DIA = () => new Date(Date.now() + 2 * 3600e3).toISOString().slice(0, 10);
const r2 = (n: number) => Math.round(n * 100) / 100;
const VER_TUDO = ["Admin", "Gestor", "Eventos"];
const VENDE = ["Admin", "Gestor", "Eventos", "Vendedor"];

async function requirePerfilEv(userId: number, perfis: string[]) {
  const u = await getDb().query.usuarios.findFirst({ where: eq(usuarios.id, userId) });
  if (!u || !u.ativo) throw new TRPCError({ code: "UNAUTHORIZED", message: "Utilizador inválido" });
  if (!perfis.includes(u.perfil))
    throw new TRPCError({ code: "FORBIDDEN", message: "Ação reservada a: " + perfis.join(", ") });
  return u;
}

/** estatísticas de um evento; para o Caixa, apenas as vendas DELE */
async function statsEvento(eventoId: number, soVendedorId: number | null) {
  const db = getDb();
  const bs = await db.select().from(eventoBilhetes).where(eq(eventoBilhetes.eventoId, eventoId));
  const pagos = bs.filter((b) => b.status === "Pago" && (soVendedorId == null || Number(b.vendedorId) === soVendedorId));
  return {
    vendidos: pagos.length,
    vendidosNormal: pagos.filter((b) => b.tipo === "Normal").length,
    vendidosVip: pagos.filter((b) => b.tipo === "VIP").length,
    // a receita é o que ENTROU em caixa (com prestações, o valorPago é que conta)
    receita: r2(pagos.reduce((a, b) => a + Math.min(b.valorPago ?? b.valor, b.valor), 0)),
    emAberto: r2(pagos.reduce((a, b) => a + Math.max(0, b.valor - (b.valorPago ?? b.valor)), 0)),
  };
}

export const eventosRouter = createRouter({
  /** Lista de eventos com estatísticas (Caixa: só as próprias vendas) */
  listar: publicQuery
    .input(z.object({ usuarioId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const u = await requirePerfilEv(input.usuarioId, VENDE);
      const db = getDb();
      const evs = await db.select().from(eventos).orderBy(desc(eventos.dataEvento), desc(eventos.criadoEm));
      const veTudo = VER_TUDO.includes(u.perfil);
      const out = [];
      for (const e of evs) {
        const stats = await statsEvento(e.id, veTudo ? null : u.id);
        const vagas = e.capacidade != null ? Math.max(0, e.capacidade - stats.vendidos) : null;
        out.push({
          ...e,
          ...stats,
          vagasRestantes: vagas,
          veTudo,
        });
      }
      return out;
    }),

  /** Criar/editar evento (gestão) */
  guardar: publicQuery
    .input(z.object({
      usuarioId: z.number().int().positive(),
      id: z.number().int().positive().optional(),
      nome: z.string().min(3).max(160),
      descricao: z.string().max(2000).optional(),
      dataEvento: z.string().length(10),
      horaInicio: z.string().max(5).optional(),
      horaFim: z.string().max(5).optional(),
      local: z.string().max(160).optional(),
      precoNormal: z.number().min(0).default(0),
      precoVip: z.number().min(0).default(0),
      incluiNormal: z.string().max(1000).optional(),
      incluiVip: z.string().max(1000).optional(),
      capacidade: z.number().int().min(1).max(100000).nullish(),
      maxPrestacoes: z.number().int().min(1).max(12).optional(), // 1 = só à vista
    }))
    .mutation(async ({ input }) => {
      const u = await requirePerfilEv(input.usuarioId, VER_TUDO);
      const db = getDb();
      const valores = {
        nome: input.nome.trim(), descricao: input.descricao?.trim() || null,
        dataEvento: input.dataEvento, horaInicio: input.horaInicio || null, horaFim: input.horaFim || null,
        local: input.local?.trim() || null,
        precoNormal: r2(input.precoNormal), precoVip: r2(input.precoVip),
        incluiNormal: input.incluiNormal?.trim() || null, incluiVip: input.incluiVip?.trim() || null,
        capacidade: input.capacidade ?? null,
        maxPrestacoes: input.maxPrestacoes ?? 1,
      };
      if (input.id) {
        const e = await db.query.eventos.findFirst({ where: eq(eventos.id, input.id) });
        if (!e) throw new TRPCError({ code: "NOT_FOUND", message: "Evento não encontrado." });
        // CORRECÇÃO do nome de um evento já criado: só o Admin ou autorizado por ele
        if (e.nome !== valores.nome && u.perfil !== "Admin" && !(u as { podeEditarNomes?: boolean | null }).podeEditarNomes)
          throw new TRPCError({ code: "FORBIDDEN", message: "🔒 Só o Administrador (ou alguém autorizado por ele em ⚙️ Configurações) pode alterar o nome de um evento já criado. Os restantes campos pode editar à vontade." });
        await db.update(eventos).set(valores).where(eq(eventos.id, input.id));
        return { ok: true, codigo: e.codigo };
      }
      const codigo = await nextCodigo("evento", "EV-");
      await db.insert(eventos).values({ ...valores, codigo, criadoPor: input.usuarioId });
      return { ok: true, codigo };
    }),

  /** Mudar o estado (Aberto = vendas abertas; Esgotado/Encerrado = vendas fechadas) */
  setStatus: publicQuery
    .input(z.object({
      usuarioId: z.number().int().positive(),
      id: z.number().int().positive(),
      status: z.enum(["Rascunho", "Aberto", "Esgotado", "Encerrado", "Concluído", "Cancelado"]),
    }))
    .mutation(async ({ input }) => {
      await requirePerfilEv(input.usuarioId, VER_TUDO);
      await getDb().update(eventos).set({ status: input.status }).where(eq(eventos.id, input.id));
      return { ok: true };
    }),

  /** Remover evento sem bilhetes pagos (apenas Admin) */
  remover: publicQuery
    .input(z.object({ usuarioId: z.number().int().positive(), id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      await requirePerfilEv(input.usuarioId, ["Admin"]);
      const db = getDb();
      const pagos = await db.select().from(eventoBilhetes)
        .where(and(eq(eventoBilhetes.eventoId, input.id), eq(eventoBilhetes.status, "Pago")));
      if (pagos.length > 0)
        throw new TRPCError({ code: "BAD_REQUEST", message: `O evento já tem ${pagos.length} bilhete(s) pago(s) — não pode ser removido. Anule os bilhetes ou marque o evento como Cancelado.` });
      await db.delete(eventoBilhetes).where(eq(eventoBilhetes.eventoId, input.id));
      await db.delete(eventos).where(eq(eventos.id, input.id));
      return { ok: true };
    }),

  /** Vender bilhete — CADA PESSOA fica registada (nome + contacto).
      A receita entra no Financeiro como «Bilhete EV-…». */
  vender: publicQuery
    .input(z.object({
      usuarioId: z.number().int().positive(),
      eventoId: z.number().int().positive(),
      nomePessoa: z.string().min(2).max(160),
      telefone: z.string().max(40).optional(),
      tipo: z.enum(["Normal", "VIP"]).default("Normal"),
      metodo: z.string().min(2).max(60),
      // pagamento em PRESTAÇÕES (só se o evento permitir): nº combinado + 1.ª prestação (sinal)
      prestacoes: z.number().int().min(2).max(12).optional(),
      valorPago: z.number().min(0).optional(),
    }))
    .mutation(async ({ input }) => {
      const u = await requirePerfilEv(input.usuarioId, VENDE);
      const db = getDb();
      const e = await db.query.eventos.findFirst({ where: eq(eventos.id, input.eventoId) });
      if (!e) throw new TRPCError({ code: "NOT_FOUND", message: "Evento não encontrado." });
      if (e.status === "Rascunho")
        throw new TRPCError({ code: "BAD_REQUEST", message: "O evento ainda está em rascunho — a gestão tem de o ABRIR para as vendas começarem." });
      if (e.status !== "Aberto")
        throw new TRPCError({ code: "BAD_REQUEST", message: `As vendas deste evento estão fechadas (estado: ${e.status}).` });
      if (input.tipo === "VIP" && e.precoVip <= 0)
        throw new TRPCError({ code: "BAD_REQUEST", message: "Este evento não tem bilhetes VIP." });
      const valor = input.tipo === "VIP" ? e.precoVip : e.precoNormal;
      // PRESTAÇÕES: o evento tem de permitir, a 1.ª prestação é obrigatória e o
      // prazo total termina no DIA DO EVENTO — na entrada não se aceita pagamento
      const emPrest = input.prestacoes != null;
      const maxP = (e as { maxPrestacoes?: number | null }).maxPrestacoes ?? 1;
      const dia = DIA();
      if (emPrest) {
        if (maxP < 2)
          throw new TRPCError({ code: "BAD_REQUEST", message: "Este evento não aceita pagamento em prestações — só à vista. (A gestão pode activar em ✏️ Editar o evento.)" });
        if (input.prestacoes! > maxP)
          throw new TRPCError({ code: "BAD_REQUEST", message: `Este evento aceita no máximo ${maxP} prestações.` });
        if (dia >= e.dataEvento)
          throw new TRPCError({ code: "BAD_REQUEST", message: "⛔ No dia do evento a venda é só À VISTA — o prazo das prestações termina no próprio dia do evento." });
        const sinal = r2(input.valorPago ?? 0);
        if (!(sinal > 0))
          throw new TRPCError({ code: "BAD_REQUEST", message: "Para vender em prestações indique a 1.ª prestação (sinal) recebida agora." });
        if (sinal >= valor)
          throw new TRPCError({ code: "BAD_REQUEST", message: `O sinal (${sinal.toFixed(2)}) deve ser MENOR que o valor do bilhete (${valor.toFixed(2)}) — se o cliente paga tudo, venda à vista.` });
      }
      const valorPagoInicial = emPrest ? r2(input.valorPago!) : valor;
      // capacidade: conta só bilhetes PAGOS
      if (e.capacidade != null) {
        const st = await statsEvento(e.id, null);
        if (st.vendidos >= e.capacidade) {
          await db.update(eventos).set({ status: "Esgotado" }).where(eq(eventos.id, e.id));
          throw new TRPCError({ code: "BAD_REQUEST", message: "😔 Capacidade esgotada — não há mais bilhetes disponíveis." });
        }
      }
      const codigo = await nextCodigo("bilhete", "BL-");
      await db.insert(eventoBilhetes).values({
        codigo, eventoId: e.id, nomePessoa: input.nomePessoa.trim(),
        telefone: input.telefone?.trim() || null, tipo: input.tipo, valor,
        metodo: input.metodo, vendedorId: u.id, dataDia: dia,
        valorPago: valorPagoInicial, nPrestacoes: emPrest ? input.prestacoes! : 1,
      });
      // receita no Financeiro (relatório do dia e DRE por período).
      // Em prestações, cada parcela leva o código do bilhete no tipoVenda — assim o
      // estorno por anulação acerta nas parcelas DESTE bilhete, sem ambiguidades.
      const cod = await nextCodigo("pagamento", "PG-");
      await db.insert(pagamentos).values({
        codigo: cod,
        tipoVenda: emPrest ? `Bilhete ${e.codigo} — ${e.nome} · ${codigo}` : `Bilhete ${e.codigo} — ${e.nome}`,
        cliente: input.nomePessoa.trim(), valor: valorPagoInicial, metodo: input.metodo,
      });
      // se encheu agora, marca Esgotado
      if (e.capacidade != null) {
        const st = await statsEvento(e.id, null);
        if (st.vendidos >= e.capacidade)
          await db.update(eventos).set({ status: "Esgotado" }).where(eq(eventos.id, e.id));
      }
      const saldo = r2(valor - valorPagoInicial);
      return { ok: true, codigo, valor, valorPago: valorPagoInicial, saldo, nPrestacoes: emPrest ? input.prestacoes! : 1, evento: e.nome, dataEvento: e.dataEvento, local: e.local, horaInicio: e.horaInicio, inclui: input.tipo === "VIP" ? e.incluiVip : e.incluiNormal };
    }),

  /** Receber uma PRESTAÇÃO de um bilhete em pagamento faseado.
      Prazo: até ao DIA DO EVENTO (inclusive) — depois disso ninguém paga mais;
      sem quitação total o bilhete não dá entrada à porta. */
  pagarPrestacao: publicQuery
    .input(z.object({
      usuarioId: z.number().int().positive(),
      bilheteId: z.number().int().positive(),
      valor: z.number().min(0.01),
      metodo: z.string().min(2).max(60),
    }))
    .mutation(async ({ input }) => {
      const u = await requirePerfilEv(input.usuarioId, VENDE);
      const db = getDb();
      const b = await db.query.eventoBilhetes.findFirst({ where: eq(eventoBilhetes.id, input.bilheteId) });
      if (!b || b.status !== "Pago")
        throw new TRPCError({ code: "BAD_REQUEST", message: "Bilhete não encontrado ou já anulado." });
      const e = await db.query.eventos.findFirst({ where: eq(eventos.id, Number(b.eventoId)) });
      if (!e) throw new TRPCError({ code: "NOT_FOUND", message: "Evento não encontrado." });
      const saldoAntes = r2(b.valor - (b.valorPago ?? 0));
      if (saldoAntes <= 0.009)
        throw new TRPCError({ code: "BAD_REQUEST", message: "Este bilhete já está quitado — não há nada a cobrar." });
      if (DIA() > e.dataEvento)
        throw new TRPCError({ code: "BAD_REQUEST", message: `⛔ O prazo terminou: o último dia de pagamento era o dia do evento (${e.dataEvento.split("-").reverse().join("/")}). Sem quitação total o cliente NÃO entra.` });
      const valor = r2(input.valor);
      if (valor > saldoAntes + 0.009)
        throw new TRPCError({ code: "BAD_REQUEST", message: `O valor (${valor.toFixed(2)}) é maior que o saldo em falta (${saldoAntes.toFixed(2)}).` });
      const pagoTotal = r2((b.valorPago ?? 0) + valor);
      const quitado = pagoTotal >= b.valor - 0.009;
      await db.update(eventoBilhetes).set({ valorPago: quitado ? b.valor : pagoTotal })
        .where(eq(eventoBilhetes.id, b.id));
      const cod = await nextCodigo("pagamento", "PG-");
      await db.insert(pagamentos).values({
        codigo: cod, tipoVenda: `Bilhete ${e.codigo} — ${e.nome} · ${b.codigo}`,
        cliente: b.nomePessoa, valor, metodo: input.metodo,
      });
      return { ok: true, codigo: b.codigo, pagoTotal: quitado ? b.valor : pagoTotal, saldo: quitado ? 0 : r2(b.valor - pagoTotal), quitado };
    }),

  /** Corrigir o TITULAR (nome/telefone) de um bilhete pago — só Admin ou autorizado por ele.
      O nome do cliente no Financeiro (pagamentos) acompanha a correcção. */
  editarBilhete: publicQuery
    .input(z.object({
      usuarioId: z.number().int().positive(),
      bilheteId: z.number().int().positive(),
      nomePessoa: z.string().min(2).max(160),
      telefone: z.string().max(40).optional(),
    }))
    .mutation(async ({ input }) => {
      const u = await requirePerfilEv(input.usuarioId, VENDE);
      if (u.perfil !== "Admin" && !(u as { podeEditarNomes?: boolean | null }).podeEditarNomes)
        throw new TRPCError({ code: "FORBIDDEN", message: "🔒 Só o Administrador (ou alguém autorizado por ele em ⚙️ Configurações) pode corrigir o nome do titular de um bilhete." });
      const db = getDb();
      const b = await db.query.eventoBilhetes.findFirst({ where: eq(eventoBilhetes.id, input.bilheteId) });
      if (!b || b.status !== "Pago")
        throw new TRPCError({ code: "BAD_REQUEST", message: "Bilhete não encontrado ou já anulado." });
      const nomeAntigo = b.nomePessoa;
      const nomeNovo = input.nomePessoa.trim();
      await db.update(eventoBilhetes)
        .set({ nomePessoa: nomeNovo, telefone: input.telefone?.trim() || null })
        .where(eq(eventoBilhetes.id, b.id));
      // o Financeiro regista o cliente com o nome do bilhete — acompanha a correcção
      if (nomeNovo !== nomeAntigo) {
        const e = await db.query.eventos.findFirst({ where: eq(eventos.id, Number(b.eventoId)) });
        if (e) {
          await db.update(pagamentos).set({ cliente: nomeNovo })
            .where(and(
              eq(pagamentos.tipoVenda, `Bilhete ${e.codigo} — ${e.nome}`),
              eq(pagamentos.cliente, nomeAntigo),
              eq(pagamentos.valor, b.valor),
              sql`${pagamentos.status} != 'Anulado'`,
            ));
          // parcelas de prestações (tipoVenda com o código do bilhete)
          await db.update(pagamentos).set({ cliente: nomeNovo })
            .where(and(
              eq(pagamentos.tipoVenda, `Bilhete ${e.codigo} — ${e.nome} · ${b.codigo}`),
              eq(pagamentos.cliente, nomeAntigo),
              sql`${pagamentos.status} != 'Anulado'`,
            ));
        }
      }
      return { ok: true, codigo: b.codigo };
    }),

  /** Lista de entradas de um evento (Caixa: só as vendas dele) */
  bilhetes: publicQuery
    .input(z.object({
      usuarioId: z.number().int().positive(),
      eventoId: z.number().int().positive(),
    }))
    .query(async ({ input }) => {
      const u = await requirePerfilEv(input.usuarioId, VENDE);
      const db = getDb();
      const veTudo = VER_TUDO.includes(u.perfil);
      const bs = await db.select().from(eventoBilhetes)
        .where(eq(eventoBilhetes.eventoId, input.eventoId))
        .orderBy(desc(eventoBilhetes.criadoEm));
      const nomes = new Map<number, string>();
      const out = [];
      for (const b of bs) {
        if (!veTudo && Number(b.vendedorId) !== u.id) continue;
        if (!nomes.has(Number(b.vendedorId))) {
          const v = await db.query.usuarios.findFirst({ where: eq(usuarios.id, b.vendedorId) });
          nomes.set(Number(b.vendedorId), v?.nome ?? "—");
        }
        out.push({ ...b, vendedorNome: nomes.get(Number(b.vendedorId)) });
      }
      return { itens: out, veTudo };
    }),

  /** Anular um bilhete (gestão) — o pagamento fica anulado no Financeiro */
  anularBilhete: publicQuery
    .input(z.object({ usuarioId: z.number().int().positive(), bilheteId: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const u = await requirePerfilEv(input.usuarioId, VER_TUDO);
      const db = getDb();
      const b = await db.query.eventoBilhetes.findFirst({ where: eq(eventoBilhetes.id, input.bilheteId) });
      if (!b || b.status !== "Pago")
        throw new TRPCError({ code: "BAD_REQUEST", message: "Bilhete não encontrado ou já anulado." });
      await db.update(eventoBilhetes).set({ status: "Anulado", anuladoEm: new Date(), anuladoPor: u.nome })
        .where(eq(eventoBilhetes.id, b.id));
      const e = await db.query.eventos.findFirst({ where: eq(eventos.id, Number(b.eventoId)) });
      if (e) {
        await db.update(pagamentos).set({ status: "Anulado" })
          .where(and(
            eq(pagamentos.tipoVenda, `Bilhete ${e.codigo} — ${e.nome}`),
            eq(pagamentos.cliente, b.nomePessoa),
            eq(pagamentos.valor, b.valor),
            sql`${pagamentos.status} != 'Anulado'`,
          ));
        // prestações: estorna TODAS as parcelas deste bilhete (tipoVenda com o código dele)
        await db.update(pagamentos).set({ status: "Anulado" })
          .where(and(
            eq(pagamentos.tipoVenda, `Bilhete ${e.codigo} — ${e.nome} · ${b.codigo}`),
            sql`${pagamentos.status} != 'Anulado'`,
          ));
        // se estava esgotado e libertou lugar, reabre as vendas
        if (e.status === "Esgotado") {
          const st = await statsEvento(e.id, null);
          if (e.capacidade != null && st.vendidos < e.capacidade)
            await db.update(eventos).set({ status: "Aberto" }).where(eq(eventos.id, e.id));
        }
      }
      return { ok: true };
    }),

  /** VALIDAÇÃO À PORTA (scanner de código de barras): lê o código do bilhete,
      identifica o DONO e (se marcar=true e ainda não entrou) regista a entrada —
      um bilhete já usado ou anulado NÃO volta a entrar (anti-adulteração). */
  validarCodigo: publicQuery
    .input(z.object({
      usuarioId: z.number().int().positive(),
      codigo: z.string().min(3).max(20),
      marcar: z.boolean().default(true),
    }))
    .mutation(async ({ input }) => {
      const u = await requirePerfilEv(input.usuarioId, VENDE);
      const db = getDb();
      const cod = input.codigo.trim().toUpperCase();
      const b = await db.query.eventoBilhetes.findFirst({ where: eq(eventoBilhetes.codigo, cod) });
      if (!b)
        return { encontrado: false as const, codigo: cod };
      const e = await db.query.eventos.findFirst({ where: eq(eventos.id, Number(b.eventoId)) });
      const saldo = r2(Math.max(0, b.valor - (b.valorPago ?? b.valor)));
      const base = {
        encontrado: true as const, codigo: b.codigo, nomePessoa: b.nomePessoa, telefone: b.telefone,
        tipo: b.tipo, valor: b.valor, status: b.status,
        valorPago: r2(Math.min(b.valorPago ?? b.valor, b.valor)), saldo,
        evento: e?.nome ?? "—", dataEvento: e?.dataEvento ?? "", local: e?.local ?? null, horaInicio: e?.horaInicio ?? null,
        inclui: b.tipo === "VIP" ? e?.incluiVip ?? null : e?.incluiNormal ?? null,
        usadoEm: b.usadoEm ? b.usadoEm.toISOString() : null, usadoPor: b.usadoPor ?? null,
      };
      if (b.status === "Anulado")
        return { ...base, resultado: "anulado" as const };
      if (b.usadoEm)
        return { ...base, resultado: "ja_entrou" as const };
      // regra da casa: SEM o pagamento total, o cliente NÃO tem direito a entrada —
      // à porta não se aceita pagamento, o bilhete em prestações por quitar fica de fora
      if (saldo > 0.009)
        return { ...base, resultado: "por_pagar" as const };
      if (input.marcar) {
        await db.update(eventoBilhetes).set({ usadoEm: new Date(), usadoPor: u.nome })
          .where(eq(eventoBilhetes.id, b.id));
        return { ...base, resultado: "entrou" as const, usadoEm: new Date().toISOString(), usadoPor: u.nome };
      }
      return { ...base, resultado: "valido" as const };
    }),

  /** As MINHAS vendas de bilhetes (painel do Caixa) — hoje ou num dia */
  minhasVendas: publicQuery
    .input(z.object({ usuarioId: z.number().int().positive(), dataDia: z.string().length(10).optional() }))
    .query(async ({ input }) => {
      const u = await requirePerfilEv(input.usuarioId, VENDE);
      const db = getDb();
      const dia = input.dataDia ?? DIA();
      const bs = await db.select().from(eventoBilhetes)
        .where(and(eq(eventoBilhetes.vendedorId, u.id), eq(eventoBilhetes.dataDia, dia)));
      const pagos = bs.filter((b) => b.status === "Pago");
      return {
        dia, n: pagos.length, total: r2(pagos.reduce((a, b) => a + Math.min(b.valorPago ?? b.valor, b.valor), 0)),
      };
    }),
});
