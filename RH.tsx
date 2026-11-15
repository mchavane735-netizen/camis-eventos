/* ============================================================
   RECURSOS HUMANOS — página EXCLUSIVA do Administrador
   · Trabalhadores: Permanente / Eventual / Afiliado (áreas: Restaurante & Decoração)
   · Presenças diárias com justificativa de ausências
   · Licenças anuais, periódicas e outras (com motivo)
   · Salários pagos no dia do mês da entrada; eventual = dias × diária (500 MZN)
   · Alertas contínuos de pagamento (5, 3 e 1 dias antes + atrasos)
   · Contratos automáticos em Word A4 (Lei do Trabalho de Moçambique, Lei 23/2007)
   · Relatório mensal (salários, desempenho, variáveis) em Word A4 e impressão
   ============================================================ */
import { useEffect, useMemo, useState } from "react";
import { trpc } from "@/providers/trpc";
import { useSession } from "@/lib/session";
import { Modal, Vazio, Voltar } from "@/components/bits";
import MoneyInput from "@/components/MoneyInput";
import { mt } from "@/lib/fmt";
import { METODOS_PAGAMENTO } from "@contracts/types";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../api/router";

type Painel = inferRouterOutputs<AppRouter>["rh"]["painel"];
type Trab = Painel["trabalhadores"][number];
type Rel = inferRouterOutputs<AppRouter>["rh"]["relatorioMes"];
type AfRow = inferRouterOutputs<AppRouter>["afiliados"]["listar"]["afiliados"][number];
type VgRow = inferRouterOutputs<AppRouter>["trabalhoVagas"]["listar"][number];

const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const mesNome = (m: string) => { const [a, mm] = m.split("-"); return `${MESES[parseInt(mm) - 1]} ${a}`; };
const fmtD = (d: string) => d.split("-").reverse().join("/");
/** Erros de validação chegam em JSON — extrai a mensagem legível (em português) */
const msgErro = (e: { message: string }) => {
  try {
    const arr = JSON.parse(e.message);
    if (Array.isArray(arr) && arr[0]?.message) return arr.map((x: any) => x.message).join(" · ");
  } catch { /* não é JSON */ }
  return e.message;
};

const REGIMES = ["Permanente", "Eventual", "Afiliado"] as const;
const AREAS_RH = ["Restaurante", "Decoração", "Ambas"] as const;
const corRegime = (r: string) => r === "Permanente" ? "c-chip-verde" : r === "Eventual" ? "c-chip-amarelo" : "c-chip-roxo";

