import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { createRouter, publicQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { usuarios } from "@db/schema";

/** Presença em memória — quem está online agora (loja pública + sistema do restaurante).
    Cada separador/dispositivo envia um "ping" periódico com uma chave própria;
    entradas sem ping há mais de 90 segundos são consideradas offline. */
type Entrada = { area: "loja" | "sistema"; ts: number };
const presentes = new Map<string, Entrada>();
const JANELA_MS = 90_000;

function limpar() {
  const corte = Date.now() - JANELA_MS;
  for (const [k, v] of presentes) if (v.ts < corte) presentes.delete(k);
}

export const presencaRouter = createRouter({
  /** Ping de presença (público — loja e sistema) */
  ping: publicQuery
    .input(z.object({
      chave: z.string().min(6).max(80),
      area: z.enum(["loja", "sistema"]),
    }))
    .mutation(({ input }) => {
      presentes.set(input.chave, { area: input.area, ts: Date.now() });
      if (presentes.size > 5000) limpar();
      return { ok: true };
    }),

  /** Quantas pessoas estão online (apenas Admin) */
  stats: publicQuery
    .input(z.object({ adminId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const u = await getDb().query.usuarios.findFirst({ where: eq(usuarios.id, input.adminId) });
      if (!u || !u.ativo || u.perfil !== "Admin")
        throw new TRPCError({ code: "FORBIDDEN", message: "Ação reservada ao Admin" });
      limpar();
      let loja = 0, sistema = 0;
      for (const v of presentes.values()) (v.area === "loja" ? loja++ : sistema++);
      return { loja, sistema, total: loja + sistema };
    }),
});
