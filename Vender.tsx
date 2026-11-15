import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { trpc } from "@/providers/trpc";
import { useSession } from "@/lib/session";
import { fotoProduto } from "@/lib/fotos";
import { mt, fmt, horaBR, hoje, dataBR } from "@/lib/fmt";
import { Modal, Vazio } from "@/components/bits";
import MoneyInput from "@/components/MoneyInput";
import {
  METODOS_PAGAMENTO, DENOMS_MZN, IVA_MODOS, REF_TIPOS, AREAS_ESTAR, FORMAS_TROCO,
  type IvaModo,
} from "@contracts/types";
import { useEmpresa } from "@/lib/empresa";
import { printDoc, downloadPdf, reciboBodyHtml, comandaHtml, type DocData } from "@/lib/docprint";
import DocView from "@/components/Doc";

/** Quantidades fraccionárias (stock de aves, venda por kg): 9,75 em vez de 9.75 */
const fmtQtd = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(".", ",").replace(/0$/, ""));
import AcompSel, { temAcomp } from "@/components/AcompSel";

type PedidoFull = NonNullable<ReturnType<typeof useAbertos>["data"]>[number];
function useAbertos() { return trpc.pedidos.abertos.useQuery(undefined, { refetchInterval: 10000 }); }

export default function Vender() {
  const { user, toast } = useSession();
  const emp = useEmpresa();
  const utils = trpc.useUtils();
  const abertos = useAbertos();
  const produtos = trpc.produtos.list.useQuery(undefined, { staleTime: 120_000 });

  const [pedidoSel, setPedidoSel] = useState<number | null>(null);
  const [vendaRapidaOpen, setVendaRapidaOpen] = useState(false);
  // Identificação do pedido (referência, espaço, atendente, afiliado) — aparece DEPOIS da selecção dos produtos
  const [identOpen, setIdentOpen] = useState(false);
  const identMostrado = useRef<number | null>(null); // pedidoId para o qual já abriu automaticamente
  const [editInfo, setEditInfo] = useState(false);
  const [editRef, setEditRef] = useState("");
  const [editAtendente, setEditAtendente] = useState("");
  const [editAtendenteOutro, setEditAtendenteOutro] = useState("");
  const [transfOpen, setTransfOpen] = useState(false);
  const [transfMesa, setTransfMesa] = useState("");
  const [busca, setBusca] = useState("");
  const [cat, setCat] = useState("Todos");
  const [checkout, setCheckout] = useState(false);
  const [recibo, setRecibo] = useState<PedidoFull | null>(null);
  const [proformaOpen, setProformaOpen] = useState(false);
  const [extraOpen, setExtraOpen] = useState(false);
  const [acompProd, setAcompProd] = useState<{ id: number; nome: string; categoria: string; ingredientes?: string | null } | null>(null);
  const [kgProd, setKgProd] = useState<{ id: number; nome: string; preco: number } | null>(null);
  const [kgVal, setKgVal] = useState("1");
  const [acompObs, setAcompObs] = useState("");
  const [acompTxt, setAcompTxt] = useState("");
  const [docVer, setDocVer] = useState<DocData | null>(null);

  const invalidar = () => {
    utils.pedidos.abertos.invalidate();
    utils.produtos.list.invalidate();
    utils.dashboard.stats.invalidate();
  };

  /** Substitui um pedido na cache sem recarregar a lista inteira (resposta instantânea) */
  const aplicarPedido = (p: PedidoFull) =>
    utils.pedidos.abertos.setData(undefined, (old) => old?.map((x) => (x.id === p.id ? p : x)));

  const criar = trpc.pedidos.criar.useMutation({
    onSuccess: (p) => {
      invalidar(); setPedidoSel(p.id); identMostrado.current = null;
      toast(`Pedido nº ${p.numero} aberto — escolha os produtos`);
    },
    onError: (e) => toast("⚠️ " + e.message),
  });

  /* Garçom confirma que levantou os pratos prontos da cozinha */
  const levantar = trpc.pedidos.cozinhaLevantado.useMutation({
    onSuccess: () => { invalidar(); toast("🤝 Pratos levantados. Bom serviço!"); },
    onError: (e) => toast("⚠️ " + e.message),
  });

  const [flashItem, setFlashItem] = useState<number | null>(null); // feedback visual do toque no +/−
  const [histOpen, setHistOpen] = useState(false);

  /* ===== CORRECÇÃO DEFINITIVA DO SINAL "+" =====
     Cada toque fica numa CAMADA DE INCREMENTOS PENDENTES (por produto). A quantidade
     mostrada = último estado confirmado pelo servidor + toques ainda por confirmar.
     · respostas fora de ordem NUNCA mexem no ecrã (o ecrã não depende delas);
     · um toque que falha retira apenas o SEU incremento — os outros mantêm-se;
     · quando a lista relida do servidor chega, os toques confirmados saem da camada.
     Resultado: 5 toques mostram sempre 5 — nunca "volta para 3". */
  type Pend = { id: number; pedidoId: number; produtoId: number; delta: number; done: boolean };
  const pendentes = useRef<Pend[]>([]);
  const seqPend = useRef(0);
  const [, forcarPend] = useReducer((x: number) => x + 1, 0);
  const marcarFeito = (pid: number) => {
    const e = pendentes.current.find((p) => p.id === pid);
    if (e) e.done = true;
  };
  const removerPend = (pid: number) => {
    pendentes.current = pendentes.current.filter((p) => p.id !== pid);
    forcarPend();
  };

  const addItem = trpc.pedidos.addItem.useMutation({
    onMutate: ({ pedidoId, produtoId, qtd = 1 }) => {
      const pendId = ++seqPend.current;
      pendentes.current.push({ id: pendId, pedidoId, produtoId, delta: qtd, done: false });
      forcarPend();
      const prod = produtos.data?.find((x) => x.id === produtoId);
      if (prod && prod.tipo !== "Serviço")
        utils.produtos.list.setData(undefined, (old) =>
          old?.map((x) => (x.id === produtoId ? { ...x, estoqueAtual: x.estoqueAtual - qtd } : x)));
      return { pendId };
    },
    onError: (e, _v, ctx) => {
      if (ctx) removerPend(ctx.pendId); // falhou: retira SÓ este toque, os outros mantêm-se
      utils.produtos.list.invalidate();
      toast("⚠️ " + e.message);
    },
    onSettled: (_d, _e, _v, ctx) => {
      if (ctx) marcarFeito(ctx.pendId);
      utils.pedidos.abertos.invalidate();
    },
  });

  /* +/− por incremento (delta) — coberto pela mesma camada de toques pendentes */
  const bump = trpc.pedidos.bumpItem.useMutation({
    onMutate: ({ itemId, delta, produtoId, pedidoId }) => {
      setFlashItem(itemId);
      if (produtoId == null || pedidoId == null) return { pendId: null };
      const pendId = ++seqPend.current;
      pendentes.current.push({ id: pendId, pedidoId, produtoId, delta, done: false });
      forcarPend();
      return { pendId };
    },
    onError: (e, _v, ctx) => {
      if (ctx?.pendId != null) removerPend(ctx.pendId);
      else utils.pedidos.abertos.invalidate();
      toast("⚠️ " + e.message);
    },
    onSettled: (_d, _e, _v, ctx) => {
      if (ctx?.pendId != null) marcarFeito(ctx.pendId);
      utils.pedidos.abertos.invalidate();
    },
  });

  const addExtra = trpc.pedidos.addItemPersonalizado.useMutation({
    onSuccess: (p) => { aplicarPedido(p); setExtraOpen(false); toast("✳️ Pedido adicional acrescentado"); },
    onError: (e) => toast("⚠️ " + e.message),
  });
  const atendentes = trpc.pedidos.atendentesNomes.useQuery();
  const editarInfo = trpc.pedidos.editarInfo.useMutation({
    onSuccess: (p) => {
      utils.pedidos.abertos.setData(undefined, (old) => old?.map((x) => (x.id === p.id ? p : x)));
      setEditInfo(false); toast("✏️ Mesa/atendente actualizados");
    },
    onError: (e) => toast(e.message),
  });
  const transferir = trpc.pedidos.transferirMesa.useMutation({
    onSuccess: (p) => {
      utils.pedidos.abertos.setData(undefined, (old) => old?.map((x) => (x.id === p.id ? p : x)));
      setTransfOpen(false); setTransfMesa(""); toast("⇄ Pedido transferido — a referência mostra a mesa anterior");
    },
    onError: (e) => toast(e.message),
  });
  const setArea = trpc.pedidos.setArea.useMutation({
    onSuccess: aplicarPedido,
    onError: (e) => toast("⚠️ " + e.message),
  });
  const anular = trpc.pedidos.anular.useMutation({
    onSuccess: () => { invalidar(); setPedidoSel(null); toast("Pedido anulado"); },
    onError: (e) => toast("⚠️ " + e.message),
  });
  const anularFechado = trpc.pedidos.anularFechado.useMutation({
    onSuccess: () => { invalidar(); utils.pedidos.fechadosDia.invalidate(); utils.pagamentos.list.invalidate(); toast("Pedido cancelado — stock reposto e pagamento anulado"); },
    onError: (e) => toast("⚠️ " + e.message),
  });
  const eliminarPedido = trpc.pedidos.eliminar.useMutation({
    onSuccess: () => { invalidar(); utils.pedidos.fechadosDia.invalidate(); utils.pagamentos.list.invalidate(); toast("🗑 Pedido eliminado definitivamente"); },
    onError: (e) => toast("⚠️ " + e.message),
  });
  const fechar = trpc.pedidos.fechar.useMutation({
    onSuccess: (p) => { invalidar(); utils.pedidos.fechadosDia.invalidate(); setCheckout(false); setPedidoSel(null); setRecibo(p); },
    onError: (e) => toast("⚠️ " + e.message),
  });

  const pedido = abertos.data?.find((p) => p.id === pedidoSel) ?? null;

  // lista relida do servidor → os toques já confirmados saem da camada pendente
  const abertosEm = abertos.dataUpdatedAt;
  useEffect(() => {
    if (pendentes.current.some((p) => p.done)) {
      pendentes.current = pendentes.current.filter((p) => !p.done);
      forcarPend();
    }
  }, [abertosEm]);

  // itens mostrados = confirmados pelo servidor + camada de toques pendentes (nunca "volta para trás")
  const pendPorProd = new Map<number, number>();
  if (pedido)
    for (const p of pendentes.current)
      if (p.pedidoId === pedido.id)
        pendPorProd.set(p.produtoId, (pendPorProd.get(p.produtoId) ?? 0) + p.delta);
  const itensVis = !pedido ? [] : [
    ...pedido.itens
      .map((i) => {
        const extra = i.produtoId != null ? pendPorProd.get(i.produtoId) ?? 0 : 0;
        if (i.produtoId != null && extra !== 0) pendPorProd.delete(i.produtoId);
        return { ...i, qtdVis: Math.round((i.qtd + extra) * 100) / 100, pendente: false };
      })
      .filter((i) => i.qtdVis > 0),
    ...[...pendPorProd.entries()].filter(([, d]) => d > 0).map(([produtoId, d]) => {
      const pr = produtos.data?.find((x) => x.id === produtoId);
      return {
        id: -produtoId, pedidoId: pedido.id, produtoId,
        nome: pr?.nome ?? "…", categoria: pr?.categoria ?? "", precoUnit: pr?.preco ?? 0,
        qtd: 0, qtdVis: Math.round(d * 100) / 100, obs: null, pendente: true,
      };
    }),
  ];

  // a ficha de identificação (referência, espaço, atendente, afiliado — tudo opcional)
  // aparece DEPOIS da selecção dos produtos: abre sozinha ao adicionar o 1.º item
  const nItens = itensVis.length;
  useEffect(() => {
    if (pedido && nItens > 0 && !pedido.referencia && identMostrado.current !== pedido.id) {
      identMostrado.current = pedido.id;
      setIdentOpen(true);
    }
  }, [pedido?.id, nItens]);

  const cats = useMemo(
    () => ["Todos", ...new Set((produtos.data ?? []).map((p) => p.categoria))],
    [produtos.data],
  );
  const listaProd = useMemo(
    () => (produtos.data ?? []).filter(
      (p) => (cat === "Todos" || p.categoria === cat) &&
        (busca === "" || p.nome.toLowerCase().includes(busca) || p.categoria.toLowerCase().includes(busca)),
    ),
    [produtos.data, cat, busca],
  );

  /* ============ LISTA DE PEDIDOS ABERTOS ============ */
  if (!pedido) {
    return (
      <div>
        <div className="c-titulo">🛒 Pedidos do Dia</div>
        {/* ⚡ VENDA RÁPIDA — substitui as vendas ao balcão: pronto pagamento, sem mesa nem atendente */}
        <button
          className="c-btn c-btn-bloco"
          style={{ marginBottom: 10, background: "#c8891a", color: "#fff", fontWeight: 900, fontSize: 15 }}
          onClick={() => setVendaRapidaOpen(true)}
        >
          ⚡ Venda Rápida
        </button>
        <button className="c-btn c-btn-prim c-btn-bloco" style={{ marginBottom: 12 }}
          disabled={criar.isPending || !user}
          onClick={() => user && criar.mutate({ usuarioId: user.id })}>
          {criar.isPending ? "A abrir…" : "＋ Novo Pedido (mesa)"}
        </button>
        <p className="c-sub" style={{ marginBottom: 10 }}>
          <b>⚡ Venda Rápida</b>: escolhe os produtos e cobra na hora — sem mesa. <b>＋ Novo Pedido</b>: abre logo a selecção de produtos; a mesa/referência, o espaço e o atendente pedem-se <b>depois</b>, e são opcionais.
        </p>
        {abertos.isLoading && <Vazio icon="⏳">A carregar…</Vazio>}
        {abertos.data?.length === 0 && <Vazio icon="🧾">Sem pedidos abertos.<br />Crie o primeiro pedido do dia!</Vazio>}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(160px,1fr))", gap: 10 }}>
          {abertos.data?.map((p) => (
            <div key={p.id} className="c-pedido-card" onClick={() => setPedidoSel(p.id)}>
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <div className="c-pedido-num">{p.numero}</div>
                <div style={{ minWidth: 0 }}>
                  <b style={{ fontSize: 13.5, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {p.referencia || `Pedido ${p.numero}`}
                  </b>
                  <span className="c-sub" style={{ fontSize: 11 }}>{horaBR(p.criadoEm)} · {p.itens.reduce((a, i) => a + i.qtd, 0)} itens</span>
                </div>
              </div>
              {p.area && <div className="c-sub" style={{ fontSize: 11, marginTop: 4 }}>📍 {p.area}</div>}
              {p.atendente && <div className="c-sub" style={{ fontSize: 11, marginTop: 2 }}>👤 {p.atendente}</div>}
              {p.cozinhaStatus && (
                <div style={{
                  marginTop: 4, display: "inline-block", padding: "2px 8px", borderRadius: 14, fontSize: 10.5, fontWeight: 800,
                  background: p.cozinhaStatus === "Pronto" ? "#1a7a3c" : p.cozinhaStatus === "Em Preparo" ? "#b8860b" : "#b3261e",
                  color: "#fff",
                }}>
                  {p.cozinhaStatus === "Pendente" ? "🔔 Na cozinha (fila)"
                    : p.cozinhaStatus === "Em Preparo" ? "👨‍🍳 A preparar"
                    : "✅ PRONTO — levantar"}
                </div>
              )}
              <div style={{ marginTop: 6, fontWeight: 800, color: "var(--roxo)", fontSize: 15 }}>{mt(p.subtotal)}</div>
            </div>
          ))}
        </div>

        {vendaRapidaOpen && user && (
          <VendaRapida
            usuarioId={user.id}
            produtos={produtos.data ?? []}
            onClose={() => setVendaRapidaOpen(false)}
            onFechado={(pd) => {
              setVendaRapidaOpen(false);
              invalidar(); utils.pedidos.fechadosDia.invalidate(); utils.pagamentos.list.invalidate();
              setRecibo(pd);
            }}
          />
        )}

        {/* Pedidos fechados — Admin vê os itens e autoriza alterações; Gerente/Caixa pedem alteração */}
        {user && ["Admin", "Gestor", "Vendedor"].includes(user.perfil) && (
          <FechadosHoje
            isAdmin={user.perfil === "Admin"}
            perfil={user.perfil}
            usuarioId={user.id}
            onCancelar={(id) => user && anularFechado.mutate({ usuarioId: user.id, pedidoId: id })}
            onEliminar={(id) => user && eliminarPedido.mutate({ usuarioId: user.id, pedidoId: id })}
          />
        )}

        {recibo && <Recibo pedido={recibo} onClose={() => setRecibo(null)} onFactura={(d) => { setRecibo(null); setDocVer(d); }} />}
        {docVer && <DocView doc={docVer} onClose={() => setDocVer(null)} />}
      </div>
    );
  }

  /* ============ DENTRO DO PEDIDO ============ */
  const subtotal = itensVis.reduce((a, i) => a + i.qtdVis * i.precoUnit, 0);
  return (
    <div style={{ paddingBottom: 76 }}>
      {pedido.cozinhaStatus === "Pronto" && (
        <div className="c-card" style={{ marginBottom: 10, background: "#e8f7ee", border: "2px solid #1a7a3c" }}>
          <b style={{ fontSize: 14 }}>✅ Os pratos estão PRONTOS — pode levantar na cozinha!</b>
          <button className="c-btn c-btn-verde c-btn-bloco" style={{ marginTop: 8 }}
            disabled={levantar.isPending}
            onClick={() => user && levantar.mutate({ usuarioId: user.id, pedidoId: pedido.id })}>
            {levantar.isPending ? "…" : "🤝 Confirmar levantamento"}
          </button>
        </div>
      )}
      {pedido.cozinhaStatus === "Em Preparo" && (
        <p className="c-sub" style={{ margin: "0 0 8px", fontWeight: 700, color: "#b8860b" }}>👨‍🍳 A cozinha está a preparar os pratos deste pedido…</p>
      )}
      {pedido.cozinhaStatus === "Pendente" && (
        <p className="c-sub" style={{ margin: "0 0 8px", fontWeight: 700, color: "#b3261e" }}>🔔 Pedido enviado para a cozinha — na fila de preparo.</p>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
        <button className="c-btn c-btn-cinza c-btn-peq" onClick={() => setPedidoSel(null)}>← Pedidos</button>
        <div className="c-pedido-num" style={{ width: 34, height: 34, fontSize: 14 }}>{pedido.numero}</div>
        <div style={{ flex: 1, minWidth: 120 }}>
          <b style={{ fontSize: 14.5 }}>Pedido nº {pedido.numero}</b>
          <div className="c-sub" style={{ fontSize: 11 }}>
            {pedido.referencia || "sem referência"} · aberto às {horaBR(pedido.criadoEm)}
            {pedido.atendente ? ` · 👤 ${pedido.atendente}` : ""}
          </div>
          {pedido.referencia?.includes("⇄") && (
            <div style={{ fontSize: 10.5, fontWeight: 800, color: "#8a5a00", background: "#fff3d6", display: "inline-block", padding: "1px 8px", borderRadius: 12, marginTop: 2 }}>
              ⇄ mesa transferida
            </div>
          )}
          <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
            {(user?.perfil === "Admin" || user?.podeEditarNomes || (!pedido.referencia && !pedido.atendente)) && (
              <button className="c-btn c-btn-linha c-btn-peq" style={{ padding: "2px 10px", fontSize: 11 }}
                title="Corrigir o nº da mesa / referência ou o atendente"
                onClick={() => {
                  setEditRef((pedido.referencia ?? "").split(" ⇄ antes:")[0]);
                  setEditAtendente(pedido.atendente ?? "");
                  setEditAtendenteOutro("");
                  setEditInfo(true);
                }}>
                ✏️ Mesa / atendente
              </button>
            )}
            <button className="c-btn c-btn-linha c-btn-peq" style={{ padding: "2px 10px", fontSize: 11 }}
              title="Transferir este pedido para outra mesa (mesas juntas)"
              onClick={() => { setTransfMesa(""); setTransfOpen(true); }}>
              ⇄ Transferir mesa
            </button>
            {(user?.perfil === "Admin" || user?.perfil === "Gestor") && (
              <button className="c-btn c-btn-linha c-btn-peq" style={{ padding: "2px 10px", fontSize: 11 }}
                title="Ver o histórico detalhado de tudo o que foi lançado neste pedido"
                onClick={() => setHistOpen(true)}>
                📜 Histórico
              </button>
            )}
          </div>
        </div>
        <button
          className="c-btn c-btn-linha c-btn-peq"
          disabled={pedido.itens.length === 0}
          title="Emitir Factura Pro-forma deste pedido"
          onClick={() => setProformaOpen(true)}
        >
          🧾 Pro-forma
        </button>
        <button
          className="c-btn c-btn-linha c-btn-peq"
          disabled={pedido.itens.length === 0}
          title="Imprimir comanda para o BALCÃO (todos os itens)"
          onClick={() => printDoc(`Comanda Balcão — Pedido nº ${pedido.numero}`, comandaHtml({
            titulo: "COMANDA — BALCÃO",
            origem: `Pedido nº ${pedido.numero} — ${pedido.dataDia}`,
            extra: [pedido.referencia, pedido.area].filter(Boolean).join(" · ") || null,
            itens: pedido.itens.map((i) => ({ nome: i.nome, qtd: i.qtd, obs: i.obs, personalizado: i.produtoId == null })),
            emp,
          }))}
        >
          🖨️ Balcão
        </button>
        <button
          className="c-btn c-btn-linha c-btn-peq"
          disabled={pedido.itens.length === 0}
          title="Imprimir comanda para a COZINHA (só os pratos)"
          onClick={() => {
            const refeicoes = new Set((produtos.data ?? []).filter((x) => x.tipo === "Refeição").map((x) => x.id));
            const itensCoz = pedido.itens.filter((i) => i.produtoId == null || refeicoes.has(i.produtoId));
            if (itensCoz.length === 0) { toast("Este pedido não tem pratos de cozinha."); return; }
            printDoc(`Comanda Cozinha — Pedido nº ${pedido.numero}`, comandaHtml({
              titulo: "COMANDA — COZINHA",
              origem: `Pedido nº ${pedido.numero} — ${pedido.dataDia}`,
              extra: [pedido.referencia, pedido.area].filter(Boolean).join(" · ") || null,
              itens: itensCoz.map((i) => ({ nome: i.nome, qtd: i.qtd, obs: i.obs, personalizado: i.produtoId == null })),
              emp,
            }));
          }}
        >
          🍳 Cozinha
        </button>
        {(user?.perfil === "Admin" || user?.perfil === "Gestor") && (
          <button className="c-btn c-btn-perigo c-btn-peq" onClick={() => user && anular.mutate({ usuarioId: user.id, pedidoId: pedido.id })}>
            Anular
          </button>
        )}
      </div>

      {/* espaço onde o cliente está sentado — alterável durante a estadia */}
      <div className="c-card" style={{ padding: "8px 14px", marginBottom: 10, display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 18 }}>📍</span>
        <select
          className="c-select" style={{ flex: 1, margin: 0 }}
          value={pedido.area ?? ""}
          disabled={setArea.isPending}
          onChange={(e) => setArea.mutate({ pedidoId: pedido.id, area: e.target.value || null })}
        >
          <option value="">Onde o cliente está sentado? (opcional)</option>
          {AREAS_ESTAR.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
      </div>

      {editInfo && (
        <Modal onClose={() => setEditInfo(false)}>
          <h3>✏️ Mesa / atendente — Pedido nº {pedido.numero}</h3>
          {pedido.referencia?.includes("⇄") && (
            <p className="c-sub" style={{ color: "#8a5a00", fontWeight: 700 }}>⇄ Este pedido foi transferido: {pedido.referencia}</p>
          )}
          <label className="c-label">Referência / nº da mesa</label>
          <input className="c-input" placeholder="Ex.: Mesa 5" value={editRef} onChange={(e) => setEditRef(e.target.value)} autoFocus />
          <label className="c-label" style={{ marginTop: 10 }}>👤 Quem está a atender?</label>
          <select className="c-select" value={editAtendente} onChange={(e) => setEditAtendente(e.target.value)}>
            <option value="">— Sem atendente definido —</option>
            {(atendentes.data ?? []).map((t) => <option key={t.nome} value={t.nome}>{t.nome} · {t.cargo}</option>)}
            <option value="__outro">➕ Outro nome (escrever)…</option>
          </select>
          {editAtendente === "__outro" && (
            <input className="c-input" style={{ marginTop: 6 }} placeholder="Nome do funcionário"
              value={editAtendenteOutro} onChange={(e) => setEditAtendenteOutro(e.target.value)} />
          )}
          <button className="c-btn c-btn-prim c-btn-bloco" style={{ marginTop: 14 }}
            disabled={editarInfo.isPending}
            onClick={() => user && editarInfo.mutate({
              usuarioId: user.id, pedidoId: pedido.id,
              referencia: editRef.trim(),
              atendente: editAtendente === "__outro" ? editAtendenteOutro.trim() : editAtendente,
            })}>
            {editarInfo.isPending ? "A guardar…" : "💾 Guardar"}
          </button>
        </Modal>
      )}

      {transfOpen && (
        <Modal onClose={() => setTransfOpen(false)}>
          <h3>⇄ Transferir para outra mesa</h3>
          <p className="c-sub">
            Pedido nº {pedido.numero} está em <b>{(pedido.referencia ?? "").split(" ⇄ antes:")[0] || "sem mesa"}</b>.
            Quando duas mesas se juntam, transfira o pedido para a mesa principal — a referência ficará marcada
            com «⇄ antes: …» para todos saberem de onde veio.
          </p>
          <label className="c-label">Mesa / referência de destino</label>
          <input className="c-input" placeholder="Ex.: Mesa 8" value={transfMesa} onChange={(e) => setTransfMesa(e.target.value)} autoFocus />
          <button className="c-btn c-btn-prim c-btn-bloco" style={{ marginTop: 14 }}
            disabled={transferir.isPending || !transfMesa.trim()}
            onClick={() => user && transferir.mutate({ usuarioId: user.id, pedidoId: pedido.id, novaReferencia: transfMesa.trim() })}>
            {transferir.isPending ? "A transferir…" : "⇄ Transferir pedido"}
          </button>
        </Modal>
      )}

      {/* itens do pedido */}
      <div className="c-card" style={{ padding: "8px 14px" }}>
        {itensVis.length === 0 && <div className="c-sub" style={{ padding: "10px 0", textAlign: "center" }}>Pedido vazio — adicione produtos abaixo 👇</div>}
        {itensVis.map((i) => (
          <div key={i.id} style={{ display: "flex", alignItems: "center", gap: 9, padding: "9px 0", borderBottom: "1px dashed #eadff0" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 600 }}>
                {i.produtoId == null && <span title="Pedido adicional (fora do menu)">✳️ </span>}{i.nome}
              </div>
              <div className="c-sub" style={{ fontSize: 11 }}>{mt(i.precoUnit)} / un.{i.produtoId == null ? " · fora do menu" : ""}</div>
              {i.obs && <div style={{ fontSize: 11.5, color: "var(--verde-c)", fontWeight: 600 }}>🍽 {i.obs}</div>}
            </div>
            <div className="c-qty">
              {(() => {
                const pr = produtos.data?.find((x) => x.id === i.produtoId);
                const passo = pr?.qtdDecimal ? 0.25 : 1;
                return (
                  <>
                    <button disabled={i.pendente} title={i.pendente ? "A confirmar…" : "Diminuir"}
                      onClick={() => bump.mutate({ itemId: i.id, delta: -passo, usuarioId: user?.id, produtoId: i.produtoId ?? undefined, pedidoId: pedido.id })}>−</button>
                    <span key={`${i.id}-${i.qtdVis}`} className={flashItem === i.id ? "qty-flash" : ""}>{fmtQtd(i.qtdVis)}{pr?.qtdDecimal ? " kg" : ""}</span>
                    <button disabled={i.pendente} title={i.pendente ? "A confirmar…" : "Aumentar"}
                      onClick={() => bump.mutate({ itemId: i.id, delta: passo, usuarioId: user?.id, produtoId: i.produtoId ?? undefined, pedidoId: pedido.id })}>+</button>
                  </>
                );
              })()}
            </div>
            <div style={{ width: 74, textAlign: "right", fontWeight: 800, fontSize: 13.5, color: "var(--roxo)" }}>{mt(i.qtdVis * i.precoUnit)}</div>
          </div>
        ))}
        {itensVis.length > 0 && (
          <div className="c-total-linha grande"><span>TOTAL</span><span>{mt(subtotal)}</span></div>
        )}
      </div>

      {/* pedido adicional fora do menu */}
      <button className="c-btn c-btn-linha c-btn-bloco" style={{ margin: "10px 0" }} onClick={() => setExtraOpen(true)}>
        ✳️ Pedido adicional (fora do menu)…
      </button>

      {/* grelha de produtos */}
      <div style={{ position: "relative", marginBottom: 12 }}>
        <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", fontSize: 15, opacity: .6 }}>🔍</span>
        <input className="c-input" style={{ paddingLeft: 38 }} placeholder="Pesquisar produto…" value={busca}
          onChange={(e) => setBusca(e.target.value.toLowerCase())} />
      </div>
      <div className="c-cats">
        {cats.map((c) => (
          <button key={c} className={c === cat ? "ativo" : ""} onClick={() => setCat(c)}>{c}</button>
        ))}
      </div>
      {/* linhas compactas por categoria — como um menu de botões: categoria em cima, produtos por baixo */}
      <div className="c-card" style={{ padding: "4px 10px" }}>
        {listaProd.length === 0 && <Vazio icon="🔍">Nenhum produto nesta categoria/pesquisa.</Vazio>}
        {listaProd.map((p) => {
          const serv = p.tipo === "Serviço";
          const baixo = !serv && p.estoqueAtual <= p.estoqueMin;
          const semStock = !serv && p.estoqueAtual <= 0;
          return (
            <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px dashed #eadff0" }}>
              <img src={fotoProduto(p)} alt="" loading="lazy"
                style={{ width: 42, height: 42, borderRadius: 10, objectFit: "cover", flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.nome}</div>
                <div className="c-sub" style={{ fontSize: 11 }}>
                  {mt(p.preco)}{p.qtdDecimal ? " /kg" : " /un"}
                  {!serv && <> · <span style={{ color: baixo ? "var(--amarelo-c)" : "var(--verde-c)", fontWeight: 700 }}>
                    {semStock ? "❌ esgotado" : baixo ? `⚠️ só ${fmtQtd(p.estoqueAtual)}` : `${fmtQtd(p.estoqueAtual)} em stock`}
                  </span></>}
                  {serv && " · Serviço"}
                </div>
              </div>
              <button className="padd" style={{ position: "static", width: 40, height: 40, fontSize: 20, flexShrink: 0 }}
                disabled={semStock}
                onClick={() => p.qtdDecimal
                  ? (setKgVal("1"), setKgProd({ id: p.id, nome: p.nome, preco: p.preco }))
                  : temAcomp(p.categoria) || p.ingredientes
                    ? (setAcompTxt(""), setAcompProd(p))
                    : addItem.mutate({ pedidoId: pedido.id, produtoId: p.id, qtd: 1, usuarioId: user?.id })}>+</button>
            </div>
          );
        })}
      </div>

      {/* barra fixa de fecho */}
      <div style={{
        position: "fixed", bottom: 64, left: 0, right: 0, zIndex: 35, padding: "10px 14px",
        background: "rgba(255,255,255,.96)", boxShadow: "0 -3px 16px rgba(0,0,0,.12)",
        display: "flex", gap: 10, alignItems: "center", maxWidth: 760, margin: "0 auto",
      }}>
        <div style={{ flex: 1 }}>
          <div className="c-sub" style={{ fontSize: 10.5 }}>TOTAL DO PEDIDO</div>
          <b style={{ fontSize: 18, color: "var(--roxo)" }}>{mt(subtotal)}</b>
        </div>
        <button className="c-btn c-btn-linha" title="Referência/mesa, espaço, atendente e afiliado (tudo opcional)"
          onClick={() => setIdentOpen(true)}>
          🪑
        </button>
        <button className="c-btn c-btn-verde" disabled={pedido.itens.length === 0} onClick={() => setCheckout(true)}>
          💳 Fechar Conta
        </button>
      </div>

      {/* venda a peso (kg) — carne de porco/vaca: quantidade decimal */}
      {kgProd && (
        <Modal onClose={() => setKgProd(null)}>
          <h3>⚖️ {kgProd.nome}</h3>
          <p className="c-sub">Produto vendido <b>por quilo</b> ({mt(kgProd.preco)}/kg). Indique o peso:</p>
          <div style={{ display: "flex", alignItems: "center", gap: 12, justifyContent: "center", margin: "10px 0" }}>
            <button className="c-btn c-btn-cinza" style={{ width: 44, fontSize: 18 }}
              onClick={() => setKgVal((v) => Math.max(0.25, Math.round((parseFloat(v.replace(",", ".")) || 0) * 4 - 1) / 4).toString().replace(".", ","))}>−</button>
            <input className="c-input" style={{ width: 110, textAlign: "center", fontSize: 20, fontWeight: 800 }}
              inputMode="decimal" value={kgVal}
              onChange={(e) => setKgVal(e.target.value.replace(/[^\d,.]/g, ""))} />
            <button className="c-btn c-btn-cinza" style={{ width: 44, fontSize: 18 }}
              onClick={() => setKgVal((v) => (Math.round((parseFloat(v.replace(",", ".")) || 0) * 4 + 1) / 4).toString().replace(".", ","))}>+</button>
            <b>kg</b>
          </div>
          <div className="c-total-linha grande"><span>TOTAL DESTE ITEM</span><span>{mt((parseFloat(kgVal.replace(",", ".")) || 0) * kgProd.preco)}</span></div>
          <button className="c-btn c-btn-prim c-btn-bloco" style={{ marginTop: 12 }}
            disabled={addItem.isPending || !(parseFloat(kgVal.replace(",", ".")) > 0)}
            onClick={() => {
              addItem.mutate({ pedidoId: pedido.id, produtoId: kgProd.id, qtd: parseFloat(kgVal.replace(",", ".")), usuarioId: user?.id });
              setKgProd(null);
            }}>
            ✅ Adicionar ao pedido
          </button>
        </Modal>
      )}

      {acompProd && (
        <Modal onClose={() => setAcompProd(null)}>
          <h3>🍽 {acompProd.nome}</h3>
          {acompProd.ingredientes && (
            <p className="c-sub" style={{ background: "var(--lilas)", borderRadius: 10, padding: "6px 10px" }}>
              🧾 <b>Ingredientes:</b> {acompProd.ingredientes}
            </p>
          )}
          {temAcomp(acompProd.categoria) && (
            <>
              <p className="c-sub">Escolha os acompanhamentos do prato:</p>
              <AcompSel categoria={acompProd.categoria} onChange={setAcompObs} />
            </>
          )}
          <label className="c-label">Acompanhantes / ingredientes (opcional)</label>
          <textarea className="c-input" rows={2} maxLength={200}
            placeholder="Ex.: extra queijo, sem cebola, c/ batata frita…"
            value={acompTxt} onChange={(e) => setAcompTxt(e.target.value)} />
          <button className="c-btn c-btn-prim c-btn-bloco" style={{ marginTop: 12 }}
            disabled={addItem.isPending}
            onClick={() => {
              const obs = [acompObs, acompTxt.trim()].filter(Boolean).join(" · ").slice(0, 255);
              addItem.mutate({ pedidoId: pedido.id, produtoId: acompProd.id, qtd: 1, obs: obs || undefined, usuarioId: user?.id });
              setAcompProd(null); setAcompObs(""); setAcompTxt("");
            }}>
            ✅ Adicionar ao pedido
          </button>
        </Modal>
      )}

      {extraOpen && user && (
        <ExtraModal
          pendente={addExtra.isPending}
          onClose={() => setExtraOpen(false)}
          onAdd={(nome, preco, qtd) => addExtra.mutate({ usuarioId: user.id, pedidoId: pedido.id, nome, preco, qtd })}
        />
      )}

      {histOpen && user && (
        <HistoricoItensModal pedido={pedido} usuarioId={user.id} onClose={() => setHistOpen(false)} />
      )}

      {identOpen && user && (
        <IdentPedidoModal pedido={pedido} usuarioId={user.id} onClose={() => setIdentOpen(false)} />
      )}

      {checkout && (
        <Checkout
          pedido={pedido}
          onClose={() => setCheckout(false)}
          onConfirm={(desconto, partes, recebido, trocoPartes, dataLanc, divida) =>
            user && fechar.mutate({
              usuarioId: user.id, pedidoId: pedido.id, desconto, recebido,
              metodo: partes[0]?.metodo ?? "Dinheiro", partes, trocoPartes,
              dataDia: dataLanc && dataLanc !== hoje() ? dataLanc : undefined,
              dividaNome: divida?.nome, dividaTel: divida?.tel,
            })}
          pendente={fechar.isPending}
        />
      )}

      {proformaOpen && (
        <ProformaModal
          pedido={pedido}
          onClose={() => setProformaOpen(false)}
          onGerado={(d) => { setProformaOpen(false); setPedidoSel(null); setDocVer(d); }}
        />
      )}
      {docVer && <DocView doc={docVer} onClose={() => setDocVer(null)} />}
    </div>
  );
}

/* ============ IDENTIFICAÇÃO DO PEDIDO (depois da selecção — tudo opcional) ============ */
function IdentPedidoModal({ pedido, usuarioId, onClose }: {
  pedido: PedidoFull; usuarioId: number; onClose: () => void;
}) {
  const { toast } = useSession();
  const utils = trpc.useUtils();
  const atendentes = trpc.pedidos.atendentesNomes.useQuery();
  const refIni = (pedido.referencia ?? "").split(" ⇄ antes:")[0];
  const tipoIni = REF_TIPOS.find((t) => refIni.startsWith(t + " ")) ?? "";
  const [refTipo, setRefTipo] = useState(tipoIni);
  const [refTexto, setRefTexto] = useState(tipoIni ? refIni.slice(tipoIni.length + 1) : refIni);
  const [area, setArea] = useState(pedido.area ?? "");
  const [atendente, setAtendente] = useState(pedido.atendente ?? "");
  const [atendenteOutro, setAtendenteOutro] = useState("");
  const [af, setAf] = useState("");

  const guardar = trpc.pedidos.editarInfo.useMutation({
    onSuccess: (pd) => {
      utils.pedidos.abertos.setData(undefined, (old) => old?.map((x) => (x.id === pd.id ? pd : x)));
      toast("🪑 Identificação guardada"); onClose();
    },
    onError: (e) => toast("⚠️ " + e.message),
  });

  const gravar = () => {
    const referencia = [refTipo, refTexto.trim()].filter(Boolean).join(" ");
    const at = atendente === "__outro" ? atendenteOutro.trim() : atendente;
    guardar.mutate({
      usuarioId, pedidoId: pedido.id,
      referencia, atendente: at, area,
      afiliadoCodigo: af.trim() || undefined,
    });
  };

  return (
    <Modal onClose={onClose}>
      <h3>🪑 Identificação — Pedido nº {pedido.numero}</h3>
      <p className="c-sub">
        Os produtos já estão escolhidos. Se quiser, identifique a mesa/referência, o espaço e quem atende —
        <b> tudo opcional</b>; pode preencher agora, mais tarde (botão 🪑 na barra inferior) ou nunca.
      </p>
      <label className="c-label">Referência (opcional)</label>
      <div style={{ display: "grid", gridTemplateColumns: "132px 1fr", gap: 8 }}>
        <select className="c-select" value={refTipo} onChange={(e) => setRefTipo(e.target.value)}>
          <option value="">— Tipo —</option>
          {REF_TIPOS.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <input className="c-input"
          placeholder={refTipo === "Mesa" ? "Número da mesa" : refTipo ? "Nome" : "Ex.: 5 · Família Nhaca"}
          value={refTexto} onChange={(e) => setRefTexto(e.target.value)} />
      </div>
      <label className="c-label" style={{ marginTop: 10 }}>📍 Espaço onde o cliente vai sentar (opcional)</label>
      <select className="c-select" value={area} onChange={(e) => setArea(e.target.value)}>
        <option value="">— Sem espaço definido —</option>
        {AREAS_ESTAR.map((a) => <option key={a} value={a}>{a}</option>)}
      </select>
      <label className="c-label" style={{ marginTop: 10 }}>👤 Quem vai atender? (opcional)</label>
      <select className="c-select" value={atendente} onChange={(e) => setAtendente(e.target.value)}>
        <option value="">— Sem atendente definido —</option>
        {(atendentes.data ?? []).map((t) => <option key={t.nome} value={t.nome}>{t.nome} · {t.cargo}</option>)}
        <option value="__outro">➕ Outro nome (escrever)…</option>
      </select>
      {atendente === "__outro" && (
        <input className="c-input" style={{ marginTop: 6 }} placeholder="Nome do funcionário"
          value={atendenteOutro} onChange={(e) => setAtendenteOutro(e.target.value)} />
      )}
      <label className="c-label" style={{ marginTop: 10 }}>🤝 Código de afiliado (opcional)</label>
      <input className="c-input" placeholder="Ex.: AF-0001" value={af}
        onChange={(e) => setAf(e.target.value.toUpperCase())} />
      <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
        <button className="c-btn c-btn-cinza" style={{ flex: 1 }} onClick={onClose}>Agora não</button>
        <button className="c-btn c-btn-prim" style={{ flex: 2 }} disabled={guardar.isPending} onClick={gravar}>
          {guardar.isPending ? "A guardar…" : "💾 Guardar"}
        </button>
      </div>
    </Modal>
  );
}

/* ============ ⚡ VENDA RÁPIDA (pronto pagamento — substitui o balcão) ============ */
type LinhaVR = { id: number; nome: string; preco: number; qtd: number };

function VendaRapida({ usuarioId, produtos, onClose, onFechado }: {
  usuarioId: number;
  produtos: Array<{ id: number; nome: string; categoria: string; tipo: string; preco: number; estoqueAtual: number; estoqueMin: number; qtdDecimal?: boolean }>;
  onClose: () => void;
  onFechado: (pd: PedidoFull) => void;
}) {
  const { toast } = useSession();
  const [cat, setCat] = useState("Todos");
  const [busca, setBusca] = useState("");
  const [carrinho, setCarrinho] = useState<LinhaVR[]>([]);
  const [partes, setPartes] = useState<PartePag[]>([{ metodo: "Dinheiro", valor: 0 }]);
  const [recebido, setRecebido] = useState(0);
  const [trocoForma, setTrocoForma] = useState<string>(FORMAS_TROCO[0]);
  const [ocupado, setOcupado] = useState(false);
  // data de lançamento — para aglutinar vendas feitas no backup OFFLINE noutro dia
  const [dataLanc, setDataLanc] = useState(hoje());

  const criar = trpc.pedidos.criar.useMutation();
  const addItem = trpc.pedidos.addItem.useMutation();
  const fechar = trpc.pedidos.fechar.useMutation();

  const cats = ["Todos", ...new Set(produtos.map((p) => p.categoria))];
  const lista = produtos.filter((p) =>
    (cat === "Todos" || p.categoria === cat) &&
    (busca === "" || p.nome.toLowerCase().includes(busca) || p.categoria.toLowerCase().includes(busca)));

  const noCarrinho = (id: number) => carrinho.find((l) => l.id === id)?.qtd ?? 0;
  const add = (p: (typeof produtos)[number]) => {
    const qtdActual = noCarrinho(p.id);
    if (p.tipo !== "Serviço" && qtdActual + 1 > p.estoqueAtual) {
      toast(`⚠️ Stock insuficiente: só ${fmtQtd(p.estoqueAtual)} un. de ${p.nome}.`); return;
    }
    setCarrinho((c) => {
      const ex = c.find((l) => l.id === p.id);
      return ex ? c.map((l) => (l.id === p.id ? { ...l, qtd: l.qtd + 1 } : l))
        : [...c, { id: p.id, nome: p.nome, preco: p.preco, qtd: 1 }];
    });
  };
  const sub = (id: number) =>
    setCarrinho((c) => c.map((l) => (l.id === id ? { ...l, qtd: l.qtd - 1 } : l)).filter((l) => l.qtd > 0));

  const total = Math.round(carrinho.reduce((a, l) => a + l.qtd * l.preco, 0) * 100) / 100;
  // com uma só parte, o valor acompanha o total; com várias, usa a soma das partes
  const partesFinais = partes.length === 1 ? [{ metodo: partes[0].metodo, valor: total }] : partes;
  const somaPartes = Math.round(partesFinais.reduce((a, x) => a + (x.valor || 0), 0) * 100) / 100;
  const completo = Math.abs(somaPartes - total) < 0.005;
  // valor levantado/recebido do cliente: pode exceder o total em QUALQUER metodo
  // (dinheiro na mao ou adiantamento por levantamento M-Pesa/e-Mola deixado em conta) → gera troco
  const troco = recebido > 0 ? Math.max(0, Math.round((recebido - somaPartes) * 100) / 100) : 0;

  const cobrar = async () => {
    if (carrinho.length === 0 || ocupado) return;
    setOcupado(true);
    try {
      const pd = await criar.mutateAsync({ usuarioId, referencia: "⚡ Venda Rápida" });
      let ultimo = pd;
      for (const l of carrinho)
        ultimo = await addItem.mutateAsync({ pedidoId: pd.id, produtoId: l.id, qtd: l.qtd, usuarioId });
      const fechado = await fechar.mutateAsync({
        usuarioId, pedidoId: pd.id, desconto: 0,
        metodo: partesFinais[0]?.metodo ?? "Dinheiro",
        partes: partesFinais,
        recebido,
        trocoPartes: troco > 0 ? [{ forma: trocoForma, valor: troco }] : undefined,
        dataDia: dataLanc !== hoje() ? dataLanc : undefined,
      });
      void ultimo;
      toast(`⚡ Venda rápida cobrada — ${mt(total)}${dataLanc !== hoje() ? ` (lançada no dia ${dataLanc.split("-").reverse().join("/")})` : ""}`);
      onFechado(fechado);
    } catch (e: any) {
      toast("⚠️ " + (e?.message ?? "Falha ao cobrar"));
      setOcupado(false);
    }
  };

  return (
    <Modal onClose={onClose}>
      <h3>⚡ Venda Rápida</h3>
      <p className="c-sub">Pronto pagamento, sem mesa nem atendente — escolha os produtos e cobre na hora.</p>

      <div style={{ position: "relative", marginBottom: 8 }}>
        <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", opacity: .6 }}>🔍</span>
        <input className="c-input" style={{ paddingLeft: 38 }} placeholder="Pesquisar produto…"
          value={busca} onChange={(e) => setBusca(e.target.value.toLowerCase())} />
      </div>

      <label className="c-label" style={{ marginTop: 0 }}>SELECCIONAR PRODUTOS</label>
      <div className="c-cats" style={{ maxHeight: 148, overflowY: "auto" }}>
        {cats.map((c) => (
          <button key={c} className={c === cat ? "ativo" : ""} onClick={() => setCat(c)}>{c}</button>
        ))}
      </div>

      <div style={{ maxHeight: "32vh", overflowY: "auto", display: "grid", gap: 4 }}>
        {lista.map((p) => {
          const semStock = p.tipo !== "Serviço" && p.estoqueAtual <= 0;
          const qtd = noCarrinho(p.id);
          return (
            <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 4px", borderBottom: "1px dashed #eadff0" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.nome}</div>
                <div className="c-sub" style={{ fontSize: 11 }}>
                  {mt(p.preco)}{p.tipo !== "Serviço" ? ` · stock ${fmtQtd(p.estoqueAtual)}` : " · Serviço"}
                </div>
              </div>
              {qtd > 0 ? (
                <div className="c-qty">
                  <button onClick={() => sub(p.id)}>−</button>
                  <span>{qtd}</span>
                  <button onClick={() => add(p)}>+</button>
                </div>
              ) : (
                <button className="padd" style={{ position: "static", width: 38, height: 38, fontSize: 19, flexShrink: 0 }}
                  disabled={semStock} onClick={() => add(p)}>+</button>
              )}
            </div>
          );
        })}
      </div>

      {/* carrinho + cobrança */}
      <div style={{ marginTop: 10, borderTop: "2px solid #efe8f2", paddingTop: 8 }}>
        <label className="c-label" style={{ marginTop: 0 }}>CARRINHO ({carrinho.reduce((a, l) => a + l.qtd, 0)}) — confira e ajuste com −/+</label>
        {carrinho.length === 0 && <p className="c-sub">Nenhum produto adicionado.</p>}
        {carrinho.map((l) => {
          const pr = produtos.find((x) => x.id === l.id);
          return (
            <div key={l.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, padding: "4px 0" }}>
              <span style={{ flex: 1, minWidth: 0 }}>{l.nome}</span>
              <div className="c-qty">
                <button onClick={() => sub(l.id)}>−</button>
                <span><b>{fmtQtd(l.qtd)}</b></span>
                <button onClick={() => pr && add(pr)}>+</button>
              </div>
              <b style={{ width: 74, textAlign: "right" }}>{mt(l.qtd * l.preco)}</b>
            </div>
          );
        })}
        {carrinho.length > 0 && (
          <>
            <div className="c-total-linha grande" style={{ marginTop: 6 }}><span>TOTAL</span><span>{mt(total)}</span></div>

            <label className="c-label">📅 Data da venda (para lançamentos atrasados)</label>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input className="c-input" type="date" style={{ maxWidth: 170 }} value={dataLanc} max={hoje()}
                onChange={(e) => setDataLanc(e.target.value || hoje())} />
              {dataLanc !== hoje() && (
                <button type="button" className="c-btn c-btn-cinza c-btn-peq" onClick={() => setDataLanc(hoje())}>Hoje</button>
              )}
            </div>
            {dataLanc !== hoje() && (
              <p className="c-sub" style={{ marginTop: 2, color: "var(--amarelo-c)" }}>
                ⏪ Venda atrasada: entra nos relatórios do dia <b>{dataLanc.split("-").reverse().join("/")}</b> — para aglutinar as vendas feitas no backup offline.
              </p>
            )}

            <label className="c-label">Método de Pagamento</label>
            {partes.length === 1 ? (
              <>
                <div className="c-pag-grelha">
                  {METODOS_PAGAMENTO.map((m) => (
                    <button key={m} type="button" className={m === partes[0].metodo ? "sel" : ""}
                      onClick={() => setPartes([{ metodo: m, valor: total }])}>{m}</button>
                  ))}
                </div>
                <button type="button" className="c-btn c-btn-linha c-btn-bloco" style={{ marginTop: 6 }}
                  onClick={() => {
                    const metade = Math.round(total / 2 * 100) / 100;
                    const livre = METODOS_PAGAMENTO.find((m) => m !== partes[0].metodo) ?? "Transferência eMola";
                    setPartes([{ metodo: partes[0].metodo, valor: metade }, { metodo: livre, valor: Math.round((total - metade) * 100) / 100 }]);
                  }}>
                  ＋ Dividir pagamento (outro método)
                </button>
              </>
            ) : (
              <div style={{ display: "grid", gap: 6 }}>
                {partes.map((x, i) => (
                  <div key={i} style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr 34px 30px", gap: 6, alignItems: "center" }}>
                    <select className="c-select" value={x.metodo}
                      onChange={(e) => setPartes((ps) => ps.map((y, j) => (j === i ? { ...y, metodo: e.target.value } : y)))}>
                      {METODOS_PAGAMENTO.map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                    <MoneyInput value={x.valor} onChange={(v) => setPartes((ps) => ps.map((y, j) => (j === i ? { ...y, valor: v } : y)))} />
                    <button type="button" className="c-btn c-btn-cinza c-btn-peq" title="Completar o valor em falta"
                      onClick={() => setPartes((ps) => ps.map((y, j) => (j === i ? { ...y, valor: Math.max(0, Math.round((total - ps.reduce((a, z, k) => a + (k === i ? 0 : (z.valor || 0)), 0)) * 100) / 100) } : y)))}>=</button>
                    <button type="button" className="c-btn c-btn-cinza c-btn-peq" title="Remover esta parte"
                      onClick={() => setPartes((ps) => ps.filter((_, j) => j !== i))}>✕</button>
                  </div>
                ))}
                {partes.length < 6 && (
                  <button type="button" className="c-btn c-btn-linha c-btn-bloco"
                    onClick={() => {
                      const usada = Math.round(partes.reduce((a, x) => a + (x.valor || 0), 0) * 100) / 100;
                      const livre = METODOS_PAGAMENTO.find((m) => !partes.some((x) => x.metodo === m)) ?? "Dinheiro";
                      setPartes((ps) => [...ps, { metodo: livre, valor: Math.max(0, Math.round((total - usada) * 100) / 100) }]);
                    }}>＋ Adicionar outro método</button>
                )}
                <div style={{ fontSize: 13, fontWeight: 700, color: completo ? "var(--verde-c)" : "var(--vermelho-c)" }}>
                  {completo ? `✔ Soma das partes = ${mt(total)}`
                    : somaPartes < total ? `⚠️ Faltam ${mt(total - somaPartes)} para o total` : `⚠️ Excede ${mt(somaPartes - total)} o total`}
                </div>
              </div>
            )}

            {completo && (
              <>
                <label className="c-label" style={{ marginTop: 8 }}>Valor levantado/recebido do cliente (MZN)</label>
                <MoneyInput value={recebido} onChange={setRecebido} placeholder={`Ex.: ${Math.ceil(somaPartes)}.00`} />
                <p className="c-sub" style={{ marginTop: 2 }}>
                  🏧 O cliente adiantou por levantamento M-Pesa/e-Mola (ou entregou uma nota maior)? Indique o valor total levantado — o sistema calcula o troco a devolver.
                </p>
                {recebido > 0 && recebido < somaPartes && (
                  <div style={{ marginTop: 4, fontSize: 13, fontWeight: 700, color: "var(--vermelho-c)" }}>⚠️ Valor insuficiente</div>
                )}
                {troco > 0 && (
                  <div style={{ marginTop: 6 }}>
                    <div style={{ background: "#e8f7ee", border: "2px solid #1a7a3c", borderRadius: 10, padding: "8px 10px", fontSize: 14, fontWeight: 800, color: "#1a7a3c" }}>
                      🗣️ Diga ao cliente: «O seu troco é de {mt(troco)} MZN.»
                    </div>
                    <label className="c-label" style={{ marginTop: 6 }}>Como será entregue o troco?</label>
                    <div className="c-pag-grelha">
                      {FORMAS_TROCO.map((f) => (
                        <button key={f} type="button" className={f === trocoForma ? "sel" : ""} onClick={() => setTrocoForma(f)}>{f}</button>
                      ))}
                    </div>
                    {(trocoForma === "Depósito eMola" || trocoForma === "Depósito Mpesa") && (
                      <p className="c-sub" style={{ marginTop: 4 }}>
                        🏧 Este troco desconta automaticamente nos levantamentos {trocoForma === "Depósito eMola" ? "eMola" : "M-Pesa"} do dia (quadro de agente no Financeiro).
                      </p>
                    )}
                  </div>
                )}
                {recebido >= somaPartes && recebido > 0 && troco === 0 && (
                  <div style={{ marginTop: 4, fontSize: 13, fontWeight: 700, color: "var(--verde-c)" }}>✔ Valor exacto — sem troco</div>
                )}
              </>
            )}

            <button className="c-btn c-btn-verde c-btn-bloco" style={{ marginTop: 10 }}
              disabled={ocupado || !completo || (recebido > 0 && recebido < somaPartes - 0.004)}
              onClick={cobrar}>
              {ocupado ? "A cobrar…" : `✅ Cobrar ${mt(total)}`}
            </button>
          </>
        )}
      </div>
    </Modal>
  );
}

/* ============ HISTÓRICO DETALHADO DE LANÇAMENTOS («caderno») ============ */
function HistoricoItensModal({ pedido, usuarioId, onClose }: {
  pedido: PedidoFull; usuarioId: number; onClose: () => void;
}) {
  const q = trpc.pedidos.historicoItens.useQuery({ usuarioId, pedidoId: pedido.id });
  const rows = q.data ?? [];
  const rotulo = (o: string) => o === "menu" ? "➕ do menu" : o === "adicional" ? "✳️ adicional" : "± ajuste";
  return (
    <Modal onClose={onClose}>
      <h3>📜 Histórico — Pedido nº {pedido.numero}</h3>
      <p className="c-sub">
        Tudo o que foi lançado neste pedido, por ordem (o mais recente primeiro): cada toque no +/−,
        cada produto do menu e cada item fora do menu — com a hora e quem registou. A conta do cliente
        continua aglutinada por produto; este é apenas o rasto de controlo interno.
      </p>
      {q.isLoading && <p className="c-sub">A carregar…</p>}
      {!q.isLoading && rows.length === 0 && (
        <p className="c-sub">Sem movimentos registados (o histórico começou a ser gravado agora — pedidos antigos não têm rasto).</p>
      )}
      <div style={{ maxHeight: "50vh", overflowY: "auto", display: "grid", gap: 4, marginTop: 6 }}>
        {rows.map((r) => (
          <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", borderRadius: 8, background: "rgba(0,0,0,.03)", fontSize: 12.5 }}>
            <span className="c-sub" style={{ minWidth: 44 }}>{horaBR(r.criadoEm)}</span>
            <b style={{ minWidth: 40, color: r.delta > 0 ? "var(--verde-c)" : "var(--vermelho-c)" }}>
              {r.delta > 0 ? "+" : ""}{fmtQtd(r.delta)}
            </b>
            <span style={{ flex: 1, minWidth: 0, fontWeight: 600 }}>{r.nome}</span>
            <span className="c-sub" style={{ fontSize: 10.5 }}>
              {rotulo(r.origem)}{r.qtdFinal > 0 ? ` · ficou ${fmtQtd(r.qtdFinal)}` : " · linha removida"}
            </span>
            {r.usuarioNome && <span className="c-sub" style={{ fontSize: 10.5 }}>👤 {r.usuarioNome}</span>}
          </div>
        ))}
      </div>
      <button className="c-btn c-btn-cinza c-btn-bloco" style={{ marginTop: 12 }} onClick={onClose}>Fechar</button>
    </Modal>
  );
}

/* ============ PEDIDO ADICIONAL (FORA DO MENU) ============ */
function ExtraModal({ pendente, onClose, onAdd }: {
  pendente: boolean; onClose: () => void;
  onAdd: (nome: string, preco: number, qtd: number) => void;
}) {
  const [nome, setNome] = useState("");
  const [preco, setPreco] = useState(0);
  const [qtd, setQtd] = useState(1);
  const ok = nome.trim().length >= 2 && preco >= 0 && (preco > 0 || nome.trim().length >= 2);
  return (
    <Modal onClose={onClose}>
      <h3>✳️ Pedido Adicional</h3>
      <p className="c-sub">Para itens ou serviços que <b>não estão no menu</b> (ex.: decoração especial, bolo de aniversário, aluguer de material). O valor entra na conta final do cliente.</p>
      <label className="c-label">Descrição do item/serviço</label>
      <input className="c-input" placeholder="Ex.: Bolo de aniversário personalizado" value={nome} onChange={(e) => setNome(e.target.value)} autoFocus />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 4 }}>
        <div>
          <label className="c-label">Preço unitário (MZN)</label>
          <MoneyInput value={preco} onChange={(v) => setPreco(Math.max(0, v))} />
        </div>
        <div>
          <label className="c-label">Quantidade</label>
          <input className="c-input" type="number" inputMode="numeric" min={1}
            value={qtd} onChange={(e) => setQtd(Math.max(1, Math.round(+e.target.value || 1)))} />
        </div>
      </div>
      <div className="c-total-linha grande" style={{ marginTop: 10 }}>
        <span>TOTAL DESTE ITEM</span><span>{mt(qtd * preco)}</span>
      </div>
      <button
        className="c-btn c-btn-prim c-btn-bloco" style={{ marginTop: 12 }}
        disabled={pendente || !ok || preco <= 0}
        onClick={() => onAdd(nome.trim(), preco, qtd)}
      >
        {pendente ? "A adicionar…" : "✅ Adicionar à Conta"}
      </button>
    </Modal>
  );
}

/* ============ PRO-FORMA ============ */
function ProformaModal({ pedido, onClose, onGerado }: {
  pedido: PedidoFull; onClose: () => void; onGerado: (d: DocData) => void;
}) {
  const { user, toast } = useSession();
  const [f, setF] = useState({ clienteNome: pedido.referencia ?? "", clienteEmail: "", clienteNuit: "", representante: "" });
  const [desconto, setDesconto] = useState(0);
  const [ivaModo, setIvaModo] = useState<IvaModo>("incluido");
  const subtotal = pedido.itens.reduce((a, i) => a + i.qtd * i.precoUnit, 0);

  const criar = trpc.documentos.criarProforma.useMutation({
    onSuccess: (d) => { if (d) onGerado(d as DocData); },
    onError: (e) => toast("⚠️ " + e.message),
  });

  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));

  return (
    <Modal onClose={onClose}>
      <h3>🧾 Factura Pro-forma — Pedido nº {pedido.numero}</h3>
      <p className="c-sub">{pedido.itens.reduce((a, i) => a + i.qtd, 0)} itens · Subtotal {mt(subtotal)}</p>

      <label className="c-label">Nome do Cliente / Empresa</label>
      <input className="c-input" placeholder="Ex.: Empresa ABC, Lda" value={f.clienteNome} onChange={(e) => set("clienteNome", e.target.value)} />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div>
          <label className="c-label">NUIT do Cliente</label>
          <input className="c-input" inputMode="numeric" placeholder="Opcional" value={f.clienteNuit} onChange={(e) => set("clienteNuit", e.target.value)} />
        </div>
        <div>
          <label className="c-label">Representante</label>
          <input className="c-input" placeholder="Opcional" value={f.representante} onChange={(e) => set("representante", e.target.value)} />
        </div>
      </div>
      <label className="c-label">Email do Cliente</label>
      <input className="c-input" type="email" placeholder="Opcional" value={f.clienteEmail} onChange={(e) => set("clienteEmail", e.target.value)} />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 4 }}>
        <div>
          <label className="c-label">Desconto (%)</label>
          <input className="c-input" type="number" min={0} max={100} value={desconto || ""} placeholder="0"
            onChange={(e) => setDesconto(Math.min(100, Math.max(0, +e.target.value || 0)))} />
        </div>
        <div>
          <label className="c-label">IVA</label>
          <select className="c-select" value={ivaModo} onChange={(e) => setIvaModo(e.target.value as IvaModo)}>
            {IVA_MODOS.map((m) => <option key={m.id} value={m.id}>{m.rotulo}</option>)}
          </select>
        </div>
      </div>

      <button
        className="c-btn c-btn-prim c-btn-bloco" style={{ marginTop: 14 }}
        disabled={criar.isPending}
        onClick={() => user && criar.mutate({
          usuarioId: user.id, pedidoId: pedido.id, desconto, ivaModo,
          clienteNome: f.clienteNome || undefined, clienteEmail: f.clienteEmail || undefined,
          clienteNuit: f.clienteNuit || undefined, representante: f.representante || undefined,
        })}
      >
        {criar.isPending ? "A gerar…" : "✅ Gerar Pro-forma"}
      </button>
    </Modal>
  );
}

