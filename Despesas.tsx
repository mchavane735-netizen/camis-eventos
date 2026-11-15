import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { useSession } from "@/lib/session";
import { mt, fmt, hoje, diaBR } from "@/lib/fmt";
import { useEmpresa } from "@/lib/empresa";
import { Vazio, Voltar } from "@/components/bits";
import MoneyInput from "@/components/MoneyInput";
import { fileToDataUrl } from "@/lib/img";
import UploadFicheiro from "@/components/UploadFicheiro";
import { printDoc, downloadPdf } from "@/lib/docprint";
import { CATS_DESPESA } from "@contracts/types";

const ICON_CAT: Record<string, string> = {
  "Compras — Cozinha": "🍳",
  "Compras — Bar": "🍺",
  "Compras — Piscina": "🏊",
  "Compras — Área de Serviços": "🍽️",
  "Compras — Parque Infantil": "🛝",
  "Compras — Decoração": "🎀",
  "Afiliados — Comissões": "🤝",
  Transporte: "🚗",
  "Energia Eléctrica": "⚡",
  Água: "💧",
  "Salários & Pessoal": "👥",
  "Manutenção & Reparações": "🔧",
  "Comunicações (Net/Telefone)": "📡",
  "Renda & Arrendamento": "🏢",
  "Seguros & Licenças": "🛡️",
  Outros: "📦",
};

/** Categorias que são custo fixo por defeito (igual ao servidor — o utilizador pode mudar) */
const CATS_FIXAS = ["Salários & Pessoal", "Energia Eléctrica", "Água", "Comunicações (Net/Telefone)", "Renda & Arrendamento", "Seguros & Licenças"];

/** Área de compra que o produto determina: bebidas → Bar · comida → Cozinha.
    Evita lançar produtos do bar na cozinha e vice-versa. */
const areaDoProduto = (pr: { tipo: string }) =>
  pr.tipo === "Bebida" ? "Compras — Bar" : pr.tipo === "Refeição" ? "Compras — Cozinha" : null;

/** Períodos disponíveis para o relatório de despesas */
function periodo(tipo: "dia" | "semana" | "mes" | "ano", base: string): { de: string; ate: string; rotulo: string } {
  const d = new Date(base + "T12:00:00");
  if (tipo === "dia") return { de: base, ate: base, rotulo: `Dia ${diaBR(base)}` };
  if (tipo === "semana") {
    const fim = new Date(d.getTime() + 6 * 86400e3);
    const hojeD = hoje();
    const ate = fim.toISOString().slice(0, 10) > hojeD ? hojeD : fim.toISOString().slice(0, 10);
    return { de: base, ate, rotulo: `Semana de ${diaBR(base)} a ${diaBR(ate)}` };
  }
  if (tipo === "mes") {
    const de = base.slice(0, 8) + "01";
    const ult = new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10);
    const ate = ult > hoje() ? hoje() : ult;
    const meses = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
    return { de, ate, rotulo: `Mês de ${meses[d.getMonth()]} de ${d.getFullYear()}` };
  }
  const de = base.slice(0, 4) + "-01-01";
  const ult = base.slice(0, 4) + "-12-31";
  return { de, ate: ult > hoje() ? hoje() : ult, rotulo: `Ano de ${base.slice(0, 4)}` };
}

type RelatorioDesp = {
  de: string; ate: string; total: number; fixo: number; variavel: number; pago: number; emDivida: number;
  porCategoria: { categoria: string; tipoCusto: string; total: number; qtd: number }[];
  itens: { id: number; dataDia: string; categoria: string; descricao: string; fornecedor: string | null; valor: number; valorPago: number; formaPagamento: string; tipoCusto: string; usuarioNome?: string }[];
};

/** Selo de pagamento da despesa: total / crédito / parcelado */
function seloPag(d: { valor: number; valorPago?: number; formaPagamento?: string }) {
  const pago = Math.min(d.valorPago ?? 0, d.valor);
  const falta = Math.max(0, d.valor - pago);
  if (falta <= 0) return { txt: "✅ Pago", cor: "#1e9e5a", pago, falta };
  if (pago <= 0) return { txt: "💳 A crédito", cor: "#c0392b", pago, falta };
  return { txt: "🧾 Em parcelas", cor: "#b8860b", pago, falta };
}

