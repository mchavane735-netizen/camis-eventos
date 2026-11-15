import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { useEmpresa } from "@/lib/empresa";
import { Voltar } from "@/components/bits";

/** Gera QR codes das mesas e o link público da loja online */
export default function QRCodes({ voltar }: { voltar: () => void }) {
  const emp = useEmpresa();
  const [nMesas, setNMesas] = useState(10);
  const [qrs, setQrs] = useState<Array<{ mesa: number; url: string; dataUrl: string }>>([]);
  const [qrLoja, setQrLoja] = useState("");
  const [copiado, setCopiado] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);

  const base = typeof window !== "undefined" ? window.location.origin + window.location.pathname : "";
  const linkLoja = `${base}?loja=1`;

  useEffect(() => {
    QRCode.toDataURL(linkLoja, { width: 512, margin: 1, color: { dark: "#3d0c40" } }).then(setQrLoja);
  }, [linkLoja]);

  useEffect(() => {
    Promise.all(
      Array.from({ length: nMesas }, (_, i) => {
        const url = `${base}?loja=1&mesa=${i + 1}`;
        return QRCode.toDataURL(url, { width: 512, margin: 1, color: { dark: "#3d0c40" } })
          .then((dataUrl) => ({ mesa: i + 1, url, dataUrl }));
      }),
    ).then(setQrs);
  }, [nMesas, base]);

  const imprimir = () => {
    const ifr = document.createElement("iframe");
    ifr.style.position = "fixed";
    ifr.style.right = "0"; ifr.style.bottom = "0";
    ifr.style.width = "0"; ifr.style.height = "0"; ifr.style.border = "0";
    document.body.appendChild(ifr);
    const doc = ifr.contentWindow!.document;
    const cards = qrs.map((q) => `
      <div class="card">
        <div class="nome">${emp.nome}</div>
        <div class="mesa">MESA ${q.mesa}</div>
        <img src="${q.dataUrl}" />
        <div class="hint">Aponte a câmara e faça o seu pedido</div>
        <div class="nuit">NUIT ${emp.nuit} · ${emp.tel1}</div>
      </div>`).join("");
    doc.open();
    doc.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>QR Codes — Mesas</title>
      <style>
        @page { size: A4; margin: 10mm; }
        * { box-sizing: border-box; }
        body { margin: 0; font-family: Arial, sans-serif; }
        .card { display: inline-block; width: 60mm; text-align: center; border: 2px solid #3d0c40;
          border-radius: 6mm; padding: 5mm 3mm; margin: 3mm; page-break-inside: avoid; vertical-align: top; }
        .nome { font-weight: 800; font-size: 11pt; color: #3d0c40; letter-spacing: 1px; }
        .mesa { font-size: 18pt; font-weight: 800; color: #8a2a8d; margin: 1mm 0; }
        img { width: 42mm; height: 42mm; }
        .hint { font-size: 8.5pt; color: #555; margin-top: 1mm; }
        .nuit { font-size: 7.5pt; color: #888; margin-top: 1mm; }
      </style></head><body>${cards}</body></html>`);
    doc.close();
    const win = ifr.contentWindow!;
    Promise.all(Array.from(doc.images).map((img) =>
      img.complete ? Promise.resolve() : new Promise<void>((r) => { img.onload = () => r(); img.onerror = () => r; }),
    )).then(() => setTimeout(() => { win.focus(); win.print(); setTimeout(() => ifr.remove(), 2000); }, 150));
  };

  const copiar = async () => {
    try { await navigator.clipboard.writeText(linkLoja); setCopiado(true); setTimeout(() => setCopiado(false), 2000); }
    catch { /* clipboard indisponível */ }
  };

  return (
    <div>
      <Voltar onClick={voltar} />
      <div className="c-titulo">📱 Loja Online — Link & QR Codes</div>

      <div className="c-card" style={{ textAlign: "center" }}>
        <div className="c-titulo" style={{ fontSize: 15 }}>🔗 Link público da loja</div>
        <p className="c-sub">Partilhe este link no WhatsApp, Facebook ou Instagram — o cliente faz o pedido sem instalar nada (e pode «Adicionar ao ecrã principal»).</p>
        <div className="c-input" style={{ fontSize: 12.5, wordBreak: "break-all", background: "#f6f1f8" }}>{linkLoja}</div>
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <button className="c-btn c-btn-prim" style={{ flex: 1 }} onClick={copiar}>
            {copiado ? "✅ Copiado!" : "📋 Copiar link"}
          </button>
          <a className="c-btn c-btn-linha" style={{ flex: 1, textAlign: "center", textDecoration: "none" }}
            href={linkLoja} target="_blank" rel="noreferrer">👁️ Abrir loja</a>
        </div>
        {qrLoja && <img src={qrLoja} alt="QR da loja" style={{ width: 150, marginTop: 10 }} />}
      </div>

      <div className="c-card">
        <div className="c-titulo" style={{ fontSize: 15 }}>🪑 QR codes para as mesas</div>
        <p className="c-sub">Cada QR abre a loja já com a mesa identificada — imprima e cole nas mesas.</p>
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 10 }}>
          <label className="c-label" style={{ margin: 0 }}>Nº de mesas:</label>
          <input className="c-input" type="number" min={1} max={60} style={{ width: 90 }}
            value={nMesas} onChange={(e) => setNMesas(Math.max(1, Math.min(60, +e.target.value || 1)))} />
          <button className="c-btn c-btn-prim" style={{ flex: 1 }} onClick={imprimir}>🖨️ Imprimir folha A4</button>
        </div>
        <div ref={printRef} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(110px,1fr))", gap: 10 }}>
          {qrs.map((q) => (
            <div key={q.mesa} style={{ textAlign: "center", border: "1.5px solid var(--roxo2)", borderRadius: 12, padding: 8 }}>
              <div style={{ fontWeight: 800, fontSize: 11, color: "var(--roxo)" }}>{emp.nome}</div>
              <div style={{ fontWeight: 800, fontSize: 16, color: "#8a2a8d" }}>MESA {q.mesa}</div>
              <img src={q.dataUrl} alt={`QR Mesa ${q.mesa}`} style={{ width: "100%" }} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