const escHtml = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function baixarDoc(nome: string, html: string) {
  const blob = new Blob(["\ufeff", html], { type: "application/msword;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = nome;
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ---------- CONTRATO AUTOMÁTICO (Word A4 — Lei do Trabalho, Lei n.º 23/2007) ---------- */
export function gerarContrato(t: Trab) {
  const duracao = t.regime === "Permanente"
    ? `O presente contrato é celebrado <b>por tempo indeterminado</b> (art. 15.º da Lei n.º 23/2007), com um <b>período experimental de 90 (noventa) dias</b> (art. 20.º), contados da data de início.`
    : t.regime === "Eventual"
      ? `O presente contrato é celebrado <b>a termo certo</b>, para trabalho <b>eventual por dia/tarefa</b> (arts. 43.º e ss. da Lei n.º 23/2007), podendo ser renovado conforme as necessidades do EMPREGADOR, sem que a sucessão de dias converta o vínculo em tempo indeterminado, salvo o disposto na lei.`
      : `O presente contrato é um contrato de <b>prestação de serviços autónoma (comissionista)</b>, não gerando vínculo de emprego (art. 10.º da Lei n.º 23/2007). O PRESTADOR poderá ainda ser contratado como <b>trabalhador eventual</b>, remunerado à diária, sempre que as partes assim o acordem.`;
  const remuneracao = t.regime === "Permanente"
    ? `O TRABALHADOR auferirá um salário mensal de <b>${mt(t.salarioMensal)}</b>, pago mensalmente <b>no dia ${t.diaEntrada} de cada mês</b> (dia correspondente à data de admissão), por transferência, dinheiro ou outro meio acordado.`
    : t.regime === "Eventual"
      ? `O TRABALHADOR auferirá uma diária de <b>${mt(t.diaria)}</b> por cada dia trabalhado — o mesmo valor na área de Restaurante ou de Decoração (ex.: um dia na Decoração e outro no Restaurante totalizam ${mt(t.diaria * 2)}). O apuramento é feito pelo registo diário de presenças e pago <b>no dia ${t.diaEntrada} do mês seguinte</b> ao trabalho realizado.`
      : `O PRESTADOR será remunerado por <b>comissões sobre as vendas/eventos angariados</b>, nos termos do Programa de Afiliados da CAMI'S EVENTOS em vigor. Pelo trabalho eventual a dias, quando contratado nessa qualidade, auferirá a diária de <b>${mt(t.diaria)}</b>.`;
  const titulo = t.regime === "Permanente" ? "CONTRATO DE TRABALHO POR TEMPO INDETERMINADO"
    : t.regime === "Eventual" ? "CONTRATO DE TRABALHO A TERMO CERTO — TRABALHO EVENTUAL"
    : "CONTRATO DE PRESTAÇÃO DE SERVIÇOS — AFILIADO (COMISSIONISTA)";

  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office"><head><meta charset="utf-8"></head>
<body style="font-family:Calibri,Arial,sans-serif;font-size:11pt;line-height:1.45;max-width:17cm;margin:auto">
  <div style="text-align:center">
    <b style="font-size:14pt">CAMI'S EVENTOS</b><br>
    <span style="font-size:9pt">Restaurante &amp; Decoração de Eventos · Chizombero, Chimoio — Província de Manica, Moçambique</span>
    <hr style="border:1px solid #7b3fa0">
    <b style="font-size:12.5pt">${titulo}</b>
  </div>
  <p><b>ENTRE:</b></p>
  <p><b>CAMI'S EVENTOS</b>, pessoa colectiva com sede em Chizombero, cidade de Chimoio, Província de Manica, neste acto representada pelo seu Director Geral, <b>Sr. Milagre Chavane</b>, adiante designada por <b>EMPREGADOR</b>;</p>
  <p><b>E:</b> <b>${escHtml(t.nome)}</b>${t.biNumero ? `, portador(a) do Bilhete de Identidade n.º <b>${escHtml(t.biNumero)}</b>` : ""}${t.telefone ? `, contactável pelo telefone ${escHtml(t.telefone)}` : ""}, adiante designado(a) por <b>${t.regime === "Afiliado" ? "PRESTADOR(A)" : "TRABALHADOR(A)"}</b>;</p>
  <p>É celebrado o presente contrato, que se rege pela <b>Lei do Trabalho — Lei n.º 23/2007, de 1 de Agosto</b>, e pelas cláusulas seguintes:</p>

  <p><b>CLÁUSULA 1.ª (Objecto)</b><br>
  O(A) ${t.regime === "Afiliado" ? "PRESTADOR(A)" : "TRABALHADOR(A)"} exercerá as funções de <b>${escHtml(t.cargo)}</b>, compreendendo, designadamente: ${escHtml(t.atividades || "as actividades inerentes ao cargo, conforme as instruções da Direcção")}.</p>

  <p><b>CLÁUSULA 2.ª (Local e área de trabalho)</b><br>
  O trabalho será prestado nas instalações da CAMI'S EVENTOS, em Chizombero, Chimoio, na(s) área(s) de <b>${t.area === "Ambas" ? "Restaurante e Decoração" : t.area}</b>.${t.area === "Ambas" || t.regime !== "Permanente" ? " O(A) trabalhador(a) poderá ser alocado(a) em qualquer das áreas (Restaurante e/ou Decoração), conforme as necessidades do serviço, devendo a alocação constar do registo diário de presenças." : ""}</p>

  <p><b>CLÁUSULA 3.ª (Duração)</b><br>${duracao}</p>

  <p><b>CLÁUSULA 4.ª (Remuneração)</b><br>${remuneracao}</p>

  ${t.regime !== "Afiliado" ? `<p><b>CLÁUSULA 5.ª (Período normal de trabalho)</b><br>
  O período normal de trabalho é de até <b>8 horas por dia e 48 horas por semana</b> (art. 86.º da Lei n.º 23/2007), com descanso semanal de, pelo menos, 24 horas consecutivas. O trabalho em fins de semana e feriados — inerente à actividade de eventos — observa a escala definida pelo EMPREGADOR e a compensação prevista na lei.</p>

  <p><b>CLÁUSULA 6.ª (Férias, faltas e licenças)</b><br>
  1. O(A) TRABALHADOR(A) tem direito a férias anuais remuneradas nos termos dos arts. 111.º e seguintes da Lei n.º 23/2007.<br>
  2. As faltas devem ser justificadas por escrito, com indicação do motivo; as licenças (anuais, periódicas ou outras) são registadas com o respectivo motivo e período.<br>
  3. As ausências injustificadas determinam o desconto correspondente na remuneração, sem prejuízo do procedimento disciplinar legal.</p>

  <p><b>CLÁUSULA 7.ª (Deveres)</b><br>
  Constituem deveres do(a) TRABALHADOR(A): a assiduidade e a pontualidade; o zelo e a diligência; a obediência às instruções legítimas; a guarda e conservação dos bens do EMPREGADOR; e o estrito cumprimento das normas de higiene e segurança alimentar e do sigilo profissional.</p>

  <p><b>CLÁUSULA 8.ª (Segurança social e obrigações fiscais)</b><br>
  O EMPREGADOR procederá à inscrição do(a) TRABALHADOR(A) no INSS e ao cumprimento das obrigações fiscais (IRPS), nos termos da legislação em vigor.</p>

  <p><b>CLÁUSULA 9.ª (Cessação)</b><br>
  O contrato cessa nos casos e formas previstos nos arts. 124.º e seguintes da Lei n.º 23/2007.</p>`
  : `<p><b>CLÁUSULA 5.ª (Obrigações do(a) PRESTADOR(A))</b><br>
  Angariar clientes e eventos para a CAMI'S EVENTOS com zelo e boa-fé; respeitar os preços e condições oficiais da casa; não assumir compromissos em nome do EMPREGADOR sem autorização; e guardar sigilo sobre informações comerciais.</p>

  <p><b>CLÁUSULA 6.ª (Pagamento das comissões)</b><br>
  As comissões são apuradas sobre cada venda/evento confirmado e pago pelo cliente, e liquidadas nos termos e prazos do Programa de Afiliados.</p>

  <p><b>CLÁUSULA 7.ª (Vigência e rescisão)</b><br>
  O contrato vigora por tempo indeterminado e pode ser denunciado por qualquer das partes com aviso prévio de 15 dias, sem prejuízo das comissões já apuradas.</p>`}

  <p><b>CLÁUSULA ${t.regime !== "Afiliado" ? "10.ª" : "8.ª"} (Disposições finais)</b><br>
  Os casos omissos regem-se pela Lei do Trabalho (Lei n.º 23/2007) e demais legislação aplicável da República de Moçambique.</p>

  <p style="margin-top:26px">Chimoio, ______ de ______________________ de 20____.</p>
  <table style="width:100%;margin-top:40px;text-align:center"><tr>
    <td style="width:45%">_________________________________<br><b>O EMPREGADOR</b><br><small>(Milagre Chavane — Director Geral)</small></td>
    <td style="width:10%"></td>
    <td style="width:45%">_________________________________<br><b>${t.regime === "Afiliado" ? "O(A) PRESTADOR(A)" : "O(A) TRABALHADOR(A)"}</b><br><small>${escHtml(t.nome)}</small></td>
  </tr></table>
  <p style="margin-top:26px;font-size:8.5pt;color:#666;border-top:1px dashed #999;padding-top:6px">
  Modelo-base gerado automaticamente pelo sistema CAMI'S Eventos (${t.codigo}) — deve ser revisto por um jurista/contabilista antes da assinatura (enquadramento INSS e IRPS).</p>
</body></html>`;
  baixarDoc(`Contrato — ${t.nome.replace(/[\\/:*?"<>|]/g, " ")}.doc`, html);
}

/* ---------- RELATÓRIO MENSAL (salários, desempenho, variáveis) ---------- */
function corpoRelatorio(r: Rel): string {
  const linhas = r.linhas.map((l, i) => `<tr>
    <td style="border:1px solid #999;padding:5px;text-align:center">${i + 1}</td>
    <td style="border:1px solid #999;padding:5px"><b>${escHtml(l.nome)}</b><br><small>${l.codigo} · ${escHtml(l.cargo)}</small></td>
    <td style="border:1px solid #999;padding:5px">${l.regime}<br><small>${l.area === "Ambas" ? "Rest. + Dec." : l.area}</small></td>
    <td style="border:1px solid #999;padding:5px;text-align:center">${l.diasPresentes} dia(s)<br><small>Rest.: ${l.diasRestaurante} · Dec.: ${l.diasDecoracao}</small></td>
    <td style="border:1px solid #999;padding:5px;text-align:center">${l.diasAusentes}<br><small>${l.ausenciasJustificadas} justificada(s)</small></td>
    <td style="border:1px solid #999;padding:5px;text-align:center">${l.assiduidade == null ? "—" : l.assiduidade + "%"}</td>
    <td style="border:1px solid #999;padding:5px">${l.licencas.length === 0 ? "—" : l.licencas.map((x) => `${x.tipo}: ${escHtml(x.motivo)} (${fmtD(x.inicio)}–${fmtD(x.fim)})`).join("<br>")}</td>
    <td style="border:1px solid #999;padding:5px;text-align:right">${l.regime === "Permanente" ? mt(l.salarioMensal) : `${l.diasPresentes} × ${mt(l.diaria)}`}<br><b>${mt(l.valorDevido)}</b></td>
    <td style="border:1px solid #999;padding:5px;text-align:right">${mt(l.valorPago)}</td>
    <td style="border:1px solid #999;padding:5px;text-align:right"><b style="color:${l.saldo > 0 ? "#b3261e" : "#1e7d32"}">${mt(l.saldo)}</b></td>
  </tr>`).join("");
  const totDev = r.linhas.reduce((s, l) => s + l.valorDevido, 0);
  const totPag = r.linhas.reduce((s, l) => s + l.valorPago, 0);
  return `
  <div style="text-align:center">
    <b style="font-size:14pt">CAMI'S EVENTOS — RELATÓRIO MENSAL DE RECURSOS HUMANOS</b><br>
    <span style="font-size:10pt">Mês de referência: <b>${mesNome(r.mes)}</b> · Salários, assiduidade (desempenho), licenças e variáveis</span><br>
    <span style="font-size:8.5pt;color:#666">Gerado em ${fmtD(r.geradoEm)} · Documento interno — Administração</span>
    <hr style="border:1px solid #7b3fa0">
  </div>
  <table style="border-collapse:collapse;width:100%;font-size:9.5pt">
    <thead><tr style="background:#e7d7f1">
      <th style="border:1px solid #999;padding:5px">Nº</th><th style="border:1px solid #999;padding:5px">Trabalhador</th>
      <th style="border:1px solid #999;padding:5px">Regime/Área</th><th style="border:1px solid #999;padding:5px">Presenças</th>
      <th style="border:1px solid #999;padding:5px">Ausências</th><th style="border:1px solid #999;padding:5px">Assiduidade</th>
      <th style="border:1px solid #999;padding:5px">Licenças</th><th style="border:1px solid #999;padding:5px">Valor devido</th>
      <th style="border:1px solid #999;padding:5px">Pago</th><th style="border:1px solid #999;padding:5px">Saldo</th>
    </tr></thead>
    <tbody>${linhas}</tbody>
    <tfoot><tr style="background:#f4eef9;font-weight:800">
      <td colspan="7" style="border:1px solid #999;padding:5px;text-align:right">TOTAIS</td>
      <td style="border:1px solid #999;padding:5px;text-align:right">${mt(totDev)}</td>
      <td style="border:1px solid #999;padding:5px;text-align:right">${mt(totPag)}</td>
      <td style="border:1px solid #999;padding:5px;text-align:right">${mt(Math.max(0, totDev - totPag))}</td>
    </tr></tfoot>
  </table>
  <p style="font-size:8.5pt;color:#666;margin-top:8px">Assiduidade = presenças ÷ dias registados. Valor devido: Permanente = salário mensal · Eventual/Afiliado = dias presentes × diária (${mt(500)} por dia, igual nas áreas de Restaurante e Decoração).</p>`;
}

function baixarRelatorioWord(r: Rel) {
  baixarDoc(`Relatorio-RH-${r.mes}.doc`,
    `<html xmlns:o="urn:schemas-microsoft-com:office:office"><head><meta charset="utf-8"></head>
     <body style="font-family:Calibri,Arial,sans-serif">${corpoRelatorio(r)}</body></html>`);
}

function imprimirRelatorioA4(r: Rel) {
  const w = window.open();
  if (!w) return;
  w.document.write(`<html><head><meta charset="utf-8"><title>Relatório RH — ${r.mes}</title>
  <style>@page{size:A4 landscape;margin:12mm} body{font-family:Calibri,Arial,sans-serif}
  .btn{position:fixed;top:10px;right:10px;background:#7b3fa0;color:#fff;border:0;border-radius:8px;padding:10px 16px;font-size:14px;cursor:pointer}
  @media print{.btn{display:none}}</style></head>
  <body><button class="btn" onclick="window.print()">🖨 Imprimir (A4)</button>${corpoRelatorio(r)}</body></html>`);
  w.document.close();
}

/* ============================================================ PÁGINA ============================================================ */
export default function RH({ voltar }: { voltar: () => void }) {
  const { user, toast } = useSession();
  const utils = trpc.useUtils();
  const ehAdmin = user?.perfil === "Admin" || user?.perfil === "RH";
  const [aba, setAba] = useState<"trabalhadores" | "presencas" | "licencas" | "salarios" | "vagas">("trabalhadores");

  const painel = trpc.rh.painel.useQuery({ usuarioId: user?.id ?? 0 }, { enabled: !!user && ehAdmin, refetchInterval: 30_000 });
  const invalido = painel.error?.data?.code === "FORBIDDEN" || !ehAdmin;

  /* ----- alertas contínuos de pagamento (5, 3 e 1 dias antes + atrasos) ----- */
  const alertas = useMemo(() => {
    const ts = (painel.data?.trabalhadores ?? []).filter((t) => t.ativo);
    const prox = ts.filter((t) => [5, 3, 1, 0].includes(t.diasParaPagamento));
    const atraso = ts.filter((t) => t.mesesEmAtraso.length > 0);
    return { prox, atraso };
  }, [painel.data]);

  useEffect(() => {
    if (!painel.data) return;
    const partes: string[] = [];
    if (alertas.atraso.length > 0) partes.push(`⚠️ ${alertas.atraso.length} trabalhador(es) com salário EM ATRASO`);
    if (alertas.prox.length > 0) partes.push(`⏰ ${alertas.prox.length} pagamento(s) a aproximar-se (5/3/1 dias)`);
    if (partes.length > 0) toast(partes.join(" · "));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [painel.dataUpdatedAt]);

  const trs = painel.data?.trabalhadores ?? [];
  const ativos = trs.filter((t) => t.ativo);

  return (
    <div>
      <Voltar onClick={voltar} />
      <div className="c-titulo">👥 Recursos Humanos</div>
      <div className="c-sub" style={{ marginTop: -6 }}>🔒 Página exclusiva do Administrador</div>

      {invalido && <Vazio icon="🔒">Página reservada exclusivamente ao Administrador.</Vazio>}

      {!invalido && (
        <>
          {/* ---------- ALERTAS CONTÍNUOS ---------- */}
          {alertas.atraso.length > 0 && (
            <div className="c-card" style={{ background: "#fdeceb", border: "1px solid #f2b8b5", fontSize: 13 }}>
              <b style={{ color: "var(--vermelho-c)" }}>⚠️ Salários em atraso</b>
              {alertas.atraso.map((t) => (
                <div key={t.id} style={{ marginTop: 3 }}>
                  • <b>{t.nome}</b> — em atraso: {t.mesesEmAtraso.map(mesNome).join(", ")}
                </div>
              ))}
            </div>
          )}
          {alertas.prox.length > 0 && (
            <div className="c-card" style={{ background: "#fff7e0", border: "1px solid #ecd27a", fontSize: 13 }}>
              <b style={{ color: "#8a6d00" }}>⏰ Pagamentos a aproximar-se</b>
              {alertas.prox.map((t) => (
                <div key={t.id} style={{ marginTop: 3 }}>
                  • <b>{t.nome}</b> — {t.diasParaPagamento === 0 ? <b>o pagamento é HOJE (dia {t.diaEntrada})</b> : `faltam ${t.diasParaPagamento} dia(s) (dia ${t.diaEntrada} · ${fmtD(t.proxPagamento)})`}
                </div>
              ))}
            </div>
          )}

          <div className="c-abas">
            <button className={aba === "trabalhadores" ? "ativo" : ""} onClick={() => setAba("trabalhadores")}>👥 Trabalhadores ({ativos.length})</button>
            <button className={aba === "presencas" ? "ativo" : ""} onClick={() => setAba("presencas")}>🗓 Presenças</button>
            <button className={aba === "licencas" ? "ativo" : ""} onClick={() => setAba("licencas")}>🌴 Licenças</button>
            <button className={aba === "salarios" ? "ativo" : ""} onClick={() => setAba("salarios")}>💰 Salários</button>
            <button className={aba === "vagas" ? "ativo" : ""} onClick={() => setAba("vagas")}>📢 Vagas p/ Afiliados</button>
          </div>

          {painel.isLoading && <Vazio icon="⏳">A carregar…</Vazio>}

          {painel.data && aba === "trabalhadores" && <TrabalhadoresTab trs={trs} onMudou={() => utils.rh.painel.invalidate()} />}
          {painel.data && aba === "presencas" && <PresencasTab usuarioId={user!.id} trs={ativos} hoje={painel.data.hoje} onMudou={() => utils.rh.painel.invalidate()} />}
          {painel.data && aba === "licencas" && <LicencasTab usuarioId={user!.id} trs={trs} hoje={painel.data.hoje} onMudou={() => utils.rh.painel.invalidate()} />}
          {painel.data && aba === "salarios" && <SalariosTab usuarioId={user!.id} trs={ativos} mesActual={painel.data.mesActual} onMudou={() => utils.rh.painel.invalidate()} />}
          {aba === "vagas" && <VagasTrabalhoTab usuarioId={user!.id} />}
        </>
      )}
    </div>
  );
}

/* ============================================================ TRABALHADORES ============================================================ */
function TrabalhadoresTab({ trs, onMudou }: { trs: Trab[]; onMudou: () => void }) {
  const { user, toast } = useSession();
  const [form, setForm] = useState<Trab | "novo" | null>(null);
  const remover = trpc.rh.removerTrabalhador.useMutation({
    onSuccess: (r) => { toast(r.desactivado ? "📴 Trabalhador desactivado (tem registos)." : "🗑 Trabalhador removido."); onMudou(); },
    onError: (e) => toast("⚠️ " + msgErro(e)),
  });
  const reactivar = trpc.rh.reactivarTrabalhador.useMutation({
    onSuccess: () => { toast("✅ Trabalhador reactivado."); onMudou(); },
    onError: (e) => toast("⚠️ " + msgErro(e)),
  });

  return (
    <>
      <button className="c-btn c-btn-prim c-btn-bloco" onClick={() => setForm("novo")}>＋ Novo trabalhador</button>
      {trs.length === 0 && <Vazio icon="👥">Ainda sem trabalhadores registados.</Vazio>}
      {trs.map((t) => (
        <div className="c-card" key={t.id} style={{ padding: 10, opacity: t.ativo ? 1 : 0.65 }}>
          <div className="c-linha" style={{ alignItems: "flex-start" }}>
            <div className="grow">
              <div className="tit">{t.nome} <span className="det">· {t.codigo}</span></div>
              <div className="det">💼 {t.cargo} · 📅 entrou em {fmtD(t.dataInicio)} · pago no dia <b>{t.diaEntrada}</b></div>
              <div className="det">
                {t.regime === "Permanente" ? `💵 Salário: ${mt(t.salarioMensal)}/mês` : `🪙 Diária: ${mt(t.diaria)}/dia`}
                {t.regime === "Afiliado" && t.comissoesPendentes > 0 ? ` · 💸 comissões pendentes: ${mt(t.comissoesPendentes)}` : ""}
              </div>
              <div className="det">
                ✅ {t.mesesPagos.length} mês(es) pago(s)
                {t.mesesEmAtraso.length > 0 && <span style={{ color: "var(--vermelho-c)", fontWeight: 700 }}> · ⚠️ em atraso: {t.mesesEmAtraso.map(mesNome).join(", ")}</span>}
              </div>
              {t.licencas.some((l: Trab["licencas"][number]) => l.inicio <= new Date(Date.now() + 2 * 3600e3).toISOString().slice(0, 10) && l.fim >= new Date(Date.now() + 2 * 3600e3).toISOString().slice(0, 10)) && (
                <div className="det" style={{ color: "var(--roxo)" }}>🌴 De licença neste momento</div>
              )}
              {t.notas && <div className="det">📝 {t.notas}</div>}
            </div>
            <div style={{ textAlign: "right", display: "grid", gap: 4, justifyItems: "end" }}>
              <span className={`c-chip ${corRegime(t.regime)}`}>{t.regime}</span>
              <span className="c-chip c-chip-roxo">{t.area === "Ambas" ? "Rest. + Dec." : t.area}</span>
              {!t.ativo && <span className="c-chip c-chip-vermelho">Inactivo</span>}
            </div>
          </div>
          <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
            <button className="c-btn c-btn-linha c-btn-peq grow" onClick={() => setForm(t)}>✏️ Editar</button>
            <button className="c-btn c-btn-linha c-btn-peq grow" title="Gerar contrato em Word (A4), conforme a Lei do Trabalho de Moçambique"
              onClick={() => gerarContrato(t)}>📄 Contrato</button>
            {t.ativo ? (
              <button className="c-btn c-btn-cinza c-btn-peq" disabled={remover.isPending}
                onClick={() => window.confirm(`Remover/desactivar ${t.nome}?`) && remover.mutate({ usuarioId: user!.id, id: t.id })}>🗑</button>
            ) : (
              <button className="c-btn c-btn-verde c-btn-peq" disabled={reactivar.isPending}
                onClick={() => reactivar.mutate({ usuarioId: user!.id, id: t.id })}>♻️ Reactivar</button>
            )}
          </div>
        </div>
      ))}
      {form && user && <FormTrabalhador usuarioId={user.id} t={form === "novo" ? null : form} onClose={() => setForm(null)} onMudou={onMudou} />}
    </>
  );
}

function FormTrabalhador({ usuarioId, t, onClose, onMudou }: { usuarioId: number; t: Trab | null; onClose: () => void; onMudou: () => void }) {
  const { toast } = useSession();
  const afs = trpc.afiliados.listar.useQuery({ adminId: usuarioId });
  const [f, setF] = useState({
    nome: t?.nome ?? "", telefone: t?.telefone ?? "", biNumero: t?.biNumero ?? "",
    regime: (t?.regime ?? "Permanente") as (typeof REGIMES)[number],
    area: (t?.area ?? "Restaurante") as (typeof AREAS_RH)[number],
    cargo: t?.cargo ?? "", atividades: t?.atividades ?? "",
    dataInicio: t?.dataInicio ?? new Date(Date.now() + 2 * 3600e3).toISOString().slice(0, 10),
    salarioMensal: t?.salarioMensal ?? 0, diaria: t?.diaria ?? 500,
    afiliadoId: t?.afiliadoId ?? 0, notas: t?.notas ?? "",
  });
  const guardar = trpc.rh.guardarTrabalhador.useMutation({
    onSuccess: () => { toast("✅ Trabalhador guardado."); onMudou(); onClose(); },
    onError: (e) => toast("⚠️ " + msgErro(e)),
  });
  const ok = f.nome.trim().length >= 3 && f.cargo.trim().length >= 2 && /^\d{4}-\d{2}-\d{2}$/.test(f.dataInicio)
    && (f.regime !== "Permanente" || f.salarioMensal > 0);
  const afiliadosActivos = ((afs.data?.afiliados ?? []) as AfRow[]).filter((a) => ["Activo", "Experimental"].includes(a.status));

  return (
    <Modal onClose={onClose}>
      <h3>{t ? "✏️ Editar trabalhador" : "＋ Novo trabalhador"}</h3>
      <label className="c-label">Nome completo *</label>
      <input className="c-input" value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <div>
          <label className="c-label">Telefone</label>
          <input className="c-input" inputMode="tel" value={f.telefone} onChange={(e) => setF({ ...f, telefone: e.target.value })} placeholder="86…" />
        </div>
        <div>
          <label className="c-label">Nº do BI</label>
          <input className="c-input" value={f.biNumero} onChange={(e) => setF({ ...f, biNumero: e.target.value })} />
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <div>
          <label className="c-label">Regime de trabalho *</label>
          <select className="c-select" value={f.regime} onChange={(e) => setF({ ...f, regime: e.target.value as typeof f.regime })}>
            {REGIMES.map((r) => <option key={r}>{r}</option>)}
          </select>
        </div>
        <div>
          <label className="c-label">Área *</label>
          <select className="c-select" value={f.area} onChange={(e) => setF({ ...f, area: e.target.value as typeof f.area })}>
            {AREAS_RH.map((a) => <option key={a}>{a === "Ambas" ? "Ambas (Rest. + Dec.)" : a}</option>)}
          </select>
        </div>
      </div>
      {f.regime !== "Permanente" && (
        <div className="c-card" style={{ background: "#fff7e0", border: "1px solid #ecd27a", fontSize: 12.5, padding: 8 }}>
          🪙 Diária de eventual: <b>{mt(f.diaria || 500)} por dia</b> — igual na Decoração e no Restaurante (1 dia em cada área = {mt((f.diaria || 500) * 2)}).
        </div>
      )}
      <label className="c-label">Cargo / função *</label>
      <input className="c-input" value={f.cargo} onChange={(e) => setF({ ...f, cargo: e.target.value })} placeholder="Ex.: Cozinheiro, Decorador, Afiliado…" />
      <label className="c-label">Actividades que desempenha (entra no contrato)</label>
      <textarea className="c-input" rows={3} value={f.atividades} onChange={(e) => setF({ ...f, atividades: e.target.value })}
        placeholder="Ex.: preparação de pratos do menu e de eventos, higiene da cozinha…" />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <div>
          <label className="c-label">Data de início * (o salário cai neste dia)</label>
          <input className="c-input" type="date" required value={f.dataInicio} onChange={(e) => setF({ ...f, dataInicio: e.target.value })}
            style={!f.dataInicio ? { borderColor: "var(--vermelho-c)" } : undefined} />
        </div>
        <div>
          {f.regime === "Permanente" ? (
            <>
              <label className="c-label">Salário mensal (MZN) *</label>
              <MoneyInput value={f.salarioMensal} onChange={(v) => setF({ ...f, salarioMensal: v })} />
            </>
          ) : (
            <>
              <label className="c-label">Diária (MZN)</label>
              <MoneyInput value={f.diaria} onChange={(v) => setF({ ...f, diaria: v })} />
            </>
          )}
        </div>
      </div>
      {f.regime === "Afiliado" && (
        <>
          <label className="c-label">Ligar ao perfil de afiliado (para ver as comissões)</label>
          <select className="c-select" value={f.afiliadoId} onChange={(e) => setF({ ...f, afiliadoId: parseInt(e.target.value) })}>
            <option value={0}>— Sem ligação —</option>
            {afiliadosActivos.map((a) => <option key={a.id} value={a.id}>{a.nome} ({a.codigo})</option>)}
          </select>
        </>
      )}
      <label className="c-label">Notas internas</label>
      <input className="c-input" value={f.notas} onChange={(e) => setF({ ...f, notas: e.target.value })} />
      <button className="c-btn c-btn-prim c-btn-bloco" style={{ marginTop: 12 }} disabled={!ok || guardar.isPending}
        onClick={() => guardar.mutate({
          usuarioId, ...(t ? { id: t.id } : {}),
          nome: f.nome.trim(), telefone: f.telefone || undefined, biNumero: f.biNumero || undefined,
          regime: f.regime, area: f.area, cargo: f.cargo.trim(), atividades: f.atividades || undefined,
          dataInicio: f.dataInicio, salarioMensal: f.salarioMensal, diaria: f.diaria,
          afiliadoId: f.afiliadoId || null, notas: f.notas || undefined,
        })}>
        {guardar.isPending ? "A guardar…" : "💾 Guardar"}
      </button>
    </Modal>
  );
}

/* ============================================================ PRESENÇAS ============================================================ */
function PresencasTab({ usuarioId, trs, hoje, onMudou }: { usuarioId: number; trs: Trab[]; hoje: string; onMudou: () => void }) {
  const { toast } = useSession();
  const [dia, setDia] = useState(hoje);
  const existentes = trpc.rh.presencasDia.useQuery({ usuarioId, data: dia }, { enabled: !!dia });
  const [mapa, setMapa] = useState<Record<number, { status: "Presente" | "Ausente"; area: "Restaurante" | "Decoração"; just: string }>>({});

  useEffect(() => {
    const m: typeof mapa = {};
    for (const t of trs) {
      const ex = (existentes.data ?? []).find((p) => Number(p.trabalhadorId) === t.id);
      m[t.id] = ex
        ? { status: ex.status, area: ex.area, just: ex.justificativa ?? "" }
        : { status: "Presente", area: t.area === "Decoração" ? "Decoração" : "Restaurante", just: "" };
    }
    setMapa(m);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dia, existentes.data, trs.length]);

  const guardar = trpc.rh.registarPresencas.useMutation({
    onSuccess: (r) => { toast(`✅ ${r.n} presença(s) registada(s) em ${fmtD(dia)}.`); onMudou(); existentes.refetch(); },
    onError: (e) => toast("⚠️ " + msgErro(e)),
  });

  const nPres = Object.values(mapa).filter((m) => m.status === "Presente").length;
  const nAus = Object.values(mapa).filter((m) => m.status === "Ausente").length;

  return (
    <>
      <div className="c-card" style={{ padding: 10 }}>
        <div className="c-linha">
          <div className="grow">
            <label className="c-label" style={{ marginTop: 0 }}>Dia do registo</label>
            <input className="c-input" type="date" value={dia} onChange={(e) => setDia(e.target.value)} />
          </div>
          <div style={{ textAlign: "right", fontSize: 12.5 }}>
            <div>✅ {nPres} presente(s)</div>
            <div style={{ color: "var(--vermelho-c)" }}>❌ {nAus} ausente(s)</div>
          </div>
        </div>
      </div>
      {trs.length === 0 && <Vazio icon="👥">Registe primeiro os trabalhadores.</Vazio>}
      {trs.map((t) => {
        const m = mapa[t.id] ?? { status: "Presente" as const, area: "Restaurante" as const, just: "" };
        return (
          <div className="c-card" key={t.id} style={{ padding: 10 }}>
            <div className="c-linha" style={{ alignItems: "flex-start" }}>
              <div className="grow">
                <div className="tit">{t.nome}</div>
                <div className="det">{t.regime} · {t.cargo}</div>
              </div>
              <div style={{ display: "flex", gap: 5 }}>
                <button className={`c-btn c-btn-peq ${m.status === "Presente" ? "c-btn-verde" : "c-btn-cinza"}`}
                  onClick={() => setMapa({ ...mapa, [t.id]: { ...m, status: "Presente", just: "" } })}>✅ Presente</button>
                <button className={`c-btn c-btn-peq ${m.status === "Ausente" ? "c-btn-perigo" : "c-btn-cinza"}`}
                  onClick={() => setMapa({ ...mapa, [t.id]: { ...m, status: "Ausente" } })}>❌ Ausente</button>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: m.status === "Ausente" ? "110px 1fr" : "1fr", gap: 8, marginTop: 8 }}>
              <div>
                <label className="c-label" style={{ marginTop: 0 }}>Área de hoje</label>
                <select className="c-select" value={m.area}
                  onChange={(e) => setMapa({ ...mapa, [t.id]: { ...m, area: e.target.value as "Restaurante" | "Decoração" } })}>
                  <option>Restaurante</option>
                  <option>Decoração</option>
                </select>
              </div>
              {m.status === "Ausente" && (
                <div>
                  <label className="c-label" style={{ marginTop: 0 }}>Justificativa da ausência</label>
                  <input className="c-input" value={m.just} placeholder="Ex.: doença, assunto familiar…"
                    onChange={(e) => setMapa({ ...mapa, [t.id]: { ...m, just: e.target.value } })} />
                </div>
              )}
            </div>
          </div>
        );
      })}
      {trs.length > 0 && (
        <button className="c-btn c-btn-prim c-btn-bloco" disabled={guardar.isPending}
          onClick={() => guardar.mutate({
            usuarioId, data: dia,
            itens: trs.map((t) => {
              const m = mapa[t.id];
              return { trabalhadorId: t.id, status: m?.status ?? "Presente", area: m?.area ?? "Restaurante", justificativa: m?.just || undefined };
            }),
          })}>
          {guardar.isPending ? "A guardar…" : `💾 Guardar presenças de ${fmtD(dia)}`}
        </button>
      )}
    </>
  );
}

/* ============================================================ LICENÇAS ============================================================ */
function LicencasTab({ usuarioId, trs, hoje, onMudou }: { usuarioId: number; trs: Trab[]; hoje: string; onMudou: () => void }) {
  const { toast } = useSession();
  const [nova, setNova] = useState(false);
  const remover = trpc.rh.removerLicenca.useMutation({
    onSuccess: () => { toast("🗑 Licença removida."); onMudou(); },
    onError: (e) => toast("⚠️ " + msgErro(e)),
  });
  const todas = trs.flatMap((t) => t.licencas.map((l: Trab["licencas"][number]) => ({ ...l, nome: t.nome, regime: t.regime })))
    .sort((a, b) => (a.fim >= hoje ? 0 : 1) - (b.fim >= hoje ? 0 : 1) || a.inicio.localeCompare(b.inicio));

  return (
    <>
      <button className="c-btn c-btn-prim c-btn-bloco" onClick={() => setNova(true)}>＋ Registar licença</button>
      {todas.length === 0 && <Vazio icon="🌴">Sem licenças registadas.</Vazio>}
      {todas.map((l) => {
        const activa = l.inicio <= hoje && l.fim >= hoje;
        const futura = l.inicio > hoje;
        return (
          <div className="c-card" key={l.id} style={{ padding: 10 }}>
            <div className="c-linha" style={{ alignItems: "flex-start" }}>
              <div className="grow">
                <div className="tit">{l.nome}</div>
                <div className="det">🌴 <b>{l.tipo}</b> · {fmtD(l.inicio)} → {fmtD(l.fim)}</div>
                <div className="det">Motivo: {l.motivo}</div>
              </div>
              <div style={{ display: "grid", gap: 4, justifyItems: "end" }}>
                <span className={`c-chip ${activa ? "c-chip-roxo" : futura ? "c-chip-amarelo" : "c-chip-cinza"}`}>
                  {activa ? "Em curso" : futura ? "Marcada" : "Terminada"}
                </span>
                <button className="c-btn c-btn-cinza c-btn-peq" disabled={remover.isPending}
                  onClick={() => remover.mutate({ usuarioId, id: l.id })}>🗑</button>
              </div>
            </div>
          </div>
        );
      })}
      {nova && <FormLicenca usuarioId={usuarioId} trs={trs.filter((t) => t.ativo)} onClose={() => setNova(false)} onMudou={onMudou} />}
    </>
  );
}

function FormLicenca({ usuarioId, trs, onClose, onMudou }: { usuarioId: number; trs: Trab[]; onClose: () => void; onMudou: () => void }) {
  const { toast } = useSession();
  const hoje = new Date(Date.now() + 2 * 3600e3).toISOString().slice(0, 10);
  const [f, setF] = useState({ trabalhadorId: trs[0]?.id ?? 0, tipo: "Anual" as "Anual" | "Periódica" | "Doença" | "Outra", motivo: "", inicio: hoje, fim: hoje });
  const guardar = trpc.rh.guardarLicenca.useMutation({
    onSuccess: () => { toast("✅ Licença registada."); onMudou(); onClose(); },
    onError: (e) => toast("⚠️ " + msgErro(e)),
  });
  return (
    <Modal onClose={onClose}>
      <h3>🌴 Registar licença</h3>
      <label className="c-label">Trabalhador *</label>
      <select className="c-select" value={f.trabalhadorId} onChange={(e) => setF({ ...f, trabalhadorId: parseInt(e.target.value) })}>
        {trs.map((t) => <option key={t.id} value={t.id}>{t.nome} ({t.regime})</option>)}
      </select>
      <label className="c-label">Tipo de licença *</label>
      <select className="c-select" value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value as typeof f.tipo })}>
        <option>Anual</option><option>Periódica</option><option>Doença</option><option>Outra</option>
      </select>
      <label className="c-label">Motivo *</label>
      <input className="c-input" value={f.motivo} onChange={(e) => setF({ ...f, motivo: e.target.value })}
        placeholder="Ex.: férias anuais, assunto familiar, consulta médica…" />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <div>
          <label className="c-label">Início</label>
          <input className="c-input" type="date" value={f.inicio} onChange={(e) => setF({ ...f, inicio: e.target.value })} />
        </div>
        <div>
          <label className="c-label">Fim</label>
          <input className="c-input" type="date" value={f.fim} onChange={(e) => setF({ ...f, fim: e.target.value })} />
        </div>
      </div>
      <button className="c-btn c-btn-prim c-btn-bloco" style={{ marginTop: 12 }}
        disabled={f.motivo.trim().length < 2 || !f.trabalhadorId || guardar.isPending}
        onClick={() => guardar.mutate({ usuarioId, trabalhadorId: f.trabalhadorId, tipo: f.tipo, motivo: f.motivo.trim(), inicio: f.inicio, fim: f.fim })}>
        {guardar.isPending ? "A guardar…" : "💾 Guardar licença"}
      </button>
    </Modal>
  );
}

/* ============================================================ SALÁRIOS ============================================================ */
function SalariosTab({ usuarioId, trs, mesActual, onMudou }: { usuarioId: number; trs: Trab[]; mesActual: string; onMudou: () => void }) {
  const { toast } = useSession();
  const [mes, setMes] = useState(mesActual);
  const rel = trpc.rh.relatorioMes.useQuery({ usuarioId, mes });
  const [pagar, setPagar] = useState<Rel["linhas"][number] | null>(null);
  const [verHist, setVerHist] = useState(0);

  useEffect(() => { setMes(mesActual); }, [mesActual]);

  return (
    <>
      <div className="c-card" style={{ padding: 10 }}>
        <div className="c-linha" style={{ alignItems: "flex-end" }}>
          <div className="grow">
            <label className="c-label" style={{ marginTop: 0 }}>Mês de referência</label>
            <input className="c-input" type="month" value={mes} onChange={(e) => setMes(e.target.value)} />
          </div>
          {rel.data && (
            <div style={{ display: "flex", gap: 6 }}>
              <button className="c-btn c-btn-linha c-btn-peq" title="Baixar o relatório em Word (A4)"
                onClick={() => baixarRelatorioWord(rel.data)}>⬇️ Word</button>
              <button className="c-btn c-btn-prim c-btn-peq" title="Imprimir o relatório em folha A4"
                onClick={() => imprimirRelatorioA4(rel.data)}>🖨 A4</button>
            </div>
          )}
        </div>
      </div>

      {rel.isLoading && <Vazio icon="⏳">A calcular…</Vazio>}
      {rel.data?.linhas.map((l) => (
        <div className="c-card" key={l.id} style={{ padding: 10 }}>
          <div className="c-linha" style={{ alignItems: "flex-start" }}>
            <div className="grow">
              <div className="tit">{l.nome} <span className="det">· {l.regime} · {l.area === "Ambas" ? "Rest.+Dec." : l.area}</span></div>
              <div className="det">
                {l.regime === "Permanente"
                  ? `💵 Salário: ${mt(l.salarioMensal)}`
                  : `🪙 ${l.diasPresentes} dia(s) × ${mt(l.diaria)} (Rest.: ${l.diasRestaurante} · Dec.: ${l.diasDecoracao})`}
              </div>
              <div className="det">
                {l.diasAusentes > 0 && <span>❌ {l.diasAusentes} ausência(s) ({l.ausenciasJustificadas} justificada(s)) · </span>}
                {l.assiduidade != null && <span>📈 assiduidade {l.assiduidade}% · </span>}
                {l.licencas.length > 0 && <span>🌴 {l.licencas.length} licença(s)</span>}
              </div>
              {l.valorDevido > 0 && (
                <div style={{ marginTop: 6, background: "#eee7f7", borderRadius: 8, height: 8, overflow: "hidden" }}
                  title={`Pago ${Math.min(100, Math.round((l.valorPago / l.valorDevido) * 100))}% do salário deste mês`}>
                  <div style={{
                    height: "100%", borderRadius: 8, transition: "width .3s",
                    width: `${Math.min(100, Math.round((l.valorPago / l.valorDevido) * 100))}%`,
                    background: l.saldo > 0 ? "var(--amarelo-c)" : "var(--verde-c)",
                  }} />
                </div>
              )}
              {verHist === l.id && (
                <div className="det" style={{ marginTop: 6 }}>
                  <ParcelasSalario usuarioId={usuarioId} trabalhadorId={l.id} mes={mes} onMudou={() => { onMudou(); rel.refetch(); }} />
                  <div style={{ marginTop: 6 }}>
                    <HistSalario usuarioId={usuarioId} trabalhadorId={l.id} mes={mes} />
                  </div>
                </div>
              )}
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 12 }}>Devido: <b>{mt(l.valorDevido)}</b></div>
              <div style={{ fontSize: 12 }}>Pago: <b style={{ color: "var(--verde-c)" }}>{mt(l.valorPago)}</b></div>
              <div style={{ fontSize: 14, fontWeight: 900, color: l.saldo > 0 ? "var(--vermelho-c)" : "var(--verde-c)" }}>
                {l.saldo > 0 ? `Falta ${mt(l.saldo)}` : "✅ Pago"}
              </div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
            <button className="c-btn c-btn-verde c-btn-peq grow" disabled={l.valorDevido <= 0 && l.valorPago > 0}
              onClick={() => setPagar(l)}>💵 Registar pagamento</button>
            <button className="c-btn c-btn-linha c-btn-peq" onClick={() => setVerHist(verHist === l.id ? 0 : l.id)}>
              {verHist === l.id ? "Esconder" : "🧾 Histórico"}
            </button>
          </div>
        </div>
      ))}
      {pagar && (
        <PagarSalarioModal usuarioId={usuarioId} l={pagar} mes={mes} onClose={() => setPagar(null)}
          onMudou={() => { onMudou(); rel.refetch(); }} />
      )}
    </>
  );
}

