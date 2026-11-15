import { useState } from "react";
import { trpc } from "@/providers/trpc";

/** Sessão do afiliado (área pública ?afiliado=1) — token em localStorage */
const KEY_AF = "camis_afiliado_token";

export type AfiliadoSessao = {
  id: number; codigo: string; nome: string; nivel: string; status: string;
  telefone: string; fotoPerfil: string | null; vendasTotal: number; whatsVerificado: boolean;
};

export function getAfiliadoToken() {
  try { return localStorage.getItem(KEY_AF) || ""; } catch { return ""; }
}
export function setAfiliadoToken(t: string) {
  try { t ? localStorage.setItem(KEY_AF, t) : localStorage.removeItem(KEY_AF); } catch { /* ignore */ }
}

export function useAfiliado() {
  const [token, setTok] = useState(getAfiliadoToken());
  const me = trpc.afiliados.me.useQuery({ token }, { enabled: !!token, retry: false, staleTime: 60_000 });
  const entrar = (t: string) => { setAfiliadoToken(t); setTok(t); };
  const sair = () => { setAfiliadoToken(""); setTok(""); };
  return { token, afiliado: (me.data?.afiliado ?? null) as AfiliadoSessao | null, aCarregar: me.isLoading, entrar, sair, recarregar: me.refetch };
}
