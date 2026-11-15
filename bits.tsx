import type { ReactNode } from "react";

export function Modal({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  return (
    <div className="c-modal-fundo" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="c-modal">{children}</div>
    </div>
  );
}

export function Stat({ cls, lbl, children }: { cls?: string; lbl: string; children: ReactNode }) {
  return (
    <div className={`c-stat ${cls ?? ""}`}>
      <div className="lbl">{lbl}</div>
      <div className="val">{children}</div>
    </div>
  );
}

export function Vazio({ icon, children }: { icon: string; children: ReactNode }) {
  return (
    <div className="c-vazio">
      <span className="big">{icon}</span>
      {children}
    </div>
  );
}

export function Voltar({ onClick }: { onClick: () => void }) {
  return (
    <button className="c-btn c-btn-cinza c-btn-peq" style={{ marginBottom: 12 }} onClick={onClick}>
      ← Menu
    </button>
  );
}
