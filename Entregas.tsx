/** Página do ENTREGADOR — simples e directa: só pedidos online de delivery.
    Solicitações novas chegam com som; o primeiro a aceitar fica com a entrega. */
import { useEffect, useRef, useState } from "react";
import { trpc } from "@/providers/trpc";
import { useSession } from "@/lib/session";
import { mt } from "@/lib/fmt";
import { Vazio } from "@/components/bits";
import { somNovoPedido } from "@/lib/som";

const RECUSADAS_KEY = "camis_entregas_recusadas";

function recusadas(): number[] {
  try { return JSON.parse(localStorage.getItem(RECUSADAS_KEY) ?? "[]"); } catch { return []; }
}

export default function Entregas() {
  const { user, toast } = useSession();
  const utils = trpc.useUtils();
  const [rec, setRec] = useState<number[]>(recusadas());
  const vistos = useRef<Set<number>>(new Set());

  const painel = trpc.entregas.painel.useQuery(
    { usuarioId: user?.id ?? 0 },
    { enabled: !!user, refetchInterval: 15000, retry: false },
  );

  // som quando chega uma solicitação NOVA
  useEffect(() => {
    const ab = painel.data?.abertas ?? [];
    const novas = ab.filter((s) => !vistos.current.has(s.id));
    if (novas.length && vistos.current.size > 0) somNovoPedido();
    ab.forEach((s) => vistos.current.add(s.id));
  }, [painel.data]);

  const aceitar = trpc.entregas.aceitar.useMutation({
    onSuccess: () => { toast("✅ Entrega sua! Boa viagem."); utils.entregas.painel.invalidate(); },
    onError: (e) => { toast("⚠️ " + e.message); utils.entregas.painel.invalidate(); },
  });
  const entregue = trpc.entregas.marcarEntregue.useMutation({
    onSuccess: () => { toast("✔️ Entrega concluída. Obrigado!"); utils.entregas.painel.invalidate(); },
    onError: (e) => toast("⚠️ " + e.message),
  });

  const recusar = (id: number) => {
    const l = [...rec, id];
    setRec(l);
    try { localStorage.setItem(RECUSADAS_KEY, JSON.stringify(l)); } catch { /* ignore */ }
  };

  const abertas = (painel.data?.abertas ?? []).filter((s) => !rec.includes(s.id));
  const minhas = painel.data?.minhas ?? [];

  return (
    <div>
      <div className="c-titulo">🛵 As minhas entregas</div>
      <p className="c-sub">
        Mantenha esta página aberta para ficar <b>online</b> e receber solicitações do restaurante com som.
        O primeiro a aceitar fica com a entrega.
      </p>

      <div className="c-card" style={{ background: "#eef7ee" }}>
        <b>🟢 Está online</b> — o restaurante já o pode chamar para entregas.
      </div>

      {minhas.length > 0 && (
        <div className="c-card" style={{ border: "2px solid var(--roxo)" }}>
          <div className="c-titulo" style={{ fontSize: 15 }}>📦 Entregas atribuídas a si</div>
          {minhas.map((m) => (
            <div key={m.solicitacaoId} className="c-card" style={{ margin: "8px 0" }}>
              <div className="c-linha">
                <div className="grow tit">🧾 {m.codigo} — {m.clienteNome}</div>
                <span className="c-chip c-chip-verde">{mt(m.taxa)}</span>
              </div>
              <p className="c-sub" style={{ margin: "4px 0" }}>📍 {m.endereco}</p>
              <p className="c-sub" style={{ margin: "4px 0" }}>{m.itens.join(" · ")}</p>
              <p className="c-sub" style={{ margin: "4px 0" }}>Estado do pedido: <b>{m.status}</b> · Total: <b>{mt(m.total)}</b></p>
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <a className="c-btn c-btn-linha grow" href={`tel:${m.clienteTelefone.replace(/\s/g, "")}`}>
                  📞 Ligar ao cliente
                </a>
                <button className="c-btn c-btn-verde grow" disabled={entregue.isPending}
                  onClick={() => user && entregue.mutate({ usuarioId: user.id, pedidoOnlineId: m.pedidoId })}>
                  ✅ Entregue
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="c-card">
        <div className="c-titulo" style={{ fontSize: 15 }}>🔔 Solicitações do restaurante</div>
        {painel.isLoading && <Vazio icon="⏳">A procurar solicitações…</Vazio>}
        {!painel.isLoading && abertas.length === 0 && (
          <Vazio icon="📭">Sem solicitações de momento. Fique online — avisamos com som.</Vazio>
        )}
        {abertas.map((s) => (
          <div key={s.id} className="c-card" style={{ margin: "8px 0", border: "2px solid var(--amarelo,#e6a700)" }}>
            <div className="c-linha">
              <div className="grow tit">🧾 Pedido {s.codigo}</div>
              <span className="c-chip c-chip-verde">{mt(s.taxa)}</span>
            </div>
            <p className="c-sub" style={{ margin: "4px 0" }}>📍 {s.bairro}</p>
            <p className="c-sub" style={{ margin: "4px 0" }}>Estado do pedido: <b>{s.estadoPedido}</b></p>
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button className="c-btn c-btn-prim grow" disabled={aceitar.isPending}
                onClick={() => user && aceitar.mutate({ usuarioId: user.id, id: s.id })}>
                ✅ Aceitar ({mt(s.taxa)})
              </button>
              <button className="c-btn c-btn-cinza grow" onClick={() => recusar(s.id)}>
                ✖️ Recusar
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
