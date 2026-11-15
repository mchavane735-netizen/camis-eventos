import { useMemo, useState } from "react";
import { trpc } from "@/providers/trpc";
import { useSession } from "@/lib/session";
import { mt, dataBR, horaBR } from "@/lib/fmt";
import { Vazio } from "@/components/bits";
import DocView from "@/components/Doc";
import type { DocData } from "@/lib/docprint";

/** Lista de Pro-formas e Facturas emitidas — com reimpressão */
export default function Documentos() {
  const { user, toast } = useSession();
  const utils = trpc.useUtils();
  const docs = trpc.documentos.list.useQuery(undefined, { refetchInterval: 20000 });
  const [ver, setVer] = useState<DocData | null>(null);
  const [filtro, setFiltro] = useState<"Todos" | "Proforma" | "Factura">("Todos");
  const isAdmin = user?.perfil === "Admin";

  const eliminar = trpc.documentos.eliminar.useMutation({
    onSuccess: () => { toast("Documento eliminado"); utils.documentos.list.invalidate(); },
    onError: (e) => toast("⚠️ " + e.message),
  });

  const lista = useMemo(
    () => (docs.data ?? []).filter((d) => filtro === "Todos" || d.tipo === filtro),
    [docs.data, filtro],
  );

  return (
    <div>
      <div className="c-titulo">🧾 Documentos</div>
      <p className="c-sub" style={{ marginBottom: 10 }}>
        Pro-formas e Facturas emitidas. Toque num documento para ver e reimprimir.
      </p>

      <div className="c-cats" style={{ marginBottom: 12 }}>
        {(["Todos", "Proforma", "Factura"] as const).map((f) => (
          <button key={f} className={f === filtro ? "ativo" : ""} onClick={() => setFiltro(f)}>
            {f === "Proforma" ? "Pro-formas" : f === "Factura" ? "Facturas" : "Todos"}
          </button>
        ))}
      </div>

      <div className="c-card">
        {docs.isLoading && <Vazio icon="⏳">A carregar…</Vazio>}
        {!docs.isLoading && lista.length === 0 && (
          <Vazio icon="🧾">Sem documentos emitidos.<br />Emita uma Pro-forma a partir de um pedido aberto,<br />ou uma Factura após fechar a conta.</Vazio>
        )}
        {lista.map((d) => (
          <div className="c-linha" key={d.id} style={{ cursor: "pointer" }} onClick={() => setVer(d as DocData)}>
            <div className="grow">
              <div className="tit">
                {d.tipo === "Proforma" ? "📄" : "🧾"} {d.codigo}
                <span className="det"> · {d.pedidoRef ?? ""}</span>
              </div>
              <div className="det">
                {d.criadoEm ? `${dataBR(d.criadoEm)} ${horaBR(d.criadoEm)}` : ""}
                {d.clienteNome ? ` · ${d.clienteNome}` : ""}
              </div>
            </div>
            <div className="fim" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <b style={{ color: "var(--roxo)" }}>{mt(d.total)}</b>
              {isAdmin && (
                <button
                  className="c-btn c-btn-perigo c-btn-peq"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm(`Eliminar o documento ${d.codigo}?`))
                      user && eliminar.mutate({ adminId: user.id, id: d.id });
                  }}
                >
                  🗑
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {ver && <DocView doc={ver} onClose={() => setVer(null)} />}
    </div>
  );
}
