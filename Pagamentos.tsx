import { trpc } from "@/providers/trpc";
import { useSession } from "@/lib/session";
import { mt, dataBR, horaBR } from "@/lib/fmt";
import { Stat, Vazio, Voltar } from "@/components/bits";

export default function Pagamentos({ voltar }: { voltar: () => void }) {
  const { user, toast } = useSession();
  const utils = trpc.useUtils();
  const lista = trpc.pagamentos.list.useQuery({ usuarioId: user?.id ?? 0 }, { refetchInterval: 15000 });
  const eliminar = trpc.pagamentos.eliminar.useMutation({
    onSuccess: () => { toast("🗑 Pagamento eliminado"); utils.pagamentos.list.invalidate(); },
    onError: (e) => toast("⚠️ " + e.message),
  });
  const dados = lista.data ?? [];
  const isAdmin = user?.perfil === "Admin";
  const tot = dados.filter((p) => p.status === "Recebido").reduce((a, p) => a + p.valor, 0);

  return (
    <div>
      <Voltar onClick={voltar} />
      <div className="c-titulo">💳 Pagamentos</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 10, marginBottom: 12 }}>
        <Stat cls="v" lbl="Total Recebido">{mt(tot)}</Stat>
        <Stat cls="az" lbl="Transações">{dados.length}</Stat>
      </div>
      <div className="c-card">
        {lista.isLoading && <Vazio icon="⏳">A carregar…</Vazio>}
        {!lista.isLoading && dados.length === 0 && <Vazio icon="💳">Sem pagamentos registados.</Vazio>}
        {dados.map((p) => (
          <div className="c-linha" key={p.id}>
            <div className="grow">
              <div className="tit">{p.tipoVenda}</div>
              <div className="det">
                {p.criadoEm ? `${dataBR(p.criadoEm)} ${horaBR(p.criadoEm)}` : ""} · {p.metodo}
                {p.cliente && p.cliente !== "—" ? ` · ${p.cliente}` : ""}
              </div>
            </div>
            <div className="fim" style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ textAlign: "right" }}>
                <b style={{ color: p.status === "Anulado" ? "var(--vermelho-c)" : "var(--verde-c)" }}>{mt(p.valor)}</b><br />
                <span className={`c-chip ${p.status === "Anulado" ? "c-chip-vermelho" : "c-chip-verde"}`}>{p.status}</span>
              </span>
              {isAdmin && (
                <button className="c-btn c-btn-perigo c-btn-peq" title="Eliminar registo (Admin)"
                  onClick={() => { if (confirm(`ELIMINAR o registo de pagamento «${p.tipoVenda}» (${mt(p.valor)})?`)) user && eliminar.mutate({ usuarioId: user.id, id: p.id }); }}>
                  🗑
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
