import { useMemo, useState } from "react";
import { trpc } from "@/providers/trpc";
import { useSession } from "@/lib/session";
import { dataBR, horaBR, diaBR, hoje, mt } from "@/lib/fmt";
import { Modal, Vazio, Voltar } from "@/components/bits";
import { printDoc, downloadPdf } from "@/lib/docprint";
import { useEmpresa } from "@/lib/empresa";

type Prod = {
  id: number; codigo: string; nome: string; categoria: string; tipo: string; preco: number;
  precoCompra?: number; // custo de compra — base do valor ao custo
  estoqueMin: number; estoqueAtual: number;
  estoqueRefId?: number | null; fraccao?: number; qtdDecimal?: boolean;
};

/** 9,75 (fracções de aves, kg) — sem zeros à direita */
const fmtQtd = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(".", ",").replace(/,?0+$/, ""));
/** Formata com fracções vulgares: 9,75 → "9¾ (9 inteiros + 3/4)" — ideal p/ aves. */
const fmtFrac = (n: number) => {
  const inteiro = Math.floor(n + 1e-9);
  const resto = Math.round((n - inteiro) * 4); // precisão de 1/4
  const FR: Record<number, string> = { 1: "¼", 2: "½", 3: "¾" };
  if (resto === 0) return `${inteiro}`;
  if (resto === 4) return `${inteiro + 1}`;
  const simb = FR[resto];
  const fracTxt = resto === 2 ? "1/2" : `${resto}/4`;
  return `${inteiro > 0 ? inteiro : ""}${simb} (${inteiro} ${inteiro === 1 ? "inteiro" : "inteiros"} + ${fracTxt})`;
};

