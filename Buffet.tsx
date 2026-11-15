/* ============ BUFFET — pacotes por pessoa ============
   · Vender: cria um pedido POS com o pacote (fecha-se como qualquer conta)
   · Editar (Admin/Gestor): nome, preço/pessoa, elementos, ordem, activar/desactivar */
import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { useSession } from "@/lib/session";
import { mt } from "@/lib/fmt";
import { Modal, Vazio, Voltar } from "@/components/bits";
import MoneyInput from "@/components/MoneyInput";
import { AREAS_ESTAR, METODOS_PAGAMENTO } from "@contracts/types";
import TelInput from "@/components/TelInput";
import type { AppRouter } from "../../api/router";
import type { inferRouterOutputs } from "@trpc/server";

type Pacote = inferRouterOutputs<AppRouter>["buffet"]["list"][number];
type Cat = { nome: string; itens: string[] };

/* ícone sugerido para cada secção do menu (pelo nome) */
function catIcone(nome: string): string {
  const n = nome.toLowerCase();
  if (n.includes("entrada") || n.includes("salgad")) return "🥟";
  if (n.includes("principal") || n.includes("prato") || n.includes("carne") || n.includes("peixe")) return "🍗";
  if (n.includes("guarni") || n.includes("acompanha")) return "🍚";
  if (n.includes("salada")) return "🥗";
  if (n.includes("sobremesa") || n.includes("doce")) return "🍮";
  if (n.includes("bebida")) return "🥤";
  return "🍽";
}

