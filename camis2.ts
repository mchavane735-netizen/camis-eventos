import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, gte, inArray, lte, ne, sql } from "drizzle-orm";
import { createRouter, publicQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { usuarios, produtos, pedidos, pedidoItens, pedidosOnline, reservas, pagamentos, stockMov, contadores } from "@db/schema";
import { afiliadoPorCodigo, leadProtegido, lancarComissao, estornarComissoes } from "./afiliados";
import { getEmpresa } from "./camis3";
import { abrirPedidoReservaOnline } from "./camis4";
import { ESPACOS_EVENTO, ESPACOS_COMISSAO_ALTA, espacosEmConflito, precoEspacoSemDecoracao, braaiTotal, braaiRotulo, taxaReservaPessoa, type BraaiModalidade, type BraaiTraz } from "@contracts/types";

const DIA = () => new Date(Date.now() + 2 * 3600e3).toISOString().slice(0, 10);

async function requirePerfil(userId: number, perfis: string[]) {
  const u = await getDb().query.usuarios.findFirst({ where: eq(usuarios.id, userId) });
  if (!u || !u.ativo) throw new TRPCError({ code: "UNAUTHORIZED", message: "Utilizador inválido" });
  if (!perfis.includes(u.perfil))
    throw new TRPCError({ code: "FORBIDDEN", message: "Ação reservada a: " + perfis.join(", ") });
  return u;
}

async function nextCodigo(chave: string, prefix: string) {
  const db = getDb();
  await db.insert(contadores).values({ chave, valor: 1 })
    .onDuplicateKeyUpdate({ set: { valor: sql`${contadores.valor} + 1` } });
  const c = await db.query.contadores.findFirst({ where: eq(contadores.chave, chave) });
  return prefix + String(c?.valor ?? 1).padStart(4, "0");
}

/* ============================================================
   RESERVAS
   ============================================================ */
export const reservasRouter = createRouter({
  list: publicQuery
    .input(z.object({ usuarioId: z.number().int().positive().optional() }).optional())
    .query(async ({ input }) => {
      // v17: vendedores veem apenas as PRÓXIMAS reservas; o histórico é da gestão
      let soFuturas = false;
      if (input?.usuarioId) {
        const u = await getDb().query.usuarios.findFirst({ where: eq(usuarios.id, input.usuarioId) });
        soFuturas = u?.perfil === "Vendedor";
      }
      return getDb().select().from(reservas)
        .where(soFuturas ? gte(reservas.dataConsumo, DIA()) : undefined)
        .orderBy(desc(reservas.criadoEm));
    }),

  create: publicQuery
    .input(z.object({
      usuarioId: z.number().int().positive(),
      cliente: z.string().min(2),
      contacto: z.string().max(60).optional(),
      dataConsumo: z.string().length(10),
      hora: z.string().max(5).optional(),
      area: z.string().min(2, "Seleccione onde o cliente pretende sentar").max(80),
      tipoEvento: z.string().min(2),
      tipoOutro: z.string().max(160).optional(),
      pessoas: z.number().int().min(0).default(0),
      pacoteId: z.number().int().positive().optional(),
      espaco: z.enum(ESPACOS_EVENTO).optional(),
      /* --- braai (cliente traz os seus produtos) --- */
      braai: z.boolean().optional(),
      braaiModalidade: z.enum(["A", "B"]).optional(),
      braaiTraz: z.enum(["Comida", "Bebidas"]).optional(),
      criancasMenores: z.number().int().min(0).max(200).default(0),
      adiantPct: z.number().min(0).max(100).default(50),
      adiantValor: z.number().min(0).optional(),
      desconto: z.number().min(0).optional(), // desconto combinado (MZN)
      condicoes: z.string().optional(),
      afiliadoCodigo: z.string().max(12).optional(),
      // data de ENTRADA (lançamento): a receita do adiantamento conta neste dia
      // (a reserva pode ser lançada hoje mas ter entrado ontem/antes de ontem)
      dataEntrada: z.string().length(10).optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      // taxa de reserva por pessoa: Salão primeiro andar = 500 MZN; outros espaços = 400 MZN
      const TAXA = taxaReservaPessoa(input.area);
      const emp = await getEmpresa();
      const espaco = input.espaco ?? null;
      const ehBraai = !!input.braai;
      // braai: validações específicas (hora de entrada obrigatória — a taxa dá direito a 5 horas)
      if (ehBraai) {
        if (!input.braaiModalidade)
          throw new TRPCError({ code: "BAD_REQUEST", message: "Indique a modalidade do braai (Completo ou Parcial)." });
        if (input.braaiModalidade === "B" && !input.braaiTraz)
          throw new TRPCError({ code: "BAD_REQUEST", message: "Indique o que o cliente traz: só comida ou só bebidas." });
        if (input.pessoas < 1)
          throw new TRPCError({ code: "BAD_REQUEST", message: "Indique o número de pessoas pagantes (a partir dos 10 anos)." });
        if (!input.hora)
          throw new TRPCError({ code: "BAD_REQUEST", message: "Indique a hora de entrada — a taxa de braai dá direito a 5 horas de uso do espaço." });
      }
      const querSalao = !ehBraai && (input.pacoteId != null || espaco != null);
      // reserva de salão/espaço EXIGE a indicação do espaço concreto
      if (querSalao && !espaco)
        throw new TRPCError({ code: "BAD_REQUEST", message: "Indique o salão/espaço que está a ser reservado (Salão Rés-do-chão, Salão primeiro andar, Área da piscina, Área do Jardim ou Todo o recinto)." });
      // bloqueio POR ESPAÇO na mesma data: só choca a reserva do mesmo espaço;
      // «Todo o recinto» choca com qualquer espaço (e vice-versa)
      const ocupadas = await db.select().from(reservas)
        .where(and(eq(reservas.dataConsumo, input.dataConsumo), inArray(reservas.status, ["Pendente", "Confirmada"])));
      const choque = querSalao
        ? ocupadas.find((r) => (r.pacoteNome != null || r.espaco != null || /sal[aã]o/i.test(r.tipo)) && espacosEmConflito(r.espaco, espaco))
        : undefined;
      if (choque)
        throw new TRPCError({
          code: "CONFLICT",
          message: `🔒 ${choque.espaco ?? "O salão"} já está reservado para ${input.dataConsumo} (${choque.codigo} — ${choque.cliente}, ${choque.status}). Consulte o calendário de datas livres.`,
        });
      // valor: pacote (com decoração) = preço do pacote; sem decoração = preço base do espaço;
      // reserva simples = nº de pessoas × taxa fixa (consumível no local)
      let pacoteNome: string | null = null;
      let valor: number;
      if (ehBraai) {
        // taxa de braai: NÃO consumível — pessoas pagantes (10+ anos) × taxa da modalidade
        valor = braaiTotal(input.braaiModalidade as BraaiModalidade, input.pessoas);
      } else if (input.pacoteId) {
        const pac = await db.query.produtos.findFirst({ where: eq(produtos.id, input.pacoteId) });
        if (!pac || pac.categoria !== "Salão")
          throw new TRPCError({ code: "NOT_FOUND", message: "Pacote de salão não encontrado" });
        pacoteNome = pac.nome.replace(/^Aluguer Sal[aã]o\s*-\s*/i, "");
        valor = Math.round(pac.preco * 100) / 100;
      } else if (espaco) {
        valor = precoEspacoSemDecoracao(emp, espaco);
        if (valor <= 0)
          throw new TRPCError({ code: "BAD_REQUEST", message: "O preço desse espaço não está configurado (Configurações → Espaços de evento)." });
      } else {
        if (input.pessoas < 1)
          throw new TRPCError({ code: "BAD_REQUEST", message: "Indique o número de pessoas/participantes" });
        valor = Math.round(input.pessoas * TAXA * 100) / 100;
      }
      // desconto combinado (MZN) — deduzido do valor antes do depósito
      const desconto = Math.min(valor, Math.max(0, Math.round((input.desconto ?? 0) * 100) / 100));
      valor = Math.round((valor - desconto) * 100) / 100;
      // depósito flexível: valor em MZN que o cliente consegue pagar (recomendado: 50%)
      let adiant: number;
      let adiantPct: number;
      if (input.adiantValor != null && input.adiantValor > 0) {
        adiant = Math.round(input.adiantValor * 100) / 100;
        // pagamento ACIMA do total: o total da reserva passa a ser o valor real que o
        // cliente entregou — o comprovativo sai com o que ele efectivamente pagou
        if (adiant > valor) valor = adiant;
        adiantPct = Math.min(100, Math.round((adiant / valor) * 100));
      } else {
        adiantPct = input.pacoteId ? input.adiantPct : 50;
        adiant = Math.round(valor * (adiantPct / 100) * 100) / 100;
      }
      // braai: no restaurante o adiantamento mínimo é 50% — o saldo é pago na entrada
      if (ehBraai && adiant < Math.round(valor * 0.5 * 100) / 100 - 0.01)
        throw new TRPCError({ code: "BAD_REQUEST", message: `A taxa de braai exige adiantamento mínimo de 50% (${Math.round(valor * 0.5 * 100) / 100} MZN). O saldo é pago na entrada, antes de ocupar o espaço.` });
      const codigo = await nextCodigo("reserva", "R-");
      const af = await afiliadoPorCodigo(input.afiliadoCodigo);
      // data de entrada: por defeito hoje; pode ser um dia ANTERIOR (lançamento em atraso) — nunca futura
      const hojeMZ2 = DIA();
      const dataEntrada = input.dataEntrada && input.dataEntrada <= hojeMZ2 ? input.dataEntrada : hojeMZ2;
      if (input.dataEntrada && input.dataEntrada > hojeMZ2)
        throw new TRPCError({ code: "BAD_REQUEST", message: "A data de entrada não pode ser futura." });
      await getDb().insert(reservas).values({
        codigo, cliente: input.cliente, contacto: input.contacto || null,
        dataReserva: dataEntrada, dataConsumo: input.dataConsumo, hora: input.hora || null, area: input.area,
        espaco: ehBraai ? null : espaco,
        tipo: ehBraai ? "Braai" : input.tipoEvento,
        tipoOutro: ehBraai
          ? braaiRotulo(input.braaiModalidade as BraaiModalidade, (input.braaiTraz ?? null) as BraaiTraz | null)
          : input.tipoEvento === "Outro" ? (input.tipoOutro || null) : null,
        pessoas: input.pessoas, servicos: null, pacoteNome,
        valor, desconto, adiantPct, adiant,
        saldo: Math.round((valor - adiant) * 100) / 100,
        condicoes: input.condicoes || null, usuarioId: input.usuarioId,
        afiliadoId: af?.id ?? null,
        braai: ehBraai,
        braaiModalidade: ehBraai ? input.braaiModalidade! : null,
        braaiTraz: ehBraai && input.braaiModalidade === "B" ? input.braaiTraz! : null,
        criancasMenores: ehBraai ? input.criancasMenores : 0,
        saldoPago: ehBraai ? adiant >= valor - 0.01 : false,
      });
      return { codigo };
    }),

  /** Reserva Buffet (vinda da loja online): o caixa/garçon abre o pedido no dia do consumo.
      O pedido POS nasce com o item do buffet pelo valor do SALDO (o adiantamento já entrou online)
      e aceita logo produtos adicionais (bebidas, sobremesas…) até ao fecho normal da conta. */
  abrirPedidoBuffet: publicQuery
    .input(z.object({ usuarioId: z.number().int().positive(), reservaId: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      await requirePerfil(input.usuarioId, ["Admin", "Gestor", "Vendedor"]);
      const db = getDb();
      const r = await db.query.reservas.findFirst({ where: eq(reservas.id, input.reservaId) });
      if (!r || r.tipo !== "Buffet")
        throw new TRPCError({ code: "BAD_REQUEST", message: "Esta reserva não é uma Reserva Buffet." });
      if (r.pedidoId)
        throw new TRPCError({ code: "BAD_REQUEST", message: "Esta reserva já tem um pedido aberto." });
      if (r.status === "Cancelada" || r.status === "Concluída")
        throw new TRPCError({ code: "BAD_REQUEST", message: `A reserva está ${r.status.toLowerCase()}.` });
      const hojeMZ = DIA();
      // Cliente chegou ANTES da data combinada: abre na mesma e a data do consumo passa a hoje
      if (r.dataConsumo > hojeMZ) {
        await db.update(reservas).set({
          condicoes: `${r.condicoes ? r.condicoes + " · " : ""}⏩ Consumo antecipado (estava marcado para ${r.dataConsumo.split("-").reverse().join("/")})`,
          dataConsumo: hojeMZ,
        }).where(eq(reservas.id, r.id));
      }

      const po = r.onlineId
        ? await db.query.pedidosOnline.findFirst({ where: eq(pedidosOnline.id, Number(r.onlineId)) })
        : null;
      const itens = ((po?.itens as Array<{ nome: string; qtd: number }> | null) ?? []);
      const itemBuf = itens.find((i) => i.nome.startsWith("🍽"));
      const saldo = Math.max(0, Math.round((r.saldo ?? (r.valor - r.adiant)) * 100) / 100);

      const [{ maxN }] = await db.select({ maxN: sql<number>`COALESCE(MAX(numero),0)` })
        .from(pedidos).where(eq(pedidos.dataDia, hojeMZ));
      const [{ id }] = await db.insert(pedidos).values({
        numero: maxN + 1, dataDia: hojeMZ,
        referencia: `Reserva Buffet ${r.codigo} — ${r.cliente} · adiantamento de ${r.adiant.toFixed(2)} MZN (${r.adiantPct}%) já recebido online`,
        reservaId: r.id, area: r.area || null,
        usuarioId: input.usuarioId, afiliadoId: r.afiliadoId ?? null,
      }).$returningId();
      // item do buffet cobra apenas o REMANESCENTE — o adiantamento já foi registado como receita online
      await db.insert(pedidoItens).values({
        pedidoId: id, produtoId: null,
        nome: `${itemBuf?.nome ?? `🍽 ${r.pacoteNome ?? "Buffet"} — ${r.pessoas} pessoas`} · REMANESCENTE (${r.adiantPct}% já adiantado)`,
        categoria: "Buffet", precoUnit: saldo, qtd: 1,
      });
      await db.update(pedidos).set({ subtotal: saldo, total: saldo }).where(eq(pedidos.id, id));
      await db.update(reservas).set({ pedidoId: id }).where(eq(reservas.id, r.id));
      // o acompanhamento online do cliente também avança («Confirmado»)
      if (po && po.status === "Aguarda Consumo") {
        try { await abrirPedidoReservaOnline(po.id, po.codigo, po.clienteTelefone, po.clienteNome); }
        catch (e) { console.error("[buffet] abrir acompanhamento online falhou:", (e as Error)?.message); }
      }
      return { ok: true, pedidoId: id, numero: maxN + 1, saldo };
    }),

  /** Reabre uma reserva CONCLUÍDA por engano — Admin sempre; Gerente só com
      permissão concedida pelo Admin (usuarios.podeReabrirReserva). NÃO cria
      pagamento nem comissão: apenas repõe o estado «Confirmada». */
  reabrirReserva: publicQuery
    .input(z.object({ usuarioId: z.number().int().positive(), id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const u = await db.query.usuarios.findFirst({ where: eq(usuarios.id, input.usuarioId) });
      const autorizado = !!u && u.ativo &&
        (u.perfil === "Admin" || (u.perfil === "Gestor" && !!(u as { podeReabrirReserva?: boolean | null }).podeReabrirReserva));
      if (!autorizado)
        throw new TRPCError({ code: "FORBIDDEN", message: "Só o Administrador — ou um Gerente com permissão concedida pelo Admin — pode reabrir uma reserva concluída." });
      const r = await db.query.reservas.findFirst({ where: eq(reservas.id, input.id) });
      if (!r) throw new TRPCError({ code: "NOT_FOUND", message: "Reserva não encontrada." });
      if (r.status !== "Concluída")
        throw new TRPCError({ code: "BAD_REQUEST", message: `Só é possível reabrir reservas CONCLUÍDAS (estado actual: ${r.status}).` });
      await db.update(reservas).set({
        status: "Confirmada",
        condicoes: `${r.condicoes ? r.condicoes + " · " : ""}↩️ Reaberta por ${u.nome} (estava concluída por engano)`,
      }).where(eq(reservas.id, input.id));
      return { ok: true };
    }),

  /** No dia do consumo, o caixa regista o SALDO EM FALTA da reserva (total ou parcial)
      antes de abrir o pedido. O valor entra como receita no Financeiro. */
  pagarSaldo: publicQuery
    .input(z.object({
      usuarioId: z.number().int().positive(),
      id: z.number().int().positive(),
      valor: z.number().positive("Indique o valor recebido"),
      metodo: z.string().max(24).default("Dinheiro"),
    }))
    .mutation(async ({ input }) => {
      await requirePerfil(input.usuarioId, ["Admin", "Gestor", "Vendedor"]);
      const db = getDb();
      const r = await db.query.reservas.findFirst({ where: eq(reservas.id, input.id) });
      if (!r) throw new TRPCError({ code: "NOT_FOUND", message: "Reserva não encontrada." });
      if (r.status === "Cancelada")
        throw new TRPCError({ code: "BAD_REQUEST", message: "A reserva está cancelada." });
      if (r.saldo <= 0)
        throw new TRPCError({ code: "BAD_REQUEST", message: "Esta reserva já está liquidada — não há saldo por cobrar." });
      const receber = Math.min(input.valor, r.saldo);
      const novoSaldo = Math.max(0, Math.round((r.saldo - receber) * 100) / 100);
      const cod = await nextCodigo("pagamento", "PG-");
      await db.insert(pagamentos).values({
        codigo: cod,
        tipoVenda: `Saldo ${r.codigo} — ${r.tipo}`,
        cliente: r.cliente,
        valor: receber, metodo: input.metodo,
      });
      await db.update(reservas).set({ saldo: novoSaldo, saldoPago: novoSaldo <= 0 }).where(eq(reservas.id, r.id));
      return { ok: true, recebido: receber, saldoRestante: novoSaldo };
    }),

  setStatus: publicQuery
    .input(z.object({
      id: z.number().int().positive(),
      status: z.enum(["Pendente", "Confirmada", "Concluída", "Cancelada"]),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await db.update(reservas).set({ status: input.status }).where(eq(reservas.id, input.id));
      if (input.status === "Confirmada") {
        const r = await db.query.reservas.findFirst({ where: eq(reservas.id, input.id) });
        if (r) {
          // protecção contra DUPLO CLIQUE: se já existe um adiantamento activo desta
          // reserva, não se cria outro (o estatuto muda na mesma — operação idempotente)
          const tvAdiant = r.braai ? `Braai ${r.codigo} — adiantamento` : `Adiantamento ${r.codigo}`;
          const jaPago = await db.query.pagamentos.findFirst({
            where: and(eq(pagamentos.tipoVenda, tvAdiant), ne(pagamentos.status, "Anulado")),
          });
          if (!jaPago) {
            const cod = await nextCodigo("pagamento", "PG-");
            // a receita conta na DATA DE ENTRADA da reserva (lançamento), não no dia da confirmação
            const quandoPg = new Date((r.dataReserva || DIA()) + "T12:00:00+02:00");
            await db.insert(pagamentos).values({
              codigo: cod,
              tipoVenda: tvAdiant,
              cliente: r.cliente,
              valor: r.adiant, metodo: "—",
              criadoEm: quandoPg,
            });
          }
          // comissão do afiliado — 1ª metade na confirmação (primeira prestação)
          if (r.afiliadoId) {
            const alta = r.pacoteNome != null
              || (r.espaco != null && ESPACOS_COMISSAO_ALTA.includes(r.espaco)); // 5% no aluguer do salão (com ou sem decoração); o resto = 3%
            const lead = await leadProtegido(r.afiliadoId, r.contacto);
            await lancarComissao({
              afiliadoId: r.afiliadoId, origem: "Reserva", origemId: r.id, origemRef: r.codigo,
              descricao: `Reserva ${r.codigo} — ${r.tipo}${r.pacoteNome ? " · " + r.pacoteNome : ""} — ${r.cliente}`,
              valorVenda: r.valor, alta, parcela: 1, leadId: lead?.id ?? null,
            });
          }
        }
      }
      if (input.status === "Cancelada") await estornarComissoes("Reserva", input.id);
      return { ok: true };
    }),

  /** Datas com o salão ocupado (para o calendário de datas livres) */
  datasOcupadas: publicQuery.query(async () => {
    const rows = await getDb().select({
      dataConsumo: reservas.dataConsumo, codigo: reservas.codigo,
      cliente: reservas.cliente, status: reservas.status, tipo: reservas.tipo,
      pacoteNome: reservas.pacoteNome, espaco: reservas.espaco,
    }).from(reservas)
      .where(and(gte(reservas.dataConsumo, DIA()), inArray(reservas.status, ["Pendente", "Confirmada"])));
    return rows.filter((r) => r.pacoteNome != null || r.espaco != null || /sal[aã]o/i.test(r.tipo));
  }),

  /** Lembretes de reserva: 1 dia antes e 3 horas antes da hora marcada (com contacto) */
  lembretes: publicQuery
    .input(z.object({ usuarioId: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      await requirePerfil(input.usuarioId, ["Admin", "Gestor", "Vendedor"]);
      const agora = new Date(Date.now() + 2 * 3600e3); // hora de Moçambique
      const hoje = agora.toISOString().slice(0, 10);
      const amanha = new Date(agora.getTime() + 86400e3).toISOString().slice(0, 10);
      const hmAgora = agora.toISOString().slice(11, 16);
      const em3h = new Date(agora.getTime() + 3 * 3600e3).toISOString().slice(11, 16);
      const act = await getDb().select().from(reservas)
        .where(inArray(reservas.status, ["Pendente", "Confirmada"]));
      const out: Array<{ id: number; codigo: string; cliente: string; contacto: string | null; dataConsumo: string; hora: string | null; tipo: string; quando: string }> = [];
      for (const r of act) {
        if (r.dataConsumo === amanha)
          out.push({ id: r.id, codigo: r.codigo, cliente: r.cliente, contacto: r.contacto, dataConsumo: r.dataConsumo, hora: r.hora, tipo: r.tipo, quando: `amanhã${r.hora ? ` às ${r.hora}` : ""}` });
        else if (r.dataConsumo === hoje && r.hora && r.hora > hmAgora && r.hora <= em3h)
          out.push({ id: r.id, codigo: r.codigo, cliente: r.cliente, contacto: r.contacto, dataConsumo: r.dataConsumo, hora: r.hora, tipo: r.tipo, quando: `hoje às ${r.hora} (dentro de ~3 horas)` });
      }
      return out;
    }),

  /** Eliminar definitivamente uma reserva (apenas Admin — limpeza de testes) */
  eliminar: publicQuery
    .input(z.object({ usuarioId: z.number().int().positive(), id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      await requirePerfil(input.usuarioId, ["Admin"]);
      const db = getDb();
      const r = await db.query.reservas.findFirst({ where: eq(reservas.id, input.id) });
      if (!r) throw new TRPCError({ code: "NOT_FOUND", message: "Reserva não encontrada" });
      if (r.pedidoId)
        throw new TRPCError({ code: "BAD_REQUEST", message: "Esta reserva tem um pedido ligado. Elimine primeiro o pedido." });
      await db.delete(pagamentos).where(eq(pagamentos.tipoVenda, `Adiantamento ${r.codigo}`));
      await db.delete(pagamentos).where(eq(pagamentos.tipoVenda, `Braai ${r.codigo} — adiantamento`));
      await db.delete(pagamentos).where(eq(pagamentos.tipoVenda, `Braai ${r.codigo} — saldo (entrada)`));
      await db.delete(reservas).where(eq(reservas.id, r.id));
      return { ok: true };
    }),

  /* ---------- BRAAI: check-in na entrada (no dia do evento) ----------
     Confirma o que o cliente trouxe DE FACTO, recalcula a taxa se a realidade
     for diferente do declarado, e cobra o saldo ANTES de ocupar o espaço. */
  checkinBraai: publicQuery
    .input(z.object({
      usuarioId: z.number().int().positive(),
      id: z.number().int().positive(),
      trouxe: z.enum(["tudo", "comida", "bebidas"]), // confirmado na entrada
      pessoasPagantes: z.number().int().min(1).max(500),
      criancasMenores: z.number().int().min(0).max(200).default(0),
      valorPago: z.number().min(0), // saldo cobrado agora (0 se já estava pago)
      metodo: z.string().max(24).default("Dinheiro"),
    }))
    .mutation(async ({ input }) => {
      const u = await requirePerfil(input.usuarioId, ["Admin", "Gestor", "Vendedor"]);
      const db = getDb();
      const r = await db.query.reservas.findFirst({ where: eq(reservas.id, input.id) });
      if (!r || !r.braai) throw new TRPCError({ code: "NOT_FOUND", message: "Reserva de braai não encontrada" });
      if (r.status !== "Confirmada")
        throw new TRPCError({ code: "BAD_REQUEST", message: "O check-in só é possível em reservas confirmadas (adiantamento pago)." });
      if (r.checkinEm)
        throw new TRPCError({ code: "BAD_REQUEST", message: "O check-in desta reserva já foi feito." });
      const hojeMZ = DIA();
      // Cliente chegou ANTES da data combinada: o check-in é permitido e a data passa a hoje
      const antecipado = r.dataConsumo > hojeMZ;

      // realidade na entrada → modalidade efectiva (declarou parcial mas trouxe tudo = Completo)
      const modReal: BraaiModalidade = input.trouxe === "tudo" ? "A" : "B";
      const trazReal: BraaiTraz | null = modReal === "B" ? (input.trouxe === "comida" ? "Comida" : "Bebidas") : null;
      // o DESCONTO combinado na reserva mantém-se no check-in — o cliente não perde o benefício
      const valorNovo = Math.max(0, Math.round((braaiTotal(modReal, input.pessoasPagantes) - (r.desconto ?? 0)) * 100) / 100);
      const valorAnt = r.valor;
      const pagoAntes = r.adiant; // adiantamento já cobrado
      const saldoDevido = Math.max(0, Math.round((valorNovo - pagoAntes) * 100) / 100);
      if (valorNovo > valorAnt + 0.01 && input.valorPago < saldoDevido - 0.01)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `A realidade na entrada mudou a taxa (${braaiRotulo(modReal, trazReal)}, ${input.pessoasPagantes} pagantes = ${valorNovo} MZN). Saldo a cobrar agora: ${saldoDevido} MZN.`,
        });
      if (input.valorPago < saldoDevido - 0.01)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `O saldo (${saldoDevido} MZN) é pago NA ENTRADA, antes de o cliente ocupar o espaço.`,
        });

      if (input.valorPago > 0) {
        const cod = await nextCodigo("pagamento", "PG-");
        await db.insert(pagamentos).values({
          codigo: cod, tipoVenda: `Braai ${r.codigo} — saldo (entrada)`, cliente: r.cliente,
          valor: Math.round(input.valorPago * 100) / 100, metodo: input.metodo,
        });
      }
      const mudou = modReal !== r.braaiModalidade || input.pessoasPagantes !== r.pessoas;
      await db.update(reservas).set({
        ...(antecipado ? { dataConsumo: hojeMZ } : {}),
        braaiModalidade: modReal, braaiTraz: trazReal,
        tipoOutro: braaiRotulo(modReal, trazReal),
        pessoas: input.pessoasPagantes, criancasMenores: input.criancasMenores,
        valor: valorNovo,
        saldo: Math.max(0, Math.round((valorNovo - pagoAntes - input.valorPago) * 100) / 100),
        saldoPago: true,
        checkinEm: new Date(), checkinPor: u.nome,
        checkinObs: `${antecipado ? `⏩ ANTECIPADO (estava marcado para ${r.dataConsumo.split("-").reverse().join("/")}) — ` : ""}${mudou ? "AJUSTADO na entrada — " : ""}Trouxe: ${input.trouxe === "tudo" ? "comida e bebidas" : input.trouxe === "comida" ? "só comida" : "só bebidas"} · ${input.pessoasPagantes} pagantes (10+ anos) · ${input.criancasMenores} crianças até 9 anos`,
      }).where(eq(reservas.id, r.id));
      return { ok: true, valorNovo, mudou };
    }),
});
/** Stock: Admin e Logística sempre; Gestor só com autorização do Admin (podeEditarStock) */
async function requireStock(userId: number) {
  const db = getDb();
  const u = await db.query.usuarios.findFirst({ where: eq(usuarios.id, userId) });
  const ok = !!u && u.ativo && (u.perfil === "Admin" || u.perfil === "Logistica"
    || (u.perfil === "Gestor" && !!(u as { podeEditarStock?: boolean | null }).podeEditarStock));
  if (!ok)
    throw new TRPCError({ code: "FORBIDDEN", message: "Editar o stock exige autorização do Administrador. Peça ao Admin para activar «Pode editar o stock» no seu utilizador (⚙️ Configurações)." });
  return u;
}

export const stockRouter = createRouter({
  entrada: publicQuery
    .input(z.object({
      usuarioId: z.number().int().positive(),
      produtoId: z.number().int().positive(),
      qtd: z.number().min(0.25), // aceita decimais (kg) e fracções
      obs: z.string().max(255).optional(),
    }))
    .mutation(async ({ input }) => {
      // v28: Gestor só edita stock com autorização do Admin
      await requireStock(input.usuarioId);
      const db = getDb();
      const prod = await db.query.produtos.findFirst({ where: eq(produtos.id, input.produtoId) });
      if (!prod) throw new TRPCError({ code: "NOT_FOUND", message: "Produto não encontrado" });
      // produtos fraccionados (1/4, 1/2) partilham o stock do produto "mãe":
      // a entrada é convertida para a unidade inteira (ex.: 4× "1/4 Frango" = 1 frango)
      const alvo = prod.estoqueRefId ?? prod.id;
      const delta = Math.round(input.qtd * (prod.fraccao ?? 1) * 10000) / 10000;
      await db.update(produtos)
        .set({ estoqueAtual: sql`${produtos.estoqueAtual} + ${delta}` })
        .where(eq(produtos.id, alvo));
      await db.insert(stockMov).values({
        produtoId: input.produtoId, qtd: input.qtd, tipo: "entrada",
        obs: (input.obs || "") + (prod.estoqueRefId ? ` (= ${delta} un. de «${(await db.query.produtos.findFirst({ where: eq(produtos.id, alvo) }))?.nome ?? alvo}»)` : "") || null,
        usuarioId: input.usuarioId,
      });
      return { ok: true };
    }),

  /** Definir a quantidade em stock com um VALOR ABSOLUTO (ajuste de inventário) —
      em vez de somar, substitui a quantidade actual (ex.: contagem física no fim do dia) */
  ajustar: publicQuery
    .input(z.object({
      usuarioId: z.number().int().positive(),
      produtoId: z.number().int().positive(),
      novaQtd: z.number().min(0), // quantidade real contada (valor absoluto)
      obs: z.string().max(255).optional(),
    }))
    .mutation(async ({ input }) => {
      // v28: Gestor só edita stock com autorização do Admin
      await requireStock(input.usuarioId);
      const db = getDb();
      const prod = await db.query.produtos.findFirst({ where: eq(produtos.id, input.produtoId) });
      if (!prod) throw new TRPCError({ code: "NOT_FOUND", message: "Produto não encontrado" });
      const alvo = prod.estoqueRefId ?? prod.id;
      const alvoProd = prod.estoqueRefId
        ? await db.query.produtos.findFirst({ where: eq(produtos.id, alvo) })
        : prod;
      if (!alvoProd) throw new TRPCError({ code: "NOT_FOUND", message: "Produto de stock não encontrado" });
      // produtos fraccionados: a quantidade definida é convertida para a unidade inteira do "mãe"
      const novaNoAlvo = Math.round(input.novaQtd * (prod.fraccao ?? 1) * 10000) / 10000;
      const antes = alvoProd.estoqueAtual ?? 0;
      const delta = Math.round((novaNoAlvo - antes) * 10000) / 10000;
      await db.update(produtos).set({ estoqueAtual: novaNoAlvo }).where(eq(produtos.id, alvo));
      await db.insert(stockMov).values({
        produtoId: input.produtoId, qtd: Math.abs(delta), tipo: "ajuste",
        obs: `Ajuste de inventário: ${antes} → ${novaNoAlvo}${input.obs ? " — " + input.obs : ""}${prod.estoqueRefId ? ` (em «${alvoProd.nome}»)` : ""}`,
        usuarioId: input.usuarioId,
      });
      return { ok: true, antes, depois: novaNoAlvo };
    }),

  /** SAÍDA PARA PRODUÇÃO (bar de cocktails, cozinha): um produto aberto para
      produzir (ex.: 1L de sumo Compal p/ cocktails) já não pode ser vendido inteiro —
      sai do stock NA HORA como consumo de produção. NÃO é venda: não gera receita nem
      pagamento, mas fica registado no histórico de inventário como «Produção».
      Aberto a quem opera o balcão/cozinha (Vendedor, Cozinha) e à gestão. */
  saidaProducao: publicQuery
    .input(z.object({
      usuarioId: z.number().int().positive(),
      produtoId: z.number().int().positive(),
      qtd: z.number().min(0.25), // 1 garrafa/pacote aberto já conta; decimais para kg
      obs: z.string().max(255).optional(),
    }))
    .mutation(async ({ input }) => {
      await requirePerfil(input.usuarioId, ["Admin", "Gestor", "Logistica", "Vendedor", "Cozinha"]);
      const db = getDb();
      const prod = await db.query.produtos.findFirst({ where: eq(produtos.id, input.produtoId) });
      if (!prod) throw new TRPCError({ code: "NOT_FOUND", message: "Produto não encontrado" });
      if (prod.tipo === "Serviço")
        throw new TRPCError({ code: "BAD_REQUEST", message: "Serviços não têm stock." });
      const alvo = prod.estoqueRefId ?? prod.id;
      const delta = Math.round(input.qtd * (prod.fraccao ?? 1) * 10000) / 10000;
      const alvoProd = prod.estoqueRefId
        ? await db.query.produtos.findFirst({ where: eq(produtos.id, alvo) })
        : prod;
      if (!alvoProd) throw new TRPCError({ code: "NOT_FOUND", message: "Produto de stock não encontrado" });
      if ((alvoProd.estoqueAtual ?? 0) < delta - 0.0001)
        throw new TRPCError({ code: "BAD_REQUEST", message: `Stock insuficiente: só ${alvoProd.estoqueAtual} un. de «${alvoProd.nome}».` });
      await db.update(produtos)
        .set({ estoqueAtual: sql`${produtos.estoqueAtual} - ${delta}` })
        .where(eq(produtos.id, alvo));
      await db.insert(stockMov).values({
        produtoId: input.produtoId, qtd: input.qtd, tipo: "saida",
        obs: `Produção${input.obs ? ": " + input.obs.trim() : " (bar/cozinha)"}${prod.estoqueRefId ? ` (= ${delta} un. de «${alvoProd.nome}»)` : ""}`,
        usuarioId: input.usuarioId,
      });
      return { ok: true, ficou: Math.round(((alvoProd.estoqueAtual ?? 0) - delta) * 10000) / 10000 };
    }),

  movimentos: publicQuery.query(async () => {
    const db = getDb();
    const movs = await db.select().from(stockMov).orderBy(desc(stockMov.criadoEm)).limit(30);
    return Promise.all(movs.map(async (m) => {
      const p = await db.query.produtos.findFirst({ where: eq(produtos.id, m.produtoId) });
      const u = await db.query.usuarios.findFirst({ where: eq(usuarios.id, m.usuarioId) });
      return { ...m, produtoNome: p?.nome ?? "—", usuarioNome: u?.nome ?? "—" };
    }));
  }),

  /** Relatório de inventário por período — para a contagem física:
      o que saiu (vendas de balcão pedido a pedido, online, reservas e consumo da
      gerência), quem vendeu/registou, quando, e todas as entradas, compras,
      reposições e ajustes de stock. Reservado a Admin, Gestor e Logística. */
  relatorioPeriodo: publicQuery
    .input(z.object({
      usuarioId: z.number().int().positive(),
      de: z.string().length(10),
      ate: z.string().length(10),
    }))
    .query(async ({ input }) => {
      const db = getDb();
      const u = await db.query.usuarios.findFirst({ where: eq(usuarios.id, input.usuarioId) });
      if (!u || !u.ativo || !["Admin", "Gestor", "Logistica"].includes(u.perfil))
        throw new TRPCError({ code: "FORBIDDEN", message: "O histórico de inventário é reservado à gerência, à logística e ao administrador." });

      type TipoLinha = "Venda" | "Venda online" | "Reserva" | "Consumo gerência" | "Produção"
        | "Entrada" | "Compra" | "Reposição" | "Ajuste de inventário" | "Saída";
      type Linha = {
        chave: string; data: string; hora: string; produto: string; qtd: number;
        valor: number | null; tipo: TipoLinha; quem: string; ref: string;
      };
      const linhas: Linha[] = [];
      // chave de agregação: id do produto (ou «nome:…» para itens personalizados)
      const resumo = new Map<string, {
        produto: string; vendido: number; valorVendido: number; online: number;
        gerencia: number; producao: number; entradas: number; compras: number; reposicoes: number;
        ajustes: number; stockAtual: number | null;
      }>();
      const acc = (chave: string, produto: string) => {
        let r = resumo.get(chave);
        if (!r) {
          r = { produto, vendido: 0, valorVendido: 0, online: 0, gerencia: 0, producao: 0, entradas: 0, compras: 0, reposicoes: 0, ajustes: 0, stockAtual: null };
          resumo.set(chave, r);
        }
        return r;
      };

      /* 1) Saídas por VENDA de balcão — uma linha por produto de cada pedido fechado,
            em unidades de venda reais e com o nome de quem fechou a conta */
      const vendas = await db.select().from(pedidos).where(
        and(eq(pedidos.status, "Fechado"), gte(pedidos.dataDia, input.de), lte(pedidos.dataDia, input.ate)),
      );
      if (vendas.length) {
        const itens = await db.select().from(pedidoItens).where(inArray(pedidoItens.pedidoId, vendas.map((v) => v.id)));
        const mapa = new Map(vendas.map((v) => [v.id, v]));
        for (const it of itens) {
          const v = mapa.get(it.pedidoId);
          if (!v) continue;
          // a hora só faz sentido quando o fecho foi no próprio dia (vendas atrasadas
          // entram com a DATA do lançamento, mas a hora real é a de hoje)
          const mzFecho = v.fechadoEm ? new Date(v.fechadoEm.getTime() + 2 * 3600e3).toISOString() : null;
          linhas.push({
            chave: it.produtoId != null ? String(it.produtoId) : `nome:${it.nome}`,
            data: v.dataDia,
            hora: mzFecho && mzFecho.slice(0, 10) === v.dataDia ? mzFecho.slice(11, 16) : "",
            produto: it.nome, qtd: it.qtd,
            valor: Math.round(it.qtd * it.precoUnit * 100) / 100,
            tipo: "Venda", quem: v.fechadoPor ?? "—",
            ref: `Pedido nº ${v.numero}${v.referencia ? ` · ${v.referencia}` : ""}`,
          });
          const r = acc(it.produtoId != null ? String(it.produtoId) : `nome:${it.nome}`, it.nome);
          r.vendido += it.qtd;
          r.valorVendido += Math.round(it.qtd * it.precoUnit * 100) / 100;
        }
      }

      /* 2) Movimentos de stock no período (datas em horário de Maputo) — entradas,
            compras, ajustes, reposições, consumo da gerência e vendas online/reservas.
            As vendas de balcão («Pedido nº …») já entraram acima com mais detalhe,
            por isso ficam de fora para não duplicar. */
      const movs = await db.select().from(stockMov)
        .where(sql`DATE(${stockMov.criadoEm} + INTERVAL 2 HOUR) BETWEEN ${input.de} AND ${input.ate}`)
        .orderBy(desc(stockMov.criadoEm)).limit(2000);
      const prods = new Map(
        (await db.select({ id: produtos.id, nome: produtos.nome, estoqueAtual: produtos.estoqueAtual }).from(produtos))
          .map((p) => [p.id, p]),
      );
      const nomes = new Map(
        (await db.select({ id: usuarios.id, nome: usuarios.nome }).from(usuarios)).map((x) => [x.id, x.nome]),
      );
      for (const m of movs) {
        const obs = m.obs ?? "";
        if (m.tipo === "saida" && obs.startsWith("Pedido nº")) continue; // já está no bloco 1
        const mz = new Date(m.criadoEm.getTime() + 2 * 3600e3).toISOString();
        const tipo: TipoLinha =
          m.tipo === "ajuste" ? "Ajuste de inventário"
          : m.tipo === "saida"
            ? (obs.startsWith("Gerência") ? "Consumo gerência"
              : obs.startsWith("Produção") ? "Produção"
              : obs.startsWith("Online") ? "Venda online"
              : obs.startsWith("Reserva") ? "Reserva" : "Saída")
          : obs.startsWith("Compra") ? "Compra"
          : (obs.startsWith("Reabertura") || obs.startsWith("Cancelamento") || obs.includes("(cancelado)")) ? "Reposição"
          : "Entrada";
        const produto = prods.get(m.produtoId)?.nome ?? "—";
        linhas.push({
          chave: String(m.produtoId),
          data: mz.slice(0, 10), hora: mz.slice(11, 16),
          produto, qtd: m.qtd, valor: null,
          tipo, quem: nomes.get(m.usuarioId) ?? "—", ref: obs,
        });
        const r = acc(String(m.produtoId), produto);
        if (tipo === "Venda online" || tipo === "Reserva" || tipo === "Saída") r.online += m.qtd;
        else if (tipo === "Produção") r.producao += m.qtd;
        else if (tipo === "Consumo gerência") r.gerencia += m.qtd;
        else if (tipo === "Compra") r.compras += m.qtd;
        else if (tipo === "Reposição") r.reposicoes += m.qtd;
        else if (tipo === "Ajuste de inventário") r.ajustes += 1;
        else r.entradas += m.qtd;
      }

      // stock actual só para produtos reais (itens personalizados não têm stock)
      for (const [chave, r] of resumo) {
        if (!chave.startsWith("nome:")) r.stockAtual = prods.get(Number(chave))?.estoqueAtual ?? null;
      }

      linhas.sort((a, b) => (b.data + "T" + (b.hora || "99")).localeCompare(a.data + "T" + (a.hora || "99")));
      return {
        geradoEm: new Date(),
        resumo: [...resumo.values()].sort((a, b) => (b.vendido + b.online) - (a.vendido + a.online)),
        linhas: linhas.slice(0, 1500),
      };
    }),
});

/* ============================================================
   PAGAMENTOS
   ============================================================ */
export const pagamentosRouter = createRouter({
  list: publicQuery
    .input(z.object({ usuarioId: z.number().int().positive().optional() }).optional())
    .query(async ({ input }) => {
      // v17: a página de pagamentos é reservada à gestão — vendedores não têm acesso
      if (input?.usuarioId) {
        const u = await getDb().query.usuarios.findFirst({ where: eq(usuarios.id, input.usuarioId) });
        if (u && !["Admin", "Gestor"].includes(u.perfil))
          throw new TRPCError({ code: "FORBIDDEN", message: "A página de Pagamentos é reservada à gerência e ao administrador." });
      }
      return getDb().select().from(pagamentos).orderBy(desc(pagamentos.criadoEm)).limit(300);
    }),

  /** Eliminar um registo de pagamento (apenas Admin — limpeza de testes) */
  eliminar: publicQuery
    .input(z.object({ usuarioId: z.number().int().positive(), id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      await requirePerfil(input.usuarioId, ["Admin"]);
      await getDb().delete(pagamentos).where(eq(pagamentos.id, input.id));
      return { ok: true };
    }),
});

/* ============================================================
   DASHBOARD & RELATÓRIOS
   ============================================================ */
export const dashboardRouter = createRouter({
  stats: publicQuery
    .input(z.object({ usuarioId: z.number().int().positive().optional() }).optional())
    .query(async ({ input }) => {
    const db = getDb();
    const dia = DIA();
    const mes = dia.slice(0, 7);

    // v17: vendedores veem apenas as PRÓPRIAS vendas no painel
    let soMinhas: number | null = null;
    if (input?.usuarioId) {
      const u = await db.query.usuarios.findFirst({ where: eq(usuarios.id, input.usuarioId) });
      if (u?.perfil === "Vendedor") soMinhas = u.id;
    }
    const filtroVend = soMinhas != null ? eq(pedidos.usuarioId, soMinhas) : undefined;

    const fechadosHoje = await db.select().from(pedidos)
      .where(and(eq(pedidos.dataDia, dia), eq(pedidos.status, "Fechado"), filtroVend));
    // fiado: o valor ficado a dever não é receita — só entra quando for pago (Financeiro)
    const totHoje = fechadosHoje.reduce((a, p) => a + p.total - (p.dividaGerada ?? 0), 0);

    const fechadosMes = await db.select({ total: pedidos.total, dividaGerada: pedidos.dividaGerada }).from(pedidos)
      .where(and(gte(pedidos.dataDia, mes + "-01"), eq(pedidos.status, "Fechado"), filtroVend));
    const totMes = fechadosMes.reduce((a, p) => a + p.total - (p.dividaGerada ?? 0), 0);

    const resAtivas = await db.select({ id: reservas.id }).from(reservas)
      .where(sql`${reservas.status} IN ('Pendente','Confirmada')`);

    const proxReservas = await db.select().from(reservas)
      .where(and(gte(reservas.dataConsumo, dia), sql`${reservas.status} IN ('Pendente','Confirmada')`))
      .orderBy(reservas.dataConsumo).limit(7);

    const prods = await db.select().from(produtos).where(eq(produtos.ativo, true));
    const stockBaixo = prods.filter((p) => p.tipo !== "Serviço" && p.estoqueAtual <= p.estoqueMin).length;

    const abertos = await db.select({ id: pedidos.id }).from(pedidos)
      .where(and(eq(pedidos.status, "Aberto"), ...(filtroVend ? [filtroVend] : [])));

    // top 5 produtos (todos os tempos; do próprio vendedor quando aplicável)
    const itens = soMinhas != null
      ? await db.select().from(pedidoItens).where(sql`${pedidoItens.pedidoId} IN (SELECT id FROM pedidos WHERE usuario_id = ${soMinhas} AND status = 'Fechado')`)
      : await db.select().from(pedidoItens);
    const conta = new Map<string, { nome: string; cat: string; qtd: number; tot: number }>();
    for (const it of itens) {
      const c = conta.get(it.nome) ?? { nome: it.nome, cat: it.categoria, qtd: 0, tot: 0 };
      c.qtd += it.qtd; c.tot += it.qtd * it.precoUnit;
      conta.set(it.nome, c);
    }
    const top5 = [...conta.values()].sort((a, b) => b.qtd - a.qtd).slice(0, 5);

    return {
      totHoje, transHoje: fechadosHoje.length, totMes,
      reservasAtivas: resAtivas.length, stockBaixo,
      pedidosAbertos: abertos.length, top5, proxReservas,
    };
  }),
});

export const relatoriosRouter = createRouter({
  resumo: publicQuery
    .input(z.object({ de: z.string().length(10), ate: z.string().length(10), usuarioId: z.number().int().positive().optional() }))
    .query(async ({ input }) => {
      const db = getDb();
      // v17: vendedores veem apenas o relatório das PRÓPRIAS vendas
      let filtroVend;
      if (input.usuarioId) {
        const u = await db.query.usuarios.findFirst({ where: eq(usuarios.id, input.usuarioId) });
        if (u?.perfil === "Vendedor") filtroVend = eq(pedidos.usuarioId, u.id);
      }
      const vendas = await db.select().from(pedidos).where(
        and(eq(pedidos.status, "Fechado"), gte(pedidos.dataDia, input.de), lte(pedidos.dataDia, input.ate), filtroVend),
      );

      const totV = vendas.reduce((a, v) => a + v.total - (v.dividaGerada ?? 0), 0); // fiado não é receita
      const porMetodo = new Map<string, number>();
      for (const v of vendas) porMetodo.set(v.metodo ?? "—", (porMetodo.get(v.metodo ?? "—") ?? 0) + v.total);

      // detalhe por item (para CSV e top produto)
      const ids = vendas.map((v) => v.id);
      let itensDet: Array<typeof pedidoItens.$inferSelect & { dataDia: string; numero: number; metodo: string | null; desconto: number; totalPedido: number }> = [];
      if (ids.length) {
        const itens = await db.select().from(pedidoItens).where(sql`${pedidoItens.pedidoId} IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`);
        const mapa = new Map(vendas.map((v) => [v.id, v]));
        itensDet = itens.map((it) => {
          const v = mapa.get(it.pedidoId)!;
          return { ...it, dataDia: v.dataDia, numero: v.numero, metodo: v.metodo, desconto: v.desconto, totalPedido: v.total };
        });
      }
      const conta = new Map<string, number>();
      for (const it of itensDet) conta.set(it.nome, (conta.get(it.nome) ?? 0) + it.qtd);
      const top = [...conta.entries()].sort((a, b) => b[1] - a[1])[0] ?? null;

      // vendas por dia (para o gráfico Hoje/Semana/Mês/Tudo)
      const porDiaMap = new Map<string, number>();
      for (const v of vendas) porDiaMap.set(v.dataDia, (porDiaMap.get(v.dataDia) ?? 0) + v.total);
      const porDia = [...porDiaMap.entries()].map(([dia, total]) => ({ dia, total })).sort((a, b) => a.dia.localeCompare(b.dia));

      return {
        totGeral: totV, totVendas: totV,
        nVendas: vendas.length,
        ticketMedio: vendas.length ? totV / vendas.length : 0,
        porMetodo: [...porMetodo.entries()].map(([metodo, total]) => ({ metodo, total })).sort((a, b) => b.total - a.total),
        topProduto: top ? { nome: top[0], qtd: top[1] } : null,
        porDia,
        itens: itensDet,
      };
    }),
});
