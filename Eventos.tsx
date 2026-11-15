import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { useSession } from "@/lib/session";
import { mt, hoje, diaBR, horaBR, dataBR } from "@/lib/fmt";
import { Modal, Vazio, Stat } from "@/components/bits";
import MoneyInput from "@/components/MoneyInput";
import { METODOS_PAGAMENTO } from "@contracts/types";
import { useEmpresa } from "@/lib/empresa";
import { printDoc, downloadPdf } from "@/lib/docprint";
import JsBarcode from "jsbarcode";

/** SVG de código de barras CODE128 (lê-se com qualquer scanner USB/BT — devolve o código do bilhete) */
function barcodeSvg(code: string): string {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  JsBarcode(svg, code, { format: "CODE128", displayValue: false, height: 44, margin: 0, width: 1.6 });
  return svg.outerHTML;
}

type EventoRow = {
  id: number; codigo: string; nome: string; descricao: string | null;
  dataEvento: string; horaInicio: string | null; horaFim: string | null; local: string | null;
  precoNormal: number; precoVip: number; capacidade: number | null;
  incluiNormal: string | null; incluiVip: string | null;
  status: "Rascunho" | "Aberto" | "Esgotado" | "Encerrado" | "Concluído" | "Cancelado";
  maxPrestacoes?: number; // 1 = só à vista; 2+ = aceita pagamento em prestações
  vendidos: number; vendidosNormal: number; vendidosVip: number; receita: number;
  emAberto?: number; // soma dos saldos por pagar (bilhetes em prestações)
  vagasRestantes: number | null; veTudo: boolean;
};

const STATUS_COR: Record<string, string> = {
  Rascunho: "#888", Aberto: "#1a7a3c", Esgotado: "#b3261e",
  Encerrado: "#8a5a00", "Concluído": "#1F4E79", Cancelado: "#b3261e",
};
const STATUS_ICON: Record<string, string> = {
  Rascunho: "✏️", Aberto: "🟢", Esgotado: "😔", Encerrado: "🔒", "Concluído": "🏁", Cancelado: "✕",
};

/** Documento do bilhete (impressão/PDF) — usado na venda E na reemissão após corrigir o titular.
    O CÓDIGO DE BARRAS é sempre o mesmo (é a identidade do bilhete à porta); muda só o nome/telefone. */
function bilheteHtmlDoc(emp: ReturnType<typeof useEmpresa>, ev: EventoRow,
  b: { codigo: string; nomePessoa: string; tipo: string; valor: number; valorPago?: number; nPrestacoes?: number }): string {
  const inclui = b.tipo === "VIP" ? ev.incluiVip : ev.incluiNormal;
  const saldo = b.valorPago != null ? Math.max(0, Math.round((b.valor - b.valorPago) * 100) / 100) : 0;
  const emPrest = saldo > 0.009;
  return `
    <div style="text-align:center">
      <img src="/icons/logo.png" alt="CAMI'S Eventos" style="width:64px;margin:0 auto 4px;display:block" />
      <h2 style="margin:0 0 2px;color:#1F4E79">${emp?.nome ?? "CAMI'S EVENTOS"}</h2>
      <div style="font-size:9pt;color:#555">${[emp.local, `${emp.tel1} · ${emp.tel2}`].filter(Boolean).join(" · ")}</div>
    </div>
    <hr style="border:none;border-top:2px dashed #1F4E79;margin:8px 0" />
    <div style="text-align:center">
      <div style="font-size:8.5pt;color:#666;letter-spacing:2px">BILHETE DE ENTRADA</div>
      <h2 style="margin:4px 0 2px">${ev.nome}</h2>
      <div style="font-size:10pt">🗓 ${dataBR(ev.dataEvento)}${ev.horaInicio ? ` · ⏰ ${ev.horaInicio}` : ""}${ev.local ? `<br/>📍 ${ev.local}` : ""}</div>
      <div style="margin:10px 0;padding:8px;border:1.5px solid #1F4E79;border-radius:8px">
        <div style="font-size:8pt;color:#666">TITULAR</div>
        <div style="font-size:12pt;font-weight:bold">${b.nomePessoa}</div>
        <div style="font-size:9pt;margin-top:4px">${b.tipo === "VIP" ? "⭐ VIP" : "🎟 NORMAL"} · <b>${mt(b.valor)}</b></div>
      </div>
      ${inclui ? `<div style="font-size:8.5pt;color:#444;margin:6px 0">📋 <b>Inclui:</b> ${inclui}</div>` : ""}
      ${emPrest ? `
      <div style="margin:8px 0;padding:7px;border:2px solid #d97706;border-radius:8px;background:#fffbeb;text-align:center">
        <div style="font-size:9.5pt;font-weight:800;color:#92400e">🧩 Bilhete com pagamento faseado — já está quase!</div>
        <div style="font-size:8.5pt;margin-top:2px;color:#78350f">Recebemos com gosto <b>${mt(b.valorPago!)}</b> de ${mt(b.valor)} — faltam apenas <b>${mt(saldo)}</b>${b.nPrestacoes && b.nPrestacoes > 1 ? `, combinados em ${b.nPrestacoes} prestações` : ""}.</div>
        <div style="font-size:8pt;margin-top:3px;color:#92400e">Para entrar com toda a tranquilidade, complete o pagamento até <b>${dataBR(ev.dataEvento)}</b> (dia do evento), porque à porta não é possível pagar.<br/>Assim que concluir, a sua entrada está garantida — <b>guardamos o seu lugar e esperamos por si! 🎉</b></div>
      </div>` : ""}
      <div style="margin:8px 0 2px">${barcodeSvg(b.codigo)}</div>
      <div style="font-size:11pt;font-weight:bold;letter-spacing:1px">${b.codigo}</div>
      <div style="font-size:7.5pt;color:#888;margin-top:6px">Válido para 1 pessoa · o código de barras é lido à porta e identifica o titular — <b>só entra uma vez</b></div>
    </div>`;
}

