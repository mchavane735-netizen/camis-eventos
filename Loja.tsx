import { useEffect, useMemo, useState } from "react";
import { trpc } from "@/providers/trpc";
import { mt, hoje } from "@/lib/fmt";
import { useEmpresa } from "@/lib/empresa";
import { useLojaCliente, type CarrinhoItem } from "@/lib/loja";
import { usePresenca } from "@/lib/presenca";
import { fileToDataUrl } from "@/lib/img";
import TelInput from "@/components/TelInput";
import UploadFicheiro from "@/components/UploadFicheiro";
import SenhaInput from "@/components/SenhaInput";
import AcompSel, { temAcomp } from "@/components/AcompSel";
import MapaEntrega from "@/components/MapaEntrega";
import { TIPOS_PEDIDO_ONLINE, TAXA_RESERVA_PESSOA, taxaReservaPessoa, AREAS_ESTAR, LOJA_DESCONTO_PCT, braaiTaxaPessoa, braaiTotal, braaiRotulo, BRAAI_REGRAS, BRAAI_DURACAO_HORAS, type BraaiModalidade, type BraaiTraz, type TipoPedidoOnline, type MetodoOnline } from "@contracts/types";
import { downloadPdf, facturaOnlineHtml } from "@/lib/docprint";
import { fotoProduto } from "@/lib/fotos";
import { refGuardado, guardarRef, limparRef, refDoLink, diasRestantes, type RefAfiliado } from "@/lib/refAfiliado";

