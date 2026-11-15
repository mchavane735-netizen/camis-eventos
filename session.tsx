import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Perfil } from "@contracts/types";
import { trpc } from "@/providers/trpc";
import { msgErro } from "@/lib/fmt";

export type SessUser = { id: number; nome: string; perfil: Perfil; podeReabrirReserva?: boolean; podeEditarStock?: boolean; podeEditarNomes?: boolean };

type Ctx = {
  user: SessUser | null;
  entrar: (u: SessUser) => void;
  sair: () => void;
  toast: (msg: string) => void;
  toastMsg: string | null;
};

const SessionCtx = createContext<Ctx>(null as never);
const LS = "camis_sess_user";

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessUser | null>(() => {
    try { return JSON.parse(localStorage.getItem(LS) || "null"); } catch { return null; }
  });
  // enquanto não soubermos se há sessão no cookie do servidor, mostramos um
  // ecrã de arranque (evita o «salto» para o login ao actualizar a página)
  const [pronto, setPronto] = useState<boolean>(() => {
    try { return !!JSON.parse(localStorage.getItem(LS) || "null"); } catch { return false; }
  });
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  /* Restaura a sessão a partir do cookie de servidor — essencial em aparelhos
     com armazenamento local bloqueado (o cookie é enviado automaticamente). */
  const sessaoQ = trpc.usuarios.sessaoActual.useQuery(undefined, {
    enabled: !user, retry: false, refetchOnWindowFocus: false, staleTime: 60000,
  });
  useEffect(() => {
    if (user || !sessaoQ.isFetched) return;
    if (sessaoQ.data) {
      setUser(sessaoQ.data);
      try { localStorage.setItem(LS, JSON.stringify(sessaoQ.data)); } catch { /* sessão só em memória */ }
    }
    setPronto(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessaoQ.isFetched]);

  const terminar = trpc.usuarios.terminarSessao.useMutation();

  // Nota: em alguns browsers (modo privado, WebViews, cookies bloqueados) o
  // localStorage pode falhar — nesse caso a sessão fica só em memória/cookie
  // e a app continua a funcionar.
  const entrar = (u: SessUser) => { setUser(u); setPronto(true); try { localStorage.setItem(LS, JSON.stringify(u)); } catch { /* sessão só em memória */ } };
  const sair = () => {
    setUser(null);
    try { localStorage.removeItem(LS); } catch { /* ignore */ }
    terminar.mutate(); // limpa também o cookie de sessão no servidor
  };
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toast = (raw: string) => {
    // Falhas de rede/servidor chegam em inglês ("Failed to fetch") — traduzir
    // para uma orientação clara em português, válida em todo o sistema.
    const semIcone = raw.replace(/^⚠️\s*/, "");
    const traduzida = msgErro(semIcone);
    const msg = traduzida === semIcone ? raw : "⚠️ " + traduzida;
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToastMsg(msg);
    // mensagens longas (ex.: orientação de falha de ligação) ficam mais tempo no ecrã
    const ms = Math.min(9000, Math.max(2600, msg.length * 70));
    toastTimer.current = setTimeout(() => setToastMsg(null), ms);
  };

  return (
    <SessionCtx.Provider value={{ user, entrar, sair, toast, toastMsg }}>
      {pronto ? children : (
        <div style={{
          minHeight: "100dvh", display: "flex", flexDirection: "column", alignItems: "center",
          justifyContent: "center", gap: 10, background: "linear-gradient(160deg,#3d0c40 0%,#5e1460 45%,#8a2a8d 100%)",
          color: "#fff", fontSize: 14,
        }}>
          <img src="/icons/logo.png" alt="" style={{ width: 72, height: 72, borderRadius: "50%", background: "#fff", padding: 4 }} />
          ⏳ A abrir…
        </div>
      )}
      {toastMsg && <div className="c-toast">{toastMsg}</div>}
    </SessionCtx.Provider>
  );
}

export const useSession = () => useContext(SessionCtx);
