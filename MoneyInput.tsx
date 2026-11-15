import { useEffect, useState, type CSSProperties } from "react";

/** Campo de dinheiro: mostra e completa automaticamente as 2 casas decimais (ex.: 150 → 150.00) */
export default function MoneyInput({ value, onChange, className, placeholder, style, min }: {
  value: number; onChange: (v: number) => void;
  className?: string; placeholder?: string; style?: CSSProperties; min?: number;
}) {
  const [txt, setTxt] = useState(value ? value.toFixed(2) : "");
  const [foco, setFoco] = useState(false);
  useEffect(() => { if (!foco) setTxt(value ? value.toFixed(2) : ""); }, [value, foco]);
  return (
    <input
      className={className ?? "c-input"} type="number" inputMode="decimal" min={min ?? 0} step="0.01"
      placeholder={placeholder ?? "0.00"} style={style} value={txt}
      onFocus={() => setFoco(true)}
      onChange={(e) => { setTxt(e.target.value); onChange(+e.target.value || 0); }}
      onBlur={() => {
        setFoco(false);
        const v = Math.round((+txt || 0) * 100) / 100;
        setTxt(v ? v.toFixed(2) : "");
        onChange(v);
      }}
    />
  );
}
