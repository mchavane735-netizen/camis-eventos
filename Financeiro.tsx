import { useRef, useState } from "react";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import { trpc } from "@/providers/trpc";
import { useSession } from "@/lib/session";
import { mt, fmt, hoje, diaBR } from "@/lib/fmt";
import { useEmpresa } from "@/lib/empresa";
import { Stat, Vazio, Voltar } from "@/components/bits";
import { printDoc } from "@/lib/docprint";

export default function Financeiro({ voltar }: { voltar: () => void }) {
  const { user } = useSession();
  const emp = useEmpresa();
  const [dia, setDia] = useState(hoje());

  const q = trpc.financeiro.dia.useQuery(
    { usuarioId: user?.id ?? 0, data: dia },
    { enabled: !!user, refetchInterval: 30000 },
  );
  const sem = trpc.financeiro.semana.useQuery(
    { usuarioId: user?.id ?? 0 },
    { enabled: !!user, refetchInterval: 60000 },
  );
  const r = q.data;

  const imprimir = () => {
    if (!r) return;
    const linha = (a: string, b: string, bold = false) =>
      `<div class="r"${bold ? ' style="font-weight:700"' : ""}><span>${a}</span><span>${b}</span></div>`;
    const body = `
      <img class="logo" src="/icons/logo.png" alt="" />
      <div class="c nome">${emp.nome}</div>
      <div class="c slogan">${emp.slogan}</div>
      <div class="c small">NUIT ${emp.nuit} · ${emp.local}</div>
      <div class="c titulo">RELATÓRIO FINANCEIRO DIÁRIO</div>
      <div class="c"><b>${diaBR(r.data)}</b></div>
      <div class="sep"></div>
      <div class="c"><b>RECEITA DO DIA (DISCRIMINADA)</b></div>
      ${linha("🍽️ Refeições", fmt(r.grupos.refeicoes) + " MZN")}
      ${linha("🥤 Bebidas", fmt(r.grupos.bebidas) + " MZN")}
      ${linha("🏊 Piscina", fmt(r.grupos.piscina) + " MZN")}
      ${linha("🛝 Parque Infantil", fmt(r.grupos.parque) + " MZN")}
      ${r.grupos.servicos > 0 ? linha("🛎️ Outros serviços", fmt(r.grupos.servicos) + " MZN") : ""}
      ${linha("📱 Loja Online", fmt(r.grupos.lojaOnline) + " MZN")}
      ${linha("📅 Adiantamento de Reservas — Consumo local", fmt(r.grupos.adiantLocal) + " MZN")}
      ${linha("🎉 Adiantamento de Reservas — Eventos", fmt(r.grupos.adiantEventos) + " MZN")}
      ${r.fontes.braai > 0 ? linha("🔥 Braai (taxa de uso do espaço — não consumível)", fmt(r.fontes.braai) + " MZN") : ""}
      ${r.fontes.dividas > 0 ? linha("🧾 Dívidas liquidadas (fiado cobrado)", fmt(r.fontes.dividas) + " MZN") : ""}
      ${r.fontes.gerencia > 0 ? linha("👔 Conta Gerência (paga)", fmt(r.fontes.gerencia) + " MZN") : ""}
      ${r.grupos.agente > 0 ? linha("🏧 Comissões Agente recebidas (eMola/M-Pesa)", fmt(r.grupos.agente) + " MZN") : ""}
      <div class="r tot"><span>RECEITA TOTAL DO DIA</span><span>${fmt(r.receitaTotal)} MZN</span></div>
      ${r.adiantDeduzidoHoje > 0 ? `<div class="c small">(deste dia, ${fmt(r.adiantDeduzidoHoje)} MZN de consumo já tinham sido pagos por adiantamento)</div>` : ""}
      <div class="sep"></div>
      <div class="c"><b>RECEITA POR CATEGORIA</b></div>
      ${r.porCategoria.map((c) => linha(`${c.categoria} (${c.qtd})`, fmt(c.total) + " MZN")).join("") || '<div class="c small">sem vendas</div>'}
      <div class="sep"></div>
      <div class="c"><b>RECEITA POR MÉTODO DE PAGAMENTO</b></div>
      ${r.porMetodo.map((m) => linha(m.metodo, fmt(m.total) + " MZN")).join("") || '<div class="c small">sem receitas</div>'}
      <div class="sep"></div>
      <div class="c"><b>RESUMO POR FORMA DE RECEBIMENTO</b></div>
      <div class="c small">(quanto entrou em cada canal: caixa, contas móveis, banco...)</div>
      ${r.porRecebimento.map((c) => linha(c.classe, fmt(c.total) + " MZN")).join("") || '<div class="c small">sem receitas</div>'}
      ${r.troco.total > 0 ? `
      <div class="sep"></div>
      <div class="c"><b>TROCO ENTREGUE — CIRCULAÇÃO DO DINHEIRO</b></div>
      <div class="c small">(como o troco foi entregue aos clientes: físico vs. contas)</div>
      ${r.troco.porForma.map((t) => linha(t.forma, fmt(t.total) + " MZN")).join("")}
      <div class="r tot"><span>TROCO TOTAL DO DIA</span><span>${fmt(r.troco.total)} MZN</span></div>` : ""}
      ${r.agente.n > 0 || r.agente.movimentosHoje > 0 || (r.agente.totais && (r.agente.totais.totalLevEmola + r.agente.totais.totalLevMpesa + r.agente.totais.depEmola + r.agente.totais.depMpesa) > 0) ? `
      <div class="sep"></div>
      <div class="c"><b>🏧 AGENTE eMola / M-Pesa</b></div>
      ${r.agente.totais && (r.agente.totais.depEmola > 0 || r.agente.totais.depMpesa > 0) ? `
      ${r.agente.totais.depEmola > 0 ? linha("Depósitos eMola (nº " + r.agente.totais.nDepEmola + ")", fmt(r.agente.totais.depEmola) + " MZN") : ""}
      ${r.agente.totais.depMpesa > 0 ? linha("Depósitos M-Pesa (nº " + r.agente.totais.nDepMpesa + ")", fmt(r.agente.totais.depMpesa) + " MZN") : ""}` : ""}
      ${r.agente.totais && (r.agente.totais.totalLevEmola > 0 || r.agente.totais.totalLevMpesa > 0) ? `
      ${r.agente.totais.levPagEmola > 0 ? linha("· Pagamentos de vendas via Lev. eMola", fmt(r.agente.totais.levPagEmola) + " MZN") : ""}
      ${r.agente.totais.levExclEmola > 0 ? linha("· Lev. exclusivos eMola — uso pessoal (nº " + r.agente.totais.nLevEmola + ")", fmt(r.agente.totais.levExclEmola) + " MZN") : ""}
      ${r.agente.totais.totalLevEmola > 0 ? `<div class="r tot"><span>TOTAL LEVANTAMENTOS eMola</span><span>${fmt(r.agente.totais.totalLevEmola)} MZN</span></div>` : ""}
      ${(r.agente.totais.trocoDepEmola ?? 0) > 0 ? linha("· (−) Troco entregue via Depósito eMola", "− " + fmt(r.agente.totais.trocoDepEmola) + " MZN") : ""}
      ${r.agente.totais.levPagMpesa > 0 ? linha("· Pagamentos de vendas via Lev. M-Pesa", fmt(r.agente.totais.levPagMpesa) + " MZN") : ""}
      ${r.agente.totais.levExclMpesa > 0 ? linha("· Lev. exclusivos M-Pesa — uso pessoal (nº " + r.agente.totais.nLevMpesa + ")", fmt(r.agente.totais.levExclMpesa) + " MZN") : ""}
      ${(r.agente.totais.trocoDepMpesa ?? 0) > 0 ? linha("· (−) Troco entregue via Depósito M-Pesa", "− " + fmt(r.agente.totais.trocoDepMpesa) + " MZN") : ""}
      ${r.agente.totais.totalLevMpesa > 0 ? `<div class="r tot"><span>TOTAL LEVANTAMENTOS M-Pesa</span><span>${fmt(r.agente.totais.totalLevMpesa)} MZN</span></div>` : ""}` : ""}
      ${r.agente.movimentosHoje > 0 ? `
      ${linha("Movimentos de clientes hoje (nº)", String(r.agente.movimentosHoje))}
      ${linha("Valor movimentado hoje", fmt(r.agente.valorHoje) + " MZN")}
      ${linha("Comissões do dia — A RECEBER", fmt(r.agente.aReceberHoje) + " MZN")}` : ""}
      ${r.agente.n > 0 ? `
      ${r.agente.emola > 0 ? linha("Comissão eMola (recebida)", fmt(r.agente.emola) + " MZN") : ""}
      ${r.agente.mpesa > 0 ? linha("Comissão M-Pesa (recebida)", fmt(r.agente.mpesa) + " MZN") : ""}
      <div class="r tot"><span>COMISSÕES RECEBIDAS HOJE</span><span>${fmt(r.agente.comissao)} MZN</span></div>` : ""}
      ${linha("Total a receber das operadoras", fmt(r.agente.aReceberTotal) + " MZN")}` : ""}
      <div class="sep"></div>
      <div class="c"><b>DESPESAS DO DIA</b></div>
      <div class="c small">(NÃO descontadas da receita — usamos valor guardado para a compra de mercadorias)</div>
      ${linha("Custos fixos", fmt(r.despesas.fixo) + " MZN")}
      ${linha("Custos variáveis", fmt(r.despesas.variavel) + " MZN")}
      ${linha("Já pago aos fornecedores", fmt(r.despesas.pago) + " MZN")}
      ${linha("Em dívida (crédito/parcelas)", fmt(r.despesas.emDivida) + " MZN", r.despesas.emDivida > 0)}
      ${r.despesas.porCategoria.map((c) => linha("· " + c.categoria, fmt(c.total) + " MZN")).join("") || '<div class="c small">sem despesas lançadas</div>'}
      ${linha("· Total Afiliados (comissões)", fmt(r.grupos.totalAfiliados) + " MZN")}
      <div class="r tot"><span>DESPESAS DO DIA (TOTAL)</span><span>${fmt(r.despesas.total)} MZN</span></div>
      <div class="sep"></div>
      <div class="c"><b>ANÁLISE DE RENTABILIDADE (PREVISÃO)</b></div>
      ${r.analise.semCustoRegistado ? '<div class="c small">⚠️ Preços de compra ainda não preenchidos — previsão aproximada.</div>' : ""}
      ${linha("CMV — custo da mercadoria vendida", fmt(r.analise.cmv) + " MZN")}
      ${linha("Margem bruta (" + fmt(r.analise.margemPct) + "%)", fmt(r.analise.margemBruta) + " MZN", true)}
      ${linha("EBITDA previsto (" + fmt(r.analise.ebitdaPct) + "%)", fmt(r.analise.ebitda) + " MZN", true)}
      ${linha("IVA estimado (16%)", fmt(r.analise.iva) + " MZN")}
      <div class="sep"></div>
      ${linha("Vendas (nº)", String(r.nVendas))}
      ${linha("Ticket médio", fmt(r.ticketMedio) + " MZN")}
      <div class="sep"></div>
      <div class="c small">Emitido em ${new Date().toLocaleString("pt-PT")} — uso interno</div>`;
    printDoc(`Relatório financeiro ${r.data}`, body);
  };

  return (
    <div>
      <Voltar onClick={voltar} />
      <div className="c-titulo">📈 Relatório Financeiro</div>

      <div className="c-card" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <label className="c-label" style={{ margin: 0 }}>Dia:</label>
        <input className="c-input" type="date" style={{ maxWidth: 170 }} value={dia} max={hoje()}
          onChange={(e) => setDia(e.target.value || hoje())} />
        <button className="c-btn c-btn-cinza c-btn-peq" onClick={() => setDia(hoje())}>Hoje</button>
        <button className="c-btn c-btn-linha c-btn-peq" onClick={imprimir} disabled={!r}>🖨️ Imprimir</button>
      </div>

      {q.isLoading && <Vazio icon="⏳">A calcular o dia…</Vazio>}

      {r && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 10, marginBottom: 12 }}>
            <Stat cls="v" lbl="💰 Receita Total">{mt(r.receitaTotal)}</Stat>
            <Stat cls="vm" lbl="💸 Despesas do Dia">{mt(r.despesas.total)}</Stat>
            <Stat cls={r.analise.ebitda >= 0 ? "az" : "vm"} lbl="📊 EBITDA Previsto">{mt(r.analise.ebitda)}</Stat>
            <Stat lbl="🎫 Ticket Médio">{mt(r.ticketMedio)}</Stat>
          </div>

          {r.variacao !== null && (
            <div className="c-card" style={{ fontSize: 13 }}>
              {r.variacao >= 0 ? "📈" : "📉"} Receita {r.variacao >= 0 ? <b style={{ color: "var(--verde-c)" }}>+{fmt(r.variacao)}%</b> : <b style={{ color: "var(--vermelho-c)" }}>{fmt(r.variacao)}%</b>}
              {" "}face a ontem ({diaBR(r.ontem.data)}: {mt(r.ontem.receitaTotal)} · despesas {mt(r.ontem.despesasTotal)})
            </div>
          )}

          {/* ===== Receita do dia discriminada ===== */}
          <div className="c-card" style={{ borderLeft: "4px solid var(--verde-c, #1e9e5a)" }}>
            <div className="c-titulo" style={{ fontSize: 15 }}>💰 Receita do Dia — discriminada</div>
            <div className="c-linha"><div className="grow tit">🍽️ Refeições</div><b>{mt(r.grupos.refeicoes)}</b></div>
            <div className="c-linha"><div className="grow tit">🥤 Bebidas</div><b>{mt(r.grupos.bebidas)}</b></div>
            <div className="c-linha"><div className="grow tit">🏊 Piscina</div><b>{mt(r.grupos.piscina)}</b></div>
            <div className="c-linha"><div className="grow tit">🛝 Parque Infantil</div><b>{mt(r.grupos.parque)}</b></div>
            {r.grupos.servicos > 0 && (
              <div className="c-linha"><div className="grow tit">🛎️ Outros serviços</div><b>{mt(r.grupos.servicos)}</b></div>
            )}
            <div className="c-linha"><div className="grow tit">📱 Loja Online</div><b>{mt(r.grupos.lojaOnline)}</b></div>
            <div className="c-linha"><div className="grow tit">📅 Adiantamentos — Consumo local</div><b>{mt(r.grupos.adiantLocal)}</b></div>
            <div className="c-linha"><div className="grow tit">🎉 Adiantamentos — Eventos</div><b>{mt(r.grupos.adiantEventos)}</b></div>
            {r.fontes.braai > 0 && (
              <div className="c-linha"><div className="grow tit">🔥 Braai (taxa de uso do espaço)</div><b>{mt(r.fontes.braai)}</b></div>
            )}
            {r.fontes.dividas > 0 && (
              <div className="c-linha"><div className="grow tit">🧾 Dívidas liquidadas (fiado cobrado)</div><b>{mt(r.fontes.dividas)}</b></div>
            )}
            {r.grupos.agente > 0 && (
              <div className="c-linha"><div className="grow tit">🏧 Comissões Agente recebidas (eMola/M-Pesa)</div><b>{mt(r.grupos.agente)}</b></div>
            )}
            {r.fontes.gerencia > 0 && (
              <div className="c-linha"><div className="grow tit">👔 Conta Gerência (paga)</div><b>{mt(r.fontes.gerencia)}</b></div>
            )}
            <div className="c-total-linha" style={{ borderTop: "2px solid var(--roxo)", marginTop: 4, paddingTop: 8 }}>
              <span><b>RECEITA TOTAL DO DIA</b></span>
              <b style={{ color: "var(--verde-c)" }}>{mt(r.receitaTotal)}</b>
            </div>
            {r.adiantDeduzidoHoje > 0 && (
              <p className="c-sub" style={{ margin: "4px 0 0" }}>
                ℹ️ {mt(r.adiantDeduzidoHoje)} de consumo de hoje já tinha sido pago como adiantamento de reserva (deduzido no fecho das contas).
              </p>
            )}
          </div>

          {/* ===== Despesas do dia — NÃO descontadas da receita ===== */}
          <div className="c-card" style={{ borderLeft: "4px solid var(--vermelho-c, #d33)" }}>
            <div className="c-titulo" style={{ fontSize: 15 }}>💸 Despesas do Dia</div>
            <p className="c-sub" style={{ marginTop: -4, marginBottom: 6 }}>
              ⚠️ Este valor <b>NÃO é descontado</b> das receitas — usamos valor guardado para a compra de mercadorias.
            </p>
            <div className="c-linha"><div className="grow tit">🏢 Custos fixos</div><b>{mt(r.despesas.fixo)}</b></div>
            <div className="c-linha"><div className="grow tit">🔄 Custos variáveis</div><b>{mt(r.despesas.variavel)}</b></div>
            <div className="c-linha"><div className="grow tit">🤝 Total Afiliados (comissões)</div><b>{mt(r.grupos.totalAfiliados)}</b></div>
            <div className="c-linha"><div className="grow tit">✅ Já pago aos fornecedores</div><b>{mt(r.despesas.pago)}</b></div>
            <div className="c-linha"><div className="grow tit">💳 Em dívida (crédito/parcelas)</div>
              <b style={{ color: r.despesas.emDivida > 0 ? "var(--vermelho-c)" : "inherit" }}>{mt(r.despesas.emDivida)}</b></div>
            {r.despesas.porCategoria.length === 0 && (
              <Vazio icon="💸">Sem despesas lançadas.<br /><span className="c-sub">A Logística regista as compras em Menu → Despesas.</span></Vazio>
            )}
            {r.despesas.porCategoria.length > 0 && (
              <>
                <hr style={{ border: "none", borderTop: "1px dashed #d9c8e3", margin: "8px 0" }} />
                {r.despesas.porCategoria.map((c) => (
                  <div className="c-linha" key={c.categoria} style={{ padding: "5px 0" }}>
                    <div className="grow tit" style={{ fontSize: 12.5 }}>{c.categoria}</div>
                    <span style={{ fontSize: 12.5 }}>{mt(c.total)}</span>
                  </div>
                ))}
              </>
            )}
            <div className="c-total-linha" style={{ borderTop: "2px solid var(--roxo)", marginTop: 4, paddingTop: 8 }}>
              <span><b>DESPESAS DO DIA (TOTAL)</b></span>
              <b style={{ color: "var(--vermelho-c)" }}>{mt(r.despesas.total)}</b>
            </div>
          </div>

          {/* ===== Análise de rentabilidade ===== */}
          <div className="c-card" style={{ background: "linear-gradient(135deg,#f3edff,#fdf6ec)" }}>
            <div className="c-titulo" style={{ fontSize: 15 }}>📊 Análise de Rentabilidade (previsão)</div>
            {r.analise.semCustoRegistado && (
              <p className="c-sub" style={{ marginTop: -4 }}>
                ⚠️ Os preços de compra ainda não estão preenchidos — preencha o <b>preço de compra</b> nos produtos (ou lance as compras nas Despesas) para uma previsão exacta.
              </p>
            )}
            <div className="c-linha"><div className="grow tit">📦 CMV — custo da mercadoria vendida</div><b>{mt(r.analise.cmv)}</b></div>
            <div className="c-linha"><div className="grow tit">💹 Margem bruta <span className="c-sub">({fmt(r.analise.margemPct)}%)</span></div><b>{mt(r.analise.margemBruta)}</b></div>
            <div className="c-linha"><div className="grow tit">📊 EBITDA previsto <span className="c-sub">({fmt(r.analise.ebitdaPct)}%)</span></div>
              <b style={{ color: r.analise.ebitda >= 0 ? "var(--verde-c)" : "var(--vermelho-c)" }}>{mt(r.analise.ebitda)}</b></div>
            <div className="c-linha"><div className="grow tit">🏛️ IVA estimado (16%)</div><b>{mt(r.analise.iva)}</b></div>
            <p className="c-sub" style={{ margin: "4px 0 0" }}>
              ℹ️ Previsão informativa com base no preço de compra dos produtos. Não substitui a contabilidade oficial.
            </p>
          </div>

          <div className="c-card">
            <div className="c-titulo" style={{ fontSize: 15 }}>🏷️ Receitas por Categoria (o que foi vendido)</div>
            {r.porCategoria.length === 0 && <Vazio icon="🏷️">Sem vendas neste dia.</Vazio>}
            {r.porCategoria.map((c) => (
              <div className="c-linha" key={c.categoria}>
                <div className="grow tit">{c.categoria} <span className="c-sub">· {c.qtd} un.</span></div>
                <b>{mt(c.total)}</b>
              </div>
            ))}
          </div>

          <div className="c-card">
            <div className="c-titulo" style={{ fontSize: 15 }}>💳 Receitas por Método de Pagamento</div>
            {r.porMetodo.length === 0 && <Vazio icon="💳">Sem receitas neste dia.</Vazio>}
            {r.porMetodo.map((m) => (
              <div className="c-linha" key={m.metodo}>
                <div className="grow tit">{m.metodo}</div>
                <b>{mt(m.total)}</b>
              </div>
            ))}
          </div>

          <div className="c-card">
            <div className="c-titulo" style={{ fontSize: 15 }}>💼 Resumo por Forma de Recebimento</div>
            <p className="c-sub" style={{ marginTop: 0 }}>Quanto entrou no dia em cada canal: dinheiro em caixa, transferências/levantamentos M-Pesa e eMola, banco, cartão.</p>
            {r.porRecebimento.length === 0 && <Vazio icon="💼">Sem receitas neste dia.</Vazio>}
            {r.porRecebimento.map((c) => (
              <div className="c-linha" key={c.classe}>
                <div className="grow tit">{c.classe}</div>
                <b>{mt(c.total)}</b>
              </div>
            ))}
            {r.porRecebimento.length > 0 && (
              <div className="c-total-linha"><span>TOTAL RECEBIDO</span><span>{mt(r.porRecebimento.reduce((a, c) => a + c.total, 0))}</span></div>
            )}
          </div>

          {r.troco.total > 0 && (
            <div className="c-card">
              <div className="c-titulo" style={{ fontSize: 15 }}>💸 Troco entregue — circulação do dinheiro</div>
              <p className="c-sub" style={{ marginTop: 0 }}>Como o troco foi entregue aos clientes (dinheiro físico vs. contas móveis/banco).</p>
              {r.troco.porForma.map((t) => (
                <div className="c-linha" key={t.forma}>
                  <div className="grow tit">{t.forma}</div>
                  <b>{mt(t.total)}</b>
                </div>
              ))}
              <div className="c-total-linha"><span>TROCO TOTAL</span><span>{mt(r.troco.total)}</span></div>
            </div>
          )}

          {(r.agente.n > 0 || r.agente.movimentosHoje > 0 || (r.agente.totais && (r.agente.totais.totalLevEmola > 0 || r.agente.totais.totalLevMpesa > 0 || r.agente.totais.depEmola > 0 || r.agente.totais.depMpesa > 0))) && (
            <div className="c-card">
              <div className="c-titulo" style={{ fontSize: 15 }}>🏧 Agente eMola / M-Pesa</div>
              {r.agente.totais && (r.agente.totais.depEmola > 0 || r.agente.totais.depMpesa > 0) && (
                <>
                  <div className="c-sub" style={{ margin: "4px 0 2px", fontWeight: 700 }}>📥 Depósitos de clientes hoje (para a conta pessoal do cliente)</div>
                  {r.agente.totais.depEmola > 0 && <div className="c-linha"><div className="grow tit">Depósitos eMola ({r.agente.totais.nDepEmola})</div><b>{mt(r.agente.totais.depEmola)}</b></div>}
                  {r.agente.totais.depMpesa > 0 && <div className="c-linha"><div className="grow tit">Depósitos M-Pesa ({r.agente.totais.nDepMpesa})</div><b>{mt(r.agente.totais.depMpesa)}</b></div>}
                </>
              )}
              {r.agente.totais && (r.agente.totais.totalLevEmola > 0 || r.agente.totais.totalLevMpesa > 0) && (
                <>
                  <div className="c-sub" style={{ margin: "6px 0 2px", fontWeight: 700 }}>📤 Levantamentos hoje</div>
                  {r.agente.totais.levPagEmola > 0 && <div className="c-linha"><div className="grow tit">· Pagamentos de vendas via Lev. eMola</div><b>{mt(r.agente.totais.levPagEmola)}</b></div>}
                  {r.agente.totais.levExclEmola > 0 && <div className="c-linha"><div className="grow tit">· Lev. exclusivos eMola — uso pessoal ({r.agente.totais.nLevEmola})</div><b>{mt(r.agente.totais.levExclEmola)}</b></div>}
                  {r.agente.totais.totalLevEmola > 0 && <div className="c-total-linha"><span>TOTAL LEVANTAMENTOS eMola</span><span>{mt(r.agente.totais.totalLevEmola)}</span></div>}
                  {(r.agente.totais.trocoDepEmola ?? 0) > 0 && <div className="c-linha"><div className="grow tit">· (−) Troco entregue via Depósito eMola</div><b style={{ color: "var(--vermelho-c)" }}>− {mt(r.agente.totais.trocoDepEmola)}</b></div>}
                  {r.agente.totais.levPagMpesa > 0 && <div className="c-linha"><div className="grow tit">· Pagamentos de vendas via Lev. M-Pesa</div><b>{mt(r.agente.totais.levPagMpesa)}</b></div>}
                  {r.agente.totais.levExclMpesa > 0 && <div className="c-linha"><div className="grow tit">· Lev. exclusivos M-Pesa — uso pessoal ({r.agente.totais.nLevMpesa})</div><b>{mt(r.agente.totais.levExclMpesa)}</b></div>}
                  {(r.agente.totais.trocoDepMpesa ?? 0) > 0 && <div className="c-linha"><div className="grow tit">· (−) Troco entregue via Depósito M-Pesa</div><b style={{ color: "var(--vermelho-c)" }}>− {mt(r.agente.totais.trocoDepMpesa)}</b></div>}
                  {r.agente.totais.totalLevMpesa > 0 && <div className="c-total-linha"><span>TOTAL LEVANTAMENTOS M-Pesa</span><span>{mt(r.agente.totais.totalLevMpesa)}</span></div>}
                </>
              )}
              {r.agente.movimentosHoje > 0 && (
                <>
                  <div className="c-linha"><div className="grow tit">Movimentos de clientes hoje</div><b>{r.agente.movimentosHoje}</b></div>
                  <div className="c-linha"><div className="grow tit">Valor movimentado hoje</div><b>{mt(r.agente.valorHoje)}</b></div>
                  <div className="c-linha"><div className="grow tit">Comissões do dia — <b>a receber</b></div><b style={{ color: "var(--amarelo-c)" }}>{mt(r.agente.aReceberHoje)}</b></div>
                </>
              )}
              {r.agente.n > 0 && (
                <>
                  {r.agente.emola > 0 && <div className="c-linha"><div className="grow tit">Comissão eMola (recebida)</div><b>{mt(r.agente.emola)}</b></div>}
                  {r.agente.mpesa > 0 && <div className="c-linha"><div className="grow tit">Comissão M-Pesa (recebida)</div><b>{mt(r.agente.mpesa)}</b></div>}
                  <div className="c-total-linha"><span>COMISSÕES RECEBIDAS HOJE</span><span style={{ color: "var(--verde-c)" }}>{mt(r.agente.comissao)}</span></div>
                </>
              )}
              <div className="c-linha"><div className="grow tit">Total a receber das operadoras</div><b>{mt(r.agente.aReceberTotal)}</b></div>
              <p className="c-sub" style={{ marginBottom: 0 }}>ℹ️ As comissões só entram na receita quando a operadora paga (1ª semana do mês) — confirme o recebimento no ecrã 🏧 Agente.</p>
            </div>
          )}

          {r.despesas.itens.length > 0 && (
            <div className="c-card">
              <div className="c-titulo" style={{ fontSize: 15 }}>🧾 Lançamentos de despesas do dia</div>
              {r.despesas.itens.map((d) => (
                <div className="c-linha" key={d.id} style={{ padding: "5px 0" }}>
                  <div className="grow" style={{ fontSize: 12.5 }}>
                    {d.descricao}
                    <span className="c-sub"> · {d.categoria}{d.fornecedor ? ` · ${d.fornecedor}` : ""}</span>
                  </div>
                  <span style={{ fontSize: 12.5 }}>{mt(d.valor)}</span>
                </div>
              ))}
            </div>
          )}

          {r.topProdutos.length > 0 && (
            <div className="c-card">
              <div className="c-titulo" style={{ fontSize: 15 }}>🏆 Top 5 do Dia</div>
              {r.topProdutos.map((t, i) => (
                <div className="c-linha" key={t.nome}>
                  <b style={{ color: "var(--roxo)", width: 22 }}>{i + 1}º</b>
                  <div className="grow tit">{t.nome}</div>
                  <span>{t.qtd} un. · <b>{mt(t.total)}</b></span>
                </div>
              ))}
            </div>
          )}

          {sem.data && sem.data.some((d) => d.receita > 0 || d.despesas > 0) && (
            <div className="c-card">
              <div className="c-titulo" style={{ fontSize: 15 }}>🗓️ Últimos 7 dias</div>
              {sem.data.map((d) => (
                <button key={d.data} className="c-linha" style={{ width: "100%", background: "none", border: "none", borderBottom: "1px solid #f0e6f2", cursor: "pointer", textAlign: "left" }}
                  onClick={() => setDia(d.data)}>
                  <div className="grow tit">{diaBR(d.data)}{d.data === hoje() ? " (hoje)" : ""}</div>
                  <span style={{ fontSize: 12 }}>
                    💰 {fmt(d.receita)} · 💸 {fmt(d.despesas)} ·{" "}
                    <b style={{ color: d.saldo >= 0 ? "var(--verde-c)" : "var(--vermelho-c)" }}>{fmt(d.saldo)}</b>
                  </span>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {user && <DrePeriodo usuarioId={user.id} />}
    </div>
  );
}

/* ============ DRE — Demonstração de Resultados por intervalo ============ */
function DrePeriodo({ usuarioId }: { usuarioId: number }) {
  const { toast } = useSession();
  const [de, setDe] = useState(hoje().slice(0, 7) + "-01"); // início do mês
  const [ate, setAte] = useState(hoje());
  const [gerou, setGerou] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const dreRef = useRef<HTMLDivElement>(null);

  const q = trpc.financeiro.periodo.useQuery(
    { usuarioId, de, ate },
    { enabled: gerou && !!de && !!ate },
  );
  const d = q.data;

  const baixarPDF = async () => {
    const el = dreRef.current;
    if (!el || !d) return;
    setPdfLoading(true);
    try {
      const canvas = await html2canvas(el, { scale: 2, backgroundColor: "#ffffff", useCORS: true });
      const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
      const pw = pdf.internal.pageSize.getWidth();
      const ph = pdf.internal.pageSize.getHeight();
      const margem = 12, topo = 26;
      const largura = pw - margem * 2;
      const alturaTotal = (canvas.height * largura) / canvas.width;
      const alturaPagina = ph - topo - 12;
      const fmtD = (x: string) => new Date(x + "T12:00:00Z").toLocaleDateString("pt-PT");
      const nPaginas = Math.max(1, Math.ceil(alturaTotal / alturaPagina));
      for (let pg = 0; pg < nPaginas; pg++) {
        if (pg > 0) pdf.addPage();
        pdf.setFillColor(88, 28, 135);
        pdf.rect(0, 0, pw, 18, "F");
        pdf.setTextColor(255, 255, 255);
        pdf.setFontSize(13);
        pdf.setFont("helvetica", "bold");
        pdf.text("CAMI'S EVENTOS — DRE · Demonstração de Resultados", margem, 8);
        pdf.setFontSize(9);
        pdf.setFont("helvetica", "normal");
        pdf.text(`Período: ${fmtD(d.de)} a ${fmtD(d.ate)}  ·  Gerado em ${new Date().toLocaleString("pt-PT")}`, margem, 14);
        pdf.setTextColor(0, 0, 0);
        const ySrc = (pg * alturaPagina * canvas.width) / largura;
        const hSrc = Math.min(canvas.height - ySrc, (alturaPagina * canvas.width) / largura);
        const slice = document.createElement("canvas");
        slice.width = canvas.width;
        slice.height = Math.max(1, Math.round(hSrc));
        const ctx = slice.getContext("2d")!;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, slice.width, slice.height);
        ctx.drawImage(canvas, 0, ySrc, canvas.width, hSrc, 0, 0, canvas.width, hSrc);
        pdf.addImage(slice.toDataURL("image/jpeg", 0.92), "JPEG", margem, topo, largura, (hSrc * largura) / canvas.width);
        pdf.setFontSize(8);
        pdf.setTextColor(120, 120, 120);
        pdf.text(`Página ${pg + 1} de ${nPaginas}`, pw - margem, ph - 5, { align: "right" });
      }
      pdf.save(`DRE_camis_${d.de}_a_${d.ate}.pdf`);
      toast("📄 DRE em PDF descarregado!");
    } catch (e) {
      console.error(e);
      toast("⚠️ Não foi possível gerar o PDF.");
    } finally {
      setPdfLoading(false);
    }
  };

  const linha = (lbl: string, valor: number, opts?: { sub?: boolean; neg?: boolean; bold?: boolean; cor?: string }) => (
    <div className="c-linha" style={{ padding: opts?.bold ? "7px 0" : "4px 0" }}>
      <div className="grow" style={{ fontSize: opts?.bold ? 14 : 13, fontWeight: opts?.bold ? 700 : 400, paddingLeft: opts?.sub ? 16 : 0 }}>
        {lbl}
      </div>
      <b style={{ fontSize: opts?.bold ? 14 : 13, color: opts?.cor ?? (opts?.neg ? "var(--vermelho-c)" : "inherit") }}>
        {opts?.neg && valor > 0 ? "− " : ""}{mt(valor)}
      </b>
    </div>
  );
  const total = (lbl: string, valor: number, cor: string) => (
    <div className="c-total-linha" style={{ borderTop: `2px solid ${cor}`, marginTop: 2, paddingTop: 7 }}>
      <span><b>{lbl}</b></span>
      <b style={{ color: cor }}>{mt(valor)}</b>
    </div>
  );

  return (
    <div className="c-card" style={{ marginTop: 14, borderTop: "4px solid var(--roxo)" }}>
      <div className="c-titulo" style={{ fontSize: 16 }}>📑 DRE — Demonstração de Resultados (intervalo)</div>
      <p className="c-sub" style={{ marginTop: -4 }}>
        Escolha o período: o sistema apura receitas, CMV, despesas e o resultado líquido estimado — pronto para imprimir em PDF com gráficos.
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div>
          <label className="c-label" style={{ marginTop: 0 }}>📅 De (data inicial)</label>
          <input className="c-input" type="date" value={de} max={ate || undefined}
            onChange={(e) => { setDe(e.target.value); setGerou(false); }} />
        </div>
        <div>
          <label className="c-label" style={{ marginTop: 0 }}>📅 Até (data final)</label>
          <input className="c-input" type="date" value={ate} min={de || undefined} max={hoje()}
            onChange={(e) => { setAte(e.target.value); setGerou(false); }} />
        </div>
      </div>
      <button className="c-btn c-btn-prim c-btn-bloco" style={{ marginTop: 10 }}
        disabled={!de || !ate || q.isFetching}
        onClick={() => setGerou(true)}>
        {q.isFetching ? "⏳ A apurar o período…" : "📊 Gerar DRE do período"}
      </button>

      {gerou && d && (
        <>
          <div ref={dreRef} style={{ background: "#fff", borderRadius: 12, padding: 4, marginTop: 10 }}>
            <p className="c-sub" style={{ textAlign: "center", margin: "4px 0 8px" }}>
              Período: <b>{diaBR(d.de)}</b> a <b>{diaBR(d.ate)}</b> · {d.nDias} dia(s) · {d.diasComMovimento} com movimento · {d.nVendas} venda(s)
            </p>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 10, marginBottom: 10 }}>
              <Stat cls="v" lbl="💰 Receita Total">{mt(d.receitaTotal)}</Stat>
              <Stat cls="vm" lbl="💸 Despesas Totais">{mt(d.despTotal)}</Stat>
              <Stat cls={d.ebitda >= 0 ? "az" : "vm"} lbl="📊 EBITDA">{mt(d.ebitda)}</Stat>
              <Stat cls={d.resultadoLiquido >= 0 ? "v" : "vm"} lbl="🏁 Resultado Líquido">{mt(d.resultadoLiquido)}</Stat>
            </div>

            {/* ===== Demonstração de Resultados ===== */}
            <div className="c-card" style={{ boxShadow: "none", border: "1px solid #eadcf3" }}>
              <div className="c-titulo" style={{ fontSize: 15 }}>🧾 Demonstração de Resultados</div>
              {linha("Receita de vendas (restaurante, online, piscina)", d.receitaVendas)}
              {d.fontes.adiantamentos > 0 && linha("(+) Adiantamentos de reservas recebidos", d.fontes.adiantamentos, { sub: true })}
              {d.fontes.braai > 0 && linha("(+) Braai — taxa de uso do espaço", d.fontes.braai, { sub: true })}
              {d.fontes.dividas > 0 && linha("(+) Dívidas liquidadas (fiado cobrado)", d.fontes.dividas, { sub: true })}
              {d.fontes.agente > 0 && linha("(+) Comissões de agente recebidas (eMola/M-Pesa)", d.fontes.agente, { sub: true })}
              {d.fontes.bilhetes > 0 && linha("(+) Bilhetes de eventos (bilheteira)", d.fontes.bilhetes, { sub: true })}
              {d.fontes.saldosReserva > 0 && linha("(+) Saldos de reservas cobrados no dia", d.fontes.saldosReserva, { sub: true })}
              {total("= RECEITA TOTAL DO PERÍODO", d.receitaTotal, "var(--verde-c)")}
              <div style={{ height: 6 }} />
              {linha("(−) CMV — custo da mercadoria vendida", d.cmv, { neg: true })}
              {d.semCustoRegistado && (
                <p className="c-sub" style={{ margin: "0 0 4px" }}>⚠️ Preços de compra ainda não preenchidos — CMV aproximado.</p>
              )}
              {total(`= MARGEM BRUTA (${fmt(d.margemBrutaPct)}%)`, d.margemBruta, "var(--roxo)")}
              <div style={{ height: 6 }} />
              {linha("(−) Despesas fixas", d.despFixo, { neg: true })}
              {linha("(−) Despesas variáveis", d.despVariavel, { neg: true })}
              {total(`= EBITDA (${fmt(d.ebitdaPct)}%)`, d.ebitda, d.ebitda >= 0 ? "var(--verde-c)" : "var(--vermelho-c)")}
              <div style={{ height: 6 }} />
              {linha("(−) IVA estimado (16%)", d.iva, { neg: true })}
              {total(`= RESULTADO LÍQUIDO ESTIMADO (${fmt(d.liquidoPct)}%)`, d.resultadoLiquido, d.resultadoLiquido >= 0 ? "var(--verde-c)" : "var(--vermelho-c)")}
              <p className="c-sub" style={{ margin: "6px 0 0" }}>
                ℹ️ Demonstração de gestão com base nos lançamentos do sistema — não substitui a contabilidade oficial.
              </p>
            </div>

            {/* ===== Gráfico receita × despesas por dia ===== */}
            {d.serie.some((x) => x.receita > 0 || x.despesas > 0) && (
              <div className="c-card" style={{ boxShadow: "none", border: "1px solid #eadcf3" }}>
                <div className="c-titulo" style={{ fontSize: 15 }}>📊 Receita × Despesas por Dia</div>
                <div style={{ display: "flex", alignItems: "flex-end", gap: 4, minHeight: 130, padding: "10px 2px 0", overflowX: "auto" }}>
                  {d.serie.map((x) => {
                    const max = Math.max(...d.serie.map((y) => Math.max(y.receita, y.despesas)), 1);
                    const hR = Math.max(x.receita > 0 ? 5 : 0, Math.round((x.receita / max) * 105));
                    const hD = Math.max(x.despesas > 0 ? 5 : 0, Math.round((x.despesas / max) * 105));
                    const lbl = new Date(x.data + "T12:00:00Z").toLocaleDateString("pt-PT", { day: "2-digit", month: "2-digit" });
                    return (
                      <div key={x.data} style={{ flex: "1 0 22px", textAlign: "center" }}
                        title={`${diaBR(x.data)} · receita ${fmt(x.receita)} · despesas ${fmt(x.despesas)}`}>
                        <div style={{ display: "flex", alignItems: "flex-end", gap: 2, justifyContent: "center" }}>
                          <div style={{ width: 9, height: hR, background: "linear-gradient(180deg,#34d399,#059669)", borderRadius: "4px 4px 0 0" }} />
                          <div style={{ width: 9, height: hD, background: "linear-gradient(180deg,#f87171,#dc2626)", borderRadius: "4px 4px 0 0" }} />
                        </div>
                        <div style={{ fontSize: 9, color: "#777", marginTop: 3 }}>{lbl}</div>
                      </div>
                    );
                  })}
                </div>
                <p className="c-sub" style={{ margin: "6px 0 0" }}>
                  <span style={{ color: "#059669" }}>■</span> Receita&nbsp;&nbsp;<span style={{ color: "#dc2626" }}>■</span> Despesas
                </p>
              </div>
            )}

            {/* ===== Depósitos de agente eMola/M-Pesa por dia ===== */}
            {(d.agenteDeps.depEmola > 0 || d.agenteDeps.depMpesa > 0) && (
              <div className="c-card" style={{ boxShadow: "none", border: "1px solid #eadcf3" }}>
                <div className="c-titulo" style={{ fontSize: 15 }}>🏧 Depósitos de Agente por Dia (eMola / M-Pesa)</div>
                <p className="c-sub" style={{ margin: "-4px 0 8px" }}>
                  Valor movimentado em DEPÓSITOS de clientes no agente — fluxo diário, não soma na receita (a receita do agente é a comissão).
                </p>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 8 }}>
                  <Stat cls="az" lbl="📥 Depósitos eMola">{mt(d.agenteDeps.depEmola)}</Stat>
                  <Stat cls="v" lbl="📥 Depósitos M-Pesa">{mt(d.agenteDeps.depMpesa)}</Stat>
                </div>
                {d.serie.filter((x) => x.depEmola > 0 || x.depMpesa > 0).map((x) => (
                  <div className="c-linha" key={x.data} style={{ padding: "4px 0" }}>
                    <div className="grow" style={{ fontSize: 13 }}>{diaBR(x.data)}</div>
                    <div style={{ fontSize: 12.5, textAlign: "right" }}>
                      {x.depEmola > 0 && <span style={{ marginRight: 10 }}>eMola: <b>{mt(x.depEmola)}</b> <small style={{ color: "#888" }}>({x.nDepEmola})</small></span>}
                      {x.depMpesa > 0 && <span>M-Pesa: <b>{mt(x.depMpesa)}</b> <small style={{ color: "#888" }}>({x.nDepMpesa})</small></span>}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* ===== Despesas por categoria ===== */}
            <div className="c-card" style={{ boxShadow: "none", border: "1px solid #eadcf3" }}>
              <div className="c-titulo" style={{ fontSize: 15 }}>💸 Despesas do Período por Categoria</div>
              {d.despesasPorCategoria.length === 0 && <Vazio icon="💸">Sem despesas no período.</Vazio>}
              {d.despesasPorCategoria.map((c) => {
                const maxC = Math.max(...d.despesasPorCategoria.map((x) => x.total), 1);
                const pctC = Math.round((c.total / maxC) * 100);
                const pctT = d.despTotal > 0 ? Math.round((c.total / d.despTotal) * 100) : 0;
                return (
                  <div key={c.categoria} style={{ padding: "5px 0" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                      <span>{c.categoria}</span><b>{mt(c.total)} <small style={{ color: "#888", fontWeight: 400 }}>({pctT}%)</small></b>
                    </div>
                    <div style={{ height: 7, background: "#fbe9e7", borderRadius: 6, marginTop: 3 }}>
                      <div style={{ height: 7, width: pctC + "%", background: "linear-gradient(90deg,#f87171,#dc2626)", borderRadius: 6 }} />
                    </div>
                  </div>
                );
              })}
              {linha("✅ Já pago aos fornecedores", d.despPago)}
              {linha("💳 Em dívida (crédito/parcelas)", d.despEmDivida, { cor: d.despEmDivida > 0 ? "var(--vermelho-c)" : undefined })}
            </div>

            {/* ===== Receita por fonte ===== */}
            <div className="c-card" style={{ boxShadow: "none", border: "1px solid #eadcf3" }}>
              <div className="c-titulo" style={{ fontSize: 15 }}>💰 Receita do Período por Fonte</div>
              {linha("🍽️ Restaurante (POS)", d.fontes.pos)}
              {linha("📱 Loja Online", d.fontes.online)}
              {linha("🏊 Piscina & Parque", d.fontes.piscina)}
              {linha("📅 Adiantamentos de reservas", d.fontes.adiantamentos)}
              {d.fontes.braai > 0 && linha("🔥 Braai", d.fontes.braai)}
              {d.fontes.dividas > 0 && linha("🧾 Dívidas liquidadas", d.fontes.dividas)}
              {d.fontes.gerencia > 0 && linha("👔 Conta Gerência", d.fontes.gerencia)}
              {d.fontes.agente > 0 && linha("🏧 Comissões de agente", d.fontes.agente)}
              {total("RECEITA TOTAL", d.receitaTotal, "var(--verde-c)")}
            </div>
          </div>

          <button className="c-btn c-btn-verde c-btn-bloco" style={{ marginTop: 8 }} onClick={baixarPDF} disabled={pdfLoading}>
            {pdfLoading ? "⏳ A gerar o PDF…" : "📄 Baixar DRE em PDF (com gráficos)"}
          </button>
        </>
      )}
    </div>
  );
}