/* Menu do pacote por secções (Menus do Chefe 2026); sem secções → lista plana (pacotes antigos) */
function MenuPacote({ pac, compacto }: { pac: Pacote; compacto?: boolean }) {
  const cats = (pac.categorias ?? []) as Cat[];
  if (cats.length === 0) {
    return (
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {(pac.itens ?? []).map((it, i) => (
          <span key={i} style={{
            background: "#f7f1fc", border: "1px solid #e4d5ef", borderRadius: 999,
            padding: "3px 10px", fontSize: 12.5, fontWeight: 600,
          }}>{it}</span>
        ))}
      </div>
    );
  }
  return (
    <div style={{ display: "grid", gap: compacto ? 5 : 8 }}>
      {cats.map((c, i) => (
        <div key={i}>
          <div style={{ fontSize: 11, fontWeight: 800, color: "var(--roxo2)", letterSpacing: .4, marginBottom: 3 }}>
            {catIcone(c.nome)} {c.nome.toUpperCase()}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
            {c.itens.map((it, j) => (
              <span key={j} style={{
                background: "#f7f1fc", border: "1px solid #e4d5ef", borderRadius: 999,
                padding: "2px 9px", fontSize: 12, fontWeight: 600,
              }}>{it}</span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function Buffet({ voltar }: { voltar: () => void }) {
  const { user, toast } = useSession();
  const utils = trpc.useUtils();
  const isGestao = !!user && ["Admin", "Gestor"].includes(user.perfil);
  const [editando, setEditando] = useState(false);
  const [venderSel, setVenderSel] = useState<Pacote | null>(null);
  const [editSel, setEditSel] = useState<Pacote | "novo" | null>(null);

  const pacotesQ = (isGestao && editando)
    ? trpc.buffet.listTodos.useQuery({ usuarioId: user?.id ?? 0 })
    : trpc.buffet.list.useQuery();
  const pacotes = (pacotesQ.data ?? []) as Pacote[];

  const invalida = () => { utils.buffet.list.invalidate(); utils.buffet.listTodos.invalidate(); };
  const vender = trpc.buffet.vender.useMutation({
    onSuccess: (r) => {
      toast(`✅ Pedido nº ${r.numero} criado — ${mt(r.total)}. Feche a conta em «Vender».`);
      setVenderSel(null);
    },
    onError: (e) => toast("⚠️ " + e.message),
  });
  const reservar = trpc.buffet.reservar.useMutation({
    onSuccess: (r) => {
      toast(`🍽 Reserva Buffet ${r.codigo} criada — adiantamento ${mt(r.adiant)} (${r.pct}%). Consta na página «Reservas».`);
      setVenderSel(null);
      utils.reservas.list.invalidate();
      utils.pagamentos.list.invalidate();
    },
    onError: (e) => toast("⚠️ " + e.message),
  });
  const guardar = trpc.buffet.guardar.useMutation({
    onSuccess: () => { toast("✅ Pacote guardado"); setEditSel(null); invalida(); },
    onError: (e) => toast("⚠️ " + e.message),
  });
  const remover = trpc.buffet.remover.useMutation({
    onSuccess: () => { toast("🗑 Pacote removido"); invalida(); },
    onError: (e) => toast("⚠️ " + e.message),
  });

  return (
    <div>
      <Voltar onClick={voltar} />
      <div className="c-titulo">🍽 Buffet</div>
      <p className="c-sub" style={{ marginTop: -6 }}>
        Pacotes por pessoa para grupos e eventos. Buffet de hoje: pedido normal (pagamento no fecho da conta). Buffet para data futura: Reserva Buffet com adiantamento de 50% a 100% — segue para «Reservas».
      </p>

      {isGestao && (
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <button className={`c-btn grow ${editando ? "c-btn-prim" : "c-btn-cinza"}`} onClick={() => setEditando((e) => !e)}>
            ✏️ {editando ? "A editar pacotes…" : "Editar pacotes"}
          </button>
          {editando && (
            <button className="c-btn c-btn-verde grow" onClick={() => setEditSel("novo")}>＋ Novo pacote</button>
          )}
        </div>
      )}

      {pacotesQ.isLoading && <Vazio icon="⏳">A carregar…</Vazio>}
      {!pacotesQ.isLoading && pacotes.length === 0 && <Vazio icon="🍽">Sem pacotes de buffet activos.</Vazio>}

      <div style={{ display: "grid", gap: 12 }}>
        {pacotes.map((pac) => (
          <div key={pac.id} className="c-card" style={{ opacity: pac.ativo === false ? 0.55 : 1, padding: 0, overflow: "hidden" }}>
            {/* imagem do pacote — banho-marias com os pratos incluídos */}
            <div style={{
              position: "relative", height: 150,
              background: pac.foto
                ? `url(${pac.foto}) center/cover no-repeat`
                : "linear-gradient(120deg,var(--roxo),var(--roxo2))",
            }}>
              <div style={{
                position: "absolute", inset: 0,
                background: "linear-gradient(180deg, rgba(20,4,26,.05) 30%, rgba(20,4,26,.78) 100%)",
              }} />
              <div style={{ position: "absolute", left: 12, bottom: 10, color: "#fff" }}>
                <div style={{ fontWeight: 800, fontSize: 18, textShadow: "0 1px 6px rgba(0,0,0,.5)" }}>🍽 {pac.nome}</div>
                {pac.descricao && <div style={{ fontSize: 11.5, opacity: .92, textShadow: "0 1px 4px rgba(0,0,0,.5)" }}>{pac.descricao}</div>}
              </div>
              <div style={{
                position: "absolute", right: 10, bottom: 10, background: "rgba(255,255,255,.94)",
                borderRadius: 999, padding: "5px 12px", fontWeight: 800, color: "var(--roxo)", fontSize: 15,
                boxShadow: "0 2px 8px rgba(0,0,0,.3)",
              }}>
                {mt(pac.preco)} <span style={{ fontWeight: 500, fontSize: 11 }}>/pessoa</span>
              </div>
              {pac.ativo === false && (
                <span className="c-badge" style={{ position: "absolute", top: 10, left: 10, background: "#eee" }}>Inactivo</span>
              )}
            </div>
            <div style={{ padding: "12px 14px 4px" }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: "var(--roxo2)", letterSpacing: .4, marginBottom: 6 }}>
                ✅ INCLUÍDO NESTE PACOTE
              </div>
              <MenuPacote pac={pac} />
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 4, flexWrap: "wrap", padding: "8px 14px 14px" }}>
              {!editando && pac.ativo !== false && (
                <button className="c-btn c-btn-verde grow" onClick={() => setVenderSel(pac)}>
                  🛒 Vender este buffet
                </button>
              )}
              {editando && (
                <>
                  <button className="c-btn c-btn-prim grow" onClick={() => setEditSel(pac)}>✏️ Editar</button>
                  <button className="c-btn c-btn-cinza" title="Remover pacote"
                    onClick={() => { if (confirm(`Remover o pacote «${pac.nome}»?`)) user && remover.mutate({ usuarioId: user.id, id: pac.id }); }}>
                    🗑
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      {venderSel && user && (
        <VenderBuffetModal
          pac={venderSel}
          pendente={vender.isPending}
          pendenteRes={reservar.isPending}
          onClose={() => setVenderSel(null)}
          onVender={(pessoas, referencia, area, extras) =>
            vender.mutate({ usuarioId: user.id, pacoteId: venderSel.id, pessoas, referencia, area, extras })}
          onReservar={(d) => reservar.mutate({ usuarioId: user.id, pacoteId: venderSel.id, ...d })}
        />
      )}
      {editSel && user && (
        <EditarPacoteModal
          pac={editSel === "novo" ? null : editSel}
          pendente={guardar.isPending}
          onClose={() => setEditSel(null)}
          onGuardar={(d) => guardar.mutate({ usuarioId: user.id, id: editSel === "novo" ? undefined : editSel.id, ...d })}
        />
      )}
    </div>
  );
}

/* ---------- Vender / Reservar buffet ---------- */
function VenderBuffetModal({ pac, pendente, pendenteRes, onClose, onVender, onReservar }: {
  pac: Pacote; pendente: boolean; pendenteRes: boolean; onClose: () => void;
  onVender: (pessoas: number, referencia: string, area: string, extras: { nome: string; valor: number }[]) => void;
  onReservar: (d: { pessoas: number; referencia: string; telefone?: string; area?: string; dataEvento: string; hora?: string; adiantValor: number; metodo?: string; extras: { nome: string; valor: number }[] }) => void;
}) {
  const hoje = new Date(Date.now() + 2 * 3600e3).toISOString().slice(0, 10);
  const [pessoas, setPessoas] = useState(10);
  const [referencia, setReferencia] = useState("");
  const [telefone, setTelefone] = useState("");
  const [area, setArea] = useState("");
  const [dataEvento, setDataEvento] = useState(hoje);
  const [hora, setHora] = useState("");
  const [adiant, setAdiant] = useState(0);
  const [metodo, setMetodo] = useState<string>(METODOS_PAGAMENTO[0] ?? "Numerário");
  // elementos extra que o cliente pediu além do pacote (com valor combinado)
  const [extras, setExtras] = useState<{ nome: string; valor: number }[]>([]);
  const [exNome, setExNome] = useState("");
  const [exValor, setExValor] = useState(0);
  const addExtra = () => {
    if (exNome.trim().length >= 2 && exValor > 0) {
      setExtras((arr) => [...arr, { nome: exNome.trim(), valor: Math.round(exValor * 100) / 100 }]);
      setExNome(""); setExValor(0);
    }
  };
  const totalExtras = Math.round(extras.reduce((a, x) => a + x.valor, 0) * 100) / 100;
  const total = Math.round((pac.preco * pessoas + totalExtras) * 100) / 100;
  const futuro = dataEvento > hoje; // data futura → Reserva Buffet com adiantamento
  const pct = total > 0 ? Math.round((adiant / total) * 100) : 0;
  const adiantOk = adiant >= Math.round(total * 0.5 * 100) / 100 - 0.009 && adiant <= total;
  return (
    <Modal onClose={onClose}>
      <h3>🍽 Buffet — {pac.nome}</h3>
      <p className="c-sub">{mt(pac.preco)} por pessoa</p>
      <div style={{ background: "#faf6fd", border: "1px solid #eadffa", borderRadius: 10, padding: "8px 10px", marginBottom: 6 }}>
        <MenuPacote pac={pac} compacto />
      </div>
      <label className="c-label">📅 Data do evento *</label>
      <input className="c-input" type="date" min={hoje} value={dataEvento}
        onChange={(e) => setDataEvento(e.target.value || hoje)} />
      {futuro && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <div>
            <label className="c-label">Hora (opcional)</label>
            <input className="c-input" type="time" value={hora} onChange={(e) => setHora(e.target.value)} />
          </div>
          <div>
            <label className="c-label">Telefone do cliente</label>
            <TelInput value={telefone} onChange={setTelefone} />
          </div>
        </div>
      )}
      <label className="c-label">Número de pessoas *</label>
      <input className="c-input" type="number" inputMode="numeric" min={1} value={pessoas || ""}
        onChange={(e) => setPessoas(Math.max(1, Math.round(+e.target.value || 1)))} autoFocus />
      <label className="c-label">Referência (nome do cliente / grupo) *</label>
      <input className="c-input" placeholder="Ex.: Aniversário da Dina" value={referencia}
        onChange={(e) => setReferencia(e.target.value)} />
      <label className="c-label">Espaço (opcional)</label>
      <select className="c-select" value={area} onChange={(e) => setArea(e.target.value)}>
        <option value="">— Sem espaço definido —</option>
        {AREAS_ESTAR.map((a) => <option key={a} value={a}>{a}</option>)}
      </select>
      {/* elementos extra a pedido do cliente (ex.: camarão, decoração) com valor combinado */}
      <div style={{ marginTop: 10, borderTop: "1px dashed #ddd", paddingTop: 10 }}>
        <label className="c-label" style={{ marginTop: 0 }}>➕ Elementos extra que o cliente pediu (fora do pacote)</label>
        {extras.map((x, i) => (
          <div key={i} className="c-linha" style={{ padding: "4px 0" }}>
            <div className="grow tit" style={{ fontSize: 13.5 }}>➕ {x.nome}</div>
            <b style={{ fontSize: 13.5 }}>{mt(x.valor)}</b>
            <button type="button" className="c-btn c-btn-cinza c-btn-peq" title="Remover"
              onClick={() => setExtras((arr) => arr.filter((_, j) => j !== i))}>✕</button>
          </div>
        ))}
        <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr 40px", gap: 6 }}>
          <input className="c-input" placeholder="Ex.: Camarão grelhado" value={exNome}
            onChange={(e) => setExNome(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addExtra(); } }} />
          <MoneyInput value={exValor} onChange={(v) => setExValor(Math.max(0, v))} placeholder="Valor" />
          <button type="button" className="c-btn c-btn-prim c-btn-peq" onClick={addExtra}>＋</button>
        </div>
        <p className="c-sub" style={{ margin: "4px 0 0" }}>
          O valor do extra é combinado com o cliente no momento — entra no total da conta.
        </p>
      </div>

      <div className="c-total-linha" style={{ marginTop: 10 }}>
        <span>Buffet ({pessoas} × {mt(pac.preco)})</span><b>{mt(pac.preco * pessoas)}</b>
      </div>
      {totalExtras > 0 && (
        <div className="c-total-linha"><span>Extras ({extras.length})</span><b>{mt(totalExtras)}</b></div>
      )}
      <div className="c-total-linha grande"><span>TOTAL</span><span>{mt(total)}</span></div>

      {!futuro && (
        <>
          <p className="c-sub" style={{ marginTop: 6 }}>
            ℹ️ Buffet de <b>hoje</b>: é criado um pedido normal — o pagamento (à vista, dividido ou fiado) faz-se no fecho da conta, em «Vender».
          </p>
          <button className="c-btn c-btn-verde c-btn-bloco" style={{ marginTop: 12 }}
            disabled={pendente || pessoas < 1}
            onClick={() => onVender(pessoas, referencia.trim(), area.trim(), extras)}>
            {pendente ? "A criar…" : `✅ Criar pedido — ${mt(total)}`}
          </button>
        </>
      )}

      {futuro && (
        <div style={{ marginTop: 10, borderTop: "1px dashed #ddd", paddingTop: 10 }}>
          <label className="c-label" style={{ marginTop: 0 }}>💵 Quanto tem o cliente disponível agora? (MZN) — entre 50% e 100%</label>
          <MoneyInput value={adiant} onChange={(v) => setAdiant(Math.max(0, v))} placeholder="Valor do adiantamento" />
          <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
            {[50, 75, 100].map((pp) => (
              <button key={pp} type="button" className="c-btn c-btn-cinza c-btn-peq grow"
                onClick={() => setAdiant(Math.round(total * pp) / 100)}>{pp}%</button>
            ))}
          </div>
          {adiant > 0 && (
            <p className="c-sub" style={{ margin: "6px 0 0" }}>
              Adiantamento: <b>{mt(Math.min(adiant, total))}</b> — <b>{Math.min(pct, 100)}%</b> do total
              {adiant < total && <> · faltam <b>{mt(total - Math.min(adiant, total))}</b></>}
            </p>
          )}
          <label className="c-label">Método de pagamento</label>
          <select className="c-select" value={metodo} onChange={(e) => setMetodo(e.target.value)}>
            {METODOS_PAGAMENTO.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          {adiantOk && adiant < total && (
            <div style={{ marginTop: 8, padding: "8px 10px", borderRadius: 10, background: "#fdecea", border: "1px solid #f5c6c0", fontSize: 13 }}>
              ⚠️ Adiantamento abaixo de 100%: recomende ao cliente pagar o restante <b>até 48 horas antes do evento</b>, sob pena de não abertura da mesa.
            </div>
          )}
          <p className="c-sub" style={{ marginTop: 6 }}>
            ℹ️ Ao confirmar, cria-se uma <b>Reserva Buffet</b> na página «Reservas». No dia do evento, o caixa/garçon abre o pedido a partir daí para levantar pratos/bebidas e produtos adicionais.
          </p>
          <button className="c-btn c-btn-verde c-btn-bloco" style={{ marginTop: 10 }}
            disabled={pendenteRes || pessoas < 1 || referencia.trim().length < 2 || !adiantOk}
            onClick={() => onReservar({
              pessoas, referencia: referencia.trim(), telefone: telefone.trim() || undefined,
              area: area.trim() || undefined, dataEvento, hora: hora || undefined,
              adiantValor: adiant, metodo, extras,
            })}>
            {pendenteRes ? "A criar…" : `📅 Criar Reserva Buffet — adiantamento ${mt(Math.min(adiant, total))} (${Math.min(pct, 100)}%)`}
          </button>
          {!adiantOk && adiant > 0 && (
            <p className="c-sub" style={{ color: "#c0392b", marginTop: 4 }}>
              O adiantamento deve ser entre 50% ({mt(total / 2)}) e 100% ({mt(total)}).
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}

/* ---------- Criar/editar pacote (Admin/Gestor) ---------- */
const SECCOES_SUGERIDAS = ["Entradas", "Pratos principais", "Guarnições", "Saladas", "Sobremesas", "Bebidas"];

function EditarPacoteModal({ pac, pendente, onClose, onGuardar }: {
  pac: Pacote | null; pendente: boolean; onClose: () => void;
  onGuardar: (d: { nome: string; preco: number; itens: string[]; categorias: Cat[]; descricao: string; ordem: number; ativo: boolean }) => void;
}) {
  const [nome, setNome] = useState(pac?.nome ?? "");
  const [preco, setPreco] = useState(pac?.preco ?? 0);
  const [descricao, setDescricao] = useState(pac?.descricao ?? "");
  const [ordem, setOrdem] = useState(pac?.ordem ?? 0);
  const [ativo, setAtivo] = useState(pac?.ativo !== false);
  // menu por secções; pacotes antigos (lista plana) entram como «Pratos principais» para não perder nada
  const [cats, setCats] = useState<Cat[]>(() => {
    if (pac?.categorias && pac.categorias.length > 0) return pac.categorias.map((c) => ({ nome: c.nome, itens: [...c.itens] }));
    if (pac?.itens && pac.itens.length > 0) return [{ nome: "Pratos principais", itens: [...pac.itens] }];
    return [{ nome: "Entradas", itens: [] }, { nome: "Pratos principais", itens: [] }];
  });
  const [novoItem, setNovoItem] = useState<Record<number, string>>({});

  const addItem = (ci: number) => {
    const v = (novoItem[ci] ?? "").trim();
    if (v.length < 2) return;
    setCats((arr) => arr.map((c, i) => i === ci && !c.itens.includes(v) ? { ...c, itens: [...c.itens, v] } : c));
    setNovoItem((m) => ({ ...m, [ci]: "" }));
  };
  const removeItem = (ci: number, item: string) =>
    setCats((arr) => arr.map((c, i) => i === ci ? { ...c, itens: c.itens.filter((x) => x !== item) } : c));
  const removeCat = (ci: number) => setCats((arr) => arr.filter((_, i) => i !== ci));
  const addCat = (nomeCat: string) => {
    const v = nomeCat.trim();
    if (v.length >= 2 && !cats.some((c) => c.nome.toLowerCase() === v.toLowerCase()))
      setCats((arr) => [...arr, { nome: v, itens: [] }]);
  };
  const totalItens = cats.reduce((a, c) => a + c.itens.length, 0);
  const ok = nome.trim().length >= 2 && preco > 0 && totalItens > 0;

  return (
    <Modal onClose={onClose}>
      <h3>{pac ? "✏️ Editar" : "＋ Novo"} pacote de buffet</h3>
      <label className="c-label">Nome do pacote *</label>
      <input className="c-input" placeholder="Ex.: Menu de 1200" value={nome} onChange={(e) => setNome(e.target.value)} />
      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 10 }}>
        <div>
          <label className="c-label">Preço por pessoa (MZN) *</label>
          <MoneyInput value={preco} onChange={(v) => setPreco(Math.max(0, v))} />
        </div>
        <div>
          <label className="c-label">Ordem</label>
          <input className="c-input" type="number" min={0} value={ordem}
            onChange={(e) => setOrdem(Math.max(0, Math.round(+e.target.value || 0)))} />
        </div>
      </div>
      <label className="c-label">Descrição curta (opcional)</label>
      <input className="c-input" placeholder="Ex.: O favorito das grandes celebrações" value={descricao}
        onChange={(e) => setDescricao(e.target.value)} />

      <label className="c-label">Menu por secções ({totalItens} elementos)</label>
      <div style={{ display: "grid", gap: 10 }}>
        {cats.map((c, ci) => (
          <div key={ci} style={{ background: "#faf6fd", border: "1px solid #eadffa", borderRadius: 10, padding: "8px 10px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
              <b style={{ fontSize: 12.5, color: "var(--roxo2)", letterSpacing: .3 }} className="grow">
                {catIcone(c.nome)} {c.nome.toUpperCase()}
              </b>
              <button type="button" className="c-btn c-btn-cinza c-btn-peq" title="Remover esta secção"
                onClick={() => removeCat(ci)}>✕</button>
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
              {c.itens.map((it) => (
                <span key={it} className="c-badge" style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#f1e8f5" }}>
                  {it}
                  <button type="button" title="Remover" style={{ border: "none", background: "none", cursor: "pointer", color: "var(--vermelho-c)", fontWeight: 800 }}
                    onClick={() => removeItem(ci, it)}>✕</button>
                </span>
              ))}
              {c.itens.length === 0 && <span className="c-sub">Secção vazia — acrescente abaixo.</span>}
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <input className="c-input grow" placeholder={`Ex.: ${c.nome === "Entradas" ? "Chamussas" : c.nome === "Sobremesas" ? "Mousse de malambe" : "Frango grelhado"}`}
                value={novoItem[ci] ?? ""}
                onChange={(e) => setNovoItem((m) => ({ ...m, [ci]: e.target.value }))}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addItem(ci); } }} />
              <button type="button" className="c-btn c-btn-prim c-btn-peq" onClick={() => addItem(ci)}>＋</button>
            </div>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
        {SECCOES_SUGERIDAS.filter((x) => !cats.some((c) => c.nome.toLowerCase() === x.toLowerCase())).map((x) => (
          <button key={x} type="button" className="c-btn c-btn-cinza c-btn-peq" onClick={() => addCat(x)}>
            ＋ {catIcone(x)} {x}
          </button>
        ))}
      </div>

      <button type="button" className={`c-btn c-btn-bloco ${ativo ? "c-btn-cinza" : "c-btn-linha"}`} style={{ marginTop: 12 }}
        onClick={() => setAtivo((a) => !a)}>
        {ativo ? "✅ Pacote activo (visível e vendável)" : "⏸ Pacote inactivo (escondido)"}
      </button>
      <button className="c-btn c-btn-verde c-btn-bloco" style={{ marginTop: 8 }}
        disabled={pendente || !ok}
        onClick={() => onGuardar({
          nome: nome.trim(), preco,
          itens: cats.flatMap((c) => c.itens), // lista plana derivada (recibos/notificações)
          categorias: cats.filter((c) => c.itens.length > 0),
          descricao: descricao.trim(), ordem, ativo,
        })}>
        {pendente ? "A guardar…" : "✅ Guardar pacote"}
      </button>
    </Modal>
  );
}
