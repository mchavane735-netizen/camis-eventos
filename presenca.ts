import { useEffect } from "react";
import { trpc } from "@/providers/trpc";

const KEY = "camis_presenca_id";

let memoriaFallback = "";
function chaveDispositivo() {
  try {
    let k = sessionStorage.getItem(KEY);
    if (!k) {
      k = Math.random().toString(36).slice(2) + Date.now().toString(36);
      sessionStorage.setItem(KEY, k);
    }
    return k;
  } catch {
    // storage bloqueado neste browser — usa chave em memória (só para o ping)
    if (!memoriaFallback) memoriaFallback = Math.random().toString(36).slice(2) + Date.now().toString(36);
    return memoriaFallback;
  }
}

/** Envia um ping de presença a cada 25s (loja pública ou sistema do restaurante) */
export function usePresenca(area: "loja" | "sistema", ativo = true) {
  const ping = trpc.presenca.ping.useMutation();
  useEffect(() => {
    if (!ativo) return;
    const enviar = () => ping.mutate({ chave: chaveDispositivo(), area });
    enviar();
    const t = setInterval(enviar, 25_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [area, ativo]);
}
