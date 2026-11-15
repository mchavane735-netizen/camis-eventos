import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { SessionProvider, useSession } from "@/lib/session";
import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
// Páginas pesadas carregadas sob procura (lazy) — a app abre mais leve e rápida
const Vender = lazy(() => import("@/pages/Vender"));
const CozinhaSalao = lazy(() => import("@/pages/CozinhaSalao"));
const Reservas = lazy(() => import("@/pages/Reservas"));
const Braai = lazy(() => import("@/pages/Braai"));
const Vagas = lazy(() => import("@/pages/Vagas"));
const VagasPublicas = lazy(() => import("@/pages/VagasPublicas"));
const RH = lazy(() => import("@/pages/RH"));
const Eventos = lazy(() => import("@/pages/Eventos"));
const Dividas = lazy(() => import("@/pages/Dividas"));
const Buffet = lazy(() => import("@/pages/Buffet"));
const Documentos = lazy(() => import("@/pages/Documentos"));
const Estoque = lazy(() => import("@/pages/Estoque"));
const Produtos = lazy(() => import("@/pages/Produtos"));
const Pagamentos = lazy(() => import("@/pages/Pagamentos"));
const Relatorios = lazy(() => import("@/pages/Relatorios"));
const CRM = lazy(() => import("@/pages/CRM"));
const Despesas = lazy(() => import("@/pages/Despesas"));
const Financeiro = lazy(() => import("@/pages/Financeiro"));
const Agente = lazy(() => import("@/pages/Agente"));
const Gerencia = lazy(() => import("@/pages/Gerencia"));
const Entregas = lazy(() => import("@/pages/Entregas"));
const Ajuda = lazy(() => import("@/pages/Ajuda"));
const Config = lazy(() => import("@/pages/Config"));
const Online = lazy(() => import("@/pages/Online"));
const QRCodes = lazy(() => import("@/pages/QRCodes"));
const Loja = lazy(() => import("@/pages/loja/Loja"));
const Afiliados = lazy(() => import("@/pages/Afiliados"));
const AfiliadoApp = lazy(() => import("@/pages/afiliado/AfiliadoApp"));

/** Ecrã leve enquanto uma página é carregada sob procura */
function ACarregar() {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "40vh", fontSize: 15, opacity: 0.7 }}>
      ⏳ A carregar…
    </div>
  );
}
import { trpc } from "@/providers/trpc";
import { useEmpresa } from "@/lib/empresa";
import { usePresenca } from "@/lib/presenca";
import { somNovoPedido, somPagamento, somReserva } from "@/lib/som";
import { waLink } from "@/lib/loja";

type View = "dashboard" | "vender" | "reservas" | "documentos" | "menu"
  | "produtos" | "estoque" | "pagamentos" | "relatorios" | "config" | "online" | "qrcodes"
  | "despesas" | "financeiro" | "gerencia" | "entregas" | "ajuda" | "afiliados" | "agente" | "braai" | "vagas" | "dividas" | "buffet" | "rh" | "crm" | "eventos";

const LOCK_MS = 10 * 60 * 1000; // bloqueio automático após 10 minutos sem uso

/** Lê os parâmetros da loja online (?loja=1&mesa=N) uma única vez */
function paramsLoja() {
  const q = new URLSearchParams(window.location.search);
  if (q.get("loja") !== "1") return null;
  return { mesa: q.get("mesa") || undefined };
}

/** Ecrã da área pública do afiliado (?afiliado=1) */
function paramsAfiliado() {
  const q = new URLSearchParams(window.location.search);
  return q.get("afiliado") === "1";
}

/** Página pública de concursos de vagas (?vagas=1) — sem login */
function paramsVagas() {
  const q = new URLSearchParams(window.location.search);
  return q.get("vagas") === "1";
}

/** Ecrã de bloqueio por inactividade — o utilizador volta a entrar só com a senha */
function LockScreen({ onDesbloquear }: { onDesbloquear: () => void }) {
  const { user, sair, toast } = useSession();
  const [senha, setSenha] = useState("");
  const login = trpc.usuarios.login.useMutation();

  const entrar = () => {
    if (!user || !senha) return;
    login.mutate({ usuarioId: user.id, pin: senha }, {
      onSuccess: (u) => {
        setSenha("");
        if (u.senhaFraca) { sair(); return; } // senha antiga: obriga troca no login completo
        onDesbloquear();
      },
      onError: (e) => toast("⚠️ " + e.message),
    });
  };

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center",
      background: "linear-gradient(160deg,#3d0c40 0%,#5e1460 45%,#8a2a8d 100%)", padding: 24,
    }}>
      <div style={{
        background: "#fff", borderRadius: 22, padding: "26px 24px", width: "100%", maxWidth: 380,
        boxShadow: "0 18px 50px rgba(0,0,0,.35)", textAlign: "center",
      }}>
        <div style={{ fontSize: 44 }}>🔒</div>
        <h2 style={{ fontSize: 17, color: "var(--roxo)", margin: "4px 0" }}>Sistema bloqueado</h2>
        <p className="c-sub">10 minutos sem uso. {user?.nome}, introduza a sua senha para continuar. (A sua conta NÃO está bloqueada — é só o bloqueio de ecrã por inactividade.)</p>
        <input
          className="c-input" type="password" placeholder="••••••" value={senha} autoFocus
          style={{ textAlign: "center", letterSpacing: 4, fontSize: 18 }}
          onChange={(e) => setSenha(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && entrar()}
        />
        <button className="c-btn c-btn-prim c-btn-bloco" style={{ marginTop: 12 }} disabled={login.isPending} onClick={entrar}>
          {login.isPending ? "…" : "🔓 Desbloquear"}
        </button>
        <button className="c-btn c-btn-cinza c-btn-bloco" style={{ marginTop: 8 }} onClick={sair}>
          🚪 Trocar de utilizador
        </button>
      </div>
    </div>
  );
}

