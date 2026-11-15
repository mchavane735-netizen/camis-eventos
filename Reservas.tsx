import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { useSession } from "@/lib/session";
import { mt, diaBR, hoje } from "@/lib/fmt";
import { Modal, Vazio } from "@/components/bits";
import TelInput from "@/components/TelInput";
import MoneyInput from "@/components/MoneyInput";
import { TIPOS_EVENTO_RESERVA, TAXA_RESERVA_PESSOA, taxaReservaPessoa, AREAS_ESTAR, ESPACOS_EVENTO, METODOS_PAGAMENTO, espacosEmConflito, precoEspacoSemDecoracao, braaiTaxaPessoa, braaiTotal, braaiRotulo, BRAAI_DURACAO_HORAS, type BraaiModalidade, type BraaiTraz } from "@contracts/types";
import { useEmpresa } from "@/lib/empresa";
import {
  printDoc, downloadPdf, gerarPdfBlob,
  reservaBodyHtml, reservaProvisoriaHtml, type ReservaDoc,
} from "@/lib/docprint";

import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../api/router";

export type Reserva = inferRouterOutputs<AppRouter>["reservas"]["list"][number];

export default function Reservas() {
  const { user, toast } = useSession();
  const utils = trpc.useUtils();
  const emp = useEmpresa();
  const reservas = trpc.reservas.list.useQuery({ usuarioId: user?.id ?? 0 }, { refetchInterval: 15000 });
  const produtos = trpc.produtos.list.useQuery();
  const [form, setForm] = useState(false);
  const [baixandoId, setBaixandoId] = useState<number | null>(null);
  const [provisoria, setProvisoria] = useState<Reserva | null>(null);
  const [checkin, setCheckin] = useState<Reserva | null>(null);

  const invalidar = () => { utils.reservas.list.invalidate(); utils.dashboard.stats.invalidate(); };
  const setStatus = trpc.reservas.setStatus.useMutation({
    onSuccess: invalidar, onError: (e) => toast("⚠️ " + e.message),
  });
  const criarPedido = trpc.pedidos.criar.useMutation({
    onSuccess: (p) => {
      utils.pedidos.abertos.invalidate(); utils.reservas.list.invalidate();
      toast(`Pedido nº ${p.numero} aberto para a reserva`);
    },
    onError: (e) => toast("⚠️ " + e.message),
  });
  const [saldoRes, setSaldoRes] = useState<Reserva | null>(null);
  const pagarSaldo = trpc.reservas.pagarSaldo.useMutation({
    onSuccess: (r) => {
      toast(r.saldoRestante > 0 ? `💰 Recebido. Faltam ${mt(r.saldoRestante)}.` : "✅ Reserva liquidada! Já pode abrir o pedido.");
      setSaldoRes(null); invalidar();
    },
    onError: (e) => toast("⚠️ " + e.message),
  });
  const reabrir = trpc.reservas.reabrirReserva.useMutation({
    onSuccess: () => { toast("↩️ Reserva reaberta — voltou a «Confirmada». Já pode abrir/editar o pedido."); invalidar(); },
    onError: (e) => toast("⚠️ " + e.message),
  });
  const abrirBuffet = trpc.reservas.abrirPedidoBuffet.useMutation({
    onSuccess: (r) => {
      utils.pedidos.abertos.invalidate(); utils.reservas.list.invalidate();
      toast(`🍽 Pedido nº ${r.numero} aberto — cobre o REMANESCENTE (${mt(r.saldo)}). Acrescente bebidas e outros produtos até ao fecho.`);
    },
    onError: (e) => toast("⚠️ " + e.message),
  });
  const eliminar = trpc.reservas.eliminar.useMutation({
    onSuccess: () => { toast("🗑 Reserva eliminada"); invalidar(); },
    onError: (e) => toast("⚠️ " + e.message),
  });
  const isAdmin = user?.perfil === "Admin";

  const saloes = (produtos.data ?? []).filter((p) => p.categoria === "Salão");
  const chip = (st: string) =>
    st === "Confirmada" ? "c-chip-verde" : st === "Pendente" ? "c-chip-amarelo" : st === "Cancelada" ? "c-chip-vermelho" : "c-chip-cinza";

  const docDe = (r: Reserva): ReservaDoc => ({
    codigo: r.codigo, cliente: r.cliente, contacto: r.contacto,
    dataConsumo: r.dataConsumo, hora: r.hora, tipo: r.tipo, tipoOutro: r.tipoOutro,
    area: r.area, espaco: (r as { espaco?: string | null }).espaco ?? null,
    semDecoracao: !r.pacoteNome && !!(r as { espaco?: string | null }).espaco,
    pessoas: r.pessoas, taxaReserva: r.pessoas > 0 ? Math.round((r.valor / r.pessoas) * 100) / 100 : TAXA_RESERVA_PESSOA, pacoteNome: r.pacoteNome,
    condicoes: r.condicoes, valor: r.valor, desconto: r.desconto ?? 0, adiantPct: r.adiantPct,
    braai: r.braai, braaiModalidade: r.braaiModalidade as "A" | "B" | null,
    braaiTraz: r.braaiTraz as "Comida" | "Bebidas" | null, criancasMenores: r.criancasMenores,
  });

  return (
    <div>
      <div className="c-titulo">📅 Reservas — Salão & Eventos</div>
      <button className="c-btn c-btn-prim c-btn-bloco" style={{ marginBottom: 12 }} onClick={() => setForm(true)}>
        ＋ Nova Reserva
      </button>

      {reservas.isLoading && <Vazio icon="⏳">A carregar…</Vazio>}
      {reservas.data?.length === 0 && <Vazio icon="📅">Sem reservas registadas.</Vazio>}

      {reservas.data?.map((r) => (
        <div className="c-card" key={r.id}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
            <div>
              <b style={{ fontSize: 15 }}>{r.cliente}</b><br />
              <span className="c-sub">{r.codigo} · {r.contacto || "sem contacto"}</span>
            </div>
            <span className={`c-chip ${chip(r.status)}`}>{r.status}</span>
          </div>
          <div style={{ fontSize: 12.5, margin: "8px 0" }}>
            🗓 {diaBR(r.dataConsumo)} {r.hora || ""} · {r.braai ? <>🔥 <b>Braai</b> — {r.tipoOutro}</> : r.tipo === "Buffet" ? <>🍽 <b>Reserva Buffet</b> — {r.pacoteNome}</> : <>🎉 {r.tipo}{r.tipoOutro ? ` — ${r.tipoOutro}` : ""}</>} · {r.pessoas} pessoas{r.braai ? " pagantes (10+ anos)" : ""}{r.area ? <> · 🪑 <b>{r.area}</b></> : null}<br />
            {r.braai && (
              <>
                ⏱ Entrada às <b>{r.hora ?? "—"}</b> · direito a {BRAAI_DURACAO_HORAS} horas{r.criancasMenores ? <> · 🧒 {r.criancasMenores} criança{r.criancasMenores > 1 ? "s" : ""} até 9 anos (grátis)</> : null}<br />
                💳 Taxa <b>não consumível</b> · piscina e parque infantil pagos à parte<br />
                {r.checkinEm
                  ? <span className="c-chip c-chip-verde">✅ Check-in feito{r.checkinPor ? ` por ${r.checkinPor}` : ""}</span>
                  : r.status === "Confirmada"
                    ? <span className="c-chip c-chip-amarelo">⏳ Check-in pendente — saldo na entrada</span>
                    : null}
                {r.checkinObs && <><br />📋 {r.checkinObs}</>}
                <br />
              </>
            )}
            {(r as { espaco?: string | null }).espaco
              ? <>🏛 Espaço: <b>{(r as { espaco?: string | null }).espaco}</b>{r.pacoteNome ? "" : " (sem decoração)"}<br /></> : null}
            {r.braai
              ? <>🔥 Taxa de braai: {r.pessoas} × {mt(r.pessoas > 0 ? r.valor / r.pessoas : 0)} <span className="c-sub">(não consumível)</span><br /></>
              : r.pacoteNome
              ? <>💐 Pacote: <b>{r.pacoteNome}</b> (adiantamento {r.adiantPct}% do pacote)<br /></>
              : <>🎟 Taxa de reserva: {r.pessoas} × {mt(r.pessoas > 0 ? r.valor / r.pessoas : 0)}{r.area === "Salão primeiro andar" ? " (Salão 1.º andar)" : ""} <span className="c-sub">(consumível no local · garantia)</span><br /></>}
            💰 Total: <b>{mt(r.valor)}</b>{(r.desconto ?? 0) > 0 && <span className="c-sub"> (desconto de {mt(r.desconto)})</span>} · Adiant. {r.adiantPct}%: <b style={{ color: "var(--verde-c)" }}>{mt(r.adiant)}</b> · Remanescente: <b style={{ color: r.saldo > 0 ? "var(--vermelho-c)" : "var(--verde-c)" }}>{mt(r.saldo)}</b>{r.braai && r.saldo > 0 && <span className="c-sub"> (na entrada)</span>}
            {r.tipo === "Buffet" && r.adiantPct < 100 && r.saldo > 0 && (
              <><br /><span style={{ color: "#8a6d00", fontWeight: 700 }}>⏰ Remanescente até 48 horas antes do evento — sob pena de não abertura da mesa.</span></>
            )}
            {r.condicoes && <><br />📌 {r.condicoes}</>}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {r.status === "Pendente" && (
              <button className="c-btn c-btn-verde c-btn-peq" onClick={() => setStatus.mutate({ id: r.id, status: "Confirmada" })}>
                ✔ Confirmar pagamento
              </button>
            )}
            {r.braai && r.status === "Confirmada" && !r.checkinEm && (
              <button className="c-btn c-btn-prim c-btn-peq"
                title={r.dataConsumo > hoje() ? `O evento é ${diaBR(r.dataConsumo)} — se o cliente chegou mais cedo, o check-in abre na mesma e a data passa a hoje` : "Confirmar o que o cliente trouxe e cobrar o saldo na entrada"}
                onClick={() => {
                  if (r.dataConsumo > hoje() && !window.confirm(`⏩ Este braai está marcado para ${diaBR(r.dataConsumo)}.\n\nO cliente chegou mais cedo? O check-in será feito agora e a data do consumo passa a ser HOJE.`)) return;
                  setCheckin(r);
                }}>
                🔥 {r.dataConsumo > hoje() ? `Check-in antecipado (era ${diaBR(r.dataConsumo)})` : "Check-in de entrada"}
              </button>
            )}
            {["Pendente", "Confirmada"].includes(r.status) && !r.pedidoId && r.tipo === "Buffet" && (
              <button className="c-btn c-btn-prim c-btn-peq" disabled={abrirBuffet.isPending}
                title={r.dataConsumo > hoje() ? `O evento é ${diaBR(r.dataConsumo)} — se o cliente chegou mais cedo, o pedido abre na mesma e a data passa a hoje` : "Abre o pedido do buffet para levantar os pratos e acrescentar outros produtos da casa"}
                onClick={() => {
                  if (!user) return;
                  if (r.dataConsumo > hoje() && !window.confirm(`⏩ Este buffet está marcado para ${diaBR(r.dataConsumo)}.\n\nO cliente chegou mais cedo? O pedido será aberto agora e a data do consumo passa a ser HOJE.`)) return;
                  abrirBuffet.mutate({ usuarioId: user.id, reservaId: r.id });
                }}>
                🍽 {abrirBuffet.isPending ? "A abrir…" : r.dataConsumo > hoje() ? `Abrir antecipado (era ${diaBR(r.dataConsumo)})` : "Abrir pedido do buffet"}
              </button>
            )}
            {["Pendente", "Confirmada"].includes(r.status) && !r.pedidoId && r.tipo !== "Buffet" && (
              <button className="c-btn c-btn-linha c-btn-peq"
                onClick={() => user && criarPedido.mutate({ usuarioId: user.id, reservaId: r.id, referencia: `Reserva ${r.codigo} — ${r.cliente}`, area: r.area || undefined })}>
                🧾 Abrir Pedido
              </button>
            )}
            {["Pendente", "Confirmada"].includes(r.status) && r.saldo > 0 && !r.braai && (
              <button className="c-btn c-btn-verde c-btn-peq"
                title="Regista o valor em falta (total ou parcial) — o valor entra como receita no Financeiro"
                onClick={() => setSaldoRes(r)}>
                💰 Cobrar saldo ({mt(r.saldo)})
              </button>
            )}
            <button className="c-btn c-btn-linha c-btn-peq" onClick={() => setProvisoria(r)}>
              📄 Factura Provisória
            </button>
            <button className="c-btn c-btn-linha c-btn-peq"
              onClick={() => printDoc(`Reserva ${r.codigo}`, reservaBodyHtml(docDe(r), emp))}>
              🖨 Imprimir
            </button>
            <button className="c-btn c-btn-linha c-btn-peq" disabled={baixandoId === r.id}
              onClick={async () => {
                setBaixandoId(r.id);
                try { await downloadPdf(`Reserva ${r.codigo}`, reservaBodyHtml(docDe(r), emp), `Reserva-${r.codigo}.pdf`); }
                finally { setBaixandoId(null); }
              }}>
              {baixandoId === r.id ? "…" : "⬇️ Baixar"}
            </button>
            {r.status === "Concluída" && user && (user.perfil === "Admin" || user.podeReabrirReserva) && (
              <button className="c-btn c-btn-cinza c-btn-peq" disabled={reabrir.isPending}
                title="A reserva volta ao estado «Confirmada» para poder abrir/editar o pedido (uso autorizado pelo Admin)"
                onClick={() => {
                  if (window.confirm(`↩️ Reabrir a reserva ${r.codigo} — ${r.cliente}?\n\nEla volta ao estado «Confirmada» e pode voltar a abrir/editar o pedido.`))
                    reabrir.mutate({ usuarioId: user.id, id: r.id });
                }}>
                {reabrir.isPending ? "…" : "↩️ Reabrir reserva"}
              </button>
            )}
            {["Pendente", "Confirmada"].includes(r.status) && (
              <>
                <button className="c-btn c-btn-cinza c-btn-peq" onClick={() => setStatus.mutate({ id: r.id, status: "Concluída" })}>🏁 Concluir</button>
                <button className="c-btn c-btn-perigo c-btn-peq" onClick={() => setStatus.mutate({ id: r.id, status: "Cancelada" })}>✕ Cancelar</button>
              </>
            )}
            {isAdmin && !r.pedidoId && (
              <button className="c-btn c-btn-perigo c-btn-peq" title="Eliminar definitivamente (Admin)"
                onClick={() => { if (confirm(`ELIMINAR DEFINITIVAMENTE a reserva ${r.codigo}? (limpeza de testes)`)) user && eliminar.mutate({ usuarioId: user.id, id: r.id }); }}>
                🗑
              </button>
            )}
          </div>
        </div>
      ))}

      {form && <FormReserva saloes={saloes} onClose={() => setForm(false)} onSaved={() => { setForm(false); invalidar(); }} />}
      {provisoria && <ProvisoriaModal r={provisoria} onClose={() => setProvisoria(null)} />}
      {checkin && <CheckinBraaiModal r={checkin} onClose={() => setCheckin(null)} onSaved={() => { setCheckin(null); invalidar(); }} />}
      {saldoRes && <CobrarSaldoModal r={saldoRes} pendente={pagarSaldo.isPending} onClose={() => setSaldoRes(null)}
        onSave={(valor, metodo) => user && pagarSaldo.mutate({ usuarioId: user.id, id: saldoRes.id, valor, metodo })} />}
    </div>
  );
}

