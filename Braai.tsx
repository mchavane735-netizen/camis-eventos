import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { useSession } from "@/lib/session";
import { mt, diaBR, hoje } from "@/lib/fmt";
import { Modal, Vazio, Voltar } from "@/components/bits";
import { printDoc } from "@/lib/docprint";
import { useEmpresa } from "@/lib/empresa";
import { CheckinBraaiModal, type Reserva } from "@/pages/Reservas";
import {
  BRAAI_REGRAS, BRAAI_DURACAO_HORAS, braaiTaxaPessoa,
} from "@contracts/types";

/* ============================================================
   Página BRAAI — regras oficiais (imprimíveis para afixar) +
   braais de hoje com check-in de entrada.
   ============================================================ */
export default function Braai({ voltar }: { voltar: () => void }) {
  const { user, toast } = useSession();
  const emp = useEmpresa();
  const utils = trpc.useUtils();
  const reservas = trpc.reservas.list.useQuery({ usuarioId: user?.id ?? 0 }, { refetchInterval: 15000 });
  const [checkin, setCheckin] = useState<Reserva | null>(null);
  const [verRegras, setVerRegras] = useState(false);

  const braais = (reservas.data ?? []).filter((r) => r.braai);
  const hojeD = hoje();
  const deHoje = braais.filter((r) => r.dataConsumo === hojeD && ["Pendente", "Confirmada"].includes(r.status));
  const proximos = braais.filter((r) => r.dataConsumo > hojeD && ["Pendente", "Confirmada"].includes(r.status));

  const regrasHtml = () => {
    const linhas: string[] = [];
    linhas.push(`<div class="c nome">${emp.nome}</div>`);
    linhas.push(`<div class="c slogan">${emp.slogan}</div>`);
    linhas.push(`<div class="c">${emp.local}</div><div class="c">Tel: ${emp.tel1} / ${emp.tel2}</div>`);
    linhas.push('<div class="sep"></div>');
    linhas.push(`<div class="c titulo">🔥 REGRAS DO BRAAI</div>`);
    linhas.push(`<div class="c small">(cliente traz os seus produtos — taxa de uso do espaço)</div>`);
    linhas.push('<div class="sep"></div>');
    BRAAI_REGRAS.forEach((r, i) => linhas.push(`<div style="font-size:10px;margin:3px 0"><b>${i + 1}.</b> ${r}</div>`));
    linhas.push('<div class="sep"></div>');
    linhas.push(`<div class="c small">Dúvidas e reservas: ${emp.tel1} · ${emp.tel2}</div>`);
    linhas.push('<div class="c">Obrigado pela preferência!</div>');
    return linhas.join("");
  };

  const cardBraai = (r: Reserva) => (
    <div className="c-card" key={r.id}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        <div>
          <b style={{ fontSize: 15 }}>{r.cliente}</b><br />
          <span className="c-sub">{r.codigo} · {r.contacto || "sem contacto"}</span>
        </div>
        {r.checkinEm
          ? <span className="c-chip c-chip-verde">✅ No espaço</span>
          : r.status === "Confirmada"
            ? <span className="c-chip c-chip-amarelo">⏳ Check-in pendente</span>
            : <span className="c-chip c-chip-cinza">{r.status}</span>}
      </div>
      <div style={{ fontSize: 12.5, margin: "8px 0" }}>
        🔥 {r.tipoOutro}<br />
        🗓 {diaBR(r.dataConsumo)} · ⏱ entrada às <b>{r.hora ?? "—"}</b> ({BRAAI_DURACAO_HORAS}h){r.area ? <> · 🪑 <b>{r.area}</b></> : null}<br />
        👥 {r.pessoas} pagantes (10+ anos){r.criancasMenores ? ` · 🧒 ${r.criancasMenores} até 9 anos (grátis)` : ""}<br />
        💰 Total: <b>{mt(r.valor)}</b> · Pago: <b style={{ color: "var(--verde-c)" }}>{mt(r.saldoPago ? r.valor : r.adiant)}</b>
        {r.saldo > 0 && !r.saldoPago && <> · Saldo na entrada: <b style={{ color: "var(--vermelho-c)" }}>{mt(r.saldo)}</b></>}
        {r.checkinObs && <><br />📋 {r.checkinObs}</>}
      </div>
      {r.status === "Confirmada" && !r.checkinEm && r.dataConsumo <= hojeD && (
        <button className="c-btn c-btn-prim c-btn-peq" onClick={() => setCheckin(r)}>
          🔥 Fazer check-in de entrada
        </button>
      )}
    </div>
  );

  return (
    <div>
      <Voltar onClick={voltar} />
      <div className="c-titulo">🔥 Braai — Cliente traz os seus produtos</div>

      <div className="c-card" style={{ borderLeft: "4px solid #ea580c" }}>
        <b>Taxa de uso do espaço (não consumível)</b>
        <div style={{ fontSize: 12.5, marginTop: 4 }}>
          🥩🥤 <b>Braai Completo</b> (traz comida e bebidas): {mt(braaiTaxaPessoa("A", 5))}/p até 9 · {mt(braaiTaxaPessoa("A", 10))}/p a partir de 10<br />
          🥩 <b>Braai Parcial</b> (traz só comida OU só bebidas): {mt(braaiTaxaPessoa("B", 5))}/p até 9 · {mt(braaiTaxaPessoa("B", 10))}/p a partir de 10<br />
          🧒 Crianças até 9 anos não pagam · ⏱ {BRAAI_DURACAO_HORAS} horas por sessão · 🏊🛝 piscina e parque à parte
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <button className="c-btn c-btn-linha c-btn-peq" style={{ flex: 1 }} onClick={() => setVerRegras(true)}>
            📜 Ver regras completas
          </button>
          <button className="c-btn c-btn-linha c-btn-peq" style={{ flex: 1 }}
            onClick={() => printDoc("Regras do Braai", regrasHtml())}>
            🖨 Imprimir p/ afixar
          </button>
        </div>
      </div>

      <div className="c-titulo" style={{ fontSize: 15, marginTop: 14 }}>📅 Braais de HOJE</div>
      {reservas.isLoading && <Vazio icon="⏳">A carregar…</Vazio>}
      {reservas.data && deHoje.length === 0 && <Vazio icon="🔥">Sem braais marcados para hoje.</Vazio>}
      {deHoje.map(cardBraai)}

      {proximos.length > 0 && (
        <>
          <div className="c-titulo" style={{ fontSize: 15, marginTop: 14 }}>🗓 Próximos braais</div>
          {proximos.map(cardBraai)}
        </>
      )}

      {verRegras && (
        <Modal onClose={() => setVerRegras(false)}>
          <h3>📜 Regras do Braai — {emp.nome}</h3>
          <ol style={{ fontSize: 13.5, lineHeight: 1.55, paddingLeft: 18, margin: "8px 0" }}>
            {BRAAI_REGRAS.map((r, i) => <li key={i} style={{ marginBottom: 6 }}>{r}</li>)}
          </ol>
          <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
            <button className="c-btn c-btn-cinza" style={{ flex: 1 }} onClick={() => setVerRegras(false)}>Fechar</button>
            <button className="c-btn c-btn-prim" style={{ flex: 1 }}
              onClick={() => printDoc("Regras do Braai", regrasHtml())}>
              🖨 Imprimir
            </button>
          </div>
        </Modal>
      )}

      {checkin && (
        <CheckinBraaiModal r={checkin} onClose={() => setCheckin(null)}
          onSaved={() => {
            setCheckin(null);
            utils.reservas.list.invalidate();
            toast("✅ Check-in registado");
          }} />
      )}
    </div>
  );
}
