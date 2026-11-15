import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { useSession } from "@/lib/session";
import { msgErro } from "@/lib/fmt";
import SenhaInput from "@/components/SenhaInput";


export default function Login() {
  const { entrar, toast } = useSession();
  const login = trpc.usuarios.loginNome.useMutation();
  const [nome, setNome] = useState("");
  const [pin, setPin] = useState("");

  const doLogin = () => {
    if (!nome.trim() || !pin) return;
    login.mutate(
      { nome: nome.trim(), pin },
      {
        onSuccess: (u) => {
          setPin("");
          entrar(u);
          toast("Bem-vindo, " + u.nome + "!");
          // PIN fraco (antigo): só o Administrador pode definir uma senha forte
          if (u.senhaFraca) setTimeout(() => toast("⚠️ O seu PIN é fraco. Peça ao Administrador para definir uma senha forte."), 600);
        },
        onError: (e) => toast("⚠️ " + msgErro(e)),
      },
    );
  };

  return (
    <div style={{
      minHeight: "100dvh", display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", padding: 24,
      background: "linear-gradient(160deg,#3d0c40 0%,#5e1460 45%,#8a2a8d 100%)",
    }}>
      <div style={{
        background: "#fff", borderRadius: 22, padding: "28px 24px", width: "100%", maxWidth: 400,
        boxShadow: "0 18px 50px rgba(0,0,0,.35)", textAlign: "center",
      }}>
        <img src="/icons/logo.png" alt="CAMI'S EVENTOS" style={{ width: 150, marginBottom: 6, display: "block", margin: "0 auto 6px" }} />
        <h1 style={{ fontSize: 19, color: "var(--roxo)" }}>Sistema de Vendas</h1>
        <p className="c-sub" style={{ margin: "4px 0 16px" }}>Chimoio · Transformando Sonhos em Realidade</p>

        <div style={{ textAlign: "left" }}>
          <label className="c-label">Nome de utilizador</label>
          <input
            className="c-input" value={nome} autoFocus autoComplete="username"
            placeholder="Escreva o seu nome de utilizador"
            onChange={(e) => setNome(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") doLogin(); }}
          />
          <label className="c-label" style={{ marginTop: 10 }}>Senha de acesso</label>
          <SenhaInput
            maxLength={60}
            placeholder="••••••" value={pin}
            style={{ letterSpacing: 4, fontSize: 18 }}
            onChange={setPin}
            onEnter={doLogin}
          />
        </div>
        <button className="c-btn c-btn-prim c-btn-bloco" style={{ marginTop: 12 }}
          onClick={doLogin} disabled={login.isPending || !nome.trim() || !pin}>
          {login.isPending ? "A entrar…" : "Entrar"}
        </button>
        <p className="c-sub" style={{ marginTop: 10, fontSize: 11.5 }}>
          🔒 Acesso restrito à equipa. Por segurança, o sistema bloqueia após 10 minutos sem uso.
        </p>
      </div>
    </div>
  );
}
