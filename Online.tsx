import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { useSession } from "@/lib/session";
import { mt, diaBR } from "@/lib/fmt";
import { Modal, Vazio, Voltar } from "@/components/bits";
import { waLink } from "@/lib/loja";
import { useEmpresa } from "@/lib/empresa";
import { printDoc, comandaHtml } from "@/lib/docprint";

const FILTROS = ["Activos", "Pendente", "Comprovativo Enviado", "Aguarda Consumo", "Confirmado", "Em Preparo", "Pronto", "Em Entrega", "Todos"] as const;

type Resumo = {
  id: number; codigo: string; clienteNome: string; clienteTelefone: string;
  tipo: "Local" | "Delivery" | "TakeAway" | "Reserva"; mesa: string | null;
  endereco: string | null; dataAgendada: string | null; area?: string | null;
  itens: Array<{ nome: string; qtd: number; precoUnit: number; total: number; personalizado?: boolean; obs?: string }>;
  subtotal: number; taxaEntrega: number; total: number; adiant: number;
  metodoPagamento?: string | null;
  horaAgendada?: string | null; pessoas?: number | null;
  vindaConfirmada?: boolean | null;
  braaiModalidade?: string | null; braaiTraz?: string | null; criancasMenores?: number | null;
  atualizadoPor?: string | null;
  entregadorNome?: string | null; entregadorTel?: string | null;
  status: string; tempoEstimado: number | null; inicioEstimado: string | null; fimEstimado: string | null;
  atrasoNotificado: string | Date | null;
  proposta: { removidos: number[]; adicionados: Array<{ nome: string; qtd: number; precoUnit: number; total: number }>; itensOriginais?: Array<{ nome: string; qtd: number; precoUnit: number; total: number }>; criadoPor: string; criadoEm: string; respondidaEm?: string | null } | null;
  extras: Array<{ descricao: string; detalhes?: string; qtd: number; preco: number; cotado: boolean; cotadoPor?: string; aceite?: boolean | null }> | null;
  temComprovativo: boolean; criadoEm: string | Date;
};

type ExtrasOnline = NonNullable<Resumo["extras"]>;

export default function Online({ voltar, semVoltar }: { voltar: () => void; semVoltar?: boolean }) {
  const { user, toast } = useSession();
  const [filtro, setFiltro] = useState<(typeof FILTROS)[number]>("Activos");
  const [sel, setSel] = useState<number | null>(null);

  const lista = trpc.online.list.useQuery({ usuarioId: user?.id ?? 0 }, {
    enabled: !!user, refetchInterval: 10000,
  });

  const chipCor = (s: string) =>
    s === "Cancelado" ? "c-chip-vermelho"
      : ["Entregue", "Concluído"].includes(s) ? "c-chip-cinza"
        : s === "Pronto" ? "c-chip-verde"
          : s === "Pendente" ? "c-chip-amarelo" : "c-chip-azul";

  const dados = (lista.data ?? []) as Resumo[];
  const filtrados = dados.filter((p) =>
    filtro === "Todos" ? true
      : filtro === "Activos" ? !["Entregue", "Concluído", "Cancelado"].includes(p.status)
        : p.status === filtro);

  const nNovos = dados.filter((p) => p.status === "Comprovativo Enviado").length;
  const nAtrasados = dados.filter((p) => p.status === "Em Preparo" && p.atrasoNotificado).length;

  return (
    <div>
      {!semVoltar && <Voltar onClick={voltar} />}
      <div className="c-titulo">🛎️ Pedidos Online</div>
      {nNovos > 0 && (
        <div className="c-card" style={{ background: "#fdf3dd", fontWeight: 700 }}>
          ⚠️ {nNovos} {nNovos === 1 ? "pedido com comprovativo" : "pedidos com comprovativos"} à espera de confirmação de pagamento!
        </div>
      )}
      {nAtrasados > 0 && (
        <div className="c-card" style={{ background: "#fde3e3", fontWeight: 700, color: "var(--vermelho-c)" }}>
          🚨 {nAtrasados} {nAtrasados === 1 ? "pedido ATRASADO" : "pedidos ATRASADOS"} — entrega/conclusão urgente!
        </div>
      )}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
        {FILTROS.map((f) => (
          <button key={f} className={`c-btn c-btn-peq ${filtro === f ? "c-btn-prim" : "c-btn-cinza"}`} onClick={() => setFiltro(f)}>
            {f}
          </button>
        ))}
      </div>

      {lista.isLoading && <Vazio icon="⏳">A carregar…</Vazio>}
      {filtrados.length === 0 && !lista.isLoading && <Vazio icon="🛎️">Sem pedidos online neste estado.</Vazio>}

      {filtrados.map((p) => (
        <button key={p.id} className="c-menu-btn" onClick={() => setSel(p.id)} style={{ cursor: "pointer" }}>
          <span style={{ fontSize: 21 }}>
            {p.tipo === "Delivery" ? "🛵" : p.tipo === "TakeAway" ? "🛍️" : p.tipo === "Reserva" ? (p.braaiModalidade ? "🔥" : "📅") : "🍽️"}
          </span>
          <span style={{ flex: 1 }}>
            {p.codigo} — {p.clienteNome}
            <small>
              {p.braaiModalidade ? "Braai" : p.tipo}{p.mesa ? ` · Mesa ${p.mesa}` : ""}{p.dataAgendada ? ` · 📅 ${diaBR(p.dataAgendada)}` : ""}{p.area ? ` · 🪑 ${p.area}` : ""} · {mt(p.total)}
              {p.temComprovativo ? " · 📎" : ""}
              {p.proposta ? (p.proposta.respondidaEm ? " · ✅ proposta respondida" : " · ⚠️ proposta enviada") : ""}
              {(p.extras ?? []).some((e) => !e.cotado) ? " · ✳️ cotação pendente" : ""}
              {p.status === "Em Preparo" && p.fimEstimado ? ` · ⏱ ${p.fimEstimado}` : ""}
              {p.status === "Em Preparo" && p.atrasoNotificado ? " · 🚨 ATRASADO" : ""}
            </small>
          </span>
          <span className={`c-chip ${chipCor(p.status)}`}>{p.status}</span>
        </button>
      ))}

      {sel !== null && <Detalhe id={sel} onClose={() => setSel(null)} toast={toast} />}
    </div>
  );
}

