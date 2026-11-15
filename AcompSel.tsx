import { useState } from "react";
import { ACOMP_MOLHO, acompBasePara } from "@contracts/types";

/** Dois dropdowns de acompanhamento para pratos (peixe/mariscos e aves/carnes).
    Devolve o texto a guardar em obs via onChange ("" = sem acompanhamento). */
export default function AcompSel({ categoria, onChange }: {
  categoria: string;
  onChange: (obs: string) => void;
}) {
  const bases = acompBasePara(categoria);
  const [base, setBase] = useState("");
  const [molho, setMolho] = useState("");
  if (!bases) return null;

  const emitir = (b: string, m: string) => {
    const partes = [b && `c/ ${b}`, m].filter(Boolean);
    onChange(partes.join(" + "));
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 6 }}>
      <div>
        <label className="c-label" style={{ marginTop: 0 }}>Acompanhamento</label>
        <select className="c-select" value={base} onChange={(e) => { setBase(e.target.value); emitir(e.target.value, molho); }}>
          <option value="">— Escolher —</option>
          {bases.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
      </div>
      <div>
        <label className="c-label" style={{ marginTop: 0 }}>Molho / Legumes</label>
        <select className="c-select" value={molho} onChange={(e) => { setMolho(e.target.value); emitir(base, e.target.value); }}>
          <option value="">— Escolher —</option>
          {ACOMP_MOLHO.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>
    </div>
  );
}

/** true se a categoria tem acompanhamentos */
export function temAcomp(categoria: string) {
  return acompBasePara(categoria) !== null;
}
