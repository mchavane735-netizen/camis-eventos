/* ---------- Código de afiliado partilhado por link (?loja=1&ref=AF-XXXX) ----------
   O código fica guardado neste dispositivo por 90 dias (o mesmo período em que o
   afiliado ganha comissões com o cliente) e é aplicado automaticamente às compras.
   O link normal da loja (sem ?ref=) não adiciona código nenhum. */

const KEY = "camis_loja_ref_v1";
const DIAS = 90;

export type RefAfiliado = { codigo: string; nome: string; desde: number };

/** Lê o código guardado se ainda estiver dentro dos 90 dias. */
export function refGuardado(): RefAfiliado | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const r = JSON.parse(raw) as RefAfiliado;
    if (!r.codigo || !r.desde) return null;
    if (Date.now() - r.desde > DIAS * 86400e3) { localStorage.removeItem(KEY); return null; } // expirou
    return r;
  } catch { return null; }
}

/** Guarda o código validado vindo do link do afiliado (renova os 90 dias). */
export function guardarRef(codigo: string, nome: string): RefAfiliado {
  const r: RefAfiliado = { codigo: codigo.trim().toUpperCase(), nome, desde: Date.now() };
  try { localStorage.setItem(KEY, JSON.stringify(r)); } catch { /* storage bloqueado — código só nesta visita */ }
  return r;
}

/** Remove o código (o cliente pode optar por comprar sem afiliado). */
export function limparRef() { try { localStorage.removeItem(KEY); } catch { /* ignore */ } }

/** Lê o parâmetro ?ref= do link partilhado (null se for o link normal da CAMI'S). */
export function refDoLink(): string | null {
  const q = new URLSearchParams(window.location.search);
  const r = q.get("ref");
  return r && r.trim().length >= 3 ? r.trim().toUpperCase() : null;
}

/** Dias restantes de validade do código (para mostrar ao cliente). */
export function diasRestantes(r: RefAfiliado): number {
  return Math.max(0, DIAS - Math.floor((Date.now() - r.desde) / 86400e3));
}