/* ============ DETALHE + ACÇÕES (por fase e por papel) ============ */
function Detalhe({ id, onClose, toast }: { id: number; onClose: () => void; toast: (m: string) => void }) {
  const { user } = useSession();
  const utils = trpc.useUtils();
  const emp = useEmpresa();
  const q = trpc.online.get.useQuery({ usuarioId: user?.id ?? 0, id }, { enabled: !!user });
  const [tempo, setTempo] = useState(30);
  const [taxa, setTaxa] = useState<string>("");
  const [msgManual, setMsgManual] = useState("");
  const [waMsg, setWaMsg] = useState<{ tel: string; msg: string } | null>(null);
  const [verComprovativo, setVerComprovativo] = useState(false);
  const [propOpen, setPropOpen] = useState(false);
  const [editTaxa, setEditTaxa] = useState(false);

  const p = q.data;
  const perfil = user?.perfil ?? "Vendedor";
  const isAdmin = perfil === "Admin";
  const ehCozinha = perfil === "Cozinha";
  // cozinha vê APENAS os pratos a preparar (nunca bebidas do bar nem valores)
  const prods = trpc.produtos.list.useQuery({ leve: true }, { staleTime: 120000 });
  const nomesCozinha = new Set((prods.data ?? []).filter((x) => x.tipo === "Refeição").map((x) => x.nome));
  const itensVer = p && ehCozinha ? p.itens.filter((i) => i.personalizado || nomesCozinha.has(i.nome)) : p?.itens;
  // Pendente/Comprovativo/Confirmado → caixa+gerente | Em Preparo/Pronto → cozinha | Entrega/Concluído → caixa
  const podeCaixa = ["Admin", "Gestor", "Vendedor"].includes(perfil);
  const podeCozinha = ["Admin", "Gestor", "Cozinha"].includes(perfil);
  const podeCancelar = perfil === "Admin"; // só o administrador pode eliminar/cancelar pedidos

  const ok = (r: { wa?: string; mensagem?: string }) => {
    utils.online.list.invalidate(); utils.online.get.invalidate();
    if (p && r.mensagem) setWaMsg({ tel: p.clienteTelefone, msg: r.mensagem });
  };
  const err = (e: { message: string }) => toast("⚠️ " + e.message);

  const confirmar = trpc.online.confirmarPagamento.useMutation({ onSuccess: ok, onError: err });
  const ajTaxa = trpc.online.ajustarTaxa.useMutation({
    onSuccess: (r) => {
      utils.online.list.invalidate(); utils.online.get.invalidate();
      setEditTaxa(false); setTaxa("");
      toast("✅ Taxa de entrega definida: " + mt(r.taxaEntrega) + " (paga ao entregador na entrega)");
    },
    onError: err,
  });
  const preparo = trpc.online.iniciarPreparo.useMutation({ onSuccess: ok, onError: err });
  const pronto = trpc.online.marcarPronto.useMutation({ onSuccess: ok, onError: err });
  const entrega = trpc.online.saiuEntrega.useMutation({ onSuccess: ok, onError: err });
  const concluir = trpc.online.concluir.useMutation({ onSuccess: ok, onError: err });
  const cancelar = trpc.online.cancelar.useMutation({ onSuccess: ok, onError: err });
  const abrir = trpc.online.abrirPedido.useMutation({ onSuccess: ok, onError: err });
  const retirarProp = trpc.online.retirarProposta.useMutation({ onSuccess: ok, onError: err });
  const eliminar = trpc.online.eliminar.useMutation({
    onSuccess: () => { toast("Pedido eliminado"); utils.online.list.invalidate(); onClose(); },
    onError: err,
  });
  const msgM = trpc.online.mensagemManual.useMutation({ onSuccess: (r) => { ok(r); setMsgManual(""); }, onError: err });

  if (!p) return <Modal onClose={onClose}><p className="c-sub">A carregar…</p></Modal>;

  const emAndamento = !["Cancelado", "Entregue", "Concluído"].includes(p.status);

  return (
    <Modal onClose={onClose}>
      <h3>🛎️ {p.codigo} — {p.tipo}{p.mesa ? ` · Mesa ${p.mesa}` : ""}</h3>
      <p className="c-sub">
        {p.clienteNome} · 📞 +258 {p.clienteTelefone}
        {p.endereco && <><br />📍 {p.endereco}</>}
        {p.lat != null && p.lng != null && (
          <>
            {" "}
            <a href={`https://www.google.com/maps?q=${p.lat},${p.lng}`} target="_blank" rel="noreferrer"
              style={{ color: "var(--roxo)", fontWeight: 700 }}>
              🗺️ Ver no mapa
            </a>
          </>
        )}
        {p.dataAgendada && <><br />📅 Reserva para {diaBR(p.dataAgendada)}{p.area ? <> · 🪑 <b>{p.area}</b></> : null}</>}
        {(p as { braaiModalidade?: string | null }).braaiModalidade && (
          <>
            <br />🔥 <b>BRAAI</b> — {(p as { braaiModalidade?: string | null }).braaiModalidade === "A"
              ? "Completo (cliente traz comida e bebidas)"
              : `Parcial (cliente traz só ${(p as { braaiTraz?: string | null }).braaiTraz === "Comida" ? "comida" : "bebidas"})`}
            {(p as { horaAgendada?: string | null }).horaAgendada && <> · ⏱ entrada às <b>{(p as { horaAgendada?: string | null }).horaAgendada}</b> (5 horas)</>}
            <br /><span className="c-sub">💳 Taxa não consumível paga 100% antecipadamente · 🧒 crianças até 9 anos grátis · piscina/parque à parte · ⚠️ na entrada, confirme o que o cliente trouxe de facto</span>
          </>
        )}
        {p.status === "Em Preparo" && p.atrasoNotificado && (
          <><br /><b style={{ color: "var(--vermelho-c)" }}>🚨 ATRASADO — cliente já recebeu mensagem de desculpas.</b></>
        )}
      </p>

      <div className="c-card" style={{ marginBottom: 10 }}>
        {ehCozinha && <p className="c-sub" style={{ margin: "0 0 6px", fontWeight: 700 }}>👨‍🍳 Só os pratos da cozinha aparecem aqui — as bebidas do bar são tratadas no balcão.</p>}
        {(itensVer ?? []).map((i, k) => (
          <div className="c-linha" key={k}>
            <div className="grow tit">{i.personalizado ? "✳️ " : ""}{i.qtd}× {i.nome}
              {i.obs && <div style={{ fontSize: 11.5, color: "var(--verde-c)", fontWeight: 600 }}>🍽 {i.obs}</div>}
            </div>
            {!ehCozinha && <span>{mt(i.total)}</span>}
          </div>
        ))}
        {ehCozinha && (itensVer ?? []).length === 0 && <p className="c-sub">Este pedido não tem pratos da cozinha.</p>}
        {!ehCozinha && <div className="c-total-linha"><span>Subtotal</span><span>{mt(p.subtotal)}</span></div>}
        {!ehCozinha && p.tipo === "Delivery" && (
          <div className="c-total-linha">
            <span>Taxa de entrega 🛵</span>
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {mt(p.taxaEntrega)}
              {podeCaixa && ["Pendente", "Comprovativo Enviado"].includes(p.status) && (
                <button className="c-btn c-btn-linha c-btn-peq" title="Definir a taxa final conforme o local de entrega (antes do pagamento)"
                  onClick={() => setEditTaxa(!editTaxa)}>
                  ✏️
                </button>
              )}
            </span>
          </div>
        )}
        {p.tipo === "Delivery" && (
          <div className="c-sub" style={{ margin: "-4px 0 6px", fontSize: 11.5 }}>
            Paga <b>ao entregador</b> no momento da entrega — <b>não entra no total</b> a pagar ao restaurante. Mínimo: 100,00 MZN.
          </div>
        )}
        {editTaxa && p.tipo === "Delivery" && (
          <div style={{ margin: "4px 0 8px" }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input className="c-input" type="number" step="0.01" min={100} style={{ width: 110 }}
                placeholder={p.taxaEntrega.toFixed(2)} value={taxa} onChange={(e) => setTaxa(e.target.value)}
                onBlur={() => { const v = +taxa; if (taxa && !isNaN(v)) setTaxa(v.toFixed(2)); }} />
              <button className="c-btn c-btn-prim c-btn-peq" disabled={ajTaxa.isPending || !taxa || +taxa < 100}
                onClick={() => user && ajTaxa.mutate({ usuarioId: user.id, id, taxaEntrega: +taxa })}>
                {ajTaxa.isPending ? "…" : "💾 Guardar taxa"}
              </button>
            </div>
            <div className="c-sub" style={{ fontSize: 11.5, marginTop: 2 }}>Mínimo 100,00 MZN — pode manter ou aumentar consoante a distância do cliente.</div>
          </div>
        )}
        {!ehCozinha && <div className="c-total-linha" style={{ fontSize: 16 }}><span>Total</span><b style={{ color: "var(--roxo)" }}>{mt(p.total)}</b></div>}
        {!ehCozinha && p.tipo === "Reserva" && <div className="c-total-linha"><span>Adiantamento ({p.total > 0 ? Math.round((p.adiant / p.total) * 100) : 50}%)</span><b style={{ color: "var(--verde-c)" }}>{mt(p.adiant)}</b></div>}
      </div>

      {/* 🖨️ impressão da comanda — balcão (tudo) ou cozinha (só pratos) */}
      {user && (
        <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
          <button className="c-btn c-btn-linha c-btn-peq" style={{ flex: 1 }}
            onClick={() => printDoc(`Comanda ${p.codigo}`, comandaHtml({
              titulo: "COMANDA — BALCÃO",
              origem: `${p.codigo} — ${p.tipo}${p.mesa ? ` · Mesa ${p.mesa}` : ""} — ${p.clienteNome}`,
              extra: p.endereco || (p.dataAgendada ? `Reserva: ${diaBR(p.dataAgendada)}` : null),
              itens: p.itens.map((i) => ({ nome: i.nome, qtd: i.qtd, obs: i.obs, personalizado: i.personalizado })),
              emp,
            }))}>
            🖨️ Balcão
          </button>
          <button className="c-btn c-btn-linha c-btn-peq" style={{ flex: 1 }}
            onClick={() => {
              const itensCoz = p.itens.filter((i) => i.personalizado || nomesCozinha.has(i.nome));
              if (itensCoz.length === 0) { toast("Este pedido não tem pratos de cozinha."); return; }
              printDoc(`Comanda Cozinha ${p.codigo}`, comandaHtml({
                titulo: "COMANDA — COZINHA",
                origem: `${p.codigo} — ${p.tipo}${p.mesa ? ` · Mesa ${p.mesa}` : ""} — ${p.clienteNome}`,
                extra: p.endereco || (p.dataAgendada ? `Reserva: ${diaBR(p.dataAgendada)}` : null),
                itens: itensCoz.map((i) => ({ nome: i.nome, qtd: i.qtd, obs: i.obs, personalizado: i.personalizado })),
                emp,
              }));
            }}>
            🍳 Cozinha
          </button>
        </div>
      )}

      {/* proposta de alteração — pendente ou já respondida */}
      {p.proposta && (
        <div className="c-card" style={{
          marginBottom: 10,
          background: p.proposta.respondidaEm ? "#eef3fd" : "#fffaf1",
          border: `1.5px solid ${p.proposta.respondidaEm ? "#7aa5e8" : "#e8a13c"}`,
        }}>
          <b style={{ fontSize: 13.5 }}>
            {p.proposta.respondidaEm ? "✅ Proposta respondida pelo cliente" : "⚠️ Proposta enviada — a aguardar resposta do cliente"}
          </b>
          <div style={{ fontSize: 12.5, marginTop: 4 }}>
            {p.proposta.removidos.length > 0 && (
              <div>❌ Fora de stock: {p.proposta.removidos.map((i) => (p.proposta!.itensOriginais ?? p.itens)[i]?.nome).filter(Boolean).join(", ")}</div>
            )}
            {p.proposta.adicionados.length > 0 && (
              <div>🔄 Substitutos: {p.proposta.adicionados.map((a) => `${a.qtd}× ${a.nome}`).join(", ")}</div>
            )}
            <div className="c-sub" style={{ marginTop: 4 }}>
              por {p.proposta.criadoPor} · {p.proposta.respondidaEm
                ? "o pedido foi actualizado com a resposta do cliente — pode voltar atrás com «Retirar proposta»."
                : "quando o cliente responder, o pedido é actualizado automaticamente."}
            </div>
          </div>
          {/* voltar atrás: retira a proposta e repõe os itens originais do cliente */}
          {["Pendente", "Comprovativo Enviado"].includes(p.status) && user && (
            <button className="c-btn c-btn-linha c-btn-bloco" style={{ marginTop: 8 }}
              disabled={retirarProp.isPending}
              onClick={() => {
                if (window.confirm("Retirar esta proposta? O pedido volta aos itens originais do cliente."))
                  retirarProp.mutate({ usuarioId: user.id, id });
              }}>
              {retirarProp.isPending ? "A retirar…" : "↩️ Retirar proposta (voltar atrás)"}
            </button>
          )}
        </div>
      )}

      {/* itens especiais (✳️) pedidos pelo cliente — cotar preço */}
      {(p.extras ?? []).length > 0 && user && (
        <CotarExtras
          pedidoId={id}
          codigo={p.codigo}
          status={p.status}
          extras={p.extras ?? []}
          usuarioId={user.id}
          onOk={(r) => { ok(r); }}
          onErro={err}
        />
      )}

      {/* avaliação do cliente (estrelas + comentário) */}
      {p.avaliacao && (
        <div className="c-card" style={{ marginBottom: 10, background: "#fdf8e7", border: "1.5px solid #e8c93c" }}>
          <b style={{ fontSize: 13.5 }}>⭐ Avaliação do cliente</b>
          <div style={{ fontSize: 18, color: "#e8a13c", marginTop: 2 }}>
            {"★".repeat(p.avaliacao.estrelas)}{"☆".repeat(5 - p.avaliacao.estrelas)}
          </div>
          {p.avaliacao.comentario && <div className="c-sub" style={{ marginTop: 2 }}>“{p.avaliacao.comentario}”</div>}
        </div>
      )}

      {/* rejeitar itens fora de stock / propor substitutos */}
      {["Pendente", "Comprovativo Enviado"].includes(p.status) && (
        <div style={{ marginBottom: 10 }}>
          <button className="c-btn c-btn-linha c-btn-bloco" onClick={() => setPropOpen(!propOpen)}>
            {propOpen ? "▲ Fechar alteração de itens" : "🔄 Item fora de stock? Rejeitar / propor substitutos…"}
          </button>
          {propOpen && user && (
            <ProporItens
              pedidoId={id}
              tipo={p.tipo}
              itens={p.itens}
              usuarioId={user.id}
              onOk={(r) => { ok(r); setPropOpen(false); }}
              onErro={err}
            />
          )}
        </div>
      )}

      {/* método de pagamento escolhido pelo cliente */}
      {p.metodoPagamento && (
        <p className="c-sub" style={{ background: "var(--lilas)", borderRadius: 8, padding: "6px 10px" }}>
          💳 Método escolhido pelo cliente: <b>{p.metodoPagamento}</b>
          {p.metodoPagamento === "Dinheiro" && " — receber no local antes de confirmar"}
          {p.metodoPagamento === "FNB" && " — em caso de demora na confirmação, o cliente pode ligar 87 458 9150 para flexibilizar"}
        </p>
      )}
      {p.atualizadoPor && (
        <p className="c-sub">👤 Última acção: <b>{p.atualizadoPor}</b></p>
      )}
      {p.entregadorNome && (
        <p className="c-sub">🛵 Entregador: <b>{p.entregadorNome}</b>{p.entregadorTel ? ` · ${p.entregadorTel}` : ""}</p>
      )}

      {/* solicitação de entregador (opcional — o restaurante também pode contactar directamente) */}
      {p.tipo === "Delivery" && ["Confirmado", "Em Preparo", "Pronto"].includes(p.status) && podeCaixa && user && (
        <SolicitarEntregador pedidoId={id} usuarioId={user.id} perfil={user.perfil} onErro={err} />
      )}

      {/* comprovativo — não interessa à cozinha */}
      {!ehCozinha && (p.comprovativo ? (
        <div style={{ marginBottom: 10 }}>
          <button className="c-btn c-btn-linha c-btn-bloco" onClick={() => setVerComprovativo(true)}>
            📎 Ver comprovativo de pagamento
          </button>
        </div>
      ) : (
        <p className="c-sub">{p.metodoPagamento === "Dinheiro"
          ? "💵 Pagamento em dinheiro — sem comprovativo."
          : "⏳ O cliente ainda não enviou o comprovativo."}</p>
      ))}

      {/* 💬 mensagem humana antes/depois do aviso automático de atraso */}
      {emAndamento && ["Confirmado", "Em Preparo", "Pronto", "Em Entrega"].includes(p.status) && (
        <div className="c-card" style={{ marginBottom: 10, background: "#f4eefc" }}>
          <label className="c-label" style={{ marginTop: 0 }}>💬 Mensagem ao cliente (ex.: avisar sobre atraso)</label>
          <textarea className="c-textarea" rows={2} value={msgManual} onChange={(e) => setMsgManual(e.target.value)}
            placeholder="Ex.: Estamos quase a terminar, mais 10 minutinhos. Obrigado pela paciência!" />
          <button className="c-btn c-btn-linha c-btn-bloco" style={{ marginTop: 6 }}
            disabled={msgManual.trim().length < 3 || msgM.isPending}
            onClick={() => user && msgM.mutate({ usuarioId: user.id, id, mensagem: msgManual })}>
            {msgM.isPending ? "A enviar…" : "📨 Enviar mensagem"}
          </button>
          <p className="c-sub" style={{ margin: "6px 0 0" }}>
            Se não escrever nada, 3 minutos após a hora prevista o sistema envia uma mensagem automática de desculpas.
          </p>
        </div>
      )}

      {/* reserva a aguardar o dia do consumo */}
      {p.status === "Aguarda Consumo" && (
        <div className="c-card" style={{ marginBottom: 10, background: "#eef3fd", border: "1.5px solid #7aa5e8" }}>
          <b style={{ fontSize: 13.5 }}>📅 Reserva paga — a aguardar o dia do consumo</b>
          <p className="c-sub" style={{ margin: "4px 0 0" }}>
            {p.dataAgendada ? `Evento: ${diaBR(p.dataAgendada)}. ` : ""}
            O cliente abre o pedido nesse dia (código + telefone, ou pela conta) e o preparo começa nesse momento.
          </p>
          {podeCaixa && (
            <button className="c-btn c-btn-prim c-btn-bloco" style={{ marginTop: 8 }}
              disabled={abrir.isPending}
              onClick={() => user && abrir.mutate({ usuarioId: user.id, id })}>
              {abrir.isPending ? "A abrir…" : "🔓 Abrir pedido agora (cliente chegou)"}
            </button>
          )}
        </div>
      )}

      {/* acções por estado e por papel */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {p.status === "Comprovativo Enviado" && podeCaixa && (
          <button className="c-btn c-btn-verde c-btn-bloco" disabled={confirmar.isPending}
            onClick={() => user && confirmar.mutate({ usuarioId: user.id, id })}>
            ✅ Confirmar pagamento{p.tipo === "Delivery" ? ` — ${mt(p.total)} (taxa de entrega ${mt(p.taxaEntrega)} é paga ao entregador)` : ""}
          </button>
        )}
        {p.status === "Confirmado" && podeCozinha && (
          <>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <label className="c-label" style={{ margin: 0 }}>Tempo estimado:</label>
              <input className="c-input" type="number" min={5} step={5} style={{ width: 100 }}
                value={tempo} onChange={(e) => setTempo(+e.target.value || 30)} />
              <span className="c-sub">min</span>
            </div>
            <button className="c-btn c-btn-prim c-btn-bloco" disabled={preparo.isPending}
              onClick={() => user && preparo.mutate({ usuarioId: user.id, id, tempoEstimado: tempo })}>
              👨‍🍳 Iniciar preparo
            </button>
          </>
        )}
        {p.status === "Em Preparo" && podeCozinha && (
          <button className="c-btn c-btn-verde c-btn-bloco" disabled={pronto.isPending}
            onClick={() => user && pronto.mutate({ usuarioId: user.id, id })}>
            🍽️ Marcar como pronto
          </button>
        )}
        {p.status === "Pronto" && p.tipo === "Delivery" && podeCaixa && (
          <>
            <button className="c-btn c-btn-prim c-btn-bloco" disabled={entrega.isPending}
              onClick={() => user && entrega.mutate({ usuarioId: user.id, id })}>
              🛵 Saiu para entrega
            </button>
            {!p.entregadorNome && (
              <p className="c-sub" style={{ margin: 0, color: "var(--vermelho-c)", fontWeight: 600 }}>
                ⚠️ Obrigatório: registe primeiro o <b>nome e o contacto do entregador</b> no cartão 🛵 Entregador — o cliente precisa de ligar ao entregador para o direccionar.
              </p>
            )}
          </>
        )}
        {(p.status === "Pronto" && p.tipo !== "Delivery") && podeCaixa && (
          <button className="c-btn c-btn-verde c-btn-bloco" disabled={concluir.isPending}
            onClick={() => user && concluir.mutate({ usuarioId: user.id, id })}>
            ✔️ Concluir (levantado)
          </button>
        )}
        {p.status === "Em Entrega" && podeCaixa && (
          <button className="c-btn c-btn-verde c-btn-bloco" disabled={concluir.isPending}
            onClick={() => user && concluir.mutate({ usuarioId: user.id, id })}>
            ✔️ Marcar como entregue
          </button>
        )}
        {emAndamento && podeCancelar && (
          <button className="c-btn c-btn-perigo c-btn-bloco" disabled={cancelar.isPending}
            onClick={() => { if (confirm("Cancelar este pedido? O cliente será notificado.")) user && cancelar.mutate({ usuarioId: user.id, id }); }}>
            ✕ Cancelar pedido
          </button>
        )}
        {isAdmin && (
          <button className="c-btn c-btn-cinza c-btn-bloco" disabled={eliminar.isPending}
            onClick={() => { if (confirm(`ELIMINAR DEFINITIVAMENTE o pedido ${p.codigo}? (limpeza de testes — não pode ser anulado)`)) user && eliminar.mutate({ usuarioId: user.id, id }); }}>
            🗑 Eliminar pedido (Admin)
          </button>
        )}
      </div>

      {/* botão WhatsApp após cada acção */}
      {waMsg && (
        <a href={waLink(waMsg.tel, waMsg.msg)} target="_blank" rel="noreferrer"
          className="c-btn c-btn-verde c-btn-bloco"
          style={{ marginTop: 10, textAlign: "center", textDecoration: "none", display: "block" }}>
          📲 Enviar notificação por WhatsApp ao cliente
        </a>
      )}

      {/* histórico de notificações */}
      {p.notificacoes.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div className="c-titulo" style={{ fontSize: 14 }}>📲 Notificações registadas</div>
          {p.notificacoes.map((n) => (
            <div key={n.id} style={{ fontSize: 12, borderLeft: "3px solid var(--roxo2)", paddingLeft: 8, marginBottom: 6 }}>
              {n.mensagem}
            </div>
          ))}
        </div>
      )}

      {verComprovativo && (
        <Modal onClose={() => setVerComprovativo(false)}>
          <h3>📎 Comprovativo — {p.codigo}</h3>
          {p.comprovativo?.startsWith("data:image") ? (
            <img src={p.comprovativo} alt="comprovativo" style={{ width: "100%", borderRadius: 10 }} />
          ) : (
            <a href={p.comprovativo ?? "#"} download={`comprovativo-${p.codigo}`} className="c-btn c-btn-linha c-btn-bloco"
              style={{ textAlign: "center", display: "block", textDecoration: "none" }}>
              📄 Baixar documento
            </a>
          )}
          <button className="c-btn c-btn-cinza c-btn-bloco" style={{ marginTop: 10 }} onClick={() => setVerComprovativo(false)}>Fechar</button>
        </Modal>
      )}
    </Modal>
  );
}

/* ============ COTAR ITENS ESPECIAIS (✳️) — o restaurante define o preço ============ */
function CotarExtras({ pedidoId, codigo, status, extras, usuarioId, onOk, onErro }: {
  pedidoId: number; codigo: string; status: string; extras: ExtrasOnline; usuarioId: number;
  onOk: (r: { wa?: string; mensagem?: string }) => void;
  onErro: (e: { message: string }) => void;
}) {
  const [precos, setPrecos] = useState<string[]>(extras.map((e) => (e.cotado ? String(e.preco) : "")));
  const [editar, setEditar] = useState(false);
  const mut = trpc.online.cotarExtras.useMutation({
    onSuccess: (r) => { setEditar(false); onOk(r); },
    onError: onErro,
  });

  const porCotar = extras.some((e) => !e.cotado);
  const aguardaCliente = !porCotar && extras.some((e) => e.aceite == null);
  // edição: primeira cotação, ou correcção enquanto o cliente ainda não respondeu
  const podeEditar = (porCotar || (aguardaCliente && editar)) && ["Pendente", "Comprovativo Enviado"].includes(status);
  const totais = extras.map((e, i) => e.qtd * (podeEditar ? (+precos[i] || 0) : e.preco));

  return (
    <div className="c-card" style={{ marginBottom: 10, background: "#f7f1fc", border: "1.5px solid var(--roxo2)" }}>
      <b style={{ fontSize: 13.5 }}>✳️ Itens especiais pedidos pelo cliente</b>
      {extras.map((e, i) => (
        <div key={i} style={{ borderTop: "1px solid #e8dcf0", padding: "7px 0", marginTop: 6 }}>
          <div style={{ fontSize: 13, fontWeight: 700 }}>{e.qtd}× {e.descricao}</div>
          {e.detalhes && <div className="c-sub">📝 {e.detalhes}</div>}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 5 }}>
            {podeEditar ? (
              <>
                <label className="c-label" style={{ margin: 0 }}>Preço unit. (MZN):</label>
                <input className="c-input" type="number" min={0} step="0.01" placeholder="0.00" style={{ width: 120 }}
                  value={precos[i]}
                  onChange={(e) => setPrecos((l) => l.map((v, k) => (k === i ? e.target.value : v)))}
                  onBlur={() => setPrecos((l) => l.map((v, k) => {
                    const n = +v;
                    return k === i && v && !isNaN(n) ? n.toFixed(2) : v;
                  }))} />
                <b style={{ fontSize: 12.5 }}>{mt(totais[i])}</b>
              </>
            ) : (
              <>
                <b>{mt(e.qtd * e.preco)}</b>
                <span className={`c-chip ${e.aceite == null ? "c-chip-amarelo" : e.aceite ? "c-chip-verde" : "c-chip-vermelho"}`} style={{ fontSize: 11 }}>
                  {e.aceite == null ? "⏳ aguarda cliente" : e.aceite ? "✔ aceite" : "✕ recusado"}
                </span>
              </>
            )}
          </div>
        </div>
      ))}
      {podeEditar && (
        <>
          <p className="c-sub" style={{ margin: "8px 0 0" }}>
            O cliente recebe a cotação e <b>aceita ou recusa</b> cada item na página «Acompanhar Pedido».
            Só depois da aceitação é que o pagamento e o preparo avançam.
          </p>
          <button className="c-btn c-btn-prim c-btn-bloco" style={{ marginTop: 8 }}
            disabled={mut.isPending || precos.some((v) => v === "" || +v < 0)}
            onClick={() => mut.mutate({ usuarioId, id: pedidoId, precos: precos.map((v) => +v || 0) })}>
            {mut.isPending ? "A enviar…" : `${porCotar ? "📨 Enviar cotação ao cliente" : "📨 Reenviar cotação corrigida"} (${mt(totais.reduce((a, b) => a + b, 0))})`}
          </button>
          {editar && (
            <button className="c-btn c-btn-cinza c-btn-bloco" style={{ marginTop: 6 }} onClick={() => setEditar(false)}>
              ✕ Cancelar correcção
            </button>
          )}
        </>
      )}
      {aguardaCliente && !editar && (
        <>
          <p className="c-sub" style={{ margin: "8px 0 0" }}>
            ⏳ Cotação enviada — a aguardar que o cliente aceite ou recuse. (Pedido {codigo})
          </p>
          {["Pendente", "Comprovativo Enviado"].includes(status) && (
            <button className="c-btn c-btn-linha c-btn-bloco" style={{ marginTop: 6 }}
              onClick={() => setEditar(true)}>
              ✏️ Corrigir a cotação (voltar atrás)
            </button>
          )}
        </>
      )}
    </div>
  );
}