export default function Eventos() {
  const { user, toast } = useSession();
  const utils = trpc.useUtils();
  const q = trpc.eventos.listar.useQuery({ usuarioId: user?.id ?? 0 }, { enabled: !!user, refetchInterval: 12000 });
  const minhas = trpc.eventos.minhasVendas.useQuery({ usuarioId: user?.id ?? 0 }, { enabled: !!user, refetchInterval: 15000 });
  const [novoOpen, setNovoOpen] = useState(false);
  const [editEv, setEditEv] = useState<EventoRow | null>(null);
  const [venderEv, setVenderEv] = useState<EventoRow | null>(null);
  const [listaEv, setListaEv] = useState<EventoRow | null>(null);
  const [validarOpen, setValidarOpen] = useState(false);
  const veTudo = !!user && ["Admin", "Gestor", "Eventos"].includes(user.perfil);
  const eventos = q.data ?? [];
  const activos = eventos.filter((e) => e.status === "Aberto" || e.status === "Esgotado");

  const setStatus = trpc.eventos.setStatus.useMutation({
    onSuccess: () => { utils.eventos.listar.invalidate(); toast("Estado do evento actualizado"); },
    onError: (e) => toast("⚠️ " + e.message),
  });
  const remover = trpc.eventos.remover.useMutation({
    onSuccess: () => { utils.eventos.listar.invalidate(); toast("🗑 Evento removido"); },
    onError: (e) => toast("⚠️ " + e.message),
  });

  return (
    <div>
      <div className="c-titulo">🎟 Eventos & Bilheteira</div>
      <p className="c-sub" style={{ marginBottom: 10 }}>
        Venda de entradas com registo de cada pessoa. {veTudo
          ? "Vê todos os eventos, totais e vendedores."
          : "Vê os eventos abertos e as SUAS vendas — os somatórios gerais são visíveis apenas pela gestão."}
      </p>

      {/* painel do caixa: as minhas vendas de hoje */}
      {minhas.data && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
          <Stat cls="az" lbl={`🎟 Os meus bilhetes hoje (${diaBR(minhas.data.dia)})`}>{String(minhas.data.n)}</Stat>
          <Stat cls="v" lbl="💰 O meu total de hoje">{mt(minhas.data.total)}</Stat>
        </div>
      )}

      <button className="c-btn c-btn-linha c-btn-bloco" style={{ marginBottom: 10, borderColor: "var(--verde-c)", color: "var(--verde-c)", fontWeight: 800 }}
        onClick={() => setValidarOpen(true)}>
        🛡 Validar entrada à porta (scanner / código)
      </button>

      {veTudo && (
        <button className="c-btn c-btn-prim c-btn-bloco" style={{ marginBottom: 12 }} onClick={() => setNovoOpen(true)}>
          ＋ Criar evento
        </button>
      )}

      {q.isLoading && <Vazio icon="⏳">A carregar…</Vazio>}
      {!q.isLoading && eventos.length === 0 && (
        <Vazio icon="🎟">Sem eventos.<br />{veTudo ? "Crie o primeiro evento!" : "Aguarde que a gestão crie um evento."}</Vazio>
      )}

      {eventos.map((e) => (
        <div key={e.id} className="c-card" style={{ marginBottom: 10, borderLeft: `5px solid ${STATUS_COR[e.status]}` }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, flexWrap: "wrap" }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <b style={{ fontSize: 15 }}>{e.nome}</b> <span className="c-sub" style={{ fontSize: 11 }}>({e.codigo})</span>
              <div className="c-sub" style={{ fontSize: 12, marginTop: 2 }}>
                🗓 {diaBR(e.dataEvento)}{e.horaInicio ? ` · ⏰ ${e.horaInicio}${e.horaFim ? "–" + e.horaFim : ""}` : ""}{e.local ? ` · 📍 ${e.local}` : ""}
              </div>
              <div style={{ fontSize: 12.5, marginTop: 3 }}>
                🎟 Normal: <b>{e.precoNormal > 0 ? mt(e.precoNormal) : "Entrada livre"}</b>
                {e.precoVip > 0 && <> · ⭐ VIP: <b>{mt(e.precoVip)}</b></>}
              </div>
              {e.incluiNormal && <div className="c-sub" style={{ fontSize: 11.5, marginTop: 2 }}>📋 Normal inclui: {e.incluiNormal}</div>}
              {e.precoVip > 0 && e.incluiVip && <div className="c-sub" style={{ fontSize: 11.5, marginTop: 1 }}>⭐ VIP inclui: {e.incluiVip}</div>}
            </div>
            <span style={{
              fontSize: 11, fontWeight: 800, padding: "3px 10px", borderRadius: 14,
              background: STATUS_COR[e.status] + "22", color: STATUS_COR[e.status], whiteSpace: "nowrap",
            }}>
              {STATUS_ICON[e.status]} {e.status}
            </span>
          </div>

          {/* estatísticas — Caixa vê apenas as suas; gestão vê tudo */}
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 12.5, marginTop: 6 }}>
            <span>{veTudo ? "Vendidos" : "Os meus bilhetes"}: <b>{e.vendidos}</b>
              {e.vendidosNormal + e.vendidosVip > 0 && <small style={{ color: "#888" }}> ({e.vendidosNormal} normal{e.vendidosVip ? ` · ${e.vendidosVip} VIP` : ""})</small>}
            </span>
            {veTudo && <span>💰 Receita: <b style={{ color: "var(--verde-c)" }}>{mt(e.receita)}</b></span>}
            {e.capacidade != null && (
              <span>🪑 Lugares: <b>{e.vagasRestantes}</b> de {e.capacidade}{!veTudo ? " livres" : ""}</span>
            )}
          </div>

          {/* barra de lotação */}
          {e.capacidade != null && (
            <div style={{ height: 7, background: "#f3e9fa", borderRadius: 6, marginTop: 6 }}>
              <div style={{
                height: 7, borderRadius: 6,
                width: Math.min(100, Math.round((e.vendidos / e.capacidade) * 100)) + "%",
                background: e.status === "Esgotado" ? "#b3261e" : "linear-gradient(90deg,#a855f7,#7c3aed)",
              }} />
            </div>
          )}

          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
            {e.status === "Aberto" && (
              <button className="c-btn c-btn-verde c-btn-peq" onClick={() => setVenderEv(e)}>
                🎟 Vender bilhete
              </button>
            )}
            <button className="c-btn c-btn-linha c-btn-peq" onClick={() => setListaEv(e)}>
              👥 {veTudo ? "Lista de entradas" : "As minhas vendas"}
            </button>
            {veTudo && (
              <>
                <button className="c-btn c-btn-linha c-btn-peq" onClick={() => setEditEv(e)}>✏️ Editar</button>
                {e.status === "Rascunho" && (
                  <button className="c-btn c-btn-prim c-btn-peq" disabled={setStatus.isPending}
                    onClick={() => setStatus.mutate({ usuarioId: user!.id, id: e.id, status: "Aberto" })}>
                    🟢 Abrir vendas
                  </button>
                )}
                {e.status === "Aberto" && (
                  <button className="c-btn c-btn-linha c-btn-peq" disabled={setStatus.isPending}
                    onClick={() => { if (confirm("Encerrar as vendas deste evento?")) setStatus.mutate({ usuarioId: user!.id, id: e.id, status: "Encerrado" }); }}>
                    🔒 Encerrar vendas
                  </button>
                )}
                {e.status === "Encerrado" && (
                  <button className="c-btn c-btn-linha c-btn-peq" disabled={setStatus.isPending}
                    onClick={() => setStatus.mutate({ usuarioId: user!.id, id: e.id, status: "Aberto" })}>
                    🟢 Reabrir vendas
                  </button>
                )}
                {(e.status === "Aberto" || e.status === "Encerrado" || e.status === "Esgotado") && (
                  <button className="c-btn c-btn-linha c-btn-peq" disabled={setStatus.isPending}
                    onClick={() => setStatus.mutate({ usuarioId: user!.id, id: e.id, status: "Concluído" })}>
                    🏁 Evento realizado
                  </button>
                )}
                {user?.perfil === "Admin" && (
                  <button className="c-btn c-btn-perigo c-btn-peq" disabled={remover.isPending}
                    onClick={() => { if (confirm(`🗑 Remover o evento «${e.nome}»? Só é possível sem bilhetes pagos.`)) remover.mutate({ usuarioId: user.id, id: e.id }); }}>
                    🗑
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      ))}

      {(novoOpen || editEv) && (
        <FormEvento ev={editEv} onClose={() => { setNovoOpen(false); setEditEv(null); }} />
      )}
      {venderEv && <VenderBilhete ev={venderEv} onClose={() => setVenderEv(null)} />}
      {listaEv && <ListaEntradas ev={listaEv} onClose={() => setListaEv(null)} />}
      {validarOpen && <ValidarEntrada onClose={() => setValidarOpen(false)} />}
      {activos.length > 0 && null}
    </div>
  );
}

/* ============ Criar / editar evento ============ */
function FormEvento({ ev, onClose }: { ev: EventoRow | null; onClose: () => void }) {
  const { user, toast } = useSession();
  const utils = trpc.useUtils();
  // corrigir o NOME de um evento já criado: só Admin ou autorizado por ele
  const podeNome = !ev || user?.perfil === "Admin" || !!user?.podeEditarNomes;
  const [f, setF] = useState({
    nome: ev?.nome ?? "", descricao: ev?.descricao ?? "",
    dataEvento: ev?.dataEvento ?? "", horaInicio: ev?.horaInicio ?? "", horaFim: ev?.horaFim ?? "",
    local: ev?.local ?? "", capacidade: ev?.capacidade ?? (null as number | null),
    incluiNormal: ev?.incluiNormal ?? "", incluiVip: ev?.incluiVip ?? "",
    maxPrestacoes: ev?.maxPrestacoes ?? 1,
  });
  const [precoNormal, setPrecoNormal] = useState(ev?.precoNormal ?? 0);
  const [precoVip, setPrecoVip] = useState(ev?.precoVip ?? 0);
  const set = (k: string, v: unknown) => setF((p) => ({ ...p, [k]: v }));
  const guardar = trpc.eventos.guardar.useMutation({
    onSuccess: (r) => { utils.eventos.listar.invalidate(); toast(`✅ Evento ${r.codigo} ${ev ? "actualizado" : "criado"}!`); onClose(); },
    onError: (e) => toast("⚠️ " + e.message),
  });

  return (
    <Modal onClose={onClose}>
      <h3>{ev ? `✏️ Editar ${ev.codigo}` : "＋ Novo Evento"}</h3>
      <label className="c-label">Nome do evento *</label>
      <input className="c-input" placeholder="Ex.: Festival de Verão CAMI'S" value={f.nome} onChange={(e) => set("nome", e.target.value)} autoFocus={podeNome}
        disabled={!podeNome} style={!podeNome ? { opacity: .65 } : undefined} />
      {!podeNome && (
        <p className="c-sub" style={{ marginTop: 2, color: "var(--amarelo-c)" }}>
          🔒 Só o Administrador (ou alguém autorizado por ele nas Configurações) pode alterar o nome de um evento já criado. Os restantes campos pode editar à vontade.
        </p>
      )}
      <label className="c-label" style={{ marginTop: 10 }}>Descrição (opcional)</label>
      <textarea className="c-input" rows={2} placeholder="Artistas, programa, regras da entrada…" value={f.descricao} onChange={(e) => set("descricao", e.target.value)} />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginTop: 10 }}>
        <div>
          <label className="c-label" style={{ marginTop: 0 }}>Data *</label>
          <input className="c-input" type="date" value={f.dataEvento} onChange={(e) => set("dataEvento", e.target.value)} />
        </div>
        <div>
          <label className="c-label" style={{ marginTop: 0 }}>Início</label>
          <input className="c-input" type="time" value={f.horaInicio} onChange={(e) => set("horaInicio", e.target.value)} />
        </div>
        <div>
          <label className="c-label" style={{ marginTop: 0 }}>Fim</label>
          <input className="c-input" type="time" value={f.horaFim} onChange={(e) => set("horaFim", e.target.value)} />
        </div>
      </div>
      <label className="c-label" style={{ marginTop: 10 }}>Local</label>
      <input className="c-input" placeholder="Ex.: Salão primeiro andar / Jardim CAMI'S" value={f.local} onChange={(e) => set("local", e.target.value)} />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 10 }}>
        <div>
          <label className="c-label" style={{ marginTop: 0 }}>🎟 Preço Normal (MZN)</label>
          <MoneyInput value={precoNormal} onChange={setPrecoNormal} />
          <span className="c-sub">0 = entrada livre</span>
        </div>
        <div>
          <label className="c-label" style={{ marginTop: 0 }}>⭐ Preço VIP (MZN)</label>
          <MoneyInput value={precoVip} onChange={setPrecoVip} />
          <span className="c-sub">0 = sem VIP</span>
        </div>
      </div>
      <label className="c-label" style={{ marginTop: 10 }}>📋 O que inclui o bilhete NORMAL</label>
      <textarea className="c-input" rows={2} placeholder="Ex.: Entrada + lugar no relvado + 1 bebida de boas-vindas"
        value={f.incluiNormal} onChange={(e) => set("incluiNormal", e.target.value)} />
      <label className="c-label" style={{ marginTop: 10 }}>⭐ O que inclui o bilhete VIP</label>
      <textarea className="c-input" rows={2} placeholder="Ex.: Entrada + mesa reservada + bar aberto + acesso ao lounge"
        value={f.incluiVip} onChange={(e) => set("incluiVip", e.target.value)} />
      <label className="c-label" style={{ marginTop: 10 }}>🪑 Capacidade (lugares)</label>
      <input className="c-input" type="number" min={1} placeholder="Vazio = sem limite"
        value={f.capacidade ?? ""} onChange={(e) => set("capacidade", e.target.value ? Math.max(1, parseInt(e.target.value) || 1) : null)} />
      <label className="c-label" style={{ marginTop: 10 }}>🧩 Pagamento em prestações — nº máximo aceite</label>
      <input className="c-input" type="number" min={1} max={12}
        value={f.maxPrestacoes} onChange={(e) => set("maxPrestacoes", Math.min(12, Math.max(1, parseInt(e.target.value) || 1)))} />
      <span className="c-sub">
        1 = só à vista. Com 2 ou mais, o caixa pode vender em prestações — a última é paga <b>até ao dia do evento</b>; na entrada não se aceita pagamento e sem quitação total o cliente não entra.
      </span>
      <button className="c-btn c-btn-prim c-btn-bloco" style={{ marginTop: 14 }}
        disabled={guardar.isPending || f.nome.trim().length < 3 || !f.dataEvento}
        onClick={() => user && guardar.mutate({
          usuarioId: user.id, id: ev?.id,
          nome: f.nome, descricao: f.descricao || undefined,
          dataEvento: f.dataEvento, horaInicio: f.horaInicio || undefined, horaFim: f.horaFim || undefined,
          local: f.local || undefined, precoNormal, precoVip,
          incluiNormal: f.incluiNormal || undefined, incluiVip: f.incluiVip || undefined,
          capacidade: f.capacidade, maxPrestacoes: f.maxPrestacoes,
        })}>
        {guardar.isPending ? "A guardar…" : ev ? "💾 Guardar alterações" : "✅ Criar evento (rascunho)"}
      </button>
      {!ev && <p className="c-sub" style={{ marginTop: 6 }}>O evento nasce em «Rascunho» — abra as vendas quando estiver pronto.</p>}
    </Modal>
  );
}