export default function Estoque({ voltar }: { voltar: () => void }) {
  const { user, toast } = useSession();
  const utils = trpc.useUtils();
  const produtos = trpc.produtos.list.useQuery();
  const movs = trpc.stock.movimentos.useQuery();
  const [busca, setBusca] = useState("");
  const [entrada, setEntrada] = useState<Prod | null>(null);
  const [ajuste, setAjuste] = useState<Prod | null>(null);
  const [producao, setProducao] = useState<Prod | null>(null); // 🍹 saída p/ produção (bar/cozinha)
  const [qtd, setQtd] = useState(50);
  const [qtdAjuste, setQtdAjuste] = useState(0);
  const [qtdProd, setQtdProd] = useState(1);
  const [obs, setObs] = useState("");
  const [baixandoStock, setBaixandoStock] = useState(false);
  // histórico de inventário por período (saídas, quem vendeu, entradas e ajustes)
  const [deData, setDeData] = useState(hoje().slice(0, 8) + "01");
  const [ateData, setAteData] = useState(hoje());
  const [filtroTipo, setFiltroTipo] = useState("Todos");
  const [baixandoRel, setBaixandoRel] = useState(false);
  // 💰 valor do stock em dinheiro — ver a preço de custo ou de venda
  const [modoPreco, setModoPreco] = useState<"custo" | "venda">("custo");
  const [verValor, setVerValor] = useState(false);
  const [baixandoValor, setBaixandoValor] = useState(false);

  const addAjuste = trpc.stock.ajustar.useMutation({
    onSuccess: (r) => {
      toast(`✏️ Stock definido: ${r.antes} → ${r.depois} un.`);
      setAjuste(null); setObs("");
      utils.produtos.list.invalidate(); utils.stock.movimentos.invalidate(); utils.dashboard.stats.invalidate();
    },
    onError: (e) => toast("⚠️ " + e.message),
  });

  const addProducao = trpc.stock.saidaProducao.useMutation({
    onSuccess: (r) => {
      toast(`🍹 Saída p/ produção registada — ficam ${fmtQtd(r.ficou)} un. em stock.`);
      setProducao(null); setObs("");
      utils.produtos.list.invalidate(); utils.stock.movimentos.invalidate(); utils.dashboard.stats.invalidate();
    },
    onError: (e) => toast("⚠️ " + e.message),
  });

  const addEntrada = trpc.stock.entrada.useMutation({
    onSuccess: () => {
      toast(`+${qtd} un. adicionadas!`);
      setEntrada(null); setObs("");
      utils.produtos.list.invalidate(); utils.stock.movimentos.invalidate(); utils.dashboard.stats.invalidate();
    },
    onError: (e) => toast("⚠️ " + e.message),
  });

  const lista = useMemo(
    () => (produtos.data ?? []).filter((p) => p.tipo !== "Serviço")
      .filter((p) => p.nome.toLowerCase().includes(busca) || p.categoria.toLowerCase().includes(busca)),
    [produtos.data, busca],
  );
  const baixos = lista.filter((p) => p.estoqueAtual <= p.estoqueMin);

  /** 💰 Valor do stock em dinheiro — calculado no momento a partir do stock actual.
      Só entram os produtos DONOS do stock (as fracções 1/4 e 1/2 vivem no produto
      «mãe» — contar as duas coisas duplicaria o valor). Serviços não têm stock. */
  const valorStock = useMemo(() => {
    const todos = produtos.data ?? [];
    const donos = todos.filter((p) => p.tipo !== "Serviço" && !p.estoqueRefId);
    const linhas = donos.map((p) => ({
      id: p.id, codigo: p.codigo, nome: p.nome, categoria: p.categoria,
      qtd: p.estoqueAtual, kg: !!p.qtdDecimal,
      eMae: todos.some((x) => x.estoqueRefId === p.id),
      precoC: p.precoCompra ?? 0, precoV: p.preco,
      vCusto: Math.round(p.estoqueAtual * (p.precoCompra ?? 0) * 100) / 100,
      vVenda: Math.round(p.estoqueAtual * p.preco * 100) / 100,
    })).sort((a, b) => a.nome.localeCompare(b.nome));
    const porCat = new Map<string, typeof linhas>();
    for (const l of linhas) {
      const a = porCat.get(l.categoria) ?? [];
      a.push(l); porCat.set(l.categoria, a);
    }
    return {
      cats: [...porCat.entries()].sort((a, b) => a[0].localeCompare(b[0])),
      totC: Math.round(linhas.reduce((a, l) => a + l.vCusto, 0) * 100) / 100,
      totV: Math.round(linhas.reduce((a, l) => a + l.vVenda, 0) * 100) / 100,
      semCusto: linhas.filter((l) => l.precoC <= 0 && l.qtd > 0).length,
      n: linhas.length,
    };
  }, [produtos.data]);

  // v17: vendedores só CONSULTAM o stock — entradas/ajustes são da gestão/logística
  // v28: Admin e Logística sempre; Gestor só com autorização do Admin (⚙️ Configurações)
  const podeEditar = !!user && (user.perfil === "Admin" || user.perfil === "Logistica" || (user.perfil === "Gestor" && !!user.podeEditarStock));
  // 🍹 saída para produção: quem opera (bar/cozinha) regista o que abre p/ produzir — não precisa de autorização de stock
  const podeProduzir = !!user && ["Admin", "Gestor", "Logistica", "Vendedor", "Cozinha"].includes(user.perfil);
  // o histórico de inventário é de gestão: vendedores não o veem
  const podeVerRelatorio = !!user && ["Admin", "Gestor", "Logistica"].includes(user.perfil);
  const rel = trpc.stock.relatorioPeriodo.useQuery(
    { usuarioId: user?.id ?? 0, de: deData, ate: ateData },
    { enabled: podeVerRelatorio },
  );
  const emp = useEmpresa();

  /** filtro por tipo de movimento (detalhe cronológico) */
  const GRUPOS: Record<string, string[]> = {
    "Todos": [],
    "Vendas": ["Venda"],
    "Entradas e compras": ["Entrada", "Compra", "Reposição"],
    "Ajustes de inventário": ["Ajuste de inventário"],
    "Consumo da gerência": ["Consumo gerência"],
    "Produção (bar/cozinha)": ["Produção"],
    "Online e reservas": ["Venda online", "Reserva", "Saída"],
  };
  const linhasRel = (rel.data?.linhas ?? []).filter((l) => {
    const g = GRUPOS[filtroTipo];
    return !g?.length || g.includes(l.tipo);
  });
  const chipDoTipo = (t: string) =>
    t === "Venda" || t === "Venda online" || t === "Reserva" || t === "Saída" || t === "Produção" ? "c-chip-vermelho"
    : t === "Consumo gerência" ? "c-chip-amarelo"
    : t === "Ajuste de inventário" ? "c-chip-cinza" : "c-chip-verde";
  const sinalDoTipo = (t: string) =>
    t === "Venda" || t === "Venda online" || t === "Reserva" || t === "Saída" || t === "Produção" || t === "Consumo gerência" ? "−" : "+";

  /** Documento A4 do histórico (impressão e PDF) — resumo por produto + detalhe dia a dia */
  const gerarRelatorioDoc = () => {
    const agora = new Date(Date.now() + 2 * 3600e3);
    const resumo = rel.data?.resumo ?? [];
    const linResumo = resumo.map((r) => `<tr>
      <td>${r.produto}</td>
      <td style="text-align:center"><b>${fmtQtd(r.vendido + r.online)}</b></td>
      <td style="text-align:right">${r.valorVendido > 0 ? mt(r.valorVendido) : "—"}</td>
      <td style="text-align:center">${r.entradas + r.compras > 0 ? "+" + fmtQtd(r.entradas + r.compras) : "—"}</td>
      <td style="text-align:center">${r.reposicoes > 0 ? "+" + fmtQtd(r.reposicoes) : "—"}</td>
      <td style="text-align:center">${r.producao > 0 ? "−" + fmtQtd(r.producao) : "—"}</td>
      <td style="text-align:center">${r.gerencia > 0 ? "−" + fmtQtd(r.gerencia) : "—"}</td>
      <td style="text-align:center;${r.ajustes > 0 ? "background:#fff3cd;font-weight:bold" : ""}">${r.ajustes > 0 ? r.ajustes : "—"}</td>
      <td style="text-align:center">${r.stockAtual != null ? fmtQtd(r.stockAtual) : "—"}</td>
    </tr>`).join("");
    const linDet = linhasRel.map((l) => `<tr>
      <td style="white-space:nowrap">${diaBR(l.data)}${l.hora ? " " + l.hora : ""}</td>
      <td>${l.produto}</td>
      <td>${l.tipo}</td>
      <td style="text-align:center">${sinalDoTipo(l.tipo) === "−" ? "−" : "+"}${fmtQtd(l.qtd)}</td>
      <td>${l.quem}</td>
      <td style="font-size:8.5pt;color:#444">${l.ref || "—"}</td>
    </tr>`).join("");
    const body = `
      <h2 style="margin:0 0 2px;color:#1F4E79">${emp?.nome ?? "CAMI'S EVENTOS"}</h2>
      <div style="font-size:9pt;color:#555">${[`NUIT: ${emp.nuit}`, emp.local, `${emp.tel1} · ${emp.tel2}`].join(" · ")}</div>
      <hr style="border:none;border-top:2px solid #1F4E79;margin:6px 0 10px" />
      <h3 style="margin:0 0 4px">Histórico de inventário — ${diaBR(deData)} a ${diaBR(ateData)}</h3>
      <p style="font-size:9pt;color:#555">Gerado em ${agora.toISOString().slice(0, 10).split("-").reverse().join("/")} às ${agora.toISOString().slice(11, 16)} por ${user?.nome ?? ""} · Filtro: ${filtroTipo}</p>
      <p style="font-size:10pt;margin:8px 0 4px"><b>Resumo por produto</b></p>
      <table style="border-collapse:collapse;width:100%;font-size:9pt">
        <tr style="background:#1F4E79;color:#fff">
          <th style="padding:5px;border:1px solid #999;text-align:left">Produto</th>
          <th style="padding:5px;border:1px solid #999">Saídas</th>
          <th style="padding:5px;border:1px solid #999">Valor vendido</th>
          <th style="padding:5px;border:1px solid #999">Entradas</th>
          <th style="padding:5px;border:1px solid #999">Reposições</th>
          <th style="padding:5px;border:1px solid #999">Produção</th>
          <th style="padding:5px;border:1px solid #999">Gerência</th>
          <th style="padding:5px;border:1px solid #999">Ajustes</th>
          <th style="padding:5px;border:1px solid #999">Stock actual</th>
        </tr>${linResumo}
      </table>
      <p style="font-size:10pt;margin:12px 0 4px"><b>Movimentos dia a dia</b> (data · produto · tipo · quantidade · quem registou · referência)</p>
      <table style="border-collapse:collapse;width:100%;font-size:9pt">
        <tr style="background:#1F4E79;color:#fff">
          <th style="padding:5px;border:1px solid #999;text-align:left">Data</th>
          <th style="padding:5px;border:1px solid #999;text-align:left">Produto</th>
          <th style="padding:5px;border:1px solid #999;text-align:left">Tipo</th>
          <th style="padding:5px;border:1px solid #999">Qtd</th>
          <th style="padding:5px;border:1px solid #999;text-align:left">Quem</th>
          <th style="padding:5px;border:1px solid #999;text-align:left">Referência</th>
        </tr>${linDet}
      </table>
      <p style="font-size:8.5pt;color:#666;margin-top:10px">Documento interno para conferência de inventário. «Saídas» soma as vendas de balcão com as vendas online/reservas; «Produção» são produtos abertos para produzir (bar/cozinha) — saem do stock sem serem venda; linhas de vendas online, reservas, gerência e ajustes usam unidades de armazém (produtos fraccionados contam na unidade inteira). Ajustes a amarelo no resumo indicam correcções manuais de stock no período.</p>`;
    return { titulo: `Inventário ${diaBR(deData)} a ${diaBR(ateData)}`, body };
  };

  const imprimirRelatorio = () => {
    const d = gerarRelatorioDoc();
    printDoc(d.titulo, d.body);
  };
  const baixarRelatorio = async () => {
    setBaixandoRel(true);
    try {
      const d = gerarRelatorioDoc();
      await downloadPdf(d.titulo, d.body, `${d.titulo}.pdf`);
    } finally { setBaixandoRel(false); }
  };

  /** Documento A4 «Valor do stock em dinheiro» — por produto e categoria,
      ao custo e à venda, com subtotais e o total geral */
  const gerarValorDoc = () => {
    const agora = new Date(Date.now() + 2 * 3600e3);
    const qtdDe = (l: { qtd: number; kg: boolean; eMae: boolean }) =>
      l.kg ? `${fmtQtd(l.qtd)} kg` : l.eMae ? `${fmtFrac(l.qtd)} un.` : `${fmtQtd(l.qtd)} un.`;
    const blocos = valorStock.cats.map(([cat, ls]) => {
      const sC = ls.reduce((a, l) => a + l.vCusto, 0);
      const sV = ls.reduce((a, l) => a + l.vVenda, 0);
      const lin = ls.map((l) => `<tr>
        <td>${l.codigo}</td><td>${l.nome}</td>
        <td style="text-align:center">${qtdDe(l)}</td>
        <td style="text-align:right">${l.precoC > 0 ? mt(l.precoC) : "—"}</td>
        <td style="text-align:right"><b>${l.vCusto > 0 ? mt(l.vCusto) : "—"}</b></td>
        <td style="text-align:right">${mt(l.precoV)}</td>
        <td style="text-align:right"><b>${mt(l.vVenda)}</b></td>
      </tr>`).join("");
      return `
        <p style="font-size:10.5pt;margin:12px 0 3px;background:#eaf1f8;padding:4px 6px;border-left:4px solid #1F4E79">
          <b>${cat}</b> — ao custo <b>${mt(sC)}</b> · à venda <b>${mt(sV)}</b>
        </p>
        <table style="border-collapse:collapse;width:100%;font-size:9pt">
          <tr style="background:#1F4E79;color:#fff">
            <th style="padding:4px;border:1px solid #999;text-align:left">Código</th>
            <th style="padding:4px;border:1px solid #999;text-align:left">Produto</th>
            <th style="padding:4px;border:1px solid #999">Em stock</th>
            <th style="padding:4px;border:1px solid #999">P. compra</th>
            <th style="padding:4px;border:1px solid #999">Valor (custo)</th>
            <th style="padding:4px;border:1px solid #999">P. venda</th>
            <th style="padding:4px;border:1px solid #999">Valor (venda)</th>
          </tr>${lin}
          <tr style="background:#f2f2f2;font-weight:bold">
            <td colspan="4" style="padding:4px;border:1px solid #999;text-align:right">Subtotal ${cat}</td>
            <td style="padding:4px;border:1px solid #999;text-align:right">${mt(sC)}</td>
            <td style="padding:4px;border:1px solid #999"></td>
            <td style="padding:4px;border:1px solid #999;text-align:right">${mt(sV)}</td>
          </tr>
        </table>`;
    }).join("");
    const body = `
      <h2 style="margin:0 0 2px;color:#1F4E79">${emp?.nome ?? "CAMI'S EVENTOS"}</h2>
      <div style="font-size:9pt;color:#555">${[`NUIT: ${emp.nuit}`, emp.local, `${emp.tel1} · ${emp.tel2}`].join(" · ")}</div>
      <hr style="border:none;border-top:2px solid #1F4E79;margin:6px 0 10px" />
      <h3 style="margin:0 0 4px">💰 Valor do stock em dinheiro</h3>
      <p style="font-size:9pt;color:#555">Calculado em ${agora.toISOString().slice(0, 10).split("-").reverse().join("/")} às ${agora.toISOString().slice(11, 16)} por ${user?.nome ?? ""} · ${valorStock.n} produtos com stock</p>
      <table style="border-collapse:collapse;width:100%;font-size:10pt;margin:6px 0 4px">
        <tr>
          <td style="border:1px solid #999;padding:8px;background:#eaf1f8;width:33%"><b>VALOR AO CUSTO</b><br /><span style="font-size:14pt;color:#1F4E79"><b>${mt(valorStock.totC)}</b></span><br /><span style="font-size:8pt;color:#666">quanto a casa investiu no stock actual</span></td>
          <td style="border:1px solid #999;padding:8px;background:#e9f7ef;width:33%"><b>VALOR À VENDA</b><br /><span style="font-size:14pt;color:#1e8449"><b>${mt(valorStock.totV)}</b></span><br /><span style="font-size:8pt;color:#666">quanto entra em caixa se vender tudo</span></td>
          <td style="border:1px solid #999;padding:8px;background:#fef9e7;width:33%"><b>MARGEM POTENCIAL</b><br /><span style="font-size:14pt;color:#9a7d0a"><b>${mt(valorStock.totV - valorStock.totC)}</b></span><br /><span style="font-size:8pt;color:#666">diferença venda − custo</span></td>
        </tr>
      </table>
      ${valorStock.semCusto > 0 ? `<p style="font-size:8.5pt;color:#9a3412">⚠️ ${valorStock.semCusto} produto(s) com stock mas SEM preço de compra — o valor ao custo fica incompleto. Defina o preço de compra em 📦 Produtos → ✏️ Editar.</p>` : ""}
      ${blocos}
      <p style="font-size:11pt;margin-top:12px;padding:6px;background:#1F4E79;color:#fff"><b>TOTAL GERAL — ao custo: ${mt(valorStock.totC)} · à venda: ${mt(valorStock.totV)} · margem: ${mt(valorStock.totV - valorStock.totC)}</b></p>
      <p style="font-size:8.5pt;color:#666;margin-top:8px">Documento interno. Só contam os produtos donos do stock — as fracções (1/4, 1/2 de aves) estão incluídas no produto principal, em unidades inteiras; serviços (piscina, salão) não têm stock. O valor à venda é o potencial de facturação do stock actual, antes de descontos.</p>`;
    return { titulo: `Valor do stock — ${agora.toISOString().slice(0, 10)}`, body };
  };
  const imprimirValor = () => {
    const d = gerarValorDoc();
    printDoc(d.titulo, d.body);
  };
  const baixarValor = async () => {
    setBaixandoValor(true);
    try {
      const d = gerarValorDoc();
      await downloadPdf(d.titulo, d.body, `${d.titulo}.pdf`);
    } finally { setBaixandoValor(false); }
  };

  /** Imprimir o stock actual em PDF (A4) — agrupado por categoria, com mínimos e alertas */
  const gerarStockDoc = () => {
    const agora = new Date(Date.now() + 2 * 3600e3);
    const linhas = lista.map((p) => {
      const mae = p.estoqueRefId ? (produtos.data ?? []).find((x) => x.id === p.estoqueRefId) : null;
      const fr = p.fraccao ?? 1;
      const efetivo = mae ? mae.estoqueAtual / fr : p.estoqueAtual;
      const baixo = mae ? mae.estoqueAtual <= (p.estoqueMin || mae.estoqueMin) : p.estoqueAtual <= p.estoqueMin;
      const qtd = mae ? `${fmtQtd(efetivo)} porções` : p.qtdDecimal ? `${fmtQtd(p.estoqueAtual)} kg` : (produtos.data ?? []).some((x) => x.estoqueRefId === p.id) ? `${fmtFrac(p.estoqueAtual)} un.` : `${fmtQtd(p.estoqueAtual)} un.`;
      return `<tr style="background:${baixo ? "#fde8e8" : "#fff"}">
        <td>${p.codigo}</td><td>${p.nome}</td><td>${p.categoria}</td>
        <td style="text-align:center">${p.estoqueMin}</td>
        <td style="text-align:center"><b>${qtd}</b></td>
        <td style="text-align:center">${baixo ? "⚠️ REPOR" : "OK"}</td></tr>`;
    }).join("");
    const body = `
      <h2 style="margin:0 0 2px;color:#1F4E79">${emp?.nome ?? "CAMI'S EVENTOS"}</h2>
      <div style="font-size:9pt;color:#555">${[`NUIT: ${emp.nuit}`, emp.local, `${emp.tel1} · ${emp.tel2}`].join(" · ")}</div>
      <hr style="border:none;border-top:2px solid #1F4E79;margin:6px 0 10px" />
      <p style="font-size:10pt;color:#555">Stock actual/ajustado em ${agora.toISOString().slice(0, 10).split("-").reverse().join("/")} às ${agora.toISOString().slice(11, 16)} · ${lista.length} produtos · ${baixos.length} abaixo do limite</p>
      <table style="border-collapse:collapse;width:100%;font-size:9.5pt">
        <tr style="background:#1F4E79;color:#fff">
          <th style="padding:5px;border:1px solid #999;text-align:left">Código</th>
          <th style="padding:5px;border:1px solid #999;text-align:left">Produto</th>
          <th style="padding:5px;border:1px solid #999;text-align:left">Categoria</th>
          <th style="padding:5px;border:1px solid #999">Mínimo</th>
          <th style="padding:5px;border:1px solid #999">Stock actual</th>
          <th style="padding:5px;border:1px solid #999">Estado</th>
        </tr>${linhas}
      </table>
      <p style="font-size:8.5pt;color:#666;margin-top:10px">Documento interno — conferência de inventário. Linhas a vermelho: produtos abaixo do limite mínimo.</p>`;
    return { titulo: `Stock actual — ${agora.toISOString().slice(0, 10)}`, body };
  };

  const imprimirStock = () => {
    const d = gerarStockDoc();
    printDoc(d.titulo, d.body);
  };

  const baixarStock = async () => {
    setBaixandoStock(true);
    try {
      const d = gerarStockDoc();
      await downloadPdf(d.titulo, d.body, `${d.titulo}.pdf`);
    } finally { setBaixandoStock(false); }
  };

  // stock actual do produto em ajuste (em porções, para produtos fraccionados)
  const atualAjuste = ajuste
    ? ajuste.estoqueRefId
      ? Math.round((((produtos.data ?? []).find((x) => x.id === ajuste.estoqueRefId)?.estoqueAtual ?? 0) / (ajuste.fraccao ?? 1)) * 100) / 100
      : ajuste.estoqueAtual
    : 0;

  return (
    <div>
      <Voltar onClick={voltar} />
      <div className="c-titulo" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        📋 Gestão de Estoque
        <button className="c-btn c-btn-linha c-btn-peq" onClick={() => void baixarStock()} disabled={baixandoStock} title="Baixa o stock actual em PDF no formato A4">
          {baixandoStock ? "A gerar…" : "⬇️ Baixar stock (A4)"}
        </button>
        <button className="c-btn c-btn-prim c-btn-peq" onClick={imprimirStock} title="Imprime (ou guarda em PDF) o stock actual, agrupado e com alertas">
          🖨️ Imprimir stock (PDF)
        </button>
      </div>
      {user?.perfil === "Gestor" && !user.podeEditarStock && (
        <div className="c-card" style={{ borderLeft: "4px solid var(--amarelo-c)", fontSize: 13 }}>
          🔒 Para fazer entradas ou ajustes de stock, peça autorização ao <b>Administrador</b> (⚙️ Configurações → o seu utilizador → «Pode editar o stock»).
        </div>
      )}
      {baixos.length > 0 ? (
        <div className="c-card" style={{ borderLeft: "4px solid var(--vermelho-c)" }}>
          <b style={{ color: "var(--vermelho-c)" }}>⚠️ {baixos.length} produto(s) abaixo do limite</b>
        </div>
      ) : (
        <div className="c-card" style={{ borderLeft: "4px solid var(--verde-c)" }}>
          <b style={{ color: "var(--verde-c)" }}>✔ Estoque dentro dos limites</b>
        </div>
      )}

      {podeVerRelatorio && valorStock.n > 0 && (
        <div className="c-card" style={{ borderLeft: "4px solid var(--verde-c)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
            <b>💰 Valor do stock em dinheiro</b>
            <span style={{ display: "flex", gap: 6 }}>
              <button className="c-btn c-btn-linha c-btn-peq" onClick={() => void baixarValor()} disabled={baixandoValor} title="Baixa o valor do stock em PDF (A4), por produto e categoria">
                {baixandoValor ? "A gerar…" : "⬇️ Baixar (A4)"}
              </button>
              <button className="c-btn c-btn-prim c-btn-peq" onClick={imprimirValor} title="Imprime (ou guarda em PDF) o valor do stock por produto e categoria">
                🖨️ Imprimir
              </button>
            </span>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
            <div style={{ flex: "1 1 140px", background: "#eaf1f8", borderRadius: 8, padding: "8px 10px" }}>
              <div style={{ fontSize: 11, color: "#1F4E79" }}><b>AO CUSTO</b> (investido)</div>
              <div style={{ fontSize: 19, color: "#1F4E79" }}><b>{mt(valorStock.totC)}</b></div>
            </div>
            <div style={{ flex: "1 1 140px", background: "#e9f7ef", borderRadius: 8, padding: "8px 10px" }}>
              <div style={{ fontSize: 11, color: "#1e8449" }}><b>À VENDA</b> (potencial)</div>
              <div style={{ fontSize: 19, color: "#1e8449" }}><b>{mt(valorStock.totV)}</b></div>
            </div>
            <div style={{ flex: "1 1 140px", background: "#fef9e7", borderRadius: 8, padding: "8px 10px" }}>
              <div style={{ fontSize: 11, color: "#9a7d0a" }}><b>MARGEM</b> potencial</div>
              <div style={{ fontSize: 19, color: "#9a7d0a" }}><b>{mt(valorStock.totV - valorStock.totC)}</b></div>
            </div>
          </div>
          {valorStock.semCusto > 0 && (
            <div style={{ fontSize: 12, color: "#9a3412", marginTop: 6 }}>
              ⚠️ {valorStock.semCusto} produto(s) com stock mas <b>sem preço de compra</b> — o valor ao custo fica incompleto. Defina em 📦 Produtos → ✏️ Editar.
            </div>
          )}
          <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap", alignItems: "center" }}>
            <button className={`c-btn c-btn-peq ${modoPreco === "custo" ? "c-btn-prim" : "c-btn-cinza"}`} onClick={() => setModoPreco("custo")}>Ver a preço de custo</button>
            <button className={`c-btn c-btn-peq ${modoPreco === "venda" ? "c-btn-prim" : "c-btn-cinza"}`} onClick={() => setModoPreco("venda")}>Ver a preço de venda</button>
            <button className="c-btn c-btn-linha c-btn-peq" onClick={() => setVerValor(!verValor)}>
              {verValor ? "▲ Esconder detalhe" : "▼ Ver por categoria e produto"}
            </button>
          </div>
          {verValor && valorStock.cats.map(([cat, ls]) => {
            const sub = ls.reduce((a, l) => a + (modoPreco === "custo" ? l.vCusto : l.vVenda), 0);
            return (
              <div key={cat} style={{ marginTop: 10 }}>
                <div className="c-sub" style={{ borderLeft: "3px solid var(--azul-c, #1F4E79)", paddingLeft: 6 }}>
                  <b>{cat}</b> — {mt(sub)}
                </div>
                {ls.map((l) => (
                  <div className="c-linha" key={l.id} style={{ paddingTop: 4, paddingBottom: 4 }}>
                    <div className="grow">
                      <div className="tit" style={{ fontSize: 13 }}>{l.nome}</div>
                      <div className="det">
                        {l.kg ? `${fmtQtd(l.qtd)} kg` : l.eMae ? `${fmtFrac(l.qtd)} un.` : `${fmtQtd(l.qtd)} un.`}
                        {" × "}{mt(modoPreco === "custo" ? l.precoC : l.precoV)}
                        {modoPreco === "custo" && l.precoC <= 0 && " ⚠️ sem preço de compra"}
                      </div>
                    </div>
                    <b style={{ fontSize: 13 }}>{mt(modoPreco === "custo" ? l.vCusto : l.vVenda)}</b>
                  </div>
                ))}
              </div>
            );
          })}
          <div className="c-sub" style={{ marginTop: 8, fontSize: 11 }}>
            Fracções (1/4, 1/2 de aves) contam no produto principal; serviços não têm stock.
          </div>
        </div>
      )}

      <div style={{ position: "relative", marginBottom: 12 }}>
        <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", opacity: .6 }}>🔍</span>
        <input className="c-input" style={{ paddingLeft: 38 }} placeholder="Pesquisar produto…"
          onChange={(e) => setBusca(e.target.value.toLowerCase())} />
      </div>

      <div className="c-card">
        {produtos.isLoading && <Vazio icon="⏳">A carregar…</Vazio>}
        {lista.map((p) => {
          // stock fraccionário: o produto «mãe» (ex.: Frango inteiro) detém o stock;
          // as fracções (1/4, 1/2) mostram quantas porções saem do stock da mãe
          const mae = p.estoqueRefId ? (produtos.data ?? []).find((x) => x.id === p.estoqueRefId) : null;
          // a mãe é fraccionável se algum produto lhe apontar (ex.: frango com 1/4 e 1/2)
          const eMaeFracionavel = !p.estoqueRefId && (produtos.data ?? []).some((x) => x.estoqueRefId === p.id);
          const fr = p.fraccao ?? 1;
          const stockEfetivo = mae ? mae.estoqueAtual / fr : p.estoqueAtual;
          const baixo = mae ? mae.estoqueAtual <= (p.estoqueMin || mae.estoqueMin) : p.estoqueAtual <= p.estoqueMin;
          const pct = Math.min(100, Math.round(stockEfetivo / Math.max(p.estoqueMin * 5, 1) * 100));
          return (
            <div className="c-linha" key={p.id}>
              <div className="grow">
                <div className="tit">{p.nome} {baixo && "⚠️"}</div>
                <div className="det">
                  {p.categoria} · mínimo {p.estoqueMin} ·{" "}
                  {mae ? (
                    <>atual <b>{fmtQtd(stockEfetivo)}</b> porções (= {fmtFrac(mae.estoqueAtual)} {mae.nome})</>
                  ) : eMaeFracionavel ? (
                    <>atual <b>{fmtFrac(p.estoqueAtual)}</b> un.</>
                  ) : (
                    <>atual <b>{fmtQtd(p.estoqueAtual)}</b>{p.qtdDecimal ? " kg" : ""}</>
                  )}
                </div>
                <div className="c-barra"><i style={{ width: pct + "%", background: baixo ? "var(--vermelho-c)" : pct < 50 ? "var(--amarelo-c)" : "var(--verde-c)" }} /></div>
              </div>
              <div className="fim">
                <span className={`c-chip ${baixo ? "c-chip-vermelho" : "c-chip-verde"}`}>{baixo ? "Repor" : "OK"}</span><br />
                {podeProduzir && (
                  <button className="c-btn c-btn-linha c-btn-peq" style={{ marginTop: 5 }}
                    title="O produto foi ABERTO para produção (ex.: sumo p/ cocktails) — sai do stock na hora, sem ser venda"
                    onClick={() => { setProducao(p); setQtdProd(1); setObs(""); }}>🍹 Produção</button>
                )}
                {podeEditar && (
                  <>
                    <button className="c-btn c-btn-verde c-btn-peq" style={{ marginTop: 5 }}
                      onClick={() => { setEntrada(p); setQtd(50); }}>＋ Entrada</button>
                    <button className="c-btn c-btn-cinza c-btn-peq" style={{ marginTop: 5 }}
                      title="Definir a quantidade EXATA em stock (contagem física) — substitui o valor atual"
                      onClick={() => { setAjuste(p); setQtdAjuste(mae ? Math.round(mae.estoqueAtual / (p.fraccao ?? 1) * 100) / 100 : p.estoqueAtual); setObs(""); }}>✏️ Definir</button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="c-titulo" style={{ fontSize: 15 }}>Últimas Movimentações</div>
      <div className="c-card">
        {!movs.data?.length && <Vazio icon="📦">Sem movimentações.</Vazio>}
        {movs.data?.map((m) => (
          <div className="c-linha" key={m.id}>
            <div className="grow">
              <div className="tit">{m.produtoNome}</div>
              <div className="det">{m.criadoEm ? `${dataBR(m.criadoEm)} ${horaBR(m.criadoEm)}` : ""} · {m.usuarioNome}{m.obs ? ` · ${m.obs}` : ""}</div>
            </div>
            <span className={`c-chip ${m.tipo === "entrada" ? "c-chip-verde" : m.tipo === "saida" ? "c-chip-vermelho" : "c-chip-cinza"}`}>
              {m.tipo === "entrada" ? "+" : m.tipo === "ajuste" ? "⇄" : "−"}{fmtQtd(Number(m.qtd))}
            </span>
          </div>
        ))}
      </div>

      {podeVerRelatorio && (
        <>
          <div className="c-titulo" style={{ fontSize: 15, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
            <span>📊 Histórico por período (inventário)</span>
            <span style={{ display: "flex", gap: 6 }}>
              <button className="c-btn c-btn-linha c-btn-peq" onClick={() => void baixarRelatorio()} disabled={baixandoRel || !rel.data} title="Baixa o histórico do período em PDF (A4)">
                {baixandoRel ? "A gerar…" : "⬇️ Baixar (A4)"}
              </button>
              <button className="c-btn c-btn-prim c-btn-peq" onClick={imprimirRelatorio} disabled={!rel.data} title="Imprime (ou guarda em PDF) o histórico do período">
                🖨️ Imprimir
              </button>
            </span>
          </div>
          <div className="c-card">
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
              <div style={{ flex: "1 1 130px" }}>
                <label className="c-label">De</label>
                <input className="c-input" type="date" value={deData} max={ateData} onChange={(e) => setDeData(e.target.value)} />
              </div>
              <div style={{ flex: "1 1 130px" }}>
                <label className="c-label">Até</label>
                <input className="c-input" type="date" value={ateData} min={deData} max={hoje()} onChange={(e) => setAteData(e.target.value)} />
              </div>
              <div style={{ flex: "1 1 170px" }}>
                <label className="c-label">Mostrar</label>
                <select className="c-input" value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value)}>
                  {Object.keys(GRUPOS).map((g) => <option key={g}>{g}</option>)}
                </select>
              </div>
            </div>

            {rel.isLoading && <Vazio icon="⏳">A carregar o histórico…</Vazio>}
            {rel.isError && <Vazio icon="⚠️">{rel.error.message}</Vazio>}
            {rel.data && (
              <>
                <div className="c-sub" style={{ margin: "12px 0 2px" }}>
                  <b>Resumo por produto</b> — {diaBR(deData)} a {diaBR(ateData)}
                </div>
                {!rel.data.resumo.length && <Vazio icon="📦">Sem movimentos neste período.</Vazio>}
                {rel.data.resumo.map((r) => (
                  <div className="c-linha" key={r.produto}>
                    <div className="grow">
                      <div className="tit">{r.produto}</div>
                      <div className="det">
                        saídas <b>{fmtQtd(r.vendido + r.online)}</b>{r.valorVendido > 0 && ` (${mt(r.valorVendido)})`}
                        {r.entradas + r.compras > 0 && <> · entradas <b>+{fmtQtd(r.entradas + r.compras)}</b></>}
                        {r.reposicoes > 0 && <> · reposições +{fmtQtd(r.reposicoes)}</>}
                        {r.producao > 0 && <> · 🍹 produção <b>−{fmtQtd(r.producao)}</b></>}
                        {r.gerencia > 0 && <> · gerência −{fmtQtd(r.gerencia)}</>}
                        {r.stockAtual != null && <> · stock actual <b>{fmtQtd(r.stockAtual)}</b></>}
                      </div>
                    </div>
                    {r.ajustes > 0 && (
                      <span className="c-chip c-chip-amarelo" title="Houve correcção manual de stock neste período — ver o detalhe abaixo">
                        ⇄ {r.ajustes} ajuste{r.ajustes > 1 ? "s" : ""}
                      </span>
                    )}
                  </div>
                ))}

                <div className="c-sub" style={{ margin: "14px 0 2px" }}>
                  <b>Movimentos dia a dia</b> — {linhasRel.length} registo(s){filtroTipo !== "Todos" && ` · filtro: ${filtroTipo}`}
                </div>
                {!linhasRel.length && <Vazio icon="🔍">Nada a mostrar com este filtro.</Vazio>}
                {linhasRel.map((l, i) => (
                  <div className="c-linha" key={i}>
                    <div className="grow">
                      <div className="tit">{l.produto}</div>
                      <div className="det">
                        {diaBR(l.data)}{l.hora ? ` ${l.hora}` : ""} · {l.quem}{l.ref ? ` · ${l.ref}` : ""}
                      </div>
                    </div>
                    <span className={`c-chip ${chipDoTipo(l.tipo)}`} title={l.tipo}>
                      {l.tipo === "Ajuste de inventário" ? "⇄" : sinalDoTipo(l.tipo)}{fmtQtd(l.qtd)}
                    </span>
                  </div>
                ))}
              </>
            )}
          </div>
        </>
      )}

      {producao && (
        <Modal onClose={() => setProducao(null)}>
          <h3>🍹 Saída para Produção</h3>
          <p className="c-sub">
            {producao.nome} · em stock: <b>{fmtQtd(producao.estoqueAtual)}</b>{producao.qtdDecimal ? " kg" : " un."}
          </p>
          <div style={{ background: "rgba(201,162,39,.10)", border: "1px solid rgba(201,162,39,.4)", borderRadius: 10, padding: "8px 10px", fontSize: 13, marginBottom: 6 }}>
            ⚠️ <b>Abriu para produzir = saiu do stock.</b> Ex.: 1L de sumo aberto para cocktails já não pode ser vendido inteiro —
            registe aqui assim que abrir, mesmo que renda vários cocktails. Isto NÃO é uma venda (não gera receita).
          </div>
          <label className="c-label">Quantidade usada/aberta{producao.qtdDecimal ? " (kg)" : " (un.)"}</label>
          <input className="c-input" type="number" min={0.25} step={producao.qtdDecimal || (producao.fraccao != null && producao.fraccao !== 1) ? 0.25 : 1}
            value={qtdProd} onChange={(e) => setQtdProd(+e.target.value || 0)} />
          <label className="c-label">Para que produção? (opcional)</label>
          <input className="c-input" placeholder="Ex.: Sumo p/ cocktails do bar" value={obs} onChange={(e) => setObs(e.target.value)} />
          <button className="c-btn c-btn-verde c-btn-bloco" style={{ marginTop: 14 }}
            disabled={addProducao.isPending || qtdProd <= 0}
            onClick={() => user && addProducao.mutate({ usuarioId: user.id, produtoId: producao.id, qtd: qtdProd, obs: obs || undefined })}>
            {addProducao.isPending ? "A registar…" : "🍹 Registar Saída p/ Produção"}
          </button>
        </Modal>
      )}

      {entrada && (
        <Modal onClose={() => setEntrada(null)}>
          <h3>＋ Entrada de Stock</h3>
          <p className="c-sub">{entrada.nome} · atual: <b>{fmtQtd(entrada.estoqueAtual)}</b> un.
            {entrada.fraccao != null && entrada.fraccao !== 1 && (
              <> — a entrada de fracções é convertida em unidades inteiras no produto principal (ex.: 4× 1/4 = 1 inteiro)</>
            )}
            {entrada.qtdDecimal && <> — produto vendido a peso: indique os <b>kg</b> (aceita decimais, ex.: 12,5)</>}
          </p>
          <label className="c-label">Quantidade a adicionar{entrada.qtdDecimal ? " (kg)" : ""}</label>
          <input className="c-input" type="number" min={0.25} step={entrada.qtdDecimal || (entrada.fraccao != null && entrada.fraccao !== 1) ? 0.25 : 1} value={qtd} onChange={(e) => setQtd(+e.target.value || 0)} />
          <label className="c-label">Fornecedor / Observação</label>
          <input className="c-input" placeholder="Opcional" value={obs} onChange={(e) => setObs(e.target.value)} />
          <button className="c-btn c-btn-verde c-btn-bloco" style={{ marginTop: 14 }}
            disabled={addEntrada.isPending || qtd <= 0}
            onClick={() => user && addEntrada.mutate({ usuarioId: user.id, produtoId: entrada.id, qtd, obs: obs || undefined })}>
            {addEntrada.isPending ? "A registar…" : "💾 Registar Entrada"}
          </button>
        </Modal>
      )}

      {ajuste && (
        <Modal onClose={() => setAjuste(null)}>
          <h3>✏️ Definir Stock (quantidade exata)</h3>
          <p className="c-sub">
            {ajuste.nome} · atual: <b>{fmtQtd(atualAjuste)}</b>{ajuste.qtdDecimal ? " kg" : ajuste.estoqueRefId ? " porções" : " un."}
            {" — "}indique a quantidade <b>real contada</b>; o valor atual será <b>substituído</b> (não somado).
          </p>
          <label className="c-label">Quantidade EXATA em stock{ajuste.qtdDecimal ? " (kg)" : ""}</label>
          <input className="c-input" type="number" min={0} step={ajuste.qtdDecimal || (ajuste.fraccao != null && ajuste.fraccao !== 1) ? 0.25 : 1}
            value={qtdAjuste} onChange={(e) => setQtdAjuste(Math.max(0, +e.target.value || 0))} />
          <div className="c-linha" style={{ marginTop: 6 }}>
            <div className="grow tit">Diferença</div>
            <b style={{ color: qtdAjuste >= atualAjuste ? "var(--verde-c)" : "var(--vermelho-c)" }}>
              {qtdAjuste >= atualAjuste ? "+" : "−"}{fmtQtd(Math.abs(Math.round((qtdAjuste - atualAjuste) * 100) / 100))}
            </b>
          </div>
          <label className="c-label">Motivo / Observação</label>
          <input className="c-input" placeholder="Ex.: contagem de fim do dia" value={obs} onChange={(e) => setObs(e.target.value)} />
          <button className="c-btn c-btn-prim c-btn-bloco" style={{ marginTop: 14 }}
            disabled={addAjuste.isPending}
            onClick={() => user && addAjuste.mutate({ usuarioId: user.id, produtoId: ajuste.id, novaQtd: qtdAjuste, obs: obs || undefined })}>
            {addAjuste.isPending ? "A guardar…" : "💾 Definir Quantidade"}
          </button>
        </Modal>
      )}
    </div>
  );
}
