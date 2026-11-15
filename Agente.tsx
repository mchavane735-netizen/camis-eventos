import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { useSession } from "@/lib/session";
import { mt, hoje, diaBR } from "@/lib/fmt";
import { useEmpresa } from "@/lib/empresa";
import { Vazio, Voltar } from "@/components/bits";
import MoneyInput from "@/components/MoneyInput";

type Sistema = "eMola" | "Mpesa";
type TipoMov = "Levantamento" | "Deposito";

const COR: Record<Sistema, string> = { eMola: "#e8112d", Mpesa: "#e30613" };
const ROTULO_TIPO: Record<TipoMov, string> = { Levantamento: "⬆️ Levantamento (cliente levanta dinheiro)", Deposito: "⬇️ Depósito (cliente deposita dinheiro)" };

export default function Agente({ voltar }: { voltar: () => void }) {
  const { user, toast } = useSession();
  const emp = useEmpresa();
  const [sistema, setSistema] = useState<Sistema>("Mpesa");
  const [tipo, setTipo] = useState<TipoMov>("Levantamento");
  const [valor, setValor] = useState(0);
  const utils = trpc.useUtils();

  const listaQ = trpc.agente.listar.useQuery({ usuarioId: user?.id ?? 0 }, { enabled: !!user });
  const pendQ = trpc.agente.pendentes.useQuery({ usuarioId: user?.id ?? 0 }, { enabled: !!user });
  const receber = trpc.agente.receber.useMutation({
    onSuccess: (r) => {
      toast(`💰 ${mt(r.total)} de comissões recebidas — entram na receita de hoje`);
      utils.agente.listar.invalidate(); utils.agente.pendentes.invalidate(); utils.financeiro.dia.invalidate();
    },
    onError: (e) => toast("⚠️ " + e.message),
  });
  const registar = trpc.agente.registar.useMutation({
    onSuccess: (r) => {
      toast(`✅ Registado — comissão ${mt(r.comissao)} (${r.taxaPct}%)`);
      setValor(0);
      utils.agente.listar.invalidate();
      utils.financeiro.dia.invalidate();
    },
    onError: (e) => toast("⚠️ " + e.message),
  });
  const eliminar = trpc.agente.eliminar.useMutation({
    onSuccess: () => { toast("🗑 Movimento removido"); utils.agente.listar.invalidate(); utils.agente.pendentes.invalidate(); utils.financeiro.dia.invalidate(); },
    onError: (e) => toast("⚠️ " + e.message),
  });

  const taxaChave = `taxaAgente${sistema === "eMola" ? "Emola" : "Mpesa"}${tipo === "Levantamento" ? "Lev" : "Dep"}` as keyof typeof emp;
  const taxaPct = Number(emp[taxaChave]) || 0;
  const comissaoPrev = Math.round(((valor * taxaPct) / 100) * 100) / 100;

  const itens = listaQ.data?.itens ?? [];
  const totEmola = itens.filter((m) => m.sistema === "eMola").reduce((a, m) => a + m.comissao, 0);
  const totMpesa = itens.filter((m) => m.sistema === "Mpesa").reduce((a, m) => a + m.comissao, 0);
  const podeGerir = user?.perfil === "Admin" || user?.perfil === "Gestor";

  return (
    <div>
      <Voltar onClick={voltar} />
      <div className="c-titulo">🏧 Agente eMola / M-Pesa</div>
      <p className="c-sub">
        A CAMI'S é agente: quando um cliente levanta ou deposita dinheiro aqui, a empresa ganha uma comissão.
        Registe cada movimento — diariamente fica como <b>receita a receber</b>; só entra na receita do dia quando
        a operadora pagar (regra geral na 1ª semana do mês) e confirmar abaixo o recebimento.
      </p>

      {(pendQ.data ?? []).length > 0 && (
        <div className="c-card" style={{ borderLeft: "4px solid var(--amarelo-c)" }}>
          <div className="c-titulo" style={{ fontSize: 15 }}>⏳ Comissões a receber das operadoras</div>
          {(pendQ.data ?? []).map((pm) => {
            const [a, m] = pm.mes.split("-");
            const MESES = ["", "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
            return (
              <div className="c-linha" key={pm.mes}>
                <div className="grow">
                  <div className="tit">{MESES[+m]} {a}</div>
                  <div className="c-sub" style={{ fontSize: 12 }}>{pm.n} movimento(s) · {mt(pm.valor)} movimentados</div>
                </div>
                <b style={{ color: "var(--amarelo-c)" }}>{mt(pm.comissao)}</b>
                {podeGerir && (
                  <button
                    className="c-btn c-btn-verde c-btn-peq"
                    disabled={receber.isPending}
                    title="Confirmar que a operadora pagou estas comissões — passam a receita de hoje"
                    onClick={() => user && window.confirm(`Confirmar o RECEBIMENTO de ${mt(pm.comissao)} de comissões de ${MESES[+m]} ${a}?\n\nEste valor entra na receita de hoje.`)
                      && receber.mutate({ usuarioId: user.id, mes: pm.mes })}
                  >💰 Recebido</button>
                )}
              </div>
            );
          })}
          <p className="c-sub" style={{ marginBottom: 0 }}>ℹ️ A Vodacom/Movitel pagam as comissões na primeira semana do mês seguinte, já com a retenção de 10% da AT.</p>
        </div>
      )}

      <div className="c-card">
        <div className="c-titulo" style={{ fontSize: 15 }}>➕ Registar movimento</div>

        <label className="c-label">Sistema</label>
        <div className="c-pag-grelha">
          {(["Mpesa", "eMola"] as Sistema[]).map((s) => (
            <button key={s} className={s === sistema ? "sel" : ""} onClick={() => setSistema(s)}>
              {s === "Mpesa" ? "M-Pesa" : "eMola"}
            </button>
          ))}
        </div>

        <label className="c-label" style={{ marginTop: 10 }}>Tipo de movimento</label>
        <div className="c-pag-grelha">
          {(["Levantamento", "Deposito"] as TipoMov[]).map((t) => (
            <button key={t} className={t === tipo ? "sel" : ""} onClick={() => setTipo(t)}>
              {t === "Levantamento" ? "⬆️ Levantamento" : "⬇️ Depósito"}
            </button>
          ))}
        </div>
        <p className="c-sub" style={{ marginTop: 4 }}>{ROTULO_TIPO[tipo]}</p>

        <label className="c-label">Valor movimentado pelo cliente (MZN)</label>
        <MoneyInput value={valor} onChange={setValor} placeholder="Ex.: 1000.00" />

        <div className="c-linha" style={{ marginTop: 8 }}>
          <div className="grow tit">Comissão da CAMI'S ({taxaPct}%)</div>
          <b style={{ color: "var(--verde-c)" }}>{mt(comissaoPrev)}</b>
        </div>
        {taxaPct === 0 && (
          <p className="c-sub">⚠️ A taxa deste tipo está a 0% — o Admin pode ajustá-la em ⚙️ Configurações.</p>
        )}

        <button
          className="c-btn c-btn-verde c-btn-bloco" style={{ marginTop: 12 }}
          disabled={registar.isPending || valor <= 0 || !user}
          onClick={() => user && registar.mutate({ usuarioId: user.id, sistema, tipo, valor })}
        >
          {registar.isPending ? "A registar…" : "✅ Registar movimento"}
        </button>
      </div>

      <div className="c-card">
        <div className="c-titulo" style={{ fontSize: 15 }}>📋 Movimentos de hoje — {diaBR(hoje())}</div>
        {itens.length === 0 && <Vazio icon="🏧">Sem movimentos de agente hoje.</Vazio>}
        {itens.map((m) => (
          <div className="c-linha" key={m.id}>
            <div className="grow">
              <div className="tit">
                <span style={{ color: COR[m.sistema as Sistema], fontWeight: 800 }}>{m.sistema === "Mpesa" ? "M-Pesa" : "eMola"}</span>
                {" · "}{m.tipo === "Levantamento" ? "⬆️ Levantamento" : "⬇️ Depósito"}
              </div>
              <div className="c-sub" style={{ fontSize: 12 }}>
                {new Date(m.criadoEm).toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" })}
                {" · "}{m.usuarioNome} · taxa {m.taxaPct}% · {m.recebidoEm ? `✅ comissão recebida em ${m.recebidoEm.split("-").reverse().join("/")}` : "⏳ comissão a receber"}
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div><b>{mt(m.valor)}</b></div>
              <div style={{ fontSize: 12, color: "var(--verde-c)", fontWeight: 700 }}>+{mt(m.comissao)}</div>
            </div>
            {podeGerir && (
              <button
                className="c-btn c-btn-cinza c-btn-peq" title="Remover (registado por engano)"
                onClick={() => {
                  if (user && window.confirm(`Remover este movimento de ${mt(m.valor)}?\nA comissão de ${mt(m.comissao)} sairá do relatório do dia.`))
                    eliminar.mutate({ usuarioId: user.id, id: m.id });
                }}
              >🗑</button>
            )}
          </div>
        ))}
        {itens.length > 0 && (
          <>
            <div className="c-linha" style={{ marginTop: 6 }}>
              <div className="grow tit">Valor movimentado</div><b>{mt(listaQ.data?.valorTotal ?? 0)}</b>
            </div>
            {totMpesa > 0 && <div className="c-linha"><div className="grow tit">Comissão M-Pesa</div><b>{mt(totMpesa)}</b></div>}
            {totEmola > 0 && <div className="c-linha"><div className="grow tit">Comissão eMola</div><b>{mt(totEmola)}</b></div>}
            <div className="c-total-linha">
              <span>COMISSÕES DE HOJE (A RECEBER)</span>
              <span style={{ color: "var(--amarelo-c)" }}>{mt(listaQ.data?.comissao ?? 0)}</span>
            </div>
            <p className="c-sub" style={{ marginTop: 6 }}>
              ℹ️ Ficam como receita <b>a receber</b> e entram no relatório como receita no dia em que confirmar
              o pagamento da operadora (cartão «Comissões a receber» acima).
            </p>
          </>
        )}
      </div>
    </div>
  );
}
