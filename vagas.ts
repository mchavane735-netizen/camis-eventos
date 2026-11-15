/* ============================================================
   VAGAS & RECRUTAMENTO (v18)
   · Página pública (?vagas=1): vagas abertas + candidatura simplificada com CV
   · Subscrição de notificações de novas vagas (sem registo)
   · Gestão (Admin/Gestor): criar/editar/fechar vagas, filtrar candidaturas,
     triagem automática inteligente (pontuação 0–100 com justificação)
   ============================================================ */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { createRouter, publicQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { usuarios, vagas, candidaturas, vagasSubscritores, contadores } from "@db/schema";

async function requirePerfil(userId: number, perfis: string[]) {
  const u = await getDb().query.usuarios.findFirst({ where: eq(usuarios.id, userId) });
  if (!u || !u.ativo) throw new TRPCError({ code: "UNAUTHORIZED", message: "Utilizador inválido" });
  if (!perfis.includes(u.perfil))
    throw new TRPCError({ code: "FORBIDDEN", message: "Ação reservada a: " + perfis.join(", ") });
  return u;
}

async function nextCodigoCandidatura(): Promise<string> {
  const db = getDb();
  await db.insert(contadores).values({ chave: "candidatura", valor: 1 })
    .onDuplicateKeyUpdate({ set: { valor: sql`${contadores.valor} + 1` } });
  const c = await db.query.contadores.findFirst({ where: eq(contadores.chave, "candidatura") });
  return "CND-" + String(c?.valor ?? 1).padStart(4, "0");
}

/* ---------- Triagem automática inteligente ----------
   Pontuação transparente 0–100, pensada para a realidade da CAMI'S Eventos:
   experiência, disponibilidade, residência em Chimoio, palavras-chave do perfil
   da vaga, idade legal de trabalho e qualidade da apresentação. */
const PALAVRAS_CHAVE: Array<{ area: string; chaves: string[] }> = [
  { area: "Cozinha", chaves: ["cozinha", "chef", "cozinheiro", "culinária", "pratos", "menu", "eventos", "catering", "higiene", "carne", "grelha", "pastelaria", "restaurante"] },
  { area: "Serviço", chaves: ["atendimento", "mesa", "cliente", "serviço", "bar", "bebidas", "copos"] },
  { area: "Eventos", chaves: ["eventos", "decoração", "montagem", "som", "logística", "casamento"] },
];

export function pontuarCandidatura(
  vaga: { titulo: string; area: string; requisitos?: string | null },
  c: { idade?: number | null; residencia?: string | null; experienciaAnos: number; disponibilidade: string; apresentacao?: string | null; cvNome?: string | null },
): { pontos: number; linhas: string[] } {
  let pontos = 0;
  const linhas: string[] = [];

  // experiência (até 30)
  const exp = Math.min(30, Math.round(c.experienciaAnos * 6));
  pontos += exp;
  linhas.push(`Experiência declarada: ${c.experienciaAnos} ano(s) → ${exp}/30`);

  // disponibilidade (até 15)
  const disp = c.disponibilidade === "Imediata" ? 15 : 7;
  pontos += disp;
  linhas.push(`Disponibilidade «${c.disponibilidade}» → ${disp}/15`);

  // residência em Chimoio/arredores (até 15)
  const res = (c.residencia ?? "").toLowerCase();
  const local = res.includes("chimoio") || res.includes("bairro") || res.includes("manica");
  const ptsLocal = res.trim() === "" ? 0 : local ? 15 : 5;
  pontos += ptsLocal;
  linhas.push(`Residência «${c.residencia || "—"}» ${local ? "(Chimoio/arredores)" : ""} → ${ptsLocal}/15`);

  // afinidade com o perfil da vaga — palavras-chave na apresentação (até 25)
  const texto = `${c.apresentacao ?? ""} ${c.cvNome ?? ""}`.toLowerCase();
  const grupo = PALAVRAS_CHAVE.find((g) => vaga.area.toLowerCase().includes(g.area.toLowerCase())) ?? PALAVRAS_CHAVE[0];
  const hits = grupo.chaves.filter((k) => texto.includes(k));
  const ptsChave = Math.min(25, hits.length * 6);
  pontos += ptsChave;
  linhas.push(`Afinidade com «${vaga.titulo}»: ${hits.length ? hits.join(", ") : "sem palavras-chave do perfil"} → ${ptsChave}/25`);

  // idade legal/adulta (até 5)
  const ptsIdade = c.idade == null ? 0 : c.idade >= 18 ? 5 : 0;
  pontos += ptsIdade;
  if (c.idade != null && c.idade < 18) linhas.push("⚠️ Menor de 18 anos — verificar enquadramento legal antes de avançar");
  else linhas.push(`Idade ${c.idade ?? "não indicada"} → ${ptsIdade}/5`);

  // apresentação e CV (até 10)
  const ptsApres = (c.apresentacao?.trim().length ?? 0) >= 60 ? 5 : 0;
  const ptsCv = c.cvNome ? 5 : 0;
  pontos += ptsApres + ptsCv;
  linhas.push(`Apresentação ${ptsApres ? "cuidada" : "curta/vazia"} (${ptsApres}/5) · CV ${ptsCv ? "anexado" : "não anexado"} (${ptsCv}/5)`);

  const recomendacao = pontos >= 70 ? "✅ Forte candidatura — priorizar entrevista"
    : pontos >= 45 ? "🟡 Candidatura média — rever manualmente"
    : "🔴 Candidatura fraca para este perfil";
  linhas.push(recomendacao);
  return { pontos, linhas };
}

export const vagasRouter = createRouter({
  /* ---------- PÚBLICO ---------- */
  /** Vagas abertas (página pública de recrutamento — sem login) */
  listAbertas: publicQuery.query(() =>
    getDb().select({
      id: vagas.id, titulo: vagas.titulo, area: vagas.area, tipo: vagas.tipo, local: vagas.local,
      salario: vagas.salario, descricao: vagas.descricao, requisitos: vagas.requisitos,
      oferecemos: vagas.oferecemos, criadoEm: vagas.criadoEm,
    }).from(vagas).where(eq(vagas.estado, "Aberta")).orderBy(desc(vagas.criadoEm)),
  ),

  /** Candidatura simplificada — sem registo, com CV em anexo (data URL) */
  candidatar: publicQuery
    .input(z.object({
      vagaId: z.number().int().positive(),
      nome: z.string().min(3, "Indique o nome completo").max(160),
      telefone: z.string().min(7, "Indique um telefone válido").max(30),
      email: z.string().email("Email inválido").max(120).optional().or(z.literal("")),
      idade: z.number().int().min(14).max(80).optional(),
      residencia: z.string().max(120).optional(),
      experienciaAnos: z.number().min(0).max(50).default(0),
      disponibilidade: z.enum(["Imediata", "A combinar"]).default("Imediata"),
      apresentacao: z.string().max(1200).optional(),
      cv: z.string().max(3_500_000).optional(), // data URL (~2.5 MB)
      cvNome: z.string().max(160).optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const vaga = await db.query.vagas.findFirst({ where: eq(vagas.id, input.vagaId) });
      if (!vaga || vaga.estado !== "Aberta")
        throw new TRPCError({ code: "BAD_REQUEST", message: "Esta vaga já não está disponível." });
      const codigo = await nextCodigoCandidatura();
      // triagem automática já na entrada — a candidatura chega pontuada
      const tri = pontuarCandidatura(vaga, input);
      await db.insert(candidaturas).values({
        codigo, vagaId: input.vagaId, nome: input.nome.trim(), telefone: input.telefone.trim(),
        email: input.email || null, idade: input.idade ?? null, residencia: input.residencia || null,
        experienciaAnos: input.experienciaAnos, disponibilidade: input.disponibilidade,
        apresentacao: input.apresentacao || null, cv: input.cv || null, cvNome: input.cvNome || null,
        pontuacao: tri.pontos, pontuacaoDetalhe: tri.linhas.join("\n"),
      });
      return { ok: true, codigo, vaga: vaga.titulo };
    }),

  /** Inscrição para receber notificações de novas vagas (sem registo) */
  subscrever: publicQuery
    .input(z.object({
      nome: z.string().min(2).max(160),
      contacto: z.string().min(7, "Indique um contacto válido").max(60),
      canal: z.enum(["WhatsApp", "Email"]).default("WhatsApp"),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const existe = await db.query.vagasSubscritores.findFirst({
        where: and(eq(vagasSubscritores.contacto, input.contacto.trim()), eq(vagasSubscritores.canal, input.canal)),
      });
      if (existe) return { ok: true, ja: true };
      await db.insert(vagasSubscritores).values({ nome: input.nome.trim(), contacto: input.contacto.trim(), canal: input.canal });
      return { ok: true, ja: false };
    }),

  /* ---------- GESTÃO (Admin e Gestor) ---------- */
  listTodas: publicQuery
    .input(z.object({ usuarioId: z.number().int().positive() }))
    .query(async ({ input }) => {
      await requirePerfil(input.usuarioId, ["Admin", "RH"]);
      const db = getDb();
      const vs = await db.select().from(vagas).orderBy(desc(vagas.criadoEm));
      const conta = await db.select({ vagaId: candidaturas.vagaId, n: sql<number>`COUNT(*)` })
        .from(candidaturas).groupBy(candidaturas.vagaId);
      const mapa = new Map(conta.map((c) => [Number(c.vagaId), Number(c.n)]));
      return vs.map((v) => ({ ...v, nCandidaturas: mapa.get(v.id) ?? 0 }));
    }),

  criar: publicQuery
    .input(z.object({
      usuarioId: z.number().int().positive(),
      titulo: z.string().min(3).max(120),
      area: z.string().min(2).max(80).default("Cozinha"),
      tipo: z.string().min(2).max(60).default("Tempo inteiro"),
      local: z.string().max(120).default("Chimoio — CAMI'S Eventos"),
      salario: z.string().max(80).optional(),
      descricao: z.string().max(4000).optional(),
      requisitos: z.string().max(4000).optional(),
      oferecemos: z.string().max(4000).optional(),
    }))
    .mutation(async ({ input }) => {
      await requirePerfil(input.usuarioId, ["Admin", "RH"]);
      const { usuarioId, ...dados } = input;
      await getDb().insert(vagas).values(dados);
      const subs = await getDb().select({ id: vagasSubscritores.id }).from(vagasSubscritores);
      return { ok: true, subscritores: subs.length };
    }),

  atualizar: publicQuery
    .input(z.object({
      usuarioId: z.number().int().positive(),
      id: z.number().int().positive(),
      titulo: z.string().min(3).max(120).optional(),
      area: z.string().min(2).max(80).optional(),
      tipo: z.string().min(2).max(60).optional(),
      local: z.string().max(120).optional(),
      salario: z.string().max(80).nullable().optional(),
      descricao: z.string().max(4000).nullable().optional(),
      requisitos: z.string().max(4000).nullable().optional(),
      oferecemos: z.string().max(4000).nullable().optional(),
      estado: z.enum(["Aberta", "Fechada"]).optional(),
    }))
    .mutation(async ({ input }) => {
      await requirePerfil(input.usuarioId, ["Admin", "RH"]);
      const { usuarioId, id, ...dados } = input;
      await getDb().update(vagas).set(dados).where(eq(vagas.id, id));
      return { ok: true };
    }),

  /** Candidaturas com filtros: vaga, estado, pontuação mínima, pesquisa livre */
  candidaturas: publicQuery
    .input(z.object({
      usuarioId: z.number().int().positive(),
      vagaId: z.number().int().positive().optional(),
      status: z.string().max(20).optional(),
      minPontos: z.number().int().min(0).max(100).optional(),
      busca: z.string().max(60).optional(),
    }))
    .query(async ({ input }) => {
      await requirePerfil(input.usuarioId, ["Admin", "RH"]);
      const db = getDb();
      let rows = await db.select({
        id: candidaturas.id, codigo: candidaturas.codigo, vagaId: candidaturas.vagaId,
        nome: candidaturas.nome, telefone: candidaturas.telefone, email: candidaturas.email,
        idade: candidaturas.idade, residencia: candidaturas.residencia,
        experienciaAnos: candidaturas.experienciaAnos, disponibilidade: candidaturas.disponibilidade,
        apresentacao: candidaturas.apresentacao, cvNome: candidaturas.cvNome,
        status: candidaturas.status, pontuacao: candidaturas.pontuacao,
        pontuacaoDetalhe: candidaturas.pontuacaoDetalhe, notaInterna: candidaturas.notaInterna,
        criadoEm: candidaturas.criadoEm,
        temCv: sql<boolean>`${candidaturas.cv} IS NOT NULL`.as("temCv"),
        vagaTitulo: vagas.titulo,
      }).from(candidaturas).innerJoin(vagas, eq(vagas.id, candidaturas.vagaId))
        .orderBy(desc(candidaturas.criadoEm)).limit(500);
      if (input.vagaId) rows = rows.filter((r) => r.vagaId === input.vagaId);
      if (input.status) rows = rows.filter((r) => r.status === input.status);
      if (input.minPontos != null) rows = rows.filter((r) => (r.pontuacao ?? 0) >= input.minPontos!);
      if (input.busca) {
        const b = input.busca.toLowerCase();
        rows = rows.filter((r) => r.nome.toLowerCase().includes(b) || r.codigo.toLowerCase().includes(b) || (r.residencia ?? "").toLowerCase().includes(b));
      }
      return rows;
    }),

  /** CV do candidato (data URL) — só gestão */
  cv: publicQuery
    .input(z.object({ usuarioId: z.number().int().positive(), id: z.number().int().positive() }))
    .query(async ({ input }) => {
      await requirePerfil(input.usuarioId, ["Admin", "RH"]);
      const c = await getDb().query.candidaturas.findFirst({ where: eq(candidaturas.id, input.id) });
      if (!c?.cv) throw new TRPCError({ code: "NOT_FOUND", message: "Sem CV anexado" });
      return { cv: c.cv, nome: c.cvNome ?? "cv" };
    }),

  setStatusCandidatura: publicQuery
    .input(z.object({
      usuarioId: z.number().int().positive(),
      id: z.number().int().positive(),
      status: z.enum(["Nova", "Em análise", "Pré-seleccionado", "Entrevista", "Contratado", "Não contratado", "Rejeitado"]),
      notaInterna: z.string().max(255).optional(),
    }))
    .mutation(async ({ input }) => {
      await requirePerfil(input.usuarioId, ["Admin", "RH"]);
      await getDb().update(candidaturas)
        .set({ status: input.status, ...(input.notaInterna !== undefined ? { notaInterna: input.notaInterna } : {}) })
        .where(eq(candidaturas.id, input.id));
      return { ok: true };
    }),

  /** Triagem automática (re)pontua uma candidatura — ou TODAS as de uma vaga */
  triagem: publicQuery
    .input(z.object({
      usuarioId: z.number().int().positive(),
      id: z.number().int().positive().optional(),
      vagaId: z.number().int().positive().optional(),
    }))
    .mutation(async ({ input }) => {
      await requirePerfil(input.usuarioId, ["Admin", "RH"]);
      const db = getDb();
      const alvo = input.id
        ? await db.select().from(candidaturas).where(eq(candidaturas.id, input.id))
        : input.vagaId
          ? await db.select().from(candidaturas).where(eq(candidaturas.vagaId, input.vagaId))
          : [];
      let n = 0;
      for (const c of alvo) {
        const vaga = await db.query.vagas.findFirst({ where: eq(vagas.id, Number(c.vagaId)) });
        if (!vaga) continue;
        const tri = pontuarCandidatura(vaga, c);
        await db.update(candidaturas)
          .set({ pontuacao: tri.pontos, pontuacaoDetalhe: tri.linhas.join("\n") })
          .where(eq(candidaturas.id, c.id));
        n++;
      }
      return { ok: true, n };
    }),

  /** Subscritores das notificações de vagas (para envio via WhatsApp/email) */
  subscritores: publicQuery
    .input(z.object({ usuarioId: z.number().int().positive() }))
    .query(async ({ input }) => {
      await requirePerfil(input.usuarioId, ["Admin", "RH"]);
      return getDb().select().from(vagasSubscritores).orderBy(desc(vagasSubscritores.criadoEm)).limit(500);
    }),
});
