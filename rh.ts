/* ============================================================
   RECURSOS HUMANOS (v23) — acesso EXCLUSIVO do Administrador
   · Trabalhadores (Permanente / Eventual / Afiliado) — áreas: Restaurante & Decoração
   · Presenças diárias com justificativa de ausências
   · Licenças anuais, periódicas e outras (com motivo)
   · Salários: pagos no dia do mês da entrada; eventual = dias presentes × diária (500 MZN)
   · Alertas de pagamento (5, 3 e 1 dias antes + atrasos)
   ============================================================ */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { createRouter, publicQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { usuarios, contadores, trabalhadores, rhPresencas, rhLicencas, rhSalarioPagamentos, afiliadoComissoes } from "@db/schema";

async function requireAdmin(userId: number) {
  const u = await getDb().query.usuarios.findFirst({ where: eq(usuarios.id, userId) });
  if (!u || !u.ativo) throw new TRPCError({ code: "UNAUTHORIZED", message: "Utilizador inválido" });
  if (u.perfil !== "Admin" && u.perfil !== "RH") throw new TRPCError({ code: "FORBIDDEN", message: "Página exclusiva do Administrador" });
  return u;
}

const MZ = 2 * 3600e3; // horário de Moçambique (UTC+2)
const hojeMz = () => new Date(Date.now() + MZ).toISOString().slice(0, 10);
const mesMz = () => hojeMz().slice(0, 7);

async function nextCodigoTrabalhador(): Promise<string> {
  const db = getDb();
  await db.insert(contadores).values({ chave: "trabalhador", valor: 1 })
    .onDuplicateKeyUpdate({ set: { valor: sql`${contadores.valor} + 1` } });
  const c = await db.query.contadores.findFirst({ where: eq(contadores.chave, "trabalhador") });
  return "TRB-" + String(c?.valor ?? 1).padStart(4, "0");
}

/** meses "YYYY-MM" desde o início até ao mês corrente (inclusive) */
function mesesDesde(inicio: string): string[] {
  const out: string[] = [];
  let [a, m] = inicio.slice(0, 7).split("-").map(Number);
  const [ha, hm] = mesMz().split("-").map(Number);
  while (a < ha || (a === ha && m <= hm)) {
    out.push(`${a}-${String(m).padStart(2, "0")}`);
    m++; if (m > 12) { m = 1; a++; }
  }
  return out;
}

/** o salário é pago no dia do mês em que o trabalhador entrou (ex.: entrou a 15 → dia 15 de cada mês) */
function dataPagamentoDoMes(mes: string, diaEntrada: number): string {
  const [a, m] = mes.split("-").map(Number);
  const ultimo = new Date(a, m, 0).getDate();
  return `${mes}-${String(Math.min(diaEntrada, ultimo)).padStart(2, "0")}`;
}

export const rhRouter = createRouter({
  /** Painel completo: trabalhadores + presenças + licenças + salários + alertas */
  painel: publicQuery
    .input(z.object({ usuarioId: z.number().int().positive() }))
    .query(async ({ input }) => {
      await requireAdmin(input.usuarioId);
      const db = getDb();
      const trs = await db.select().from(trabalhadores).orderBy(asc(trabalhadores.nome));
      const pres = await db.select().from(rhPresencas);
      const lics = await db.select().from(rhLicencas).orderBy(asc(rhLicencas.inicio));
      const pags = await db.select().from(rhSalarioPagamentos);
      const hoje = hojeMz();
      const mesActual = mesMz();

      const out = [] as Array<any>;
      for (const t of trs) {
        const presT = pres.filter((p) => Number(p.trabalhadorId) === t.id);
        const licT = lics.filter((l) => Number(l.trabalhadorId) === t.id);
        const pagT = pags.filter((p) => Number(p.trabalhadorId) === t.id);
        const diaEntrada = parseInt(t.dataInicio.slice(8, 10)) || 1;

        const devidoMes = (mes: string) => {
          if (t.regime === "Permanente") return t.salarioMensal;
          const dias = presT.filter((p) => p.dataDia.startsWith(mes) && p.status === "Presente").length;
          return dias * t.diaria;
        };
        const pagoMes = (mes: string) => pagT.filter((p) => p.mesReferencia === mes).reduce((s, p) => s + p.valor, 0);

        const meses = mesesDesde(t.dataInicio);
        const mesesPagos: string[] = [];
        const mesesEmAtraso: string[] = [];
        for (const mes of meses) {
          const devido = devidoMes(mes);
          const pago = pagoMes(mes);
          if (pago >= devido - 0.009 && (devido > 0 || pago > 0)) { mesesPagos.push(mes); continue; }
          // REGRA DA EMPRESA: o salário do mês M é pago no mês M+1 (ex.: Setembro
          // paga-se em Outubro). Por isso, o MÊS CORRENTE nunca está em atraso —
          // só entram meses ANTERIORES ao actual por pagar.
          if (mes >= mesActual) continue;
          if (devido > 0 || t.regime === "Permanente") mesesEmAtraso.push(mes);
        }

        // dias até ao próximo pagamento
        const pgActual = dataPagamentoDoMes(mesActual, diaEntrada);
        let prox = pgActual >= hoje ? pgActual : dataPagamentoDoMes(
          (() => { const [a, m] = mesActual.split("-").map(Number); const nm = m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, "0")}`; return nm; })(),
          diaEntrada,
        );
        const diasParaPagamento = Math.round((new Date(prox + "T00:00:00Z").getTime() - new Date(hoje + "T00:00:00Z").getTime()) / 86400e3);

        // comissões pendentes do afiliado ligado (regras de afiliado)
        let comissoesPendentes = 0;
        if (t.afiliadoId) {
          const cms = await db.select({ v: sql<number>`COALESCE(SUM(${afiliadoComissoes.valorComissao}),0)` })
            .from(afiliadoComissoes)
            .where(and(eq(afiliadoComissoes.afiliadoId, Number(t.afiliadoId)), eq(afiliadoComissoes.estado, "Pendente")));
          comissoesPendentes = Number(cms[0]?.v ?? 0);
        }

        out.push({
          ...t,
          diaEntrada,
          presMes: presT.filter((p) => p.dataDia.startsWith(mesActual) && p.status === "Presente").length,
          ausMes: presT.filter((p) => p.dataDia.startsWith(mesActual) && p.status === "Ausente").length,
          licencas: licT,
          mesesPagos,
          mesesEmAtraso,
          proxPagamento: prox,
          diasParaPagamento,
          devidoMesActual: devidoMes(mesActual),
          pagoMesActual: pagoMes(mesActual),
          comissoesPendentes,
        });
      }
      return { trabalhadores: out, hoje, mesActual };
    }),

  /** Presenças de um dia concreto (para pré-preencher o registo) */
  presencasDia: publicQuery
    .input(z.object({ usuarioId: z.number().int().positive(), data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }))
    .query(async ({ input }) => {
      await requireAdmin(input.usuarioId);
      return getDb().select().from(rhPresencas).where(eq(rhPresencas.dataDia, input.data));
    }),

  registarPresencas: publicQuery
    .input(z.object({
      usuarioId: z.number().int().positive(),
      data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      itens: z.array(z.object({
        trabalhadorId: z.number().int().positive(),
        status: z.enum(["Presente", "Ausente"]),
        area: z.enum(["Restaurante", "Decoração"]),
        justificativa: z.string().max(255).optional(),
      })).max(200),
    }))
    .mutation(async ({ input }) => {
      await requireAdmin(input.usuarioId);
      const db = getDb();
      for (const it of input.itens) {
        const ex = await db.select().from(rhPresencas)
          .where(and(eq(rhPresencas.trabalhadorId, it.trabalhadorId), eq(rhPresencas.dataDia, input.data)));
        if (ex.length > 0) {
          await db.update(rhPresencas)
            .set({ status: it.status, area: it.area, justificativa: it.justificativa || null })
            .where(eq(rhPresencas.id, ex[0].id));
        } else {
          await db.insert(rhPresencas).values({
            trabalhadorId: it.trabalhadorId, dataDia: input.data,
            status: it.status, area: it.area, justificativa: it.justificativa || null,
          });
        }
      }
      return { ok: true, n: input.itens.length };
    }),

  guardarTrabalhador: publicQuery
    .input(z.object({
      usuarioId: z.number().int().positive(),
      id: z.number().int().positive().optional(),
      nome: z.string().min(3, "Indique o nome completo do trabalhador (mín. 3 letras)").max(160),
      telefone: z.string().max(40).optional(),
      biNumero: z.string().max(60).optional(),
      regime: z.enum(["Permanente", "Eventual", "Afiliado"]),
      area: z.enum(["Restaurante", "Decoração", "Ambas"]),
      cargo: z.string().min(2, "Indique o cargo / função").max(120),
      atividades: z.string().max(2000).optional(),
      dataInicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Indique a data de início (AAAA-MM-DD)"),
      salarioMensal: z.number().min(0).max(10_000_000).default(0),
      diaria: z.number().min(0).max(1_000_000).default(500),
      afiliadoId: z.number().int().positive().nullable().optional(),
      notas: z.string().max(255).optional(),
    }))
    .mutation(async ({ input }) => {
      await requireAdmin(input.usuarioId);
      const db = getDb();
      const { usuarioId, id, ...d } = input;
      const dados = { ...d, afiliadoId: d.afiliadoId ?? null, telefone: d.telefone || null, biNumero: d.biNumero || null, atividades: d.atividades || null, notas: d.notas || null };
      if (id) {
        await db.update(trabalhadores).set(dados).where(eq(trabalhadores.id, id));
        return { ok: true, id };
      }
      const codigo = await nextCodigoTrabalhador();
      const r = await db.insert(trabalhadores).values({ ...dados, codigo });
      return { ok: true, id: Number((r as any)[0]?.insertId ?? 0) };
    }),

  /** Remove (ou desactiva, se já tiver registos) */
  removerTrabalhador: publicQuery
    .input(z.object({ usuarioId: z.number().int().positive(), id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      await requireAdmin(input.usuarioId);
      const db = getDb();
      const p = await db.select({ id: rhPresencas.id }).from(rhPresencas).where(eq(rhPresencas.trabalhadorId, input.id)).limit(1);
      const g = await db.select({ id: rhSalarioPagamentos.id }).from(rhSalarioPagamentos).where(eq(rhSalarioPagamentos.trabalhadorId, input.id)).limit(1);
      if (p.length > 0 || g.length > 0) {
        await db.update(trabalhadores).set({ ativo: false }).where(eq(trabalhadores.id, input.id));
        return { ok: true, desactivado: true };
      }
      await db.delete(rhLicencas).where(eq(rhLicencas.trabalhadorId, input.id));
      await db.delete(trabalhadores).where(eq(trabalhadores.id, input.id));
      return { ok: true, desactivado: false };
    }),

  reactivarTrabalhador: publicQuery
    .input(z.object({ usuarioId: z.number().int().positive(), id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      await requireAdmin(input.usuarioId);
      await getDb().update(trabalhadores).set({ ativo: true }).where(eq(trabalhadores.id, input.id));
      return { ok: true };
    }),

  guardarLicenca: publicQuery
    .input(z.object({
      usuarioId: z.number().int().positive(),
      trabalhadorId: z.number().int().positive(),
      tipo: z.enum(["Anual", "Periódica", "Doença", "Outra"]),
      motivo: z.string().min(2).max(255),
      inicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      fim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    }))
    .mutation(async ({ input }) => {
      await requireAdmin(input.usuarioId);
      if (input.fim < input.inicio) throw new TRPCError({ code: "BAD_REQUEST", message: "O fim da licença não pode ser antes do início." });
      const { usuarioId, ...d } = input;
      await getDb().insert(rhLicencas).values(d);
      return { ok: true };
    }),

  removerLicenca: publicQuery
    .input(z.object({ usuarioId: z.number().int().positive(), id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      await requireAdmin(input.usuarioId);
      await getDb().delete(rhLicencas).where(eq(rhLicencas.id, input.id));
      return { ok: true };
    }),

  pagarSalario: publicQuery
    .input(z.object({
      usuarioId: z.number().int().positive(),
      trabalhadorId: z.number().int().positive(),
      mesReferencia: z.string().regex(/^\d{4}-\d{2}$/),
      valor: z.number().min(0.01).max(10_000_000),
      // «Adiantamento»: o funcionário recebe parte do salário ANTES do dia do pagamento;
      // «Pagamento»: parcela normal. Ambos abatem no valor devido do mês de referência.
      tipo: z.enum(["Pagamento", "Adiantamento"]).default("Pagamento"),
      metodo: z.string().max(60).optional(),
      obs: z.string().max(255).optional(),
    }))
    .mutation(async ({ input }) => {
      const u = await requireAdmin(input.usuarioId);
      const { usuarioId, ...d } = input;
      await getDb().insert(rhSalarioPagamentos).values({ ...d, metodo: d.metodo || null, obs: d.obs || null, pagoPor: u.nome });
      return { ok: true };
    }),

  /** Parcelas/adiantamentos de um trabalhador num mês de referência (o mais recente primeiro) */
  parcelasMes: publicQuery
    .input(z.object({
      usuarioId: z.number().int().positive(),
      trabalhadorId: z.number().int().positive(),
      mes: z.string().regex(/^\d{4}-\d{2}$/),
    }))
    .query(async ({ input }) => {
      await requireAdmin(input.usuarioId);
      return getDb().select().from(rhSalarioPagamentos)
        .where(and(
          eq(rhSalarioPagamentos.trabalhadorId, input.trabalhadorId),
          eq(rhSalarioPagamentos.mesReferencia, input.mes),
        ))
        .orderBy(desc(rhSalarioPagamentos.id));
    }),

  /** Anular uma parcela/adiantamento lançado por engano (o valor sai do «pago» do mês) */
  anularPagamentoSalario: publicQuery
    .input(z.object({ usuarioId: z.number().int().positive(), id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      await requireAdmin(input.usuarioId);
      await getDb().delete(rhSalarioPagamentos).where(eq(rhSalarioPagamentos.id, input.id));
      return { ok: true };
    }),

  /** Relatório mensal (salários, desempenho/assiduidade e variáveis) — alimenta Word A4 e impressão */
  relatorioMes: publicQuery
    .input(z.object({ usuarioId: z.number().int().positive(), mes: z.string().regex(/^\d{4}-\d{2}$/) }))
    .query(async ({ input }) => {
      await requireAdmin(input.usuarioId);
      const db = getDb();
      const trs = await db.select().from(trabalhadores).orderBy(asc(trabalhadores.nome));
      const pres = await db.select().from(rhPresencas);
      const lics = await db.select().from(rhLicencas);
      const pags = await db.select().from(rhSalarioPagamentos);
      const mes = input.mes;

      const linhas = trs.filter((t) => t.dataInicio.slice(0, 7) <= mes).map((t) => {
        const presT = pres.filter((p) => Number(p.trabalhadorId) === t.id && p.dataDia.startsWith(mes));
        const presentes = presT.filter((p) => p.status === "Presente");
        const ausentes = presT.filter((p) => p.status === "Ausente");
        const licT = lics.filter((l) => Number(l.trabalhadorId) === t.id && l.inicio.slice(0, 7) <= mes && l.fim.slice(0, 7) >= mes);
        const pago = pags.filter((p) => Number(p.trabalhadorId) === t.id && p.mesReferencia === mes).reduce((s, p) => s + p.valor, 0);
        const devido = t.regime === "Permanente" ? t.salarioMensal : presentes.length * t.diaria;
        const marcados = presT.length;
        const assiduidade = marcados > 0 ? Math.round((presentes.length / marcados) * 100) : null;
        return {
          id: t.id, codigo: t.codigo, nome: t.nome, regime: t.regime, area: t.area, cargo: t.cargo,
          diasPresentes: presentes.length,
          diasRestaurante: presentes.filter((p) => p.area === "Restaurante").length,
          diasDecoracao: presentes.filter((p) => p.area === "Decoração").length,
          diasAusentes: ausentes.length,
          ausenciasJustificadas: ausentes.filter((p) => (p.justificativa ?? "").trim().length > 0).length,
          licencas: licT.map((l) => ({ tipo: l.tipo, motivo: l.motivo, inicio: l.inicio, fim: l.fim })),
          diaria: t.diaria, salarioMensal: t.salarioMensal,
          valorDevido: devido, valorPago: pago, saldo: Math.max(0, devido - pago),
          assiduidade,
        };
      });
      return { mes, linhas, geradoEm: hojeMz() };
    }),
});