/* ============ PROPOR ALTERAÇÃO DE ITENS (fora de stock / substitutos) ============ */
function ProporItens({ pedidoId, tipo, itens, usuarioId, onOk, onErro }: {
  pedidoId: number;
  tipo: "Local" | "Delivery" | "TakeAway" | "Reserva";
  itens: Array<{ nome: string; qtd: number; precoUnit: number; total: number; personalizado?: boolean; obs?: string }>;
  usuarioId: number;
  onOk: (r: { wa?: string; mensagem?: string }) => void;
  onErro: (e: { message: string }) => void;
}) {
  const CATS_SEM_DELIVERY = ["Piscina & Parque", "Piscina", "Parque", "Salão"];
  const [remover, setRemover] = useState<number[]>([]);
  const [subs, setSubs] = useState<Array<{ produtoId: number; nome: string; preco: number; qtd: number }>>([]);
  const [prodSel, setProdSel] = useState("");
  const [qtdSel, setQtdSel] = useState(1);
  const produtos = trpc.produtos.list.useQuery({ leve: true }, { staleTime: 120_000 });
  const opcoes = (produtos.data ?? []).filter((p) => tipo !== "Delivery" || !CATS_SEM_DELIVERY.includes(p.categoria));

  const mut = trpc.online.proporItens.useMutation({ onSuccess: onOk, onError: onErro });

  const addSub = () => {
    const pr = opcoes.find((x) => x.id === +prodSel);
    if (!pr) return;
    setSubs((l) => {
      const ex = l.find((x) => x.produtoId === pr.id);
      if (ex) return l.map((x) => (x.produtoId === pr.id ? { ...x, qtd: x.qtd + qtdSel } : x));
      return [...l, { produtoId: pr.id, nome: pr.nome, preco: pr.preco, qtd: qtdSel }];
    });
    setProdSel(""); setQtdSel(1);
  };

  return (
    <div className="c-card" style={{ marginTop: 8, background: "#fdf6ec" }}>
      <div className="c-label" style={{ marginTop: 0 }}>1️⃣ Itens fora de stock (serão retirados da conta):</div>
      {itens.map((i, k) => {
        const on = remover.includes(k);
        return (
          <div className="c-linha" key={k} style={{ padding: "5px 0" }}>
            <div className="grow" style={{ fontSize: 13, textDecoration: on ? "line-through" : "none", opacity: on ? .7 : 1 }}>
              {i.qtd}× {i.nome}
            </div>
            <button className={`c-btn c-btn-peq ${on ? "c-btn-perigo" : "c-btn-cinza"}`}
              onClick={() => setRemover((r) => (on ? r.filter((x) => x !== k) : [...r, k]))}>
              {on ? "❌ Fora de stock" : "Em stock"}
            </button>
          </div>
        );
      })}

      <div className="c-label" style={{ marginTop: 10 }}>2️⃣ Propor substitutos em stock (opcional):</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 64px auto", gap: 6 }}>
        <select className="c-select" value={prodSel} onChange={(e) => setProdSel(e.target.value)}>
          <option value="">— Produto do menu —</option>
          {opcoes.map((o) => <option key={o.id} value={o.id}>{o.nome} ({mt(o.preco)})</option>)}
        </select>
        <input className="c-input" type="number" min={1} value={qtdSel}
          onChange={(e) => setQtdSel(Math.max(1, Math.round(+e.target.value || 1)))} />
        <button className="c-btn c-btn-prim c-btn-peq" disabled={!prodSel} onClick={addSub}>＋</button>
      </div>
      {subs.map((s) => (
        <div className="c-linha" key={s.produtoId} style={{ padding: "5px 0" }}>
          <div className="grow" style={{ fontSize: 13 }}>🔄 {s.qtd}× {s.nome}</div>
          <span style={{ marginRight: 6, fontSize: 12.5 }}>{mt(s.preco * s.qtd)}</span>
          <button className="c-btn c-btn-perigo c-btn-peq" onClick={() => setSubs((l) => l.filter((x) => x.produtoId !== s.produtoId))}>✕</button>
        </div>
      ))}

      <p className="c-sub" style={{ margin: "8px 0 0" }}>
        O cliente recebe uma notificação e <b>aceita ou recusa</b> cada substituto na página «Acompanhar Pedido» — podendo escolher outros produtos. O total é recalculado automaticamente.
      </p>
      <button className="c-btn c-btn-prim c-btn-bloco" style={{ marginTop: 8 }}
        disabled={mut.isPending || (remover.length === 0 && subs.length === 0)}
        onClick={() => mut.mutate({
          usuarioId, id: pedidoId, remover,
          adicionar: subs.map((s) => ({ produtoId: s.produtoId, qtd: s.qtd })),
        })}>
        {mut.isPending ? "A enviar…" : "📨 Enviar proposta ao cliente"}
      </button>
    </div>
  );
}

