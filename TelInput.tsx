/** Campo de telefone moçambicano com prefixo fixo +258 (WhatsApp).
    O valor guardado é o número local de 9 dígitos (ex.: "84 123 4567"). */
export default function TelInput({ value, onChange, required }: {
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
}) {
  // mostra apenas os dígitos locais (sem o 258)
  const local = value.replace(/\D/g, "").replace(/^258/, "").slice(0, 9);
  const fmtLocal = local.replace(/(\d{2})(\d{0,3})(\d{0,4})/, (_m, a, b, c) => [a, b, c].filter(Boolean).join(" "));
  const valido = !required || /^8[2-7]\d{7}$/.test(local);

  return (
    <div>
      <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
        <span style={{
          display: "flex", alignItems: "center", padding: "0 12px", borderRadius: 10,
          background: "var(--lilas)", fontWeight: 800, fontSize: 14, color: "var(--roxo)",
          border: "1.5px solid #e6dcec", whiteSpace: "nowrap",
        }}>
          🇲🇿 +258
        </span>
        <input
          className="c-input" inputMode="numeric" style={{ flex: 1 }}
          placeholder="8X XXX XXXX" value={fmtLocal}
          onChange={(e) => onChange(e.target.value.replace(/\D/g, "").replace(/^258/, "").slice(0, 9))}
        />
      </div>
      {required && local.length > 0 && !valido && (
        <p style={{ color: "var(--vermelho-c)", fontSize: 11.5, margin: "4px 2px 0" }}>
          ⚠️ Número moçambicano: 9 dígitos começando por 8 (ex.: 84 123 4567)
        </p>
      )}
    </div>
  );
}
