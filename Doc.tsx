import { useState } from "react";
import { Modal } from "@/components/bits";
import { useEmpresa } from "@/lib/empresa";
import { DOC_CSS, docBodyHtml, downloadPdf, gerarPdfBlob, printDoc, type DocData } from "@/lib/docprint";

/** Pré-visualização de uma Pro-forma / Factura com impressão (talão 80mm) e download em PDF */
export default function DocView({ doc, onClose }: { doc: DocData; onClose: () => void }) {
  const emp = useEmpresa();
  const [baixando, setBaixando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [whatsAberto, setWhatsAberto] = useState(false);
  const [whatsTel, setWhatsTel] = useState("");
  const [passo, setPasso] = useState<"" | "pdf">("");
  const body = docBodyHtml(doc, emp);
  const titulo = `${doc.tipo === "Proforma" ? "Pro-forma" : "Factura"} ${doc.codigo}`;
  const ficheiro = `${doc.codigo}.pdf`;
  const whatsTexto = [
    `${emp.nome} — ${titulo}`,
    doc.clienteNome ? `Cliente: ${doc.clienteNome}` : "",
    ...doc.itens.map((i) => `• ${i.qtd}× ${i.nome} — ${(i.qtd * i.precoUnit).toFixed(2)} ${emp.moeda}`),
    `TOTAL: ${doc.total.toFixed(2)} ${emp.moeda}`,
    `Pagamento: e-Mola ${emp.emola} (${emp.titular}) · Lev. e-Mola ${emp.emolaLev} (${emp.emolaLevTitular}) · ${emp.banco} ${emp.conta} (${emp.beneficiario}) · Dinheiro no local`,
    `Dúvidas: ${emp.tel1} / ${emp.tel2}`,
  ].filter(Boolean).join("\n");

  const baixar = async () => {
    setBaixando(true);
    try {
      await downloadPdf(titulo, body, ficheiro);
    } finally {
      setBaixando(false);
    }
  };

  /** Envia o documento em PDF pelo WhatsApp.
      No telemóvel: partilha directa do ficheiro (abre o WhatsApp com o PDF anexado).
      No computador: baixa o PDF e abre o WhatsApp — basta anexar o ficheiro baixado. */
  const enviarWhats = async () => {
    const tel = whatsTel.replace(/\D/g, "");
    if (tel.length < 9) return;
    setEnviando(true);
    try {
      const blob = await gerarPdfBlob(body);
      const file = new File([blob], ficheiro, { type: "application/pdf" });
      if (typeof navigator !== "undefined" && "canShare" in navigator &&
        navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: titulo, text: `${emp.nome} — ${titulo}` });
        setWhatsAberto(false);
        return;
      }
      // computador: baixa o PDF e abre o WhatsApp Web
      await downloadPdf(titulo, body, ficheiro);
      setPasso("pdf");
      window.open(`https://wa.me/258${tel}?text=${encodeURIComponent(
        `${emp.nome} — ${titulo}. Segue em anexo o documento em PDF. 📎`,
      )}`, "_blank");
    } catch {
      /* partilha cancelada pelo utilizador */
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Modal onClose={onClose}>
      <h3>🧾 {titulo}</h3>
      <p className="c-sub">Pré-visualização — imprima em talão (80mm) ou baixe em PDF.</p>
      <style>{DOC_CSS + "\n.docp { background:#fffdf5; border:2px dashed #d9c98a; border-radius:12px; padding:12px; }"}</style>
      <div className="docp" dangerouslySetInnerHTML={{ __html: body }} />
      <button className="c-btn c-btn-verde c-btn-bloco" style={{ marginTop: 10 }}
        onClick={() => setWhatsAberto(!whatsAberto)}>
        {whatsAberto ? "▲ Fechar envio por WhatsApp" : "📲 Enviar por WhatsApp ao cliente"}
      </button>
      {whatsAberto && (
        <div className="c-card" style={{ background: "#eef7ee", marginTop: 8, padding: 10 }}>
          <label className="c-label" style={{ marginTop: 0 }}>WhatsApp do cliente (9 dígitos)</label>
          <div style={{ display: "flex", gap: 8 }}>
            <input className="c-input" inputMode="numeric" placeholder="Ex.: 84 123 4567"
              value={whatsTel} onChange={(e) => setWhatsTel(e.target.value)} />
            <button className="c-btn c-btn-verde" style={{ whiteSpace: "nowrap" }}
              disabled={enviando || whatsTel.replace(/\D/g, "").length < 9}
              onClick={enviarWhats}>
              {enviando ? "A preparar…" : "Enviar ➤"}
            </button>
          </div>
          <p className="c-sub" style={{ marginTop: 6 }}>
            📎 O documento vai em <b>PDF</b>: no telemóvel abre a partilha directa com o ficheiro anexado;
            no computador o PDF é baixado e o WhatsApp abre — anexe o ficheiro <b>{ficheiro}</b> na conversa.
          </p>
          {passo === "pdf" && (
            <p className="c-sub" style={{ marginTop: 4, fontWeight: 700, color: "var(--verde-c)" }}>
              ✅ PDF baixado! No WhatsApp que abriu, toque no clipe 📎 e anexe <b>{ficheiro}</b> (está na pasta Downloads).
            </p>
          )}
          <details style={{ marginTop: 6 }}>
            <summary className="c-sub" style={{ cursor: "pointer" }}>Enviar apenas texto (sem documento)</summary>
            <a className="c-btn c-btn-linha c-btn-bloco" style={{ marginTop: 6, textDecoration: "none" }}
              href={`https://wa.me/258${whatsTel.replace(/\D/g, "")}?text=${encodeURIComponent(whatsTexto)}`}
              target="_blank" rel="noreferrer"
              onClick={(e) => { if (whatsTel.replace(/\D/g, "").length < 9) e.preventDefault(); }}>
              Abrir WhatsApp só com o resumo em texto
            </a>
          </details>
        </div>
      )}
      <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
        <button className="c-btn c-btn-cinza" style={{ flex: 1 }} onClick={onClose}>Fechar</button>
        <button className="c-btn c-btn-linha" style={{ flex: 1.4 }} disabled={baixando} onClick={baixar}>
          {baixando ? "A gerar…" : "⬇️ Baixar PDF"}
        </button>
        <button className="c-btn c-btn-prim" style={{ flex: 1.4 }} onClick={() => printDoc(titulo, body)}>
          🖨 Imprimir
        </button>
      </div>
    </Modal>
  );
}
