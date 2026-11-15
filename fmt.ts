export const fmt = (n: number) =>
  (Math.round((+n + Number.EPSILON) * 100) / 100).toLocaleString("pt-MZ", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });

export const mt = (n: number) => fmt(n) + " MZN";

/** Dia de hoje em Moçambique (UTC+2), formato YYYY-MM-DD */
export const hoje = () => new Date(Date.now() + 2 * 3600e3).toISOString().slice(0, 10);

export const dataBR = (d: string | Date) =>
  new Date(d).toLocaleDateString("pt-PT", { day: "2-digit", month: "2-digit", year: "numeric" });

export const horaBR = (d: string | Date) =>
  new Date(d).toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" });

/** Data (YYYY-MM-DD) para dd/mm/yyyy sem problemas de fuso */
export const diaBR = (iso: string) => {
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a}`;
};

export const esc = (t: unknown) => String(t ?? "");

/** Mensagem de erro amigável: traduz falhas de rede/servidor para português claro */
export const msgErro = (e: unknown) => {
  const m = e instanceof Error ? e.message : String(e ?? "");
  if (/failed to fetch|fetch failed|network ?error|load failed|network request failed|econnrefused|timed?\s*out|service unavailable|502|503|504/i.test(m))
    return "Sem ligação ao servidor. Verifique a internet do aparelho e tente novamente dentro de alguns minutos. (A sua conta NÃO está bloqueada — o sistema pode estar temporariamente indisponível.)";
  return m;
};
