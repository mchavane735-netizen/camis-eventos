import { useEffect, useRef } from "react";
import { trpc } from "@/providers/trpc";
import { useSession } from "@/lib/session";
import { horaBR } from "@/lib/fmt";
import { somNovoPedido } from "@/lib/som";
import { useEmpresa } from "@/lib/empresa";
import { printDoc, comandaHtml } from "@/lib/docprint";

/** 👨‍🍳 Quadro da cozinha — pedidos do SALÃO (restaurante).
    Mostra apenas os pratos a preparar (nunca bebidas/bar nem preços) e
    segue as fases: Pendente → Em Preparo → Pronto (sinal para o garçom). */
export default function CozinhaSalao() {
  const { user } = useSession();
  const emp = useEmpresa();
  const q = trpc.pedidos.cozinha.useQuery({ usuarioId: user?.id ?? 0 }, {
    enabled: !!user, refetchInterval: 8000,
  });
  const ok = () => q.refetch();
  const iniciar = trpc.pedidos.cozinhaIniciar.useMutation({ onSuccess: ok });
  const pronto = trpc.pedidos.cozinhaPronto.useMutation({ onSuccess: ok });
  const levantado = trpc.pedidos.cozinhaLevantado.useMutation({ onSuccess: ok });

  // 🔔 sinal sonoro quando chega um pedido NOVO à cozinha
  const vistos = useRef<Set<number>>(new Set());
  useEffect(() => {
    const pendentes = (q.data ?? []).filter((p) => p.cozinhaStatus === "Pendente");
    const novos = pendentes.filter((p) => !vistos.current.has(p.id));
    if (vistos.current.size > 0 && novos.length > 0) somNovoPedido();
    vistos.current = new Set(pendentes.map((p) => p.id));
  }, [q.data]);

  const pedidos = q.data ?? [];
  const chip = (s: string | null) =>
    s === "Pendente" ? { t: "🔔 NOVO — por iniciar", c: "#b3261e", bg: "#fdecec" }
      : s === "Em Preparo" ? { t: "👨‍🍳 Em preparo", c: "#8a5a00", bg: "#fff6dd" }
        : { t: "✅ Pronto — aguarda o garçom", c: "#1a7a3c", bg: "#e8f7ee" };

  return (
    <div style={{ marginBottom: 18 }}>
      <div className="c-titulo" style={{ fontSize: 17 }}>🍽️ Salão — pratos a preparar</div>
      <p className="c-sub" style={{ margin: "2px 0 10px" }}>
        Só aparecem os pratos da cozinha (aves, carnes, peixe, mariscos, fast food, entradas,
        petiscos, sobremesas…). As bebidas do bar não passam por aqui.
      </p>
      {q.isLoading && <p className="c-sub">A carregar…</p>}
      {!q.isLoading && pedidos.length === 0 && (
        <div className="c-card" style={{ textAlign: "center", padding: 18 }}>
          <div style={{ fontSize: 30 }}>🍳</div>
          <b style={{ fontSize: 14 }}>Sem pratos por preparar</b>
          <p className="c-sub" style={{ margin: "4px 0 0" }}>Quando um pedido com pratos for registado, aparece aqui com um sinal sonoro.</p>
        </div>
      )}
      {pedidos.map((p) => {
        const c = chip(p.cozinhaStatus);
        return (
          <div key={p.id} className="c-card" style={{ marginBottom: 10, border: `2px solid ${c.c}`, background: c.bg }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <b style={{ fontSize: 15 }}>
                Pedido nº {p.numero}{p.referencia ? ` · ${p.referencia}` : ""}
              </b>
              <span className="c-sub" style={{ fontSize: 11 }}>{horaBR(p.criadoEm)}</span>
            </div>
            {p.area && <div className="c-sub" style={{ fontSize: 12 }}>📍 {p.area}</div>}
            <div style={{
              display: "inline-block", margin: "6px 0", padding: "3px 10px", borderRadius: 20,
              background: c.c, color: "#fff", fontSize: 12, fontWeight: 800,
            }}>{c.t}</div>
            {p.itens.map((i) => (
              <div key={i.id} style={{
                background: "#fff", borderRadius: 10, padding: "8px 10px", marginBottom: 6,
                border: "1px solid #eee", fontSize: 14.5, fontWeight: 700,
              }}>
                {i.personalizado ? "✳️ " : ""}{i.qtd}× {i.nome}
                {i.obs && <div style={{ fontSize: 12, color: "var(--verde-c)", fontWeight: 600 }}>🍽 {i.obs}</div>}
              </div>
            ))}
            <button className="c-btn c-btn-cinza c-btn-bloco" style={{ marginBottom: 6 }}
              onClick={() => printDoc(`Comanda Cozinha — Pedido nº ${p.numero}`, comandaHtml({
                titulo: "COMANDA — COZINHA",
                origem: `Pedido nº ${p.numero}${p.referencia ? ` — ${p.referencia}` : ""}`,
                extra: p.area,
                itens: p.itens,
                emp,
              }))}>
              🖨️ Imprimir comanda
            </button>
            {p.cozinhaStatus === "Pendente" && (
              <button className="c-btn c-btn-prim c-btn-bloco" disabled={iniciar.isPending}
                onClick={() => user && iniciar.mutate({ usuarioId: user.id, pedidoId: p.id })}>
                {iniciar.isPending ? "…" : "👨‍🍳 Iniciar preparo"}
              </button>
            )}
            {p.cozinhaStatus === "Em Preparo" && (
              <button className="c-btn c-btn-verde c-btn-bloco" disabled={pronto.isPending}
                onClick={() => user && pronto.mutate({ usuarioId: user.id, pedidoId: p.id })}>
                {pronto.isPending ? "…" : "🍽️ Marcar como PRONTO (avisar o garçom)"}
              </button>
            )}
            {p.cozinhaStatus === "Pronto" && (user?.perfil !== "Cozinha") && (
              <button className="c-btn c-btn-linha c-btn-bloco" disabled={levantado.isPending}
                onClick={() => user && levantado.mutate({ usuarioId: user.id, pedidoId: p.id })}>
                {levantado.isPending ? "…" : "🤝 Levantado pelo garçom (limpar sinal)"}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
