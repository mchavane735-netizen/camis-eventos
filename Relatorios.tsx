import { useMemo, useRef, useState } from "react";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import { trpc } from "@/providers/trpc";
import { useSession } from "@/lib/session";
import { mt, hoje } from "@/lib/fmt";
import { Stat, Vazio, Voltar } from "@/components/bits";

type Periodo = "hoje" | "semana" | "mes" | "tudo" | "personalizado";

function intervalo(p: Periodo): { de: string; ate: string } {
  const ate = hoje();
  if (p === "hoje") return { de: ate, ate };
  if (p === "semana") {
    const d = new Date(Date.now() + 2 * 3600e3 - 6 * 86400e3);
    return { de: d.toISOString().slice(0, 10), ate };
  }
  if (p === "mes") return { de: ate.slice(0, 7) + "-01", ate };
  return { de: "2020-01-01", ate: "2099-12-31" };
}

export default function Relatorios({ voltar }: { voltar: () => void }) {
  const { user, toast } = useSession();
  const [per, setPer] = useState<Periodo>("hoje");
  const [dePers, setDePers] = useState("");
  const [atePers, setAtePers] = useState("");
  const { de, ate } = useMemo(() => {
    if (per === "personalizado" && dePers && atePers)
      return dePers <= atePers ? { de: dePers, ate: atePers } : { de: atePers, ate: dePers };
    return intervalo(per);
  }, [per, dePers, atePers]);
  const resumo = trpc.relatorios.resumo.useQuery({ de, ate, usuarioId: user?.id ?? 0 });
  const r = resumo.data;
  const relatorioRef = useRef<HTMLDivElement>(null);
  const [pdfLoading, setPdfLoading] = useState(false);

  /* Gera um PDF A4 com o relatório tal como aparece no ecrã (gráficos incluídos) */
  const baixarPDF = async () => {
    const el = relatorioRef.current;
    if (!el || !r) return;
    setPdfLoading(true);
    try {
      const canvas = await html2canvas(el, {
        scale: 2,
        backgroundColor: "#ffffff",
        useCORS: true,
        ignoreElements: (n) => n instanceof HTMLElement && n.hasAttribute("data-no-pdf"),
      });
      const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
      const pw = pdf.internal.pageSize.getWidth();
      const ph = pdf.internal.pageSize.getHeight();
      const margem = 12;
      const topo = 26; // espaço para o cabeçalho
      const largura = pw - margem * 2;
      const alturaTotal = (canvas.height * largura) / canvas.width;
      const alturaPagina = ph - topo - 12;

      const fmtD = (d: string) => new Date(d + "T12:00:00Z").toLocaleDateString("pt-PT");
      const nPaginas = Math.max(1, Math.ceil(alturaTotal / alturaPagina));
      for (let pg = 0; pg < nPaginas; pg++) {
        if (pg > 0) pdf.addPage();
        // cabeçalho
        pdf.setFillColor(88, 28, 135);
        pdf.rect(0, 0, pw, 18, "F");
        pdf.setTextColor(255, 255, 255);
        pdf.setFontSize(13);
        pdf.setFont("helvetica", "bold");
        pdf.text("CAMI'S EVENTOS — Relatório de Vendas", margem, 8);
        pdf.setFontSize(9);
        pdf.setFont("helvetica", "normal");
        pdf.text(`Período: ${fmtD(de)} a ${fmtD(ate)}  ·  Gerado em ${new Date().toLocaleString("pt-PT")}`, margem, 14);
        pdf.setTextColor(0, 0, 0);
        // fatia do conteúdo correspondente a esta página
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
      pdf.save(`relatorio_camis_${de}_a_${ate}.pdf`);
      toast("📄 PDF do relatório descarregado!");
    } catch (e) {
      console.error(e);
      toast("⚠️ Não foi possível gerar o PDF.");
    } finally {
      setPdfLoading(false);
    }
  };

  const exportCSV = () => {
    if (!r) return;
    const linhas = [
      ["Pedido Nº", "Data", "Produto", "Categoria", "Qtd", "Preço Unit.", "Total Item", "Desconto %", "Total Pedido", "Método"],
      ...r.itens.map((it) => [
        it.numero, it.dataDia, it.nome, it.categoria, it.qtd, it.precoUnit,
        it.qtd * it.precoUnit, it.desconto, it.totalPedido, it.metodo ?? "—",
      ]),
    ];
    const csv = linhas.map((l) => l.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `vendas_camis_${de}_a_${ate}.csv`;
    a.click();
    toast("CSV exportado!");
  };

  return (
    <div>
      <Voltar onClick={voltar} />
      <div className="c-titulo">📊 Relatórios</div>
      <div className="c-abas">
        {([["hoje", "Hoje"], ["semana", "7 dias"], ["mes", "Este mês"], ["tudo", "Tudo"], ["personalizado", "📅 Intervalo"]] as Array<[Periodo, string]>).map(([k, l]) => (
          <button key={k} className={per === k ? "ativo" : ""} onClick={() => setPer(k)}>{l}</button>
        ))}
      </div>

      {per === "personalizado" && (
        <div className="c-card" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
          <div>
            <label className="c-label" style={{ marginTop: 0 }}>📅 De (data inicial)</label>
            <input className="c-input" type="date" value={dePers} max={atePers || undefined}
              onChange={(e) => setDePers(e.target.value)} />
          </div>
          <div>
            <label className="c-label" style={{ marginTop: 0 }}>📅 Até (data final)</label>
            <input className="c-input" type="date" value={atePers} min={dePers || undefined}
              onChange={(e) => setAtePers(e.target.value)} />
          </div>
          {(!dePers || !atePers) && (
            <p className="c-sub" style={{ gridColumn: "1 / -1", margin: 0 }}>
              Escolha as duas datas para ver e imprimir o relatório desse intervalo.
            </p>
          )}
        </div>
      )}

      {resumo.isLoading && <Vazio icon="⏳">A calcular…</Vazio>}
      {per === "personalizado" && (!dePers || !atePers) && null}
      {r && (per !== "personalizado" || (dePers && atePers)) && (
        <>
          <div ref={relatorioRef} style={{ background: "#fff", borderRadius: 12, padding: 4 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 10, marginBottom: 12 }}>
            <Stat cls="v" lbl="💰 Total Geral">{mt(r.totGeral)}</Stat>
            <Stat lbl="🛒 Pedidos Fechados">{r.nVendas}</Stat>
            <Stat cls="a" lbl="🎫 Ticket Médio">{mt(r.ticketMedio)}</Stat>
            {r.topProduto && <Stat cls="az" lbl="🏆 Mais Vendido">{r.topProduto.nome} <small>· {r.topProduto.qtd} un.</small></Stat>}
          </div>

          <div className="c-card">
            <div className="c-titulo" style={{ fontSize: 15 }}>📈 Vendas por Dia</div>
            {r.porDia.length === 0 && <Vazio icon="📉">Sem vendas no período.</Vazio>}
            {r.porDia.length > 0 && (
              <div style={{ display: "flex", alignItems: "flex-end", gap: 6, minHeight: 130, padding: "10px 2px 0", overflowX: "auto" }}>
                {r.porDia.map((d) => {
                  const max = Math.max(...r.porDia.map((x) => x.total), 1);
                  const h = Math.max(6, Math.round((d.total / max) * 110));
                  const lbl = new Date(d.dia + "T12:00:00Z").toLocaleDateString("pt-PT", { day: "2-digit", month: "2-digit" });
                  return (
                    <div key={d.dia} style={{ flex: "1 0 34px", textAlign: "center" }} title={`${d.dia}: ${mt(d.total)}`}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: "var(--roxo)", whiteSpace: "nowrap" }}>{d.total >= 1000 ? (d.total / 1000).toFixed(1) + "k" : d.total.toFixed(0)}</div>
                      <div style={{ height: h, background: "linear-gradient(180deg,var(--roxo2),var(--roxo))", borderRadius: "6px 6px 0 0", margin: "2px 2px 0" }} />
                      <div style={{ fontSize: 10, color: "#777", marginTop: 3 }}>{lbl}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="c-card">
            <div className="c-titulo" style={{ fontSize: 15 }}>💳 Por Método de Pagamento</div>
            {r.porMetodo.length === 0 && <Vazio icon="💳">Sem dados no período.</Vazio>}
            {r.porMetodo.map((m) => {
              const maxM = Math.max(...r.porMetodo.map((x) => x.total), 1);
              const pctM = Math.round((m.total / maxM) * 100);
              const pctTot = r.totGeral > 0 ? Math.round((m.total / r.totGeral) * 100) : 0;
              return (
                <div key={m.metodo} style={{ padding: "6px 0" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13.5 }}>
                    <span>{m.metodo}</span><b>{mt(m.total)} <small style={{ color: "#888", fontWeight: 400 }}>({pctTot}%)</small></b>
                  </div>
                  <div style={{ height: 8, background: "#f0e8f7", borderRadius: 6, marginTop: 4 }}>
                    <div style={{ height: 8, width: pctM + "%", background: "linear-gradient(90deg,var(--roxo2),var(--roxo))", borderRadius: 6 }} />
                  </div>
                </div>
              );
            })}
          </div>

          {r.topProduto && (
            <div className="c-card">
              <div className="c-titulo" style={{ fontSize: 15 }}>🏆 Produto Top do Período</div>
              <b>{r.topProduto.nome}</b> — {r.topProduto.qtd} unidades vendidas
            </div>
          )}

          </div>

          <button className="c-btn c-btn-prim c-btn-bloco" style={{ marginTop: 4 }} onClick={baixarPDF}
            disabled={pdfLoading || r.itens.length === 0}>
            {pdfLoading ? "⏳ A gerar o PDF…" : "📄 Baixar Relatório em PDF (com gráficos)"}
          </button>
          <button className="c-btn c-btn-linha c-btn-bloco" style={{ marginTop: 8 }} onClick={exportCSV} disabled={r.itens.length === 0}>
            ⬇️ Exportar Vendas (CSV)
          </button>
        </>
      )}
    </div>
  );
}
