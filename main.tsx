import { StrictMode, Component, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import './index.css'
import { TRPCProvider } from "@/providers/trpc"
import App from './App.tsx'

/** Ecrã de segurança: se algo inesperado falhar, o utilizador vê uma mensagem
    amigável com botão para recarregar — nunca uma página em branco. */
class ProtecaoErros extends Component<{ children: ReactNode }, { falhou: boolean }> {
  state = { falhou: false };
  static getDerivedStateFromError() { return { falhou: true }; }
  componentDidCatch(erro: unknown) { console.error("Erro inesperado na aplicação:", erro); }
  render() {
    if (!this.state.falhou) return this.props.children;
    return (
      <div style={{
        minHeight: "100dvh", display: "flex", flexDirection: "column", alignItems: "center",
        justifyContent: "center", padding: 24, textAlign: "center",
        background: "linear-gradient(160deg,#3d0c40 0%,#5e1460 45%,#8a2a8d 100%)", color: "#fff",
      }}>
        <div style={{
          background: "#fff", borderRadius: 22, padding: "28px 24px", width: "100%", maxWidth: 400,
          boxShadow: "0 18px 50px rgba(0,0,0,.35)", color: "#333",
        }}>
          <div style={{ fontSize: 44 }}>😔</div>
          <h2 style={{ fontSize: 17, color: "#3d0c40", margin: "6px 0" }}>Algo não correu bem</h2>
          <p style={{ fontSize: 13.5, opacity: .75, margin: "0 0 14px" }}>
            Ocorreu um erro inesperado. Toque no botão abaixo para recarregar — os seus dados estão seguros.
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              width: "100%", padding: "12px 16px", border: "none", borderRadius: 12, fontSize: 15,
              fontWeight: 700, color: "#fff", background: "linear-gradient(120deg,#5e1460,#8a2a8d)", cursor: "pointer",
            }}
          >
            🔄 Recarregar o sistema
          </button>
        </div>
      </div>
    );
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <ProtecaoErros>
        <TRPCProvider>
          <App />
        </TRPCProvider>
      </ProtecaoErros>
    </BrowserRouter>
  </StrictMode>,
)

// PWA: instala o service worker (aplicativo actualiza sozinho a cada versão)
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}
