/* ============================================================
   VAGAS & RECRUTAMENTO — gestão interna (Admin e Gestor)
   · Criar/editar/abrir/fechar vagas (página editável)
   · Candidaturas com filtros (vaga, estado, pontuação mínima, pesquisa)
   · Triagem automática inteligente (pontuação 0–100 + justificação)
   · Subscritores das notificações (envio por WhatsApp)
   ============================================================ */
import { useMemo, useState } from "react";
import { trpc } from "@/providers/trpc";
import { useSession } from "@/lib/session";
import { Modal, Vazio, Voltar } from "@/components/bits";
import { waLink } from "@/lib/loja";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../api/router";

type VagaRow = inferRouterOutputs<AppRouter>["vagas"]["listTodas"][number];
type CandRow = inferRouterOutputs<AppRouter>["vagas"]["candidaturas"][number];

const STATUS = ["Nova", "Em análise", "Pré-seleccionado", "Entrevista", "Contratado", "Não contratado", "Rejeitado"] as const;
const corStatus = (s: string) =>
  s === "Contratado" ? "c-chip-verde" : s === "Rejeitado" || s === "Não contratado" ? "c-chip-vermelho"
  : s === "Nova" ? "c-chip-roxo" : "c-chip-amarelo";
const corPontos = (p: number | null) =>
  p == null ? "#888" : p >= 70 ? "var(--verde-c)" : p >= 45 ? "var(--amarelo-c)" : "var(--vermelho-c)";

/* ---------- Entrevistas & mensagens automáticas de recrutamento ---------- */
const DATA_ENTREVISTAS = "quinta-feira, 8 de Outubro de 2026";
const LOCAL_CAMIS = "CAMI'S EVENTOS — Chizombero, Chimoio";
/** Início às 09:30, 30 minutos por candidato */
const horaSlot = (i: number) => {
  const m = 9 * 60 + 30 + i * 30;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};
/** Ordem das entrevistas: maior pontuação 🤖 primeiro; desempate pela candidatura mais antiga */
const ordenarEntrevistados = (lista: CandRow[]) =>
  [...lista].sort((a, b) => (b.pontuacao ?? -1) - (a.pontuacao ?? -1) || new Date(a.criadoEm).getTime() - new Date(b.criadoEm).getTime());
/** Hora exacta da entrevista (se o candidato ainda não estiver na lista, simula a posição dele) */
function horaEntrevista(c: CandRow, entrev: CandRow[]): string {
  const lista = ordenarEntrevistados(entrev.some((x) => x.id === c.id) ? entrev : [...entrev, c]);
  return horaSlot(Math.max(0, lista.findIndex((x) => x.id === c.id)));
}
const primeiroNome = (n: string) => n.trim().split(" ")[0];

function msgEntrevista(c: CandRow, hora: string): string {
  return [
    `*CAMI'S EVENTOS — CONVOCATÓRIA PARA ENTREVISTA*`,
    ``,
    `Exmo.(a) Sr.(a) ${c.nome},`,
    ``,
    `Temos o prazer de informar que, após o apuramento das candidaturas recebidas, foi *APURADO(A) PARA ENTREVISTA* para a vaga de *${c.vagaTitulo}* (ref. ${c.codigo}).`,
    ``,
    `🗓 *Data:* ${DATA_ENTREVISTAS}`,
    `🕤 *Hora da sua entrevista:* ${hora} (duração: 30 minutos)`,
    `📍 *Local:* ${LOCAL_CAMIS}`,
    ``,
    `Pedimos a gentileza de:`,
    `• Chegar com 15 minutos de antecedência;`,
    `• Trazer o Bilhete de Identidade;`,
    `• *Confirmar a sua presença* respondendo a esta mensagem.`,
    ``,
    `Em caso de impossibilidade, avise-nos com antecedência para remarcação.`,
    ``,
    `Com os melhores cumprimentos,`,
    `*Direcção da CAMI'S EVENTOS*`,
  ].join("\n");
}