/** Popup de alerta de atraso — aparece para QUALQUER utilizador com sessão aberta */
function AlertaAtraso({ atrasados, onFechar, onVer }: {
  atrasados: Array<{ id: number; codigo: string; clienteNome: string; tipo: string; fimEstimado: string | null }>;
  onFechar: () => void; onVer: () => void;
}) {
  if (atrasados.length === 0) return null;
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 90, display: "flex", alignItems: "center", justifyContent: "center",
      background: "rgba(30,0,30,.55)", padding: 24,
    }}>
      <div style={{
        background: "#fff", borderRadius: 18, padding: "22px 20px", width: "100%", maxWidth: 420,
        border: "3px solid var(--vermelho-c)", boxShadow: "0 18px 50px rgba(0,0,0,.4)",
      }}>
        <div style={{ fontSize: 40, textAlign: "center" }}>🚨</div>
        <h2 style={{ fontSize: 17, color: "var(--vermelho-c)", textAlign: "center", margin: "4px 0 10px" }}>
          {atrasados.length === 1 ? "PEDIDO ATRASADO!" : `${atrasados.length} PEDIDOS ATRASADOS!`}
        </h2>
        <p className="c-sub" style={{ textAlign: "center" }}>
          Passaram mais de 3 minutos da hora prevista. O cliente já recebeu uma mensagem
          automática de desculpas — <b>entrega/conclusão urgente necessária!</b>
        </p>
        {atrasados.map((a) => (
          <div key={a.id} className="c-linha" style={{ borderBottom: "1px solid #f0e6f2", padding: "8px 0" }}>
            <div className="grow tit">🧾 {a.codigo} — {a.clienteNome}</div>
            <span className="c-sub">previsto {a.fimEstimado ?? "?"}</span>
          </div>
        ))}
        <button className="c-btn c-btn-perigo c-btn-bloco" style={{ marginTop: 14 }} onClick={onVer}>
          🛎️ Ver pedidos agora
        </button>
        <button className="c-btn c-btn-cinza c-btn-bloco" style={{ marginTop: 8 }} onClick={onFechar}>
          Já estou a tratar disso
        </button>
      </div>
    </div>
  );
}