/* ============ Vender bilhete (cada pessoa registada) ============ */
function VenderBilhete({ ev, onClose }: { ev: EventoRow; onClose: () => void }) {
  const { user, toast } = useSession();
  const utils = trpc.useUtils();
  const emp = useEmpresa();
  const [tipo, setTipo] = useState<"Normal" | "VIP">("Normal");
  const [nome, setNome] = useState("");
  const [tel, setTel] = useState("");
  const [metodo, setMetodo] = useState("Dinheiro");
  const [ultimo, setUltimo] = useState<{ codigo: string; valor: number; nome: string; valorPago: number; saldo: number; nPrestacoes: number } | null>(null);
  // prestações: só se o evento permitir E ainda não for o dia do evento
  const maxPrest = ev.maxPrestacoes ?? 1;
  const podePrest = maxPrest > 1 && hoje() < ev.dataEvento;
  const [modo, setModo] = useState<"vista" | "prest">("vista");
  const [nPrest, setNPrest] = useState(2);
  const [sinal, setSinal] = useState(0);
  const valor = tipo === "VIP" ? ev.precoVip : ev.precoNormal;

  const vender = trpc.eventos.vender.useMutation({
    onSuccess: (r) => {
      utils.eventos.listar.invalidate(); utils.eventos.minhasVendas.invalidate(); utils.eventos.bilhetes.invalidate();
      setUltimo({ codigo: r.codigo, valor: r.valor, nome: nome.trim(), valorPago: r.valorPago, saldo: r.saldo, nPrestacoes: r.nPrestacoes });
      setNome(""); setTel(""); setSinal(0); setModo("vista"); setNPrest(2);
      toast(r.saldo > 0 ? `🎟 Bilhete ${r.codigo} em prestações — sinal ${mt(r.valorPago)} · falta ${mt(r.saldo)}` : `🎟 Bilhete ${r.codigo} vendido — ${mt(r.valor)}`);
    },
    onError: (e) => toast("⚠️ " + e.message),
  });

  const bilheteHtml = (codigo: string, nomeP: string, valorV: number, valorPagoV?: number, nPrestV?: number) =>
    bilheteHtmlDoc(emp, ev, { codigo, nomePessoa: nomeP, tipo, valor: valorV, valorPago: valorPagoV, nPrestacoes: nPrestV });

  return (
    <Modal onClose={onClose}>
      <h3>🎟 Vender bilhete — {ev.nome}</h3>
      <p className="c-sub">🗓 {diaBR(ev.dataEvento)}{ev.local ? ` · 📍 ${ev.local}` : ""}
        {ev.vagasRestantes != null && <> · 🪑 <b>{ev.vagasRestantes}</b> lugares livres</>}</p>

      {ev.precoVip > 0 && (
        <>
          <label className="c-label">Tipo de bilhete</label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <button className={`c-btn ${tipo === "Normal" ? "c-btn-prim" : "c-btn-linha"}`} onClick={() => setTipo("Normal")}>
              🎟 Normal — {mt(ev.precoNormal)}
            </button>
            <button className={`c-btn ${tipo === "VIP" ? "c-btn-prim" : "c-btn-linha"}`} onClick={() => setTipo("VIP")}>
              ⭐ VIP — {mt(ev.precoVip)}
            </button>
          </div>
        </>
      )}
      {(tipo === "VIP" ? ev.incluiVip : ev.incluiNormal) && (
        <div className="c-card" style={{ padding: "7px 12px", margin: "8px 0 0", background: "#f6effa", fontSize: 12.5 }}>
          {tipo === "VIP" ? "⭐" : "📋"} <b>Inclui:</b> {tipo === "VIP" ? ev.incluiVip : ev.incluiNormal}
        </div>
      )}
      <label className="c-label" style={{ marginTop: 10 }}>Nome da pessoa que entra *</label>
      <input className="c-input" placeholder="Nome completo do titular" value={nome} onChange={(e) => setNome(e.target.value)} autoFocus />
      <label className="c-label" style={{ marginTop: 10 }}>Telefone (opcional)</label>
      <input className="c-input" placeholder="Ex.: 84 000 0000" value={tel} onChange={(e) => setTel(e.target.value)} />
      {podePrest && (
        <>
          <label className="c-label" style={{ marginTop: 10 }}>Forma de pagamento do bilhete</label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <button className={`c-btn ${modo === "vista" ? "c-btn-prim" : "c-btn-linha"}`} onClick={() => setModo("vista")}>
              ✅ À vista
            </button>
            <button className={`c-btn ${modo === "prest" ? "c-btn-prim" : "c-btn-linha"}`} onClick={() => setModo("prest")}>
              🧩 Em prestações (até {maxPrest}×)
            </button>
          </div>
          {modo === "prest" && (
            <div style={{ background: "#fff7e0", border: "1px dashed #b8860b", borderRadius: 10, padding: 10, marginTop: 8 }}>
              <label className="c-label" style={{ marginTop: 0 }}>Nº de prestações combinado</label>
              <select className="c-select" value={nPrest} onChange={(e) => setNPrest(+e.target.value)}>
                {Array.from({ length: maxPrest - 1 }, (_, i) => i + 2).map((n) => <option key={n} value={n}>{n} prestações</option>)}
              </select>
              <label className="c-label" style={{ marginTop: 8 }}>💵 1.ª prestação recebida agora (sinal) *</label>
              <MoneyInput value={sinal} onChange={setSinal} />
              <p className="c-sub" style={{ margin: "4px 0 0" }}>
                {sinal > 0 && sinal < valor
                  ? <>Ficam <b>{mt(valor - sinal)}</b> por pagar em até {nPrest - 1} prestação(ões), <b>até {diaBR(ev.dataEvento)}</b> (dia do evento). Na entrada não se aceita pagamento — sem quitação total o cliente não entra.</>
                  : <>O sinal deve ser <b>menor</b> que {mt(valor)}. O restante é pago em prestações <b>até {diaBR(ev.dataEvento)}</b> (dia do evento) — na entrada não se aceita pagamento.</>}
              </p>
            </div>
          )}
        </>
      )}
      <label className="c-label" style={{ marginTop: 10 }}>Método de pagamento{modo === "prest" ? " (desta prestação)" : ""}</label>
      <select className="c-select" value={metodo} onChange={(e) => setMetodo(e.target.value)}>
        {METODOS_PAGAMENTO.map((m) => <option key={m} value={m}>{m}</option>)}
      </select>
      <div className="c-total-linha" style={{ marginTop: 10 }}>
        <span>{modo === "prest" ? `Total do bilhete (recebe agora ${mt(sinal)})` : "Total a cobrar"}</span><b>{mt(valor)}</b>
      </div>
      <button className="c-btn c-btn-verde c-btn-bloco" style={{ marginTop: 10 }}
        disabled={vender.isPending || nome.trim().length < 2 || ev.vagasRestantes === 0 || (modo === "prest" && !(sinal > 0 && sinal < valor))}
        onClick={() => user && vender.mutate({
          usuarioId: user.id, eventoId: ev.id, nomePessoa: nome, telefone: tel || undefined, tipo, metodo,
          prestacoes: modo === "prest" ? nPrest : undefined,
          valorPago: modo === "prest" ? sinal : undefined,
        })}>
        {vender.isPending ? "A vender…" : modo === "prest" ? `🧩 Receber sinal de ${mt(sinal)} e emitir bilhete` : `✅ Cobrar ${mt(valor)} e emitir bilhete`}
      </button>

      {ultimo && (
        <div className="c-card" style={{ marginTop: 10, background: ultimo.saldo > 0 ? "#fff7e0" : "#e8f7ee", border: `2px solid ${ultimo.saldo > 0 ? "#b8860b" : "#1a7a3c"}` }}>
          <b>{ultimo.saldo > 0 ? "🧩" : "✅"} Bilhete {ultimo.codigo} emitido para {ultimo.nome}</b>
          {ultimo.saldo > 0 && (
            <p className="c-sub" style={{ margin: "4px 0 0", color: "#8a5a00" }}>
              Em <b>{ultimo.nPrestacoes} prestações</b>: recebido {mt(ultimo.valorPago)} · <b>falta {mt(ultimo.saldo)}</b> · último dia de pagamento: <b>{diaBR(ev.dataEvento)}</b> (dia do evento). Sem quitação total o cliente não entra.
            </p>
          )}
          <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
            <button className="c-btn c-btn-linha c-btn-peq" style={{ flex: 1 }}
              onClick={() => printDoc(`Bilhete ${ultimo.codigo}`, bilheteHtml(ultimo.codigo, ultimo.nome, ultimo.valor, ultimo.valorPago, ultimo.nPrestacoes))}>
              🖨️ Imprimir bilhete
            </button>
            <button className="c-btn c-btn-linha c-btn-peq" style={{ flex: 1 }}
              onClick={() => void downloadPdf(`Bilhete ${ultimo.codigo}`, bilheteHtml(ultimo.codigo, ultimo.nome, ultimo.valor, ultimo.valorPago, ultimo.nPrestacoes), `Bilhete-${ultimo.codigo}.pdf`)}>
              ⬇️ PDF
            </button>
          </div>
          <p className="c-sub" style={{ margin: "6px 0 0" }}>Pode vender logo o seguinte — os campos ficaram limpos.</p>
        </div>
      )}
    </Modal>
  );
}