function msgSuplente(c: CandRow): string {
  return [
    `*CAMI'S EVENTOS — SOBRE A SUA CANDIDATURA*`,
    ``,
    `Exmo.(a) Sr.(a) ${c.nome},`,
    ``,
    `Agradecemos o seu interesse em fazer parte da equipa da CAMI'S EVENTOS e o tempo dedicado à candidatura à vaga de *${c.vagaTitulo}* (ref. ${c.codigo}).`,
    ``,
    `Informamos que o seu perfil ficou como *SUPLENTE* — o seu nome permanece na nossa base de dados para futuras necessidades.`,
    ``,
    `🌟 *OUTRAS OPORTUNIDADES NA CASA:*`,
    `A CAMI'S EVENTOS tem portas abertas para si como:`,
    `• *EVENTUAL* — trabalho remunerado por dia, nos nossos eventos;`,
    `• *AFILIADO (comissionista)* — ganhe comissões por cada cliente ou evento que trouxer para a casa.`,
    ``,
    `Se tiver interesse, compareça para uma breve entrevista:`,
    `🗓 ${DATA_ENTREVISTAS}, às *12:00*`,
    `📍 ${LOCAL_CAMIS}`,
    ``,
    `Ficamos a aguardar a sua presença.`,
    ``,
    `Com estima,`,
    `*Direcção da CAMI'S EVENTOS*`,
  ].join("\n");
}

function msgContratado(c: CandRow): string {
  return [
    `*CAMI'S EVENTOS — PARABÉNS! 🎉*`,
    ``,
    `Exmo.(a) Sr.(a) ${c.nome},`,
    ``,
    `É com grande satisfação que informamos que foi seleccionado(a) para integrar a equipa da CAMI'S EVENTOS, na função de *${c.vagaTitulo}*.`,
    ``,
    `*PARABÉNS PELA CONTRATAÇÃO!* 👏`,
    ``,
    `A nossa equipa irá *ligar-lhe em breve* para acordar todos os detalhes (início, condições e documentação). Por favor, mantenha o seu telefone disponível.`,
    ``,
    `Bem-vindo(a) à família CAMI'S EVENTOS!`,
    ``,
    `*Direcção da CAMI'S EVENTOS*`,
  ].join("\n");
}

function msgNaoContratado(c: CandRow): string {
  return [
    `*CAMI'S EVENTOS — RESULTADO DA ENTREVISTA*`,
    ``,
    `Exmo.(a) Sr.(a) ${c.nome},`,
    ``,
    `Agradecemos a sua disponibilidade e o desempenho na entrevista para a vaga de *${c.vagaTitulo}*.`,
    ``,
    `Informamos que, desta vez, a vaga foi preenchida por outro candidato. No entanto, o seu perfil agradou-nos e gostaríamos de o(a) convidar a colaborar connosco como:`,
    ``,
    `• *EVENTUAL* — trabalho remunerado por dia, nos nossos eventos;`,
    `• *AFILIADO (comissionista)* — comissões por cada cliente ou evento angariado.`,
    ``,
    `Caso tenha interesse, *responda a esta mensagem dentro de 24 horas* para garantirmos o seu lugar.`,
    ``,
    `Com os melhores cumprimentos,`,
    `*Direcção da CAMI'S EVENTOS*`,
  ].join("\n");
}

/** Mensagem automática conforme a classificação da candidatura (vai por trás do botão 💬 WhatsApp) */
function msgCandidato(c: CandRow, entrev: CandRow[]): string {
  if (c.status === "Entrevista") return msgEntrevista(c, horaEntrevista(c, entrev));
  if (c.status === "Contratado") return msgContratado(c);
  if (c.status === "Não contratado") return msgNaoContratado(c);
  if (c.status === "Rejeitado") return msgSuplente(c);
  return `Olá ${primeiroNome(c.nome)}! Somos da CAMI'S Eventos. Recebemos a sua candidatura (${c.codigo}) à vaga de ${c.vagaTitulo}.`;
}

