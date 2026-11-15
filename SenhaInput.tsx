import { useState } from "react";

/** Campo de senha com símbolo de olho para mostrar/esconder.
    Usa as classes globais c-input; o olho fica dentro do campo, à direita. */
export default function SenhaInput({ value, onChange, placeholder, maxLength = 60, autoFocus, onEnter, style }: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  maxLength?: number;
  autoFocus?: boolean;
  onEnter?: () => void;
  style?: React.CSSProperties;
}) {
  const [ver, setVer] = useState(false);
  return (
    <div style={{ position: "relative" }}>
      <input
        className="c-input"
        type={ver ? "text" : "password"}
        value={value}
        maxLength={maxLength}
        autoFocus={autoFocus}
        placeholder={placeholder}
        style={{ paddingRight: 42, ...style }}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onEnter ? (e) => e.key === "Enter" && onEnter() : undefined}
      />
      <button
        type="button"
        aria-label={ver ? "Esconder senha" : "Ver senha"}
        title={ver ? "Esconder senha" : "Ver senha"}
        onClick={() => setVer(!ver)}
        style={{
          position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)",
          background: "none", border: "none", cursor: "pointer", fontSize: 17,
          padding: 4, opacity: 0.75, lineHeight: 1,
        }}
      >
        {ver ? "🙈" : "👁️"}
      </button>
    </div>
  );
}