/* Parcelas e adiantamentos lançados no mês de referência — com anulação de enganos */
function ParcelasSalario({ usuarioId, trabalhadorId, mes, onMudou }: {
  usuarioId: number; trabalhadorId: number; mes: string; onMudou: () => void;
}) {
  const { toast } = useSession();
  const q = trpc.rh.parcelasMes.useQuery({ usuarioId, trabalhadorId, mes });
  const anular = trpc.rh.anularPagamentoSalario.useMutation({
    onSuccess: () => { toast("↩️ Parcela anulada — o valor saiu do «pago» do mês."); onMudou(); },
    onError: (e) => toast("⚠️ " + msgErro(e)),
  });
  const rows = q.data ?? [];
  if (q.isLoading) return <p className="c-sub" style={{ fontSize: 12 }}>A carregar parcelas…</p>;
  if (rows.length === 0) return <p className="c-sub" style={{ fontSize: 12 }}>Sem pagamentos lançados neste mês de referência.</p>;
  return (
    <div style={{ display: "grid", gap: 4 }}>
      <b style={{ fontSize: 12 }}>Pagamentos de {mesNome(mes)} ({rows.length}):</b>
      {rows.map((r) => (
        <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 8px", borderRadius: 8, background: "rgba(0,0,0,.03)", fontSize: 12 }}>
          <span title={r.tipo === "Adiantamento" ? "Adiantamento (antes do dia do salário)" : "Pagamento / parcela"}>
            {r.tipo === "Adiantamento" ? "💸" : "💼"}
          </span>
          <span className="c-sub" style={{ minWidth: 74 }}>{fmtD(String(r.pagoEm).slice(0, 10))}</span>
          <b style={{ minWidth: 70 }}>{mt(r.valor)}</b>
          <span className="c-sub" style={{ flex: 1, minWidth: 0 }}>
            {r.tipo}{r.metodo ? ` · ${r.metodo}` : ""}{r.pagoPor ? ` · por ${r.pagoPor}` : ""}{r.obs ? ` · ${r.obs}` : ""}
          </span>
          <button className="c-btn c-btn-perigo c-btn-peq" style={{ padding: "1px 8px", fontSize: 11 }}
            title="Anular este lançamento (foi registado por engano)"
            disabled={anular.isPending}
            onClick={() => { if (confirm(`Anular ${r.tipo === "Adiantamento" ? "o adiantamento" : "a parcela"} de ${mt(r.valor)} de ${mesNome(mes)}?`)) anular.mutate({ usuarioId, id: r.id }); }}>
            ↩️
          </button>
        </div>
      ))}
    </div>
  );
}