/* ============ CHECK-IN DE BRAAI (na entrada, antes de ocupar o espaço) ============ */
export function CheckinBraaiModal({ r, onClose, onSaved }: { r: Reserva; onClose: () => void; onSaved: () => void }) {
  const { user, toast } = useSession();
  const [trouxe, setTrouxe] = useState<"tudo" | "comida" | "bebidas">(
    r.braaiModalidade === "A" ? "tudo" : r.braaiTraz === "Comida" ? "comida" : "bebidas");
  const [pessoas, setPessoas] = useState(r.pessoas || 1);
  const [criancas, setCriancas] = useState(r.criancasMenores || 0);
  const [metodo, setMetodo] = useState("Dinheiro");

  const modReal: BraaiModalidade = trouxe === "tudo" ? "A" : "B";
  const valorBase = braaiTotal(modReal, pessoas);
  const valorNovo = Math.max(0, Math.round((valorBase - (r.desconto ?? 0)) * 100) / 100); // mantém o desconto combinado
  const saldoDevido = Math.max(0, Math.round((valorNovo - r.adiant) * 100) / 100);
  const [valorPago, setValorPago] = useState<number | null>(saldoDevido);
  const pago = valorPago ?? 0;
  const mudou = modReal !== r.braaiModalidade || pessoas !== r.pessoas;

  const mut = trpc.reservas.checkinBraai.useMutation({
    onSuccess: (x) => { toast(x.mudou ? `✅ Check-in feito — taxa ajustada para ${mt(x.valorNovo)}` : "✅ Check-in feito. Bom braai!"); onSaved(); },
    onError: (e) => toast("⚠️ " + e.message),
  });

  return (
    <Modal onClose={onClose}>
      <h3>🔥 Check-in de Braai — {r.codigo}</h3>
      <p className="c-sub">{r.cliente} · reservado: {r.tipoOutro} · {r.pessoas} pagantes · adiantamento já pago: <b>{mt(r.adiant)}</b></p>

      <label className="c-label">O que o cliente trouxe DE FACTO? *</label>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {([
          ["tudo", "🥩🥤 Comida e bebidas (Braai Completo)"],
          ["comida", "🥩 Só comida — as bebidas compra na casa (Braai Parcial)"],
          ["bebidas", "🥤 Só bebidas — a comida compra na casa (Braai Parcial)"],
        ] as const).map(([id, rot]) => (
          <button key={id} type="button"
            className={`c-btn ${trouxe === id ? "c-btn-prim" : "c-btn-cinza"}`}
            style={{ justifyContent: "flex-start", textAlign: "left" }}
            onClick={() => setTrouxe(id)}>{rot}</button>
        ))}
      </div>
      {mudou && (
        <p style={{ fontSize: 12.5, background: "#fdeaea", borderRadius: 8, padding: "6px 10px", color: "#b3261e" }}>
          ⚠️ Diferente do declarado ({r.tipoOutro}) — a taxa é recalculada: <b>{braaiRotulo(modReal, trouxe === "comida" ? "Comida" : trouxe === "bebidas" ? "Bebidas" : null)}</b>, {pessoas} pagantes × {mt(braaiTaxaPessoa(modReal, pessoas))}.
        </p>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 8 }}>
        <div>
          <label className="c-label">Pessoas pagantes (10+ anos)</label>
          <input className="c-input" type="number" min={1} value={pessoas} onChange={(e) => setPessoas(+e.target.value || 1)} />
        </div>
        <div>
          <label className="c-label">Crianças até 9 anos (grátis)</label>
          <input className="c-input" type="number" min={0} value={criancas} onChange={(e) => setCriancas(+e.target.value || 0)} />
        </div>
      </div>

      <div className="c-card" style={{ background: "var(--lilas)", marginTop: 10 }}>
        <div className="c-total-linha"><span>Taxa de braai (recalculada)</span><b>{mt(valorBase)}</b></div>
        {(r.desconto ?? 0) > 0 && (
          <div className="c-total-linha"><span>🏷️ Desconto combinado</span><b style={{ color: "var(--verde-c)" }}>− {mt(r.desconto ?? 0)}</b></div>
        )}
        <div className="c-total-linha"><span>Já pago (adiantamento)</span><b style={{ color: "var(--verde-c)" }}>{mt(r.adiant)}</b></div>
        <div className="c-total-linha"><span>Saldo a cobrar AGORA</span><b style={{ color: saldoDevido > 0 ? "var(--vermelho-c)" : "var(--verde-c)" }}>{mt(saldoDevido)}</b></div>
      </div>

      {saldoDevido > 0 && (
        <>
          <label className="c-label" style={{ marginTop: 8 }}>💵 Valor recebido agora (MZN)</label>
          <div style={{ width: 180 }}><MoneyInput value={valorPago ?? 0} onChange={setValorPago} /></div>
          <label className="c-label" style={{ marginTop: 8 }}>Método de pagamento</label>
          <select className="c-select" value={metodo} onChange={(e) => setMetodo(e.target.value)}>
            {["Dinheiro", "Transferência eMola", "Levantamento eMola", "M-Pesa", "FNB"].map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          {pago < saldoDevido - 0.01 && (
            <p style={{ fontSize: 12.5, color: "#b3261e" }}>⚠️ Faltam {mt(saldoDevido - pago)} — o saldo é pago na entrada, antes de ocupar o espaço.</p>
          )}
        </>
      )}

      <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
        <button className="c-btn c-btn-cinza" style={{ flex: 1 }} onClick={onClose}>Cancelar</button>
        <button className="c-btn c-btn-verde" style={{ flex: 1.6 }} disabled={mut.isPending || pago < saldoDevido - 0.01}
          onClick={() => user && mut.mutate({
            usuarioId: user.id, id: r.id, trouxe,
            pessoasPagantes: pessoas, criancasMenores: criancas,
            valorPago: Math.min(pago, saldoDevido), metodo,
          })}>
          {mut.isPending ? "A registar…" : saldoDevido > 0 ? `✅ Cobrar ${mt(saldoDevido)} e fazer check-in` : "✅ Fazer check-in"}
        </button>
      </div>
    </Modal>
  );
}

/* ============ FACTURA PROVISÓRIA (valor pago + remanescente, WhatsApp) ============ */
function ProvisoriaModal({ r, onClose }: { r: Reserva; onClose: () => void }) {
  const emp = useEmpresa();
  const { toast } = useSession();
  const [baixando, setBaixando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [whatsAberto, setWhatsAberto] = useState(false);
  const [whatsTel, setWhatsTel] = useState((r.contacto ?? "").replace(/\D/g, "").replace(/^258/, ""));
  const [passo, setPasso] = useState<"" | "pdf">("");

  const doc: ReservaDoc & { pago: boolean } = {
    codigo: r.codigo, cliente: r.cliente, contacto: r.contacto,
    dataConsumo: r.dataConsumo, hora: r.hora, tipo: r.tipo, tipoOutro: r.tipoOutro,
    area: r.area, espaco: (r as { espaco?: string | null }).espaco ?? null,
    semDecoracao: !r.pacoteNome && !!(r as { espaco?: string | null }).espaco,
    pessoas: r.pessoas, taxaReserva: r.pessoas > 0 ? Math.round((r.valor / r.pessoas) * 100) / 100 : TAXA_RESERVA_PESSOA, pacoteNome: r.pacoteNome,
    condicoes: r.condicoes, valor: r.valor, desconto: r.desconto ?? 0, adiantPct: r.adiantPct,
    braai: r.braai, braaiModalidade: r.braaiModalidade as "A" | "B" | null,
    braaiTraz: r.braaiTraz as "Comida" | "Bebidas" | null, criancasMenores: r.criancasMenores,
    pago: r.status !== "Pendente",
  };
  const titulo = `Factura Provisória ${r.codigo}`;
  const ficheiro = `Factura-Provisoria-${r.codigo}.pdf`;
  const body = reservaProvisoriaHtml(doc, emp);

  const enviarWhats = async () => {
    const tel = whatsTel.replace(/\D/g, "");
    if (tel.length < 9) { toast("⚠️ Indique o WhatsApp do cliente (9 dígitos)."); return; }
    setEnviando(true);
    try {
      const blob = await gerarPdfBlob(body);
      const file = new File([blob], ficheiro, { type: "application/pdf" });
      if (typeof navigator !== "undefined" && "canShare" in navigator && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: titulo, text: `${emp.nome} — ${titulo}` });
        setWhatsAberto(false);
        return;
      }
      await downloadPdf(titulo, body, ficheiro);
      setPasso("pdf");
      window.open(`https://wa.me/258${tel}?text=${encodeURIComponent(
        `${emp.nome} — ${titulo}. Segue em anexo o documento em PDF. 📎`,
      )}`, "_blank");
    } catch {
      /* partilha cancelada */
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Modal onClose={onClose}>
      <h3>📄 {titulo}</h3>
      <p className="c-sub">Valor pago e remanescente — pronta a imprimir, baixar ou enviar por WhatsApp.</p>
      <style>{`.docp { background:#fffdf5; border:2px dashed #d9c98a; border-radius:12px; padding:12px; }`}</style>
      <div className="docp" dangerouslySetInnerHTML={{ __html: body }} />
      <button className="c-btn c-btn-verde c-btn-bloco" style={{ marginTop: 10 }}
        onClick={() => setWhatsAberto(!whatsAberto)}>
        {whatsAberto ? "▲ Fechar envio por WhatsApp" : "📲 Enviar por WhatsApp ao cliente"}
      </button>
      {whatsAberto && (
        <div className="c-card" style={{ background: "#eef7ee", marginTop: 8, padding: 10 }}>
          <label className="c-label" style={{ marginTop: 0 }}>WhatsApp do cliente (9 dígitos)</label>
          <div style={{ display: "flex", gap: 8 }}>
            <input className="c-input" inputMode="numeric" placeholder="Ex.: 84 123 4567"
              value={whatsTel} onChange={(e) => setWhatsTel(e.target.value)} />
            <button className="c-btn c-btn-verde" style={{ whiteSpace: "nowrap" }}
              disabled={enviando || whatsTel.replace(/\D/g, "").length < 9}
              onClick={enviarWhats}>
              {enviando ? "A preparar…" : "Enviar ➤"}
            </button>
          </div>
          <p className="c-sub" style={{ marginTop: 6 }}>
            📎 O documento vai em <b>PDF</b>: no telemóvel abre a partilha directa com o ficheiro anexado;
            no computador o PDF é baixado e o WhatsApp abre — anexe o ficheiro <b>{ficheiro}</b> na conversa.
          </p>
          {passo === "pdf" && (
            <p className="c-sub" style={{ marginTop: 4, fontWeight: 700, color: "var(--verde-c)" }}>
              ✅ PDF baixado! No WhatsApp que abriu, toque no clipe 📎 e anexe <b>{ficheiro}</b>.
            </p>
          )}
        </div>
      )}
      <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
        <button className="c-btn c-btn-cinza" style={{ flex: 1 }} onClick={onClose}>Fechar</button>
        <button className="c-btn c-btn-linha" style={{ flex: 1.4 }} disabled={baixando}
          onClick={async () => {
            setBaixando(true);
            try { await downloadPdf(titulo, body, ficheiro); } finally { setBaixando(false); }
          }}>
          {baixando ? "A gerar…" : "⬇️ Baixar PDF"}
        </button>
        <button className="c-btn c-btn-prim" style={{ flex: 1.4 }} onClick={() => printDoc(titulo, body)}>
          🖨 Imprimir
        </button>
      </div>
    </Modal>
  );
}

/* ============ NOVA RESERVA ============ */
function FormReserva({ saloes, onClose, onSaved }: {
  saloes: Array<{ id: number; nome: string; preco: number }>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { user, toast } = useSession();
  const emp = useEmpresa();
  const [f, setF] = useState({
    cliente: "", contacto: "", dataConsumo: "", hora: "", dataEntrada: hoje(),
    tipoEvento: "", tipoOutro: "", pessoas: 25, pacoteId: 0, condicoes: "", area: "", afiliadoCodigo: "",
    espaco: "", modoSalao: "sem" as "sem" | "pacote", // aluguer do espaço: sem decoração × com pacote
    braai: false, braaiModalidade: "A" as BraaiModalidade, braaiTraz: "Comida" as BraaiTraz, criancasMenores: 0,
  });
  const [deposito, setDeposito] = useState<number | null>(null); // null = 50% (recomendado)
  const [desconto, setDesconto] = useState(0); // desconto combinado (MZN) — deduzido do valor total
  const [baixando, setBaixando] = useState(false);
  const create = trpc.reservas.create.useMutation({
    onSuccess: (r) => { toast("Reserva " + r.codigo + " criada!"); onSaved(); },
    onError: (e) => toast("⚠️ " + e.message),
  });
  const set = (k: string, v: unknown) => setF((p) => ({ ...p, [k]: v }));
  const ocupadasQ = trpc.reservas.datasOcupadas.useQuery();
  const ocupadas = ocupadasQ.data ?? [];
  const [verCal, setVerCal] = useState(false);

  const querSalao = !!f.espaco;
  const pacote = querSalao && f.modoSalao === "pacote" && f.pacoteId
    ? saloes.find((s) => s.id === f.pacoteId) : undefined;
  const choque = querSalao && f.dataConsumo
    ? ocupadas.find((o) => o.dataConsumo === f.dataConsumo && espacosEmConflito((o as { espaco?: string | null }).espaco, f.espaco))
    : undefined;

  // Cálculo: com pacote → preço do pacote (inclui decoração);
  // sem decoração → preço base do espaço (Configurações);
  // reserva simples → nº de pessoas × taxa fixa.
  // Depósito flexível: o cliente diz quanto consegue pagar agora (recomendado: 50% — consumível no local)
  const valorBase = f.braai ? braaiTotal(f.braaiModalidade, f.pessoas)
    : pacote ? Math.round(pacote.preco * 100) / 100
    : querSalao ? precoEspacoSemDecoracao(emp as unknown as Record<string, string>, f.espaco)
    : Math.round(f.pessoas * taxaReservaPessoa(f.area) * 100) / 100;
  const descontoVal = Math.min(valorBase, Math.max(0, Math.round(desconto * 100) / 100));
  const valor = Math.round((valorBase - descontoVal) * 100) / 100; // valor líquido após desconto
  const adiant = deposito != null
    ? Math.max(0, Math.round(deposito * 100) / 100)
    : Math.round(valor * 0.5 * 100) / 100;
  // adiantamento ACIMA do total: o total passa a ser o valor real pago (comprovativo com o que o cliente entregou)
  const valorFinal = Math.max(valor, adiant);
  const pct = valorFinal > 0 ? Math.min(100, Math.round((adiant / valorFinal) * 100)) : 0;

  const docAtual = (): ReservaDoc => ({
    cliente: f.cliente || "—", contacto: f.contacto || null,
    dataConsumo: f.dataConsumo || hoje(), hora: f.hora || null,
    tipo: f.braai ? "Braai" : f.tipoEvento || "—",
    tipoOutro: f.braai ? braaiRotulo(f.braaiModalidade, f.braaiModalidade === "B" ? f.braaiTraz : null)
      : f.tipoEvento === "Outro" ? f.tipoOutro || null : null,
    pessoas: f.pessoas, taxaReserva: taxaReservaPessoa(f.area),
    pacoteNome: !f.braai && pacote ? pacote.nome.replace(/^Aluguer Sal[aã]o\s*-\s*/i, "") : null,
    espaco: f.braai ? null : f.espaco || null, semDecoracao: !f.braai && querSalao && !pacote,
    condicoes: f.condicoes || null, valor: valorFinal, desconto: descontoVal, adiantPct: pct,
    braai: f.braai, braaiModalidade: f.braai ? f.braaiModalidade : null,
    braaiTraz: f.braai && f.braaiModalidade === "B" ? f.braaiTraz : null,
    criancasMenores: f.braai ? f.criancasMenores : 0,
  });

  const valido = () => {
    if (!f.cliente || !f.dataConsumo) { toast("⚠️ Preencha o cliente e a data do evento."); return false; }
    if (adiant <= 0) { toast("⚠️ Indique o valor do depósito (recomendado: 50% = " + mt(valor * 0.5) + ")."); return false; }
    if (f.braai) {
      if (!f.hora) { toast("⚠️ Indique a hora de entrada — a taxa de braai dá direito a 5 horas."); return false; }
      if (f.pessoas < 1) { toast("⚠️ Indique o número de pessoas pagantes (a partir dos 10 anos)."); return false; }
      if (adiant < valor * 0.5 - 0.01) { toast("⚠️ A taxa de braai exige adiantamento mínimo de 50% (" + mt(valor * 0.5) + ")."); return false; }
      if (!f.area) { toast("⚠️ Seleccione o espaço onde o grupo vai ficar."); return false; }
      return true;
    }
    if (!f.tipoEvento) { toast("⚠️ Seleccione o tipo de evento."); return false; }
    if (!f.area) { toast("⚠️ Seleccione o espaço onde o cliente pretende sentar."); return false; }
    if (f.tipoEvento === "Outro" && !f.tipoOutro.trim()) { toast("⚠️ Especifique o tipo de evento."); return false; }
    if (!querSalao && f.pessoas < 1) { toast("⚠️ Indique o número de pessoas/participantes."); return false; }
    if (querSalao && f.modoSalao === "pacote" && !pacote) { toast("⚠️ Escolha o pacote de salão (com decoração) ou mude para «Sem decoração»."); return false; }
    if (choque) { toast("⚠️ Esse espaço já está reservado nessa data."); return false; }
    return true;
  };

  return (
    <Modal onClose={onClose}>
      <h3>＋ Nova Reserva</h3>
      <p className="c-sub">Reserva simples: nº de pessoas × taxa de {mt(TAXA_RESERVA_PESSOA)} por pessoa (<b>{mt(500)} no Salão primeiro andar</b>). Aluguer de espaço: escolha o salão/espaço (bloqueia só esse espaço na data) — sem decoração usa o preço base, com decoração usa o pacote. <b>🔥 Braai</b>: o cliente traz os seus produtos e paga a taxa de uso do espaço (não consumível). O depósito é flexível — o recomendado é 50%.</p>

      <label className="c-label">Nome do Cliente *</label>
      <input className="c-input" placeholder="Nome completo" value={f.cliente} onChange={(e) => set("cliente", e.target.value)} />
      <label className="c-label">Contacto (WhatsApp)</label>
      <TelInput value={f.contacto} onChange={(v) => set("contacto", v)} />

      {/* ---------- BRAAI: o cliente traz os seus produtos ---------- */}
      <button type="button" className={`c-btn c-btn-bloco ${f.braai ? "c-btn-prim" : "c-btn-cinza"}`} style={{ marginTop: 10 }}
        onClick={() => setF((p) => ({ ...p, braai: !p.braai, espaco: "", pacoteId: 0, tipoEvento: "" }))}>
        {f.braai ? "🔥 Braai SELECCIONADO (cliente traz os seus produtos)" : "🔥 É um Braai? (cliente traz comida/bebidas)"}
      </button>
      {f.braai && (
        <div className="c-card" style={{ background: "#fff7ed", border: "1px solid #fdba74", marginTop: 6, padding: 10 }}>
          <label className="c-label" style={{ marginTop: 0 }}>Modalidade do braai *</label>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <button type="button" className={`c-btn ${f.braaiModalidade === "A" ? "c-btn-prim" : "c-btn-linha"}`}
              style={{ justifyContent: "flex-start", textAlign: "left", whiteSpace: "normal", height: "auto", padding: "8px 10px" }}
              onClick={() => set("braaiModalidade", "A")}>
              🥩🥤 <b>Braai Completo</b> — traz comida E bebidas<br />
              <small>até 9 pessoas: 500 MZN/p · 10+ pessoas: 400 MZN/p</small>
            </button>
            <button type="button" className={`c-btn ${f.braaiModalidade === "B" ? "c-btn-prim" : "c-btn-linha"}`}
              style={{ justifyContent: "flex-start", textAlign: "left", whiteSpace: "normal", height: "auto", padding: "8px 10px" }}
              onClick={() => set("braaiModalidade", "B")}>
              🥩 <b>Braai Parcial</b> — traz SÓ comida OU SÓ bebidas (o resto compra na casa)<br />
              <small>até 9 pessoas: 300 MZN/p · 10+ pessoas: 250 MZN/p</small>
            </button>
          </div>
          {f.braaiModalidade === "B" && (
            <>
              <label className="c-label" style={{ marginTop: 8 }}>O que o cliente traz? *</label>
              <div style={{ display: "flex", gap: 6 }}>
                {(["Comida", "Bebidas"] as const).map((t) => (
                  <button key={t} type="button" className={`c-btn c-btn-peq ${f.braaiTraz === t ? "c-btn-prim" : "c-btn-cinza"}`} style={{ flex: 1 }}
                    onClick={() => set("braaiTraz", t)}>{t === "Comida" ? "🥩 Só comida" : "🥤 Só bebidas"}</button>
                ))}
              </div>
            </>
          )}
          <p className="c-sub" style={{ marginTop: 8 }}>
            ℹ️ Taxa <b>não consumível</b> — cobre espaço, mesas, cadeiras e água. <b>NÃO inclui</b> utensílios, ingredientes nem carvão — o cliente pode trazer o seu fogão/grelhador.
            A assadura é sempre <b>fora</b>, no espaço indicado pela equipa. Bebidas trazidas: <b>máx. 3 por pessoa</b> e só as que a casa não vende/não tem em stock; whisky ou vinho: <b>1 garrafa por cada 10 pessoas</b>.
            Dá direito a <b>{BRAAI_DURACAO_HORAS} horas</b> a partir da hora de entrada. Crianças até 9 anos <b>não pagam</b>.
            Piscina e parque infantil são pagos à parte. Adiantamento mínimo 50% — <b>o saldo é pago na entrada</b>, antes de ocupar o espaço.
          </p>
        </div>
      )}

      {!f.braai && (
        <>
      <label className="c-label">Tipo de Evento *</label>
      <select className="c-select" value={f.tipoEvento} onChange={(e) => set("tipoEvento", e.target.value)}>
        <option value="">— Seleccione o tipo de evento —</option>
        {TIPOS_EVENTO_RESERVA.map((t) => <option key={t} value={t}>{t}</option>)}
      </select>
      {f.tipoEvento === "Outro" && (
        <input className="c-input" style={{ marginTop: 6 }} placeholder="Especifique o evento (ex.: Baptizado)"
          value={f.tipoOutro} onChange={(e) => set("tipoOutro", e.target.value)} />
      )}
        </>
      )}

      <div style={{ marginTop: 8 }}>
        <label className="c-label">📥 Data de entrada (lançamento)</label>
        <input className="c-input" type="date" max={hoje()} value={f.dataEntrada} onChange={(e) => set("dataEntrada", e.target.value)} />
        <span className="c-sub">O adiantamento soma na receita DESTE dia — se a reserva entrou ontem ou antes de ontem, escolha esse dia (nunca futuro).</span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 8 }}>
        <div>
          <label className="c-label">Data do Evento *</label>
          <input className="c-input" type="date" min={hoje()} value={f.dataConsumo} onChange={(e) => set("dataConsumo", e.target.value)} />
        </div>
        <div>
          <label className="c-label">{f.braai ? "Hora de entrada *" : "Hora"}</label>
          <input className="c-input" type="time" value={f.hora} onChange={(e) => set("hora", e.target.value)} />
          {f.braai && f.hora && (
            <span className="c-sub">⏱ saída até às {String((+f.hora.slice(0, 2) + BRAAI_DURACAO_HORAS) % 24).padStart(2, "0")}:{f.hora.slice(3)} ({BRAAI_DURACAO_HORAS}h)</span>
          )}
        </div>
      </div>
      <label className="c-label" style={{ marginTop: 10 }}>🪑 {f.braai ? "Espaço onde o grupo vai ficar *" : "Onde o cliente pretende sentar *"}</label>
      <select className="c-select" value={f.area} onChange={(e) => set("area", e.target.value)}>
        <option value="">— Seleccione o espaço —</option>
        {AREAS_ESTAR.map((a) => <option key={a} value={a}>{a}</option>)}
      </select>
      <button type="button" className="c-btn c-btn-linha c-btn-peq" style={{ marginTop: 4 }}
        onClick={() => setVerCal(!verCal)}>
        {verCal ? "▲ Esconder calendário" : "🗓 Ver datas livres / ocupadas do salão"}
      </button>
      {verCal && (
        <div className="c-card" style={{ background: "var(--lilas)", marginTop: 6, padding: 10 }}>
          <div className="c-sub" style={{ marginBottom: 6 }}>Datas com espaço <b>ocupado</b> (reserva activa) — o bloqueio é por espaço:</div>
          {ocupadas.length === 0 && <span className="c-sub">✅ Nenhuma data ocupada — todas livres!</span>}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {ocupadas.map((o) => (
              <span key={o.codigo} className="c-chip c-chip-vermelho" title={`${o.codigo} — ${o.cliente}`}>
                {diaBR(o.dataConsumo)} · {(o as { espaco?: string | null }).espaco ?? "Salão"} ({o.cliente.split(" ")[0]})
              </span>
            ))}
          </div>
          <div className="c-sub" style={{ marginTop: 6 }}>As restantes datas futuras estão <b style={{ color: "var(--verde-c)" }}>livres</b>.</div>
        </div>
      )}
      {choque && (
        <p style={{ color: "var(--vermelho-c)", fontSize: 13, background: "#fdeaea", borderRadius: 8, padding: "6px 10px" }}>
          🔒 {(choque as { espaco?: string | null }).espaco ?? "Esse espaço"} já está reservado nesta data ({choque.codigo} — {choque.cliente}, {choque.status}). Escolha outra data ou outro espaço.
        </p>
      )}

      <label className="c-label" style={{ marginTop: 10, display: f.braai ? "none" : undefined }}>🏛 Aluguer de espaço para evento (opcional)</label>
      {!f.braai && (
      <>
      <select className="c-select" value={f.espaco} onChange={(e) => { set("espaco", e.target.value); if (!e.target.value) set("pacoteId", 0); }}>
        <option value="">— Sem aluguer (reserva simples: nº de pessoas × taxa) —</option>
        {ESPACOS_EVENTO.map((e2) => (
          <option key={e2} value={e2}>{e2} — sem decoração: {mt(precoEspacoSemDecoracao(emp as unknown as Record<string, string>, e2))}</option>
        ))}
      </select>
      {querSalao && (
        <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
          <button type="button" className={`c-btn c-btn-peq ${f.modoSalao === "sem" ? "c-btn-prim" : "c-btn-cinza"}`} style={{ flex: 1 }}
            onClick={() => { set("modoSalao", "sem"); set("pacoteId", 0); }}>
            🏛 Sem decoração — {mt(precoEspacoSemDecoracao(emp as unknown as Record<string, string>, f.espaco))}
          </button>
          <button type="button" className={`c-btn c-btn-peq ${f.modoSalao === "pacote" ? "c-btn-prim" : "c-btn-cinza"}`} style={{ flex: 1 }}
            onClick={() => set("modoSalao", "pacote")}>
            💐 Com pacote (inclui decoração)
          </button>
        </div>
      )}
      {querSalao && f.modoSalao === "pacote" && (
        <>
          <label className="c-label" style={{ marginTop: 8 }}>Pacote do Salão (inclui decoração)</label>
          <select className="c-select" value={f.pacoteId || ""} onChange={(e) => set("pacoteId", +e.target.value || 0)}>
            <option value="">— Escolha o pacote —</option>
            {saloes.map((s) => (
              <option key={s.id} value={s.id}>{s.nome.replace(/^Aluguer Sal[aã]o\s*-\s*/i, "")} — {mt(s.preco)}</option>
            ))}
          </select>
        </>
      )}
      {pacote && (
        <p className="c-sub" style={{ marginTop: 4 }}>
          💐 Com pacote, o cliente paga apenas a <b>percentagem de adiantamento do pacote</b> seleccionado.
          Os detalhes da <b>decoração</b> e outros aspectos serão discutidos <b>em privado com o cliente</b>,
          de preferência no dia do pagamento.
        </p>
      )}
      {querSalao && !pacote && (
        <p className="c-sub" style={{ marginTop: 4 }}>
          🏛 <b>{f.espaco}</b> sem decoração: <b>{mt(valor)}</b> — só este espaço fica bloqueado na data.
          Decoração e catering podem ser contratados à parte.
        </p>
      )}
      </>
      )}

      <div style={{ display: "grid", gridTemplateColumns: f.braai ? "1fr 1fr" : "1fr 1fr 1fr", gap: 10, marginTop: 6 }}>
        <div>
          <label className="c-label">{f.braai ? "Pagantes (10+ anos)" : "Nº de Pessoas"}</label>
          <input className="c-input" type="number" min={1} value={f.pessoas} onChange={(e) => set("pessoas", +e.target.value || 0)} />
        </div>
        {f.braai ? (
          <div>
            <label className="c-label">Crianças até 9 anos</label>
            <input className="c-input" type="number" min={0} value={f.criancasMenores} onChange={(e) => set("criancasMenores", +e.target.value || 0)} />
          </div>
        ) : (
        <div>
          <label className="c-label">Taxa de Reserva</label>
          <input className="c-input" value={`${taxaReservaPessoa(f.area).toFixed(2)} MZN`} readOnly disabled
            title="400 MZN por pessoa; 500 MZN no Salão primeiro andar"
            style={{ background: "#f0ecf7", fontWeight: 700, color: f.area === "Salão primeiro andar" ? "var(--roxo)" : undefined }} />
        </div>
        )}
        <div>
          <label className="c-label">Valor Total (MZN)</label>
          <input className="c-input" value={valor.toFixed(2)} readOnly disabled
            style={{ background: "#f0ecf7", fontWeight: 700 }} />
        </div>
      </div>
      {f.braai && (
        <p className="c-sub" style={{ marginTop: 4 }}>
          🔥 <b>{braaiRotulo(f.braaiModalidade, f.braaiModalidade === "B" ? f.braaiTraz : null)}</b>: {f.pessoas} pagantes × {mt(braaiTaxaPessoa(f.braaiModalidade, f.pessoas))} = <b>{mt(valor)}</b> — taxa <b>não consumível</b>.
          {f.criancasMenores > 0 && <> 🧒 {f.criancasMenores} criança{f.criancasMenores > 1 ? "s" : ""} até 9 anos (grátis).</>}
        </p>
      )}
      {!querSalao && !f.braai && (
        <p className="c-sub" style={{ marginTop: 4 }}>
          🎟 <b>{f.pessoas} pessoas × {mt(taxaReservaPessoa(f.area))} = {mt(valor)}</b>{f.area === "Salão primeiro andar" && <> (taxa do Salão 1.º andar: 500 MZN/pessoa)</>} — o depósito
          (<b>{mt(adiant)}</b>) é <b>consumível no local</b> no dia do evento e serve como <b>garantia da reserva</b>.
        </p>
      )}

      <label className="c-label" style={{ marginTop: 8 }}>🏷️ Desconto combinado (MZN) — opcional</label>
      <div style={{ width: 170 }}>
        <MoneyInput value={desconto} onChange={(v) => setDesconto(Math.max(0, v))} placeholder="0,00" />
      </div>
      {descontoVal > 0 && (
        <p className="c-sub" style={{ marginTop: 4 }}>
          🏷️ Desconto de <b>{mt(descontoVal)}</b> aplicado: {mt(valorBase)} → <b>{mt(valor)}</b>
        </p>
      )}

      <label className="c-label" style={{ marginTop: 8 }}>💵 Depósito do cliente (MZN){f.braai && " — mínimo 50%, o saldo é pago na entrada"}</label>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ width: 170 }}>
          <MoneyInput value={deposito ?? Math.round(valor * 0.5 * 100) / 100}
            onChange={(v) => setDeposito(v)} />
        </div>
        {[25, 50, 75, 100].map((p2) => (
          <button key={p2} type="button"
            className={`c-btn c-btn-peq ${pct === p2 ? "c-btn-prim" : "c-btn-cinza"}`}
            onClick={() => setDeposito(Math.round(valor * p2) / 100)}>
            {p2}%
          </button>
        ))}
      </div>
      <div style={{
        fontSize: 12.5, marginTop: 4, fontWeight: 600, lineHeight: 1.4,
        color: pct < 50 ? "#b45309" : pct === 50 ? "#15803d" : "#1d4ed8",
      }}>
        {pct < 50
          ? `⚠️ Depósito de ${pct}% — abaixo do recomendado. 💡 Depósito recomendado: 50% (${mt(valor * 0.5)}).`
          : pct === 50
            ? `✅ Depósito de 50% — o valor recomendado.`
            : pct < 100
              ? `💙 Depósito de ${pct}% — acima do recomendado. Obrigado pela confiança!`
              : `✅ Pagamento integral (100%).`}
      </div>

      <label className="c-label" style={{ marginTop: 8 }}>Condições Especiais</label>
      <textarea className="c-textarea" rows={2} placeholder="Ex.: cliente traz o bolo; entrada às 10h…" value={f.condicoes} onChange={(e) => set("condicoes", e.target.value)} />

      <label className="c-label" style={{ marginTop: 8 }}>🤝 Código de afiliado (se o cliente veio por um vendedor)</label>
      <input className="c-input" placeholder="Ex.: AF-0001 (opcional)" value={f.afiliadoCodigo}
        onChange={(e) => set("afiliadoCodigo", e.target.value.toUpperCase())} />

      <div className="c-card" style={{ background: "var(--lilas)", marginTop: 12, marginBottom: 0 }}>
        {descontoVal > 0 && <div className="c-total-linha"><span>Valor antes do desconto</span><span style={{ textDecoration: "line-through", color: "#999" }}>{mt(valorBase)}</span></div>}
        {descontoVal > 0 && <div className="c-total-linha"><span>🏷️ Desconto</span><b style={{ color: "var(--verde-c)" }}>− {mt(descontoVal)}</b></div>}
        <div className="c-total-linha"><span>Valor total</span><b>{mt(valor)}</b></div>
        <div className="c-total-linha"><span>Depósito a pagar agora ({pct}%)</span><b style={{ color: "var(--verde-c)" }}>{mt(adiant)}</b></div>
        <div className="c-total-linha"><span>Remanescente</span><b style={{ color: valorFinal - adiant > 0.009 ? "var(--vermelho-c)" : "var(--verde-c)" }}>{mt(Math.max(0, valorFinal - adiant))}</b></div>
        {adiant > valor + 0.009 && (
          <div className="c-sub" style={{ color: "var(--verde-c)", fontWeight: 700 }}>
            💰 O cliente adiantou acima do total da reserva — o comprovativo sai com o valor real pago: {mt(valorFinal)}.
          </div>
        )}
      </div>

      <button className="c-btn c-btn-prim c-btn-bloco" style={{ marginTop: 12 }} disabled={create.isPending}
        onClick={() => {
          if (!valido()) return;
          user && create.mutate({
            usuarioId: user.id, cliente: f.cliente, contacto: f.contacto || undefined,
            dataConsumo: f.dataConsumo, hora: f.hora || undefined, area: f.area,
            espaco: (f.espaco || undefined) as typeof ESPACOS_EVENTO[number] | undefined,
            tipoEvento: f.braai ? "Braai" : f.tipoEvento, tipoOutro: f.tipoOutro || undefined,
            pessoas: f.pessoas, pacoteId: pacote?.id, adiantValor: adiant,
            desconto: descontoVal || undefined,
            condicoes: f.condicoes || undefined,
            afiliadoCodigo: f.afiliadoCodigo.trim() || undefined,
            braai: f.braai || undefined,
            braaiModalidade: f.braai ? f.braaiModalidade : undefined,
            braaiTraz: f.braai && f.braaiModalidade === "B" ? f.braaiTraz : undefined,
            criancasMenores: f.braai ? f.criancasMenores : 0,
            dataEntrada: f.dataEntrada || undefined,
          });
        }}>
        {create.isPending ? "A guardar…" : "💾 Guardar Reserva"}
      </button>
      <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
        <button className="c-btn c-btn-linha" style={{ flex: 1 }}
          onClick={() => valido() && printDoc("Comprovativo de Reserva", reservaBodyHtml(docAtual(), emp))}>
          🖨 Imprimir
        </button>
        <button className="c-btn c-btn-linha" style={{ flex: 1 }} disabled={baixando}
          onClick={async () => {
            if (!valido()) return;
            setBaixando(true);
            try { await downloadPdf("Comprovativo de Reserva", reservaBodyHtml(docAtual(), emp), `Reserva-${f.cliente.replace(/\s+/g, "-")}.pdf`); }
            finally { setBaixando(false); }
          }}>
          {baixando ? "A gerar…" : "⬇️ Fazer Download"}
        </button>
      </div>
    </Modal>
  );
}