const escHtml = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/** Baixa a lista das entrevistas em formato Word: hora, nome, vaga, resumo do perfil e residência */
function baixarListaEntrevistas(lista: CandRow[]) {
  const linhas = lista.map((c, i) => `<tr>
    <td style="border:1px solid #999;padding:5px;text-align:center">${i + 1}</td>
    <td style="border:1px solid #999;padding:5px;text-align:center"><b>${horaSlot(i)}</b></td>
    <td style="border:1px solid #999;padding:5px"><b>${escHtml(c.nome)}</b><br><small>${c.codigo} · Tel. ${escHtml(c.telefone)}</small></td>
    <td style="border:1px solid #999;padding:5px">${escHtml(c.vagaTitulo)}</td>
    <td style="border:1px solid #999;padding:5px">${c.idade ?? "—"} anos · ${c.experienciaAnos} ano(s) de experiência · ${c.disponibilidade}${c.pontuacao != null ? ` · Triagem: <b>${c.pontuacao}/100</b>` : ""}</td>
    <td style="border:1px solid #999;padding:5px">${escHtml(c.residencia ?? "—")}</td>
  </tr>`).join("");
  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office"><head><meta charset="utf-8"></head>
<body style="font-family:Calibri,Arial,sans-serif">
  <h2 style="margin:0">CAMI'S EVENTOS — LISTA DE ENTREVISTAS</h2>
  <p style="margin:4px 0 2px"><b>Data:</b> ${DATA_ENTREVISTAS} &nbsp;·&nbsp; <b>Início:</b> 09:30 &nbsp;·&nbsp; <b>Duração:</b> 30 minutos por candidato</p>
  <p style="margin:0 0 10px"><b>Local:</b> ${LOCAL_CAMIS}</p>
  <table style="border-collapse:collapse;width:100%;font-size:11pt">
    <thead><tr style="background:#e7d7f1">
      <th style="border:1px solid #999;padding:5px">Nº</th>
      <th style="border:1px solid #999;padding:5px">Hora</th>
      <th style="border:1px solid #999;padding:5px">Candidato</th>
      <th style="border:1px solid #999;padding:5px">Vaga</th>
      <th style="border:1px solid #999;padding:5px">Resumo do perfil</th>
      <th style="border:1px solid #999;padding:5px">Residência</th>
    </tr></thead>
    <tbody>${linhas}</tbody>
  </table>
  <p style="margin-top:8px;font-size:9pt;color:#555">Ordem: maior pontuação da triagem primeiro. Gerado pelo sistema CAMI'S Eventos.</p>
</body></html>`;
  const blob = new Blob(["\ufeff", html], { type: "application/msword;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "Entrevistas-CAMIS-08-10-2026.doc";
  a.click();
  URL.revokeObjectURL(a.href);
}

/** Mensagem automática de partilha da vaga (WhatsApp) — para indicações e publicação */
export function msgPartilhaVaga(v: VagaRow, link: string): string {
  const linhas = [
    `📢 *CAMI'S EVENTOS — CONCURSO DE VAGA*`,
    ``,
    `💼 *${v.titulo}*`,
    `📂 Área: ${v.area} · ${v.tipo}`,
    `📍 Local: ${v.local}`,
  ];
  if (v.salario) linhas.push(`💰 Salário: ${v.salario}`);
  if (v.requisitos) linhas.push(``, `*Perfil do candidato:*`, v.requisitos);
  if (v.oferecemos) linhas.push(``, `*O que oferecemos:*`, v.oferecemos);
  linhas.push(
    ``,
    `✍️ *Candidate-se aqui (sem registo, em 2 minutos):*`,
    link,
    ``,
    `Ou indique esta vaga a alguém que conheça — basta reencaminhar esta mensagem. 🙏`,
  );
  return linhas.join("\n");
}