function Shell() {
  const { user, sair, toast } = useSession();
  const [view, setView] = useState<View>("dashboard");
  const eEntregador = user?.perfil === "Entregador";

  /* o entregador entra directamente na sua página de entregas */
  useEffect(() => {
    if (eEntregador && (view === "dashboard" || view === "vender" || view === "reservas" || view === "documentos"))
      setView("entregas");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eEntregador, user?.id]);
  const [hora, setHora] = useState("--:--");
  const [dia, setDia] = useState("");
  const [locked, setLocked] = useState(false);
  const [atrasados, setAtrasados] = useState<Array<{ id: number; codigo: string; clienteNome: string; tipo: string; fimEstimado: string | null }>>([]);
  const [resumo, setResumo] = useState<{ data: string; texto: string; destino: string } | null>(null);
  const [lembretes, setLembretes] = useState<Array<{ id: number; codigo: string; cliente: string; contacto: string | null; dataConsumo: string; hora: string | null; tipo: string; quando: string }>>([]);
  const lembVistos = useRef<Set<string>>(new Set());
  const [pendOcultos, setPendOcultos] = useState(0); // nº de pendentes que o utilizador já dispensou
  const ultimaActividade = useRef(Date.now());
  const stockStats = trpc.dashboard.stats.useQuery({ usuarioId: user?.id ?? 0 }, { refetchInterval: 30000, enabled: !!user && ["Admin", "Gestor", "Vendedor"].includes(user.perfil) });
  const divResumo = trpc.dividas.resumo.useQuery({ usuarioId: user?.id ?? 0 }, { refetchInterval: 30000, enabled: !!user && ["Admin", "Gestor", "Vendedor"].includes(user.perfil) });
  const rhPainel = trpc.rh.painel.useQuery({ usuarioId: user?.id ?? 0 }, { refetchInterval: 60000, enabled: !!user && (user.perfil === "Admin" || user.perfil === "RH") });
  const rhAlertas = { data: (rhPainel.data?.trabalhadores ?? []).filter((t) => t.ativo && (t.mesesEmAtraso.length > 0 || [5, 3, 1, 0].includes(t.diasParaPagamento))).length };
  const emp = useEmpresa();
  const atrasosMut = trpc.online.atrasos.useMutation();
  const resumoMut = trpc.financeiro.resumoPendente.useMutation();
  // pedidos online com comprovativo à espera de confirmação (alerta no rodapé)
  const podeCaixa = !!user && ["Admin", "Gestor", "Vendedor"].includes(user.perfil);
  const pendentesQ = trpc.online.list.useQuery({ usuarioId: user?.id ?? 0 }, {
    enabled: podeCaixa, refetchInterval: 20_000, retry: false,
  });
  const nPendentes = (pendentesQ.data ?? []).filter((p) => p.status === "Comprovativo Enviado").length;
  const nNovos = (pendentesQ.data ?? []).filter((p) => p.status === "Pendente").length;
  const [novosOcultos, setNovosOcultos] = useState(0);
  const prevAlerta = useRef<{ pend: number; novo: number } | null>(null);

  /* som de alerta quando sobem os contadores (novo pedido / comprovativo) */
  useEffect(() => {
    const prev = prevAlerta.current;
    prevAlerta.current = { pend: nPendentes, novo: nNovos };
    if (prev === null) return; // primeira carga — não tocar
    if (nNovos > prev.novo) somNovoPedido();
    if (nPendentes > prev.pend) somPagamento();
  }, [nNovos, nPendentes]);

  usePresenca("sistema", !!user);

  /* vendedores: verificação periódica do acesso por horário — ao chegar a hora de
     saída (ou fim do desbloqueio excepcional / bloqueio manual) a sessão termina */
  const checkAcesso = trpc.usuarios.checkAcesso.useQuery(
    { usuarioId: user?.id ?? 0 },
    { enabled: user?.perfil === "Vendedor", refetchInterval: 60_000, retry: false },
  );
  useEffect(() => {
    if (user?.perfil === "Vendedor" && checkAcesso.data && !checkAcesso.data.permitido) {
      toast(checkAcesso.data.motivo ?? "🔒 Acesso bloqueado.");
      sair();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkAcesso.data?.permitido]);

  /* relógio */
  useEffect(() => {
    const tick = () => {
      const d = new Date();
      setHora(d.toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" }));
      setDia(d.toLocaleDateString("pt-PT", { weekday: "short", day: "2-digit", month: "short" }));
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);

  /* bloqueio automático após 10 minutos sem interacção */
  useEffect(() => {
    if (!user) return;
    const marcar = () => { ultimaActividade.current = Date.now(); };
    const eventos = ["pointerdown", "keydown", "touchstart", "scroll"] as const;
    eventos.forEach((e) => window.addEventListener(e, marcar, { passive: true }));
    const t = setInterval(() => {
      if (Date.now() - ultimaActividade.current > LOCK_MS) setLocked(true);
    }, 5000);
    return () => { eventos.forEach((e) => window.removeEventListener(e, marcar)); clearInterval(t); };
  }, [user]);

  /* watchdog de atrasos — verifica a cada 30s e dispara popup para qualquer utilizador */
  useEffect(() => {
    if (!user || user.perfil === "Entregador") return;
    const verificar = () => {
      atrasosMut.mutateAsync({ usuarioId: user.id })
        .then((r) => { if (r.atrasados.length > 0) setAtrasados((prev) => {
          const novos = r.atrasados.filter((a) => !prev.some((p) => p.id === a.id));
          return novos.length ? [...prev, ...novos] : prev;
        }); })
        .catch(() => undefined);
    };
    verificar();
    const t = setInterval(verificar, 30_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  /* resumo diário das 23:00 (hora de Moçambique) — aparece uma vez por dia para Admin/Gestor,
     pronto a enviar por WhatsApp com um toque. Se ninguém estiver ligado às 23:00,
     aparece no primeiro acesso do dia seguinte (resumo do dia anterior). */
  useEffect(() => {
    if (!user || (user.perfil !== "Admin" && user.perfil !== "Gestor")) return;
    const verificar = () => {
      resumoMut.mutateAsync({ usuarioId: user.id })
        .then((r) => { if (r.pendente) setResumo({ data: r.data, texto: r.texto, destino: r.destino }); })
        .catch(() => undefined);
    };
    verificar();
    const t = setInterval(verificar, 60_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  /* lembretes de reserva: 1 dia antes e 3h antes — popup com contacto do cliente */
  const lembMut = trpc.reservas.lembretes.useMutation();
  useEffect(() => {
    if (!user || !["Admin", "Gestor", "Vendedor"].includes(user.perfil)) return;
    const verificar = () => {
      lembMut.mutateAsync({ usuarioId: user.id })
        .then((lista) => {
          const novos = lista.filter((l) => !lembVistos.current.has(l.codigo + l.quando));
          if (novos.length) {
            novos.forEach((l) => lembVistos.current.add(l.codigo + l.quando));
            somReserva();
            setLembretes((prev) => [...prev, ...novos]);
          }
        })
        .catch(() => undefined);
    };
    verificar();
    const t = setInterval(verificar, 60_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  useEffect(() => { window.scrollTo(0, 0); }, [view]);

  /* se o nº de pendentes baixar (já confirmados), repõe o contador dispensado
     para que NOVOS pagamentos voltem a fazer subir o popup */
  useEffect(() => {
    setPendOcultos((v) => (nPendentes < v ? nPendentes : v));
    setNovosOcultos((v) => (nNovos < v ? nNovos : v));
  }, [nPendentes, nNovos]);

  if (!user) return <Login />;

  const go = (v: View) => setView(v);

  /* 📦 Perfil LOGISTICA — acesso apenas ao lançamento de despesas/compras */
  if (user.perfil === "Logistica") {
    return (
      <div>
        <header style={{
          position: "sticky", top: 0, zIndex: 30,
          background: "linear-gradient(120deg,var(--roxo) 0%,var(--roxo2) 60%,#8a2a8d 100%)",
          color: "#fff", padding: "8px 14px 10px", textAlign: "center",
        }}>
          <img src="/icons/logo.png" alt="" style={{ width: 42, height: 42, borderRadius: "50%", background: "#fff", padding: 2, margin: "0 auto", display: "block" }} />
          <div style={{ lineHeight: 1.2, marginTop: 4 }}>
            <b style={{ fontSize: 15 }}>📦 Logística — Despesas</b>
            <span style={{ display: "block", fontSize: 10.5, opacity: .85 }}>{user.nome} · {hora}</span>
          </div>
          <button className="c-btn c-btn-cinza c-btn-peq" style={{ marginTop: 6 }} onClick={sair}>🚪 Sair</button>
        </header>
        <main style={{ padding: "14px 14px 92px", maxWidth: 760, margin: "0 auto" }}>
          <Suspense fallback={<ACarregar />}><Despesas /></Suspense>
        </main>
        {locked && <LockScreen onDesbloquear={() => { setLocked(false); ultimaActividade.current = Date.now(); }} />}
      </div>
    );
  }

  /* 👨‍🍳 Perfil COZINHA — acesso apenas aos pedidos online (preparo/pronto) */
  if (user.perfil === "Cozinha") {
    return (
      <div>
        <header style={{
          position: "sticky", top: 0, zIndex: 30,
          background: "linear-gradient(120deg,var(--roxo) 0%,var(--roxo2) 60%,#8a2a8d 100%)",
          color: "#fff", padding: "8px 14px 10px", textAlign: "center",
        }}>
          <img src="/icons/logo.png" alt="" style={{ width: 42, height: 42, borderRadius: "50%", background: "#fff", padding: 2, margin: "0 auto", display: "block" }} />
          <div style={{ lineHeight: 1.2, marginTop: 4 }}>
            <b style={{ fontSize: 15 }}>👨‍🍳 Cozinha — Pedidos</b>
            <span style={{ display: "block", fontSize: 10.5, opacity: .85 }}>{user.nome} · {hora}</span>
          </div>
          <button className="c-btn c-btn-cinza c-btn-peq" style={{ marginTop: 6 }} onClick={sair}>🚪 Sair</button>
        </header>
        <main style={{ padding: "14px 14px 92px", maxWidth: 760, margin: "0 auto" }}>
          <Suspense fallback={<ACarregar />}>
          <CozinhaSalao />
          <div className="c-titulo" style={{ fontSize: 17, marginTop: 6 }}>🌐 Pedidos online — pratos a preparar</div>
          <Online voltar={() => undefined} semVoltar />
          </Suspense>
        </main>
        {locked && <LockScreen onDesbloquear={() => { setLocked(false); ultimaActividade.current = Date.now(); }} />}
        <AlertaAtraso atrasados={atrasados} onFechar={() => setAtrasados([])} onVer={() => setAtrasados([])} />
      </div>
    );
  }

  /* 🎟 Perfil GESTOR DE EVENTOS — acesso APENAS à página de Eventos & Bilheteira */
  if (user.perfil === "Eventos") {
    return (
      <div>
        <header style={{
          position: "sticky", top: 0, zIndex: 30,
          background: "linear-gradient(120deg,var(--roxo) 0%,var(--roxo2) 60%,#8a2a8d 100%)",
          color: "#fff", padding: "8px 14px 10px", textAlign: "center",
        }}>
          <img src="/icons/logo.png" alt="" style={{ width: 42, height: 42, borderRadius: "50%", background: "#fff", padding: 2, margin: "0 auto", display: "block" }} />
          <div style={{ lineHeight: 1.2, marginTop: 4 }}>
            <b style={{ fontSize: 15 }}>🎟 Gestão de Eventos</b>
            <span style={{ display: "block", fontSize: 10.5, opacity: .85 }}>{user.nome} · {hora}</span>
          </div>
          <button className="c-btn c-btn-cinza c-btn-peq" style={{ marginTop: 6 }} onClick={sair}>🚪 Sair</button>
        </header>
        <main style={{ padding: "14px 14px 92px", maxWidth: 760, margin: "0 auto" }}>
          <Suspense fallback={<ACarregar />}>
            <Eventos />
          </Suspense>
        </main>
        {locked && <LockScreen onDesbloquear={() => { setLocked(false); ultimaActividade.current = Date.now(); }} />}
      </div>
    );
  }

  /* 👥 Perfil RH — acesso APENAS a Recursos Humanos, Vagas & Recrutamento e Afiliados */
  if (user.perfil === "RH") {
    return (
      <div>
        <header style={{
          position: "sticky", top: 0, zIndex: 30,
          background: "linear-gradient(120deg,var(--roxo) 0%,var(--roxo2) 60%,#8a2a8d 100%)",
          color: "#fff", padding: "8px 14px 10px", textAlign: "center",
        }}>
          <img src="/icons/logo.png" alt="" style={{ width: 42, height: 42, borderRadius: "50%", background: "#fff", padding: 2, margin: "0 auto", display: "block" }} />
          <div style={{ lineHeight: 1.2, marginTop: 4 }}>
            <b style={{ fontSize: 15 }}>👥 Gestão de Pessoas</b>
            <span style={{ display: "block", fontSize: 10.5, opacity: .85 }}>{user.nome} · {hora}</span>
          </div>
          <button className="c-btn c-btn-cinza c-btn-peq" style={{ marginTop: 6 }} onClick={sair}>🚪 Sair</button>
        </header>
        <main style={{ padding: "14px 14px 92px", maxWidth: 760, margin: "0 auto" }}>
          <Suspense fallback={<ACarregar />}>
          {view === "rh" && <RH voltar={() => setView("menu")} />}
          {view === "vagas" && <Vagas voltar={() => setView("menu")} />}
          {view === "afiliados" && <Afiliados voltar={() => setView("menu")} />}
          {(view === "menu" || view === "dashboard" || !["rh", "vagas", "afiliados"].includes(view)) && (
            <div>
              <div className="c-titulo">👥 Gestão de Pessoas</div>
              <button className="c-menu-btn" onClick={() => setView("rh")}>
                <span style={{ fontSize: 21 }}>👥</span>
                <span>Recursos Humanos<small>Trabalhadores · presenças · licenças · salários & contratos</small></span>
                {(rhAlertas.data ?? 0) > 0 && (
                  <span style={{ marginLeft: "auto", background: "var(--vermelho-c)", color: "#fff", borderRadius: 999, fontSize: 12, fontWeight: 800, padding: "2px 9px" }}>
                    {rhAlertas.data}
                  </span>
                )}
              </button>
              <button className="c-menu-btn" onClick={() => setView("vagas")}>
                <span style={{ fontSize: 21 }}>💼</span>
                <span>Vagas & Recrutamento<small>Concursos · candidaturas com CV · triagem automática</small></span>
              </button>
              <button className="c-menu-btn" onClick={() => setView("afiliados")}>
                <span style={{ fontSize: 21 }}>🤝</span>
                <span>Afiliados<small>CRM de vendedores · comissões · recibos · bónus</small></span>
              </button>
            </div>
          )}
          </Suspense>
        </main>
        {locked && <LockScreen onDesbloquear={() => { setLocked(false); ultimaActividade.current = Date.now(); }} />}
      </div>
    );
  }

  return (
    <div>
      <header style={{
        position: "sticky", top: 0, zIndex: 30,
        background: "linear-gradient(120deg,var(--roxo) 0%,var(--roxo2) 60%,#8a2a8d 100%)",
        color: "#fff", padding: "8px 14px 10px", textAlign: "center",
        boxShadow: "0 2px 12px rgba(61,12,64,.35)",
      }}>
        <img src="/icons/logo.png" alt="" style={{ width: 42, height: 42, borderRadius: "50%", background: "#fff", padding: 2, margin: "0 auto", display: "block" }} />
        <div style={{ lineHeight: 1.2, marginTop: 4 }}>
          <b style={{ fontSize: 15.5 }}>{emp.nome}</b>
          <span style={{ display: "block", fontSize: 10, opacity: .85 }}>NUIT: {emp.nuit}</span>
          <span style={{ display: "block", fontSize: 10.5, opacity: .85 }}>{user.nome} · {user.perfil} · <b>{hora}</b> · {dia}</span>
        </div>
        <EstabelecimentoBtn usuarioId={user.id} perfil={user.perfil} />
      </header>

      <main style={{ padding: "14px 14px 92px", maxWidth: 760, margin: "0 auto" }}>
        <Suspense fallback={<ACarregar />}>
        {view === "dashboard" && <Dashboard goVender={() => go("vender")} goEstoque={() => go("estoque")} goFinanceiro={() => go("financeiro")} goDividas={() => go("dividas")} />}
        {view === "vender" && <Vender />}
        {view === "reservas" && <Reservas />}
        {view === "braai" && <Braai voltar={() => go("menu")} />}
        {view === "buffet" && ["Admin", "Gestor", "Vendedor"].includes(user.perfil) && <Buffet voltar={() => go("menu")} />}
        {view === "eventos" && ["Admin", "Gestor", "Vendedor"].includes(user.perfil) && <Eventos />}
        {view === "vagas" && (user.perfil === "Admin") && <Vagas voltar={() => go("menu")} />}
        {view === "rh" && (user.perfil === "Admin") && <RH voltar={() => go("menu")} />}
        {view === "dividas" && ["Admin", "Gestor", "Vendedor"].includes(user.perfil) && <Dividas voltar={() => go("menu")} />}
        {view === "documentos" && <Documentos />}
        {view === "online" && <Online voltar={() => go("menu")} />}
        {view === "qrcodes" && <QRCodes voltar={() => go("menu")} />}
        {view === "produtos" && <Produtos voltar={() => go("menu")} />}
        {view === "estoque" && <Estoque voltar={() => go("menu")} />}
        {view === "pagamentos" && (user.perfil === "Admin" || user.perfil === "Gestor") && <Pagamentos voltar={() => go("menu")} />}
        {view === "despesas" && <Despesas voltar={() => go("menu")} />}
        {view === "agente" && <Agente voltar={() => go("menu")} />}
        {view === "financeiro" && <Financeiro voltar={() => go("menu")} />}
        {view === "gerencia" && <Gerencia voltar={() => go("menu")} />}
        {view === "afiliados" && (user.perfil === "Admin") && <Afiliados voltar={() => go("menu")} />}
        {view === "entregas" && <Entregas />}
        {view === "ajuda" && <Ajuda voltar={() => go("menu")} />}
        {view === "relatorios" && <Relatorios voltar={() => go("menu")} />}
        {view === "crm" && (user.perfil === "Admin" || user.perfil === "Gestor") && <CRM voltar={() => go("menu")} />}
        {view === "config" && <Config voltar={() => go("menu")} />}
        {view === "menu" && eEntregador && (
          <div>
            <div className="c-titulo">☰ Menu</div>
            <button className="c-menu-btn" onClick={() => go("entregas")}>
              <span style={{ fontSize: 21 }}>🛵</span>
              <span>As minhas entregas<small>Solicitações do restaurante · aceitar · entregue</small></span>
            </button>
            <button className="c-menu-btn" onClick={() => go("ajuda")}>
              <span style={{ fontSize: 21 }}>❓</span>
              <span>Instruções de Uso<small>Guia rápido do seu perfil</small></span>
            </button>
            <button className="c-btn c-btn-cinza c-btn-bloco" onClick={sair}>
              🚪 Terminar Sessão ({user.nome})
            </button>
          </div>
        )}
        {view === "menu" && !eEntregador && (
          <div>
            <div className="c-titulo">☰ Menu</div>
            <button className="c-menu-btn" onClick={() => go("online")}>
              <span style={{ fontSize: 21 }}>🛎️</span>
              <span>Pedidos Online<small>Pedidos da loja · confirmar pagamentos · estados</small></span>
            </button>
            <button className="c-menu-btn" onClick={() => go("braai")}>
              <span style={{ fontSize: 21 }}>🔥</span>
              <span>Braai<small>Regras & taxas · check-in de entrada no dia</small></span>
            </button>
            <button className="c-menu-btn" onClick={() => go("buffet")}>
              <span style={{ fontSize: 21 }}>🍽</span>
              <span>Buffet<small>Menus do Chefe por pessoa (1200–2500) · venda para grupos</small></span>
            </button>
            {["Admin", "Gestor", "Vendedor"].includes(user.perfil) && (
              <button className="c-menu-btn" onClick={() => go("eventos")}>
                <span style={{ fontSize: 21 }}>🎟</span>
                <span>Eventos & Bilheteira<small>Venda de entradas · cada pessoa registada · lista de entradas</small></span>
              </button>
            )}
            {["Admin", "Gestor", "Vendedor"].includes(user.perfil) && (
              <button className="c-menu-btn" onClick={() => go("dividas")}>
                <span style={{ fontSize: 21 }}>🧾</span>
                <span>Dívidas<small>{((divResumo.data?.abertas ?? 0) + (divResumo.data?.fornAbertas ?? 0)) > 0
                  ? `⚠️ ${divResumo.data!.abertas} de clientes · ${divResumo.data!.fornAbertas} a fornecedores`
                  : "Clientes & fornecedores · visível até ser pago"}</small></span>
                {((divResumo.data?.abertas ?? 0) + (divResumo.data?.fornAbertas ?? 0)) > 0 && (
                  <span style={{ marginLeft: "auto", background: "var(--vermelho-c)", color: "#fff", borderRadius: 999, fontSize: 12, fontWeight: 800, padding: "2px 9px" }}>
                    {(divResumo.data?.abertas ?? 0) + (divResumo.data?.fornAbertas ?? 0)}
                  </span>
                )}
              </button>
            )}
            {(user.perfil === "Admin") && (
              <button className="c-menu-btn" onClick={() => go("vagas")}>
                <span style={{ fontSize: 21 }}>💼</span>
                <span>Vagas & Recrutamento<small>Concursos · candidaturas com CV · triagem automática</small></span>
              </button>
            )}
            {(user.perfil === "Admin") && (
              <button className="c-menu-btn" onClick={() => go("rh")}>
                <span style={{ fontSize: 21 }}>👥</span>
                <span>Recursos Humanos<small>Trabalhadores · presenças · licenças · salários & contratos (só Admin)</small></span>
                {(rhAlertas.data ?? 0) > 0 && (
                  <span style={{ marginLeft: "auto", background: "var(--vermelho-c)", color: "#fff", borderRadius: 999, fontSize: 12, fontWeight: 800, padding: "2px 9px" }}>
                    {rhAlertas.data}
                  </span>
                )}
              </button>
            )}
            <button className="c-menu-btn" onClick={() => go("qrcodes")}>
              <span style={{ fontSize: 21 }}>📱</span>
              <span>Loja Online — Link & QR<small>Link público · QR codes das mesas</small></span>
            </button>
            <button className="c-menu-btn" onClick={() => go("produtos")}>
              <span style={{ fontSize: 21 }}>📦</span>
              <span>Produtos & Preços<small>Catálogo · fotos · adicionar novos produtos</small></span>
            </button>
            <button className="c-menu-btn" onClick={() => go("estoque")}>
              <span style={{ fontSize: 21 }}>📋</span>
              <span>Gestão de Estoque<small>{stockStats.data?.stockBaixo ?? 0} produto(s) em alerta</small></span>
            </button>
            {(user.perfil === "Admin" || user.perfil === "Gestor") && (
              <button className="c-menu-btn" onClick={() => go("pagamentos")}>
                <span style={{ fontSize: 21 }}>💳</span>
                <span>Pagamentos<small>Todas as transações recebidas</small></span>
              </button>
            )}
            <button className="c-menu-btn" onClick={() => go("despesas")}>
              <span style={{ fontSize: 21 }}>💸</span>
              <span>Despesas & Compras<small>Lançar gastos do dia · stock, transporte, energia…</small></span>
            </button>
            <button className="c-menu-btn" onClick={() => go("agente")}>
              <span style={{ fontSize: 21 }}>🏧</span>
              <span>Agente eMola / M-Pesa<small>Levantamentos & depósitos de clientes · comissões</small></span>
            </button>
            {(user.perfil === "Admin") && (
              <button className="c-menu-btn" onClick={() => go("afiliados")}>
                <span style={{ fontSize: 21 }}>🤝</span>
                <span>Afiliados<small>CRM de vendedores · comissões · recibos · bónus</small></span>
              </button>
            )}
            {(user.perfil === "Admin" || user.perfil === "Gestor") && (
              <button className="c-menu-btn" onClick={() => go("gerencia")}>
                <span style={{ fontSize: 21 }}>👔</span>
                <span>Conta Gerência<small>Consumo dos proprietários · stock sempre descontado</small></span>
              </button>
            )}
            {(user.perfil === "Admin" || user.perfil === "Gestor") && (
              <button className="c-menu-btn" onClick={() => go("financeiro")}>
                <span style={{ fontSize: 21 }}>📈</span>
                <span>Relatório Financeiro<small>Receitas · despesas · saldo do dia · imprimir</small></span>
              </button>
            )}
            {(user.perfil === "Admin" || user.perfil === "Gestor") && (
              <button className="c-menu-btn" onClick={() => go("crm")}>
                <span style={{ fontSize: 21 }}>👥</span>
                <span>CRM — Clientes<small>Nomes · contactos · vendas · perdas · imprimir A4</small></span>
              </button>
            )}
            <button className="c-menu-btn" onClick={() => go("relatorios")}>
              <span style={{ fontSize: 21 }}>📊</span>
              <span>Relatórios<small>Vendas por período · exportar CSV</small></span>
            </button>
            <button className="c-menu-btn" onClick={() => go("config")}>
              <span style={{ fontSize: 21 }}>⚙️</span>
              <span>Configurações<small>Empresa, horários, bairros, utilizadores</small></span>
            </button>
            <button className="c-menu-btn" onClick={() => go("ajuda")}>
              <span style={{ fontSize: 21 }}>❓</span>
              <span>Instruções de Uso<small>Guia rápido específico do seu perfil</small></span>
            </button>
            <button className="c-btn c-btn-cinza c-btn-bloco" onClick={sair}>
              🚪 Terminar Sessão ({user.nome})
            </button>
          </div>
        )}
        <footer style={{ textAlign: "center", fontSize: 11, color: "var(--suave-c)", padding: "18px 0 6px" }}>
          {emp.nome} · NUIT {emp.nuit} · Chimoio · {emp.tel1} / {emp.tel2}
        </footer>
        </Suspense>
      </main>

      <nav style={{
        position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 40, background: "#fff",
        display: "flex", boxShadow: "0 -3px 16px rgba(0,0,0,.12)", paddingBottom: "env(safe-area-inset-bottom)",
      }}>
        {((eEntregador
          ? [["entregas", "🛵", "Entregas"], ["menu", "☰", "Menu"]]
          : [
            ["dashboard", "🏠", "Início"],
            ["vender", "🛒", "Vender"],
            ["reservas", "📅", "Reservas"],
            ["documentos", "🧾", "Docs"],
            ["menu", "☰", "Menu"],
          ]) as Array<[View, string, string]>).map(([v, ic, lbl]) => (
          <button key={v} onClick={() => go(v)} style={{
            flex: 1, padding: "8px 2px 7px", display: "flex", flexDirection: "column",
            alignItems: "center", gap: 2, border: "none", background: "none", cursor: "pointer",
            color: (view === v || (["produtos", "estoque", "pagamentos", "relatorios", "config", "online", "qrcodes", "despesas", "financeiro", "afiliados", "ajuda", "braai", "eventos"].includes(view) && v === "menu"))
              ? "var(--roxo)" : "var(--suave-c)",
            fontSize: 10.5, fontWeight: 600,
          }}>
            <span style={{ fontSize: 20 }}>{ic}</span>
            {lbl}
          </button>
        ))}
      </nav>

      {locked && <LockScreen onDesbloquear={() => { setLocked(false); ultimaActividade.current = Date.now(); }} />}
      <AlertaAtraso atrasados={atrasados} onFechar={() => setAtrasados([])} onVer={() => { setAtrasados([]); go("online"); }} />
      {/* alerta de NOVO pedido online — desliza da barra inferior com som */}
      {podeCaixa && nNovos > novosOcultos && view !== "online" && (
        <div style={{
          position: "fixed", left: 12, right: 12, bottom: 66, zIndex: 81,
          maxWidth: 520, margin: "0 auto",
          background: "linear-gradient(120deg,#0d6e3f,#0a5530)", color: "#fff",
          borderRadius: 16, padding: "12px 14px", boxShadow: "0 10px 30px rgba(10,85,48,.45)",
          animation: "subirPopup .3s ease-out",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 26 }}>🔔</span>
            <div style={{ flex: 1, lineHeight: 1.3 }}>
              <b>{nNovos === 1 ? "Novo pedido online!" : `${nNovos} pedidos online novos!`}</b>
              <div style={{ fontSize: 12, opacity: .9 }}>
                {nNovos === 1 ? "Chegou um pedido" : "Chegaram pedidos"} da loja online à espera de atenção.
              </div>
            </div>
            <button onClick={() => setNovosOcultos(nNovos)}
              style={{ background: "rgba(255,255,255,.18)", color: "#fff", borderRadius: 8, padding: "6px 10px", fontSize: 12, fontWeight: 700 }}>
              ✕
            </button>
          </div>
          <button className="c-btn c-btn-prim c-btn-bloco" style={{ marginTop: 10 }}
            onClick={() => { setNovosOcultos(nNovos); go("online"); }}>
            🧾 Ver pedidos online
          </button>
        </div>
      )}
      {/* alerta de pagamentos por confirmar — desliza da barra inferior; reaparece se o número subir */}
      {podeCaixa && nPendentes > pendOcultos && view !== "online" && (
        <div style={{
          position: "fixed", left: 12, right: 12, bottom: 66, zIndex: 80,
          maxWidth: 520, margin: "0 auto",
          background: "linear-gradient(120deg,#7b1e7a,#5e1460)", color: "#fff",
          borderRadius: 16, padding: "12px 14px", boxShadow: "0 10px 30px rgba(61,12,64,.45)",
          animation: "subirPopup .3s ease-out",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 26 }}>🛎️</span>
            <div style={{ flex: 1, lineHeight: 1.3 }}>
              <b>{nPendentes === 1 ? "1 pagamento por confirmar!" : `${nPendentes} pagamentos por confirmar!`}</b>
              <div style={{ fontSize: 12, opacity: .9 }}>
                {nPendentes === 1 ? "Há um pedido online" : "Há pedidos online"} com comprovativo à espera da confirmação do restaurante.
              </div>
            </div>
            <button onClick={() => setPendOcultos(nPendentes)}
              style={{ background: "rgba(255,255,255,.18)", color: "#fff", borderRadius: 8, padding: "6px 10px", fontSize: 12, fontWeight: 700 }}>
              ✕
            </button>
          </div>
          <button className="c-btn c-btn-verde c-btn-bloco" style={{ marginTop: 10 }}
            onClick={() => { setPendOcultos(nPendentes); go("online"); }}>
            🧾 Ver e confirmar agora
          </button>
        </div>
      )}
      {lembretes.length > 0 && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 85, background: "rgba(20,8,26,.55)",
          display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
        }}>
          <div className="c-card" style={{ maxWidth: 440, width: "100%" }}>
            <div style={{ fontWeight: 800, fontSize: 16 }}>📅 Lembrete de Reserva</div>
            {lembretes.map((l) => (
              <div key={l.codigo + l.quando} className="c-linha" style={{ alignItems: "flex-start" }}>
                <div className="grow">
                  <b>{l.cliente}</b> — {l.quando}
                  <div className="c-sub">{l.codigo} · {l.tipo}</div>
                </div>
                {l.contacto && (
                  <a className="c-btn c-btn-verde c-btn-peq" style={{ textDecoration: "none" }}
                    href={`https://wa.me/258${l.contacto.replace(/\D/g, "")}`} target="_blank" rel="noreferrer">
                    📞 {l.contacto}
                  </a>
                )}
              </div>
            ))}
            <button className="c-btn c-btn-prim c-btn-bloco" style={{ marginTop: 10 }} onClick={() => setLembretes([])}>
              ✔ Entendido
            </button>
          </div>
        </div>
      )}
      {resumo && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 90, background: "rgba(20,8,26,.55)",
          display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
        }}>
          <div className="c-card" style={{ maxWidth: 440, width: "100%", maxHeight: "85dvh", overflowY: "auto" }}>
            <div style={{ fontWeight: 800, fontSize: 16 }}>🌙 Resumo do dia pronto</div>
            <p className="c-sub" style={{ margin: "4px 0 10px" }}>
              Toque em «Enviar por WhatsApp» para receber o resumo no número configurado
              ({resumo.destino}). Também pode copiar o texto.
            </p>
            <pre style={{
              whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: 12.5, lineHeight: 1.5,
              background: "#f6f2f9", borderRadius: 10, padding: 10, margin: 0,
            }}>{resumo.texto}</pre>
            <button className="c-btn c-btn-verde c-btn-bloco" style={{ marginTop: 10 }}
              onClick={() => window.open(waLink(resumo.destino, resumo.texto), "_blank")}>
              📲 Enviar por WhatsApp
            </button>
            <button className="c-btn c-btn-cinza c-btn-bloco" style={{ marginTop: 6 }} onClick={() => setResumo(null)}>
              Fechar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Botão no cabeçalho: Admin/Gestor/Caixa declara o estabelecimento ABERTO ou FECHADO.
    Quando fechado, todos os pedidos online são rejeitados (popup na loja). Reinicia a cada dia. */
function EstabelecimentoBtn({ usuarioId, perfil }: { usuarioId: number; perfil: string }) {
  const utils = trpc.useUtils();
  const pode = ["Admin", "Gestor", "Vendedor"].includes(perfil);
  const q = trpc.operacao.estabelecimento.useQuery(undefined, { refetchInterval: 30000 });
  const mut = trpc.operacao.setEstabelecimento.useMutation({
    onSuccess: () => utils.operacao.estabelecimento.invalidate(),
  });
  if (!pode || !q.data) return null;
  const fechado = q.data.fechado;
  return (
    <button
      className="c-btn c-btn-peq"
      style={{
        marginTop: 6, border: "none", fontWeight: 800,
        background: fechado ? "#d33" : "#1d9e5f", color: "#fff",
      }}
      disabled={mut.isPending}
      onClick={() => {
        if (fechado) {
          if (window.confirm("Reabrir o estabelecimento? Os pedidos online voltam a ser aceites."))
            mut.mutate({ usuarioId, estado: "auto" });
        } else if (window.confirm("Declarar o estabelecimento FECHADO? A partir deste momento todos os pedidos online serão rejeitados (o cliente vê um aviso na loja).")) {
          mut.mutate({ usuarioId, estado: "fechado" });
        }
      }}
    >
      {fechado ? "🔴 Fechado — tocar para reabrir" : "🟢 Aberto — tocar para fechar"}
    </button>
  );
}

export default function App() {
  const lojaParams = useState(paramsLoja)[0];
  const eAfiliado = useState(paramsAfiliado)[0];
  const eVagas = useState(paramsVagas)[0];
  return (
    <SessionProvider>
      <Suspense fallback={<ACarregar />}>
        {eAfiliado ? <AfiliadoApp /> : eVagas ? <VagasPublicas /> : lojaParams ? <Loja mesaInicial={lojaParams.mesa} /> : <Shell />}
      </Suspense>
    </SessionProvider>
  );
}
