import { useState } from "react";
import { trpc } from "@/providers/trpc";

/** Sessão do cliente da loja online (cadastro opcional) — token em localStorage */
export type ClienteSessao = { id: number; nome: string; telefone: string; email: string | null };

const KEY_TOKEN = "camis_loja_token";

export function getLojaToken() {
  try { return localStorage.getItem(KEY_TOKEN) || ""; } catch { return ""; }
}
export function setLojaToken(t: string) {
  try { t ? localStorage.setItem(KEY_TOKEN, t) : localStorage.removeItem(KEY_TOKEN); } catch { /* ignore */ }
}

export function useLojaCliente() {
  const [token, setTok] = useState(getLojaToken());
  const me = trpc.loja.me.useQuery({ token }, { enabled: !!token, retry: false, staleTime: 60_000 });
  const entrar = (t: string) => { setLojaToken(t); setTok(t); };
  const sair = () => { setLojaToken(""); setTok(""); };
  return { token, cliente: (me.data ?? null) as ClienteSessao | null, aCarregar: me.isLoading, entrar, sair };
}

/** Formata telefone moçambicano para WhatsApp (wa.me) */
export function waLink(telefone: string, mensagem: string) {
  const d = telefone.replace(/\D/g, "");
  const num = d.startsWith("258") ? d : d.length === 9 ? "258" + d : d;
  return `https://wa.me/${num}?text=${encodeURIComponent(mensagem)}`;
}

/** Contagem regressiva de itens no carrinho (localStorage por tipo+mesa).
    Itens personalizados (fora do menu) usam produtoId negativo. */
export type CarrinhoItem = { produtoId: number; nome: string; preco: number; qtd: number; foto?: string | null; personalizado?: boolean; detalhes?: string; obs?: string };
