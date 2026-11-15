import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { useSession } from "@/lib/session";
import { mt, dataBR } from "@/lib/fmt";
import { Vazio, Voltar } from "@/components/bits";
import { waLink } from "@/lib/loja";
import { AF_LIMITE_ACTIVOS, AF_DIA_PAGAMENTO } from "@contracts/types";

const COR = "#7B1E3B";
const MES_ACTUAL = () => new Date(Date.now() + 2 * 3600e3).toISOString().slice(0, 7);

const ESTADOS_AF: Record<string, [string, string]> = {
  Pendente: ["🟡", "#a16207"], Experimental: ["🧪", "#0369a1"], Activo: ["🟢", "#15803d"],
  ListaEspera: ["⏳", "#6d28d9"], Suspenso: ["⛔", "#b91c1c"], Rejeitado: ["❌", "#6b7280"],
};

export default function Afiliados({ voltar }: { voltar?: () => void }) {
  const { user, toast } = useSession();
  const utils = trpc.useUtils();
  const adminId = user!.id;
  const [tab, setTab] = useState<"painel" | "afiliados" | "leads" | "comissoes" | "recibos">("painel");
  const [mesFecho, setMesFecho] = useState(MES_ACTUAL());
  const [mesCom, setMesCom] = useState("");
  const [docVer, setDocVer] = useState<string | null>(null);

  const dash = trpc.afiliados.dashboard.useQuery({ adminId }, { refetchInterval: 30_000 });
  const lista = trpc.afiliados.listar.useQuery({ adminId }, { enabled: tab === "afiliados" || tab === "painel" });
  const leads = trpc.afiliados.leads.useQuery({ adminId }, { enabled: tab === "leads", refetchInterval: 30_000 });
  const comissoes = trpc.afiliados.comissoes.useQuery({ adminId, mes: mesCom || undefined }, { enabled: tab === "comissoes" });
  const recibos = trpc.afiliados.recibos.useQuery({ adminId }, { enabled: tab === "recibos", refetchInterval: 30_000 });

  const decidir = trpc.afiliados.decidir.useMutation();
  const verificarWhats = trpc.afiliados.verificarWhats.useMutation();
  const leadEstado = trpc.afiliados.leadEstado.useMutation();
  const estornar = trpc.afiliados.estornarComissao.useMutation();
  const fecharMes = trpc.afiliados.fecharMes.useMutation();
  const pagarRecibo = trpc.afiliados.pagarRecibo.useMutation();

  const inv = () => {
    utils.afiliados.dashboard.invalidate();
    utils.afiliados.listar.invalidate();
    utils.afiliados.leads.invalidate();
    utils.afiliados.comissoes.invalidate();
    utils.afiliados.recibos.invalidate();
  };
  const accao = (afiliadoId: number, a: "aprovar" | "experimental" | "suspender" | "rejeitar" | "reativar" | "promover" | "desbloquear") =>
    decidir.mutate({ adminId, afiliadoId, accao: a }, {
      onSuccess: (r) => { toast(`✅ Estado: ${r.status}`); inv(); },
      onError: (e) => toast("⚠️ " + e.message),
    });

  const linkPublico = `${location.origin}/?afiliado=1`;

  return (
    <div>
      {voltar && <Voltar onClick={voltar} />}
      <div className="c-titulo">🤝 CRM de Afiliados <span className="c-sub" style={{ fontWeight: 400 }}>(visível só para a Direcção)</span></div>

      <div style={{ display: "flex", gap: 6, margin: "10px 0", flexWrap: "wrap" }}>
        {([["painel", "📊 Painel"], ["afiliados", "🤝 Afiliados"], ["leads", `👥 Leads${dash.data?.leadsNovos ? ` (${dash.data.leadsNovos} 🆕)` : ""}`], ["comissoes", "💰 Comissões"], ["recibos", "🧾 Recibos"]] as const).map(([t, l]) => (
          <button key={t} className="c-btn c-btn-peq" onClick={() => setTab(t)}
            style={{ background: tab === t ? COR : "#eee", color: tab === t ? "#fff" : "#333", border: "none" }}>
            {l}
          </button>
        ))}
      </div>

      {tab === "painel" && dash.data && (
        <div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 8 }}>
            <div className="c-card" style={{ textAlign: "center" }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: COR }}>{dash.data.vagas.ocupadas}/{dash.data.vagas.limite}</div>
              <div className="c-sub" style={{ fontSize: 11.5 }}>Vagas activas</div>
            </div>
            <div className="c-card" style={{ textAlign: "center" }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: "#a16207" }}>{dash.data.pendentes}</div>
              <div className="c-sub" style={{ fontSize: 11.5 }}>Candidaturas pendentes</div>
            </div>
            <div className="c-card" style={{ textAlign: "center" }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: "#6d28d9" }}>{dash.data.listaEspera}</div>
              <div className="c-sub" style={{ fontSize: 11.5 }}>Lista de espera</div>
            </div>
            <div className="c-card" style={{ textAlign: "center" }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: "#15803d" }}>{mt(dash.data.comissoesMes)}</div>
              <div className="c-sub" style={{ fontSize: 11.5 }}>Comissões {dash.data.mes}</div>
            </div>
          </div>

          <div className="c-card">
            <b>📣 Link público de candidatura</b>
            <p className="c-sub" style={{ fontSize: 12 }}>Partilhe nas redes sociais e nos anúncios de recrutamento:</p>
            <div style={{ display: "flex", gap: 6 }}>
              <input className="c-input" readOnly value={linkPublico} style={{ fontSize: 12 }} onFocus={(e) => e.target.select()} />
              <a className="c-btn c-btn-peq" style={{ background: "#128C7E", color: "#fff", border: "none", textDecoration: "none", whiteSpace: "nowrap" }}
                href={waLink("", `🤝 ${user!.nome ? "" : ""}Seja afiliado CAMI'S Eventos e ganhe comissões por cada cliente que trouxer! Candidate-se aqui: ${linkPublico}`)}
                target="_blank" rel="noreferrer">📤 Partilhar</a>
            </div>
          </div>

          <div className="c-card">
            <b>🏆 Ranking do mês ({dash.data.mes})</b>
            {dash.data.ranking.length === 0 && <p className="c-sub">Ainda sem comissões este mês.</p>}
            {dash.data.ranking.map((r, i) => (
              <div key={r.codigo} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid #f0f0f0", fontSize: 13.5 }}>
                <span>{["🥇", "🥈", "🥉", "4º", "5º"][i]} {r.nome} <span className="c-sub">({r.codigo})</span></span>
                <b>{mt(r.total)}</b>
              </div>
            ))}
          </div>

          <div className="c-card">
            <b>🗓️ Fecho do mês (pagamento no dia {AF_DIA_PAGAMENTO})</b>
            <p className="c-sub" style={{ fontSize: 12 }}>Calcula comissões pendentes do mês, aplica os bónus (meta mensal · Afiliado do Mês · indicação — valores em ⚙️ Configurações) e emite os recibos RAF-.</p>
            <div style={{ display: "flex", gap: 8 }}>
              <input className="c-input" type="month" value={mesFecho} onChange={(e) => setMesFecho(e.target.value)} style={{ maxWidth: 170 }} />
              <button className="c-btn c-btn-prim" style={{ background: COR }} disabled={fecharMes.isPending}
                onClick={() => fecharMes.mutate({ adminId, mes: mesFecho }, {
                  onSuccess: (r) => { toast(`✅ ${r.recibos.length} recibo(s) emitido(s) para ${mesFecho}`); inv(); },
                  onError: (e) => toast("⚠️ " + e.message),
                })}>
                {fecharMes.isPending ? "…" : "🧾 Fechar mês e emitir recibos"}
              </button>
            </div>
          </div>
        </div>
      )}

      {tab === "afiliados" && (
        <div>
          {lista.data && (
            <p className="c-sub" style={{ fontSize: 12 }}>
              Vagas: <b>{lista.data.vagas.ocupadas}/{lista.data.vagas.limite}</b>
              {lista.data.vagas.ocupadas >= AF_LIMITE_ACTIVOS && " — novas candidaturas entram na lista de espera"}
            </p>
          )}
          {(lista.data?.afiliados ?? []).length === 0 && <Vazio icon="🤝">Sem candidaturas ainda. Partilhe o link público no Painel.</Vazio>}
          {(lista.data?.afiliados ?? []).map((a) => {
            const [ico, cor] = ESTADOS_AF[a.status] ?? ["❔", "#333"];
            return (
              <div className="c-card" key={a.id} style={{ borderLeft: `4px solid ${cor}` }}>
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  {a.fotoPerfil
                    ? <img src={a.fotoPerfil} alt="" style={{ width: 44, height: 44, borderRadius: "50%", objectFit: "cover" }} />
                    : <span style={{ fontSize: 30 }}>🤝</span>}
                  <div style={{ flex: 1 }}>
                    <b style={{ fontSize: 14.5 }}>{a.nome}</b> <span className="c-sub">· {a.codigo}</span>
                    <div className="c-sub" style={{ fontSize: 11.5 }}>
                      {ico} {a.status} · {a.nivel} · {a.vendasTotal} vendas · 📞 {a.telefone}
                      {a.whatsVerificado ? " ✅" : " ⏳ WhatsApp por verificar"}
                      {a.bloqueado && " · 🔒 bloqueado"}
                    </div>
                    <div className="c-sub" style={{ fontSize: 11.5 }}>
                      📍 {a.residencia} · BI {a.biNumero}
                      {a.indicadoPorNome && ` · indicado por ${a.indicadoPorNome}`}
                      {a.metodoPagamento && ` · 💳 ${a.metodoPagamento} ${a.contaPagamento ?? ""}`}
                    </div>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                  {a.biDocumento && (
                    <button className="c-btn c-btn-peq c-btn-cinza" onClick={() => setDocVer(a.biDocumento!)}>🪪 Ver BI</button>
                  )}
                  {!a.whatsVerificado && (
                    <>
                      <a className="c-btn c-btn-peq" style={{ background: "#128C7E", color: "#fff", border: "none", textDecoration: "none" }}
                        href={waLink(a.telefone, `Olá ${a.nome}! Para confirmarmos o seu WhatsApp de afiliado CAMI'S (${a.codigo}), responda a esta mensagem com o código: ${a.codigoVerificacao ?? "—"}`)}
                        target="_blank" rel="noreferrer">✅ Pedir código</a>
                      <button className="c-btn c-btn-peq c-btn-prim" style={{ background: COR }}
                        onClick={() => verificarWhats.mutate({ adminId, afiliadoId: a.id, verificado: true }, { onSuccess: inv, onError: (e) => toast("⚠️ " + e.message) })}>
                        ✔ Confirmar WhatsApp
                      </button>
                    </>
                  )}
                  {a.status === "Pendente" && <>
                    <button className="c-btn c-btn-peq c-btn-prim" onClick={() => accao(a.id, "aprovar")}>👍 Aprovar</button>
                    <button className="c-btn c-btn-peq c-btn-cinza" onClick={() => accao(a.id, "experimental")}>🧪 Experimental</button>
                    <button className="c-btn c-btn-peq c-btn-cinza" onClick={() => accao(a.id, "rejeitar")}>❌ Rejeitar</button>
                  </>}
                  {a.status === "ListaEspera" && <button className="c-btn c-btn-peq c-btn-prim" onClick={() => accao(a.id, "promover")}>⬆️ Promover a activo</button>}
                  {(a.status === "Activo" || a.status === "Experimental") && <>
                    <button className="c-btn c-btn-peq c-btn-cinza" onClick={() => accao(a.id, "suspender")}>⛔ Suspender</button>
                    <a className="c-btn c-btn-peq" style={{ background: "#128C7E", color: "#fff", border: "none", textDecoration: "none" }}
                      href={waLink(a.telefone, `🤝 ${a.nome}, resumo CAMI'S: o seu código ${a.codigo} continua activo. Consulte o seu painel: ${linkPublico}`)}
                      target="_blank" rel="noreferrer">📲 WhatsApp</a>
                  </>}
                  {a.status === "Suspenso" && <button className="c-btn c-btn-peq c-btn-prim" onClick={() => accao(a.id, "reativar")}>♻️ Reactivar</button>}
                  {a.bloqueado && <button className="c-btn c-btn-peq c-btn-cinza" onClick={() => accao(a.id, "desbloquear")}>🔓 Desbloquear</button>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {tab === "leads" && (
        <div>
          <p className="c-sub" style={{ fontSize: 12 }}>Cada lead novo registado por um afiliado aparece aqui (notificação à Direcção).</p>
          {(leads.data ?? []).length === 0 && <Vazio icon="👥">Sem leads registados.</Vazio>}
          {(leads.data ?? []).map((l) => (
            <div className="c-card" key={l.id} style={{ padding: 10 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ fontSize: 20 }}>{l.estado === "Convertido" ? "✅" : l.estado === "Perdido" ? "❌" : l.estado === "Negociacao" ? "💬" : "🆕"}</span>
                <div style={{ flex: 1 }}>
                  <b style={{ fontSize: 13.5 }}>{l.clienteNome}</b> <span className="c-sub" style={{ fontSize: 12 }}>· {l.interesse}</span>
                  <div className="c-sub" style={{ fontSize: 11.5 }}>
                    📞 {l.clienteContacto} · por <b>{l.afiliadoNome}</b> ({l.afiliadoCodigo}) · protegido até {l.protegidoAte ? dataBR(l.protegidoAte) : "—"}
                  </div>
                  {l.obs && <div className="c-sub" style={{ fontSize: 11.5 }}>📝 {l.obs}</div>}
                </div>
                <select className="c-select" style={{ width: 128, padding: 5 }} value={l.estado}
                  onChange={(e) => leadEstado.mutate({ adminId, leadId: l.id, estado: e.target.value as never }, { onSuccess: inv, onError: (er) => toast("⚠️ " + er.message) })}>
                  <option value="Novo">🆕 Novo</option><option value="Negociacao">💬 Negociação</option>
                  <option value="Convertido">✅ Convertido</option><option value="Perdido">❌ Perdido</option>
                </select>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === "comissoes" && (
        <div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
            <label className="c-label" style={{ margin: 0 }}>Mês:</label>
            <input className="c-input" type="month" value={mesCom} onChange={(e) => setMesCom(e.target.value)} style={{ maxWidth: 170 }} />
            {mesCom && <button className="c-btn c-btn-peq c-btn-cinza" onClick={() => setMesCom("")}>Todos</button>}
          </div>
          {(comissoes.data ?? []).length === 0 && <Vazio icon="💰">Sem comissões neste período.</Vazio>}
          {(comissoes.data ?? []).map((c) => (
            <div className="c-card" key={c.id} style={{ padding: 10, display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ fontSize: 20 }}>{c.estado === "Paga" ? "🟢" : c.estado === "Estornada" ? "🔴" : "🟡"}</span>
              <div style={{ flex: 1 }}>
                <b style={{ fontSize: 13.5 }}>{mt(c.valorComissao)}</b>
                <span className="c-sub" style={{ fontSize: 11.5 }}> · {c.pct}% de {mt(c.valorVenda)} · {c.parcela === 1 ? "1ª" : "2ª"} metade · {c.mesReferencia}</span>
                <div className="c-sub" style={{ fontSize: 11.5 }}>{c.descricao} · <b>{c.afiliadoNome}</b> ({c.afiliadoCodigo})</div>
              </div>
              {c.estado === "Pendente" && (
                <button className="c-btn c-btn-peq c-btn-cinza"
                  onClick={() => estornar.mutate({ adminId, comissaoId: c.id }, { onSuccess: inv, onError: (e) => toast("⚠️ " + e.message) })}>
                  ↩️ Estornar
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {tab === "recibos" && (
        <div>
          {(recibos.data ?? []).length === 0 && <Vazio icon="🧾">Sem recibos. Use «Fechar mês» no Painel.</Vazio>}
          {(recibos.data ?? []).map((r) => (
            <div className="c-card" key={r.id}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <b>{r.codigo}</b>
                <span style={{ fontSize: 12, fontWeight: 700, color: r.estado === "Pago" ? "#15803d" : r.estado === "Assinado" ? "#a16207" : COR }}>
                  {r.estado === "Pago" ? "🟢 Pago" : r.estado === "Assinado" ? "✍️ Assinado" : "📄 Emitido"}
                </span>
              </div>
              <div className="c-sub" style={{ fontSize: 12 }}>
                {r.afiliado?.nome} ({r.afiliado?.codigo}) · {r.mesReferencia}
                {r.afiliado?.metodoPagamento && ` · ${r.afiliado.metodoPagamento} ${r.afiliado.contaPagamento ?? ""}`}
              </div>
              <div style={{ fontSize: 12.5, marginTop: 6, lineHeight: 1.6 }}>
                Comissões: {mt(r.totalComissoes)}
                {r.bonusMeta > 0 && <> · 🎯 {mt(r.bonusMeta)}</>}
                {r.bonusMes > 0 && <> · 🏆 {mt(r.bonusMes)}</>}
                {r.bonusIndicacao > 0 && <> · 🤝 {mt(r.bonusIndicacao)}</>}
                <br /><b>Total: {mt(r.total)}</b>
                {r.assinadoPor && <div className="c-sub" style={{ fontSize: 11.5 }}>✍️ Assinado por {r.assinadoPor}{r.assinadoEm ? ` em ${dataBR(r.assinadoEm)}` : ""}</div>}
              </div>
              <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                {r.estado !== "Pago" && (
                  <button className="c-btn c-btn-peq c-btn-prim" style={{ background: "#15803d" }} disabled={pagarRecibo.isPending}
                    onClick={() => pagarRecibo.mutate({ adminId, reciboId: r.id }, {
                      onSuccess: (x) => { toast(`✅ Pago ${mt(x.total)} — despesa lançada em «Afiliados — Comissões»`); inv(); },
                      onError: (e) => toast("⚠️ " + e.message),
                    })}>
                    💸 Pagar (lança despesa)
                  </button>
                )}
                <a className="c-btn c-btn-peq" style={{ background: "#128C7E", color: "#fff", border: "none", textDecoration: "none" }}
                  href={waLink(r.afiliado?.telefone ?? "", `🧾 ${r.afiliado?.nome}, o seu recibo ${r.codigo} de ${r.mesReferencia} (${mt(r.total)}) está ${r.estado === "Pago" ? "PAGO ✅. Obrigado!" : "emitido — assine na sua página de afiliado ou presencialmente."}`)}
                  target="_blank" rel="noreferrer">📲 Notificar</a>
              </div>
            </div>
          ))}
        </div>
      )}

      {docVer && (
        <div onClick={() => setDocVer(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.75)", zIndex: 99, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <img src={docVer} alt="Documento" style={{ maxWidth: "100%", maxHeight: "100%", borderRadius: 12 }} />
        </div>
      )}
    </div>
  );
}