function HistSalario({ usuarioId, trabalhadorId, mes }: { usuarioId: number; trabalhadorId: number; mes: string }) {
  const painel = trpc.rh.painel.useQuery({ usuarioId });
  const t = (painel.data?.trabalhadores ?? []).find((x) => x.id === trabalhadorId);
  if (!t) return null;
  return (
    <>
      <b>Meses pagos:</b> {t.mesesPagos.length > 0 ? t.mesesPagos.map(mesNome).join(", ") : "nenhum ainda"}
      {t.mesesEmAtraso.length > 0 && (
        <div style={{ color: "var(--vermelho-c)", fontWeight: 700 }}>Em atraso: {t.mesesEmAtraso.map(mesNome).join(", ")}</div>
      )}
      <div style={{ marginTop: 2, opacity: 0.75 }}>(a consultar o mês: {mesNome(mes)})</div>
    </>
  );
}

function PagarSalarioModal({ usuarioId, l, mes, onClose, onMudou }: {
  usuarioId: number; l: Rel["linhas"][number]; mes: string; onClose: () => void; onMudou: () => void;
}) {
  const { toast } = useSession();
  const [tipo, setTipo] = useState<"Pagamento" | "Adiantamento">("Pagamento");
  const [mesRef, setMesRef] = useState(mes);
  const [valor, setValor] = useState(l.saldo > 0 ? l.saldo : l.valorDevido);
  const [metodo, setMetodo] = useState<string>(METODOS_PAGAMENTO[0]);
  const [obs, setObs] = useState("");
  // se o mês de referência for o mesmo que está no ecrã, mostramos o remanescente real depois deste registo
  const faltaDepois = mesRef === mes ? Math.max(0, l.saldo - valor) : null;
  const pagar = trpc.rh.pagarSalario.useMutation({
    onSuccess: () => { toast(`✅ ${tipo === "Adiantamento" ? "Adiantamento" : "Pagamento"} de ${mt(valor)} registado (${mesNome(mesRef)}).`); onMudou(); onClose(); },
    onError: (e) => toast("⚠️ " + msgErro(e)),
  });
  return (
    <Modal onClose={onClose}>
      <h3>💵 Pagamento — {l.nome}</h3>
      <p className="c-sub">{l.cargo} · {l.regime}</p>

      <label className="c-label">Tipo de lançamento</label>
      <div className="c-pag-grelha">
        <button type="button" className={tipo === "Pagamento" ? "sel" : ""} onClick={() => setTipo("Pagamento")}>
          💼 Pagamento / parcela
        </button>
        <button type="button" className={tipo === "Adiantamento" ? "sel" : ""} onClick={() => setTipo("Adiantamento")}>
          💸 Adiantamento
        </button>
      </div>
      <p className="c-sub" style={{ marginTop: 2 }}>
        {tipo === "Adiantamento"
          ? "O funcionário recebe uma parte do salário ANTES do dia do pagamento. O valor abate no salário do mês de referência escolhido abaixo."
          : "Pagamento normal ou parcela do salário — pague em quantas vezes for preciso, até completar o valor devido."}
      </p>

      <label className="c-label">Mês de referência (a que salário se refere)</label>
      <input className="c-input" type="month" value={mesRef} onChange={(e) => setMesRef(e.target.value || mes)} />

      <div className="c-card" style={{ background: "#f7f7fb", fontSize: 13, padding: 8, marginTop: 8 }}>
        Devido ({mesNome(mes)}): <b>{mt(l.valorDevido)}</b> · já pago: <b style={{ color: "var(--verde-c)" }}>{mt(l.valorPago)}</b> · em falta: <b style={{ color: "var(--vermelho-c)" }}>{mt(l.saldo)}</b>
        {faltaDepois != null && (
          <div style={{ marginTop: 4, fontWeight: 800, color: faltaDepois > 0 ? "var(--amarelo-c)" : "var(--verde-c)" }}>
            {faltaDepois > 0
              ? `Depois deste registo ficam a faltar ${mt(faltaDepois)}`
              : "✅ Com este registo o mês fica liquidado"}
          </div>
        )}
      </div>

      <label className="c-label">Valor a entregar agora (MZN) *</label>
      <MoneyInput value={valor} onChange={setValor} />
      {valor > l.saldo && mesRef === mes && l.saldo > 0 && (
        <p style={{ color: "var(--vermelho-c)", fontSize: 12, margin: "4px 0" }}>
          ⚠️ O valor excede o que falta pagar deste mês ({mt(l.saldo)}). Confirme se é mesmo este o valor.
        </p>
      )}
      <label className="c-label">Método</label>
      <select className="c-select" value={metodo} onChange={(e) => setMetodo(e.target.value)}>
        {METODOS_PAGAMENTO.map((m) => <option key={m}>{m}</option>)}
      </select>
      <label className="c-label">Observação</label>
      <input className="c-input" value={obs} onChange={(e) => setObs(e.target.value)}
        placeholder={tipo === "Adiantamento" ? "Ex.: adiantamento pedido para despesa familiar…" : "Ex.: 1.ª parcela, acerto…"} />
      <button className="c-btn c-btn-verde c-btn-bloco" style={{ marginTop: 12 }} disabled={valor <= 0 || !mesRef || pagar.isPending}
        onClick={() => pagar.mutate({ usuarioId, trabalhadorId: l.id, mesReferencia: mesRef, valor, tipo, metodo, obs: obs || undefined })}>
        {pagar.isPending ? "A registar…" : tipo === "Adiantamento" ? `💸 Registar adiantamento de ${mt(valor)}` : `✅ Registar ${mt(valor)}`}
      </button>
    </Modal>
  );
}


