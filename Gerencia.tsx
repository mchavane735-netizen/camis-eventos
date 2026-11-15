import { useMemo, useState } from "react";
import { trpc } from "@/providers/trpc";
import { useSession } from "@/lib/session";
import { mt, hoje } from "@/lib/fmt";
import { Vazio, Voltar } from "@/components/bits";

type ItemSel = { produtoId: number; nome: string; preco: number; qtd: number };

/** Conta Gerência — consumo dos proprietários.
    O stock é SEMPRE descontado, mesmo sem pagamento; se pago, entra nas receitas. */
export default function Gerencia({ voltar }: { voltar: () => void }) {
  const { user, toast } = useSession();
  const utils = trpc.useUtils();
  const produtos = trpc.produtos.list.useQuery({ leve: true }, { staleTime: 120_000 });
  const lista = trpc.gerencia.list.useQuery({ usuarioId: user?.id ?? 0 }, { enabled: !!user });

  const [itens, setItens] = useState<ItemSel[]>([]);
  const [prodId, setProdId] = useState(0);
  const [qtd, setQtd] = useState(1);
  const [pago, setPago] = useState(false);
  const [metodo, setMetodo] = useState("Dinheiro");
  const [obs, setObs] = useState("");
  const [dataCons, setDataCons] = useState(hoje());
  const [pagarId, setPagarId] = useState<number | null>(null);
  const [metodoPago, setMetodoPago] = useState("Dinheiro");

  const activos = useMemo(
    () => (produtos.data ?? []).filter((p) => p.ativo).sort((a, b) => a.nome.localeCompare(b.nome)),
    [produtos.data],
  );
  const total = itens.reduce((a, i) => a + i.qtd * i.preco, 0);

  const registar = trpc.gerencia.registar.useMutation({
    onSuccess: (r) => {
      toast(`✅ Consumo ${r.codigo} registado (${mt(r.total)}) — stock descontado${pago ? " e valor nas receitas" : ""}.`);
      setItens([]); setObs(""); setPago(false); setProdId(0); setQtd(1); setDataCons(hoje());
      utils.gerencia.list.invalidate(); utils.produtos.list.invalidate();
    },
    onError: (e) => toast("⚠️ " + e.message),
  });
  const marcarPago = trpc.gerencia.marcarPago.useMutation({
    onSuccess: () => {
      toast("✅ Consumo marcado como pago — entrou nas receitas.");
      setPagarId(null); utils.gerencia.list.invalidate();
    },
    onError: (e) => toast("⚠️ " + e.message),
  });

  const addItem = () => {
    const p = activos.find((x) => x.id === prodId);
    if (!p) return;
    setItens((l) => {
      const i = l.findIndex((x) => x.produtoId === p.id);
      if (i >= 0) { const c = [...l]; c[i] = { ...c[i], qtd: c[i].qtd + qtd }; return c; }
      return [...l, { produtoId: p.id, nome: p.nome, preco: p.preco, qtd }];
    });
    setProdId(0); setQtd(1);
  };

  return (
    <div>
      <Voltar onClick={voltar} />
      <div className="c-titulo">👔 Conta Gerência</div>
      <p className="c-sub" style={{ marginTop: -6 }}>
        Registe aqui o consumo dos proprietários/gerência — <b>inclusive consumos atrasados</b>:
        escolha a data real do consumo. O <b>stock é sempre descontado</b>,
        mesmo quando o consumo não é pago. Se for pago (agora ou mais tarde), o valor passa para as receitas.
      </p>

      {/* --- registar consumo --- */}
      <div className="c-card">
        <div className="c-titulo" style={{ fontSize: 15 }}>🍽️ Registar consumo</div>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
          <div style={{ flex: 1 }}>
            <label className="c-label">Produto</label>
            <select className="c-select" value={prodId} onChange={(e) => setProdId(+e.target.value)}>
              <option value={0}>— escolher —</option>
              {activos.map((p) => <option key={p.id} value={p.id}>{p.nome} · {mt(p.preco)}</option>)}
            </select>
          </div>
          <div style={{ width: 76 }}>
            <label className="c-label">Qtd</label>
            <input className="c-input" type="number" min={1} value={qtd}
              onChange={(e) => setQtd(Math.max(1, Math.round(+e.target.value || 1)))} />
          </div>
          <button className="c-btn c-btn-prim" style={{ height: 42 }} onClick={addItem} disabled={!prodId}>＋</button>
        </div>

        {itens.map((i, k) => (
          <div key={k} className="c-linha" style={{ borderBottom: "1px solid #f0e6f2" }}>
            <div className="grow tit">{i.qtd}× {i.nome}</div>
            <b>{mt(i.qtd * i.preco)}</b>
            <button className="c-btn c-btn-linha c-btn-peq" style={{ color: "var(--vermelho-c)" }}
              onClick={() => setItens((l) => l.filter((_, x) => x !== k))}>✕</button>
          </div>
        ))}
        {itens.length > 0 && (
          <div className="c-total-linha grande"><span>TOTAL</span><span>{mt(total)}</span></div>
        )}

        <label className="c-label">Quem consumiu / observação (opcional)</label>
        <input className="c-input" placeholder="Ex.: Almoço do proprietário com a família"
          value={obs} onChange={(e) => setObs(e.target.value)} maxLength={255} />

        <label className="c-label">📅 Data do consumo</label>
        <input className="c-input" type="date" max={hoje()} value={dataCons}
          onChange={(e) => setDataCons(e.target.value || hoje())} />
        {dataCons < hoje() ? (
          <p className="c-sub" style={{ fontSize: 11.5, marginTop: 2, color: "var(--amarelo-c, #9a6a00)" }}>
            ⏪ <b>Consumo atrasado</b> — fica registado com a data {dataCons.split("-").reverse().join("/")}
            e o stock é descontado agora.{pago ? " A receita conta no dia do consumo." : ""}
          </p>
        ) : (
          <p className="c-sub" style={{ fontSize: 11.5, marginTop: 2 }}>
            Para lançar um consumo de um dia anterior, escolha essa data.
          </p>
        )}

        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <button type="button" className={"c-btn " + (!pago ? "c-btn-prim" : "c-btn-cinza")} style={{ flex: 1 }}
            onClick={() => setPago(false)}>📝 Não pago</button>
          <button type="button" className={"c-btn " + (pago ? "c-btn-verde" : "c-btn-cinza")} style={{ flex: 1 }}
            onClick={() => setPago(true)}>💵 Pago</button>
        </div>
        {pago && (
          <>
            <label className="c-label">Método de pagamento</label>
            <select className="c-select" value={metodo} onChange={(e) => setMetodo(e.target.value)}>
              <option>Dinheiro</option><option>Transferência eMola</option><option>Levantamento eMola</option><option>FNB</option>
            </select>
          </>
        )}
        <button className="c-btn c-btn-verde c-btn-bloco" style={{ marginTop: 12 }}
          disabled={registar.isPending || itens.length === 0}
          onClick={() => user && registar.mutate({
            usuarioId: user.id,
            itens: itens.map((i) => ({ produtoId: i.produtoId, qtd: i.qtd })),
            pago, metodo: pago ? metodo : undefined, obs: obs || undefined,
            dataConsumo: dataCons,
          })}>
          {registar.isPending ? "A registar…" : `✅ Registar consumo — ${mt(total)}`}
        </button>
      </div>

      {/* --- totais --- */}
      {lista.data && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 10 }}>
          <div className="c-card" style={{ textAlign: "center", padding: 10 }}>
            <div className="c-sub" style={{ margin: 0 }}>Consumo total</div>
            <b style={{ fontSize: 15 }}>{mt(lista.data.totGeral)}</b>
          </div>
          <div className="c-card" style={{ textAlign: "center", padding: 10 }}>
            <div className="c-sub" style={{ margin: 0 }}>Pago</div>
            <b style={{ fontSize: 15, color: "var(--verde-c)" }}>{mt(lista.data.totPago)}</b>
          </div>
          <div className="c-card" style={{ textAlign: "center", padding: 10 }}>
            <div className="c-sub" style={{ margin: 0 }}>Não pago</div>
            <b style={{ fontSize: 15, color: "var(--vermelho-c)" }}>{mt(lista.data.totPorPagar)}</b>
          </div>
        </div>
      )}

      {/* --- histórico --- */}
      <div className="c-titulo" style={{ fontSize: 15 }}>🧾 Histórico</div>
      {(lista.data?.rows ?? []).length === 0 && <Vazio icon="🍽️">Ainda não há consumos registados.</Vazio>}
      {(lista.data?.rows ?? []).map((g) => (
        <div key={g.id} className="c-card" style={{ padding: 12 }}>
          <div className="c-linha">
            <div className="grow tit">
              {g.codigo} — {g.dataConsumo ? g.dataConsumo.split("-").reverse().join("/") : new Date(g.criadoEm).toLocaleDateString("pt-PT")}
              {g.dataConsumo && g.dataConsumo !== new Date(new Date(g.criadoEm).getTime() + 2 * 3600e3).toISOString().slice(0, 10) && (
                <span className="c-chip c-chip-amarelo" style={{ fontSize: 10, marginLeft: 6 }}>⏪ atrasado</span>
              )}
            </div>
            <b>{mt(g.total)}</b>
            <span className={"c-chip " + (g.pago ? "c-chip-verde" : "c-chip-amarelo")} style={{ fontSize: 11 }}>
              {g.pago ? `Pago · ${g.metodo ?? ""}` : "Não pago"}
            </span>
          </div>
          <div className="c-sub" style={{ margin: "4px 0 0" }}>
            {g.itens.map((i) => `${i.qtd}× ${i.nome}`).join(", ")}
          </div>
          <div className="c-sub" style={{ margin: "2px 0 0" }}>
            Registado por {g.usuarioNome}{g.obs ? ` · ${g.obs}` : ""}
          </div>
          {!g.pago && (
            pagarId === g.id ? (
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <select className="c-select" style={{ flex: 1 }} value={metodoPago} onChange={(e) => setMetodoPago(e.target.value)}>
                  <option>Dinheiro</option><option>Transferência eMola</option><option>Levantamento eMola</option><option>FNB</option>
                </select>
                <button className="c-btn c-btn-verde c-btn-peq" disabled={marcarPago.isPending}
                  onClick={() => user && marcarPago.mutate({ usuarioId: user.id, id: g.id, metodo: metodoPago })}>
                  ✔️ Confirmar
                </button>
                <button className="c-btn c-btn-cinza c-btn-peq" onClick={() => setPagarId(null)}>✕</button>
              </div>
            ) : (
              <button className="c-btn c-btn-linha c-btn-bloco" style={{ marginTop: 8 }}
                onClick={() => { setPagarId(g.id); setMetodoPago("Dinheiro"); }}>
                💵 Marcar como pago (entra nas receitas)
              </button>
            )
          )}
        </div>
      ))}
    </div>
  );
}
