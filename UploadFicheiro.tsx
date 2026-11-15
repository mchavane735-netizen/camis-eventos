import { useRef, useState } from "react";

/** Upload de comprovativo/documento com duas sub-opções:
    📷 «Tirar foto» (abre a câmara no telemóvel) e 📁 «Escolher ficheiro»
    (fotos e documentos PDF guardados no dispositivo). */
export default function UploadFicheiro({ onFicheiro, disabled, rotulo }: {
  onFicheiro: (f: File) => void;
  disabled?: boolean;
  rotulo?: string;
}) {
  const camRef = useRef<HTMLInputElement>(null);
  const docRef = useRef<HTMLInputElement>(null);
  const [nomeFich, setNomeFich] = useState("");

  const apanhar = (f: File | undefined, input: HTMLInputElement | null) => {
    if (f) { setNomeFich(f.name || "foto da câmara"); onFicheiro(f); }
    if (input) input.value = "";
  };

  return (
    <div>
      {rotulo && <p className="c-sub" style={{ marginTop: 10 }}>{rotulo}</p>}
      <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
        <button type="button" className="c-btn c-btn-linha" style={{ flex: 1 }} disabled={disabled}
          onClick={() => camRef.current?.click()}>
          📷 Tirar foto
        </button>
        <button type="button" className="c-btn c-btn-linha" style={{ flex: 1 }} disabled={disabled}
          onClick={() => docRef.current?.click()}>
          📁 Procurar no dispositivo
        </button>
      </div>
      <p className="c-sub" style={{ fontSize: 11.5, marginTop: 4 }}>
        Aceita <b>fotos</b> e <b>documentos (PDF)</b>. No telemóvel, «Tirar foto» abre a câmara;
        «Procurar no dispositivo» abre os seus ficheiros.
      </p>
      {nomeFich && (
        <p className="c-sub" style={{ marginTop: 4, color: "var(--verde-c)", fontWeight: 700 }}>
          ✅ Anexado: {nomeFich}
        </p>
      )}
      {/* câmara (telemóvel) — apenas fotos */}
      <input ref={camRef} type="file" accept="image/*" capture="environment" hidden
        onChange={(e) => apanhar(e.target.files?.[0], e.target)} />
      {/* ficheiros do dispositivo — fotos e documentos */}
      <input ref={docRef} type="file" accept="image/*,application/pdf" hidden
        onChange={(e) => apanhar(e.target.files?.[0], e.target)} />
    </div>
  );
}
