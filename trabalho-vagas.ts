/**
 * OPORTUNIDADES DE TRABALHO EVENTUAL PARA AFILIADOS (v27)
 * O Admin/Gestor lança uma vaga de trabalho eventual (dia de pico no restaurante,
 * decoração, catering, apoio em eventos) e escolhe OS AFILIADOS que a recebem.
 * A vaga aparece no aplicativo do afiliado (separador «🔔 Vagas») e é atribuída
 * aos PRIMEIROS N que aceitarem (N = nº de vagas). Com data/hora limite: passado
 * o prazo, a vaga some da página dos candidatos que não responderam.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { createRouter, publicQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { trabalhoVagas, trabalhoVagaDestinos, afiliados, afiliadoTokens, usuarios, contadores } from "@db/schema";

const AREAS = ["Restaurante", "Decoração", "Catering", "Apoio em eventos"] as const;

async function requirePerfil(userId: number, perfis: string[]) {
  const u = await getDb().query.usuarios.findFirst({ where: eq(usuarios.id, userId) });
  if (!u || !u.ativo || !perfis.includes(u.perfil))
    throw new TRPCError({ code: "FORBIDDEN", message: "Sem permissão para esta operação" });
  return u;
}

/** token do afiliado (mesmo mecanismo do portal) */
async function afiliadoPorToken(token: string) {
  const db = getDb();
  const t = await db.query.afiliadoTokens.findFirst({ where: eq(afiliadoTokens.token, token) });
  if (!t) throw new TRPCError({ code: "UNAUTHORIZED", message: "Sessão inválida — entre de novo" });
  const a = await db.query.afiliados.findFirst({ where: eq(afiliados.id, t.afiliadoId) });
  if (!a) throw new TRPCError({ code: "UNAUTHORIZED", message: "Afiliado não encontrado" });
  return a;
}

/** agora em Moçambique como "YYYY-MM-DD HH:MM" */
const agoraMz = () => {
  const d = new Date(Date.now() + 2 * 3600e3);
  return d.toISOString().slice(0, 16).replace("T", " ");
};
const hojeMz = () => agoraMz().slice(0, 10);

const limitePassou = (limite: string | null) => !!limite && limite <= agoraMz();

const inputVaga = z.object({
  usuarioId: z.number().int().positive(),
  id: z.number().int().positive().optional(),
  dataTrabalho: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Indique a data do trabalho"),
  horaInicio: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  area: z.enum(AREAS),
  descricao: z.string().max(255).optional(),
  vagas: z.number().int().min(1, "Indique pelo menos 1 vaga").max(100),
  diaria: z.number().min(0).max(100000).default(500),
  limiteAceite: z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/, "Indique a data e hora limite").nullable().optional(),
  destinatarios: z.array(z.number().int().positive()).min(1, "Seleccione pelo menos um afiliado"),
});