/* ============ CHECKOUT COM TROCO ============ */
type PartePag = { metodo: string; valor: number };
type ParteTroco = { forma: string; valor: number };

function Checkout({ pedido, onClose, onConfirm, pendente }: {
  pedido: PedidoFull;
  onClose: () => void;
  onConfirm: (desconto: number, partes: PartePag[], recebido: number, trocoPartes?: ParteTroco[], dataLanc?: string, divida?: { nome: string; tel?: string }) => void;
  pendente: boolean;
}) {
  const [desconto, setDesconto] = useState(0);
  const [dataLanc, setDataLanc] = useState(hoje()); // data de lançamento — para vendas de dias anteriores
  const [partesPag, setPartesPag] = useState<PartePag[]>([{ metodo: "Dinheiro", valor: 0 }]);
  const [trocoPag, setTrocoPag] = useState<ParteTroco[]>([{ forma: "Dinheiro", valor: 0 }]);
  const [recebido, setRecebido] = useState(0);
  // FIADO: o cliente fica a dever o valor em falta (a dívida fica visível até ser paga por completo)
  const [fiado, setFiado] = useState(false);
  const [dividaNome, setDividaNome] = useState("");
  const [dividaTel, setDividaTel] = useState("");
  const [pagaAgora, setPagaAgora] = useState<number | null>(null); // com fiado e 1 método: quanto paga já
  // crédito restante da reserva para ESTE pedido: pedidos novos NÃO herdam o crédito já consumido —
  // o servidor calcula pago(na reserva) − crédito já deduzido noutros pedidos fechados da mesma reserva.
  // Braai e buffet NÃO geram crédito consumível (a taxa é paga à parte): um pedido novo cobra o total.
  const creditoQ = trpc.pedidos.creditoReserva.useQuery(
    { reservaId: pedido.reservaId! }, { enabled: pedido.reservaId != null });
  const adiant = creditoQ.data?.credito ?? 0;
  const reservasQ = trpc.reservas.list.useQuery(undefined, { enabled: pedido.reservaId != null });
  const reserva = (reservasQ.data ?? []).find((r) => r.id === pedido.reservaId && r.status === "Confirmada");

  const subtotal = pedido.itens.reduce((a, i) => a + i.qtd * i.precoUnit, 0);
  const totalBruto = Math.round(subtotal * (1 - desconto / 100) * 100) / 100;
  const deduzido = Math.min(adiant, totalBruto);
  const total = Math.round((totalBruto - deduzido) * 100) / 100;

  // com uma só parte, o valor acompanha sempre o total (com fiado, acompanha o "paga agora")
  const partes = partesPag.length === 1
    ? [{ metodo: partesPag[0].metodo, valor: fiado ? Math.max(0, Math.min(total, pagaAgora ?? total)) : total }]
    : partesPag;
  const soma = Math.round(partes.reduce((a, x) => a + (x.valor || 0), 0) * 100) / 100;
  const falta = Math.round((total - soma) * 100) / 100;
  const completo = Math.abs(falta) < 0.005;
  // fiado válido: há valor em falta e o cliente está identificado
  const fiadoOk = fiado && falta > 0.004 && dividaNome.trim().length >= 2;
  // valor levantado/recebido do cliente: pode exceder o total pago em QUALQUER metodo
  // (dinheiro na mao ou adiantamento por levantamento M-Pesa/e-Mola deixado em conta) → gera troco
  const troco = recebido > 0 ? Math.round((recebido - soma) * 100) / 100 : 0;

  // formas de entrega do troco: 1 linha = o valor acompanha o troco; várias = soma deve ser igual ao troco
  const trocoV = Math.max(0, troco);
  const trocoPartes = trocoPag.length === 1 ? [{ forma: trocoPag[0].forma, valor: trocoV }] : trocoPag;
  const somaTroco = Math.round(trocoPartes.reduce((a, x) => a + (x.valor || 0), 0) * 100) / 100;
  const trocoOk = troco <= 0 || Math.abs(somaTroco - trocoV) < 0.005;
  const setTrocoParte = (i: number, patch: Partial<ParteTroco>) =>
    setTrocoPag((ps) => ps.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const completarTroco = (i: number) => {
    const outras = Math.round(trocoPartes.reduce((a, x, j) => a + (j === i ? 0 : (x.valor || 0)), 0) * 100) / 100;
    setTrocoParte(i, { valor: Math.max(0, Math.round((trocoV - outras) * 100) / 100) });
  };
  const dividirTroco = () => {
    const metade = Math.round(trocoV / 2 * 100) / 100;
    const livre = FORMAS_TROCO.find((f) => f !== trocoPag[0].forma) ?? "Trans. eMola";
    setTrocoPag([
      { forma: trocoPag[0].forma, valor: metade },
      { forma: livre, valor: Math.round((trocoV - metade) * 100) / 100 },
    ]);
  };
  const addTrocoParte = () => {
    const usada = Math.round(trocoPartes.reduce((a, x) => a + (x.valor || 0), 0) * 100) / 100;
    const resto = Math.max(0, Math.round((trocoV - usada) * 100) / 100);
    const livre = FORMAS_TROCO.find((f) => !trocoPartes.some((x) => x.forma === f)) ?? "Dinheiro";
    setTrocoPag((ps) => [...ps, { forma: livre, valor: resto }]);
  };
  const delTrocoParte = (i: number) => setTrocoPag((ps) => ps.filter((_, j) => j !== i));

  const denoms: Array<{ d: number; n: number }> = [];
  if (troco > 0 && trocoPartes.some((x) => x.forma === "Dinheiro")) {
    let resto = troco;
    for (const d of DENOMS_MZN) {
      const n = Math.floor((resto + 1e-9) / d);
      if (n > 0) { denoms.push({ d, n }); resto = Math.round((resto - n * d) * 100) / 100; }
    }
  }

  const setParte = (i: number, patch: Partial<PartePag>) =>
    setPartesPag((ps) => ps.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const completar = (i: number) => {
    const outras = Math.round(partes.reduce((a, x, j) => a + (j === i ? 0 : (x.valor || 0)), 0) * 100) / 100;
    setParte(i, { valor: Math.max(0, Math.round((total - outras) * 100) / 100) });
  };
  const dividir = () => {
    const metade = Math.round(total / 2 * 100) / 100;
    const livre = METODOS_PAGAMENTO.find((m) => m !== partesPag[0].metodo) ?? "Transferência eMola";
    setPartesPag([
      { metodo: partesPag[0].metodo, valor: metade },
      { metodo: livre, valor: Math.round((total - metade) * 100) / 100 },
    ]);
  };
  const addParte = () => {
    const usada = Math.round(partes.reduce((a, x) => a + (x.valor || 0), 0) * 100) / 100;
    const resto = Math.max(0, Math.round((total - usada) * 100) / 100);
    const livre = METODOS_PAGAMENTO.find((m) => !partes.some((x) => x.metodo === m)) ?? "Dinheiro";
    setPartesPag((ps) => [...ps, { metodo: livre, valor: resto }]);
  };
  const delParte = (i: number) => setPartesPag((ps) => ps.filter((_, j) => j !== i));

  return (
    <Modal onClose={onClose}>
      <h3>💳 Fechar Conta — Pedido nº {pedido.numero}</h3>
      <p className="c-sub">{pedido.referencia || "sem referência"} · {pedido.itens.reduce((a, i) => a + i.qtd, 0)} itens</p>

      <label className="c-label">📅 Data da venda (para lançamentos atrasados)</label>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input className="c-input" type="date" style={{ maxWidth: 170 }} value={dataLanc} max={hoje()}
          onChange={(e) => setDataLanc(e.target.value || hoje())} />
        {dataLanc !== hoje() && (
          <button type="button" className="c-btn c-btn-cinza c-btn-peq" onClick={() => setDataLanc(hoje())}>Hoje</button>
        )}
      </div>
      {dataLanc !== hoje() && (
        <p className="c-sub" style={{ marginTop: 2, color: "var(--amarelo-c)" }}>
          ⏪ Esta venda entra nos relatórios do dia <b>{dataLanc.split("-").reverse().join("/")}</b>, não de hoje.
        </p>
      )}

      <label className="c-label">Desconto (%)</label>
      <input className="c-input" type="number" min={0} max={100} value={desconto || ""} placeholder="0"
        onChange={(e) => setDesconto(Math.min(100, Math.max(0, +e.target.value || 0)))} />

      <div style={{ marginTop: 10 }}>
        <div className="c-total-linha"><span>Subtotal</span><b>{mt(subtotal)}</b></div>
        <div className="c-total-linha"><span>Desconto ({desconto}%)</span><b style={{ color: "var(--vermelho-c)" }}>− {mt(subtotal * desconto / 100)}</b></div>
        {deduzido > 0 && (
          <div className="c-total-linha">
            <span>Valor já pago da reserva {reserva?.codigo}{(reserva?.desconto ?? 0) > 0 ? " (com desconto)" : ""}</span>
            <b style={{ color: "var(--verde-c)" }}>− {mt(deduzido)}</b>
          </div>
        )}
        <div className="c-total-linha grande"><span>{deduzido > 0 ? "TOTAL A PAGAR" : "TOTAL"}</span><span>{mt(total)}</span></div>
        {deduzido > 0 && (
          <p className="c-sub" style={{ marginTop: 4 }}>✔ O crédito restante da reserva (o que o cliente pagou e ainda não consumiu) é subtraído automaticamente. Pedidos novos depois de a reserva estar consumida pagam o valor total.</p>
        )}
      </div>

      <label className="c-label">Método de Pagamento</label>
      {partesPag.length === 1 ? (
        <>
          <div className="c-pag-grelha">
            {METODOS_PAGAMENTO.map((m) => (
              <button key={m} className={m === partesPag[0].metodo ? "sel" : ""} onClick={() => setParte(0, { metodo: m })}>{m}</button>
            ))}
          </div>
          <button type="button" className="c-btn c-btn-linha c-btn-bloco" style={{ marginTop: 6 }} onClick={dividir}>
            ＋ Dividir pagamento (outro método)
          </button>
        </>
      ) : (
        <div style={{ display: "grid", gap: 6 }}>
          {partesPag.map((x, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr 34px 30px", gap: 6, alignItems: "center" }}>
              <select className="c-select" value={x.metodo} onChange={(e) => setParte(i, { metodo: e.target.value })}>
                {METODOS_PAGAMENTO.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
              <MoneyInput value={x.valor} onChange={(v) => setParte(i, { valor: v })} />
              <button type="button" className="c-btn c-btn-cinza c-btn-peq" title="Completar o valor em falta" onClick={() => completar(i)}>=</button>
              <button type="button" className="c-btn c-btn-cinza c-btn-peq" title="Remover esta parte" onClick={() => delParte(i)}>✕</button>
            </div>
          ))}
          {partesPag.length < 6 && (
            <button type="button" className="c-btn c-btn-linha c-btn-bloco" onClick={addParte}>＋ Adicionar outro método</button>
          )}
          <div style={{ fontSize: 13, fontWeight: 700, color: completo ? "var(--verde-c)" : "var(--vermelho-c)" }}>
            {completo
              ? `✔ Soma das partes = ${mt(total)}`
              : falta > 0
                ? `⚠️ Faltam ${mt(falta)} para o total`
                : `⚠️ Excede ${mt(-falta)} o total`}
          </div>
        </div>
      )}

      {(
        <div style={{ marginTop: 8 }}>
          <label className="c-label">Valor levantado/recebido do cliente (MZN)</label>
          <MoneyInput value={recebido} onChange={setRecebido} placeholder={`Ex.: ${Math.ceil(soma)}.00`} />
          <p className="c-sub" style={{ marginTop: 2 }}>
            🏧 O cliente adiantou por levantamento M-Pesa/e-Mola (ou entregou uma nota maior)? Indique o valor total levantado — o sistema calcula o troco a devolver e regista como foi entregue.
          </p>
          <div style={{ marginTop: 8, fontSize: 13 }}>
            {troco > 0 ? (
              <>
                <div style={{ background: "#e8f7ee", border: "2px solid #1a7a3c", borderRadius: 10, padding: "8px 10px", margin: "4px 0 8px", fontSize: 14, fontWeight: 800, color: "#1a7a3c" }}>
                  🗣️ Diga ao cliente: «O seu troco é de {mt(troco)} MZN.»
                </div>
                Troco: <b style={{ color: "var(--verde-c)" }}>{mt(troco)}</b>
                <div className="c-denoms">
                  {denoms.map((p) => (
                    <div key={p.d} className="c-denom"><b>{p.n}×</b>{p.d >= 1 ? fmt(p.d) + " MZN" : "50 cent."}</div>
                  ))}
                </div>
                <div style={{ marginTop: 10 }}>
                  <label className="c-label">Como será dado o troco?</label>
                  {trocoPag.length === 1 ? (
                    <>
                      <div className="c-pag-grelha">
                        {FORMAS_TROCO.map((f) => (
                          <button key={f} type="button" className={f === trocoPag[0].forma ? "sel" : ""} onClick={() => setTrocoParte(0, { forma: f })}>{f}</button>
                        ))}
                      </div>
                      <button type="button" className="c-btn c-btn-linha c-btn-bloco" style={{ marginTop: 6 }} onClick={dividirTroco}>
                        ＋ Dividir troco (outra forma)
                      </button>
                    </>
                  ) : (
                    <div style={{ display: "grid", gap: 6 }}>
                      {trocoPag.map((x, i) => (
                        <div key={i} style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr 34px 30px", gap: 6, alignItems: "center" }}>
                          <select className="c-select" value={x.forma} onChange={(e) => setTrocoParte(i, { forma: e.target.value })}>
                            {FORMAS_TROCO.map((f) => <option key={f} value={f}>{f}</option>)}
                          </select>
                          <MoneyInput value={x.valor} onChange={(v) => setTrocoParte(i, { valor: v })} />
                          <button type="button" className="c-btn c-btn-cinza c-btn-peq" title="Completar o troco em falta" onClick={() => completarTroco(i)}>=</button>
                          <button type="button" className="c-btn c-btn-cinza c-btn-peq" title="Remover esta forma" onClick={() => delTrocoParte(i)}>✕</button>
                        </div>
                      ))}
                      {trocoPag.length < 6 && (
                        <button type="button" className="c-btn c-btn-linha c-btn-bloco" onClick={addTrocoParte}>＋ Adicionar outra forma</button>
                      )}
                      <div style={{ fontSize: 13, fontWeight: 700, color: trocoOk ? "var(--verde-c)" : "var(--vermelho-c)" }}>
                        {trocoOk
                          ? `✔ Soma das formas = ${mt(trocoV)}`
                          : somaTroco < trocoV
                            ? `⚠️ Faltam ${mt(trocoV - somaTroco)} de troco por entregar`
                            : `⚠️ Excede ${mt(somaTroco - trocoV)} o troco`}
                      </div>
                    </div>
                  )}
                </div>
              </>
            ) : recebido >= soma && recebido > 0 ? (
              <span style={{ color: "var(--verde-c)", fontWeight: 700 }}>✔ Valor exato — sem troco</span>
            ) : (
              <span className="c-sub">Troco: <b style={{ color: "var(--vermelho-c)" }}>{recebido > 0 && recebido < soma ? "valor insuficiente" : "—"}</b></span>
            )}
          </div>
        </div>
      )}

      {/* FIADO — o cliente fica a dever o valor em falta */}
      <div style={{ marginTop: 14, borderTop: "1px dashed var(--cinza-l, #ddd)", paddingTop: 10 }}>
        <button type="button" className={`c-btn c-btn-bloco ${fiado ? "c-btn-prim" : "c-btn-linha"}`}
          onClick={() => { setFiado((f) => !f); setPagaAgora(null); }}>
          🧾 {fiado ? "Fiado activado — o cliente fica a dever" : "O cliente fica a dever (fiado)"}
        </button>
        {fiado && (
          <div style={{ marginTop: 8, display: "grid", gap: 8, background: "rgba(217,43,43,.06)", border: "1px solid rgba(217,43,43,.25)", borderRadius: 12, padding: 10 }}>
            <p className="c-sub" style={{ margin: 0 }}>
              O valor em falta fica registado como <b>dívida</b> e permanece <b>visível na página 🧾 Dívidas</b> até ser pago por completo.
            </p>
            <div>
              <label className="c-label">Nome do cliente que fica a dever *</label>
              <input className="c-input" placeholder="Ex.: João Mucavele" value={dividaNome}
                onChange={(e) => setDividaNome(e.target.value)} />
            </div>
            <div>
              <label className="c-label">Telefone (para cobrança por WhatsApp)</label>
              <input className="c-input" inputMode="tel" placeholder="Ex.: 84 123 4567" value={dividaTel}
                onChange={(e) => setDividaTel(e.target.value)} />
            </div>
            {partesPag.length === 1 && (
              <div>
                <label className="c-label">Paga agora (MZN) — o resto fica em dívida</label>
                <MoneyInput value={pagaAgora ?? total} onChange={(v) => setPagaAgora(Math.max(0, Math.min(total, v)))} />
              </div>
            )}
            {falta > 0.004 ? (
              <div style={{ fontWeight: 800, color: "var(--vermelho-c)", fontSize: 14 }}>
                🧾 Fica a dever: {mt(falta)}
              </div>
            ) : (
              <div style={{ fontWeight: 700, color: "var(--amarelo-c)", fontSize: 13 }}>
                ⚠️ O pagamento já cobre o total — desligue o fiado ou reduza o valor pago agora.
              </div>
            )}
            {fiado && falta > 0.004 && dividaNome.trim().length < 2 && (
              <div style={{ fontWeight: 700, color: "var(--vermelho-c)", fontSize: 13 }}>
                ⚠️ Indique o nome do cliente para registar a dívida.
              </div>
            )}
          </div>
        )}
      </div>

      <button
        className="c-btn c-btn-verde c-btn-bloco" style={{ marginTop: 16 }}
        disabled={pendente || !trocoOk || (recebido > 0 && recebido < soma - 0.004) || (!completo && !fiadoOk)}
        onClick={() => onConfirm(
          desconto,
          fiadoOk ? partes.filter((x) => x.valor > 0) : partes,
          recebido, troco > 0 ? trocoPartes : undefined, dataLanc,
          fiadoOk ? { nome: dividaNome.trim(), tel: dividaTel.trim() || undefined } : undefined,
        )}
      >
        {pendente ? "A processar…" : fiadoOk ? `🧾 Fechar com dívida de ${mt(falta)}` : `✅ Confirmar Pagamento — ${mt(total)}`}
      </button>
    </Modal>
  );
}

/* ============ RECIBO ============ */
function Recibo({ pedido, onClose, onFactura }: {
  pedido: PedidoFull; onClose: () => void; onFactura: (d: DocData) => void;
}) {
  const { user, toast } = useSession();
  const emp = useEmpresa();
  const [baixando, setBaixando] = useState(false);
  const factura = trpc.documentos.criarFactura.useMutation({
    onSuccess: (d) => { if (d) onFactura(d as DocData); },
    onError: (e) => toast("⚠️ " + e.message),
  });

  const reciboHtml = () =>
    reciboBodyHtml({
      numero: pedido.numero, dataDia: pedido.dataDia, referencia: pedido.referencia, area: pedido.area,
      itens: pedido.itens.map((i) => ({ nome: i.nome, qtd: i.qtd, precoUnit: i.precoUnit, total: i.qtd * i.precoUnit })),
      subtotal: pedido.subtotal, desconto: pedido.desconto, total: pedido.total, adiantDeduzido: pedido.adiantDeduzido,
      metodo: pedido.metodo, recebido: pedido.recebido, troco: pedido.troco,
    }, emp);

  const imprimirRecibo = () => printDoc(`Recibo Pedido nº ${pedido.numero}`, reciboHtml());

  const baixarRecibo = async () => {
    setBaixando(true);
    try {
      await downloadPdf(`Recibo Pedido nº ${pedido.numero}`, reciboHtml(), `Recibo-Pedido-${pedido.numero}.pdf`);
    } finally {
      setBaixando(false);
    }
  };

  return (
    <Modal onClose={onClose}>
      <h3>✅ Pagamento Registado</h3>
      <div className="c-recibo">
        <img src="/icons/logo.png" alt="logo" style={{ display: "block", margin: "0 auto 6px", width: 64 }} />
        <h4>{emp.nome}</h4>
        <div className="centro">
          NUIT: {emp.nuit}<br />
          {emp.local}<br />Tel: {emp.tel1} / {emp.tel2}
        </div>
        <hr />
        <div className="rl"><span>Pedido:</span><b>nº {pedido.numero} — {pedido.dataDia}</b></div>
        {pedido.referencia && <div className="rl"><span>Referência:</span><span>{pedido.referencia}</span></div>}
        {pedido.area && <div className="rl"><span>Local:</span><span>{pedido.area}</span></div>}
        <hr />
        {pedido.itens.map((i) => (
          <div className="rl" key={i.id}><span>{i.qtd}× {i.nome}</span><span>{mt(i.qtd * i.precoUnit)}</span></div>
        ))}
        <hr />
        <div className="rl"><span>Subtotal</span><span>{mt(pedido.subtotal)}</span></div>
        {pedido.desconto > 0 && <div className="rl"><span>Desconto ({pedido.desconto}%)</span><span>− {mt(pedido.subtotal * pedido.desconto / 100)}</span></div>}
        {pedido.adiantDeduzido > 0 && <div className="rl"><span>Adiantamento (reserva)</span><span>− {mt(pedido.adiantDeduzido)}</span></div>}
        <div className="rl tot"><span>TOTAL</span><span>{mt(pedido.total)}</span></div>
        <div className="rl"><span>Pagamento</span><span>{pedido.metodo}</span></div>
        {pedido.metodo?.includes("Dinheiro") && (
          <>
            <div className="rl"><span>Recebido</span><span>{mt(pedido.recebido ?? 0)}</span></div>
            <div className="rl"><span>Troco</span><span>{mt(pedido.troco ?? 0)}</span></div>
            {(pedido.troco ?? 0) > 0 && (
              <div className="c-sub" style={{ marginTop: -4, fontSize: 12 }}>
                entregue: {(() => {
                  try {
                    const tp: Array<{ forma: string; valor: number }> = pedido.trocoDetalhe ? JSON.parse(pedido.trocoDetalhe) : [];
                    const partesT = tp.length ? tp : [{ forma: "Dinheiro", valor: pedido.troco ?? 0 }];
                    return partesT.map((x) => `${x.forma} ${mt(x.valor)}`).join(" + ");
                  } catch { return "Dinheiro"; }
                })()}
              </div>
            )}
          </>
        )}
        <hr />
        <div className="centro">Obrigado pela preferência!<br /><i>{emp.slogan}</i></div>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
        <button className="c-btn c-btn-cinza" style={{ flex: 1 }} onClick={onClose}>Fechar</button>
        <button className="c-btn c-btn-linha" style={{ flex: 1 }} disabled={baixando} onClick={baixarRecibo}>
          {baixando ? "…" : "⬇️ PDF"}
        </button>
        <button className="c-btn c-btn-linha" style={{ flex: 1 }} onClick={imprimirRecibo}>🖨 Recibo</button>
        <button
          className="c-btn c-btn-prim" style={{ flex: 1.4 }}
          disabled={factura.isPending}
          onClick={() => user && factura.mutate({ usuarioId: user.id, pedidoId: pedido.id })}
        >
          {factura.isPending ? "…" : "🧾 Factura"}
        </button>
      </div>
      <p className="c-sub" style={{ textAlign: "center", marginTop: 8 }}>
        «⬇️ PDF» baixa o recibo · «🖨 Recibo» imprime o talão simples · «🧾 Factura» emite a factura oficial com NUIT e dados bancários.
      </p>
    </Modal>
  );
}

/* ============ PEDIDOS FECHADOS (Gerente cancela · Admin elimina de todo o histórico) ============ */
function FechadosHoje({ isAdmin, perfil, usuarioId, onCancelar, onEliminar }: {
  isAdmin: boolean;
  perfil: string;
  usuarioId: number;
  onCancelar: (pedidoId: number) => void;
  onEliminar: (pedidoId: number) => void;
}) {
  const { toast } = useSession();
  const utils = trpc.useUtils();
  const emp = useEmpresa();
  const [aberto, setAberto] = useState(false);
  const [baixandoDia, setBaixandoDia] = useState(false);
  const [dia, setDia] = useState(hoje());
  const [verItens, setVerItens] = useState<number | null>(null); // só Admin
  const [pedirAlt, setPedirAlt] = useState<{ id: number; numero: number } | null>(null);
  const [motivoAlt, setMotivoAlt] = useState("");
  const fechados = trpc.pedidos.fechadosDia.useQuery({ dataDia: dia, usuarioId }, { enabled: aberto, refetchInterval: 15000 });
  const dados = fechados.data ?? [];
  const solicitar = trpc.pedidos.solicitarReabertura.useMutation({
    onSuccess: () => { utils.pedidos.fechadosDia.invalidate(); setPedirAlt(null); setMotivoAlt(""); toast("🔓 Pedido de alteração enviado — aguarde a autorização do Administrador"); },
    onError: (e) => toast(e.message),
  });

  /** Documento A4 das vendas detalhadas do dia — os ITENS de cada pedido
      só entram para o Administrador (os dados nem chegam aos outros perfis). */
  const gerarVendasDiaDoc = () => {
    const agora = new Date(Date.now() + 2 * 3600e3);
    const totalGeral = dados.reduce((a, p) => a + p.total, 0);
    const porMetodo = new Map<string, number>();
    for (const p of dados)
      for (const m of (p.metodo ?? "—").split(" + "))
        porMetodo.set(m, (porMetodo.get(m) ?? 0) + p.total / ((p.metodo ?? "—").split(" + ").length));
    const blocos = dados.map((p) => {
      const itens = p.itens.length > 0
        ? `<table style="border-collapse:collapse;width:100%;font-size:8.5pt;margin:3px 0 8px">
            ${p.itens.map((i) => `<tr>
              <td style="padding:2px 4px;border-bottom:1px dotted #ddd">${i.qtd}× ${i.nome}${i.obs ? ` <i>(${i.obs})</i>` : ""}${i.produtoId == null ? " ✳️" : ""}</td>
              <td style="padding:2px 4px;border-bottom:1px dotted #ddd;text-align:right;white-space:nowrap">${mt(i.qtd * i.precoUnit)}</td>
            </tr>`).join("")}
          </table>`
        : `<div style="font-size:8.5pt;color:#8a5a00;margin:3px 0 8px">🔒 detalhe dos produtos visível apenas ao Administrador</div>`;
      return `<div style="margin-bottom:10px;page-break-inside:avoid">
        <div style="display:flex;justify-content:space-between;font-size:9.5pt;font-weight:bold;background:#f2eafa;padding:4px 6px;border-radius:4px">
          <span>Nº ${p.numero} — ${p.referencia || "Pedido"}${p.reaberturaPor ? "" : ""}</span>
          <span>${mt(p.total)}</span>
        </div>
        <div style="font-size:8pt;color:#666;padding:2px 6px">${p.metodo ?? ""}${p.fechadoPor ? ` · fechado por ${p.fechadoPor}` : ""}${p.desconto > 0 ? ` · desconto ${p.desconto}%` : ""}${p.adiantDeduzido > 0 ? ` · adiantamento deduzido: ${mt(p.adiantDeduzido)}` : ""}${p.dividaGerada > 0 ? ` · ficou a dever: ${mt(p.dividaGerada)}` : ""}</div>
        ${itens}
      </div>`;
    }).join("");
    const resumo = [...porMetodo.entries()]
      .map(([m, v]) => `<tr><td style="padding:3px 6px;border:1px solid #ccc">${m}</td><td style="padding:3px 6px;border:1px solid #ccc;text-align:right"><b>${mt(Math.round(v * 100) / 100)}</b></td></tr>`).join("");
    const body = `
      <h2 style="margin:0 0 2px;color:#1F4E79">${emp?.nome ?? "CAMI'S EVENTOS"}</h2>
      <div style="font-size:9pt;color:#555">${[`NUIT: ${emp.nuit}`, emp.local, `${emp.tel1} · ${emp.tel2}`].filter(Boolean).join(" · ")}</div>
      <hr style="border:none;border-top:2px solid #1F4E79;margin:6px 0 10px" />
      <h3 style="margin:0 0 2px">Vendas detalhadas — ${dataBR(dia)}</h3>
      <p style="font-size:9pt;color:#555">${dados.length} pedidos fechados · gerado em ${agora.toISOString().slice(0, 10).split("-").reverse().join("/")} às ${agora.toISOString().slice(11, 16)}</p>
      ${blocos}
      <h3 style="margin:10px 0 4px">Resumo por método de pagamento</h3>
      <table style="border-collapse:collapse;font-size:9pt">${resumo}
        <tr style="background:#1F4E79;color:#fff"><td style="padding:4px 6px;border:1px solid #1F4E79"><b>TOTAL DO DIA</b></td><td style="padding:4px 6px;border:1px solid #1F4E79;text-align:right"><b>${mt(totalGeral)}</b></td></tr>
      </table>`;
    return { titulo: `Vendas detalhadas — ${dia}`, body };
  };

  const imprimirVendasDia = () => {
    if (dados.length === 0) { toast("Sem pedidos fechados neste dia."); return; }
    const d = gerarVendasDiaDoc();
    printDoc(d.titulo, d.body);
  };
  const baixarVendasDia = async () => {
    if (dados.length === 0) { toast("Sem pedidos fechados neste dia."); return; }
    setBaixandoDia(true);
    try {
      const d = gerarVendasDiaDoc();
      await downloadPdf(d.titulo, d.body, `Vendas-detalhadas-${dia}.pdf`);
    } finally { setBaixandoDia(false); }
  };
  const reabrir = trpc.pedidos.reabrirPedido.useMutation({
    onSuccess: () => {
      utils.pedidos.fechadosDia.invalidate(); utils.pedidos.abertos.invalidate(); utils.pagamentos.list.invalidate();
      toast("✅ Pedido reaberto — já pode ser corrigido e fechado de novo");
    },
    onError: (e) => toast(e.message),
  });

  return (
    <div style={{ marginTop: 16 }}>
      <button className="c-btn c-btn-linha c-btn-bloco" onClick={() => setAberto(!aberto)}>
        {aberto ? "▲ Esconder pedidos fechados" : `🧾 Ver pedidos fechados ${dados.length ? `(${dados.length})` : ""}`}
      </button>
      {aberto && (
        <div className="c-card" style={{ marginTop: 8 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
            <label className="c-label" style={{ margin: 0 }}>Dia:</label>
            <input className="c-input" type="date" style={{ maxWidth: 170 }} value={dia} max={hoje()}
              onChange={(e) => setDia(e.target.value || hoje())} />
            <button className="c-btn c-btn-cinza c-btn-peq" onClick={() => setDia(hoje())}>Hoje</button>
            <span style={{ flex: 1 }} />
            <button className="c-btn c-btn-linha c-btn-peq" onClick={imprimirVendasDia}
              title="Imprimir as vendas detalhadas do dia (itens por pedido só para o Admin)">
              🖨️
            </button>
            <button className="c-btn c-btn-linha c-btn-peq" onClick={() => void baixarVendasDia()} disabled={baixandoDia}
              title="Baixar em PDF A4 as vendas detalhadas do dia">
              {baixandoDia ? "…" : "⬇️ A4"}
            </button>
          </div>
          {fechados.isLoading && <Vazio icon="⏳">A carregar…</Vazio>}
          {!fechados.isLoading && dados.length === 0 && <Vazio icon="🧾">Sem pedidos fechados neste dia.</Vazio>}
          {dados.map((p) => (
            <div key={p.id} style={{ borderBottom: "1px dashed #eadff0", padding: "8px 0" }}>
              <div className="c-linha" style={{ flexWrap: "wrap", rowGap: 6 }}>
                <div className="grow">
                  <div className="tit">Nº {p.numero} — {p.referencia || "Pedido"}</div>
                  <div className="det">
                    {p.itensCount} itens · {p.metodo ?? ""}{p.fechadoPor ? ` · fechado por ${p.fechadoPor}` : ""}
                    {!isAdmin && <span style={{ color: "#8a5a00" }}> · 🔒 produtos visíveis só ao Admin</span>}
                  </div>
                  {p.reaberturaPor && (
                    <div style={{ fontSize: 11, fontWeight: 800, color: "#8a5a00", background: "#fff3d6", display: "inline-block", padding: "2px 8px", borderRadius: 12, marginTop: 3 }}>
                      ⏳ alteração pedida por {p.reaberturaPor}{p.reaberturaMotivo ? ` — «${p.reaberturaMotivo}»` : ""}
                    </div>
                  )}
                </div>
                <div className="fim" style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <b style={{ color: "var(--roxo)" }}>{mt(p.total)}</b>
                  {isAdmin && (
                    <button className="c-btn c-btn-linha c-btn-peq" title="Ver os produtos/serviços comprados (só Admin)"
                      onClick={() => setVerItens(verItens === p.id ? null : p.id)}>
                      {verItens === p.id ? "▲" : "👁 Itens"}
                    </button>
                  )}
                  {isAdmin && !p.reaberturaPor && (
                    <button className="c-btn c-btn-linha c-btn-peq"
                      title="Reabrir esta venda para corrigir (ex.: data errada) — o stock é reposto, os pagamentos anulados e a dívida/comissões estornadas; depois feche a conta de novo"
                      disabled={reabrir.isPending}
                      onClick={() => { if (confirm(`Reabrir o pedido nº ${p.numero} para correcção?\n\nO pedido volta a ABERTO: o stock é reposto, o pagamento é anulado e a dívida/comissões ligadas a esta venda são estornadas.\nDepois de corrigir (ex.: a data), feche a conta de novo.`)) reabrir.mutate({ usuarioId, pedidoId: p.id }); }}>
                      ✏️ Reabrir p/ corrigir
                    </button>
                  )}
                  {isAdmin && p.reaberturaPor && (
                    <button className="c-btn c-btn-verde c-btn-peq"
                      title={`Autorizar a alteração pedida por ${p.reaberturaPor}`}
                      disabled={reabrir.isPending}
                      onClick={() => { if (confirm(`Autorizar a alteração do pedido nº ${p.numero}?\n\nPedido por: ${p.reaberturaPor}\nMotivo: ${p.reaberturaMotivo ?? "—"}\n\nO pedido volta a ABERTO: o stock é reposto e o pagamento é anulado. Depois de corrigir, feche a conta de novo.`)) reabrir.mutate({ usuarioId, pedidoId: p.id }); }}>
                      ✅ Autorizar
                    </button>
                  )}
                  {!isAdmin && !p.reaberturaPor && (
                    <button className="c-btn c-btn-linha c-btn-peq" title="Pedir ao Administrador autorização para alterar este pedido (fechado por engano)"
                      onClick={() => { setPedirAlt({ id: p.id, numero: p.numero }); setMotivoAlt(""); }}>
                      🔓 Pedir alteração
                    </button>
                  )}
                  {(isAdmin || perfil === "Gestor") && (
                    <button className="c-btn c-btn-perigo c-btn-peq" title="Cancelar (repõe stock e anula pagamento — fica registo)"
                      onClick={() => { if (confirm(`Cancelar o pedido nº ${p.numero}? O stock será reposto e o pagamento anulado.`)) onCancelar(p.id); }}>
                      ✕
                    </button>
                  )}
                  {isAdmin && (
                    <button className="c-btn c-btn-perigo c-btn-peq" title="Eliminar de TODO o histórico (só Admin)"
                      onClick={() => {
                        if (!confirm(`⚠️ ELIMINAR o pedido nº ${p.numero} (${mt(p.total)}) de TODO o histórico?\n\nSerão apagados: o pedido, os itens, o pagamento e as comissões de afiliado ligadas. O stock é reposto.\n\nEsta acção NÃO pode ser desfeita.`)) return;
                        if (confirm(`Tem a certeza absoluta? Confirme para apagar o pedido nº ${p.numero} permanentemente.`)) onEliminar(p.id);
                      }}>
                      🗑
                    </button>
                  )}
                </div>
              </div>
              {isAdmin && verItens === p.id && (
                <div style={{ margin: "6px 0 2px", padding: "6px 10px", background: "#faf6fd", borderRadius: 8, fontSize: 12 }}>
                  {p.itens.map((i) => (
                    <div key={i.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "2px 0" }}>
                      <span>{i.produtoId == null ? "✳️ " : ""}{i.qtd}× {i.nome}{i.obs ? ` (${i.obs})` : ""}</span>
                      <b>{mt(i.qtd * i.precoUnit)}</b>
                    </div>
                  ))}
                  {p.desconto > 0 && <div className="c-sub" style={{ textAlign: "right" }}>desconto {p.desconto}%</div>}
                </div>
              )}
            </div>
          ))}
          {pedirAlt && (
            <Modal onClose={() => setPedirAlt(null)}>
              <h3>🔓 Pedir alteração — Pedido nº {pedirAlt.numero}</h3>
              <p className="c-sub">
                O pedido está <b>fechado</b>. Explique o engano — o <b>Administrador</b> recebe o pedido e,
                se autorizar, o pedido volta a aberto para ser corrigido e fechado de novo.
              </p>
              <label className="c-label">Motivo (obrigatório)</label>
              <textarea className="c-input" rows={3} placeholder="Ex.: fechei por engano — faltava adicionar 2 cervejas"
                value={motivoAlt} onChange={(e) => setMotivoAlt(e.target.value)} autoFocus />
              <button className="c-btn c-btn-prim c-btn-bloco" style={{ marginTop: 12 }}
                disabled={solicitar.isPending || motivoAlt.trim().length < 4}
                onClick={() => solicitar.mutate({ usuarioId, pedidoId: pedirAlt.id, motivo: motivoAlt.trim() })}>
                {solicitar.isPending ? "A enviar…" : "📨 Enviar pedido ao Administrador"}
              </button>
            </Modal>
          )}
          {isAdmin && dados.length > 0 && (
            <p className="c-sub" style={{ margin: "8px 0 0", fontSize: 11 }}>
              ✕ cancela (fica registo de anulação) · 🗑 elimina de TODO o histórico — apenas Administrador, para corrigir registos feitos por engano.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
