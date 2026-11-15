import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { HttpBindings } from "@hono/node-server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { sql } from "drizzle-orm";
import { appRouter } from "./router";
import { createContext } from "./context";
import { env } from "./lib/env";
import { getDb } from "./queries/connection";

const app = new Hono<{ Bindings: HttpBindings }>();

app.use(bodyLimit({ maxSize: 50 * 1024 * 1024 }));
app.use("/api/trpc/*", async (c) => {
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req: c.req.raw,
    router: appRouter,
    createContext,
  });
});
// Diagnóstico da ligação à base de dados — abrir /api/saude no navegador mostra
// se o servidor publicado consegue falar com a BD e, se não, o erro exacto.
app.get("/api/saude", async (c) => {
  const t0 = Date.now();
  try {
    await getDb().execute(sql`SELECT 1 AS ok`);
    return c.json({ ok: true, ms: Date.now() - t0, hora: new Date().toISOString() });
  } catch (e) {
    const erro = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    const host = (env.databaseUrl.match(/@([^/:]+)/) ?? [])[1] ?? "?";
    console.error("[saude] FALHA na ligação à BD:", erro);
    return c.json({ ok: false, ms: Date.now() - t0, erro, bd_host: host }, 500);
  }
});

app.all("/api/*", (c) => c.json({ error: "Not Found" }, 404));

export default app;

if (env.isProduction) {
  const { serve } = await import("@hono/node-server");
  const { serveStaticFiles } = await import("./lib/vite");
  const { autoSeed, autoMigrate } = await import("./seed-auto");
  serveStaticFiles(app);

  // Garante as colunas novas (migrações idempotentes) antes de servir
  await autoMigrate().catch((e) => console.warn("[auto-migrate] ignorado:", (e as Error).message));
  // Garante utilizadores/produtos iniciais quando a BD está vazia.
  // IMPORTANTE: se a BD estiver inacessível, o servidor NÃO pode morrer aqui —
  // sobe na mesma e volta a tentar a cada minuto (evita o ciclo de quedas que
  // derruba o site inteiro; as páginas carregam e o /api/saude mostra o erro).
  await autoSeed().catch((e) => console.error("[auto-seed] FALHOU (servidor continua):", (e as Error).message));
  const seedRetry = setInterval(() => {
    autoSeed()
      .then(() => clearInterval(seedRetry))
      .catch((e) => console.warn("[auto-seed] nova tentativa falhou:", (e as Error).message));
  }, 60 * 1000);
  seedRetry.unref();

  const port = parseInt(process.env.PORT || "3000");
  serve({ fetch: app.fetch, port }, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });

  // Keep-alive: a BD serverless «adormece» por inactividade — um ping a cada
  // 4 minutos mantém-na acordada para a equipa nunca apanhar o sistema morto.
  setInterval(() => {
    getDb()
      .execute(sql`SELECT 1`)
      .catch((e) => console.warn("[keep-alive] ping à BD falhou:", (e as Error).message));
  }, 4 * 60 * 1000).unref();
}