export const trabalhoVagasRouter = createRouter({
  /** Lista para a gestão (Admin/Gestor): vagas + destinatários + contagem de aceites */
  listar: publicQuery
    .input(z.object({ usuarioId: z.number().int().positive() }))
    .query(async ({ input }) => {
      await requirePerfil(input.usuarioId, ["Admin", "Gestor", "RH"]);
      const db = getDb();
      const vagas = await db.select().from(trabalhoVagas).orderBy(desc(trabalhoVagas.id)).limit(60);
      const destinos = await db.select({
        id: trabalhoVagaDestinos.id, vagaId: trabalhoVagaDestinos.vagaId,
        afiliadoId: trabalhoVagaDestinos.afiliadoId, estado: trabalhoVagaDestinos.estado,
        respostaEm: trabalhoVagaDestinos.respostaEm,
        nome: afiliados.nome, codigo: afiliados.codigo, telefone: afiliados.telefone,
      }).from(trabalhoVagaDestinos)
        .leftJoin(afiliados, eq(afiliados.id, trabalhoVagaDestinos.afiliadoId))
        .orderBy(desc(trabalhoVagaDestinos.id)).limit(2000);
      return vagas.map((v) => {
        const ds = destinos.filter((d) => d.vagaId === v.id);
        const aceites = ds.filter((d) => d.estado === "Aceite").length;
        const expirada = limitePassou(v.limiteAceite);
        return { ...v, destinos: ds, aceites, expirada, vagasRestantes: Math.max(0, v.vagas - aceites) };
      });
    }),

  /** Criar ou editar — na edição podem mudar-se os destinatários:
      novos são acrescentados; desmarcados só saem se ainda estiverem PENDENTES. */
  guardar: publicQuery
    .input(inputVaga)
    .mutation(async ({ input }) => {
      const u = await requirePerfil(input.usuarioId, ["Admin", "Gestor", "RH"]);
      const db = getDb();
      const { usuarioId, id, destinatarios, ...d } = input;
      const dados = {
        dataTrabalho: d.dataTrabalho, horaInicio: d.horaInicio || null, area: d.area,
        descricao: d.descricao || null, vagas: d.vagas, diaria: d.diaria,
        limiteAceite: d.limiteAceite || null,
      };
      let vagaId: number;
      if (id) {
        const v = await db.query.trabalhoVagas.findFirst({ where: eq(trabalhoVagas.id, id) });
        if (!v) throw new TRPCError({ code: "NOT_FOUND", message: "Vaga não encontrada." });
        await db.update(trabalhoVagas).set(dados).where(eq(trabalhoVagas.id, id));
        vagaId = id;
        // destinatários: remover desmarcados APENAS se ainda pendentes (quem já aceitou/recusou fica registado)
        const actuais = await db.select().from(trabalhoVagaDestinos).where(eq(trabalhoVagaDestinos.vagaId, id));
        for (const a of actuais) {
          if (!destinatarios.includes(a.afiliadoId) && a.estado === "Pendente")
            await db.delete(trabalhoVagaDestinos).where(eq(trabalhoVagaDestinos.id, a.id));
        }
        for (const afId of destinatarios) {
          if (!actuais.some((a) => a.afiliadoId === afId))
            await db.insert(trabalhoVagaDestinos).values({ vagaId: id, afiliadoId: afId });
        }
      } else {
        await db.insert(contadores).values({ chave: "trabalho_vaga", valor: 1 })
          .onDuplicateKeyUpdate({ set: { valor: sql`${contadores.valor} + 1` } });
        const c = await db.query.contadores.findFirst({ where: eq(contadores.chave, "trabalho_vaga") });
        const codigo = "TV-" + String(c?.valor ?? 1).padStart(4, "0");
        const r = await db.insert(trabalhoVagas).values({ ...dados, codigo, criadoPor: u.nome });
        vagaId = Number((r as any)[0]?.insertId ?? 0);
        for (const afId of destinatarios)
          await db.insert(trabalhoVagaDestinos).values({ vagaId, afiliadoId: afId });
      }
      return { ok: true, id: vagaId };
    }),

  setStatus: publicQuery
    .input(z.object({
      usuarioId: z.number().int().positive(),
      id: z.number().int().positive(),
      status: z.enum(["Aberta", "Preenchida", "Cancelada", "Concluída"]),
    }))
    .mutation(async ({ input }) => {
      await requirePerfil(input.usuarioId, ["Admin", "Gestor", "RH"]);
      await getDb().update(trabalhoVagas).set({ status: input.status }).where(eq(trabalhoVagas.id, input.id));
      return { ok: true };
    }),

  remover: publicQuery
    .input(z.object({ usuarioId: z.number().int().positive(), id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      await requirePerfil(input.usuarioId, ["Admin", "RH"]);
      const db = getDb();
      await db.delete(trabalhoVagaDestinos).where(eq(trabalhoVagaDestinos.vagaId, input.id));
      await db.delete(trabalhoVagas).where(eq(trabalhoVagas.id, input.id));
      return { ok: true };
    }),

  /* ---------- LADO DO AFILIADO (aplicativo) ---------- */

  /** Oportunidades visíveis para mim: pendentes NÃO expiradas + as minhas respostas.
      Depois do limite, as pendentes SOMEM da página do candidato. */
  minhas: publicQuery
    .input(z.object({ token: z.string() }))
    .query(async ({ input }) => {
      const a = await afiliadoPorToken(input.token);
      const db = getDb();
      const meus = await db.select({
        destinoId: trabalhoVagaDestinos.id, estado: trabalhoVagaDestinos.estado,
        respostaEm: trabalhoVagaDestinos.respostaEm,
        vagaId: trabalhoVagas.id, codigo: trabalhoVagas.codigo,
        dataTrabalho: trabalhoVagas.dataTrabalho, horaInicio: trabalhoVagas.horaInicio,
        area: trabalhoVagas.area, descricao: trabalhoVagas.descricao, vagas: trabalhoVagas.vagas,
        diaria: trabalhoVagas.diaria, limiteAceite: trabalhoVagas.limiteAceite, status: trabalhoVagas.status,
      }).from(trabalhoVagaDestinos)
        .innerJoin(trabalhoVagas, eq(trabalhoVagas.id, trabalhoVagaDestinos.vagaId))
        .where(eq(trabalhoVagaDestinos.afiliadoId, a.id))
        .orderBy(desc(trabalhoVagaDestinos.id)).limit(50);
      const out = [] as Array<Record<string, unknown>>;
      for (const m of meus) {
        const [{ n }] = await db.select({ n: sql<number>`COUNT(*)` })
          .from(trabalhoVagaDestinos)
          .where(and(eq(trabalhoVagaDestinos.vagaId, m.vagaId), eq(trabalhoVagaDestinos.estado, "Aceite")));
        const aceites = Number(n);
        const expirada = limitePassou(m.limiteAceite);
        const esgotada = aceites >= m.vagas;
        // pendentes expiradas ou de vagas fechadas SOMEM; as minhas respostas ficam como histórico
        if (m.estado === "Pendente" && (expirada || m.status !== "Aberta" || esgotada)) continue;
        out.push({
          ...m,
          aceites,
          vagasRestantes: Math.max(0, m.vagas - aceites),
          expirada,
          // data do trabalho já passou → histórico
          passada: m.dataTrabalho < hojeMz(),
        });
      }
      return out;
    }),

  /** Afiliado responde: aceitar = primeiro a chegar, primeiro a ficar (até esgotar as vagas) */
  responder: publicQuery
    .input(z.object({ token: z.string(), vagaId: z.number().int().positive(), aceitar: z.boolean() }))
    .mutation(async ({ input }) => {
      const a = await afiliadoPorToken(input.token);
      const db = getDb();
      const v = await db.query.trabalhoVagas.findFirst({ where: eq(trabalhoVagas.id, input.vagaId) });
      if (!v) throw new TRPCError({ code: "NOT_FOUND", message: "Esta oportunidade já não existe." });
      const meu = await db.query.trabalhoVagaDestinos.findFirst({
        where: and(eq(trabalhoVagaDestinos.vagaId, input.vagaId), eq(trabalhoVagaDestinos.afiliadoId, a.id)),
      });
      if (!meu) throw new TRPCError({ code: "FORBIDDEN", message: "Esta oportunidade não foi dirigida a si." });
      if (meu.estado !== "Pendente")
        throw new TRPCError({ code: "BAD_REQUEST", message: `Já respondeu a esta oportunidade (${meu.estado.toLowerCase()}).` });
      if (v.status !== "Aberta")
        throw new TRPCError({ code: "BAD_REQUEST", message: "Esta oportunidade já está fechada." });
      if (limitePassou(v.limiteAceite))
        throw new TRPCError({ code: "BAD_REQUEST", message: "O prazo para aceitar já terminou." });
      if (!input.aceitar) {
        await db.update(trabalhoVagaDestinos).set({ estado: "Recusado", respostaEm: new Date() })
          .where(eq(trabalhoVagaDestinos.id, meu.id));
        return { ok: true, aceite: false };
      }
      // corrida: só os primeiros N ficam com a vaga
      const [{ n }] = await db.select({ n: sql<number>`COUNT(*)` })
        .from(trabalhoVagaDestinos)
        .where(and(eq(trabalhoVagaDestinos.vagaId, input.vagaId), eq(trabalhoVagaDestinos.estado, "Aceite")));
      if (Number(n) >= v.vagas) {
        await db.update(trabalhoVagas).set({ status: "Preenchida" }).where(eq(trabalhoVagas.id, input.vagaId));
        throw new TRPCError({ code: "BAD_REQUEST", message: "😔 As vagas esgotaram — outros afiliados aceitaram primeiro. Fique atento às próximas oportunidades!" });
      }
      await db.update(trabalhoVagaDestinos).set({ estado: "Aceite", respostaEm: new Date() })
        .where(eq(trabalhoVagaDestinos.id, meu.id));
      if (Number(n) + 1 >= v.vagas)
        await db.update(trabalhoVagas).set({ status: "Preenchida" }).where(eq(trabalhoVagas.id, input.vagaId));
      return { ok: true, aceite: true, lugar: Number(n) + 1, de: v.vagas };
    }),
});