export default function Vagas({ voltar }: { voltar: () => void }) {
  const { user, toast } = useSession();
  const utils = trpc.useUtils();
  const [aba, setAba] = useState<"vagas" | "candidaturas" | "subscritores">("candidaturas");

  const vagas = trpc.vagas.listTodas.useQuery({ usuarioId: user?.id ?? 0 }, { enabled: !!user });
  const subs = trpc.vagas.subscritores.useQuery({ usuarioId: user?.id ?? 0 }, { enabled: !!user && aba === "subscritores" });

  /* filtros das candidaturas */
  const [fVaga, setFVaga] = useState(0);
  const [fStatus, setFStatus] = useState("");
  const [fMin, setFMin] = useState(0);
  const [busca, setBusca] = useState("");
  const cands = trpc.vagas.candidaturas.useQuery(
    { usuarioId: user?.id ?? 0, vagaId: fVaga || undefined, status: fStatus || undefined, minPontos: fMin || undefined, busca: busca || undefined },
    { enabled: !!user && aba === "candidaturas", refetchInterval: 20_000 },
  );

  const entrevQ = trpc.vagas.candidaturas.useQuery(
    { usuarioId: user?.id ?? 0, status: "Entrevista" },
    { enabled: !!user && aba === "candidaturas", refetchInterval: 20_000 },
  );
  const entrev = useMemo(() => ordenarEntrevistados(entrevQ.data ?? []), [entrevQ.data]);
  const horas = useMemo(() => new Map(entrev.map((c, i) => [c.id, horaSlot(i)])), [entrev]);
  const [verTabela, setVerTabela] = useState(false);

  const [editVaga, setEditVaga] = useState<VagaRow | null>(null);
  const [novaVaga, setNovaVaga] = useState(false);
  const [verCand, setVerCand] = useState<CandRow | null>(null);

  const setEstado = trpc.vagas.atualizar.useMutation({
    onSuccess: () => { toast("✅ Vaga actualizada."); utils.vagas.listTodas.invalidate(); },
    onError: (e) => toast("⚠️ " + e.message),
  });
  const triagem = trpc.vagas.triagem.useMutation({
    onSuccess: (r) => { toast(`🤖 Triagem concluída — ${r.n} candidatura(s) pontuada(s).`); utils.vagas.candidaturas.invalidate(); },
    onError: (e) => toast("⚠️ " + e.message),
  });
  const setStatus = trpc.vagas.setStatusCandidatura.useMutation({
    onSuccess: () => { toast("✅ Estado actualizado."); utils.vagas.candidaturas.invalidate(); },
    onError: (e) => toast("⚠️ " + e.message),
  });

  const invalido = vagas.error?.data?.code === "FORBIDDEN";
  const nNovas = useMemo(() => (cands.data ?? []).filter((c) => c.status === "Nova").length, [cands.data]);

  return (
    <div>
      <Voltar onClick={voltar} />
      <div className="c-titulo">💼 Vagas & Recrutamento</div>

      {invalido && <Vazio icon="🔒">Página reservada ao Administrador e ao Gerente.</Vazio>}

      {!invalido && (
        <>
          <div className="c-abas">
            <button className={aba === "candidaturas" ? "ativo" : ""} onClick={() => setAba("candidaturas")}>
              📥 Candidaturas{nNovas > 0 ? ` (${nNovas} novas)` : ""}
            </button>
            <button className={aba === "vagas" ? "ativo" : ""} onClick={() => setAba("vagas")}>📋 Vagas</button>
            <button className={aba === "subscritores" ? "ativo" : ""} onClick={() => setAba("subscritores")}>🔔 Subscritores</button>
          </div>

          <div className="c-card" style={{ background: "#eef6ff", border: "1px solid #bcd7f5", fontSize: 13 }}>
            🔗 Página pública para partilhar: <b>{window.location.origin}/?vagas=1</b> — os candidatos não precisam de registo.
            <button className="c-btn c-btn-linha c-btn-peq" style={{ marginLeft: 6 }}
              onClick={() => { navigator.clipboard?.writeText(`${window.location.origin}/?vagas=1`); toast("🔗 Link copiado!"); }}>
              Copiar link
            </button>
          </div>

          {/* ================= CANDIDATURAS ================= */}
          {aba === "candidaturas" && (
            <>
              <div className="c-card" style={{ paddingBottom: 6 }}>
                <div className="c-titulo" style={{ fontSize: 14 }}>🔎 Filtros</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <select className="c-select" value={fVaga} onChange={(e) => setFVaga(parseInt(e.target.value))}>
                    <option value={0}>Todas as vagas</option>
                    {(vagas.data ?? []).map((v) => <option key={v.id} value={v.id}>{v.titulo}</option>)}
                  </select>
                  <select className="c-select" value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
                    <option value="">Todos os estados</option>
                    {STATUS.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <select className="c-select" value={fMin} onChange={(e) => setFMin(parseInt(e.target.value))}>
                    <option value={0}>Pontuação: todas</option>
                    <option value={70}>🤖 Só fortes (≥ 70)</option>
                    <option value={45}>🤖 Médias e fortes (≥ 45)</option>
                    <option value={1}>Só pontuadas</option>
                  </select>
                  <input className="c-input" placeholder="🔍 Nome, código ou bairro…" value={busca} onChange={(e) => setBusca(e.target.value)} />
                </div>
                <button className="c-btn c-btn-linha c-btn-peq" style={{ marginTop: 8 }} disabled={triagem.isPending}
                  title="Pontuar (de novo) todas as candidaturas do filtro actual com a triagem automática"
                  onClick={() => user && triagem.mutate({ usuarioId: user.id, vagaId: fVaga || undefined })}>
                  {triagem.isPending ? "🤖 A pontuar…" : "🤖 Triagem automática (re)pontuar"}
                </button>
              </div>

              {entrev.length > 0 && (
                <div className="c-card" style={{ background: "#f2fbf4", border: "1px solid #bfe6c8", fontSize: 13 }}>
                  <div className="c-linha" style={{ alignItems: "flex-start" }}>
                    <div className="grow">
                      <b>🗓 Entrevistas — {DATA_ENTREVISTAS}</b>
                      <div className="det">{entrev.length} candidato(s) apurado(s) · 30 min cada · início às 09:30</div>
                      <div className="det">📍 {LOCAL_CAMIS}</div>
                    </div>
                    <button className="c-btn c-btn-prim c-btn-peq" onClick={() => baixarListaEntrevistas(entrev)}>
                      ⬇️ Lista (Word)
                    </button>
                  </div>
                  <button className="c-btn c-btn-linha c-btn-peq" style={{ marginTop: 6 }} onClick={() => setVerTabela(!verTabela)}>
                    {verTabela ? "Esconder tabela" : "👁 Ver tabela de horários"}
                  </button>
                  {verTabela && (
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, marginTop: 6 }}>
                      <thead>
                        <tr style={{ textAlign: "left", borderBottom: "2px solid #9c6fc0" }}>
                          <th style={{ padding: "4px 6px" }}>Hora</th><th style={{ padding: "4px 6px" }}>Candidato</th>
                          <th style={{ padding: "4px 6px" }}>Vaga</th><th style={{ padding: "4px 6px" }}>Residência</th>
                        </tr>
                      </thead>
                      <tbody>
                        {entrev.map((c, i) => (
                          <tr key={c.id} style={{ borderBottom: "1px solid #e5d8ef" }}>
                            <td style={{ padding: "4px 6px", fontWeight: 800, color: "var(--roxo)" }}>{horaSlot(i)}</td>
                            <td style={{ padding: "4px 6px" }}>{c.nome}</td>
                            <td style={{ padding: "4px 6px" }}>{c.vagaTitulo}</td>
                            <td style={{ padding: "4px 6px" }}>{c.residencia ?? "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  <div className="det" style={{ marginTop: 6 }}>
                    ℹ️ A hora segue a ordem da lista (maior pontuação 🤖 primeiro) e já vai na mensagem de WhatsApp de cada candidato. Baixe a lista depois de fechar o apuramento.
                  </div>
                </div>
              )}

              {cands.isLoading && <Vazio icon="⏳">A carregar…</Vazio>}
              {(cands.data ?? []).length === 0 && !cands.isLoading && <Vazio icon="📭">Sem candidaturas neste filtro.</Vazio>}
              {(cands.data ?? []).map((c) => (
                <div className="c-card" key={c.id} style={{ padding: 10 }}>
                  <div className="c-linha" style={{ alignItems: "flex-start" }}>
                    <div className="grow">
                      <div className="tit">{c.nome} <span className="det">· {c.codigo}</span></div>
                      <div className="det">{c.vagaTitulo} · {c.experienciaAnos} ano(s) exp. · {c.residencia ?? "—"}</div>
                      <div className="det">📞 {c.telefone}{c.email ? ` · ✉️ ${c.email}` : ""} · {c.temCv ? "📎 CV anexado" : "sem CV"}</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      {c.pontuacao != null && (
                        <div style={{ fontWeight: 900, fontSize: 20, color: corPontos(c.pontuacao) }}>{c.pontuacao}<small style={{ fontSize: 11 }}>/100</small></div>
                      )}
                      <span className={`c-chip ${corStatus(c.status)}`}>{c.status}</span>
                      {c.status === "Entrevista" && horas.get(c.id) && (
                        <div style={{ fontWeight: 800, color: "var(--roxo)", fontSize: 13, marginTop: 3 }}>🕘 {horas.get(c.id)}</div>
                      )}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                    <button className="c-btn c-btn-linha c-btn-peq grow" onClick={() => setVerCand(c)}>👁 Ver</button>
                    <a className="c-btn c-btn-verde c-btn-peq grow"
                      title="A mensagem adequada ao estado do candidato (entrevista, suplente, contratado…) vai pronta a enviar"
                      href={waLink(c.telefone, msgCandidato(c, entrev))} target="_blank" rel="noreferrer">💬 WhatsApp</a>
                  </div>
                </div>
              ))}
            </>
          )}

          {/* ================= VAGAS ================= */}
          {aba === "vagas" && (
            <>
              <button className="c-btn c-btn-prim c-btn-bloco" onClick={() => setNovaVaga(true)}>＋ Nova vaga</button>
              {(vagas.data ?? []).map((v) => (
                <div className="c-card" key={v.id}>
                  <div className="c-linha" style={{ alignItems: "flex-start" }}>
                    <div className="grow">
                      <div className="tit">{v.titulo}</div>
                      <div className="det">{v.area} · {v.tipo} · 📍 {v.local}</div>
                      <div className="det">📥 {v.nCandidaturas} candidatura(s)</div>
                    </div>
                    <span className={`c-chip ${v.estado === "Aberta" ? "c-chip-verde" : "c-chip-vermelho"}`}>{v.estado}</span>
                  </div>
                  <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                    <button className="c-btn c-btn-linha c-btn-peq grow" onClick={() => setEditVaga(v)}>✏️ Editar</button>
                    <button className={`c-btn c-btn-peq grow ${v.estado === "Aberta" ? "c-btn-cinza" : "c-btn-verde"}`}
                      disabled={setEstado.isPending}
                      onClick={() => user && setEstado.mutate({ usuarioId: user.id, id: v.id, estado: v.estado === "Aberta" ? "Fechada" : "Aberta" })}>
                      {v.estado === "Aberta" ? "🔒 Fechar vaga" : "🔓 Reabrir"}
                    </button>
                  </div>
                  {v.estado === "Aberta" && (
                    <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                      <a className="c-btn c-btn-verde c-btn-peq grow" target="_blank" rel="noreferrer"
                        title="Partilhar a vaga por WhatsApp — num contacto, grupo ou no seu Estado (para indicações de candidatos)"
                        href={`https://wa.me/?text=${encodeURIComponent(msgPartilhaVaga(v, `${window.location.origin}/?vagas=1`))}`}>
                        📣 Partilhar no WhatsApp
                      </a>
                      <button className="c-btn c-btn-linha c-btn-peq"
                        title="Copiar a mensagem de partilha (para colar onde quiser)"
                        onClick={() => { navigator.clipboard?.writeText(msgPartilhaVaga(v, `${window.location.origin}/?vagas=1`)); toast("📋 Mensagem copiada!"); }}>
                        📋
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </>
          )}

          {/* ================= SUBSCRITORES ================= */}
          {aba === "subscritores" && (
            <>
              <div className="c-card" style={{ fontSize: 13, background: "#f7f1fc", border: "1px solid var(--roxo2)" }}>
                🔔 Estas pessoas pediram aviso de novas vagas. Ao abrir um concurso, toque em «💬 Avisar» para lhes enviar o link por WhatsApp.
              </div>
              {(subs.data ?? []).length === 0 && <Vazio icon="🔕">Ainda sem subscritores.</Vazio>}
              {(subs.data ?? []).map((s) => (
                <div className="c-linha" key={s.id} style={{ borderBottom: "1px solid #eee", padding: "8px 2px" }}>
                  <div className="grow">
                    <div className="tit">{s.nome}</div>
                    <div className="det">{s.canal === "WhatsApp" ? "💬" : "✉️"} {s.contacto}</div>
                  </div>
                  {s.canal === "WhatsApp" && (
                    <a className="c-btn c-btn-verde c-btn-peq" target="_blank" rel="noreferrer"
                      href={waLink(s.contacto, `Olá ${s.nome.split(" ")[0]}! A CAMI'S Eventos abriu um novo concurso de vagas. Veja e candidate-se aqui: ${window.location.origin}/?vagas=1`)}>
                      💬 Avisar
                    </a>
                  )}
                </div>
              ))}
            </>
          )}
        </>
      )}

      {novaVaga && user && <FormVaga usuarioId={user.id} onClose={() => setNovaVaga(false)} />}
      {editVaga && user && <FormVaga usuarioId={user.id} vaga={editVaga} onClose={() => setEditVaga(null)} />}
      {verCand && user && <VerCandidatura c={verCand} usuarioId={user.id} entrev={entrev} onClose={() => setVerCand(null)}
        onStatus={(status, nota) => { setStatus.mutate({ usuarioId: user.id, id: verCand.id, status: status as typeof STATUS[number], notaInterna: nota }); }} />}
    </div>
  );
}

/* ---------- criar/editar vaga ---------- */
function FormVaga({ usuarioId, vaga, onClose }: { usuarioId: number; vaga?: VagaRow; onClose: () => void }) {
  const { toast } = useSession();
  const utils = trpc.useUtils();
  const [f, setF] = useState({
    titulo: vaga?.titulo ?? "", area: vaga?.area ?? "Cozinha", tipo: vaga?.tipo ?? "Tempo inteiro",
    local: vaga?.local ?? "Chimoio — CAMI'S Eventos", salario: vaga?.salario ?? "",
    descricao: vaga?.descricao ?? "", requisitos: vaga?.requisitos ?? "", oferecemos: vaga?.oferecemos ?? "",
  });
  const criar = trpc.vagas.criar.useMutation({
    onSuccess: (r) => {
      toast(r.subscritores > 0 ? `✅ Vaga publicada! ${r.subscritores} subscritor(es) aguardam aviso (separador 🔔).` : "✅ Vaga publicada!");
      utils.vagas.listTodas.invalidate(); onClose();
    },
    onError: (e) => toast("⚠️ " + e.message),
  });
  const atualizar = trpc.vagas.atualizar.useMutation({
    onSuccess: () => { toast("✅ Vaga actualizada."); utils.vagas.listTodas.invalidate(); onClose(); },
    onError: (e) => toast("⚠️ " + e.message),
  });
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));
  const pendente = criar.isPending || atualizar.isPending;

  return (
    <Modal onClose={onClose}>
      <h3>{vaga ? "✏️ Editar vaga" : "＋ Nova vaga"}</h3>
      <label className="c-label">Título *</label>
      <input className="c-input" value={f.titulo} onChange={(e) => set("titulo", e.target.value)} placeholder="Ex.: Chef de Cozinha" />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <div>
          <label className="c-label">Área</label>
          <select className="c-select" value={f.area} onChange={(e) => set("area", e.target.value)}>
            {["Cozinha", "Serviço", "Eventos", "Limpeza", "Segurança", "Administração"].map((a) => <option key={a}>{a}</option>)}
          </select>
        </div>
        <div>
          <label className="c-label">Tipo</label>
          <select className="c-select" value={f.tipo} onChange={(e) => set("tipo", e.target.value)}>
            {["Tempo inteiro", "Part-time", "Estágio", "Avença"].map((t) => <option key={t}>{t}</option>)}
          </select>
        </div>
      </div>
      <label className="c-label">Local</label>
      <input className="c-input" value={f.local} onChange={(e) => set("local", e.target.value)} />
      <label className="c-label">Salário (opcional)</label>
      <input className="c-input" value={f.salario} onChange={(e) => set("salario", e.target.value)} placeholder="Ex.: A combinar" />
      <label className="c-label">O que vai fazer</label>
      <textarea className="c-input" rows={3} value={f.descricao} onChange={(e) => set("descricao", e.target.value)} />
      <label className="c-label">Perfil / requisitos do candidato</label>
      <textarea className="c-input" rows={3} value={f.requisitos} onChange={(e) => set("requisitos", e.target.value)} />
      <label className="c-label">O que oferecemos</label>
      <textarea className="c-input" rows={2} value={f.oferecemos} onChange={(e) => set("oferecemos", e.target.value)} />
      <button className="c-btn c-btn-prim c-btn-bloco" style={{ marginTop: 12 }} disabled={f.titulo.trim().length < 3 || pendente}
        onClick={() => vaga
          ? atualizar.mutate({ usuarioId, id: vaga.id, ...f, salario: f.salario || null })
          : criar.mutate({ usuarioId, ...f, salario: f.salario || undefined })}>
        {pendente ? "A guardar…" : vaga ? "💾 Guardar alterações" : "📢 Publicar vaga"}
      </button>
    </Modal>
  );
}

/* ---------- detalhe da candidatura ---------- */
function VerCandidatura({ c, usuarioId, entrev, onClose, onStatus }: {
  c: CandRow; usuarioId: number; entrev: CandRow[]; onClose: () => void;
  onStatus: (status: string, nota?: string) => void;
}) {
  const utils = trpc.useUtils();
  const { toast } = useSession();
  const [nota, setNota] = useState(c.notaInterna ?? "");
  const [statusSel, setStatusSel] = useState(c.status);
  const [mostrarTri, setMostrarTri] = useState(false);
  const temMensagem = ["Entrevista", "Contratado", "Não contratado", "Rejeitado"].includes(statusSel);
  const msgSel = temMensagem ? msgCandidato({ ...c, status: statusSel }, entrev) : "";
  const cvQ = trpc.vagas.cv.useQuery({ usuarioId, id: c.id }, { enabled: false });
  const abrirCv = async () => {
    try {
      const r = await cvQ.refetch();
      if (r.data?.cv) {
        const w = window.open();
        if (w) {
          if (r.data.cv.startsWith("data:application/pdf"))
            w.document.write(`<iframe src="${r.data.cv}" style="width:100%;height:100vh;border:0"></iframe>`);
          else w.document.write(`<img src="${r.data.cv}" style="max-width:100%">`);
        }
      } else toast("⚠️ Sem CV anexado.");
    } catch { toast("⚠️ Sem CV anexado."); }
  };

  return (
    <Modal onClose={onClose}>
      <h3>{c.nome}</h3>
      <p className="c-sub">{c.codigo} · {c.vagaTitulo} · {new Date(c.criadoEm).toLocaleDateString("pt-PT")}</p>
      {c.pontuacao != null && (
        <div className="c-card" style={{ background: "#f7f7fb", padding: 10 }}>
          <div className="c-linha">
            <b style={{ fontSize: 22, color: corPontos(c.pontuacao) }}>🤖 {c.pontuacao}/100</b>
            <button className="c-btn c-btn-linha c-btn-peq" onClick={() => setMostrarTri(!mostrarTri)}>
              {mostrarTri ? "Esconder" : "Ver análise"}
            </button>
          </div>
          {mostrarTri && (
            <pre style={{ whiteSpace: "pre-wrap", fontSize: 12.5, margin: "8px 0 0", fontFamily: "inherit" }}>{c.pontuacaoDetalhe}</pre>
          )}
        </div>
      )}
      <div style={{ fontSize: 13.5, marginTop: 8 }}>
        <div>📞 {c.telefone}{c.email ? ` · ✉️ ${c.email}` : ""}</div>
        <div>🎂 {c.idade ?? "—"} anos · 📍 {c.residencia ?? "—"}</div>
        <div>💼 {c.experienciaAnos} ano(s) de experiência · ⏱ {c.disponibilidade}</div>
      </div>
      {c.apresentacao && (
        <>
          <div className="c-label" style={{ marginTop: 8 }}>Apresentação</div>
          <p style={{ whiteSpace: "pre-line", fontSize: 13.5 }}>{c.apresentacao}</p>
        </>
      )}
      <button className="c-btn c-btn-linha c-btn-bloco" onClick={abrirCv}>📎 Abrir CV ({c.cvNome ?? "sem anexo"})</button>

      <label className="c-label" style={{ marginTop: 10 }}>Estado da candidatura</label>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {STATUS.map((s) => (
          <button key={s} className={`c-btn c-btn-peq ${statusSel === s ? "c-btn-prim" : "c-btn-cinza"}`}
            onClick={() => { setStatusSel(s); onStatus(s, nota || undefined); }}>
            {s}
          </button>
        ))}
      </div>
      {temMensagem && (
        <div className="c-card" style={{ background: "#f2fbf4", border: "1px solid #bfe6c8", padding: 10, marginTop: 8 }}>
          <div className="det" style={{ marginBottom: 4 }}>💬 Mensagem automática ({statusSel}) — pronta a enviar:</div>
          <pre style={{ whiteSpace: "pre-wrap", fontSize: 12.5, fontFamily: "inherit", margin: 0, maxHeight: 180, overflowY: "auto" }}>{msgSel}</pre>
          <a className="c-btn c-btn-verde c-btn-bloco" style={{ marginTop: 8 }} target="_blank" rel="noreferrer"
            href={waLink(c.telefone, msgSel)}>
            💬 Enviar por WhatsApp
          </a>
        </div>
      )}
      <label className="c-label" style={{ marginTop: 10 }}>Nota interna (só a equipa vê)</label>
      <input className="c-input" value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Ex.: Ligar dia 12 para entrevista"
        onBlur={() => nota !== (c.notaInterna ?? "") && onStatus(statusSel, nota)} />
      <button className="c-btn c-btn-cinza c-btn-bloco" style={{ marginTop: 10 }} onClick={() => { utils.vagas.candidaturas.invalidate(); onClose(); }}>Fechar</button>
    </Modal>
  );
}