/* ============================================================ VAGAS DE TRABALHO EVENTUAL PARA AFILIADOS ============================================================ */
const AREAS_VAGA = ["Restaurante", "Decoração", "Catering", "Apoio em eventos"] as const;

function VagasTrabalhoTab({ usuarioId }: { usuarioId: number }) {
  const { toast } = useSession();
  const utils = trpc.useUtils();
  const lista = trpc.trabalhoVagas.listar.useQuery({ usuarioId }, { refetchInterval: 20_000 });
  const [editar, setEditar] = useState<VgRow | null>(null);
  const [nova, setNova] = useState(false);

  const setStatus = trpc.trabalhoVagas.setStatus.useMutation({
    onSuccess: () => { toast("✅ Estado actualizado."); utils.trabalhoVagas.listar.invalidate(); },
    onError: (e) => toast("⚠️ " + msgErro(e)),
  });
  const remover = trpc.trabalhoVagas.remover.useMutation({
    onSuccess: () => { toast("🗑 Vaga removida."); utils.trabalhoVagas.listar.invalidate(); },
    onError: (e) => toast("⚠️ " + msgErro(e)),
  });

  const vagas = (lista.data ?? []) as VgRow[];
  const corStatus = (v: VgRow) =>
    v.status === "Cancelada" ? "cinza" : v.status === "Concluída" ? "roxo"
    : v.status === "Preenchida" || v.aceites >= v.vagas ? "verde" : v.expirada ? "cinza" : "roxo";

  return (
    <div>
      <button className="c-btn c-btn-prim c-btn-bloco" onClick={() => setNova(true)}>
        📢 Lançar oportunidade de trabalho eventual
      </button>
      <p className="c-sub" style={{ fontSize: 12, marginTop: 6 }}>
        A oportunidade chega ao aplicativo dos afiliados que escolher. Ficam com ela os <b>primeiros a aceitar</b> até encher as vagas. Se definir data/hora limite, a vaga <b>some da página de quem não respondeu</b> quando o prazo terminar.
      </p>
      {lista.isLoading && <Vazio icon="⏳">A carregar…</Vazio>}
      {!lista.isLoading && vagas.length === 0 && <Vazio icon="📢">Ainda não lançou nenhuma oportunidade.</Vazio>}
      {vagas.map((v) => (
        <div key={v.id} className="c-card" style={{ marginTop: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <b>{v.codigo} · {v.area}</b>
            <span className={`c-chip c-chip-${corStatus(v)}`}>
              {v.status === "Aberta" && v.expirada ? "Prazo terminado" : v.status === "Aberta" && v.aceites >= v.vagas ? "Preenchida" : v.status}
            </span>
          </div>
          <div className="det" style={{ marginTop: 4 }}>
            📅 <b>{fmtD(v.dataTrabalho)}</b>{v.horaInicio ? ` às ${v.horaInicio}` : ""} · 👥 <b>{v.aceites}/{v.vagas}</b> aceites · 💵 diária {mt(v.diaria)}
            {v.limiteAceite ? <> · ⏳ aceitar até <b style={{ color: v.expirada ? "var(--vermelho-c)" : "inherit" }}>{fmtD(v.limiteAceite.slice(0, 10))} {v.limiteAceite.slice(11)}</b></> : <> · ⏳ sem prazo limite</>}
          </div>
          {v.descricao && <div className="det">📋 {v.descricao}</div>}
          <div style={{ marginTop: 6, fontSize: 12.5 }}>
            {(v.destinos ?? []).map((d) => (
              <span key={d.id} className={`c-chip ${d.estado === "Aceite" ? "c-chip-verde" : d.estado === "Recusado" ? "c-chip-vermelho" : "c-chip-cinza"}`} style={{ marginRight: 4, marginTop: 4 }}>
                {d.estado === "Aceite" ? "✅ " : d.estado === "Recusado" ? "✕ " : "⏳ "}{d.nome}
              </span>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
            {(v.status === "Aberta" || v.status === "Preenchida") && (
              <button className="c-btn c-btn-linha c-btn-peq" onClick={() => setEditar(v)}>✏️ Editar / destinatários</button>
            )}
            {v.status === "Preenchida" && (
              <button className="c-btn c-btn-verde c-btn-peq" onClick={() => setStatus.mutate({ usuarioId, id: v.id, status: "Concluída" })}>🏁 Trabalho realizado</button>
            )}
            {(v.status === "Aberta" || v.status === "Preenchida") && (
              <button className="c-btn c-btn-cinza c-btn-peq" onClick={() => setStatus.mutate({ usuarioId, id: v.id, status: "Cancelada" })}>✕ Cancelar</button>
            )}
            <button className="c-btn c-btn-perigo c-btn-peq" onClick={() => { if (confirm(`ELIMINAR a oportunidade ${v.codigo}?`)) remover.mutate({ usuarioId, id: v.id }); }}>🗑</button>
          </div>
        </div>
      ))}
      {(nova || editar) && (
        <FormVagaTrabalho usuarioId={usuarioId} v={editar} onClose={() => { setNova(false); setEditar(null); }} />
      )}
    </div>
  );
}

function FormVagaTrabalho({ usuarioId, v, onClose }: { usuarioId: number; v: VgRow | null; onClose: () => void }) {
  const { toast } = useSession();
  const utils = trpc.useUtils();
  const afs = trpc.afiliados.listar.useQuery({ adminId: usuarioId });
  const afiliadosActivos = ((afs.data?.afiliados ?? []) as AfRow[]).filter((a) => ["Activo", "Experimental"].includes(a.status));
  const hoje = new Date(Date.now() + 2 * 3600e3).toISOString().slice(0, 10);
  const [f, setF] = useState({
    dataTrabalho: v?.dataTrabalho ?? hoje,
    horaInicio: v?.horaInicio ?? "",
    area: (v?.area ?? "Restaurante") as (typeof AREAS_VAGA)[number],
    descricao: v?.descricao ?? "",
    vagas: v?.vagas ?? 1,
    diaria: v?.diaria ?? 500,
    limiteData: v?.limiteAceite ? v.limiteAceite.slice(0, 10) : "",
    limiteHora: v?.limiteAceite ? v.limiteAceite.slice(11, 16) : "",
  });
  const [sel, setSel] = useState<number[]>(() => (v?.destinos ?? []).map((d) => d.afiliadoId));

  const guardar = trpc.trabalhoVagas.guardar.useMutation({
    onSuccess: () => { toast(v ? "✅ Oportunidade actualizada." : "📢 Oportunidade lançada — os afiliados escolhidos já a veem no aplicativo!"); utils.trabalhoVagas.listar.invalidate(); onClose(); },
    onError: (e) => toast("⚠️ " + msgErro(e)),
  });

  const limiteOk = !f.limiteData || (!!f.limiteHora && f.limiteData <= f.dataTrabalho);
  const ok = /^\d{4}-\d{2}-\d{2}$/.test(f.dataTrabalho) && f.vagas >= 1 && sel.length >= 1 && limiteOk;
  const toggle = (id: number) => setSel((cur) => cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);

  return (
    <Modal onClose={onClose}>
      <h3>{v ? `✏️ Editar ${v.codigo}` : "📢 Nova oportunidade de trabalho eventual"}</h3>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <div>
          <label className="c-label">Data do trabalho *</label>
          <input className="c-input" type="date" min={hoje} value={f.dataTrabalho} onChange={(e) => setF({ ...f, dataTrabalho: e.target.value })} />
        </div>
        <div>
          <label className="c-label">Hora de início</label>
          <input className="c-input" type="time" value={f.horaInicio} onChange={(e) => setF({ ...f, horaInicio: e.target.value })} />
        </div>
      </div>
      <label className="c-label">Área de trabalho *</label>
      <select className="c-select" value={f.area} onChange={(e) => setF({ ...f, area: e.target.value as typeof f.area })}>
        {AREAS_VAGA.map((a) => <option key={a}>{a}</option>)}
      </select>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <div>
          <label className="c-label">Nº de vagas * <span className="c-sub">(primeiros a aceitar)</span></label>
          <input className="c-input" type="number" min={1} max={100} value={f.vagas || ""} onChange={(e) => setF({ ...f, vagas: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} />
        </div>
        <div>
          <label className="c-label">Diária (MZN)</label>
          <MoneyInput value={f.diaria} onChange={(n) => setF({ ...f, diaria: n })} />
        </div>
      </div>
      <label className="c-label">Descrição (opcional)</label>
      <input className="c-input" value={f.descricao} onChange={(e) => setF({ ...f, descricao: e.target.value })} placeholder="Ex.: reforço para casamento de 200 pessoas" />
      <label className="c-label">⏳ Limite para aceitar (opcional) — passado o prazo a vaga some para quem não respondeu</label>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <input className="c-input" type="date" max={f.dataTrabalho} value={f.limiteData} onChange={(e) => setF({ ...f, limiteData: e.target.value })} />
        <input className="c-input" type="time" value={f.limiteHora} onChange={(e) => setF({ ...f, limiteHora: e.target.value })} />
      </div>
      {f.limiteData && !f.limiteHora && <p style={{ color: "var(--vermelho-c)", fontSize: 12 }}>⚠️ Indique também a hora limite (ou limpe a data).</p>}
      <label className="c-label">👥 Quem recebe a notificação * ({sel.length} seleccionado{sel.length === 1 ? "" : "s"})</label>
      <div style={{ maxHeight: 200, overflow: "auto", border: "1px solid #e3d9f5", borderRadius: 10, padding: 6 }}>
        {afiliadosActivos.length === 0 && <p className="c-sub" style={{ fontSize: 12 }}>Nenhum afiliado activo.</p>}
        {afiliadosActivos.map((a) => (
          <label key={a.id} style={{ display: "flex", gap: 8, alignItems: "center", padding: "5px 4px", fontSize: 14, cursor: "pointer", borderBottom: "1px solid #f3eefb" }}>
            <input type="checkbox" checked={sel.includes(a.id)} onChange={() => toggle(a.id)} style={{ width: 18, height: 18 }} />
            <span>{a.nome} <span className="c-sub">({a.codigo})</span></span>
          </label>
        ))}
      </div>
      {sel.length > 0 && f.vagas < sel.length && (
        <p className="c-sub" style={{ fontSize: 12, marginTop: 4 }}>
          ⚡ {sel.length} afiliados vão disputar <b>{f.vagas}</b> vaga{f.vagas === 1 ? "" : "s"} — ficam os primeiros a aceitar.
        </p>
      )}
      <button className="c-btn c-btn-prim c-btn-bloco" style={{ marginTop: 12 }} disabled={!ok || guardar.isPending}
        onClick={() => guardar.mutate({
          usuarioId,
          ...(v ? { id: v.id } : {}),
          dataTrabalho: f.dataTrabalho,
          horaInicio: f.horaInicio || null,
          area: f.area,
          descricao: f.descricao.trim() || undefined,
          vagas: f.vagas,
          diaria: f.diaria,
          limiteAceite: f.limiteData && f.limiteHora ? `${f.limiteData} ${f.limiteHora}` : null,
          destinatarios: sel,
        })}>
        {guardar.isPending ? "A guardar…" : v ? "💾 Guardar alterações" : "📢 Lançar e notificar os afiliados"}
      </button>
    </Modal>
  );
}