/* ============ SOLICITAR ENTREGADOR (opcional) ============ */
function SolicitarEntregador({ pedidoId, usuarioId, perfil, onErro }: {
  pedidoId: number; usuarioId: number; perfil: string;
  onErro: (e: { message: string }) => void;
}) {
  const { toast } = useSession();
  const utils = trpc.useUtils();
  const [manualAberto, setManualAberto] = useState(false);
  const [mNome, setMNome] = useState("");
  const [mTel, setMTel] = useState("");
  const q = trpc.entregas.porPedido.useQuery({ usuarioId, pedidoOnlineId: pedidoId }, { refetchInterval: 12000 });
  const solicitar = trpc.entregas.solicitar.useMutation({
    onSuccess: () => { toast("🛵 Solicitação enviada aos entregadores online."); q.refetch(); utils.online.list.invalidate(); },
    onError: onErro,
  });
  const cancelar = trpc.entregas.cancelar.useMutation({
    onSuccess: () => { toast("Entregador cancelado. Pode solicitar outro."); q.refetch(); utils.online.list.invalidate(); },
    onError: onErro,
  });
  const manual = trpc.online.entregadorManual.useMutation({
    onSuccess: (r) => {
      toast(`✅ Entregador registado no pedido: ${r.entregadorNome} (${r.entregadorTel})`);
      setManualAberto(false); setMNome(""); setMTel("");
      utils.online.list.invalidate(); utils.online.get.invalidate();
    },
    onError: onErro,
  });
  const s = q.data?.solicitacao ?? null;
  const nOnline = q.data?.entregadoresOnline ?? 0;
  const podeGerir = ["Admin", "Gestor"].includes(perfil);

  return (
    <div className="c-card" style={{ marginBottom: 10, background: "#fdf6ec" }}>
      <div className="c-titulo" style={{ fontSize: 15 }}>🛵 Entregador</div>
      {!s && (
        <>
          <p className="c-sub">
            Solicitação pelo aplicativo é <b>opcional</b> — pode sempre contactar um entregador directamente.
            Entregadores online agora: <b>{nOnline}</b>
          </p>
          <button className="c-btn c-btn-prim c-btn-bloco" disabled={solicitar.isPending || nOnline === 0}
            onClick={() => solicitar.mutate({ usuarioId, pedidoOnlineId: pedidoId })}>
            {solicitar.isPending ? "A enviar…" : nOnline === 0 ? "🛵 Sem entregadores online" : "🛵 Solicitar entregador (primeiro a aceitar ganha)"}
          </button>
          {nOnline === 0 && <p className="c-sub" style={{ margin: "6px 0 0" }}>Nenhum entregador online — contacte um directamente ou tente mais tarde.</p>}
          <button type="button" className="c-btn c-btn-linha c-btn-bloco" style={{ marginTop: 6 }}
            onClick={() => setManualAberto(!manualAberto)}>
            {manualAberto ? "▲ Fechar" : "👤 Entregador não cadastrado — indicar nome e contacto"}
          </button>
          {manualAberto && (
            <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 6 }}>
              <input className="c-input" placeholder="Nome do entregador" value={mNome} onChange={(e) => setMNome(e.target.value)} />
              <input className="c-input" inputMode="numeric" placeholder="Contacto (ex.: 84 123 4567)" value={mTel} onChange={(e) => setMTel(e.target.value)} />
              <button className="c-btn c-btn-verde c-btn-bloco"
                disabled={manual.isPending || mNome.trim().length < 2 || mTel.replace(/\D/g, "").length < 9}
                onClick={() => manual.mutate({ usuarioId, id: pedidoId, nome: mNome, telefone: mTel })}>
                {manual.isPending ? "A guardar…" : "💾 Guardar entregador neste pedido"}
              </button>
              <p className="c-sub" style={{ margin: 0, fontSize: 11.5 }}>
                O nome e o contacto ficam visíveis para o cliente acompanhar a entrega. Para cadastrar entregadores fixos:
                Configurações → Utilizadores → perfil «Entregador».
              </p>
            </div>
          )}
        </>
      )}
      {s && s.estado === "Aberta" && (
        <>
          <p className="c-sub">⏳ Solicitação enviada ({mt(s.taxa)}) — a aguardar que um entregador aceite. Online: <b>{nOnline}</b></p>
          {podeGerir && (
            <button className="c-btn c-btn-perigo c-btn-bloco" disabled={cancelar.isPending}
              onClick={() => cancelar.mutate({ usuarioId, id: s.id })}>
              ✖️ Cancelar solicitação
            </button>
          )}
        </>
      )}
      {s && s.estado === "Atribuida" && (
        <>
          <p className="c-sub">✅ <b>{s.entregadorNome}</b> aceitou e está a caminho do restaurante ({mt(s.taxa)}).</p>
          {podeGerir && (
            <button className="c-btn c-btn-perigo c-btn-bloco" disabled={cancelar.isPending}
              onClick={() => cancelar.mutate({ usuarioId, id: s.id })}>
              ✖️ Cancelar este entregador (pode solicitar outro)
            </button>
          )}
        </>
      )}
      {s && s.estado === "Concluida" && <p className="c-sub">✔️ Entrega concluída por <b>{s.entregadorNome}</b>.</p>}
      {s && s.estado === "Cancelada" && <p className="c-sub">A última solicitação foi cancelada — pode solicitar outro entregador abaixo de um novo pedido de entrega.</p>}
    </div>
  );
}