export default function Despesas({ voltar }: { voltar?: () => void }) {
  const { user, toast } = useSession();
  const utils = trpc.useUtils();
  const emp = useEmpresa();
  const [dia, setDia] = useState(hoje());
  const [dataLanc, setDataLanc] = useState(hoje());
  const [f, setF] = useState({ categoria: CATS_DESPESA[0] as string, descricao: "", fornecedor: "", fornecedorTel: "", valor: 0 });
  const [tipoCusto, setTipoCusto] = useState<"Fixo" | "Variavel">("Variavel");
  const [formaPag, setFormaPag] = useState<"Pago" | "Credito" | "Parcelado">("Pago");
  const [valorPago, setValorPago] = useState(0);
  const [produtoId, setProdutoId] = useState(0);
  const [quantidade, setQuantidade] = useState(0);
  // aviso quando a categoria é ajustada automaticamente pelo produto escolhido
  const [areaAjustada, setAreaAjustada] = useState<string | null>(null);
  const [gerandoRel, setGerandoRel] = useState(false);
  const isGestao = user?.perfil === "Admin" || user?.perfil === "Gestor";

  const lista = trpc.despesas.list.useQuery(
    { usuarioId: user?.id ?? 0, de: dia, ate: dia },
    { enabled: !!user },
  );
  // produtos controláveis em stock (para compra → entrada automática no stock)
  const produtosQ = trpc.produtos.list.useQuery(undefined, { staleTime: 60_000 });
  const controlaveis = (produtosQ.data ?? [])
    .filter((p) => p.ativo && p.tipo !== "Serviço" && p.estoqueRefId == null)
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt"));
  const prodSel = controlaveis.find((p) => p.id === produtoId) ?? null;
  const compraDeStock = f.categoria.startsWith("Compras");

  const mudarCategoria = (c: string) => {
    setF({ ...f, categoria: c });
    setTipoCusto(CATS_FIXAS.includes(c) ? "Fixo" : "Variavel");
    setAreaAjustada(null);
    if (!c.startsWith("Compras")) { setProdutoId(0); setQuantidade(0); }
  };

  const criar = trpc.despesas.criar.useMutation({
    onSuccess: (r) => {
      const corrigida = r.categoria && r.categoria !== f.categoria ? ` · 🏷️ ficou em «${r.categoria}»` : "";
      toast(produtoId && quantidade > 0 ? `💸 Despesa lançada e stock actualizado! 📦${corrigida}` : `💸 Despesa lançada!${corrigida}`);
      setF({ ...f, descricao: "", fornecedor: "", fornecedorTel: "", valor: 0 });
      setProdutoId(0); setQuantidade(0); setFormaPag("Pago"); setValorPago(0); setAreaAjustada(null);
      utils.despesas.list.invalidate();
      utils.financeiro.dia.invalidate();
      utils.financeiro.semana.invalidate();
      utils.produtos.list.invalidate();
      utils.stock.movimentos.invalidate();
    },
    onError: (e) => toast("⚠️ " + e.message),
  });
  const eliminar = trpc.despesas.eliminar.useMutation({
    onSuccess: () => { toast("Lançamento eliminado"); utils.despesas.list.invalidate(); utils.financeiro.dia.invalidate(); },
    onError: (e) => toast("⚠️ " + e.message),
  });
  const amortizar = trpc.despesas.amortizar.useMutation({
    onSuccess: (r) => {
      toast(r.quitado ? "✅ Despesa quitada!" : "💰 Parcela registada!");
      utils.despesas.list.invalidate(); utils.financeiro.dia.invalidate();
    },
    onError: (e) => toast("⚠️ " + e.message),
  });

  /* --- Relatório de despesas por período (imprimir / baixar PDF) --- */
  const gerarRelatorio = async (tipo: "dia" | "semana" | "mes" | "ano", accao: "print" | "pdf") => {
    if (!user) return;
    setGerandoRel(true);
    try {
      const p = periodo(tipo, dia);
      const rel = await utils.despesas.relatorio.fetch({ usuarioId: user.id, de: p.de, ate: p.ate }) as RelatorioDesp;
      const linha = (a: string, b: string, bold = false) =>
        `<div class="r"${bold ? ' style="font-weight:700"' : ""}><span>${a}</span><span>${b}</span></div>`;
      const body = `
        <img class="logo" src="/icons/logo.png" alt="" />
        <div class="c nome">${emp.nome}</div>
        <div class="c slogan">${emp.slogan}</div>
        <div class="c small">NUIT ${emp.nuit} · ${emp.local}</div>
        <div class="c titulo">RELATÓRIO DE DESPESAS</div>
        <div class="c"><b>${p.rotulo}</b></div>
        <div class="c small">(período: ${diaBR(rel.de)} a ${diaBR(rel.ate)})</div>
        <div class="sep"></div>
        <div class="r tot"><span>🏢 CUSTOS FIXOS</span><span>${fmt(rel.fixo)} MZN</span></div>
        ${rel.porCategoria.filter((c) => c.tipoCusto === "Fixo").map((c) => linha(`· ${c.categoria} (${c.qtd})`, fmt(c.total) + " MZN")).join("") || '<div class="c small">sem custos fixos</div>'}
        <div class="sep"></div>
        <div class="r tot"><span>🔄 CUSTOS VARIÁVEIS</span><span>${fmt(rel.variavel)} MZN</span></div>
        ${rel.porCategoria.filter((c) => c.tipoCusto !== "Fixo").map((c) => linha(`· ${c.categoria} (${c.qtd})`, fmt(c.total) + " MZN")).join("") || '<div class="c small">sem custos variáveis</div>'}
        <div class="sep"></div>
        <div class="r tot"><span>TOTAL DE DESPESAS</span><span>${fmt(rel.total)} MZN</span></div>
        ${linha("✅ Já pago aos fornecedores", fmt(rel.pago) + " MZN", true)}
        ${linha("💳 Em dívida (crédito/parcelas)", fmt(rel.emDivida) + " MZN", true)}
        <div class="sep"></div>
        <div class="c"><b>TODOS OS LANÇAMENTOS</b></div>
        ${rel.itens.map((d) => {
          const falta = Math.max(0, d.valor - Math.min(d.valorPago ?? 0, d.valor));
          const est = falta <= 0 ? "Pago" : (d.valorPago ?? 0) <= 0 ? "Crédito" : "Parcelado";
          return linha(`${diaBR(d.dataDia)} · ${d.descricao}${d.fornecedor ? " · " + d.fornecedor : ""} <i>(${d.tipoCusto === "Fixo" ? "Fixo" : "Variável"} · ${est}${falta > 0 ? " · falta " + fmt(falta) : ""})</i>`, fmt(d.valor) + " MZN");
        }).join("") || '<div class="c small">sem lançamentos no período</div>'}
        <div class="sep"></div>
        <div class="c small">Emitido em ${new Date().toLocaleString("pt-PT")} — uso interno</div>`;
      if (accao === "print") printDoc(`Relatório de despesas — ${p.rotulo}`, body);
      else downloadPdf(`Relatório de despesas — ${p.rotulo}`, body, `despesas_${rel.de}_a_${rel.ate}.pdf`);
    } catch (e) {
      toast("⚠️ " + (e instanceof Error ? e.message : "Erro ao gerar relatório"));
    } finally {
      setGerandoRel(false);
    }
  };

  const itens = lista.data ?? [];
  const totalDia = itens.reduce((a, d) => a + d.valor, 0);

  return (
    <div>
      {voltar && <Voltar onClick={voltar} />}
      <div className="c-titulo">💸 Despesas & Compras</div>
      <p className="c-sub" style={{ marginTop: -6 }}>
        Registe aqui as compras e gastos do dia. Compras de produtos controláveis entram <b>automaticamente no stock</b> 📦.
      </p>

      {/* formulário de lançamento */}
      <div className="c-card" style={{ background: "#fdf6ec" }}>
        <div className="c-titulo" style={{ fontSize: 15 }}>➕ Novo lançamento</div>
        <label className="c-label">Data do gasto</label>
        <input className="c-input" type="date" value={dataLanc} max={hoje()}
          onChange={(e) => setDataLanc(e.target.value || hoje())} />
        <label className="c-label">Categoria *</label>
        <select className="c-select" value={f.categoria} onChange={(e) => mudarCategoria(e.target.value)}>
          {CATS_DESPESA.map((c) => <option key={c} value={c}>{ICON_CAT[c] ?? "📦"} {c}</option>)}
        </select>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div>
            <label className="c-label">Tipo de custo</label>
            <select className="c-select" value={tipoCusto} onChange={(e) => setTipoCusto(e.target.value as "Fixo" | "Variavel")}>
              <option value="Variavel">🔄 Variável</option>
              <option value="Fixo">🏢 Fixo</option>
            </select>
          </div>
          <div>
            <label className="c-label">Fornecedor</label>
            <input className="c-input" placeholder="Ex.: Luís Ferrão (frangos)"
              value={f.fornecedor} onChange={(e) => setF({ ...f, fornecedor: e.target.value })} />
          </div>
        </div>
        <label className="c-label">Contacto do fornecedor (opcional)</label>
        <input className="c-input" inputMode="tel" placeholder="Ex.: 86 790 1967 — útil para dívidas a crédito"
          value={f.fornecedorTel} onChange={(e) => setF({ ...f, fornecedorTel: e.target.value })} />

        {/* Compra de produto controlável → entrada automática no stock */}
        {compraDeStock && (
          <div style={{ background: "#eefaf1", border: "1px dashed #1e9e5a", borderRadius: 10, padding: 10, margin: "8px 0" }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>📦 Entrada automática no stock (opcional)</div>
            <label className="c-label">Produto controlável</label>
            <select className="c-select" value={produtoId}
              onChange={(e) => {
                const id = +e.target.value;
                setProdutoId(id);
                const p = controlaveis.find((x) => x.id === id);
                if (!p) { setAreaAjustada(null); return; }
                // a categoria (acima) segue o produto: bebidas → Bar, comida → Cozinha
                const area = areaDoProduto(p);
                if (area && f.categoria !== area) {
                  setF((prev) => ({ ...prev, categoria: area }));
                  setAreaAjustada(area);
                } else setAreaAjustada(null);
                if (quantidade > 0 && p.precoCompra > 0) setF((prev) => ({ ...prev, valor: +(quantidade * p.precoCompra).toFixed(2) }));
                if (!f.descricao.trim()) setF((prev) => ({ ...prev, descricao: `Compra de ${p.nome}` }));
              }}>
              <option value={0}>— Só registar a despesa (sem stock) —</option>
              {controlaveis.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.tipo === "Bebida" ? "🍺" : "🍳"} {p.nome} · stock: {fmt(p.estoqueAtual)} {p.qtdDecimal ? "kg" : "un."}{p.precoCompra > 0 ? ` · custo ${fmt(p.precoCompra)}` : ""}
                </option>
              ))}
            </select>
            {areaAjustada && (
              <p className="c-sub" style={{ margin: "4px 0 0", background: "#fff7e0", borderRadius: 8, padding: 6 }}>
                🏷️ Categoria ajustada automaticamente para <b>«{areaAjustada}»</b> (o produto é de {areaAjustada === "Compras — Bar" ? "bebidas" : "cozinha"}). Se esta compra for uma excepção, pode mudar a categoria acima.
              </p>
            )}
            {produtoId > 0 && (
              <>
                <label className="c-label">Quantidade comprada *</label>
                <input className="c-input" type="number" min={0} step={prodSel?.qtdDecimal ? "0.01" : "1"}
                  placeholder={prodSel?.qtdDecimal ? "Ex.: 12.5 (kg)" : "Ex.: 24 (unidades)"}
                  value={quantidade || ""}
                  onChange={(e) => {
                    const q = +e.target.value || 0;
                    setQuantidade(q);
                    if (prodSel && prodSel.precoCompra > 0 && q > 0)
                      setF((prev) => ({ ...prev, valor: +(q * prodSel.precoCompra).toFixed(2) }));
                  }} />
                {prodSel && (
                  <p className="c-sub" style={{ margin: "4px 0 0" }}>
                    ℹ️ Entram <b>{fmt(quantidade)}</b> {prodSel.qtdDecimal ? "kg" : "un."} de <b>{prodSel.nome}</b> no stock
                    (fica com {fmt((prodSel.estoqueAtual ?? 0) + (quantidade || 0))}).
                    Se o valor da compra for diferente, o <b>preço de compra é actualizado automaticamente</b> para o custo real.
                  </p>
                )}
              </>
            )}
          </div>
        )}

        <label className="c-label">Descrição *</label>
        <input className="c-input" placeholder="Ex.: Compra de 20 kg de frango no mercado"
          value={f.descricao} onChange={(e) => setF({ ...f, descricao: e.target.value })} />
        <label className="c-label">Valor total (MZN) *</label>
        <MoneyInput value={f.valor} onChange={(v) => setF({ ...f, valor: v })} />
        <label className="c-label">Forma de pagamento ao fornecedor</label>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 4 }}>
          {([["Pago", "✅ Pago total"], ["Credito", "💳 A crédito"], ["Parcelado", "🧾 Em parcelas"]] as const).map(([v, l]) => (
            <button key={v} type="button" className="c-btn c-btn-peq"
              style={{ background: formaPag === v ? "var(--roxo)" : "#eee", color: formaPag === v ? "#fff" : "#333", border: "none" }}
              onClick={() => { setFormaPag(v); if (v === "Pago") setValorPago(0); }}>
              {l}
            </button>
          ))}
        </div>
        {formaPag === "Credito" && (
          <p className="c-sub" style={{ margin: "2px 0 6px", background: "#fdecea", borderRadius: 8, padding: 8 }}>
            💳 Fica a dever <b>{mt(f.valor)}</b> ao fornecedor — fica visível na página «🧾 Dívidas» (separador Fornecedores) até ser pago por completo.
          </p>
        )}
        {formaPag === "Parcelado" && (
          <div style={{ background: "#fdf6ec", borderRadius: 8, padding: 8, margin: "2px 0 6px" }}>
            <label className="c-label">Já pago agora (MZN)</label>
            <MoneyInput value={valorPago} onChange={setValorPago} />
            {f.valor > 0 && valorPago > 0 && valorPago < f.valor && (
              <p className="c-sub" style={{ margin: "4px 0 0" }}>Fica a faltar <b style={{ color: "var(--vermelho-c)" }}>{mt(f.valor - valorPago)}</b>.</p>
            )}
          </div>
        )}
        <button className="c-btn c-btn-prim c-btn-bloco" style={{ marginTop: 10 }}
          disabled={criar.isPending || f.descricao.trim().length < 2 || !(+f.valor > 0) || (produtoId > 0 && !(quantidade > 0)) || (formaPag === "Parcelado" && !(valorPago > 0 && valorPago < f.valor))}
          onClick={() => {
            user && criar.mutate({
              usuarioId: user.id, dataDia: dataLanc,
              categoria: f.categoria as (typeof CATS_DESPESA)[number],
              descricao: f.descricao, fornecedor: f.fornecedor || undefined, fornecedorTel: f.fornecedorTel || undefined, valor: +f.valor,
              tipoCusto, formaPagamento: formaPag,
              valorPago: formaPag === "Parcelado" ? valorPago : undefined,
              produtoId: produtoId > 0 ? produtoId : undefined,
              quantidade: produtoId > 0 && quantidade > 0 ? quantidade : undefined,
            });
            setDia(dataLanc);
          }}>
          {criar.isPending ? "A lançar…" : produtoId > 0 ? "💾 Lançar despesa + entrada no stock 📦" : "💾 Lançar despesa"}
        </button>
      </div>

      {/* consulta por dia */}
      <div className="c-card">
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
          <label className="c-label" style={{ margin: 0 }}>Ver dia:</label>
          <input className="c-input" type="date" style={{ maxWidth: 170 }} value={dia} max={hoje()}
            onChange={(e) => setDia(e.target.value || hoje())} />
        </div>
        <div className="c-total-linha" style={{ marginBottom: 6 }}>
          <span>Total de despesas em {diaBR(dia)}</span>
          <b style={{ color: "var(--vermelho-c)" }}>{mt(totalDia)}</b>
        </div>
        {lista.isLoading && <Vazio icon="⏳">A carregar…</Vazio>}
        {!lista.isLoading && itens.length === 0 && <Vazio icon="💸">Sem despesas lançadas neste dia.</Vazio>}
        {itens.map((d) => {
          const podeApagar = isGestao || (d.usuarioId === user?.id && d.dataDia === hoje());
          const selo = seloPag(d);
          return (
            <div className="c-linha" key={d.id}>
              <span style={{ fontSize: 18 }}>{ICON_CAT[d.categoria] ?? "📦"}</span>
              <div className="grow">
                <div className="tit">{d.descricao}</div>
                <div className="det">
                  {d.categoria} · {d.tipoCusto === "Fixo" ? "🏢 Fixo" : "🔄 Variável"}
                  {d.produtoId && d.quantidade ? ` · 📦 +${fmt(d.quantidade)} no stock` : ""}
                  {d.fornecedor ? ` · ${d.fornecedor}` : ""} · por {d.usuarioNome}
                </div>
                <div className="det" style={{ marginTop: 2 }}>
                  <b style={{ color: selo.cor }}>{selo.txt}</b>
                  {selo.falta > 0
                    ? <> · pago {mt(selo.pago)} · <b style={{ color: "var(--vermelho-c)" }}>falta {mt(selo.falta)}</b></>
                    : <> · {mt(d.valor)} pagos</>}
                </div>
              </div>
              <div className="fim" style={{ textAlign: "right" }}>
                <b>{mt(d.valor)}</b>
                <div style={{ display: "flex", gap: 4, marginTop: 4, justifyContent: "flex-end" }}>
                  {selo.falta > 0 && (isGestao || d.usuarioId === user?.id) && (
                    <button className="c-btn c-btn-verde c-btn-peq" title="Registar pagamento desta dívida"
                      disabled={amortizar.isPending}
                      onClick={() => {
                        const v = prompt(`Amortizar «${d.descricao}»\nFalta pagar: ${fmt(selo.falta)} MZN\n\nQuanto vai pagar agora?`, String(selo.falta));
                        const val = v ? +v.replace(",", ".") : 0;
                        if (val > 0 && user) amortizar.mutate({ usuarioId: user.id, id: d.id, valor: val });
                        else if (v !== null) toast("⚠️ Valor inválido.");
                      }}>
                      💰 Amortizar
                    </button>
                  )}
                  {podeApagar && (
                    <button className="c-btn c-btn-perigo c-btn-peq"
                      onClick={() => { if (confirm(`Eliminar «${d.descricao}» (${mt(d.valor)})?`)) user && eliminar.mutate({ usuarioId: user.id, id: d.id }); }}>
                      ✕
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* relatório por período */}
      {isGestao && (
        <div className="c-card" style={{ borderLeft: "4px solid var(--roxo)" }}>
          <div className="c-titulo" style={{ fontSize: 15 }}>🖨️ Relatório de despesas (fixos × variáveis)</div>
          <p className="c-sub" style={{ marginTop: -4 }}>
            Imprima ou baixe em PDF as despesas do <b>dia, semana, mês ou ano</b> (com base no dia seleccionado acima: {diaBR(dia)}).
          </p>
          {(["dia", "semana", "mes", "ano"] as const).map((t) => (
            <div key={t} className="c-linha" style={{ padding: "6px 0" }}>
              <div className="grow tit">
                {t === "dia" ? "📅 Diário" : t === "semana" ? "🗓️ Semanal" : t === "mes" ? "📆 Mensal" : "📊 Anual"}
                <span className="c-sub"> · {periodo(t, dia).rotulo}</span>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button className="c-btn c-btn-linha c-btn-peq" disabled={gerandoRel}
                  onClick={() => void gerarRelatorio(t, "print")}>🖨️ Imprimir</button>
                <button className="c-btn c-btn-cinza c-btn-peq" disabled={gerandoRel}
                  onClick={() => void gerarRelatorio(t, "pdf")}>⬇️ PDF</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <ComprovativosDia dia={dia} />
    </div>
  );
}

/* ============ COMPROVATIVOS DE COMPRAS DO DIA ============ */
function ComprovativosDia({ dia }: { dia: string }) {
  const { user, toast } = useSession();
  const utils = trpc.useUtils();
  const [nota, setNota] = useState("");
  const [verImg, setVerImg] = useState<string | null>(null);

  const anexos = trpc.despesas.anexosDia.useQuery(
    { usuarioId: user?.id ?? 0, dataDia: dia },
    { enabled: !!user },
  );

  const anexar = trpc.despesas.anexarComprovativo.useMutation({
    onSuccess: () => { toast("📎 Comprovativo anexado!"); utils.despesas.anexosDia.invalidate(); },
    onError: (e) => toast("⚠️ " + e.message),
  });
  const semCompr = trpc.despesas.semComprovativo.useMutation({
    onSuccess: () => { toast("📝 Compra sem comprovativo registada!"); setNota(""); utils.despesas.anexosDia.invalidate(); },
    onError: (e) => toast("⚠️ " + e.message),
  });
  const eliminarAnexo = trpc.despesas.eliminarAnexo.useMutation({
    onSuccess: () => { toast("Anexo eliminado"); utils.despesas.anexosDia.invalidate(); },
    onError: (e) => toast("⚠️ " + e.message),
  });

  const onFicheiro = async (file: File | undefined) => {
    if (!file || !user) return;
    const dataUrl = await fileToDataUrl(file);
    anexar.mutate({ usuarioId: user.id, dataDia: dia, imagem: dataUrl, nota: nota.trim() || undefined });
    setNota("");
  };

  const listaAnx = anexos.data ?? [];
  return (
    <div className="c-card">
      <div className="c-titulo" style={{ fontSize: 15 }}>📎 Comprovativos de compras — {diaBR(dia)}</div>
      <p className="c-sub" style={{ marginTop: -4 }}>
        Anexe aqui os comprovativos das compras do dia (vale para todas as compras, não por produto).
        Se uma compra não tiver comprovativo, registe uma nota a explicar.
      </p>
      <label className="c-label">Nota (opcional com foto · obrigatória sem comprovativo)</label>
      <input className="c-input" placeholder="Ex.: Compra de gás no vizinho — sem talão"
        value={nota} onChange={(e) => setNota(e.target.value)} />
      <div style={{ marginTop: 6 }}>
        <UploadFicheiro disabled={anexar.isPending}
          rotulo={anexar.isPending ? "A enviar…" : "Anexe o comprovativo da compra (foto ou documento):"}
          onFicheiro={(f) => void onFicheiro(f)} />
        <button className="c-btn c-btn-linha c-btn-bloco" style={{ marginTop: 6 }}
          disabled={semCompr.isPending || nota.trim().length < 3}
          onClick={() => user && semCompr.mutate({ usuarioId: user.id, dataDia: dia, nota: nota.trim() })}>
          📝 Compra sem comprovativo
        </button>
      </div>

      {listaAnx.length > 0 && <hr style={{ border: "none", borderTop: "1px dashed #ddd", margin: "12px 0 8px" }} />}
      {listaAnx.map((x) => (
        <div className="c-linha" key={x.id}>
          <span style={{ fontSize: 18 }}>{x.imagem ? (x.imagem.startsWith("data:application/pdf") ? "📄" : "🧾") : "📝"}</span>
          <div className="grow">
            <div className="tit">{x.nota || (x.imagem ? "Comprovativo de compra" : "Compra sem comprovativo")}</div>
            <div className="det">por {x.usuarioNome}</div>
          </div>
          <div className="fim" style={{ display: "flex", gap: 6 }}>
            {x.imagem && (
              <button className="c-btn c-btn-linha c-btn-peq" onClick={() => setVerImg(x.imagem)}>👁 Ver</button>
            )}
            <button className="c-btn c-btn-perigo c-btn-peq"
              onClick={() => { if (confirm("Eliminar este anexo?")) user && eliminarAnexo.mutate({ usuarioId: user.id, id: x.id }); }}>
              ✕
            </button>
          </div>
        </div>
      ))}

      {verImg && (
        <div onClick={() => setVerImg(null)} style={{
          position: "fixed", inset: 0, zIndex: 100, background: "rgba(0,0,0,.75)",
          display: "flex", alignItems: "center", justifyContent: "center", padding: 16, cursor: "zoom-out",
        }}>
          {verImg.startsWith("data:application/pdf") ? (
            <iframe src={verImg} title="Comprovativo PDF"
              style={{ width: "100%", height: "100%", border: "none", borderRadius: 10, background: "#fff" }} />
          ) : (
            <img src={verImg} alt="Comprovativo" style={{ maxWidth: "100%", maxHeight: "100%", borderRadius: 10 }} />
          )}
        </div>
      )}
    </div>
  );
}
