import { trpc } from "@/providers/trpc";
import { mt, diaBR } from "@/lib/fmt";
import { Stat, Vazio } from "@/components/bits";
import { PresencaCard } from "@/pages/Config";
import { useSession } from "@/lib/session";

export default function Dashboard({ goVender, goEstoque, goFinanceiro, goDividas }: { goVender: () => void; goEstoque: () => void; goFinanceiro: () => void; goDividas: () => void }) {
  const { user } = useSession();
  const isGestao = user?.perfil === "Admin" || user?.perfil === "Gestor";
  const stats = trpc.dashboard.stats.useQuery({ usuarioId: user?.id ?? 0 }, { refetchInterval: 15000 });
  const fin = trpc.financeiro.dia.useQuery(
    { usuarioId: user?.id ?? 0 },
    { enabled: isGestao, refetchInterval: 60000 },
  );
  const divResumo = trpc.dividas.resumo.useQuery(
    { usuarioId: user?.id ?? 0 },
    { enabled: !!user, refetchInterval: 30000 },
  );
  const aval = trpc.online.avaliacoes.useQuery(
    { usuarioId: user?.id ?? 0 },
    { enabled: !!user, refetchInterval: 60000 },
  );
  const s = stats.data;

  if (stats.isLoading) return <div className="c-vazio"><span className="big">⏳</span>A carregar painel…</div>;
  if (!s) return <div className="c-vazio"><span className="big">⚠️</span>Erro ao carregar dados.</div>;

  return (
    <div>
      <div className="c-titulo">📊 Painel do Dia</div>
      <PresencaCard />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 10, marginBottom: 12 }}>
        <Stat cls="v" lbl="💰 Vendas Hoje">{mt(s.totHoje)}</Stat>
        <Stat cls="az" lbl="🛒 Pedidos Fechados Hoje">{s.transHoje}</Stat>
        <Stat lbl="📅 Reservas Ativas">{s.reservasAtivas}</Stat>
        <Stat cls={s.stockBaixo ? "vm" : "v"} lbl="⚠️ Estoque Baixo">{s.stockBaixo}</Stat>
        <Stat cls="az" lbl="🧾 Pedidos Abertos">{s.pedidosAbertos}</Stat>
        <Stat lbl="📈 Faturamento Mês">{mt(s.totMes)}</Stat>
      </div>

      {/* FIADO: as dívidas ficam sempre visíveis até serem pagas por completo */}
      {((divResumo.data?.abertas ?? 0) + (divResumo.data?.fornAbertas ?? 0)) > 0 && (
        <button className="c-card" onClick={goDividas}
          style={{ width: "100%", textAlign: "left", cursor: "pointer", border: "1.5px solid var(--vermelho-c)", background: "#fdf2f2", marginBottom: 12 }}>
          <div className="c-linha" style={{ margin: 0 }}>
            <div className="grow">
              <div className="tit" style={{ color: "var(--vermelho-c)" }}>
                🧾 {(divResumo.data?.abertas ?? 0) + (divResumo.data?.fornAbertas ?? 0)} dívida{((divResumo.data?.abertas ?? 0) + (divResumo.data?.fornAbertas ?? 0)) > 1 ? "s" : ""} em aberto
              </div>
              <div className="det">
                {(divResumo.data?.abertas ?? 0) > 0 && <>A receber de clientes: <b>{mt(divResumo.data!.totalEmDivida)}</b></>}
                {(divResumo.data?.abertas ?? 0) > 0 && (divResumo.data?.fornAbertas ?? 0) > 0 && " · "}
                {(divResumo.data?.fornAbertas ?? 0) > 0 && <>A pagar a fornecedores: <b>{mt(divResumo.data!.fornTotal)}</b></>}
                {" — tocar para ver"}
              </div>
            </div>
            <span style={{ fontSize: 20 }}>→</span>
          </div>
        </button>
      )}

      {isGestao && fin.data && (
        <button className="c-card" onClick={goFinanceiro}
          style={{ width: "100%", textAlign: "left", cursor: "pointer", border: "1.5px solid var(--roxo2)", background: "#f7f1fc" }}>
          <div className="c-titulo" style={{ fontSize: 15 }}>📈 Financeiro de Hoje</div>
          <div className="c-linha"><div className="grow tit">💰 Receita</div><b style={{ color: "var(--verde-c)" }}>{mt(fin.data.receitaTotal)}</b></div>
          <div className="c-linha"><div className="grow tit">💸 Despesas</div><b style={{ color: "var(--vermelho-c)" }}>{mt(fin.data.despesas.total)}</b></div>
          <div className="c-total-linha" style={{ fontSize: 15 }}>
            <span>Saldo</span>
            <b style={{ color: fin.data.saldo >= 0 ? "var(--verde-c)" : "var(--vermelho-c)" }}>{mt(fin.data.saldo)}</b>
          </div>
          <div className="c-sub" style={{ marginTop: 4 }}>Toque para ver o relatório financeiro completo →</div>
        </button>
      )}

      {/* avaliações dos clientes online (estrelas + comentários) */}
      {aval.data && aval.data.total > 0 && (
        <div className="c-card" style={{ border: "1.5px solid #e8c93c", background: "#fffdf3" }}>
          <div className="c-titulo" style={{ fontSize: 15 }}>
            ⭐ Avaliações dos clientes{" "}
            <span style={{ color: "#e8a13c" }}>{aval.data.media}★</span>
            <span className="c-sub" style={{ fontWeight: 400 }}> · {aval.data.total} {aval.data.total === 1 ? "avaliação" : "avaliações"}</span>
          </div>
          {aval.data.rows.slice(0, 3).map((a) => (
            <div className="c-linha" key={a.id} style={{ alignItems: "flex-start" }}>
              <div className="grow">
                <div className="tit">
                  <span style={{ color: "#e8a13c" }}>{"★".repeat(a.estrelas)}{"☆".repeat(5 - a.estrelas)}</span>{" "}
                  {a.clienteNome.split(" ")[0]} <span className="det">· {a.codigo}</span>
                </div>
                {a.comentario && <div className="det">“{a.comentario}”</div>}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="c-card">
        <div className="c-titulo" style={{ fontSize: 15 }}>🔥 Top 5 Produtos Mais Vendidos</div>
        {s.top5.length ? s.top5.map((t, i) => (
          <div className="c-linha" key={t.nome}>
            <b style={{ color: "var(--roxo)", width: 22 }}>{i + 1}º</b>
            <div className="grow"><div className="tit">{t.nome}</div><div className="det">{t.cat}</div></div>
            <div className="fim"><b>{t.qtd}</b> un.<br /><span className="det">{mt(t.tot)}</span></div>
          </div>
        )) : <Vazio icon="🛒">Ainda sem vendas registadas.<br />Toque em <b>Vender</b> para começar.</Vazio>}
      </div>

      <div className="c-card">
        <div className="c-titulo" style={{ fontSize: 15 }}>📅 Próximas Reservas</div>
        {s.proxReservas.length ? s.proxReservas.map((r) => (
          <div className="c-linha" key={r.id}>
            <div className="grow">
              <div className="tit">{r.cliente}</div>
              <div className="det">{diaBR(r.dataConsumo)} {r.hora || ""} · {r.tipo} · {r.pessoas} pessoas</div>
            </div>
            <div className="fim">
              <span className={`c-chip ${r.status === "Confirmada" ? "c-chip-verde" : "c-chip-amarelo"}`}>{r.status}</span>
            </div>
          </div>
        )) : <Vazio icon="📅">Sem reservas próximas.</Vazio>}
      </div>

      {s.stockBaixo > 0 && (
        <div className="c-card" style={{ borderLeft: "4px solid var(--vermelho-c)" }}>
          <b style={{ color: "var(--vermelho-c)" }}>⚠️ {s.stockBaixo} produto(s) com estoque baixo!</b><br />
          <span className="c-sub">Vá a Menu → Estoque para repor.</span>
          <div style={{ marginTop: 10 }}>
            <button className="c-btn c-btn-perigo c-btn-peq" onClick={goEstoque}>Ver Estoque</button>
          </div>
        </div>
      )}

      <button className="c-btn c-btn-prim c-btn-bloco" onClick={goVender}>🛒 Novo Pedido</button>
    </div>
  );
}