/** Liga o código de afiliado vindo do link (?ref=AF-XXXX) às compras deste dispositivo (90 dias). */
function useRefAfiliado(setAfCodigo: (v: string) => void) {
  const [ref, setRef] = useState<RefAfiliado | null>(() => refGuardado());
  const codigoLink = useMemo(() => refDoLink(), []);
  const res = trpc.afiliados.resolverCodigo.useQuery(
    { codigo: codigoLink ?? "" },
    { enabled: !!codigoLink, retry: false, staleTime: Infinity },
  );
  useEffect(() => {
    if (res.data && res.data.valido) {
      const g = guardarRef(res.data.codigo, res.data.nome);
      setRef(g);
      setAfCodigo(g.codigo);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [res.data]);
  useEffect(() => { if (!codigoLink && ref) setAfCodigo(ref.codigo); /* aplica o código guardado */ // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { ref, limpar: () => { limparRef(); setRef(null); setAfCodigo(""); } };
}

/** Campo de afiliado: selo automático quando veio do link, ou entrada manual no link normal. */
function CampoAfiliado({ ref_, limpar, afCodigo, setAfCodigo }: {
  ref_: RefAfiliado | null; limpar: () => void; afCodigo: string; setAfCodigo: (v: string) => void;
}) {
  if (ref_) {
    return (
      <div style={{ background: "#eefaf1", border: "1px solid #1e9e5a", borderRadius: 12, padding: "8px 12px", marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 18 }}>🤝</span>
        <div style={{ flex: 1, fontSize: 12.5 }}>
          A apoiar <b>{ref_.nome}</b> ({ref_.codigo}) — código aplicado automaticamente às suas compras por mais <b>{diasRestantes(ref_)} dias</b>.
        </div>
        <button className="c-btn c-btn-cinza c-btn-peq" title="Comprar sem código de afiliado" onClick={limpar}>✕</button>
      </div>
    );
  }
  return (
    <>
      <label className="c-label">🤝 Código de afiliado (se alguém lhe indicou — dá-lhe {LOJA_DESCONTO_PCT}% de desconto)</label>
      <input className="c-input" placeholder="Ex.: AF-0001 (opcional)" value={afCodigo}
        onChange={(e) => setAfCodigo(e.target.value.toUpperCase())} />
    </>
  );
}

const rotuloTipo = (t: string) => TIPOS_PEDIDO_ONLINE.find((x) => x.id === t)?.rotulo ?? t;

type View = "home" | "menu" | "carrinho" | "pagar" | "reserva" | "braai" | "buffet" | "sucesso" | "acompanhar" | "conta";

type PedidoCriado = { codigo: string; subtotal: number; taxaEntrega: number; total: number; adiant: number; aguardaCotacao?: boolean };

export default function Loja({ mesaInicial }: { mesaInicial?: string }) {
  const emp = useEmpresa();
  const { token, cliente, entrar, sair } = useLojaCliente();
  usePresenca("loja");
  const [view, setView] = useState<View>("home");
  const [tipo, setTipo] = useState<TipoPedidoOnline>(mesaInicial ? "Local" : "Delivery");
  const [mesa] = useState(mesaInicial || "");
  const [cart, setCart] = useState<CarrinhoItem[]>([]);
  const [pedido, setPedido] = useState<PedidoCriado | null>(null);
  const [telPedido, setTelPedido] = useState("");

  const menu = trpc.loja.menu.useQuery({ tipo });
  const est = trpc.loja.estabelecimento.useQuery(undefined, { refetchInterval: 30000 });

  const totalCart = cart.reduce((a, i) => a + i.preco * i.qtd, 0);
  const nItens = cart.reduce((a, i) => a + i.qtd, 0);

  const add = (p: { id: number; nome: string; preco: number; foto?: string | null }, obs?: string) =>
    setCart((c) => {
      const ex = c.find((i) => i.produtoId === p.id && (i.obs ?? "") === (obs ?? ""));
      if (ex) return c.map((i) => (i === ex ? { ...i, qtd: i.qtd + 1 } : i));
      return [...c, { produtoId: p.id, nome: p.nome, preco: p.preco, qtd: 1, foto: p.foto, obs: obs || undefined }];
    });
  const sub = (id: number) =>
    setCart((c) => {
      let done = false;
      return c.map((i) => {
        if (!done && i.produtoId === id) { done = true; return { ...i, qtd: i.qtd - 1 }; }
        return i;
      }).filter((i) => i.qtd > 0);
    });

  /** Pedido adicional / especial (fora do menu) — SEM preço: o restaurante cota depois */
  const addExtra = (descricao: string, detalhes: string, qtd: number) =>
    setCart((c) => [...c, { produtoId: -Date.now(), nome: descricao, preco: 0, qtd, personalizado: true, detalhes: detalhes || undefined }]);

  const escolherTipo = (t: TipoPedidoOnline) => { setTipo(t); setCart([]); setView(t === "Reserva" ? "reserva" : "menu"); };
  const escolherBraai = () => { setTipo("Reserva"); setCart([]); setView("braai"); };
  const escolherBuffet = () => { setTipo("Reserva"); setCart([]); setView("buffet"); };

  return (
    <div style={{ minHeight: "100dvh", background: "var(--fundo, #faf7fb)" }}>
      {/* cabeçalho da loja */}
      <header style={{
        background: "linear-gradient(120deg,var(--roxo) 0%,var(--roxo2) 60%,#8a2a8d 100%)",
        color: "#fff", padding: "12px 14px", textAlign: "center",
      }}>
        <img src="/icons/logo.png" alt="logo" style={{ width: 64, height: 64, borderRadius: "50%", background: "#fff", padding: 3, display: "block", margin: "0 auto" }} />
        <div style={{ fontWeight: 800, fontSize: 18, letterSpacing: 1 }}>{emp.nome}</div>
        <div style={{ fontSize: 11, opacity: .9 }}>{emp.slogan} · NUIT {emp.nuit}</div>
        {mesa && <div style={{ fontSize: 12, marginTop: 2, fontWeight: 700 }}>📍 Mesa {mesa}</div>}
      </header>

      <main style={{ padding: "14px 14px 110px", maxWidth: 760, margin: "0 auto" }}>
        {view === "home" && (
          <Home
            mesa={mesa}
            cliente={cliente}
            onTipo={escolherTipo}
            onBraai={escolherBraai}
            onBuffet={escolherBuffet}
            onAcompanhar={() => setView("acompanhar")}
            onConta={() => setView("conta")}
            onSair={sair}
          />
        )}
        {view === "menu" && (
          <MenuLoja
            tipo={tipo} mesa={mesa} cart={cart} produtos={menu.data ?? []} carregando={menu.isLoading}
            direcaoTels={emp.direcaoTels}
            onAdd={add} onSub={sub} onAddExtra={addExtra} onVoltar={() => setView("home")} onCarrinho={() => setView("carrinho")}
          />
        )}
        {view === "reserva" && (
          <ReservaFlow
            cliente={cliente} token={token}
            onVoltar={() => setView("home")}
            onCriado={(p, tel) => { setPedido(p); setTelPedido(tel); setView("sucesso"); }}
          />
        )}
        {view === "buffet" && (
          <BuffetFlow
            cliente={cliente} token={token}
            onVoltar={() => setView("home")}
            onCriado={(p, tel) => { setPedido(p); setTelPedido(tel); setView("sucesso"); }}
          />
        )}
        {view === "braai" && (
          <BraaiFlow
            cliente={cliente} token={token}
            onVoltar={() => setView("home")}
            onCriado={(p, tel) => { setPedido(p); setTelPedido(tel); setView("sucesso"); }}
          />
        )}
        {view === "carrinho" && (
          <Carrinho
            cart={cart} tipo={tipo} taxaDelivery={parseFloat(emp.taxaDelivery) || 0}
            onAddIdx={(idx) => { const it = cart[idx]; if (it && it.produtoId > 0) add({ id: it.produtoId, nome: it.nome, preco: it.preco, foto: it.foto }, it.obs); }}
            onSubIdx={(idx) => setCart((c) => c.map((i, j) => (j === idx ? { ...i, qtd: i.qtd - 1 } : i)).filter((i) => i.qtd > 0))}
            onVoltar={() => setView("menu")}
            onAvancar={() => setView("pagar")}
          />
        )}
        {view === "pagar" && (
          <Pagar
            cart={cart} tipo={tipo} mesa={mesa} cliente={cliente} token={token}
            onVoltar={() => setView("carrinho")}
            onCriado={(p, tel) => { setPedido(p); setTelPedido(tel); setCart([]); setView("sucesso"); }}
          />
        )}
        {view === "sucesso" && pedido && (
          <Sucesso pedido={pedido} telefone={telPedido} tipo={tipo}
            onAcompanhar={() => setView("acompanhar")} onInicio={() => { setPedido(null); setView("home"); }} />
        )}
        {view === "acompanhar" && (
          <Acompanhar
            codigoInicial={pedido?.codigo ?? ""} telInicial={telPedido || cliente?.telefone || ""}
            onVoltar={() => setView("home")}
          />
        )}
        {view === "conta" && (
          <Conta cliente={cliente} token={token} onEntrar={entrar} onSair={sair}
            onVoltar={() => setView("home")} onVerPedido={(codigo, tel) => {
              setPedido({ codigo, subtotal: 0, taxaEntrega: 0, total: 0, adiant: 0 });
              setTelPedido(tel); setView("acompanhar");
            }} />
        )}
      </main>

      {/* popup: estabelecimento fechado — bloqueia novos pedidos online */}
      {est.data?.fechado && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 80, background: "rgba(20,8,26,.72)",
          display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
        }}>
          <div className="c-card" style={{ maxWidth: 420, width: "100%", textAlign: "center" }}>
            <div style={{ fontSize: 46 }}>🔴</div>
            <div className="c-titulo">Estamos fechados de momento</div>
            <p className="c-sub" style={{ marginTop: 8 }}>
              O estabelecimento encontra-se <b>fechado</b> e não estamos a aceitar pedidos online
              neste momento. Por favor, volte mais tarde — teremos todo o gosto em recebê-lo!
            </p>
            <p className="c-sub" style={{ marginTop: 4 }}>
              📞 {emp.tel1} / {emp.tel2}
            </p>
          </div>
        </div>
      )}

      {/* barra do carrinho */}
      {(view === "menu") && nItens > 0 && (
        <button onClick={() => setView("carrinho")} style={{
          position: "fixed", bottom: 14, left: "50%", transform: "translateX(-50%)",
          width: "min(92vw, 480px)", zIndex: 40, border: "none", borderRadius: 14,
          background: "linear-gradient(120deg,var(--roxo),var(--roxo2))", color: "#fff",
          padding: "13px 18px", display: "flex", justifyContent: "space-between",
          fontWeight: 800, fontSize: 15, boxShadow: "0 6px 20px rgba(61,12,64,.4)", cursor: "pointer",
        }}>
          <span>🛒 {nItens} {nItens === 1 ? "item" : "itens"}</span>
          <span>{mt(totalCart)} →</span>
        </button>
      )}
    </div>
  );
}

/* ============ HOME ============ */
function Home({ mesa, cliente, onTipo, onBraai, onBuffet, onAcompanhar, onConta, onSair }: {
  mesa: string; cliente: { nome: string } | null;
  onTipo: (t: TipoPedidoOnline) => void; onBraai: () => void; onBuffet: () => void; onAcompanhar: () => void; onConta: () => void; onSair: () => void;
}) {
  return (
    <div>
      {cliente && (
        <div className="c-card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>👋 Olá, <b>{cliente.nome.split(" ")[0]}</b>!</span>
          <button className="c-btn c-btn-cinza c-btn-peq" onClick={onSair}>Sair</button>
        </div>
      )}
      <div className="c-titulo">🍽️ Faça o seu pedido</div>
      <p className="c-sub" style={{ marginTop: -6 }}>
        {mesa
          ? `A encomendar da Mesa ${mesa}. Comida caseira, feita com carinho — chegue com fome, saia com memória. 🧡`
          : "Comida caseira, feita com carinho — chegue com fome, saia com memória. 🧡 Escolha como quer receber o seu pedido:"}
      </p>
      {TIPOS_PEDIDO_ONLINE.map((t) => (
        <button key={t.id} className="c-menu-btn" onClick={() => onTipo(t.id)}>
          <span style={{ fontSize: 24 }}>{t.icon}</span>
          <span>{t.rotulo}<small>{t.desc}{t.id === "Reserva" ? " — indique a data" : ""}</small></span>
        </button>
      ))}
      <button className="c-menu-btn" style={{ background: "linear-gradient(120deg,#f5f0fc,#eadefa)", border: "1.5px solid #b9a6d9" }} onClick={onBuffet}>
        <span style={{ fontSize: 24 }}>🍽</span>
        <span><b>Buffet para grupos & eventos</b><small>Entregue-nos a data, receba o aplauso 🎉 — pacotes por pessoa (1200 · 1500 · 1800 · 2500 MZN), menu fechado, sem preocupações</small></span>
      </button>
      <button className="c-menu-btn" style={{ background: "linear-gradient(120deg,#fff7ed,#ffedd5)", border: "1.5px solid #fdba74" }} onClick={onBraai}>
        <span style={{ fontSize: 24 }}>🔥</span>
        <span><b>Braai — Traga os seus produtos</b><small>O espaço é seu por 5 horas 🔥 — traga comida e/ou bebidas e viva a festa connosco (assadura fora, no local indicado)</small></span>
      </button>
      {/* ===== Identidade CAMI'S — porquê nós ===== */}
      <div className="c-card" style={{
        background: "linear-gradient(135deg,#f3edff 0%,#fdf6ec 100%)",
        border: "1.5px solid #d8c4ef", marginTop: 12, padding: "14px 14px 12px",
      }}>
        <div style={{ fontWeight: 800, fontSize: 15.5, color: "var(--roxo)", textAlign: "center" }}>
          💜 Porquê a CAMI'S?
        </div>
        <div style={{ fontSize: 12.5, color: "#6b4a86", textAlign: "center", marginTop: 2, marginBottom: 10 }}>
          A casa dos momentos felizes de Chimoio
        </div>
        {[
          ["🧾", "O seu dinheiro sempre à vista", "Comprovativo e factura na hora — transparência total, do adiantamento ao troco."],
          ["📲", "Acompanhe tudo online", "Do preparo à entrega, o estado do seu pedido na palma da mão — sem ligar, sem adivinhar."],
          ["🎉", "Um só responsável pelo seu dia", "Espaço + comida + decoração + lazer. Você celebra; nós respondemos pelo conjunto."],
          ["🛝", "As crianças também celebram", "Diversões grátis no parque infantil com o seu consumo — memórias para toda a família."],
        ].map(([icon, tit, txt]) => (
          <div key={tit} style={{ display: "flex", gap: 10, alignItems: "flex-start", marginBottom: 8 }}>
            <span style={{ fontSize: 20, lineHeight: 1.2 }}>{icon}</span>
            <div>
              <div style={{ fontWeight: 700, fontSize: 13 }}>{tit}</div>
              <div style={{ fontSize: 12, color: "#5c4a6e", lineHeight: 1.35 }}>{txt}</div>
            </div>
          </div>
        ))}
        <div style={{ fontSize: 12, color: "#6b4a86", textAlign: "center", marginTop: 4, fontStyle: "italic" }}>
          «Entregue-nos a data. Receba o aplauso.» 🎉
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
        <button className="c-btn c-btn-linha" style={{ flex: 1 }} onClick={onAcompanhar}>📦 Acompanhar pedido</button>
        <button className="c-btn c-btn-linha" style={{ flex: 1 }} onClick={onConta}>
          {cliente ? "📜 Os meus pedidos" : "👤 Entrar / Registar"}
        </button>
      </div>
      <p className="c-sub" style={{ textAlign: "center", marginTop: 10 }}>
        O registo é opcional — serve para guardar o seu histórico de pedidos.
      </p>
      <AjudaLoja />
    </div>
  );
}

/* ============ INSTRUÇÕES DE USO (loja online) ============ */
function AjudaLoja() {
  const [aberto, setAberto] = useState(false);
  return (
    <div className="c-card" style={{ marginTop: 10 }}>
      <button className="c-btn c-btn-linha c-btn-bloco" onClick={() => setAberto(!aberto)}>
        {aberto ? "▲ Esconder instruções" : "❓ Como usar esta página — instruções"}
      </button>
      {aberto && (
        <ul style={{ margin: "10px 0 0", paddingLeft: 18, fontSize: 13.5, lineHeight: 1.5 }}>
          <li><b>1.</b> Escolha como quer receber: <b>Consumir no local</b>, <b>Take Away</b> (levantar), <b>Delivery</b> (entrega ao domicílio) ou <b>Reserva</b> (salão/comida para outro dia).</li>
          <li><b>2.</b> Escolha os pratos. Nos pratos de aves, carnes, peixe e marisco, escolha também os <b>acompanhamentos</b> nos dois menus (obrigatório).</li>
          <li><b>3.</b> No carrinho, confirme as quantidades e avance.</li>
          <li><b>4.</b> Escolha o método de pagamento: <b>Transferência eMola</b>, <b>Levantamento eMola</b>, <b>transferência FNB</b> (depois de transferir, ligue <b>87 458 9150</b> para flexibilizar a confirmação) ou <b>Dinheiro</b> no local.</li>
          <li><b>5.</b> Pague e envie o <b>comprovativo</b> (foto/PDF). Em dinheiro, não precisa de comprovativo.</li>
          <li><b>6.</b> Guarde o <b>código do pedido</b> e acompanhe o estado em «Acompanhar pedido» — recebe todas as mensagens do restaurante aí.</li>
          <li><b>Delivery:</b> assim que o pedido sair, verá o <b>nome e contacto do entregador</b> nas mensagens.</li>
          <li><b>Delivery e Take Away</b> são aceites até às <b>16:00 (ter–sex)</b> e <b>19:00 (sáb–dom)</b>.</li>
          <li><b>Conta (opcional):</b> entre com telefone + senha. Se esquecer a senha, use «🔐 Esqueci a senha» — recupera com o email do registo. Após 3 tentativas erradas a conta bloqueia por segurança.</li>
        </ul>
      )}
    </div>
  );
}


/* ============ CARROSSEL FAST FOOD — os mais pedidos ============ */
/** Fast food = Salgados (hambúrgueres e sandes) + fritos da cozinha (chamussas, rissóis, etc.) */
function isFastFood(p: { nome: string; categoria: string }): boolean {
  if (p.categoria === "Salgado") return true;
  return p.categoria === "Entrada" && /chamu|riss|cochinho|spring/i.test(p.nome);
}

function CarrosselFastFood({ produtos, cart, onAdd, onSub, onAcomp }: {
  produtos: Array<{ id: number; nome: string; categoria: string; preco: number; foto?: string | null; ingredientes?: string | null }>;
  cart: CarrinhoItem[];
  onAdd: (p: any, obs?: string) => void;
  onSub: (id: number) => void;
  onAcomp: (p: any) => void;
}) {
  const itens = produtos.filter(isFastFood);
  if (itens.length === 0) return null;
  const qtdDe = (id: number) => cart.filter((i) => i.produtoId === id).reduce((a, i) => a + i.qtd, 0);
  return (
    <div style={{ margin: "0 -12px 14px", padding: "12px 0 6px", background: "linear-gradient(135deg,#fff6e8,#ffe9d2)", borderRadius: 18, border: "1px solid rgba(200,120,20,.18)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 16px 10px" }}>
        <span style={{ fontSize: 20 }}>🔥</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 800, fontSize: 15, color: "#7a3c00" }}>Fast Food — os mais pedidos!</div>
          <div style={{ fontSize: 12, color: "#9a6a30" }}>Preparação rápida · peça já e receba num instante</div>
        </div>
        <span style={{ fontSize: 11, fontWeight: 700, color: "#b45b00", background: "#ffe3bd", borderRadius: 999, padding: "3px 10px" }}>⚡ rápido</span>
      </div>
      <div style={{
        display: "flex", gap: 12, overflowX: "auto", padding: "2px 16px 10px",
        scrollSnapType: "x mandatory", WebkitOverflowScrolling: "touch",
      }}>
        {itens.map((p) => {
          const q = qtdDe(p.id);
          return (
            <div key={p.id} className="c-card" style={{
              scrollSnapAlign: "start", flex: "0 0 178px", margin: 0, padding: 0, overflow: "hidden",
              borderRadius: 16, border: q > 0 ? "2px solid #e07b00" : "1px solid rgba(200,120,20,.25)",
              boxShadow: "0 4px 14px rgba(180,100,20,.14)", background: "#fff",
              display: "flex", flexDirection: "column",
            }}>
              <div style={{ position: "relative" }}>
                <img src={fotoProduto(p)} alt={p.nome} loading="lazy" style={{ width: "100%", height: 104, objectFit: "cover", display: "block" }} />
                <span style={{
                  position: "absolute", top: 6, left: 6, background: "rgba(224,123,0,.95)", color: "#fff",
                  fontSize: 10, fontWeight: 800, borderRadius: 999, padding: "2px 8px", letterSpacing: .3,
                }}>🔥 POPULAR</span>
                {q > 0 && (
                  <span style={{
                    position: "absolute", top: 6, right: 6, background: "var(--roxo)", color: "#fff",
                    borderRadius: 999, minWidth: 22, height: 22, padding: "0 6px", display: "flex",
                    alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 800,
                  }}>{q}</span>
                )}
              </div>
              <div style={{ padding: "8px 10px 10px", display: "flex", flexDirection: "column", flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 12.5, lineHeight: 1.2, flex: 1 }}>{p.nome}
                  {p.ingredientes && (
                    <div style={{ fontWeight: 400, fontStyle: "italic", fontSize: 10.5, color: "#8a7a9a", marginTop: 2, lineHeight: 1.25 }}>{p.ingredientes}</div>
                  )}
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6, gap: 4 }}>
                  <b style={{ color: "#b45b00", fontSize: 12, background: "#ffedd6", borderRadius: 999, padding: "2px 8px", whiteSpace: "nowrap" }}>{mt(p.preco)}</b>
                  {q === 0 ? (
                    <button className="c-btn c-btn-prim c-btn-peq" style={{ borderRadius: 999, minWidth: 34, background: "#e07b00" }}
                      onClick={() => temAcomp(p.categoria) ? onAcomp(p) : onAdd({ ...p, foto: fotoProduto(p) })}>＋</button>
                  ) : (
                    <span style={{ display: "flex", alignItems: "center", gap: 4, background: "#ffedd6", borderRadius: 999, padding: "2px 3px" }}>
                      <button className="c-btn c-btn-cinza c-btn-peq" style={{ borderRadius: 999, minWidth: 26 }} onClick={() => onSub(p.id)}>−</button>
                      <b style={{ minWidth: 12, textAlign: "center", fontSize: 12.5 }}>{q}</b>
                      <button className="c-btn c-btn-prim c-btn-peq" style={{ borderRadius: 999, minWidth: 26, background: "#e07b00" }}
                        onClick={() => temAcomp(p.categoria) ? onAcomp(p) : onAdd({ ...p, foto: fotoProduto(p) })}>＋</button>
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ============ MENU COM FOTOS ============ */
function MenuLoja({ tipo, mesa, cart, produtos, carregando, direcaoTels, onAdd, onSub, onAddExtra, onVoltar, onCarrinho }: {
  tipo: TipoPedidoOnline; mesa: string; cart: CarrinhoItem[];
  produtos: Array<{ id: number; nome: string; categoria: string; preco: number; foto?: string | null; ingredientes?: string | null }>;
  carregando: boolean; direcaoTels: string;
  onAdd: (p: { id: number; nome: string; preco: number; foto?: string | null }, obs?: string) => void;
  onSub: (id: number) => void; onVoltar: () => void; onCarrinho: () => void;
  onAddExtra: (descricao: string, detalhes: string, qtd: number) => void;
}) {
  const info = TIPOS_PEDIDO_ONLINE.find((t) => t.id === tipo)!;
  const [busca, setBusca] = useState("");
  const [catSel, setCatSel] = useState<string | null>(null); // null = vista de categorias
  const [extraOpen, setExtraOpen] = useState(false);
  const [acompProd, setAcompProd] = useState<{ id: number; nome: string; categoria: string; preco: number; foto?: string | null; ingredientes?: string | null } | null>(null);
  const [acompObs, setAcompObs] = useState("");

  const pesquisando = busca.trim() !== "";
  const filtrados = useMemo(() => {
    const b = busca.trim().toLowerCase();
    return produtos.filter((p) =>
      (catSel == null || p.categoria === catSel) &&
      (b === "" || p.nome.toLowerCase().includes(b) || p.categoria.toLowerCase().includes(b)));
  }, [produtos, busca, catSel]);

  const cats = useMemo(() => {
    const m = new Map<string, typeof filtrados>();
    for (const p of filtrados) { const a = m.get(p.categoria) ?? []; a.push(p); m.set(p.categoria, a); }
    return [...m.entries()];
  }, [filtrados]);
  // cartões de categoria: capa = foto do 1º produto da categoria (há sempre imagem via fotoProduto)
  const catCards = useMemo(() => {
    const m = new Map<string, { n: number; foto: string }>();
    for (const p of produtos) {
      const e = m.get(p.categoria);
      if (e) { e.n += 1; continue; }
      m.set(p.categoria, { n: 1, foto: fotoProduto(p) });
    }
    return [...m.entries()];
  }, [produtos]);
  const qtdDe = (id: number) => cart.filter((i) => i.produtoId === id).reduce((a2, i) => a2 + i.qtd, 0);

  return (
    <div>
      <button className="c-btn c-btn-cinza c-btn-peq" onClick={onVoltar} style={{ marginBottom: 10 }}>← Voltar</button>
      <div className="c-titulo">{info.icon} {info.rotulo}{mesa && tipo === "Local" ? ` — Mesa ${mesa}` : ""}</div>

      {tipo === "Delivery" && (
        <div className="c-card" style={{ background: "#fdf3dd", fontSize: 13 }}>
          🛵 Entregas ao domicílio apenas para <b>comidas e bebidas</b>.<br />
          🏊 Piscina, Parque e 🎪 Salão não estão disponíveis para delivery.<br />
          📞 <b>Para reserva de Salão</b>, contacte a Direcção: <b>{direcaoTels}</b>
        </div>
      )}
      {tipo === "Reserva" && (
        <div className="c-card" style={{ background: "#e7effc", fontSize: 13 }}>
          📅 Reserva para consumo numa data futura. No pagamento, <b>você escolhe quanto depositar</b> — o valor recomendado é <b>50%</b>.
        </div>
      )}

      {/* barra fixa: pesquisa + categorias deslizantes */}
      <div style={{
        position: "sticky", top: 0, zIndex: 40, margin: "0 -12px 10px", padding: "8px 12px 10px",
        background: "rgba(253,250,255,.92)", backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)",
        borderBottom: "1px solid rgba(90,40,120,.10)", boxShadow: "0 4px 14px rgba(60,20,90,.06)",
      }}>
        <div style={{ position: "relative", marginBottom: 8 }}>
          <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", fontSize: 15, opacity: .6 }}>🔍</span>
          <input
            className="c-input" style={{ paddingLeft: 38, borderRadius: 999 }} placeholder="Pesquisar no menu…"
            value={busca} onChange={(e) => setBusca(e.target.value)}
          />
        </div>
        {catSel != null && (
          <button className="c-btn c-btn-cinza c-btn-peq" onClick={() => { setCatSel(null); setBusca(""); }}>
            ← Todas as categorias
          </button>
        )}
      </div>

      {/* carrossel Fast Food — induz a compra dos produtos de preparação rápida */}
      {tipo !== "Reserva" && !pesquisando && catSel == null && (
        <CarrosselFastFood produtos={produtos} cart={cart}
          onAdd={(pp, obs) => onAdd(pp, obs)} onSub={onSub} onAcomp={(pp) => setAcompProd(pp)} />
      )}

      {/* pedido especial fora do menu */}
      <button className="c-btn c-btn-linha c-btn-bloco" style={{ marginBottom: 6 }} onClick={() => setExtraOpen(!extraOpen)}>
        ✳️ Pedido especial — algo que não está no menu…
      </button>
      {extraOpen && <ExtraLojaCard onAdd={(d, det, q) => { onAddExtra(d, det, q); setExtraOpen(false); }} onFechar={() => setExtraOpen(false)} />}

      {carregando && <p className="c-sub">A carregar o menu…</p>}

      {/* ===== VISTA DE CATEGORIAS (os produtos abrem ao tocar na categoria) ===== */}
      {!carregando && !pesquisando && catSel == null && produtos.length > 0 && (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "14px 0 8px" }}>
            <span style={{
              width: 4, height: 20, borderRadius: 4, flexShrink: 0,
              background: "linear-gradient(180deg,var(--roxo),var(--rosa,#d6478f))",
            }} />
            <span style={{ fontWeight: 800, fontSize: 15.5, letterSpacing: .2 }}>🍽️ Menu por categoria</span>
            <span className="c-sub" style={{ fontSize: 11.5 }}>toque para ver os produtos</span>
            <span style={{ flex: 1, height: 1, background: "rgba(90,40,120,.12)" }} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(150px,1fr))", gap: 12 }}>
            {catCards.map(([cat, cc]) => (
              <button key={cat} type="button" onClick={() => setCatSel(cat)}
                style={{ border: "none", padding: 0, background: "none", textAlign: "left", cursor: "pointer" }}>
                <div className="camis-prod" style={{
                  borderRadius: 16, overflow: "hidden", background: "#fff",
                  border: "1px solid rgba(90,40,120,.10)", boxShadow: "0 2px 8px rgba(60,20,90,.07)",
                  transition: "transform .15s ease, box-shadow .15s ease",
                }}>
                  <img src={cc.foto} alt={cat} loading="lazy" style={{ width: "100%", height: 108, objectFit: "cover", display: "block" }} />
                  <div style={{ padding: "9px 12px 11px" }}>
                    <div style={{ fontWeight: 800, fontSize: 14, color: "var(--roxo)" }}>{cat}</div>
                    <div className="c-sub" style={{ fontSize: 11.5, marginTop: 1 }}>
                      {cc.n} {cc.n === 1 ? "item" : "itens"} · tocar para ver →
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </>
      )}

      {/* ===== VISTA DE PRODUTOS (categoria escolhida ou pesquisa) ===== */}
      {!carregando && (pesquisando || catSel != null) && filtrados.length === 0 && produtos.length > 0 && (
        <p className="c-sub" style={{ textAlign: "center", padding: "18px 0" }}>
          Nada encontrado para «{busca || catSel}». Tente outra pesquisa ou peça um <b>pedido especial ✳️</b> acima.
        </p>
      )}
      {(pesquisando || catSel != null) && cats.map(([cat, its], ci) => (
        <div key={cat}>
          <div style={{
            display: "flex", alignItems: "center", gap: 10, margin: "18px 0 4px",
          }}>
            <span style={{
              width: 4, height: 20, borderRadius: 4, flexShrink: 0,
              background: "linear-gradient(180deg,var(--roxo),var(--rosa,#d6478f))",
            }} />
            <span style={{ fontWeight: 800, fontSize: 15.5, letterSpacing: .2 }}>{cat}</span>
            <span className="c-sub" style={{ fontSize: 11.5 }}>{its.length} {its.length === 1 ? "item" : "itens"}</span>
            <span style={{ flex: 1, height: 1, background: "rgba(90,40,120,.12)" }} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(160px,1fr))", gap: 12 }}>
            {its.map((p) => {
              const q = qtdDe(p.id);
              return (
                <div key={p.id} className="c-card camis-prod" style={{
                  margin: 0, padding: 0, overflow: "hidden", display: "flex", flexDirection: "column",
                  borderRadius: 16, border: q > 0 ? "2px solid var(--roxo)" : "1px solid rgba(90,40,120,.10)",
                  boxShadow: q > 0 ? "0 6px 18px rgba(90,40,120,.18)" : "0 2px 8px rgba(60,20,90,.07)",
                  transition: "transform .15s ease, box-shadow .15s ease",
                }}>
                  <div style={{ position: "relative" }}>
                    <img src={fotoProduto(p)} alt={p.nome} loading="lazy" style={{ width: "100%", height: 118, objectFit: "cover", display: "block" }} />
                    {q > 0 && (
                      <span style={{
                        position: "absolute", top: 8, right: 8, background: "var(--roxo)", color: "#fff",
                        borderRadius: 999, minWidth: 24, height: 24, padding: "0 7px", display: "flex",
                        alignItems: "center", justifyContent: "center", fontSize: 12.5, fontWeight: 800,
                        boxShadow: "0 2px 6px rgba(0,0,0,.25)",
                      }}>{q}</span>
                    )}
                  </div>
                  <div style={{ padding: "10px 12px 12px", display: "flex", flexDirection: "column", flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 13.5, lineHeight: 1.25, flex: 1 }}>{p.nome}
                      {p.ingredientes && (
                        <div style={{ fontWeight: 400, fontStyle: "italic", fontSize: 11, color: "#8a7a9a", marginTop: 2, lineHeight: 1.3 }}>{p.ingredientes}</div>
                      )}
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8, gap: 6 }}>
                      <b style={{
                        color: "var(--roxo)", fontSize: 13, background: "var(--lilas)",
                        borderRadius: 999, padding: "3px 10px", whiteSpace: "nowrap",
                      }}>{mt(p.preco)}</b>
                      {q === 0 ? (
                        <button className="c-btn c-btn-prim c-btn-peq" style={{ borderRadius: 999, minWidth: 40 }}
                          onClick={() => temAcomp(p.categoria) ? setAcompProd(p) : onAdd({ ...p, foto: fotoProduto(p) })}>＋</button>
                      ) : (
                        <span style={{
                          display: "flex", alignItems: "center", gap: 6, background: "var(--lilas)",
                          borderRadius: 999, padding: "2px 4px",
                        }}>
                          <button className="c-btn c-btn-cinza c-btn-peq" style={{ borderRadius: 999, minWidth: 30 }} onClick={() => onSub(p.id)}>−</button>
                          <b style={{ minWidth: 14, textAlign: "center" }}>{q}</b>
                          <button className="c-btn c-btn-prim c-btn-peq" style={{ borderRadius: 999, minWidth: 30 }}
                            onClick={() => temAcomp(p.categoria) ? setAcompProd(p) : onAdd({ ...p, foto: fotoProduto(p) })}>＋</button>
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
      {acompProd && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 90, background: "rgba(20,8,26,.55)",
          display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
        }}>
          <div className="c-card" style={{ maxWidth: 400, width: "100%" }}>
            <div style={{ fontWeight: 800, fontSize: 15 }}>🍽 {acompProd.nome}</div>
            {acompProd.ingredientes && (
              <p className="c-sub" style={{ background: "var(--lilas)", borderRadius: 10, padding: "6px 10px" }}>
                🧾 <b>Ingredientes:</b> {acompProd.ingredientes}
              </p>
            )}
            <p className="c-sub">Escolha os acompanhamentos do prato:</p>
            <AcompSel categoria={acompProd.categoria} onChange={setAcompObs} />
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button className="c-btn c-btn-cinza" style={{ flex: 1 }} onClick={() => { setAcompProd(null); setAcompObs(""); }}>Cancelar</button>
              <button className="c-btn c-btn-prim" style={{ flex: 2 }}
                onClick={() => { onAdd({ ...acompProd, foto: fotoProduto(acompProd) }, acompObs || undefined); setAcompProd(null); setAcompObs(""); }}>
                ＋ Adicionar
              </button>
            </div>
          </div>
        </div>
      )}
      {!carregando && produtos.length === 0 && <p className="c-sub">Sem produtos disponíveis de momento.</p>}
      <div style={{ height: 8 }} />
      <span style={{ display: "none" }} onClick={onCarrinho} />
    </div>
  );
}

/* ============ PEDIDO ESPECIAL (FORA DO MENU) — CLIENTE ============ */
function ExtraLojaCard({ onAdd, onFechar }: {
  onAdd: (descricao: string, detalhes: string, qtd: number) => void; onFechar: () => void;
}) {
  const [desc, setDesc] = useState("");
  const [detalhes, setDetalhes] = useState("");
  const [qtd, setQtd] = useState(1);
  return (
    <div className="c-card" style={{ background: "#f3ecfa", border: "1.5px dashed var(--roxo2)" }}>
      <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 4 }}>✳️ Pedido especial (fora do menu)</div>
      <p className="c-sub" style={{ margin: "0 0 8px" }}>
        Descreva o item ou serviço que pretende (ex.: bolo de aniversário, decoração extra).
        O <b>restaurante define o preço</b> e envia-lhe a cotação — só depois de <b>aceitar</b> é que o valor entra na sua conta e segue para pagamento.
      </p>
      <label className="c-label">O que pretende? *</label>
      <input className="c-input" placeholder="Ex.: Bolo de aniversário de chocolate" value={desc} onChange={(e) => setDesc(e.target.value)} />
      <label className="c-label">Detalhes do pedido (tamanho, sabor, cores, data, etc.)</label>
      <textarea className="c-textarea" rows={2} placeholder="Ex.: 2 kg, cobertura de morango, com o nome «Ana»…"
        value={detalhes} onChange={(e) => setDetalhes(e.target.value)} />
      <div style={{ width: 140 }}>
        <label className="c-label">Quantidade</label>
        <input className="c-input" type="number" inputMode="numeric" min={1}
          value={qtd} onChange={(e) => setQtd(Math.max(1, Math.round(+e.target.value || 1)))} />
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button className="c-btn c-btn-cinza" style={{ flex: 1 }} onClick={onFechar}>Cancelar</button>
        <button className="c-btn c-btn-prim" style={{ flex: 2 }}
          disabled={desc.trim().length < 2}
          onClick={() => onAdd(desc.trim(), detalhes.trim(), qtd)}>
          ＋ Adicionar (preço a cotar)
        </button>
      </div>
    </div>
  );
}

/* ============ CARRINHO ============ */
function Carrinho({ cart, tipo, taxaDelivery, onAddIdx, onSubIdx, onVoltar, onAvancar }: {
  cart: CarrinhoItem[]; tipo: TipoPedidoOnline; taxaDelivery: number;
  onAddIdx: (idx: number) => void; onSubIdx: (idx: number) => void;
  onVoltar: () => void; onAvancar: () => void;
}) {
  const subtotal = cart.reduce((a, i) => a + i.preco * i.qtd, 0);
  const taxa = tipo === "Delivery" ? Math.max(100, taxaDelivery || 100) : 0; // mín. 100 — paga ao entregador
  // o desconto de afiliado aplica-se no passo do pagamento (aí o cliente indica o código)
  const total = subtotal;
  const adiant = tipo === "Reserva" ? total * 0.5 : 0;
  const temEspeciais = cart.some((i) => i.personalizado);
  return (
    <div>
      <button className="c-btn c-btn-cinza c-btn-peq" onClick={onVoltar} style={{ marginBottom: 10 }}>← Continuar a escolher</button>
      <div className="c-titulo">🛒 O seu pedido — {rotuloTipo(tipo)}</div>
      <div className="c-card">
        {cart.map((i, idx) => (
          <div key={i.produtoId + "_" + (i.obs ?? "") + "_" + idx} style={{ borderBottom: "1px solid #f0e6f2", padding: "7px 0" }}>
            <div className="c-linha" style={{ border: "none", padding: 0 }}>
              <div className="grow tit">{i.personalizado ? "✳️ " : ""}{i.qtd}× {i.nome}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {i.personalizado
                  ? <span className="c-chip c-chip-amarelo" style={{ fontSize: 11 }}>preço a cotar</span>
                  : <span>{mt(i.preco * i.qtd)}</span>}
                <button className="c-btn c-btn-cinza c-btn-peq" onClick={() => onSubIdx(idx)}>−</button>
                {!i.personalizado && <button className="c-btn c-btn-linha c-btn-peq" onClick={() => onAddIdx(idx)}>＋</button>}
              </div>
            </div>
            {i.personalizado && i.detalhes && <div className="c-sub" style={{ marginTop: 2 }}>📝 {i.detalhes}</div>}
            {i.obs && <div className="c-sub" style={{ marginTop: 2, color: "var(--verde-c)", fontWeight: 600 }}>🍽 {i.obs}</div>}
          </div>
        ))}
        {cart.length === 0 && <p className="c-sub">O carrinho está vazio.</p>}
        {temEspeciais && (
          <p className="c-sub" style={{ margin: "8px 0 0" }}>
            ✳️ Os itens especiais serão <b>cotados pelo restaurante</b> — receberá a proposta de preço na página «Acompanhar Pedido» e só depois de aceitar segue para o pagamento.
          </p>
        )}
      </div>
      {cart.length > 0 && (
        <div className="c-card">
          <div className="c-total-linha"><span>Subtotal</span><b>{mt(subtotal)}</b></div>
          <div className="c-sub" style={{ fontSize: 11.5, margin: "2px 0" }}>🤝 Tem código de afiliado? Indique-o no pagamento e ganhe {LOJA_DESCONTO_PCT}% de desconto.</div>
          {tipo === "Delivery" && (
            <>
              <div className="c-total-linha"><span>🛵 Taxa de entrega (a partir de)</span><b>{mt(taxa)}</b></div>
              <div className="c-sub" style={{ fontSize: 11.5, margin: "-2px 0 4px" }}>
                O restaurante confirma o valor final conforme o seu bairro <b>antes do pedido sair</b> — a taxa é <b>paga ao entregador na entrega</b> e não entra no total abaixo.
              </div>
            </>
          )}
          <div className="c-total-linha" style={{ fontSize: 17 }}><span>Total a pagar ao restaurante</span><b style={{ color: "var(--roxo)" }}>{mt(total)}</b></div>
          {tipo === "Reserva" && (
            <div className="c-total-linha"><span>Depósito estimado (50% — ajustável no passo seguinte)</span><b style={{ color: "var(--verde-c)" }}>{mt(adiant)}</b></div>
          )}
          <button className="c-btn c-btn-prim c-btn-bloco" style={{ marginTop: 10 }} onClick={onAvancar}>
            Continuar para pagamento →
          </button>
        </div>
      )}
    </div>
  );
}

/* ============ PAGAMENTO + COMPROVATIVO ============ */
/* ============ RESERVA ONLINE — por número de pessoas (pratos escolhidos no local) ============ */
function ReservaFlow({ cliente, token, onVoltar, onCriado }: {
  cliente: { nome: string; telefone: string } | null; token: string;
  onVoltar: () => void; onCriado: (p: PedidoCriado, tel: string) => void;
}) {
  const emp = useEmpresa();
  const [nome, setNome] = useState(cliente?.nome ?? "");
  const [tel, setTel] = useState(cliente?.telefone ?? "");
  const [dataAgendada, setDataAgendada] = useState("");
  const [horaAgendada, setHoraAgendada] = useState("");
  const [area, setArea] = useState("");
  const [pessoas, setPessoas] = useState(2);
  const [adiantValor, setAdiantValor] = useState<number | null>(null); // null = 50% (recomendado)
  const [afCodigo, setAfCodigo] = useState(() => refGuardado()?.codigo ?? "");
  const { ref: refAf, limpar: limparRefAf } = useRefAfiliado(setAfCodigo);
  const [erro, setErro] = useState("");

  const taxaRes = taxaReservaPessoa(area); // Salão 1.º andar: 500 MZN; outros espaços: 400 MZN
  const totalBruto = pessoas * taxaRes;
  const descontoRes = afCodigo.trim() ? Math.round(totalBruto * LOJA_DESCONTO_PCT / 100 * 100) / 100 : 0; // só com código de afiliado
  const total = Math.round((totalBruto - descontoRes) * 100) / 100;
  const adiant = adiantValor != null
    ? Math.min(total, Math.max(0, Math.round(adiantValor * 100) / 100))
    : Math.round(total * 0.5 * 100) / 100;
  const pct = total > 0 ? Math.round((adiant / total) * 100) : 0;

  const criar = trpc.loja.criarPedido.useMutation({
    onSuccess: (r) => onCriado(r, tel.replace(/\D/g, "")),
    onError: (e) => setErro(e.message),
  });

  return (
    <div>
      <button className="c-btn c-btn-cinza c-btn-peq" onClick={onVoltar} style={{ marginBottom: 10 }}>← Voltar</button>
      <div className="c-titulo">📅 Reserva de mesa / grupo</div>

      <div className="c-card" style={{ background: "#e7effc", fontSize: 13 }}>
        🎉 <b>Celebre a vida a subir</b> — aniversário, baptizado, confraternização: garanta o seu lugar sem sair de Chimoio.<br />
        🎟 A reserva é feita pelo <b>número de pessoas</b>: {mt(TAXA_RESERVA_PESSOA)} por pessoa
        (<b>{mt(500)}</b> no Salão primeiro andar).
        <b>Você escolhe quanto depositar</b> — o valor recomendado é <b>50%</b> (consumível — desconta no que consumir no dia).<br />
        🍽️ <b>A escolha dos pratos será feita no local, durante o consumo.</b> Faltando 6 horas
        para a reserva, poderá confirmar a sua vinda e, se quiser, pré-seleccionar os pratos na
        página «Acompanhar Pedido» — ou ligar <b>{emp.tel1}</b>.
      </div>

      <div className="c-card">
        <label className="c-label">O seu nome *</label>
        <input className="c-input" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome completo" />
        <label className="c-label">Telefone com WhatsApp *</label>
        <TelInput value={tel} onChange={setTel} required />
        <div style={{ display: "flex", gap: 10 }}>
          <div style={{ flex: 1 }}>
            <label className="c-label">Data da reserva *</label>
            <input className="c-input" type="date" min={hoje()} value={dataAgendada} onChange={(e) => setDataAgendada(e.target.value)} />
          </div>
          <div style={{ flex: 1 }}>
            <label className="c-label">Hora (aprox.)</label>
            <input className="c-input" type="time" value={horaAgendada} onChange={(e) => setHoraAgendada(e.target.value)} />
          </div>
        </div>
        <label className="c-label">Número de pessoas *</label>
        <div style={{ display: "flex", alignItems: "center", gap: 14, justifyContent: "center", padding: "6px 0" }}>
          <button className="c-btn c-btn-cinza" style={{ width: 46, fontSize: 20 }}
            onClick={() => setPessoas((n) => Math.max(1, n - 1))}>−</button>
          <span style={{ fontSize: 26, fontWeight: 800, minWidth: 60, textAlign: "center" }}>{pessoas}</span>
          <button className="c-btn c-btn-cinza" style={{ width: 46, fontSize: 20 }}
            onClick={() => setPessoas((n) => Math.min(500, n + 1))}>+</button>
        </div>
        <p className="c-sub" style={{ textAlign: "center", margin: 0 }}>
          {pessoas} {pessoas === 1 ? "pessoa" : "pessoas"} × {mt(taxaRes)}{area === "Salão primeiro andar" ? " (Salão 1.º andar)" : ""}
        </p>
        <label className="c-label" style={{ marginTop: 10 }}>🪑 Onde pretende sentar? *</label>
        <select className="c-select" value={area} onChange={(e) => setArea(e.target.value)}>
          <option value="">— Seleccione o espaço —</option>
          {AREAS_ESTAR.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
      </div>

      <div className="c-card" style={{ background: "var(--lilas)" }}>
        <div className="c-titulo" style={{ fontSize: 15 }}>💰 Como pagar</div>
        <div className="c-linha"><div className="grow tit">Transferência eMola</div><b>{emp.emola}</b></div>
        <div className="c-linha"><div className="grow tit">Titular</div><span>{emp.titular}</span></div>
        <div className="c-linha"><div className="grow tit">Levantamento eMola</div><b>{emp.emolaLev}</b></div>
        <div className="c-linha"><div className="grow tit">{emp.banco}</div><b>{emp.conta}</b></div>
        <div className="c-linha"><div className="grow tit">Titular</div><span>{emp.beneficiario}</span></div>
        <hr style={{ border: "none", borderTop: "1px dashed #b9a6d9" }} />
        <div className="c-total-linha"><span>Total da reserva ({pessoas} × {mt(taxaRes)})</span><span>{mt(totalBruto)}</span></div>
        {descontoRes > 0 && <div className="c-total-linha"><span>🤝 Desconto de afiliado ({LOJA_DESCONTO_PCT}%)</span><b style={{ color: "var(--verde-c)" }}>− {mt(descontoRes)}</b></div>}
        <div className="c-total-linha" style={{ fontSize: 15 }}><span>Total a pagar</span><b>{mt(total)}</b></div>
        <div style={{ background: "#fff", borderRadius: 10, padding: 10, marginTop: 6 }}>
          <label className="c-label" style={{ marginTop: 0 }}>💵 Quanto quer depositar agora? (MZN)</label>
          <input
            className="c-input" type="number" inputMode="decimal" min={0} step="0.01"
            placeholder={String(Math.round(total * 0.5 * 100) / 100)}
            value={adiantValor ?? ""}
            onChange={(e) => setAdiantValor(e.target.value === "" ? null : +e.target.value)}
          />
          <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
            {[50, 75, 100].map((p2) => (
              <button key={p2} type="button" className="c-btn c-btn-cinza c-btn-peq"
                onClick={() => setAdiantValor(Math.round(total * p2) / 100)}>{p2}%</button>
            ))}
          </div>
          <div style={{
            fontSize: 12.5, marginTop: 6, fontWeight: 600, lineHeight: 1.4,
            color: pct < 50 ? "#b3261e" : pct === 50 ? "#15803d" : "#1d4ed8",
          }}>
            {pct < 50
              ? `⛔ Depósito de ${pct}% — na loja online o mínimo é 50% (${mt(total * 0.5)}).`
              : pct === 50
                ? `✅ Depósito de 50% — o valor recomendado.`
                : pct < 100
                  ? `💙 Depósito de ${pct}% — acima do recomendado. Obrigado pela confiança!`
                  : `✅ Pagamento integral (100%). Obrigado!`}
          </div>
        </div>
        <div className="c-total-linha" style={{ fontSize: 16 }}><span>Pagar agora ({pct}%)</span><b style={{ color: "var(--verde-c)" }}>{mt(adiant)}</b></div>
        <div className="c-total-linha"><span>Remanescente (no local, no dia)</span><b>{mt(total - adiant)}</b></div>
        <p className="c-sub" style={{ marginTop: 6 }}>
          O remanescente é pago no local, no dia do consumo — o adiantamento desconta no que consumir.
          Após pagar, envie o <b>comprovativo</b> no passo seguinte e aguarde a confirmação do restaurante.
        </p>
      </div>

      <CampoAfiliado ref_={refAf} limpar={limparRefAf} afCodigo={afCodigo} setAfCodigo={setAfCodigo} />
      {erro && <p style={{ color: "var(--vermelho-c)", fontSize: 13 }}>⚠️ {erro}</p>}
      <button className="c-btn c-btn-prim c-btn-bloco" disabled={criar.isPending}
        onClick={() => {
          setErro("");
          const telDigits = tel.replace(/\D/g, "");
          if (nome.trim().length < 2 || telDigits.length < 9) { setErro("Indique o seu nome e telefone com WhatsApp (9 dígitos)."); return; }
          if (!dataAgendada) { setErro("Indique a data da reserva."); return; }
          if (dataAgendada < hoje()) { setErro("A data da reserva não pode ser no passado."); return; }
          if (!area) { setErro("Seleccione onde pretende sentar (ex.: Jardim, Salão Rés-do-chão, Área da Piscina…)."); return; }
          if (adiant <= 0) { setErro("Indique o valor do depósito (mínimo: 50% = " + mt(total * 0.5) + ")."); return; }
          if (adiant < total * 0.5 - 0.01) { setErro("Na loja online o depósito mínimo da reserva é 50% (" + mt(total * 0.5) + ")."); return; }
          criar.mutate({
            token: token || undefined, clienteNome: nome, clienteTelefone: telDigits,
            tipo: "Reserva",
            dataAgendada, horaAgendada: horaAgendada || undefined, pessoas,
            area,
            adiantValor: adiant,
            itens: [], extras: [],
            afiliadoCodigo: afCodigo.trim() || undefined,
          });
        }}>
        {criar.isPending ? "A registar…" : `✅ Reservar — pagar ${mt(adiant)}`}
      </button>
    </div>
  );
}

/* ============ BUFFET ONLINE — pacotes por pessoa (menu fechado, depósito como reserva) ============ */
/* ícone sugerido para cada secção do menu de buffet (pelo nome) */
function buffetCatIcone(nome: string): string {
  const n = nome.toLowerCase();
  if (n.includes("entrada") || n.includes("salgad")) return "🥟";
  if (n.includes("principal") || n.includes("prato") || n.includes("carne") || n.includes("peixe")) return "🍗";
  if (n.includes("guarni") || n.includes("acompanha")) return "🍚";
  if (n.includes("salada")) return "🥗";
  if (n.includes("sobremesa") || n.includes("doce")) return "🍮";
  if (n.includes("bebida")) return "🥤";
  return "🍽";
}

/* Menu do pacote por secções (Menus do Chefe 2026); sem secções → lista plana */
function MenuBuffetSeccoes({ pac }: { pac: { itens: string[]; categorias?: { nome: string; itens: string[] }[] | null } }) {
  const cats = pac.categorias ?? [];
  if (cats.length === 0) {
    return (
      <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
        {pac.itens.map((it, i) => (
          <span key={i} style={{
            background: "#f7f1fc", border: "1px solid #e4d5ef", borderRadius: 999,
            padding: "2px 9px", fontSize: 12, fontWeight: 600,
          }}>{it}</span>
        ))}
      </div>
    );
  }
  return (
    <div style={{ display: "grid", gap: 7 }}>
      {cats.map((c, i) => (
        <div key={i}>
          <div style={{ fontSize: 10.5, fontWeight: 800, color: "var(--roxo2)", letterSpacing: .4, marginBottom: 3 }}>
            {buffetCatIcone(c.nome)} {c.nome.toUpperCase()}
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

function BuffetFlow({ cliente, token, onVoltar, onCriado }: {
  cliente: { nome: string; telefone: string } | null; token: string;
  onVoltar: () => void; onCriado: (p: PedidoCriado, tel: string) => void;
}) {
  const emp = useEmpresa();
  const pacotesQ = trpc.buffet.list.useQuery();
  const pacotes = pacotesQ.data ?? [];
  const [pacoteId, setPacoteId] = useState<number | null>(null);
  const [nome, setNome] = useState(cliente?.nome ?? "");
  const [tel, setTel] = useState(cliente?.telefone ?? "");
  const [dataAgendada, setDataAgendada] = useState("");
  const [horaAgendada, setHoraAgendada] = useState("");
  const [area, setArea] = useState("");
  const [pessoas, setPessoas] = useState(20);
  const [adiantValor, setAdiantValor] = useState<number | null>(null); // null = 50% (recomendado)
  const [afCodigo, setAfCodigo] = useState(() => refGuardado()?.codigo ?? "");
  const { ref: refAf, limpar: limparRefAf } = useRefAfiliado(setAfCodigo);
  const [erro, setErro] = useState("");
  // ajuste do menu: o cliente envia uma proposta e aguarda a resposta da equipa (cotação)
  const [ajustarAberto, setAjustarAberto] = useState(false);
  const [proposta, setProposta] = useState("");

  const pac = pacotes.find((x) => x.id === pacoteId) ?? null;
  const totalBruto = pac ? Math.round(pessoas * pac.preco * 100) / 100 : 0;
  const descontoRes = afCodigo.trim() ? Math.round(totalBruto * LOJA_DESCONTO_PCT / 100 * 100) / 100 : 0; // só com código de afiliado
  const total = Math.round((totalBruto - descontoRes) * 100) / 100;
  const adiant = adiantValor != null
    ? Math.min(total, Math.max(0, Math.round(adiantValor * 100) / 100))
    : Math.round(total * 0.5 * 100) / 100;
  const pct = total > 0 ? Math.round((adiant / total) * 100) : 0;

  const criar = trpc.loja.criarPedido.useMutation({
    onSuccess: (r) => onCriado(r, tel.replace(/\D/g, "")),
    onError: (e) => setErro(e.message),
  });

  return (
    <div>
      <button className="c-btn c-btn-cinza c-btn-peq" onClick={onVoltar} style={{ marginBottom: 10 }}>← Voltar</button>
      <div className="c-titulo">🍽 Buffet para grupos & eventos</div>

      <div className="c-card" style={{ background: "#f5f0fc", fontSize: 13 }}>
        🎉 <b>Entregue-nos a data. Receba o aplauso.</b> Casamentos, aniversários e eventos com menu fechado — você é o anfitrião, nós tratamos de tudo.<br />
        🍽 Escolha um <b>pacote por pessoa</b> — o menu já está fechado, sem preocupações.
        O valor é <b>pessoas × preço do pacote</b> e o depósito mínimo é <b>50%</b> (consumível — desconta no total).
      </div>

      {/* 1. pacote */}
      <label className="c-label">1. Escolha o pacote *</label>
      {pacotesQ.isLoading && <div className="c-card c-sub">A carregar pacotes…</div>}
      <div style={{ display: "grid", gap: 10, marginBottom: 10 }}>
        {pacotes.map((pk) => (
          <button key={pk.id} type="button" className="c-card"
            style={{
              textAlign: "left", cursor: "pointer", margin: 0, padding: 0, overflow: "hidden",
              border: pacoteId === pk.id ? "2.5px solid var(--roxo)" : "1.5px solid transparent",
              boxShadow: pacoteId === pk.id ? "0 6px 18px rgba(94,20,96,.22)" : undefined,
              transform: pacoteId === pk.id ? "scale(1.01)" : undefined,
              transition: "all .15s ease",
            }}
            onClick={() => setPacoteId(pk.id)}>
            {/* imagem do pacote — banho-marias com os pratos incluídos */}
            <div style={{
              position: "relative", height: 140,
              background: pk.foto
                ? `url(${pk.foto}) center/cover no-repeat`
                : "linear-gradient(120deg,var(--roxo),var(--roxo2))",
            }}>
              <div style={{
                position: "absolute", inset: 0,
                background: "linear-gradient(180deg, rgba(20,4,26,.05) 35%, rgba(20,4,26,.80) 100%)",
              }} />
              <div style={{ position: "absolute", left: 12, bottom: 10, color: "#fff" }}>
                <b style={{ fontSize: 17, textShadow: "0 1px 6px rgba(0,0,0,.55)" }}>🍽 {pk.nome}</b>
                {pk.descricao && <div style={{ fontSize: 11, opacity: .92, textShadow: "0 1px 4px rgba(0,0,0,.5)" }}>{pk.descricao}</div>}
              </div>
              <div style={{
                position: "absolute", right: 10, bottom: 10, background: "rgba(255,255,255,.94)",
                borderRadius: 999, padding: "4px 11px", fontWeight: 800, color: "var(--roxo)", fontSize: 14.5,
                boxShadow: "0 2px 8px rgba(0,0,0,.3)",
              }}>
                {mt(pk.preco)} <span style={{ fontWeight: 500, fontSize: 10.5 }}>/pessoa</span>
              </div>
              {pacoteId === pk.id && (
                <div style={{
                  position: "absolute", top: 10, left: 10, background: "var(--verde-c)", color: "#fff",
                  borderRadius: 999, padding: "3px 11px", fontWeight: 800, fontSize: 12,
                }}>✔ Seleccionado</div>
              )}
            </div>
            <div style={{ padding: "10px 12px 12px" }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: "var(--roxo2)", letterSpacing: .4, marginBottom: 5 }}>
                ✅ INCLUÍDO NESTE PACOTE
              </div>
              <MenuBuffetSeccoes pac={pk} />
            </div>
          </button>
        ))}
      </div>

      {/* ajuste do menu — proposta do cliente */}
      {pac && (
        <div style={{ marginBottom: 10 }}>
          <button type="button" className={`c-btn c-btn-bloco ${ajustarAberto ? "c-btn-prim" : "c-btn-linha"}`}
            onClick={() => setAjustarAberto((a) => !a)}>
            ✏️ Quero ajustar o menu deste pacote (enviar proposta)
          </button>
          {ajustarAberto && (
            <div className="c-card" style={{ marginTop: 8, marginBottom: 0, background: "#fffbe8" }}>
              <label className="c-label" style={{ marginTop: 0 }}>A sua proposta de ajuste</label>
              <textarea className="c-input" rows={3} style={{ resize: "vertical" }}
                placeholder={"Ex.: Tirar a feijoada e acrescentar camarão grelhado; trocar refrescos por vinho…"}
                value={proposta} onChange={(e) => setProposta(e.target.value)} />
              <p className="c-sub" style={{ margin: "6px 0 0" }}>
                📩 A proposta segue com o seu pedido. A nossa equipa analisa, faz a <b>cotação</b> (preço do ajuste)
                e responde-lhe — você <b>aceita ou recusa</b> na página «Acompanhar Pedido» antes de pagar.
              </p>
            </div>
          )}
        </div>
      )}

      {/* 2. dados */}
      <div className="c-card">
        <label className="c-label">O seu nome *</label>
        <input className="c-input" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome completo" />
        <label className="c-label">Telefone com WhatsApp *</label>
        <TelInput value={tel} onChange={setTel} required />
        <div style={{ display: "flex", gap: 10 }}>
          <div style={{ flex: 1 }}>
            <label className="c-label">Data do evento *</label>
            <input className="c-input" type="date" min={hoje()} value={dataAgendada} onChange={(e) => setDataAgendada(e.target.value)} />
          </div>
          <div style={{ flex: 1 }}>
            <label className="c-label">Hora (aprox.)</label>
            <input className="c-input" type="time" value={horaAgendada} onChange={(e) => setHoraAgendada(e.target.value)} />
          </div>
        </div>
        <label className="c-label">Número de pessoas *</label>
        <div style={{ display: "flex", alignItems: "center", gap: 14, justifyContent: "center", padding: "6px 0" }}>
          <button className="c-btn c-btn-cinza" style={{ width: 46, fontSize: 20 }}
            onClick={() => setPessoas((n) => Math.max(1, n - 1))}>−</button>
          <span style={{ fontSize: 26, fontWeight: 800, minWidth: 60, textAlign: "center" }}>{pessoas}</span>
          <button className="c-btn c-btn-cinza" style={{ width: 46, fontSize: 20 }}
            onClick={() => setPessoas((n) => Math.min(500, n + 1))}>+</button>
        </div>
        {pac && (
          <p className="c-sub" style={{ textAlign: "center", margin: 0 }}>
            {pessoas} pessoas × {mt(pac.preco)}
          </p>
        )}
        <label className="c-label" style={{ marginTop: 10 }}>🪑 Onde pretende realizar? *</label>
        <select className="c-select" value={area} onChange={(e) => setArea(e.target.value)}>
          <option value="">— Seleccione o espaço —</option>
          {AREAS_ESTAR.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
      </div>

      {/* 3. pagamento */}
      {pac && (
        <div className="c-card" style={{ background: "var(--lilas)" }}>
          <div className="c-titulo" style={{ fontSize: 15 }}>💰 Como pagar</div>
          <div className="c-linha"><div className="grow tit">Transferência eMola</div><b>{emp.emola}</b></div>
          <div className="c-linha"><div className="grow tit">Titular</div><span>{emp.titular}</span></div>
          <div className="c-linha"><div className="grow tit">Levantamento eMola</div><b>{emp.emolaLev}</b></div>
          <div className="c-linha"><div className="grow tit">{emp.banco}</div><b>{emp.conta}</b></div>
          <div className="c-linha"><div className="grow tit">Titular</div><span>{emp.beneficiario}</span></div>
          <hr style={{ border: "none", borderTop: "1px dashed #b9a6d9" }} />
          <div className="c-total-linha"><span>Total do buffet ({pessoas} × {mt(pac.preco)})</span><span>{mt(totalBruto)}</span></div>
          {descontoRes > 0 && <div className="c-total-linha"><span>🤝 Desconto de afiliado ({LOJA_DESCONTO_PCT}%)</span><b style={{ color: "var(--verde-c)" }}>− {mt(descontoRes)}</b></div>}
          <div className="c-total-linha" style={{ fontSize: 15 }}><span>Total a pagar</span><b>{mt(total)}</b></div>
          <div style={{ background: "#fff", borderRadius: 10, padding: 10, marginTop: 6 }}>
            <label className="c-label" style={{ marginTop: 0 }}>💵 Quanto tem disponível para pagar agora? (MZN) — entre 50% e 100%</label>
            <input
              className="c-input" type="number" inputMode="decimal" min={0} step="0.01"
              placeholder={String(Math.round(total * 0.5 * 100) / 100)}
              value={adiantValor ?? ""}
              onChange={(e) => setAdiantValor(e.target.value === "" ? null : +e.target.value)}
            />
            <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
              {[50, 75, 100].map((p2) => (
                <button key={p2} type="button" className="c-btn c-btn-cinza c-btn-peq"
                  onClick={() => setAdiantValor(Math.round(total * p2) / 100)}>{p2}%</button>
              ))}
            </div>
            <div style={{
              fontSize: 12.5, marginTop: 6, fontWeight: 600, lineHeight: 1.4,
              color: pct < 50 ? "#b3261e" : pct === 50 ? "#15803d" : "#1d4ed8",
            }}>
              {pct < 50
                ? `⛔ Depósito de ${pct}% — na loja online o mínimo é 50% (${mt(total * 0.5)}).`
                : pct === 50
                  ? `✅ Depósito de 50% — o valor recomendado.`
                  : pct < 100
                    ? `💙 Depósito de ${pct}% — acima do recomendado. Obrigado pela confiança!`
                    : `✅ Pagamento integral (100%). Obrigado!`}
            </div>
          </div>
          <div className="c-total-linha" style={{ fontSize: 16 }}><span>Pagar agora ({pct}%)</span><b style={{ color: "var(--verde-c)" }}>{mt(adiant)}</b></div>
          <div className="c-total-linha"><span>Remanescente</span><b>{mt(total - adiant)}</b></div>
          {pct >= 50 && pct < 100 && (
            <div style={{ background: "#fdeceb", border: "1px solid #f2b8b5", borderRadius: 10, padding: "8px 10px", fontSize: 12.5, marginTop: 6, lineHeight: 1.45 }}>
              ⏰ <b>Atenção:</b> recomendamos liquidar o remanescente de <b>{mt(total - adiant)}</b> até <b>48 horas antes do evento</b> — <b>sob pena de não abertura da mesa</b>.
            </div>
          )}
          <p className="c-sub" style={{ marginTop: 6 }}>
            Após pagar, envie o <b>comprovativo</b> no passo seguinte — a equipa confirma o pagamento e a sua
            reserva passa a constar na página de Reservas do restaurante como <b>«Reserva Buffet»</b>.
          </p>
        </div>
      )}

      <CampoAfiliado ref_={refAf} limpar={limparRefAf} afCodigo={afCodigo} setAfCodigo={setAfCodigo} />
      {erro && <p style={{ color: "var(--vermelho-c)", fontSize: 13 }}>⚠️ {erro}</p>}
      <button className="c-btn c-btn-prim c-btn-bloco" disabled={criar.isPending}
        onClick={() => {
          setErro("");
          const telDigits = tel.replace(/\D/g, "");
          if (!pac) { setErro("Escolha um pacote de buffet."); return; }
          if (nome.trim().length < 2 || telDigits.length < 9) { setErro("Indique o seu nome e telefone com WhatsApp (9 dígitos)."); return; }
          if (!dataAgendada) { setErro("Indique a data do evento."); return; }
          if (dataAgendada < hoje()) { setErro("A data do evento não pode ser no passado."); return; }
          if (!area) { setErro("Seleccione o espaço onde pretende realizar o evento."); return; }
          if (adiant <= 0) { setErro("Indique o valor do depósito (mínimo: 50% = " + mt(total * 0.5) + ")."); return; }
          if (adiant < total * 0.5 - 0.01) { setErro("Na loja online o depósito mínimo é 50% (" + mt(total * 0.5) + ")."); return; }
          criar.mutate({
            token: token || undefined, clienteNome: nome, clienteTelefone: telDigits,
            tipo: "Reserva",
            dataAgendada, horaAgendada: horaAgendada || undefined, pessoas,
            area, buffetPacoteId: pac.id,
            adiantValor: adiant,
            itens: [],
            extras: proposta.trim().length >= 5
              ? [{ descricao: `Ajuste ao menu do ${pac.nome}`, detalhes: proposta.trim(), qtd: 1 }]
              : [],
            afiliadoCodigo: afCodigo.trim() || undefined,
          });
        }}>
        {criar.isPending ? "A registar…" : pac ? `🍽 Pedir buffet — pagar ${mt(adiant)}` : "🍽 Escolha primeiro um pacote"}
      </button>
    </div>
  );
}

/* ============ BRAAI ONLINE — o cliente traz os seus produtos (taxa NÃO consumível, 100% antecipado) ============ */
function BraaiFlow({ cliente, token, onVoltar, onCriado }: {
  cliente: { nome: string; telefone: string } | null; token: string;
  onVoltar: () => void; onCriado: (p: PedidoCriado, tel: string) => void;
}) {
  const emp = useEmpresa();
  const [nome, setNome] = useState(cliente?.nome ?? "");
  const [tel, setTel] = useState(cliente?.telefone ?? "");
  const [modalidade, setModalidade] = useState<BraaiModalidade>("A");
  const [traz, setTraz] = useState<BraaiTraz>("Comida");
  const [pessoas, setPessoas] = useState(2);
  const [criancas, setCriancas] = useState(0);
  const [dataAgendada, setDataAgendada] = useState("");
  const [horaAgendada, setHoraAgendada] = useState("");
  const [area, setArea] = useState("");
  const [aceite, setAceite] = useState(false);
  const [afCodigo, setAfCodigo] = useState(() => refGuardado()?.codigo ?? "");
  const { ref: refAf, limpar: limparRefAf } = useRefAfiliado(setAfCodigo);
  const [erro, setErro] = useState("");

  const taxaPessoa = braaiTaxaPessoa(modalidade, pessoas);
  const total = braaiTotal(modalidade, pessoas); // sem desconto — não é consumo
  const horaSaida = horaAgendada
    ? `${String((+horaAgendada.slice(0, 2) + BRAAI_DURACAO_HORAS) % 24).padStart(2, "0")}:${horaAgendada.slice(3)}`
    : null;

  const criar = trpc.loja.criarPedido.useMutation({
    onSuccess: (r) => onCriado(r, tel.replace(/\D/g, "")),
    onError: (e) => setErro(e.message),
  });

  const stepper = (valor: number, set: (n: number) => void, min: number, max: number) => (
    <div style={{ display: "flex", alignItems: "center", gap: 14, justifyContent: "center", padding: "6px 0" }}>
      <button className="c-btn c-btn-cinza" style={{ width: 46, fontSize: 20 }} onClick={() => set(Math.max(min, valor - 1))}>−</button>
      <span style={{ fontSize: 26, fontWeight: 800, minWidth: 60, textAlign: "center" }}>{valor}</span>
      <button className="c-btn c-btn-cinza" style={{ width: 46, fontSize: 20 }} onClick={() => set(Math.min(max, valor + 1))}>+</button>
    </div>
  );

  return (
    <div>
      <button className="c-btn c-btn-cinza c-btn-peq" onClick={onVoltar} style={{ marginBottom: 10 }}>← Voltar</button>
      <div className="c-titulo">🔥 Braai — traga os seus produtos</div>

      <div className="c-card" style={{ background: "#fff7ed", border: "1px solid #fdba74", fontSize: 13 }}>
        🔥 <b>Saia da rotina sem sair da cidade:</b> reúna a família e os amigos — nós tratamos do espaço, você traz o sabor.<br />
        🥩🥤 Traga a sua comida e/ou bebidas e use o <b>espaço, mesas, cadeiras e água</b> da {emp.nome}.
        Utensílios, ingredientes e carvão são seus — pode trazer o seu fogão/grelhador. A assadura é feita <b>fora</b>, no espaço indicado pela nossa equipa.
        A taxa é <b>não consumível</b> (não desconta em consumos) e dá direito a <b>{BRAAI_DURACAO_HORAS} horas</b> de uso do espaço.
        🏊🛝 Piscina e parque infantil são pagos à parte.
      </div>

      <div className="c-card">
        <label className="c-label" style={{ marginTop: 0 }}>1. O que vai trazer? *</label>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <button type="button" className={`c-btn ${modalidade === "A" ? "c-btn-prim" : "c-btn-linha"}`}
            style={{ justifyContent: "flex-start", textAlign: "left", whiteSpace: "normal", height: "auto", padding: "10px 12px" }}
            onClick={() => setModalidade("A")}>
            🥩🥤 <b>Braai Completo</b> — trago comida E bebidas<br />
            <small>{mt(braaiTaxaPessoa("A", 5))}/pessoa até 9 · {mt(braaiTaxaPessoa("A", 10))}/pessoa a partir de 10</small>
          </button>
          <button type="button" className={`c-btn ${modalidade === "B" ? "c-btn-prim" : "c-btn-linha"}`}
            style={{ justifyContent: "flex-start", textAlign: "left", whiteSpace: "normal", height: "auto", padding: "10px 12px" }}
            onClick={() => setModalidade("B")}>
            🥩 <b>Braai Parcial</b> — trago só uma coisa, o resto compro na casa<br />
            <small>{mt(braaiTaxaPessoa("B", 5))}/pessoa até 9 · {mt(braaiTaxaPessoa("B", 10))}/pessoa a partir de 10</small>
          </button>
        </div>
        {modalidade === "B" && (
          <>
            <label className="c-label" style={{ marginTop: 8 }}>O que traz consigo? *</label>
            <div style={{ display: "flex", gap: 6 }}>
              <button type="button" className={`c-btn c-btn-peq ${traz === "Comida" ? "c-btn-prim" : "c-btn-cinza"}`} style={{ flex: 1 }}
                onClick={() => setTraz("Comida")}>🥩 Só a comida</button>
              <button type="button" className={`c-btn c-btn-peq ${traz === "Bebidas" ? "c-btn-prim" : "c-btn-cinza"}`} style={{ flex: 1 }}
                onClick={() => setTraz("Bebidas")}>🥤 Só as bebidas</button>
            </div>
            {traz === "Bebidas" && (
              <p className="c-sub" style={{ marginTop: 6, color: "#9a3412" }}>
                ⚠️ Bebidas trazidas de fora: <b>máximo 3 por pessoa</b> e apenas bebidas que a casa não vende ou não tem em stock. Whisky ou vinho: <b>apenas 1 garrafa por cada 10 pessoas</b>.
              </p>
            )}
          </>
        )}
      </div>

      <div className="c-card">
        <label className="c-label" style={{ marginTop: 0 }}>2. Quantas pessoas? *</label>
        <p className="c-sub" style={{ margin: "0 0 4px" }}>Pagantes (a partir dos 10 anos):</p>
        {stepper(pessoas, setPessoas, 1, 500)}
        <p className="c-sub" style={{ textAlign: "center", margin: 0 }}>
          {pessoas} × {mt(taxaPessoa)} = <b>{mt(total)}</b> {pessoas >= 10 && <span style={{ color: "var(--verde-c)" }}>(preço de grupo!)</span>}
        </p>
        <p className="c-sub" style={{ margin: "10px 0 4px" }}>Crianças até 9 anos (não pagam):</p>
        {stepper(criancas, setCriancas, 0, 200)}
      </div>

      <div className="c-card">
        <label className="c-label" style={{ marginTop: 0 }}>3. Quando e onde? *</label>
        <div style={{ display: "flex", gap: 10 }}>
          <div style={{ flex: 1 }}>
            <label className="c-label">Data do braai *</label>
            <input className="c-input" type="date" min={hoje()} value={dataAgendada} onChange={(e) => setDataAgendada(e.target.value)} />
          </div>
          <div style={{ flex: 1 }}>
            <label className="c-label">Hora de entrada *</label>
            <input className="c-input" type="time" value={horaAgendada} onChange={(e) => setHoraAgendada(e.target.value)} />
          </div>
        </div>
        {horaSaida && (
          <p className="c-sub" style={{ textAlign: "center" }}>⏱ Tem o espaço até às <b>{horaSaida}</b> ({BRAAI_DURACAO_HORAS} horas)</p>
        )}
        <label className="c-label">🪑 Onde pretende ficar? *</label>
        <select className="c-select" value={area} onChange={(e) => setArea(e.target.value)}>
          <option value="">— Seleccione o espaço —</option>
          {AREAS_ESTAR.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
      </div>

      <div className="c-card">
        <label className="c-label" style={{ marginTop: 0 }}>4. Os seus dados *</label>
        <input className="c-input" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome completo" />
        <label className="c-label">Telefone com WhatsApp *</label>
        <TelInput value={tel} onChange={setTel} required />
      </div>

      <div className="c-card" style={{ background: "var(--lilas)" }}>
        <div className="c-titulo" style={{ fontSize: 15 }}>📜 Regras do braai</div>
        <ol style={{ margin: "6px 0", paddingLeft: 18, fontSize: 12.5, lineHeight: 1.5 }}>
          {BRAAI_REGRAS.map((r, i) => <li key={i} style={{ marginBottom: 4 }}>{r}</li>)}
        </ol>
        <button type="button" className={`c-btn c-btn-bloco ${aceite ? "c-btn-verde" : "c-btn-cinza"}`} style={{ marginTop: 4 }}
          onClick={() => setAceite(!aceite)}>
          {aceite ? "✅ Li e aceito as regras do braai" : "☑️ Toque aqui para aceitar as regras do braai"}
        </button>
        <hr style={{ border: "none", borderTop: "1px dashed #b9a6d9", margin: "10px 0" }} />
        <div className="c-total-linha"><span>{braaiRotulo(modalidade, modalidade === "B" ? traz : null)}</span><span>{pessoas} × {mt(taxaPessoa)}</span></div>
        <div className="c-total-linha" style={{ fontSize: 16 }}><span>TOTAL a pagar agora (100%)</span><b style={{ color: "var(--roxo)" }}>{mt(total)}</b></div>
        <p className="c-sub" style={{ marginTop: 4 }}>
          💳 Na loja online a taxa de braai é paga <b>integralmente (100%) por antecipação</b> — sem desconto de loja, porque não é consumo.
        </p>
      </div>

      <CampoAfiliado ref_={refAf} limpar={limparRefAf} afCodigo={afCodigo} setAfCodigo={setAfCodigo} />
      {erro && <p style={{ color: "var(--vermelho-c)", fontSize: 13 }}>⚠️ {erro}</p>}
      <button className="c-btn c-btn-prim c-btn-bloco" disabled={criar.isPending || !aceite}
        onClick={() => {
          setErro("");
          const telDigits = tel.replace(/\D/g, "");
          if (nome.trim().length < 2 || telDigits.length < 9) { setErro("Indique o seu nome e telefone com WhatsApp (9 dígitos)."); return; }
          if (!dataAgendada) { setErro("Indique a data do braai."); return; }
          if (dataAgendada < hoje()) { setErro("A data do braai não pode ser no passado."); return; }
          if (!horaAgendada) { setErro("Indique a hora de entrada — a taxa dá direito a 5 horas de uso do espaço."); return; }
          if (!area) { setErro("Seleccione onde pretende ficar (ex.: Jardim, Área da Piscina…)."); return; }
          if (!aceite) { setErro("Leia e aceite as regras do braai para continuar."); return; }
          criar.mutate({
            token: token || undefined, clienteNome: nome, clienteTelefone: telDigits,
            tipo: "Reserva",
            dataAgendada, horaAgendada, pessoas, area,
            braaiModalidade: modalidade,
            braaiTraz: modalidade === "B" ? traz : undefined,
            criancasMenores: criancas,
            itens: [], extras: [],
            afiliadoCodigo: afCodigo.trim() || undefined,
          });
        }}>
        {criar.isPending ? "A registar…" : `🔥 Reservar braai — pagar ${mt(total)} (100%)`}
      </button>
    </div>
  );
}

function Pagar({ cart, tipo, mesa, cliente, token, onVoltar, onCriado }: {
  cart: CarrinhoItem[]; tipo: TipoPedidoOnline; mesa: string;
  cliente: { nome: string; telefone: string } | null; token: string;
  onVoltar: () => void; onCriado: (p: PedidoCriado, tel: string) => void;
}) {
  const emp = useEmpresa();
  const [nome, setNome] = useState(cliente?.nome ?? "");
  const [tel, setTel] = useState(cliente?.telefone ?? "");
  const [bairro, setBairro] = useState("");
  const [referencia, setReferencia] = useState("");
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [dataAgendada, setDataAgendada] = useState("");
  const [afCodigo, setAfCodigo] = useState(() => refGuardado()?.codigo ?? "");
  const { ref: refAf, limpar: limparRefAf } = useRefAfiliado(setAfCodigo);
  const [erro, setErro] = useState("");
  const bairros = trpc.operacao.bairros.useQuery(undefined, { staleTime: 300_000 });

  const endereco = tipo === "Delivery"
    ? [bairro ? `Bairro ${bairro}` : "", referencia.trim()].filter(Boolean).join(" — ")
    : "";

  const subtotal = cart.reduce((a, i) => a + i.preco * i.qtd, 0);
  const taxa = tipo === "Delivery" ? Math.max(100, parseFloat(emp.taxaDelivery) || 100) : 0; // mín. 100 — paga ao entregador
  const desconto = afCodigo.trim() ? Math.round(subtotal * LOJA_DESCONTO_PCT / 100 * 100) / 100 : 0; // só com código de afiliado
  const total = Math.round((subtotal - desconto) * 100) / 100; // taxa de entrega fora do total
  const aPagar = tipo === "Reserva" ? total * 0.5 : total;

  const criar = trpc.loja.criarPedido.useMutation({
    onSuccess: (r) => onCriado(r, tel.replace(/\D/g, "")),
    onError: (e) => setErro(e.message),
  });

  return (
    <div>
      <button className="c-btn c-btn-cinza c-btn-peq" onClick={onVoltar} style={{ marginBottom: 10 }}>← Voltar</button>
      <div className="c-titulo">💳 Pagamento — {rotuloTipo(tipo)}</div>

      <div className="c-card">
        <label className="c-label">O seu nome *</label>
        <input className="c-input" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome completo" />
        <label className="c-label">Telefone com WhatsApp *</label>
        <TelInput value={tel} onChange={setTel} required />
        {tipo === "Delivery" && (
          <>
            <label className="c-label" style={{ marginTop: 10 }}>Bairro de entrega *</label>
            <select className="c-select" value={bairro} onChange={(e) => setBairro(e.target.value)}>
              <option value="">— Escolha o bairro —</option>
              {(bairros.data ?? []).map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
            <label className="c-label">Referência (rua, casa, ponto conhecido)</label>
            <textarea className="c-textarea" rows={2} value={referencia} onChange={(e) => setReferencia(e.target.value)}
              placeholder="Ex.: Rua 3, casa nº 45, perto da escola…" />
            <label className="c-label">📍 Local no mapa (toque para marcar)</label>
            <MapaEntrega lat={coords?.lat ?? null} lng={coords?.lng ?? null} onPick={(lat, lng) => setCoords({ lat, lng })} />
          </>
        )}
        {tipo === "Reserva" && (
          <>
            <label className="c-label">Data do evento *</label>
            <input className="c-input" type="date" min={hoje()} value={dataAgendada} onChange={(e) => setDataAgendada(e.target.value)} />
          </>
        )}
        {mesa && tipo === "Local" && <p className="c-sub">📍 Pedido para a <b>Mesa {mesa}</b>.</p>}
      </div>

      <div className="c-card" style={{ background: "var(--lilas)" }}>
        <div className="c-titulo" style={{ fontSize: 15 }}>💰 Como pagar</div>
        <div className="c-linha"><div className="grow tit">Transferência eMola</div><b>{emp.emola}</b></div>
        <div className="c-linha"><div className="grow tit">Titular</div><span>{emp.titular}</span></div>
        <div className="c-linha"><div className="grow tit">Levantamento eMola</div><b>{emp.emolaLev}</b></div>
        <div className="c-linha"><div className="grow tit">Titular</div><span>{emp.emolaLevTitular}</span></div>
        <div className="c-linha"><div className="grow tit">{emp.banco}</div><b>{emp.conta}</b></div>
        <div className="c-linha"><div className="grow tit">Titular</div><span>{emp.beneficiario}</span></div>
        <div className="c-linha"><div className="grow tit">Dinheiro</div><span>no local, ao levantar/consumir</span></div>
        <p className="c-sub" style={{ marginTop: 4 }}>ℹ️ Para pagamentos por transferência {emp.banco}, contacte-nos pelo <b>87 458 9150</b> para flexibilizar a confirmação.</p>
        <hr style={{ border: "none", borderTop: "1px dashed #b9a6d9" }} />
        <div className="c-total-linha"><span>Subtotal</span><span>{mt(subtotal)}</span></div>
        {desconto > 0
          ? <div className="c-total-linha"><span>🤝 Desconto de afiliado ({LOJA_DESCONTO_PCT}%)</span><b style={{ color: "var(--verde-c)" }}>− {mt(desconto)}</b></div>
          : <div className="c-sub" style={{ fontSize: 11.5, margin: "2px 0" }}>🤝 Com código de afiliado válido teria {LOJA_DESCONTO_PCT}% de desconto.</div>}
        {tipo === "Delivery" && <div className="c-total-linha"><span>🛵 Taxa de entrega (a partir de)</span><span>{mt(taxa)}</span></div>}
        <div className="c-total-linha" style={{ fontSize: 16 }}><span>Total a pagar ao restaurante</span><b>{mt(total)}</b></div>
        {tipo === "Reserva" && (
          <div className="c-total-linha"><span>Pagar agora (depósito)</span><b style={{ color: "var(--verde-c)" }}>{mt(aPagar)}</b></div>
        )}
        <p className="c-sub" style={{ marginTop: 6 }}>
          {tipo === "Delivery" && "🛵 A taxa de entrega (mín. 100,00 MZN) é definida pelo restaurante conforme o seu bairro e confirmada ANTES do pedido sair — é paga ao entregador na entrega, não faz parte do valor acima. "}
          Após pagar, envie o <b>comprovativo</b> no passo seguinte.
        </p>
        {cart.some((i) => i.personalizado) && (
          <p className="c-sub" style={{ marginTop: 6, background: "#fff", padding: 8, borderRadius: 8 }}>
            ✳️ Os <b>itens especiais</b> (fora do menu) <b>não estão incluídos neste valor</b> — o restaurante vai cotá-los e, depois de aceitar a cotação na página «Acompanhar Pedido», o pagamento fica disponível.
          </p>
        )}
      </div>

      <CampoAfiliado ref_={refAf} limpar={limparRefAf} afCodigo={afCodigo} setAfCodigo={setAfCodigo} />
      {erro && <p style={{ color: "var(--vermelho-c)", fontSize: 13 }}>⚠️ {erro}</p>}
      <button className="c-btn c-btn-prim c-btn-bloco" disabled={criar.isPending}
        onClick={() => {
          setErro("");
          const telDigits = tel.replace(/\D/g, "");
          if (nome.trim().length < 2 || telDigits.length < 9) { setErro("Indique o seu nome e telefone com WhatsApp (9 dígitos)."); return; }
          if (tipo === "Delivery" && !bairro) { setErro("Escolha o bairro de entrega."); return; }
          if (tipo === "Reserva" && !dataAgendada) { setErro("Indique a data do evento."); return; }
          if (cart.length === 0) { setErro("O carrinho está vazio."); return; }
          criar.mutate({
            token: token || undefined, clienteNome: nome, clienteTelefone: telDigits,
            tipo, mesa: mesa || undefined, endereco: endereco || undefined,
            lat: coords?.lat, lng: coords?.lng,
            dataAgendada: dataAgendada || undefined,
            itens: cart.filter((i) => i.produtoId > 0).map((i) => ({ produtoId: i.produtoId, qtd: i.qtd, obs: i.obs })),
            extras: cart.filter((i) => i.produtoId < 0).map((i) => ({ descricao: i.nome, detalhes: i.detalhes, qtd: i.qtd })),
            afiliadoCodigo: afCodigo.trim() || undefined,
          });
        }}>
        {criar.isPending ? "A registar…" : `✅ Confirmar pedido — ${mt(aPagar)}`}
      </button>
    </div>
  );
}

/* ============ SELECTOR DO MÉTODO DE PAGAMENTO (Transferência eMola / Levantamento eMola / FNB / Dinheiro) ============ */
function SeletorPagamento({ metodo, setMetodo, valor }: {
  metodo: MetodoOnline | null;
  setMetodo: (m: MetodoOnline) => void;
  valor: number;
}) {
  const emp = useEmpresa();
  const ops: { id: MetodoOnline; icon: string }[] = [
    { id: "Transferência eMola", icon: "💠" },
    { id: "Levantamento eMola", icon: "🏧" },
    { id: "FNB", icon: "🏦" },
    { id: "Dinheiro", icon: "💵" },
  ];
  return (
    <div>
      <p className="c-sub" style={{ marginBottom: 6 }}>
        1️⃣ Escolha como quer pagar <b>{mt(valor)}</b>:
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        {ops.map((o) => (
          <button key={o.id} type="button"
            className={"c-btn " + (metodo === o.id ? "c-btn-prim" : "c-btn-cinza")}
            style={{ padding: "10px 4px", fontSize: 13 }}
            onClick={() => setMetodo(o.id)}>
            {o.icon} {o.id}
          </button>
        ))}
      </div>
      {metodo === "Transferência eMola" && (
        <div style={{ background: "#eef7ee", borderRadius: 10, padding: 10, marginTop: 8, fontSize: 14 }}>
          2️⃣ Transfira <b>{mt(valor)}</b> por eMola para o número:{" "}
          <b style={{ fontSize: 17 }}>{emp.emola}</b>
          <br /><span className="c-sub">Titular: {emp.titular}</span>
        </div>
      )}
      {metodo === "Levantamento eMola" && (
        <div style={{ background: "#eef7ee", borderRadius: 10, padding: 10, marginTop: 8, fontSize: 14 }}>
          2️⃣ Envie <b>{mt(valor)}</b> pelo Código de Levantamento eMola:{" "}
          <b style={{ fontSize: 17 }}>{emp.emolaLev}</b>
          <br /><span className="c-sub">Titular: {emp.emolaLevTitular}</span>
        </div>
      )}
      {metodo === "FNB" && (
        <div style={{ background: "#fdf3dd", borderRadius: 10, padding: 10, marginTop: 8, fontSize: 14 }}>
          2️⃣ Transfira <b>{mt(valor)}</b> para a conta {emp.banco}:{" "}
          <b style={{ fontSize: 17 }}>{emp.conta}</b>
          <br /><span className="c-sub">NIB: {emp.nib} · Titular: {emp.beneficiario}</span>
          <br /><span className="c-sub" style={{ color: "var(--laranja, #b45309)" }}>ℹ️ Depois de transferir, contacte o restaurante pelo <b>87 458 9150</b> para flexibilizar a confirmação.</span>
        </div>
      )}
      {metodo === "Dinheiro" && (
        <div style={{ background: "#fdf3dd", borderRadius: 10, padding: 10, marginTop: 8, fontSize: 14 }}>
          💵 Pagará <b>{mt(valor)}</b> em <b>dinheiro</b> no estabelecimento. Confirme abaixo para o restaurante registar a sua escolha.
        </div>
      )}
    </div>
  );
}

/* ============ SUCESSO + ENVIO DO COMPROVATIVO ============ */
function Sucesso({ pedido, telefone, tipo, onAcompanhar, onInicio }: {
  pedido: PedidoCriado; telefone: string; tipo: TipoPedidoOnline;
  onAcompanhar: () => void; onInicio: () => void;
}) {
  const [ficheiro, setFicheiro] = useState<string | null>(null);
  const [metodo, setMetodo] = useState<MetodoOnline | null>(null);
  const [enviado, setEnviado] = useState(false);
  const [erro, setErro] = useState("");
  const emp = useEmpresa();
  const aPagar = tipo === "Reserva" ? pedido.adiant : pedido.total;

  const enviar = trpc.loja.enviarComprovativo.useMutation({
    onSuccess: () => setEnviado(true),
    onError: (e) => setErro(e.message),
  });

  if (enviado) {
    return (
      <div style={{ textAlign: "center", paddingTop: 20 }}>
        <div style={{ fontSize: 54 }}>🎉</div>
        <div className="c-titulo">Comprovativo enviado!</div>
        <div className="c-card" style={{ textAlign: "left" }}>
          <p>O seu pedido <b>{pedido.codigo}</b> está a ser verificado pelo restaurante.</p>
          <p className="c-sub">
            A partir de agora pode apenas <b>acompanhar o estado do pedido</b>.
            Receberá a confirmação do pagamento e as actualizações (em preparo, pronto, entrega)
            por WhatsApp/SMS para <b>+258 {telefone}</b> — e também aparecem na página do pedido.
          </p>
          {tipo === "Reserva" && (
            <p className="c-sub" style={{ background: "#f7f1fc", borderRadius: 10, padding: 8 }}>
              📅 <b>Reserva:</b> após a confirmação do adiantamento, o pedido fica a <b>aguardar o dia
              do evento</b> e a conversa termina aí. Guarde o código <b>{pedido.codigo}</b> e o telefone
              (ou crie uma conta na loja) — nesse dia, antes de chegar, <b>abra o pedido</b> em
              «Acompanhar Pedido» para o preparo começar.
            </p>
          )}
        </div>
        <button className="c-btn c-btn-prim c-btn-bloco" onClick={onAcompanhar}>📦 Acompanhar o meu pedido</button>
        <button className="c-btn c-btn-cinza c-btn-bloco" style={{ marginTop: 8 }} onClick={onInicio}>🏠 Voltar ao início</button>
      </div>
    );
  }

  return (
    <div>
      <div className="c-titulo">✅ Pedido registado!</div>
      <p className="c-sub" style={{ textAlign: "center", marginTop: -6 }}>
        Obrigado por escolher a CAMI'S — estamos a preparar tudo com carinho para si. 🧡
      </p>
      <div className="c-card" style={{ textAlign: "center" }}>
        <p className="c-sub" style={{ margin: 0 }}>O código do seu pedido:</p>
        <div style={{ fontSize: 30, fontWeight: 800, color: "var(--roxo)", letterSpacing: 2 }}>{pedido.codigo}</div>
        {pedido.aguardaCotacao ? (
          <>
            <span className="c-chip c-chip-amarelo">⏳ A aguardar cotação dos itens especiais</span>
            <p className="c-sub" style={{ marginTop: 8 }}>
              O restaurante vai definir o preço dos seus <b>itens especiais (✳️)</b> e enviar-lhe a cotação.
              <b>Aceite-a na página «Acompanhar Pedido»</b> e só depois faça o pagamento e envie o comprovativo.
            </p>
          </>
        ) : (
          <>
            <span className="c-chip c-chip-amarelo">⏳ Pedido Pendente — aguarda comprovativo</span>
            <p className="c-sub" style={{ marginTop: 8 }}>
              Pague <b>{mt(aPagar)}</b>{tipo === "Reserva" && pedido.total > 0 ? ` (depósito de ${Math.round((pedido.adiant / pedido.total) * 100)}%)` : ""} por Transferência eMola <b>{emp.emola}</b> (Titular: {emp.titular}),
              Levantamento eMola <b>{emp.emolaLev}</b> (Titular: {emp.emolaLevTitular}), transferência {emp.banco} <b>{emp.conta}</b> ({emp.beneficiario})
              — ou em dinheiro no local — e confirme abaixo.
            </p>
            {tipo === "Delivery" && pedido.taxaEntrega > 0 && (
              <p className="c-sub" style={{ marginTop: 6, background: "#fff", padding: 8, borderRadius: 8 }}>
                🛵 <b>Taxa de entrega:</b> a partir de <b>{mt(pedido.taxaEntrega)}</b> — o restaurante confirma o
                valor final conforme o seu bairro <b>antes do pedido sair para entrega</b>, e a taxa é
                <b> paga ao entregador no momento da entrega</b> (não está incluída no valor acima).
              </p>
            )}
          </>
        )}
      </div>

      {pedido.aguardaCotacao ? (
        <>
          <button className="c-btn c-btn-prim c-btn-bloco" onClick={onAcompanhar}>📦 Acompanhar / responder à cotação</button>
          <button className="c-btn c-btn-cinza c-btn-bloco" style={{ marginTop: 8 }} onClick={onInicio}>🏠 Voltar ao início</button>
        </>
      ) : (
      <div className="c-card">
        <div className="c-titulo" style={{ fontSize: 15 }}>💳 Pagamento</div>
        <SeletorPagamento metodo={metodo} setMetodo={(m) => { setMetodo(m); setErro(""); }} valor={aPagar} />
        {metodo && metodo !== "Dinheiro" && (
          <>
            <UploadFicheiro rotulo="3️⃣ Anexe o comprovativo de pagamento:"
              onFicheiro={async (f) => {
                setErro("");
                try { setFicheiro(await fileToDataUrl(f, 1200, 0.8)); }
                catch (err) { setErro((err as Error).message); }
              }} />
            {ficheiro?.startsWith("data:image") && (
              <img src={ficheiro} alt="comprovativo" style={{ width: "100%", maxHeight: 220, objectFit: "contain", marginTop: 8, borderRadius: 10 }} />
            )}
            {ficheiro?.startsWith("data:application/pdf") && <p className="c-sub" style={{ marginTop: 8 }}>📄 PDF anexado.</p>}
          </>
        )}
        {erro && <p style={{ color: "var(--vermelho-c)", fontSize: 13 }}>⚠️ {erro}</p>}
        <button className="c-btn c-btn-prim c-btn-bloco" style={{ marginTop: 10 }}
          disabled={!metodo || (metodo !== "Dinheiro" && !ficheiro) || enviar.isPending}
          onClick={() => metodo && enviar.mutate({ codigo: pedido.codigo, telefone, metodo, comprovativo: ficheiro ?? undefined })}>
          {enviar.isPending ? "A enviar…" : metodo === "Dinheiro" ? "💵 Confirmar pagamento em dinheiro" : "📤 Enviar comprovativo"}
        </button>
        <button className="c-btn c-btn-cinza c-btn-bloco" style={{ marginTop: 8 }} onClick={onAcompanhar}>
          Enviar mais tarde — acompanhar pedido
        </button>
      </div>
      )}
    </div>
  );
}

/* ============ ACOMPANHAR PEDIDO ============ */
const PASSOS = ["Pendente", "Comprovativo Enviado", "Confirmado", "Em Preparo", "Pronto"];

export function Acompanhar({ codigoInicial, telInicial, onVoltar }: {
  codigoInicial: string; telInicial: string; onVoltar: () => void;
}) {
  const [codigo, setCodigo] = useState(codigoInicial);
  const [tel, setTel] = useState(telInicial);
  const [busca, setBusca] = useState<{ codigo: string; telefone: string } | null>(
    codigoInicial && telInicial ? { codigo: codigoInicial, telefone: telInicial } : null,
  );
  const q = trpc.loja.acompanhar.useQuery(busca!, {
    enabled: !!busca, refetchInterval: 15000, retry: false,
  });
  const p = q.data;

  const chipCor = (s: string) =>
    s === "Cancelado" ? "c-chip-vermelho"
      : ["Entregue", "Concluído", "Pronto"].includes(s) ? "c-chip-verde"
        : s === "Pendente" ? "c-chip-amarelo" : "c-chip-azul";

  const passosFluxo = p?.tipo === "Reserva"
    ? ["Pendente", "Comprovativo Enviado", "Aguarda Consumo", "Confirmado", "Em Preparo", "Pronto", "Concluído"]
    : p?.tipo === "Delivery" ? [...PASSOS, "Em Entrega", "Entregue"] : [...PASSOS, "Concluído"];
  const idxAtual = p ? passosFluxo.indexOf(p.status) : -1;
  const propPend = !!p?.proposta && !p.proposta.respondidaEm;
  const extrasPend = (p?.extras ?? []).some((e) => !e.cotado || e.aceite == null);
  const PAGO = ["Aguarda Consumo", "Confirmado", "Em Preparo", "Pronto", "Em Entrega", "Entregue", "Concluído"];

  // pop-up de avaliação — abre sozinho quando o pedido termina e ainda não foi avaliado
  const [avaliarAberto, setAvaliarAberto] = useState(false);
  const terminado = !!p && (p.status === "Entregue" || p.status === "Concluído");
  useEffect(() => {
    if (terminado && p && !p.avaliacao) setAvaliarAberto(true);
  }, [terminado, p?.id, p?.avaliacao]);

  return (
    <div>
      <button className="c-btn c-btn-cinza c-btn-peq" onClick={onVoltar} style={{ marginBottom: 10 }}>← Voltar</button>
      <div className="c-titulo">📦 Acompanhar pedido</div>

      <div className="c-card">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div>
            <label className="c-label">Código do pedido</label>
            <input className="c-input" value={codigo} onChange={(e) => setCodigo(e.target.value.toUpperCase())} placeholder="OL-0001" />
          </div>
          <div>
            <label className="c-label">Telefone usado (+258)</label>
            <TelInput value={tel} onChange={setTel} />
          </div>
        </div>
        <button className="c-btn c-btn-prim c-btn-bloco" style={{ marginTop: 10 }}
          onClick={() => setBusca({ codigo: codigo.trim(), telefone: tel.replace(/\D/g, "") })}>
          🔍 Ver estado
        </button>
        {q.isError && (
          <p style={{ color: "var(--vermelho-c)", fontSize: 14, fontWeight: 700, background: "#fdeaea", borderRadius: 10, padding: "8px 10px" }}>
            ❌ Não encontrado — confira o código do pedido e o telefone usados no pedido.
          </p>
        )}
      </div>

      {p && (
        <>
          <div className="c-card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <b style={{ fontSize: 17 }}>{p.codigo}</b>
              <span className={`c-chip ${chipCor(p.status)}`}>{p.status}</span>
            </div>
            <p className="c-sub" style={{ margin: "6px 0" }}>
              {p.tipo}{p.mesa ? ` · Mesa ${p.mesa}` : ""}{p.dataAgendada ? ` · Para ${p.dataAgendada}` : ""} · Total <b>{mt(p.total)}</b>
              {p.tipo === "Delivery" && <> · 🛵 Entrega {mt(p.taxaEntrega)} (paga ao entregador)</>}
            </p>
            {p.entregadorNome && p.status === "Em Entrega" && (
              <p className="c-sub" style={{ background: "#eef7ee", borderRadius: 8, padding: "6px 10px", margin: "4px 0" }}>
                🛵 Entregador a caminho: <b>{p.entregadorNome}</b>
                {p.entregadorTel && <> — <a href={`tel:${p.entregadorTel.replace(/\s/g, "")}`} style={{ fontWeight: 700 }}>{p.entregadorTel}</a></>}
              </p>
            )}
            {p.itens.map((i, k) => (
              <div className="c-linha" key={k}><div className="grow tit">{i.qtd}× {i.nome}</div><span>{mt(i.total)}</span></div>
            ))}

            {/* linha de progresso */}
            <div style={{ marginTop: 12 }}>
              {passosFluxo.map((s, i) => (
                <div key={s} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                    <div style={{
                      width: 22, height: 22, borderRadius: "50%", fontSize: 12, fontWeight: 800,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      background: i <= idxAtual ? "var(--roxo)" : "#e5dde8", color: i <= idxAtual ? "#fff" : "#999",
                    }}>{i <= idxAtual ? "✓" : i + 1}</div>
                    {i < passosFluxo.length - 1 && <div style={{ width: 2, height: 16, background: i < idxAtual ? "var(--roxo)" : "#e5dde8" }} />}
                  </div>
                  <div style={{ fontSize: 13, paddingTop: 2, fontWeight: i === idxAtual ? 800 : 400 }}>
                    {s}
                    {s === "Em Preparo" && p.tempoEstimado && (
                      <div className="c-sub">⏱ {p.tempoEstimado} min · início {p.inicioEstimado} · fim previsto {p.fimEstimado}</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* proposta de alteração do restaurante — o cliente aceita/recusa */}
          {propPend && <PropostaCard pedido={p} />}

          {/* resposta à proposta já enviada — o cliente pode voltar atrás e reeditar */}
          {p.proposta?.respondidaEm && p.status === "Pendente" && (
            <div className="c-card" style={{ background: "#eef3fd", fontSize: 13 }}>
              ✅ <b>Respondeu à proposta de alteração</b> do restaurante. O pedido segue com os itens que escolheu.
              <ReabrirBtn codigo={p.codigo} telefone={p.clienteTelefone} tipo="proposta" />
            </div>
          )}

          {/* cotação dos itens especiais (✳️) — o cliente aceita/recusa cada um */}
          {p.extras && p.extras.length > 0 && <CotacaoCard pedido={p} />}

          {/* upload tardio de comprovativo — só quando não há proposta nem cotação pendente */}
          {p.status === "Pendente" && !propPend && !extrasPend && (
            <ComprovativoTardio codigo={p.codigo} telefone={p.clienteTelefone}
              valor={p.tipo === "Reserva" && p.adiant > 0 ? p.adiant : p.total} />
          )}
          {p.status === "Pendente" && (extrasPend || propPend) && (
            <div className="c-card" style={{ background: "#fdf3dd", fontSize: 13 }}>
              ⏳ <b>Pagamento em espera.</b> O comprovativo fica disponível depois de responder
              {propPend ? " à proposta de alteração" : ""}
              {propPend && extrasPend ? " e" : ""}
              {extrasPend ? " à cotação dos itens especiais" : ""} acima.
            </div>
          )}

          {/* pedido cancelado */}
          {p.status === "Cancelado" && (
            <div className="c-card" style={{ background: "#fdecec", fontSize: 13 }}>
              ❌ <b>Este pedido foi cancelado.</b> Para mais informações contacte o restaurante.
            </div>
          )}

          {/* reserva paga — a aguardar o dia do consumo; o cliente abre o pedido nesse dia */}
          {p.status === "Aguarda Consumo" && <AguardaConsumoCard pedido={p} />}

          {/* factura baixável — disponível após a confirmação do pagamento */}
          {PAGO.includes(p.status) && (p.tipo === "Local" || p.tipo === "Reserva") && (
            <div className="c-card" style={{ background: "#fdf0f7", border: "1.5px solid #e08bb8" }}>
              <b style={{ fontSize: 14 }}>🎁 Bónus grátis para crianças!</b>
              <p className="c-sub" style={{ margin: "4px 0 0" }}>
                Obrigado por consumir no nosso espaço — as crianças que vierem consigo têm direito a
                <b> 3 diversões GRÁTIS</b> no parque infantil: <b>baloiço, escorrega e balanço</b>.
                ⚠️ O bónus é válido <b>apenas no dia de consumo deste pedido</b>. Mostre este ecrã à equipa no local. 🛝
              </p>
            </div>
          )}
          {PAGO.includes(p.status) && <FacturaOnlineCard pedido={p} />}

          {/* avaliação por estrelas + comentário (opcional) — no fim da entrega */}
          {(p.status === "Entregue" || p.status === "Concluído") && <AvaliacaoCard pedido={p} />}

          {/* pop-up de avaliação — aparece automaticamente para o cliente não se esquecer */}
          {avaliarAberto && terminado && !p.avaliacao && (
            <div style={{
              position: "fixed", inset: 0, zIndex: 85, background: "rgba(20,8,26,.72)",
              display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
            }}>
              <div style={{ maxWidth: 420, width: "100%" }}>
                <AvaliacaoCard pedido={p} modal onFechar={() => setAvaliarAberto(false)} />
              </div>
            </div>
          )}

          {/* o cliente pode cancelar o pedido ANTES do pagamento */}
          {p.status === "Pendente" && <CancelarPedidoCard codigo={p.codigo} telefone={p.clienteTelefone} />}

          {p.notificacoes.length > 0 && (
            <div className="c-card">
              <div className="c-titulo" style={{ fontSize: 15 }}>📲 Conversa e notificações</div>
              {p.notificacoes.map((n) => (
                <div key={n.id} style={{ fontSize: 12.5, borderLeft: "3px solid var(--roxo2)", paddingLeft: 8, marginBottom: 8 }}>
                  {n.autor && (
                    <div style={{ fontSize: 11, fontWeight: 800, color: "var(--roxo)", marginBottom: 2 }}>
                      👤 {n.autor} — equipa CAMI'S EVENTOS
                    </div>
                  )}
                  {n.mensagem}
                </div>
              ))}
              <p className="c-sub" style={{ margin: 0, fontSize: 11 }}>
                As mensagens identificam o funcionário que o está a atender. Sem identificação = mensagem automática do sistema.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ============ RESERVA — AGUARDA O DIA DO CONSUMO ============ */
function AguardaConsumoCard({ pedido }: { pedido: AcompData }) {
  const utils = trpc.useUtils();
  const emp = useEmpresa();
  const [erro, setErro] = useState("");
  const [preSel, setPreSel] = useState<Record<number, number>>({});
  const [preSelOpen, setPreSelOpen] = useState(false);

  const menu = trpc.loja.menu.useQuery({ tipo: "Local" }, { enabled: preSelOpen });
  const confirmar = trpc.loja.confirmarVinda.useMutation({
    onSuccess: () => { setErro(""); utils.loja.acompanhar.invalidate(); },
    onError: (e) => setErro(e.message),
  });
  const preSelMut = trpc.loja.preSelecionar.useMutation({
    onSuccess: () => { setErro(""); setPreSel({}); setPreSelOpen(false); utils.loja.acompanhar.invalidate(); },
    onError: (e) => setErro(e.message),
  });
  const abrir = trpc.loja.abrirPedido.useMutation({
    onSuccess: () => utils.loja.acompanhar.invalidate(),
    onError: (e) => setErro(e.message),
  });
  const podeAbrir = !pedido.dataAgendada || hoje() >= pedido.dataAgendada;

  // janela T-6h: abre 6h antes da data/hora (sem hora → às 08:00 desse dia), hora de Moçambique (UTC+2)
  const janelaAberta = (() => {
    if (!pedido.dataAgendada) return false;
    const [y, m, d] = pedido.dataAgendada.split("-").map(Number);
    const [hh, mm] = (pedido.horaAgendada || "08:00").split(":").map(Number);
    const alvo = Date.UTC(y, m - 1, d, hh - 2, mm);
    const agora = Date.now();
    return pedido.horaAgendada ? agora >= alvo - 6 * 3600e3 && agora <= alvo + 12 * 3600e3 : agora >= alvo;
  })();

  const [a, m, d] = pedido.dataAgendada
    ? [pedido.dataAgendada.slice(0, 4), pedido.dataAgendada.slice(5, 7), pedido.dataAgendada.slice(8, 10)]
    : ["", "", ""];
  const remanescente = Math.max(0, pedido.total - pedido.adiant);
  const nPreSel = Object.values(preSel).reduce((x, y) => x + y, 0);

  return (
    <div className="c-card" style={{ border: "2px solid var(--roxo2)", background: "#f7f1fc" }}>
      <div style={{ fontWeight: 800, fontSize: 15 }}>📅 Reserva confirmada — até ao dia do evento!</div>
      <p className="c-sub" style={{ margin: "6px 0" }}>
        O adiantamento de <b>{mt(pedido.adiant)}</b> foi confirmado. <b>Guarde a factura abaixo
        (baixe o PDF) para apresentar no local no dia do consumo</b> — nela constam o valor pago e
        o remanescente a pagar: <b>{mt(remanescente)}</b>{pedido.pessoas ? ` · Mesa garantida para ${pedido.pessoas} pessoa(s)` : ""}.
      </p>
      {pedido.itens.some((i) => i.nome.startsWith("🍽")) ? (
        <p className="c-sub" style={{ margin: "0 0 6px" }}>
          🍽️ O menu é o do <b>pacote de buffet escolhido</b> — a sua <b>Reserva Buffet</b> já consta na
          página de Reservas do restaurante.{remanescente > 0.009 && (
            <> ⏰ <b style={{ color: "#b3261e" }}>Liquide o remanescente de {mt(remanescente)} até 48 horas
            antes do evento — sob pena de não abertura da mesa.</b></>
          )} No dia, o caixa/garçon abre o seu pedido para levantar os pratos e pode também <b>comprar outros
          produtos da casa</b> (bebidas, sobremesas…). <b>Faltando 6 horas para o
          evento{pedido.dataAgendada ? ` (${d}/${m}/${a}${pedido.horaAgendada ? " às " + pedido.horaAgendada : ""})` : ""}</b>,
          esta página abre para <b>confirmar a sua vinda</b> e, se quiser, já acrescentar esses
          produtos — ou ligue para o restaurante: <b>{emp.tel1}</b>.
        </p>
      ) : (
        <p className="c-sub" style={{ margin: "0 0 6px" }}>
          🍽️ A escolha dos pratos é feita no local, durante o consumo. <b>Faltando 6 horas para a
          reserva{pedido.dataAgendada ? ` (${d}/${m}/${a}${pedido.horaAgendada ? " às " + pedido.horaAgendada : ""})` : ""}</b>,
          esta página abre para <b>confirmar a sua vinda</b> e, se quiser, pré-seleccionar o que
          pretende comer — ou ligue para o restaurante: <b>{emp.tel1}</b>.
        </p>
      )}

      {janelaAberta && !pedido.vindaConfirmada && (
        <button className="c-btn c-btn-prim c-btn-bloco" style={{ marginTop: 6 }}
          disabled={confirmar.isPending}
          onClick={() => { setErro(""); confirmar.mutate({ codigo: pedido.codigo, telefone: pedido.clienteTelefone }); }}>
          {confirmar.isPending ? "A confirmar…" : "✅ Confirmar a minha vinda"}
        </button>
      )}
      {pedido.vindaConfirmada && (
        <p className="c-sub" style={{ margin: "6px 0 0", color: "var(--verde-c)", fontWeight: 700 }}>
          ✅ A sua vinda está confirmada. Até breve!
        </p>
      )}
      {janelaAberta && (
        <>
          <button className="c-btn c-btn-linha c-btn-bloco" style={{ marginTop: 8 }}
            onClick={() => setPreSelOpen(!preSelOpen)}>
            {preSelOpen ? "▲ Esconder o menu" : "🍽️ Pré-seleccionar os pratos (opcional)"}
          </button>
          {preSelOpen && (
            <div style={{ marginTop: 8 }}>
              <p className="c-sub" style={{ margin: "0 0 6px" }}>
                A pré-selecção acelera o atendimento — estes pratos somam ao remanescente e são
                <b> pagos no local</b>, no dia do consumo.
              </p>
              {(menu.data ?? []).map((pr) => {
                const q = preSel[pr.id] ?? 0;
                return (
                  <div key={pr.id} className="c-linha" style={{ padding: "5px 0" }}>
                    <div className="grow tit" style={{ fontSize: 13 }}>{pr.nome}</div>
                    {q > 0 ? (
                      <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <button className="c-btn c-btn-cinza c-btn-peq"
                          onClick={() => setPreSel((s) => { const n = { ...s, [pr.id]: q - 1 }; if (n[pr.id] <= 0) delete n[pr.id]; return n; })}>−</button>
                        <b>{q}</b>
                        <button className="c-btn c-btn-cinza c-btn-peq"
                          onClick={() => setPreSel((s) => ({ ...s, [pr.id]: q + 1 }))}>+</button>
                      </span>
                    ) : (
                      <button className="c-btn c-btn-linha c-btn-peq"
                        onClick={() => setPreSel((s) => ({ ...s, [pr.id]: 1 }))}>+ {mt(pr.preco)}</button>
                    )}
                  </div>
                );
              })}
              {nPreSel > 0 && (
                <button className="c-btn c-btn-prim c-btn-bloco" style={{ marginTop: 8 }}
                  disabled={preSelMut.isPending}
                  onClick={() => preSelMut.mutate({
                    codigo: pedido.codigo, telefone: pedido.clienteTelefone,
                    itens: Object.entries(preSel).map(([id, qtd]) => ({ produtoId: Number(id), qtd })),
                  })}>
                  {preSelMut.isPending ? "A enviar…" : `📤 Enviar pré-selecção (${nPreSel} ${nPreSel === 1 ? "item" : "itens"})`}
                </button>
              )}
            </div>
          )}
        </>
      )}
      {!janelaAberta && (
        <span className="c-chip c-chip-amarelo" style={{ marginTop: 6, display: "inline-block" }}>
          ⏳ A confirmação de vinda abre 6h antes da reserva ({d}/{m}/{a}{pedido.horaAgendada ? ` às ${pedido.horaAgendada}` : ""})
        </span>
      )}
      {podeAbrir && (
        <button className="c-btn c-btn-prim c-btn-bloco" style={{ marginTop: 8 }}
          disabled={abrir.isPending}
          onClick={() => { setErro(""); abrir.mutate({ codigo: pedido.codigo, telefone: pedido.clienteTelefone }); }}>
          {abrir.isPending ? "A abrir…" : "🔓 Abrir o meu pedido (já estou no restaurante)"}
        </button>
      )}
      {erro && <p style={{ color: "var(--vermelho-c)", fontSize: 13 }}>⚠️ {erro}</p>}
    </div>
  );
}

/* ============ RESPOSTA À PROPOSTA DO RESTAURANTE ============ */
type ItemLoja = { nome: string; qtd: number; precoUnit: number; total: number };
type Proposta = {
  removidos: number[];
  adicionados: ItemLoja[];
  itensOriginais?: ItemLoja[];
  criadoPor: string; criadoEm: string;
  respondidaEm?: string | null;
};
type ExtraLoja = {
  descricao: string; detalhes?: string; qtd: number; preco: number;
  cotado: boolean; cotadoPor?: string; aceite?: boolean | null;
};
type AcompData = {
  codigo: string; clienteNome: string; clienteTelefone: string;
  tipo: "Local" | "Delivery" | "TakeAway" | "Reserva";
  status: string; mesa: string | null; dataAgendada: string | null;
  horaAgendada?: string | null; pessoas?: number | null; vindaConfirmada?: boolean;
  subtotal: number; total: number; taxaEntrega: number; adiant: number;
  metodoPagamento?: string | null;
  itens: ItemLoja[]; proposta: Proposta | null; extras: ExtraLoja[] | null;
  criadoEm: string | Date;
  avaliacao: { estrelas: number; comentario: string | null } | null;
};
type NotifLoja = { id: number; mensagem: string; autor: string | null; criadoEm: string | Date };

/* ============ COTAÇÃO DOS ITENS ESPECIAIS (✳️) — CLIENTE ACEITA/RECUSA ============ */
function CotacaoCard({ pedido }: { pedido: AcompData }) {
  const utils = trpc.useUtils();
  const extras = pedido.extras ?? [];
  // decisão por item: true = «✅ Aceito» · false = «❌ Recuso» · undefined = por responder
  const [decisao, setDecisao] = useState<Record<number, boolean | undefined>>({});
  const [erro, setErro] = useState("");
  const [feito, setFeito] = useState(false);

  const resp = trpc.loja.responderCotacao.useMutation({
    onSuccess: () => { setFeito(true); utils.loja.acompanhar.invalidate(); },
    onError: (e) => setErro(e.message),
  });

  const porCotar = extras.some((e) => !e.cotado);
  const aguardaResposta = !porCotar && extras.some((e) => e.aceite == null);
  const aceites = extras.map((_, i) => i).filter((i) => decisao[i] === true);
  const todosRespondidos = extras.every((_, i) => decisao[i] !== undefined);
  const aceitesTotal = extras.reduce((a, e, i) => a + (aguardaResposta ? (decisao[i] === true ? e.qtd * e.preco : 0) : (e.aceite ? e.qtd * e.preco : 0)), 0);
  const novoTotal = Math.round((pedido.total + (aguardaResposta ? aceitesTotal : 0)) * 100) / 100;

  if (feito) {
    return (
      <div className="c-card" style={{ background: "#e8f6ec" }}>
        ✅ <b>Resposta enviada!</b> {aceites.length > 0
          ? <>Novo total: <b>{mt(novoTotal)}</b>. Já pode enviar o comprovativo de pagamento.</>
          : <>Recusou os itens especiais — o total mantém-se <b>{mt(pedido.total)}</b>.</>}
      </div>
    );
  }

  return (
    <div className="c-card" style={{ border: "2px solid var(--roxo2)", background: "#f7f1fc" }}>
      <div style={{ fontWeight: 800, fontSize: 15 }}>✳️ Os seus itens especiais</div>

      {porCotar ? (
        <p className="c-sub" style={{ margin: "6px 0 0" }}>
          ⏳ O restaurante está a <b>cotar o preço</b> dos seus itens especiais.
          Receberá uma notificação (WhatsApp/SMS) assim que a cotação estiver pronta — depois poderá aceitar e pagar.
        </p>
      ) : (
        <p className="c-sub" style={{ margin: "6px 0 8px" }}>
          {aguardaResposta
            ? <>O restaurante enviou o preço dos seus itens especiais. Para cada item, toque em <b>«✅ Aceito»</b> ou <b>«❌ Recuso»</b> — o pagamento segue depois da sua resposta.</>
            : <>Cotação respondida.</>}
        </p>
      )}

      {extras.map((e, i) => (
        <div key={i} style={{ borderTop: "1px solid #e8dcf0", padding: "7px 0" }}>
          <div className="c-linha" style={{ border: "none", padding: 0 }}>
            <div className="grow tit">✳️ {e.qtd}× {e.descricao}</div>
            {e.cotado ? <b>{mt(e.qtd * e.preco)}</b> : <span className="c-chip c-chip-amarelo" style={{ fontSize: 11 }}>a cotar…</span>}
          </div>
          {e.detalhes && <div className="c-sub" style={{ marginTop: 2 }}>📝 {e.detalhes}</div>}
          {e.cotado && aguardaResposta && (
            <div style={{ marginTop: 6, display: "flex", gap: 8 }}>
              <button type="button" style={{ flex: 1 }}
                className={`c-btn c-btn-peq ${decisao[i] === true ? "c-btn-verde" : "c-btn-cinza"}`}
                onClick={() => setDecisao((d) => ({ ...d, [i]: true }))}>
                ✅ Aceito
              </button>
              <button type="button" style={{ flex: 1 }}
                className={`c-btn c-btn-peq ${decisao[i] === false ? "c-btn-perigo" : "c-btn-cinza"}`}
                onClick={() => setDecisao((d) => ({ ...d, [i]: false }))}>
                ❌ Recuso
              </button>
            </div>
          )}
          {e.cotado && !aguardaResposta && e.aceite != null && (
            <div className="c-sub" style={{ marginTop: 2 }}>{e.aceite ? "✔ Aceite por si" : "✕ Recusado por si"}</div>
          )}
        </div>
      ))}

      {aguardaResposta && (
        <>
          <div className="c-total-linha grande" style={{ marginTop: 8 }}>
            <span>NOVO TOTAL</span>
            <span>{mt(novoTotal)} <small className="c-sub" style={{ fontWeight: 400 }}>(antes {mt(pedido.total)})</small></span>
          </div>
          {erro && <p style={{ color: "var(--vermelho-c)", fontSize: 13 }}>⚠️ {erro}</p>}
          <button className="c-btn c-btn-prim c-btn-bloco" style={{ marginTop: 8 }}
            disabled={resp.isPending || !todosRespondidos}
            onClick={() => { setErro(""); resp.mutate({ codigo: pedido.codigo, telefone: pedido.clienteTelefone, aceites }); }}>
            {resp.isPending ? "A enviar…" : todosRespondidos ? "📨 Enviar a minha resposta" : "Responda «Aceito» ou «Recuso» em cada item ☝️"}
          </button>
        </>
      )}

      {/* resposta já enviada — o cliente pode voltar atrás e reeditar */}
      {!porCotar && !aguardaResposta && pedido.status === "Pendente" && (
        <ReabrirBtn codigo={pedido.codigo} telefone={pedido.clienteTelefone} tipo="cotacao" />
      )}
    </div>
  );
}

/* ============ VOLTAR ATRÁS NUMA RESPOSTA (proposta ou cotação) ============ */
function ReabrirBtn({ codigo, telefone, tipo }: { codigo: string; telefone: string; tipo: "proposta" | "cotacao" }) {
  const utils = trpc.useUtils();
  const [erro, setErro] = useState("");
  const opts = {
    onSuccess: () => utils.loja.acompanhar.invalidate(),
    onError: (e: { message: string }) => setErro(e.message),
  };
  const reabrirProp = trpc.loja.reabrirResposta.useMutation(opts);
  const reabrirCot = trpc.loja.reabrirCotacao.useMutation(opts);
  const mut = tipo === "proposta" ? reabrirProp : reabrirCot;
  return (
    <div style={{ marginTop: 8 }}>
      {erro && <p style={{ color: "var(--vermelho-c)", fontSize: 13 }}>⚠️ {erro}</p>}
      <button className="c-btn c-btn-linha c-btn-bloco" disabled={mut.isPending}
        onClick={() => { setErro(""); mut.mutate({ codigo, telefone }); }}>
        {mut.isPending ? "A reabrir…" : "🔁 Mudar a minha resposta"}
      </button>
    </div>
  );
}

/* ============ CANCELAR O PEDIDO (cliente, antes do pagamento) ============ */
function CancelarPedidoCard({ codigo, telefone }: { codigo: string; telefone: string }) {
  const utils = trpc.useUtils();
  const [confirmar, setConfirmar] = useState(false);
  const [erro, setErro] = useState("");
  const mut = trpc.loja.cancelarPedido.useMutation({
    onSuccess: () => utils.loja.acompanhar.invalidate(),
    onError: (e) => setErro(e.message),
  });
  return (
    <div className="c-card" style={{ border: "1px dashed var(--vermelho-c)" }}>
      {!confirmar ? (
        <button className="c-btn c-btn-linha c-btn-bloco" style={{ color: "var(--vermelho-c)" }}
          onClick={() => setConfirmar(true)}>
          ✕ Cancelar o meu pedido
        </button>
      ) : (
        <>
          <p style={{ fontSize: 13, margin: "0 0 8px" }}>
            Tem a certeza que pretende <b>cancelar</b> este pedido? Esta acção não pode ser anulada.
          </p>
          {erro && <p style={{ color: "var(--vermelho-c)", fontSize: 13 }}>⚠️ {erro}</p>}
          <div style={{ display: "flex", gap: 8 }}>
            <button className="c-btn c-btn-perigo grow" disabled={mut.isPending}
              onClick={() => { setErro(""); mut.mutate({ codigo, telefone }); }}>
              {mut.isPending ? "A cancelar…" : "Sim, cancelar o pedido"}
            </button>
            <button className="c-btn c-btn-cinza grow" onClick={() => setConfirmar(false)}>← Voltar</button>
          </div>
        </>
      )}
    </div>
  );
}

/* ============ FACTURA BAIXÁVEL (após confirmação do pagamento) ============ */
function FacturaOnlineCard({ pedido }: { pedido: AcompData }) {
  const emp = useEmpresa();
  const [aGerar, setAGerar] = useState(false);
  const baixar = async () => {
    setAGerar(true);
    try {
      await downloadPdf("Factura", facturaOnlineHtml(pedido, emp), `Factura-${pedido.codigo}.pdf`);
    } finally {
      setAGerar(false);
    }
  };
  return (
    <div className="c-card" style={{ background: "#eef7ff", border: "2px solid #bcd8f5" }}>
      <div style={{ fontWeight: 800, fontSize: 15 }}>🧾 A sua factura está pronta</div>
      <p className="c-sub" style={{ margin: "4px 0 8px" }}>
        O pagamento foi confirmado pelo restaurante — baixe a factura do pedido <b>{pedido.codigo}</b> em PDF.
        {pedido.tipo === "Reserva" && (
          <>
            {" "}<b>Guarde-a até ao dia de consumo</b> — apresente-a no local. Nela constam o
            valor pago ({mt(pedido.adiant)}) e o remanescente a pagar ({mt(Math.max(0, pedido.total - pedido.adiant))}).
          </>
        )}
      </p>
      <button className="c-btn c-btn-prim c-btn-bloco" disabled={aGerar} onClick={baixar}>
        {aGerar ? "A gerar…" : "⬇️ Baixar Factura (PDF)"}
      </button>
    </div>
  );
}

/* ============ AVALIAÇÃO (estrelas + comentário, opcional) ============ */
function AvaliacaoCard({ pedido, modal, onFechar }: { pedido: AcompData; modal?: boolean; onFechar?: () => void }) {
  const utils = trpc.useUtils();
  const [estrelas, setEstrelas] = useState(0);
  const [comentario, setComentario] = useState("");
  const [erro, setErro] = useState("");
  const mut = trpc.loja.avaliar.useMutation({
    onSuccess: () => utils.loja.acompanhar.invalidate(),
    onError: (e) => setErro(e.message),
  });

  if (pedido.avaliacao) {
    return (
      <div className="c-card" style={{ background: "#fdf8e7" }}>
        <div style={{ fontWeight: 800, fontSize: 15 }}>⭐ Obrigado pela sua avaliação!</div>
        <div style={{ fontSize: 22, margin: "4px 0", color: "#e8a13c" }}>
          {"★".repeat(pedido.avaliacao.estrelas)}{"☆".repeat(5 - pedido.avaliacao.estrelas)}
        </div>
        {pedido.avaliacao.comentario && (
          <p className="c-sub" style={{ margin: 0 }}>“{pedido.avaliacao.comentario}”</p>
        )}
      </div>
    );
  }

  return (
    <div className="c-card" style={{ border: "2px solid #e8c93c", background: "#fffdf3" }}>
      {modal && (
        <p className="c-sub" style={{ margin: "0 0 6px", fontWeight: 700, color: "var(--roxo)" }}>
          🎉 O seu pedido {pedido.codigo} chegou ao fim — conte-nos como correu!
        </p>
      )}
      <div style={{ fontWeight: 800, fontSize: 15 }}>⭐ Como correu o seu pedido?</div>
      <p className="c-sub" style={{ margin: "4px 0 8px" }}>
        Avalie o nosso serviço — as estrelas e o comentário são opcionais, mas ajudam-nos a melhorar.
      </p>      <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} onClick={() => setEstrelas(n)} aria-label={`${n} estrelas`}
            style={{ background: "none", border: "none", cursor: "pointer", fontSize: 32, padding: 2, color: n <= estrelas ? "#e8a13c" : "#ddd3e5" }}>
            ★
          </button>
        ))}
      </div>
      <textarea className="c-input" rows={2} maxLength={500}
        placeholder="Comentário (opcional)…" value={comentario}
        onChange={(e) => setComentario(e.target.value)} />
      {erro && <p style={{ color: "var(--vermelho-c)", fontSize: 13 }}>⚠️ {erro}</p>}
      <button className="c-btn c-btn-prim c-btn-bloco" style={{ marginTop: 8 }}
        disabled={estrelas === 0 || mut.isPending}
        onClick={() => {
          setErro("");
          mut.mutate({ codigo: pedido.codigo, telefone: pedido.clienteTelefone, estrelas, comentario: comentario.trim() || undefined });
        }}>
        {mut.isPending ? "A enviar…" : "Enviar avaliação"}
      </button>
      {modal && onFechar && (
        <button className="c-btn c-btn-cinza c-btn-bloco" style={{ marginTop: 8 }} onClick={onFechar}>
          Avaliar mais tarde
        </button>
      )}
    </div>
  );
}

function PropostaCard({ pedido }: { pedido: AcompData }) {
  const utils = trpc.useUtils();
  const prop = pedido.proposta!;
  const originais = prop.itensOriginais ?? pedido.itens; // fotografia dos itens no momento da proposta
  const [aceites, setAceites] = useState<number[]>(prop.adicionados.map((_, i) => i));
  const [outros, setOutros] = useState<Array<{ produtoId: number; nome: string; preco: number; qtd: number }>>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [buscaMenu, setBuscaMenu] = useState("");
  const [erro, setErro] = useState("");
  const [feito, setFeito] = useState(false);
  const menu = trpc.loja.menu.useQuery({ tipo: pedido.tipo }, { enabled: pickerOpen });

  const resp = trpc.loja.responderProposta.useMutation({
    onSuccess: () => { setFeito(true); utils.loja.acompanhar.invalidate(); },
    onError: (e) => setErro(e.message),
  });

  const removidosTotal = prop.removidos.reduce((a, i) => a + (originais[i]?.total ?? 0), 0);
  const aceitesTotal = prop.adicionados.reduce((a, ad, i) => a + (aceites.includes(i) ? ad.total : 0), 0);
  const outrosTotal = outros.reduce((a, o) => a + o.preco * o.qtd, 0);
  const novoTotal = Math.round((pedido.total - removidosTotal + aceitesTotal + outrosTotal) * 100) / 100;

  const menuFiltrado = (menu.data ?? []).filter((m) =>
    buscaMenu.trim() === "" || m.nome.toLowerCase().includes(buscaMenu.trim().toLowerCase()));

  if (feito) {
    return (
      <div className="c-card" style={{ background: "#e8f6ec" }}>
        ✅ <b>Resposta enviada!</b> O restaurante já recebeu a sua escolha. Novo total: <b>{mt(novoTotal)}</b>.
      </div>
    );
  }

  return (
    <div className="c-card" style={{ border: "2px solid #e8a13c", background: "#fffaf1" }}>
      <div style={{ fontWeight: 800, fontSize: 15 }}>⚠️ Alteração proposta pelo restaurante</div>
      <p className="c-sub" style={{ margin: "4px 0 10px" }}>
        {prop.criadoPor} propôs alterar o seu pedido. Confirme o que aceita — os itens fora de stock serão retirados da conta.
      </p>

      {prop.removidos.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div className="c-label" style={{ color: "var(--vermelho-c)" }}>❌ Fora de stock (serão retirados):</div>
          {prop.removidos.map((i) => (
            <div className="c-linha" key={i} style={{ opacity: .75 }}>
              <div className="grow tit" style={{ textDecoration: "line-through" }}>{originais[i]?.qtd}× {originais[i]?.nome}</div>
              <span>− {mt(originais[i]?.total ?? 0)}</span>
            </div>
          ))}
        </div>
      )}

      {prop.adicionados.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div className="c-label">🔄 Substitutos propostos — toque para aceitar ou recusar:</div>
          {prop.adicionados.map((ad, i) => {
            const on = aceites.includes(i);
            return (
              <div className="c-linha" key={i}>
                <div className="grow tit">{ad.qtd}× {ad.nome}</div>
                <span style={{ marginRight: 6 }}>{mt(ad.total)}</span>
                <button
                  className={`c-btn c-btn-peq ${on ? "c-btn-verde" : "c-btn-cinza"}`}
                  onClick={() => setAceites((a) => (on ? a.filter((x) => x !== i) : [...a, i]))}
                >
                  {on ? "✔ Aceite" : "✕ Recusado"}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {outros.map((o) => (
        <div className="c-linha" key={o.produtoId}>
          <div className="grow tit">➕ {o.qtd}× {o.nome}</div>
          <span style={{ marginRight: 6 }}>{mt(o.preco * o.qtd)}</span>
          <button className="c-btn c-btn-perigo c-btn-peq" onClick={() => setOutros((l) => l.filter((x) => x.produtoId !== o.produtoId))}>✕</button>
        </div>
      ))}
      <button className="c-btn c-btn-linha c-btn-bloco" style={{ margin: "6px 0" }} onClick={() => setPickerOpen(!pickerOpen)}>
        {pickerOpen ? "▲ Fechar lista de produtos" : "🍽️ Escolher outros produtos do menu…"}
      </button>
      {pickerOpen && (
        <div style={{ background: "#fff", borderRadius: 12, padding: 10, border: "1px solid #eadff0" }}>
          <input className="c-input" placeholder="Pesquisar produto…" value={buscaMenu} onChange={(e) => setBuscaMenu(e.target.value)} />
          <div style={{ maxHeight: 240, overflowY: "auto", marginTop: 6 }}>
            {menu.isLoading && <p className="c-sub">A carregar…</p>}
            {menuFiltrado.map((m) => (
              <div className="c-linha" key={m.id} style={{ padding: "6px 0" }}>
                <div className="grow" style={{ fontSize: 13 }}>
                  {m.nome} <span className="c-sub">· {m.categoria}</span>
                </div>
                <b style={{ fontSize: 12.5, marginRight: 6 }}>{mt(m.preco)}</b>
                <button className="c-btn c-btn-prim c-btn-peq"
                  onClick={() => setOutros((l) => {
                    const ex = l.find((x) => x.produtoId === m.id);
                    if (ex) return l.map((x) => (x.produtoId === m.id ? { ...x, qtd: x.qtd + 1 } : x));
                    return [...l, { produtoId: m.id, nome: m.nome, preco: m.preco, qtd: 1 }];
                  })}>＋</button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="c-total-linha grande" style={{ marginTop: 8 }}>
        <span>NOVO TOTAL</span>
        <span>{mt(novoTotal)} <small className="c-sub" style={{ fontWeight: 400 }}>(antes {mt(pedido.total)})</small></span>
      </div>
      {erro && <p style={{ color: "var(--vermelho-c)", fontSize: 13 }}>⚠️ {erro}</p>}
      <button className="c-btn c-btn-prim c-btn-bloco" style={{ marginTop: 8 }}
        disabled={resp.isPending}
        onClick={() => {
          setErro("");
          resp.mutate({
            codigo: pedido.codigo, telefone: pedido.clienteTelefone,
            aceites, outros: outros.map((o) => ({ produtoId: o.produtoId, qtd: o.qtd })),
          });
        }}>
        {resp.isPending ? "A enviar…" : "✅ Confirmar a minha escolha"}
      </button>
    </div>
  );
}

/* ============ UPLOAD TARDIO DE COMPROVATIVO ============ */
function ComprovativoTardio({ codigo, telefone, valor }: { codigo: string; telefone: string; valor: number }) {
  const utils = trpc.useUtils();
  const [ficheiro, setFicheiro] = useState<string | null>(null);
  const [metodo, setMetodo] = useState<MetodoOnline | null>(null);
  const [erro, setErro] = useState("");
  const [ok, setOk] = useState(false);
  const enviar = trpc.loja.enviarComprovativo.useMutation({
    onSuccess: () => { setOk(true); utils.loja.acompanhar.invalidate(); },
    onError: (e) => setErro(e.message),
  });
  if (ok) return null;
  return (
    <div className="c-card" style={{ background: "#fdf3dd" }}>
      <div className="c-titulo" style={{ fontSize: 15 }}>💳 Pagamento</div>
      <p className="c-sub">O seu pedido ainda está pendente. Escolha o método e confirme o pagamento para ser processado.</p>
      <SeletorPagamento metodo={metodo} setMetodo={(m) => { setMetodo(m); setErro(""); }} valor={valor} />
      {metodo && metodo !== "Dinheiro" && (
        <>
          <UploadFicheiro rotulo="3️⃣ Anexe o comprovativo de pagamento:"
            onFicheiro={async (f) => {
              setErro("");
              try { setFicheiro(await fileToDataUrl(f, 1200, 0.8)); }
              catch (err) { setErro((err as Error).message); }
            }} />
          {ficheiro?.startsWith("data:image") && (
            <img src={ficheiro} alt="comprovativo" style={{ width: "100%", maxHeight: 200, objectFit: "contain", marginTop: 8, borderRadius: 10 }} />
          )}
        </>
      )}
      {erro && <p style={{ color: "var(--vermelho-c)", fontSize: 13 }}>⚠️ {erro}</p>}
      <button className="c-btn c-btn-prim c-btn-bloco" style={{ marginTop: 10 }}
        disabled={!metodo || (metodo !== "Dinheiro" && !ficheiro) || enviar.isPending}
        onClick={() => metodo && enviar.mutate({ codigo, telefone, metodo, comprovativo: ficheiro ?? undefined })}>
        {enviar.isPending ? "A enviar…" : metodo === "Dinheiro" ? "💵 Confirmar pagamento em dinheiro" : "📤 Enviar comprovativo"}
      </button>
    </div>
  );
}

/* ============ CONTA DO CLIENTE (registo opcional) ============ */
function Conta({ cliente, token, onEntrar, onSair, onVoltar, onVerPedido }: {
  cliente: { id: number; nome: string; telefone: string } | null; token: string;
  onEntrar: (t: string) => void; onSair: () => void; onVoltar: () => void;
  onVerPedido: (codigo: string, tel: string) => void;
}) {
  const [modo, setModo] = useState<"login" | "registo" | "recuperar">("registo");
  const [f, setF] = useState({ nome: "", telefone: "", email: "", senha: "" });
  const [erro, setErro] = useState("");

  const registo = trpc.loja.registo.useMutation({
    onSuccess: (r) => onEntrar(r.token), onError: (e) => setErro(e.message),
  });
  const login = trpc.loja.login.useMutation({
    onSuccess: (r) => onEntrar(r.token), onError: (e) => setErro(e.message),
  });
  const historico = trpc.loja.historico.useQuery({ token }, { enabled: !!cliente && !!token, retry: false });
  const sairMut = trpc.loja.sair.useMutation({ onSettled: onSair });
  const recup = trpc.loja.recuperarSenha.useMutation({
    onSuccess: () => { setErro(""); setRecupOk(true); },
    onError: (e) => { setRecupOk(false); setErro(e.message); },
  });
  const [recupOk, setRecupOk] = useState(false);

  const chipCor = (s: string) =>
    s === "Cancelado" ? "c-chip-vermelho" : ["Entregue", "Concluído", "Pronto"].includes(s) ? "c-chip-verde" : s === "Pendente" ? "c-chip-amarelo" : "c-chip-azul";

  return (
    <div>
      <button className="c-btn c-btn-cinza c-btn-peq" onClick={onVoltar} style={{ marginBottom: 10 }}>← Voltar</button>
      {!cliente ? (
        <>
          <div className="c-titulo">👤 {modo === "registo" ? "Criar conta (opcional)" : modo === "recuperar" ? "Recuperar senha" : "Entrar"}</div>
          <p className="c-sub" style={{ marginTop: -6 }}>Pode pedir sem conta. O registo guarda o seu histórico de pedidos.</p>
          {modo === "recuperar" && (
            <div className="c-card">
              {recupOk ? (
                <>
                  <p style={{ color: "var(--verde-c)", fontSize: 14 }}>✅ Senha alterada com sucesso! Já pode entrar com a nova senha.</p>
                  <button className="c-btn c-btn-prim c-btn-bloco" style={{ marginTop: 10 }}
                    onClick={() => { setRecupOk(false); setModo("login"); }}>
                    🔑 Ir para o login
                  </button>
                </>
              ) : (
                <>
                  <p className="c-sub">Confirme a sua identidade com o telefone e o email usados no registo, e escolha uma nova senha.</p>
                  <label className="c-label">Telefone com WhatsApp *</label>
                  <TelInput value={f.telefone} onChange={(v) => setF({ ...f, telefone: v })} required />
                  <label className="c-label">Email do registo *</label>
                  <input className="c-input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="email@exemplo.com" />
                  <label className="c-label">Nova senha *</label>
                  <SenhaInput value={f.senha} onChange={(v) => setF({ ...f, senha: v })} placeholder="mín. 4 caracteres" />
                  {erro && <p style={{ color: "var(--vermelho-c)", fontSize: 13 }}>⚠️ {erro}</p>}
                  <button className="c-btn c-btn-prim c-btn-bloco" style={{ marginTop: 12 }}
                    disabled={recup.isPending}
                    onClick={() => {
                      setErro("");
                      const telD = f.telefone.replace(/\D/g, "");
                      if (telD.length < 9) { setErro("Indique o telefone com WhatsApp (9 dígitos)."); return; }
                      if (!f.email.includes("@")) { setErro("Indique o email usado no registo."); return; }
                      if (f.senha.length < 4) { setErro("A nova senha deve ter pelo menos 4 caracteres."); return; }
                      recup.mutate({ telefone: telD, email: f.email, senhaNova: f.senha });
                    }}>
                    {recup.isPending ? "A verificar…" : "🔐 Definir nova senha"}
                  </button>
                  <button className="c-btn c-btn-cinza c-btn-bloco" style={{ marginTop: 8 }}
                    onClick={() => { setErro(""); setModo("login"); }}>
                    ← Voltar ao login
                  </button>
                </>
              )}
            </div>
          )}
          {modo !== "recuperar" && (<div className="c-card">
            {modo === "registo" && (
              <>
                <label className="c-label">Nome *</label>
                <input className="c-input" value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} placeholder="Nome completo" />
              </>
            )}
            <label className="c-label">Telefone com WhatsApp *</label>
            <TelInput value={f.telefone} onChange={(v) => setF({ ...f, telefone: v })} required />
            {modo === "registo" && (
              <>
                <label className="c-label">Email (opcional)</label>
                <input className="c-input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="email@exemplo.com" />
              </>
            )}
            <label className="c-label">Senha *</label>
            <SenhaInput value={f.senha} onChange={(v) => setF({ ...f, senha: v })} placeholder="mín. 4 caracteres" />
            {erro && <p style={{ color: "var(--vermelho-c)", fontSize: 13 }}>⚠️ {erro}</p>}
            <button className="c-btn c-btn-prim c-btn-bloco" style={{ marginTop: 12 }}
              disabled={registo.isPending || login.isPending}
              onClick={() => {
                setErro("");
                const telD = f.telefone.replace(/\D/g, "");
                if (telD.length < 9) { setErro("Indique o telefone com WhatsApp (9 dígitos)."); return; }
                if (modo === "registo") {
                  if (f.nome.trim().length < 2) { setErro("Indique o seu nome."); return; }
                  registo.mutate({ nome: f.nome, telefone: telD, email: f.email, senha: f.senha });
                } else login.mutate({ telefone: telD, senha: f.senha });
              }}>
              {modo === "registo" ? "✅ Registar" : "🔑 Entrar"}
            </button>
            <button className="c-btn c-btn-cinza c-btn-bloco" style={{ marginTop: 8 }}
              onClick={() => { setErro(""); setModo(modo === "registo" ? "login" : "registo"); }}>
              {modo === "registo" ? "Já tenho conta — Entrar" : "Não tenho conta — Registar"}
            </button>
            {modo === "login" && (
              <button className="c-btn c-btn-linha c-btn-bloco" style={{ marginTop: 6 }}
                onClick={() => { setErro(""); setModo("recuperar"); }}>
                🔐 Esqueci a senha — Recuperar conta
              </button>
            )}
          </div>)}
        </>
      ) : (
        <>
          <div className="c-titulo">📜 Os meus pedidos</div>
          <div className="c-card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>👤 <b>{cliente.nome}</b><br /><span className="c-sub">+258 {cliente.telefone}</span></span>
            <button className="c-btn c-btn-cinza c-btn-peq" onClick={() => sairMut.mutate({ token })}>Sair</button>
          </div>
          {historico.data?.length === 0 && <p className="c-sub">Ainda não tem pedidos.</p>}
          {historico.data?.map((h) => (
            <button key={h.id} className="c-menu-btn" onClick={() => onVerPedido(h.codigo, cliente.telefone)}>
              <span style={{ fontSize: 20 }}>🧾</span>
              <span style={{ flex: 1 }}>
                {h.codigo} — {mt(h.total)}
                <small>{h.tipo}{h.mesa ? ` · Mesa ${h.mesa}` : ""}{h.dataAgendada ? ` · ${h.dataAgendada}` : ""}</small>
              </span>
              <span className={`c-chip ${chipCor(h.status)}`}>{h.status}</span>
            </button>
          ))}
        </>
      )}
    </div>
  );
}