/* ============ Lista de entradas ============ */
function ListaEntradas({ ev, onClose }: { ev: EventoRow; onClose: () => void }) {
  const { user, toast } = useSession();
  const utils = trpc.useUtils();
  const emp = useEmpresa();
  const [busca, setBusca] = useState("");
  const [editBil, setEditBil] = useState<{ id: number; codigo: string; nomePessoa: string; telefone: string | null } | null>(null);
  const [prestBil, setPrestBil] = useState<{ id: number; codigo: string; nomePessoa: string; valor: number; valorPago: number; nPrestacoes: number } | null>(null);
  const q = trpc.eventos.bilhetes.useQuery({ usuarioId: user?.id ?? 0, eventoId: ev.id }, { enabled: !!user, refetchInterval: 10000 });
  const anular = trpc.eventos.anularBilhete.useMutation({
    onSuccess: () => { utils.eventos.bilhetes.invalidate(); utils.eventos.listar.invalidate(); toast("Bilhete anulado — pagamento estornado"); },
    onError: (e) => toast("⚠️ " + e.message),
  });
  // corrigir o nome do titular: só Admin ou autorizado por ele
  const podeNomes = user?.perfil === "Admin" || !!user?.podeEditarNomes;
  const itens = (q.data?.itens ?? []).filter((b) =>
    busca === "" || b.nomePessoa.toLowerCase().includes(busca.toLowerCase()) || b.codigo.toLowerCase().includes(busca.toLowerCase()));
  const pagos = itens.filter((b) => b.status === "Pago");
  const veTudo = q.data?.veTudo ?? false;
  const saldoDe = (b: { valor: number; valorPago?: number | null }) => Math.max(0, Math.round((b.valor - (b.valorPago ?? b.valor)) * 100) / 100);
  const recebido = pagos.reduce((a, b) => a + Math.min(b.valorPago ?? b.valor, b.valor), 0);
  const emAberto = pagos.reduce((a, b) => a + saldoDe(b), 0);
  const nEmPrest = pagos.filter((b) => saldoDe(b) > 0.009).length;

  const listaHtml = () => {
    const linhas = pagos.map((b, i) => {
      const s = saldoDe(b);
      return `<tr${s > 0.009 ? ' style="background:#fff3cd"' : ""}>
      <td style="padding:4px;border:1px solid #999;text-align:center">${i + 1}</td>
      <td style="padding:4px;border:1px solid #999">${b.codigo}</td>
      <td style="padding:4px;border:1px solid #999">${b.nomePessoa}</td>
      <td style="padding:4px;border:1px solid #999">${b.telefone ?? "—"}</td>
      <td style="padding:4px;border:1px solid #999;text-align:center">${b.tipo}</td>
      <td style="padding:4px;border:1px solid #999;text-align:right">${mt(b.valor)}</td>
      <td style="padding:4px;border:1px solid #999;text-align:right">${mt(Math.min(b.valorPago ?? b.valor, b.valor))}</td>
      <td style="padding:4px;border:1px solid #999;text-align:right;${s > 0.009 ? "font-weight:bold;color:#b3261e" : ""}">${s > 0.009 ? mt(s) : "—"}</td>
      <td style="padding:4px;border:1px solid #999">${b.metodo ?? "—"}</td>
      <td style="padding:4px;border:1px solid #999">${b.vendedorNome}</td>
    </tr>`;}).join("");
    return `
      <h2 style="margin:0 0 2px;color:#1F4E79">${emp?.nome ?? "CAMI'S EVENTOS"}</h2>
      <div style="font-size:9pt;color:#555">${[`NUIT: ${emp.nuit}`, emp.local, `${emp.tel1} · ${emp.tel2}`].filter(Boolean).join(" · ")}</div>
      <hr style="border:none;border-top:2px solid #1F4E79;margin:6px 0 10px" />
      <h3 style="margin:0 0 2px">Lista de entradas — ${ev.nome}</h3>
      <p style="font-size:9pt;color:#555">🗓 ${dataBR(ev.dataEvento)}${ev.horaInicio ? ` · ${ev.horaInicio}` : ""}${ev.local ? ` · ${ev.local}` : ""} · ${pagos.length} entrada(s)${veTudo ? ` · total: ${mt(pagos.reduce((a, b) => a + b.valor, 0))}` : " (as minhas vendas)"}</p>
      <table style="border-collapse:collapse;width:100%;font-size:9pt">
        <tr style="background:#1F4E79;color:#fff">
          <th style="padding:4px;border:1px solid #999">#</th>
          <th style="padding:4px;border:1px solid #999;text-align:left">Bilhete</th>
          <th style="padding:4px;border:1px solid #999;text-align:left">Nome</th>
          <th style="padding:4px;border:1px solid #999;text-align:left">Telefone</th>
          <th style="padding:4px;border:1px solid #999">Tipo</th>
          <th style="padding:4px;border:1px solid #999">Valor</th>
          <th style="padding:4px;border:1px solid #999">Pago</th>
          <th style="padding:4px;border:1px solid #999">Falta</th>
          <th style="padding:4px;border:1px solid #999;text-align:left">Método</th>
          <th style="padding:4px;border:1px solid #999;text-align:left">Vendedor</th>
        </tr>${linhas}
      </table>
      ${emAberto > 0.009 ? `<p style="font-size:9pt;color:#8a5a00;margin-top:6px">🧩 ${nEmPrest} bilhete(s) em prestações — a faltar <b>${mt(emAberto)}</b> (último dia de pagamento: ${dataBR(ev.dataEvento)}, dia do evento). Sem quitação total o cliente não entra.</p>` : ""}`;
  };

  return (
    <Modal onClose={onClose}>
      <h3>👥 Entradas — {ev.nome}</h3>
      <p className="c-sub">{veTudo
        ? `${pagos.length} bilhete(s) · recebido ${mt(recebido)}${emAberto > 0.009 ? ` · 🧩 em aberto ${mt(emAberto)} (${nEmPrest} em prestações)` : ""}`
        : "A mostrar apenas as SUAS vendas."}</p>
      <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
        <input className="c-input" style={{ flex: 1 }} placeholder="🔍 Buscar por nome ou código…" value={busca} onChange={(e) => setBusca(e.target.value)} />
        <button className="c-btn c-btn-linha c-btn-peq" title="Imprimir a lista de entradas"
          onClick={() => printDoc(`Entradas ${ev.codigo} — ${ev.nome}`, listaHtml())}>🖨️</button>
        <button className="c-btn c-btn-linha c-btn-peq" title="Baixar a lista em PDF A4"
          onClick={() => void downloadPdf(`Entradas ${ev.codigo} — ${ev.nome}`, listaHtml(), `Entradas-${ev.codigo}.pdf`)}>⬇️</button>
      </div>
      {q.isLoading && <Vazio icon="⏳">A carregar…</Vazio>}
      {!q.isLoading && itens.length === 0 && <Vazio icon="🎟">Sem bilhetes{busca ? " com essa busca" : ""}.</Vazio>}
      <div style={{ maxHeight: "46vh", overflowY: "auto" }}>
        {itens.map((b) => (
          <div key={b.id} className="c-linha" style={{ opacity: b.status === "Anulado" ? 0.55 : 1, flexWrap: "wrap", rowGap: 4 }}>
            <div className="grow">
              <div className="tit" style={{ fontSize: 13 }}>
                {b.status === "Anulado" && "✕ "}{b.nomePessoa} {b.tipo === "VIP" && "⭐"}
              </div>
              <div className="det">
                {b.codigo} · {b.metodo ?? "—"}{b.telefone ? ` · ${b.telefone}` : ""} · {horaBR(b.criadoEm)}
                {veTudo ? ` · vendido por ${b.vendedorNome}` : ""}
                {b.status === "Anulado" && b.anuladoPor ? ` · anulado por ${b.anuladoPor}` : ""}
              </div>
              {b.status === "Pago" && saldoDe(b) > 0.009 && (
                <div style={{ fontSize: 11, fontWeight: 800, color: "#8a5a00", background: "#fff3cd", display: "inline-block", padding: "1px 8px", borderRadius: 12, marginTop: 2 }}>
                  🧩 EM PRESTAÇÕES{b.nPrestacoes > 1 ? ` ${b.nPrestacoes}×` : ""} — pago {mt(Math.min(b.valorPago ?? 0, b.valor))} · falta {mt(saldoDe(b))} · limite {diaBR(ev.dataEvento)}
                </div>
              )}
              {b.usadoEm && (
                <div style={{ fontSize: 11, fontWeight: 800, color: "#1a7a3c", background: "#e8f7ee", display: "inline-block", padding: "1px 8px", borderRadius: 12, marginTop: 2 }}>
                  ✔ ENTROU {new Date(b.usadoEm).toLocaleString("pt-PT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}{b.usadoPor ? ` · à porta: ${b.usadoPor}` : ""}
                </div>
              )}
            </div>
            <div className="fim" style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <b style={{ color: b.status === "Anulado" ? "#999" : "var(--roxo)" }}>{mt(b.valor)}</b>
              {b.status === "Pago" && saldoDe(b) > 0.009 && (
                <button className="c-btn c-btn-verde c-btn-peq"
                  title={`Receber prestação — falta ${mt(saldoDe(b))} (limite: ${diaBR(ev.dataEvento)}, dia do evento)`}
                  onClick={() => setPrestBil({ id: b.id, codigo: b.codigo, nomePessoa: b.nomePessoa, valor: b.valor, valorPago: Math.min(b.valorPago ?? 0, b.valor), nPrestacoes: b.nPrestacoes ?? 1 })}>
                  💰
                </button>
              )}
              {b.status === "Pago" && (
                <>
                  <button className="c-btn c-btn-linha c-btn-peq"
                    title="Reemitir o bilhete (imprimir) — sai com o nome actual, o saldo actualizado e o MESMO código de barras"
                    onClick={() => printDoc(`Bilhete ${b.codigo}`, bilheteHtmlDoc(emp, ev, b))}>
                    🖨️
                  </button>
                  <button className="c-btn c-btn-linha c-btn-peq"
                    title="Reemitir o bilhete em PDF — sai com o nome actual, o saldo actualizado e o MESMO código de barras"
                    onClick={() => void downloadPdf(`Bilhete ${b.codigo}`, bilheteHtmlDoc(emp, ev, b), `Bilhete-${b.codigo}.pdf`)}>
                    ⬇️
                  </button>
                </>
              )}
              {podeNomes && b.status === "Pago" && (
                <button className="c-btn c-btn-linha c-btn-peq" title="Corrigir o nome do titular (só Admin ou autorizado)"
                  onClick={() => setEditBil({ id: b.id, codigo: b.codigo, nomePessoa: b.nomePessoa, telefone: b.telefone })}>
                  ✏️
                </button>
              )}
              {veTudo && b.status === "Pago" && (
                <button className="c-btn c-btn-perigo c-btn-peq" title="Anular bilhete (estorna o pagamento)"
                  disabled={anular.isPending}
                  onClick={() => { if (confirm(`Anular o bilhete ${b.codigo} de ${b.nomePessoa}? O pagamento será estornado no Financeiro.`)) anular.mutate({ usuarioId: user!.id, bilheteId: b.id }); }}>
                  ✕
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
      {editBil && user && (
        <EditarTitular
          bil={editBil} usuarioId={user.id} ev={ev}
          onClose={() => setEditBil(null)}
          onGuardado={() => { setEditBil(null); utils.eventos.bilhetes.invalidate(); }}
        />
      )}
      {prestBil && user && (
        <PagarPrestacao
          bil={prestBil} usuarioId={user.id} ev={ev}
          onClose={() => setPrestBil(null)}
          onPago={() => { utils.eventos.bilhetes.invalidate(); utils.eventos.listar.invalidate(); utils.eventos.minhasVendas.invalidate(); }}
        />
      )}
    </Modal>
  );
}

/* ============ Receber uma prestação de um bilhete ============ */
function PagarPrestacao({ bil, usuarioId, ev, onClose, onPago }: {
  bil: { id: number; codigo: string; nomePessoa: string; valor: number; valorPago: number; nPrestacoes: number };
  usuarioId: number;
  ev: EventoRow;
  onClose: () => void;
  onPago: () => void;
}) {
  const { toast } = useSession();
  const emp = useEmpresa();
  const saldo = Math.max(0, Math.round((bil.valor - bil.valorPago) * 100) / 100);
  const [valor, setValor] = useState(saldo);
  const [metodo, setMetodo] = useState("Dinheiro");
  const [quitou, setQuitou] = useState(false);
  const prazoAberto = hoje() <= ev.dataEvento;

  const pagar = trpc.eventos.pagarPrestacao.useMutation({
    onSuccess: (r) => {
      onPago();
      if (r.quitado) { setQuitou(true); toast(`✅ Bilhete ${r.codigo} QUITADO — já dá entrada à porta!`); }
      else { toast(`💰 Prestação recebida — falta ${mt(r.saldo)}`); onClose(); }
    },
    onError: (e) => toast("⚠️ " + e.message),
  });

  if (quitou) {
    const doc = bilheteHtmlDoc(emp, ev, { codigo: bil.codigo, nomePessoa: bil.nomePessoa, tipo: "Normal", valor: bil.valor, valorPago: bil.valor });
    return (
      <Modal onClose={onClose}>
        <h3>✅ Bilhete {bil.codigo} quitado!</h3>
        <p className="c-sub">
          <b>{bil.nomePessoa}</b> completou o pagamento ({mt(bil.valor)}). O bilhete já dá direito a entrada —
          reemita-o agora, se precisar de o entregar quitado (o código de barras mantém-se).
        </p>
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <button className="c-btn c-btn-linha" style={{ flex: 1 }} onClick={() => printDoc(`Bilhete ${bil.codigo}`, doc)}>🖨️ Imprimir</button>
          <button className="c-btn c-btn-linha" style={{ flex: 1 }} onClick={() => void downloadPdf(`Bilhete ${bil.codigo}`, doc, `Bilhete-${bil.codigo}.pdf`)}>⬇️ PDF</button>
        </div>
        <button className="c-btn c-btn-prim c-btn-bloco" style={{ marginTop: 10 }} onClick={onClose}>✅ Concluído</button>
      </Modal>
    );
  }

  return (
    <Modal onClose={onClose}>
      <h3>💰 Prestação — {bil.codigo}</h3>
      <p className="c-sub">
        <b>{bil.nomePessoa}</b> · bilhete de {mt(bil.valor)}{bil.nPrestacoes > 1 ? ` em ${bil.nPrestacoes} prestações` : ""}<br />
        Já pago: <b>{mt(bil.valorPago)}</b> · falta: <b style={{ color: "var(--vermelho-c)" }}>{mt(saldo)}</b><br />
        Último dia de pagamento: <b>{diaBR(ev.dataEvento)}</b> (dia do evento) — na entrada não se aceita pagamento.
      </p>
      {!prazoAberto && (
        <p className="c-sub" style={{ background: "#fdecea", borderRadius: 8, padding: 8, color: "#b3261e" }}>
          ⛔ O prazo terminou (o evento foi em {diaBR(ev.dataEvento)}). Este bilhete já não pode ser quitado nem dá entrada.
        </p>
      )}
      <label className="c-label">Valor desta prestação (MZN) *</label>
      <MoneyInput value={valor} onChange={setValor} />
      {valor > saldo && <p className="c-sub" style={{ color: "var(--vermelho-c)" }}>O valor é maior que o saldo em falta ({mt(saldo)}).</p>}
      <label className="c-label" style={{ marginTop: 8 }}>Método de pagamento</label>
      <select className="c-select" value={metodo} onChange={(e) => setMetodo(e.target.value)}>
        {METODOS_PAGAMENTO.map((m) => <option key={m} value={m}>{m}</option>)}
      </select>
      <button className="c-btn c-btn-verde c-btn-bloco" style={{ marginTop: 12 }}
        disabled={pagar.isPending || !(valor > 0) || valor > saldo || !prazoAberto}
        onClick={() => pagar.mutate({ usuarioId, bilheteId: bil.id, valor, metodo })}>
        {pagar.isPending ? "A registar…" : valor >= saldo - 0.009 ? `✅ Receber ${mt(valor)} e QUITAR o bilhete` : `💰 Receber ${mt(valor)} (ficam ${mt(saldo - valor)})`}
      </button>
    </Modal>
  );
}

/* ============ Corrigir o titular do bilhete (só Admin ou autorizado por ele) ============ */
function EditarTitular({ bil, usuarioId, ev, onClose, onGuardado }: {
  bil: { id: number; codigo: string; nomePessoa: string; telefone: string | null; tipo?: string; valor?: number };
  usuarioId: number;
  ev: EventoRow;
  onClose: () => void;
  onGuardado: () => void;
}) {
  const { toast } = useSession();
  const utils = trpc.useUtils();
  const emp = useEmpresa();
  const [nome, setNome] = useState(bil.nomePessoa);
  const [tel, setTel] = useState(bil.telefone ?? "");
  // depois de guardar: oferece a REEMISSÃO do bilhete com o nome corrigido (mesmo código de barras)
  const [corrigido, setCorrigido] = useState<string | null>(null);
  const guardar = trpc.eventos.editarBilhete.useMutation({
    onSuccess: (r) => {
      utils.eventos.bilhetes.invalidate(); utils.eventos.listar.invalidate();
      setCorrigido(nome.trim());
      toast(`✏️ Bilhete ${r.codigo} corrigido — o Financeiro acompanha o novo nome`);
    },
    onError: (e) => toast("⚠️ " + e.message),
  });

  if (corrigido) {
    const doc = bilheteHtmlDoc(emp, ev, {
      codigo: bil.codigo, nomePessoa: corrigido,
      tipo: bil.tipo ?? "Normal", valor: bil.valor ?? 0,
    });
    return (
      <Modal onClose={onGuardado}>
        <h3>✅ Titular corrigido — {bil.codigo}</h3>
        <p className="c-sub">
          O bilhete passa a sair em nome de <b>{corrigido}</b>. Reemita-o agora, se precisar de o entregar de novo
          — o <b>código de barras mantém-se o mesmo</b> ({bil.codigo}), por isso a validação à porta continua a reconhecê-lo
          e a regra «só entra uma vez» não é afectada.
        </p>
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <button className="c-btn c-btn-linha" style={{ flex: 1 }}
            onClick={() => printDoc(`Bilhete ${bil.codigo}`, doc)}>
            🖨️ Imprimir
          </button>
          <button className="c-btn c-btn-linha" style={{ flex: 1 }}
            onClick={() => void downloadPdf(`Bilhete ${bil.codigo}`, doc, `Bilhete-${bil.codigo}.pdf`)}>
            ⬇️ PDF
          </button>
        </div>
        <button className="c-btn c-btn-prim c-btn-bloco" style={{ marginTop: 10 }} onClick={onGuardado}>
          ✅ Concluído
        </button>
      </Modal>
    );
  }

  return (
    <Modal onClose={onClose}>
      <h3>✏️ Corrigir titular — {bil.codigo}</h3>
      <p className="c-sub">Correcção do nome da pessoa que entra com este bilhete (ex.: erro de digitação na venda). O nome do cliente no Financeiro é actualizado junto.</p>
      <label className="c-label">Nome do titular *</label>
      <input className="c-input" value={nome} onChange={(e) => setNome(e.target.value)} autoFocus />
      <label className="c-label" style={{ marginTop: 10 }}>Telefone (opcional)</label>
      <input className="c-input" placeholder="Ex.: 84 000 0000" value={tel} onChange={(e) => setTel(e.target.value)} />
      <button className="c-btn c-btn-prim c-btn-bloco" style={{ marginTop: 14 }}
        disabled={guardar.isPending || nome.trim().length < 2}
        onClick={() => guardar.mutate({ usuarioId, bilheteId: bil.id, nomePessoa: nome.trim(), telefone: tel.trim() || undefined })}>
        {guardar.isPending ? "A guardar…" : "💾 Guardar correcção"}
      </button>
    </Modal>
  );
}

/* ============ Validar entrada à porta (scanner de código de barras) ============ */
function ValidarEntrada({ onClose }: { onClose: () => void }) {
  const { user, toast } = useSession();
  const [codigo, setCodigo] = useState("");
  const [res, setRes] = useState<Record<string, unknown> | null>(null);
  const validar = trpc.eventos.validarCodigo.useMutation({
    onSuccess: (r) => { setRes(r as unknown as Record<string, unknown>); setCodigo(""); },
    onError: (e) => toast("⚠️ " + e.message),
  });
  const ler = () => {
    const c = codigo.trim();
    if (c.length < 3 || !user) return;
    validar.mutate({ usuarioId: user.id, codigo: c, marcar: true });
  };

  const cor = !res ? "#888"
    : res.encontrado === false ? "#b3261e"
    : res.resultado === "entrou" ? "#1a7a3c"
    : res.resultado === "valido" ? "#1a7a3c"
    : "#b3261e";
  const titulo = !res ? ""
    : res.encontrado === false ? "⛔ BILHETE NÃO ENCONTRADO"
    : res.resultado === "entrou" ? "✅ ENTRADA AUTORIZADA"
    : res.resultado === "valido" ? "✅ BILHETE VÁLIDO"
    : res.resultado === "ja_entrou" ? "⛔ JÁ ENTROU — BILHETE REUTILIZADO!"
    : res.resultado === "por_pagar" ? "⛔ SEM ENTRADA — PAGAMENTO INCOMPLETO"
    : "⛔ BILHETE ANULADO";

  return (
    <Modal onClose={onClose}>
      <h3>🛡 Validar entrada à porta</h3>
      <p className="c-sub">
        Aponte o <b>scanner de código de barras</b> para o bilhete (ou escreva o código) e prima Enter.
        O sistema identifica o DONO e regista a entrada — um bilhete só entra UMA vez.
      </p>
      <input className="c-input" style={{ fontSize: 18, textAlign: "center", letterSpacing: 2, textTransform: "uppercase" }}
        placeholder="BL-0001" value={codigo}
        onChange={(e) => setCodigo(e.target.value.toUpperCase())}
        onKeyDown={(e) => { if (e.key === "Enter") ler(); }}
        autoFocus />
      <button className="c-btn c-btn-prim c-btn-bloco" style={{ marginTop: 10 }}
        disabled={validar.isPending || codigo.trim().length < 3} onClick={ler}>
        {validar.isPending ? "A validar…" : "🔍 Validar e registar entrada"}
      </button>

      {res && (
        <div className="c-card" style={{ marginTop: 12, border: `3px solid ${cor}`, background: cor + "14", textAlign: "center" }}>
          <b style={{ fontSize: 16, color: cor }}>{titulo}</b>
          {!!res.encontrado && (
            <div style={{ marginTop: 8, fontSize: 14 }}>
              <div style={{ fontSize: 20, fontWeight: 800 }}>{String(res.nomePessoa)}</div>
              <div className="c-sub" style={{ fontSize: 12 }}>
                {String(res.codigo)} · {res.tipo === "VIP" ? "⭐ VIP" : "🎟 Normal"} · {String(res.evento)}
                {res.telefone ? ` · ${String(res.telefone)}` : ""}
              </div>
              {!!res.inclui && <div style={{ fontSize: 12.5, marginTop: 4 }}>📋 <b>Inclui:</b> {String(res.inclui)}</div>}
              {res.resultado === "ja_entrou" && (
                <div style={{ marginTop: 6, color: "#b3261e", fontWeight: 700, fontSize: 12.5 }}>
                  Este bilhete já foi usado {res.usadoEm ? `em ${new Date(String(res.usadoEm)).toLocaleString("pt-PT")}` : ""}{res.usadoPor ? ` (à porta: ${String(res.usadoPor)})` : ""} — possível CÓPIA!
                </div>
              )}
              {res.resultado === "anulado" && (
                <div style={{ marginTop: 6, color: "#b3261e", fontWeight: 700, fontSize: 12.5 }}>
                  Este bilhete foi ANULADO — não deixe entrar.
                </div>
              )}
              {res.resultado === "por_pagar" && (
                <div style={{ marginTop: 6, color: "#b3261e", fontWeight: 700, fontSize: 12.5 }}>
                  🧩 Bilhete em prestações: pago {mt(Number(res.valorPago ?? 0))} de {mt(Number(res.valor ?? 0))} — <b>falta {mt(Number(res.saldo ?? 0))}</b>.<br />
                  O último dia de pagamento era o dia do evento — <b>à porta não se aceita pagamento</b>. Sem quitação total, o cliente não entra.
                </div>
              )}
            </div>
          )}
          <button className="c-btn c-btn-linha c-btn-peq" style={{ marginTop: 10 }} onClick={() => setRes(null)}>
            Ler o próximo bilhete →
          </button>
        </div>
      )}
    </Modal>
  );
}