/* ============ COBRAR SALDO EM FALTA (dia do consumo) ============ */
function CobrarSaldoModal({ r, pendente, onClose, onSave }: {
  r: Reserva; pendente: boolean; onClose: () => void;
  onSave: (valor: number, metodo: string) => void;
}) {
  const [valor, setValor] = useState(r.saldo);
  const [metodo, setMetodo] = useState("Dinheiro");
  const ok = valor > 0 && valor <= r.saldo;
  return (
    <Modal onClose={onClose}>
      <h3>💰 Cobrar saldo — {r.codigo}</h3>
      <p className="c-sub" style={{ fontSize: 13 }}>
        {r.cliente} · Total {mt(r.valor)} · Adiantado {mt(r.adiant)} · <b style={{ color: "var(--vermelho-c)" }}>em falta {mt(r.saldo)}</b>
      </p>
      <label className="c-label">Valor recebido agora (MZN)</label>
      <MoneyInput value={valor} onChange={setValor} />
      <div style={{ display: "flex", gap: 6, margin: "6px 0" }}>
        <button className="c-btn c-btn-linha c-btn-peq" onClick={() => setValor(r.saldo)}>Total ({mt(r.saldo)})</button>
        <button className="c-btn c-btn-linha c-btn-peq" onClick={() => setValor(Math.round(r.saldo / 2))}>Metade</button>
      </div>
      <label className="c-label">Método de pagamento</label>
      <select className="c-select" value={metodo} onChange={(e) => setMetodo(e.target.value)}>
        {METODOS_PAGAMENTO.map((m) => <option key={m}>{m}</option>)}
      </select>
      {valor > r.saldo && <p style={{ color: "var(--vermelho-c)", fontSize: 12 }}>⚠️ O valor não pode ser maior que o saldo em falta.</p>}
      <button className="c-btn c-btn-verde c-btn-bloco" style={{ marginTop: 12 }} disabled={!ok || pendente}
        onClick={() => onSave(valor, metodo)}>
        {pendente ? "A registar…" : `✅ Receber ${mt(ok ? valor : 0)}`}
      </button>
    </Modal>
  );
}
