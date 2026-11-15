/* ============ DÍVIDAS DE CLIENTES (FIADO) ============
   Toda a dívida fica visível aqui até ser paga por completo.
   Pagamentos podem ser parciais; cada um entra no Financeiro do dia. */
import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { useSession } from "@/lib/session";
import { mt, dataBR, horaBR, hoje } from "@/lib/fmt";
import { waLink } from "@/lib/loja";
import { Modal, Stat, Vazio, Voltar } from "@/components/bits";
import MoneyInput from "@/components/MoneyInput";
import { printDoc, downloadPdf } from "@/lib/docprint";
import { useEmpresa } from "@/lib/empresa";
import { METODOS_PAGAMENTO, type EmpresaCfg } from "@contracts/types";
import type { AppRouter } from "../../api/router";
import type { inferRouterOutputs } from "@trpc/server";

type Divida = inferRouterOutputs<AppRouter>["dividas"]["list"][number];
type DividaForn = inferRouterOutputs<AppRouter>["dividas"]["fornecedores"][number];

export default function Dividas({ voltar }: { voltar: () => void }) {
  const { user, toast } = useSession();
  const utils = trpc.useUtils();
  const [aba, setAba] = useState<"Abertas" | "Liquidadas" | "Fornecedores">("Abertas");
  const [busca, setBusca] = useState("");
  const [pagarSel, setPagarSel] = useState<Divida | null>(null);
  const [histSel, setHistSel] = useState<Divida | null>(null);
  const [novoOpen, setNovoOpen] = useState(false);

  const lista = trpc.dividas.list.useQuery({ usuarioId: user?.id ?? 0 }, { refetchInterval: 15000 });
  const resumo = trpc.dividas.resumo.useQuery({ usuarioId: user?.id ?? 0 }, { refetchInterval: 15000 });
  const forn = trpc.dividas.fornecedores.useQuery({ usuarioId: user?.id ?? 0 }, { refetchInterval: 15000 });
  const [pagarForn, setPagarForn] = useState<DividaForn | null>(null);
  const [contactoForn, setContactoForn] = useState<DividaForn | null>(null);
  const [extratoSel, setExtratoSel] = useState<Divida | null>(null);
  const [baixandoLista, setBaixandoLista] = useState(false);
  const emp = useEmpresa();

  const invalida = () => {
    utils.dividas.list.invalidate(); utils.dividas.resumo.invalidate(); utils.dividas.fornecedores.invalidate();
    utils.despesas.list.invalidate();
  };
  const amortizarForn = trpc.despesas.amortizar.useMutation({
    onSuccess: (r) => {
      toast(r.quitado ? "✅ Dívida ao fornecedor paga por completo!" : `✅ Pagamento registado — pago ${mt(r.pago)} no total`);
      setPagarForn(null); invalida();
    },
    onError: (e) => toast("⚠️ " + e.message),
  });
  const guardarContacto = trpc.despesas.fornecedorContacto.useMutation({
    onSuccess: () => { toast("✅ Contacto do fornecedor guardado"); setContactoForn(null); invalida(); },
    onError: (e) => toast("⚠️ " + e.message),
  });
  const pagar = trpc.dividas.pagar.useMutation({
    onSuccess: (r) => {
      toast(r.liquidada ? "✅ Dívida liquidada por completo!" : `✅ Pagamento registado — saldo ${mt(r.saldo)}`);
      setPagarSel(null); invalida();
    },
    onError: (e) => toast("⚠️ " + e.message),
  });
  const criar = trpc.dividas.criar.useMutation({
    onSuccess: (r) => { toast(`✅ Dívida ${r.codigo} registada`); setNovoOpen(false); invalida(); },
    onError: (e) => toast("⚠️ " + e.message),
  });
  const anular = trpc.dividas.anular.useMutation({
    onSuccess: () => { toast("🗑 Dívida anulada"); invalida(); },
    onError: (e) => toast("⚠️ " + e.message),
  });

  const dados = (lista.data ?? []).filter((d) => d.status === (aba === "Abertas" ? "Aberta" : "Liquidada"));
  const filtradas = busca.trim()
    ? dados.filter((d) =>
        `${d.clienteNome} ${d.codigo} ${d.clienteTel ?? ""}`.toLowerCase().includes(busca.trim().toLowerCase()))
    : dados;
  const isAdmin = !!user && ["Admin", "Gestor"].includes(user.perfil);

  /* ---------- Documentos A4: relação de dívidas (lista) ---------- */
  const escH = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const cabDoc = (titulo: string) => {
    const agora = new Date(Date.now() + 2 * 3600e3);
    return `
      <h2 style="margin:0 0 2px;color:#1F4E79">${escH(emp?.nome ?? "CAMI'S EVENTOS")}</h2>
      <div style="font-size:9pt;color:#555">${[`NUIT: ${emp.nuit}`, emp.local, [emp.tel1, emp.tel2].filter(Boolean).join(" · ")].filter(Boolean).join(" · ")}</div>
      <hr style="border:none;border-top:2px solid #1F4E79;margin:6px 0 10px" />
      <h3 style="margin:0 0 4px">${titulo}</h3>
      <p style="font-size:9pt;color:#555">Emitido em ${agora.toISOString().slice(0, 10).split("-").reverse().join("/")} às ${agora.toISOString().slice(11, 16)} por ${escH(user?.nome ?? "")}</p>`;
  };

  /** Relação das dívidas visíveis no ecrã (aba actual + pesquisa) — clientes ou fornecedores */
  const gerarListaDoc = () => {
    if (aba === "Fornecedores") {
      const ds = forn.data ?? [];
      const linhas = ds.map((d) => `<tr>
        <td>${escH(d.fornecedor || "Fornecedor sem nome")}</td>
        <td>${escH(d.descricao)}</td>
        <td style="white-space:nowrap">${d.dataDia.split("-").reverse().join("/")}</td>
        <td style="text-align:center">${d.diasEmAberto > 0 ? d.diasEmAberto : "—"}</td>
        <td style="text-align:right">${mt(d.valor)}</td>
        <td style="text-align:right">${mt(d.valorPago)}</td>
        <td style="text-align:right"><b>${mt(d.saldo)}</b></td>
      </tr>`).join("");
      const body = `${cabDoc("Relação de dívidas a fornecedores")}
        <table style="border-collapse:collapse;width:100%;font-size:9.5pt">
          <tr style="background:#1F4E79;color:#fff">
            <th style="padding:5px;border:1px solid #999;text-align:left">Fornecedor</th>
            <th style="padding:5px;border:1px solid #999;text-align:left">Descrição</th>
            <th style="padding:5px;border:1px solid #999">Data</th>
            <th style="padding:5px;border:1px solid #999">Dias</th>
            <th style="padding:5px;border:1px solid #999">Total</th>
            <th style="padding:5px;border:1px solid #999">Pago</th>
            <th style="padding:5px;border:1px solid #999">Saldo</th>
          </tr>${linhas}
          <tr style="background:#eef3f8;font-weight:bold">
            <td colspan="4" style="padding:5px;border:1px solid #999">TOTAL (${ds.length} dívida${ds.length === 1 ? "" : "s"})</td>
            <td style="padding:5px;border:1px solid #999;text-align:right">${mt(ds.reduce((a, d) => a + d.valor, 0))}</td>
            <td style="padding:5px;border:1px solid #999;text-align:right">${mt(ds.reduce((a, d) => a + d.valorPago, 0))}</td>
            <td style="padding:5px;border:1px solid #999;text-align:right">${mt(ds.reduce((a, d) => a + d.saldo, 0))}</td>
          </tr>
        </table>
        <p style="font-size:8.5pt;color:#666;margin-top:10px">Documento interno — dívidas da empresa a fornecedores em aberto.</p>`;
      return { titulo: "Relação de dívidas a fornecedores", body };
    }
    const emAberto = aba === "Abertas";
    const ds = filtradas;
    const linhas = ds.map((d) => `<tr>
      <td>${escH(d.clienteNome)}${d.clienteTel ? `<br><span style="font-size:8.5pt;color:#555">📞 ${escH(d.clienteTel)}</span>` : ""}</td>
      <td style="white-space:nowrap">${escH(d.codigo)}</td>
      <td style="white-space:nowrap">${d.dataDia.split("-").reverse().join("/")}</td>
      ${emAberto
        ? `<td style="text-align:center">${d.diasEmAberto > 0 ? d.diasEmAberto : "—"}</td>`
        : `<td style="white-space:nowrap">${d.liquidadaEm ? dataBR(d.liquidadaEm) : "—"}</td>`}
      <td style="text-align:right">${mt(d.valorTotal)}</td>
      <td style="text-align:right">${mt(d.pago)}</td>
      <td style="text-align:right"><b>${emAberto ? mt(d.saldo) : "✅"}</b></td>
      <td style="font-size:8.5pt;color:#444">${escH(d.obs ?? "")}</td>
    </tr>`).join("");
    const titulo = emAberto ? "Relação de dívidas de clientes em aberto" : "Relação de dívidas liquidadas";
    const body = `${cabDoc(titulo)}${busca.trim() ? `<p style="font-size:9pt;color:#555">Filtro aplicado: «${escH(busca.trim())}»</p>` : ""}
      <table style="border-collapse:collapse;width:100%;font-size:9.5pt">
        <tr style="background:#1F4E79;color:#fff">
          <th style="padding:5px;border:1px solid #999;text-align:left">Cliente</th>
          <th style="padding:5px;border:1px solid #999">Código</th>
          <th style="padding:5px;border:1px solid #999">Data</th>
          <th style="padding:5px;border:1px solid #999">${emAberto ? "Dias" : "Liquidada"}</th>
          <th style="padding:5px;border:1px solid #999">Total</th>
          <th style="padding:5px;border:1px solid #999">Pago</th>
          <th style="padding:5px;border:1px solid #999">Saldo</th>
          <th style="padding:5px;border:1px solid #999;text-align:left">Obs</th>
        </tr>${linhas}
        <tr style="background:#eef3f8;font-weight:bold">
          <td colspan="4" style="padding:5px;border:1px solid #999">TOTAL (${ds.length} dívida${ds.length === 1 ? "" : "s"})</td>
          <td style="padding:5px;border:1px solid #999;text-align:right">${mt(ds.reduce((a, d) => a + d.valorTotal, 0))}</td>
          <td style="padding:5px;border:1px solid #999;text-align:right">${mt(ds.reduce((a, d) => a + d.pago, 0))}</td>
          <td style="padding:5px;border:1px solid #999;text-align:right">${mt(ds.reduce((a, d) => a + d.saldo, 0))}</td>
          <td style="padding:5px;border:1px solid #999"></td>
        </tr>
      </table>
      <p style="font-size:8.5pt;color:#666;margin-top:10px">${emAberto
        ? "Documento interno — clientes com valores em dívida. «Dias» = dias em aberto desde a data da dívida."
        : "Documento interno — dívidas já liquidadas na totalidade."}</p>`;
    return { titulo, body };
  };

  const imprimirLista = () => {
    const d = gerarListaDoc();
    printDoc(d.titulo, d.body);
  };
  const baixarLista = async () => {
    setBaixandoLista(true);
    try {
      const d = gerarListaDoc();
      await downloadPdf(d.titulo, d.body, `${d.titulo} — ${hoje()}.pdf`);
    } finally { setBaixandoLista(false); }
  };

  const msgCobranca = (d: Divida) =>
    `Olá ${d.clienteNome}! 👋\n\nSomos da *CAMI'S Eventos* (Chimoio). Recordamos que tem uma dívida em aberto connosco:\n\n🧾 Dívida ${d.codigo} de ${d.dataDia.split("-").reverse().join("/")}\n💰 Saldo em dívida: *${mt(d.saldo)}*\n\nAgradecemos a liquidação assim que possível — assim que regularizar, teremos todo o gosto em recebê-lo de volta. Qualquer dúvida, estamos à disposição. Obrigado pela preferência! 🙏`;

  return (
    <div>
      <Voltar onClick={voltar} />
      <div className="c-titulo">🧾 Dívidas de Clientes</div>
      <p className="c-sub" style={{ marginTop: -6 }}>
        Toda a dívida fica visível aqui <b>até ser paga por completo</b>. Os pagamentos podem ser parciais.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 10, marginBottom: 12 }}>
        <Stat cls="vm" lbl="🧾 Clientes devem-nos">{mt(resumo.data?.totalEmDivida ?? 0)}</Stat>
        <Stat cls="a" lbl="🏭 Devemos a fornecedores">{mt(resumo.data?.fornTotal ?? 0)}</Stat>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
        <button className={`c-btn grow ${aba === "Abertas" ? "c-btn-prim" : "c-btn-cinza"}`} onClick={() => setAba("Abertas")}>
          ⏳ Clientes ({(lista.data ?? []).filter((d) => d.status === "Aberta").length})
        </button>
        <button className={`c-btn grow ${aba === "Fornecedores" ? "c-btn-prim" : "c-btn-cinza"}`} onClick={() => setAba("Fornecedores")}>
          🏭 Fornecedores ({resumo.data?.fornAbertas ?? 0})
        </button>
        <button className={`c-btn grow ${aba === "Liquidadas" ? "c-btn-prim" : "c-btn-cinza"}`} onClick={() => setAba("Liquidadas")}>
          ✅ Liquidadas
        </button>
        {aba !== "Fornecedores" && (
          <button className="c-btn c-btn-verde" onClick={() => setNovoOpen(true)}>＋</button>
        )}
        <button className="c-btn c-btn-linha" title="Imprimir a relação das dívidas desta lista (A4)"
          onClick={imprimirLista}>🖨️</button>
        <button className="c-btn c-btn-linha" title="Baixar a relação das dívidas desta lista em PDF (A4)"
          onClick={() => void baixarLista()} disabled={baixandoLista}>
          {baixandoLista ? "…" : "⬇️ PDF"}
        </button>
      </div>

      <input className="c-input" placeholder="🔍 Procurar por nome, código ou telefone…" value={busca}
        onChange={(e) => setBusca(e.target.value)} style={{ marginBottom: 10 }} />

      {/* ============ DÍVIDAS A FORNECEDORES (a empresa deve) ============ */}
      {aba === "Fornecedores" && (
        <div className="c-card">
          <p className="c-sub" style={{ marginTop: 0 }}>
            Dívidas da <b>CAMI'S Eventos</b> aos fornecedores — despesas lançadas «A crédito» ou «Em parcelas» na página 💸 Despesas.
            Ficam visíveis aqui <b>até serem pagas por completo</b>.
          </p>
          {forn.isLoading && <Vazio icon="⏳">A carregar…</Vazio>}
          {!forn.isLoading && (forn.data ?? []).length === 0 && <Vazio icon="🏭">Sem dívidas a fornecedores. 🎉</Vazio>}
          {(forn.data ?? []).map((d) => (
            <div className="c-linha" key={d.id} style={{ alignItems: "flex-start", flexWrap: "wrap", gap: 8 }}>
              <div className="grow">
                <div className="tit">🏭 {d.fornecedor || "Fornecedor sem nome"}</div>
                <div className="det">
                  {d.descricao} · {d.dataDia.split("-").reverse().join("/")}
                  {d.diasEmAberto > 0 && ` · há ${d.diasEmAberto} dia${d.diasEmAberto > 1 ? "s" : ""}`}
                  {d.fornecedorTel ? ` · 📞 ${d.fornecedorTel}` : ""}
                </div>
                <div className="det" style={{ marginTop: 2 }}>
                  Total {mt(d.valor)} · Já pago <b style={{ color: "var(--verde-c)" }}>{mt(d.valorPago)}</b>
                  {" · "}{d.formaPagamento === "Credito" ? "💳 A crédito" : "🧾 Em parcelas"}
                </div>
                <div style={{ height: 6, borderRadius: 6, background: "rgba(0,0,0,.08)", marginTop: 6, overflow: "hidden" }}>
                  <div style={{
                    height: "100%", borderRadius: 6,
                    width: `${Math.min(100, ((d.valorPago ?? 0) / Math.max(1, d.valor)) * 100)}%`,
                    background: "var(--amarelo-c)",
                  }} />
                </div>
              </div>
              <div className="fim" style={{ textAlign: "right" }}>
                <b style={{ fontSize: 16, color: "var(--vermelho-c)" }}>{mt(d.saldo)}</b>
                <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                  {isAdmin && (
                    <button className="c-btn c-btn-verde c-btn-peq" onClick={() => setPagarForn(d)}>💰 Pagar</button>
                  )}
                  {d.fornecedorTel && (
                    <a className="c-btn c-btn-prim c-btn-peq" target="_blank" rel="noreferrer"
                      href={waLink(d.fornecedorTel, `Olá ${d.fornecedor ?? "fornecedor"}! 👋

Somos da *CAMI'S Eventos* (Chimoio). Sobre a nossa conta consigo (${d.descricao}, de ${d.dataDia.split("-").reverse().join("/")}):

💰 Saldo em dívida: *${mt(d.saldo)}*

Entraremos em contacto para combinar o pagamento. Obrigado pela parceria! 🙏`)}>📲</a>
                  )}
                  {isAdmin && (
                    <button className="c-btn c-btn-cinza c-btn-peq" title="Definir nome/contacto do fornecedor"
                      onClick={() => setContactoForn(d)}>✏️</button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {aba !== "Fornecedores" && (
      <div className="c-card">
        {lista.isLoading && <Vazio icon="⏳">A carregar…</Vazio>}
        {!lista.isLoading && filtradas.length === 0 && (
          <Vazio icon="🧾">{aba === "Abertas" ? "Nenhuma dívida em aberto. 🎉" : "Ainda não há dívidas liquidadas."}</Vazio>
        )}
        {filtradas.map((d) => (
          <div className="c-linha" key={d.id} style={{ alignItems: "flex-start", flexWrap: "wrap", gap: 8 }}>
            <div className="grow">
              <div className="tit">
                {d.clienteNome}
                <span style={{ fontWeight: 400, fontSize: 12, opacity: .7 }}> · {d.codigo}</span>
              </div>
              <div className="det">
                {d.dataDia.split("-").reverse().join("/")}
                {d.status === "Aberta" && d.diasEmAberto > 0 && ` · há ${d.diasEmAberto} dia${d.diasEmAberto > 1 ? "s" : ""}`}
                {d.clienteTel ? ` · 📞 ${d.clienteTel}` : ""}
                {d.obs ? ` · ${d.obs}` : ""}
              </div>
              <div className="det" style={{ marginTop: 2 }}>
                Total {mt(d.valorTotal)} · Pago <b style={{ color: "var(--verde-c)" }}>{mt(d.pago)}</b>
                {d.status === "Liquidada" && d.liquidadaEm && ` · ✅ liquidada em ${dataBR(d.liquidadaEm)}`}
              </div>
              {/* barra de progresso do pagamento */}
              <div style={{ height: 6, borderRadius: 6, background: "rgba(0,0,0,.08)", marginTop: 6, overflow: "hidden" }}>
                <div style={{
                  height: "100%", borderRadius: 6,
                  width: `${Math.min(100, (d.pago / Math.max(1, d.valorTotal)) * 100)}%`,
                  background: d.status === "Liquidada" ? "var(--verde-c)" : "var(--amarelo-c)",
                }} />
              </div>
            </div>
            <div className="fim" style={{ textAlign: "right" }}>
              <b style={{ fontSize: 16, color: d.status === "Aberta" ? "var(--vermelho-c)" : "var(--verde-c)" }}>
                {d.status === "Aberta" ? mt(d.saldo) : "✅"}
              </b>
              <div style={{ display: "flex", gap: 6, marginTop: 6, justifyContent: "flex-end" }}>
                <button className="c-btn c-btn-cinza c-btn-peq" title="Extrato da dívida — imprimir / baixar em PDF (A4)"
                  onClick={() => setExtratoSel(d)}>📄 Extrato</button>
              </div>
              {d.status === "Aberta" && (
                <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                  <button className="c-btn c-btn-verde c-btn-peq" onClick={() => setPagarSel(d)}>💰 Pagar</button>
                  {d.clienteTel && (
                    <a className="c-btn c-btn-prim c-btn-peq" target="_blank" rel="noreferrer"
                      href={waLink(d.clienteTel, msgCobranca(d))}>📲 Cobrar</a>
                  )}
                  {(d.pago > 0 || d.status !== "Aberta") && (
                    <button className="c-btn c-btn-cinza c-btn-peq" onClick={() => setHistSel(d)}>🧾</button>
                  )}
                  {isAdmin && d.pago <= 0 && (
                    <button className="c-btn c-btn-cinza c-btn-peq" title="Anular dívida (registada por engano)"
                      onClick={() => { if (confirm(`Anular a dívida ${d.codigo} de ${d.clienteNome}?`)) anular.mutate({ usuarioId: user!.id, dividaId: d.id }); }}>
                      🗑
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      )}

      {pagarSel && user && (
        <PagarModal
          d={pagarSel}
          pendente={pagar.isPending}
          onClose={() => setPagarSel(null)}
          onPagar={(valor, metodo, dataReceb) => pagar.mutate({ usuarioId: user.id, dividaId: pagarSel.id, valor, metodo, dataDia: dataReceb })}
        />
      )}
      {histSel && user && <HistoricoModal d={histSel} usuarioId={user.id} onClose={() => setHistSel(null)} />}
      {extratoSel && user && (
        <ExtratoModal
          d={extratoSel}
          todas={lista.data ?? []}
          emp={emp}
          usuarioId={user.id}
          usuarioNome={user.nome}
          onClose={() => setExtratoSel(null)}
        />
      )}
      {novoOpen && user && (
        <NovaDividaModal
          pendente={criar.isPending}
          onClose={() => setNovoOpen(false)}
          onCriar={(nome, tel, valor, obs) => criar.mutate({ usuarioId: user.id, clienteNome: nome, clienteTel: tel, valor, obs })}
        />
      )}
      {pagarForn && user && (
        <PagarFornecedorModal
          d={pagarForn}
          pendente={amortizarForn.isPending}
          onClose={() => setPagarForn(null)}
          onPagar={(valor) => amortizarForn.mutate({ usuarioId: user.id, id: pagarForn.id, valor })}
        />
      )}
      {contactoForn && user && (
        <ContactoFornecedorModal
          d={contactoForn}
          pendente={guardarContacto.isPending}
          onClose={() => setContactoForn(null)}
          onGuardar={(nome, tel) => guardarContacto.mutate({ usuarioId: user.id, id: contactoForn.id, fornecedor: nome, fornecedorTel: tel || undefined })}
        />
      )}
    </div>
  );
}

/* ---------- Pagar dívida a fornecedor (amortização da despesa) ---------- */
function PagarFornecedorModal({ d, pendente, onClose, onPagar }: {
  d: DividaForn; pendente: boolean; onClose: () => void;
  onPagar: (valor: number) => void;
}) {
  const [valor, setValor] = useState(d.saldo);
  const ok = valor > 0 && valor <= d.saldo + 0.004;
  return (
    <Modal onClose={onClose}>
      <h3>💰 Pagar ao fornecedor</h3>
      <p className="c-sub">
        🏭 {d.fornecedor || "Fornecedor"} · {d.descricao} · total {mt(d.valor)} · já pago {mt(d.valorPago)} · <b style={{ color: "var(--vermelho-c)" }}>falta {mt(d.saldo)}</b>
      </p>
      <label className="c-label">Valor a pagar agora (MZN)</label>
      <MoneyInput value={valor} onChange={(v) => setValor(Math.max(0, Math.min(d.saldo, v)))} />
      <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
        <button type="button" className="c-btn c-btn-cinza c-btn-peq" onClick={() => setValor(d.saldo)}>Tudo ({mt(d.saldo)})</button>
        <button type="button" className="c-btn c-btn-cinza c-btn-peq" onClick={() => setValor(Math.round(d.saldo / 2 * 100) / 100)}>Metade</button>
      </div>
      {valor < d.saldo - 0.004 && valor > 0 && (
        <p className="c-sub" style={{ marginTop: 8, color: "var(--amarelo-c)" }}>
          ⏳ Ficará a faltar ainda <b>{mt(d.saldo - valor)}</b> — a dívida continua visível até ser paga por completo.
        </p>
      )}
      <button className="c-btn c-btn-verde c-btn-bloco" style={{ marginTop: 14 }}
        disabled={pendente || !ok} onClick={() => onPagar(valor)}>
        {pendente ? "A registar…" : `✅ Registar Pagamento — ${mt(valor)}`}
      </button>
    </Modal>
  );
}

/* ---------- Definir/actualizar contacto do fornecedor ---------- */
function ContactoFornecedorModal({ d, pendente, onClose, onGuardar }: {
  d: DividaForn; pendente: boolean; onClose: () => void;
  onGuardar: (nome: string, tel: string) => void;
}) {
  const [nome, setNome] = useState(d.fornecedor ?? "");
  const [tel, setTel] = useState(d.fornecedorTel ?? "");
  return (
    <Modal onClose={onClose}>
      <h3>✏️ Fornecedor — {d.descricao.slice(0, 40)}</h3>
      <label className="c-label">Nome do fornecedor *</label>
      <input className="c-input" placeholder="Ex.: Luís Ferrão (frangos)" value={nome} onChange={(e) => setNome(e.target.value)} autoFocus />
      <label className="c-label">Contacto (telefone/WhatsApp)</label>
      <input className="c-input" inputMode="tel" placeholder="Ex.: 86 790 1967" value={tel} onChange={(e) => setTel(e.target.value)} />
      <button className="c-btn c-btn-verde c-btn-bloco" style={{ marginTop: 14 }}
        disabled={pendente || nome.trim().length < 2} onClick={() => onGuardar(nome.trim(), tel.trim())}>
        {pendente ? "A guardar…" : "✅ Guardar"}
      </button>
    </Modal>
  );
}

/* ---------- Pagamento (parcial ou total) ---------- */
function PagarModal({ d, pendente, onClose, onPagar }: {
  d: Divida; pendente: boolean; onClose: () => void;
  onPagar: (valor: number, metodo: string, dataReceb?: string) => void;
}) {
  const [valor, setValor] = useState(d.saldo);
  const [metodo, setMetodo] = useState<string>(METODOS_PAGAMENTO[0]);
  // dia em que o dinheiro foi recebido — a receita entra no Financeiro DESSE dia
  const [dataReceb, setDataReceb] = useState(hoje());
  const ok = valor > 0 && valor <= d.saldo + 0.004;
  return (
    <Modal onClose={onClose}>
      <h3>💰 Pagamento — {d.codigo}</h3>
      <p className="c-sub">
        {d.clienteNome} · total {mt(d.valorTotal)} · já pago {mt(d.pago)} · <b style={{ color: "var(--vermelho-c)" }}>saldo {mt(d.saldo)}</b>
      </p>
      <label className="c-label">Valor a receber agora (MZN)</label>
      <MoneyInput value={valor} onChange={(v) => setValor(Math.max(0, Math.min(d.saldo, v)))} />
      <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
        <button type="button" className="c-btn c-btn-cinza c-btn-peq" onClick={() => setValor(d.saldo)}>Tudo ({mt(d.saldo)})</button>
        <button type="button" className="c-btn c-btn-cinza c-btn-peq" onClick={() => setValor(Math.round(d.saldo / 2 * 100) / 100)}>Metade</button>
      </div>
      <label className="c-label" style={{ marginTop: 10 }}>Método de Pagamento</label>
      <div className="c-pag-grelha">
        {METODOS_PAGAMENTO.map((m) => (
          <button key={m} type="button" className={m === metodo ? "sel" : ""} onClick={() => setMetodo(m)}>{m}</button>
        ))}
      </div>
      <label className="c-label" style={{ marginTop: 10 }}>📅 Data de recebimento</label>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input className="c-input" type="date" style={{ maxWidth: 170 }} value={dataReceb} max={hoje()}
          onChange={(e) => setDataReceb(e.target.value || hoje())} />
        {dataReceb !== hoje() && (
          <button type="button" className="c-btn c-btn-cinza c-btn-peq" onClick={() => setDataReceb(hoje())}>Hoje</button>
        )}
      </div>
      {dataReceb !== hoje() ? (
        <p className="c-sub" style={{ marginTop: 4, color: "var(--amarelo-c)" }}>
          ⏪ O valor entra na receita do dia <b>{dataReceb.split("-").reverse().join("/")}</b> (dia em que foi recebido), não de hoje.
        </p>
      ) : (
        <p className="c-sub" style={{ marginTop: 4 }}>
          O valor entra na receita de <b>hoje</b> — o dia em que o dinheiro entra em caixa.
        </p>
      )}
      {valor < d.saldo - 0.004 && valor > 0 && (
        <p className="c-sub" style={{ marginTop: 8, color: "var(--amarelo-c)" }}>
          ⏳ Fica a dever ainda <b>{mt(d.saldo - valor)}</b> — a dívida continua visível até ser paga por completo.
        </p>
      )}
      {ok && Math.abs(valor - d.saldo) < 0.005 && (
        <p className="c-sub" style={{ marginTop: 8, color: "var(--verde-c)" }}>
          ✅ Com este pagamento a dívida fica <b>liquidada</b>.
        </p>
      )}
      <button className="c-btn c-btn-verde c-btn-bloco" style={{ marginTop: 14 }}
        disabled={pendente || !ok} onClick={() => onPagar(valor, metodo, dataReceb !== hoje() ? dataReceb : undefined)}>
        {pendente ? "A registar…" : `✅ Registar Pagamento — ${mt(valor)}`}
      </button>
    </Modal>
  );
}

/* ---------- Histórico de amortizações ---------- */
function HistoricoModal({ d, usuarioId, onClose }: { d: Divida; usuarioId: number; onClose: () => void }) {
  const hist = trpc.dividas.historico.useQuery({ usuarioId, dividaId: d.id });
  return (
    <Modal onClose={onClose}>
      <h3>🧾 Histórico — {d.codigo}</h3>
      <p className="c-sub">{d.clienteNome} · total {mt(d.valorTotal)}</p>
      {(hist.data ?? []).length === 0 && !hist.isLoading && <Vazio icon="🧾">Sem pagamentos registados.</Vazio>}
      {(hist.data ?? []).map((h) => (
        <div className="c-linha" key={h.id}>
          <div className="grow">
            <div className="tit">{mt(h.valor)}</div>
            <div className="det">{dataBR(h.criadoEm)} {horaBR(h.criadoEm)} · {h.metodo}{h.usuario ? ` · ${h.usuario}` : ""}</div>
          </div>
        </div>
      ))}
    </Modal>
  );
}

/* ---------- Extrato individual da dívida (A4: imprimir / baixar PDF) ---------- */
function ExtratoModal({ d, todas, emp, usuarioId, usuarioNome, onClose }: {
  d: Divida;
  todas: Divida[];
  emp: EmpresaCfg;
  usuarioId: number;
  usuarioNome: string;
  onClose: () => void;
}) {
  const hist = trpc.dividas.historico.useQuery({ usuarioId, dividaId: d.id });
  const [baixando, setBaixando] = useState(false);
  const escH = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  // outras dívidas EM ABERTO do mesmo cliente (contexto no extrato)
  const outras = todas.filter((x) =>
    x.id !== d.id && x.status === "Aberta" &&
    x.clienteNome.trim().toLowerCase() === d.clienteNome.trim().toLowerCase());
  const totalOutras = outras.reduce((a, x) => a + x.saldo, 0);

  const gerarDoc = () => {
    const agora = new Date(Date.now() + 2 * 3600e3);
    const pags = hist.data ?? [];
    const linPag = pags.length
      ? pags.map((h) => `<tr>
          <td style="white-space:nowrap">${dataBR(h.criadoEm)} ${horaBR(h.criadoEm)}</td>
          <td style="text-align:right">${mt(h.valor)}</td>
          <td>${escH(h.metodo)}</td>
          <td>${escH(h.usuario ?? "—")}</td>
        </tr>`).join("")
      : `<tr><td colspan="4" style="text-align:center;color:#666">Ainda sem pagamentos registados.</td></tr>`;
    const linOutras = outras.map((x) => `<tr>
        <td>${escH(x.codigo)}</td>
        <td style="white-space:nowrap">${x.dataDia.split("-").reverse().join("/")}</td>
        <td style="text-align:right">${mt(x.valorTotal)}</td>
        <td style="text-align:right">${mt(x.pago)}</td>
        <td style="text-align:right"><b>${mt(x.saldo)}</b></td>
      </tr>`).join("");
    const body = `
      <h2 style="margin:0 0 2px;color:#1F4E79">${escH(emp?.nome ?? "CAMI'S EVENTOS")}</h2>
      <div style="font-size:9pt;color:#555">${[`NUIT: ${emp.nuit}`, emp.local, [emp.tel1, emp.tel2].filter(Boolean).join(" · ")].filter(Boolean).join(" · ")}</div>
      <hr style="border:none;border-top:2px solid #1F4E79;margin:6px 0 10px" />
      <h3 style="margin:0 0 4px">Extrato de dívida — ${escH(d.codigo)}</h3>
      <p style="font-size:9pt;color:#555">Emitido em ${agora.toISOString().slice(0, 10).split("-").reverse().join("/")} às ${agora.toISOString().slice(11, 16)} por ${escH(usuarioNome)}</p>
      <table style="border-collapse:collapse;width:100%;font-size:10pt;margin-bottom:10px">
        <tr><td style="padding:4px 0;color:#555;width:110px">Cliente</td><td><b>${escH(d.clienteNome)}</b>${d.clienteTel ? ` · 📞 ${escH(d.clienteTel)}` : ""}</td></tr>
        <tr><td style="padding:4px 0;color:#555">Dívida</td><td>${escH(d.codigo)} de ${d.dataDia.split("-").reverse().join("/")}${d.obs ? ` · ${escH(d.obs)}` : ""}</td></tr>
        <tr><td style="padding:4px 0;color:#555">Estado</td><td>${d.status === "Liquidada" ? `✅ LIQUIDADA${d.liquidadaEm ? ` em ${dataBR(d.liquidadaEm)}` : ""}` : `⏳ EM ABERTO${d.diasEmAberto > 0 ? ` há ${d.diasEmAberto} dia${d.diasEmAberto > 1 ? "s" : ""}` : ""}`}</td></tr>
      </table>
      <table style="border-collapse:collapse;width:100%;font-size:10pt;margin-bottom:10px">
        <tr style="background:#eef3f8">
          <td style="padding:6px;border:1px solid #999;text-align:center">Total da dívida<br><b>${mt(d.valorTotal)}</b></td>
          <td style="padding:6px;border:1px solid #999;text-align:center">Já pago<br><b style="color:#1a7a3c">${mt(d.pago)}</b></td>
          <td style="padding:6px;border:1px solid #999;text-align:center">Saldo em dívida<br><b style="color:${d.status === "Aberta" ? "#b3261e" : "#1a7a3c"};font-size:12pt">${d.status === "Aberta" ? mt(d.saldo) : "✅ 0,00 MZN"}</b></td>
        </tr>
      </table>
      <p style="font-size:10pt;margin:10px 0 4px"><b>Pagamentos registados</b></p>
      <table style="border-collapse:collapse;width:100%;font-size:9.5pt">
        <tr style="background:#1F4E79;color:#fff">
          <th style="padding:5px;border:1px solid #999;text-align:left">Data e hora</th>
          <th style="padding:5px;border:1px solid #999">Valor</th>
          <th style="padding:5px;border:1px solid #999;text-align:left">Método</th>
          <th style="padding:5px;border:1px solid #999;text-align:left">Recebido por</th>
        </tr>${linPag}
      </table>
      ${outras.length ? `
        <p style="font-size:10pt;margin:12px 0 4px"><b>Outras dívidas em aberto do mesmo cliente</b></p>
        <table style="border-collapse:collapse;width:100%;font-size:9.5pt">
          <tr style="background:#1F4E79;color:#fff">
            <th style="padding:5px;border:1px solid #999;text-align:left">Código</th>
            <th style="padding:5px;border:1px solid #999">Data</th>
            <th style="padding:5px;border:1px solid #999">Total</th>
            <th style="padding:5px;border:1px solid #999">Pago</th>
            <th style="padding:5px;border:1px solid #999">Saldo</th>
          </tr>${linOutras}
        </table>
        <p style="font-size:9.5pt;margin-top:6px"><b>Total em dívida pelo cliente (esta + outras): ${mt(d.saldo + totalOutras)}</b></p>` : ""}
      <p style="font-size:8.5pt;color:#666;margin-top:14px">Documento de comprovativo de conta — ${escH(emp?.nome ?? "CAMI'S EVENTOS")}. Confere os pagamentos registados até à data de emissão.</p>`;
    return { titulo: `Extrato ${d.codigo} — ${d.clienteNome}`, body };
  };

  const imprimir = () => {
    const doc = gerarDoc();
    printDoc(doc.titulo, doc.body);
  };
  const baixar = async () => {
    setBaixando(true);
    try {
      const doc = gerarDoc();
      await downloadPdf(doc.titulo, doc.body, `${doc.titulo} — ${hoje()}.pdf`);
    } finally { setBaixando(false); }
  };

  return (
    <Modal onClose={onClose}>
      <h3>📄 Extrato — {d.codigo}</h3>
      <p className="c-sub">
        {d.clienteNome} · total {mt(d.valorTotal)} · pago {mt(d.pago)} ·{" "}
        <b style={{ color: d.status === "Aberta" ? "var(--vermelho-c)" : "var(--verde-c)" }}>
          {d.status === "Aberta" ? `saldo ${mt(d.saldo)}` : "✅ liquidada"}
        </b>
      </p>
      <p className="c-sub">
        O extrato A4 sai com o cabeçalho da empresa, os dados da dívida, <b>{(hist.data ?? []).length} pagamento(s)</b> registado(s)
        {outras.length > 0 && <> e mais <b>{outras.length} dívida(s) em aberto</b> do mesmo cliente (total {mt(d.saldo + totalOutras)})</>}.
      </p>
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button className="c-btn c-btn-prim grow" onClick={imprimir} disabled={hist.isLoading}>🖨️ Imprimir</button>
        <button className="c-btn c-btn-verde grow" onClick={() => void baixar()} disabled={baixando || hist.isLoading}>
          {baixando ? "A gerar…" : "⬇️ Baixar PDF (A4)"}
        </button>
      </div>
    </Modal>
  );
}

/* ---------- Registo manual de dívida ---------- */
function NovaDividaModal({ pendente, onClose, onCriar }: {
  pendente: boolean; onClose: () => void;
  onCriar: (nome: string, tel: string, valor: number, obs: string) => void;
}) {
  const [nome, setNome] = useState("");
  const [tel, setTel] = useState("");
  const [valor, setValor] = useState(0);
  const [obs, setObs] = useState("");
  const ok = nome.trim().length >= 2 && valor > 0;
  return (
    <Modal onClose={onClose}>
      <h3>＋ Registar Dívida Manualmente</h3>
      <p className="c-sub">Para dívidas antigas ou feitas fora do sistema de vendas. Fica visível até ser paga por completo.</p>
      <label className="c-label">Nome do cliente *</label>
      <input className="c-input" placeholder="Ex.: João Mucavele" value={nome} onChange={(e) => setNome(e.target.value)} autoFocus />
      <label className="c-label">Telefone (para cobrança por WhatsApp)</label>
      <input className="c-input" inputMode="tel" placeholder="Ex.: 84 123 4567" value={tel} onChange={(e) => setTel(e.target.value)} />
      <label className="c-label">Valor em dívida (MZN) *</label>
      <MoneyInput value={valor} onChange={(v) => setValor(Math.max(0, v))} />
      <label className="c-label">Nota (origem da dívida)</label>
      <input className="c-input" placeholder="Ex.: Festa de aniversário de 12/09" value={obs} onChange={(e) => setObs(e.target.value)} />
      <button className="c-btn c-btn-verde c-btn-bloco" style={{ marginTop: 14 }}
        disabled={pendente || !ok} onClick={() => onCriar(nome.trim(), tel.trim(), valor, obs.trim())}>
        {pendente ? "A registar…" : "✅ Registar Dívida"}
      </button>
    </Modal>
  );
}
