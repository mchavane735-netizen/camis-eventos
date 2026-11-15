/* ============ CRM — carteira de clientes ============
   Junta clientes de TODAS as origens (cadastro online, reservas,
   buffets, casamentos, braai, compras online, restaurante, fiado,
   leads de afiliados) com vendas e perdas por cliente.
   Imprime em A4 (pode guardar em PDF na janela de impressão). */
import { useMemo, useState } from "react";
import { trpc } from "@/providers/trpc";
import { useSession } from "@/lib/session";
import { mt, fmt, diaBR } from "@/lib/fmt";
import { useEmpresa } from "@/lib/empresa";
import { Stat, Vazio, Voltar } from "@/components/bits";
import { printDoc } from "@/lib/docprint";
import { waLink } from "@/lib/loja";
export default function CRM({ voltar }: { voltar: () => void }) {
  const { user } = useSession();
  const emp = useEmpresa();
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<"todos" | "compradores" | "perdas" | "semContacto">("todos");

  const q = trpc.crm.clientes.useQuery({ usuarioId: user?.id ?? 0 }, { enabled: !!user });
  const lista = q.data?.lista ?? [];
  const res = q.data?.resumo;

  const filtrada = useMemo(() => {
    const b = busca.trim().toLowerCase();
    return lista.filter((c) => {
      if (filtro === "compradores" && c.nVendas === 0) return false;
      if (filtro === "perdas" && c.nPerdas === 0) return false;
      if (filtro === "semContacto" && c.telefone) return false;
      if (b && !c.nome.toLowerCase().includes(b) && !(c.telefone ?? "").includes(b.replace(/\D/g, ""))) return false;
      return true;
    });
  }, [lista, busca, filtro]);

  const imprimir = () => {
    if (!filtrada.length) return;
    const linhas = filtrada.map((c, i) => `
      <tr>
        <td>${i + 1}</td>
        <td><b>${c.nome}</b></td>
        <td>${c.telefone ?? "—"}</td>
        <td style="font-size:11px">${c.origens.join(", ")}</td>
        <td style="text-align:center">${c.nVendas}</td>
        <td style="text-align:right">${fmt(c.totalGasto)}</td>
        <td style="text-align:right;${c.perdas > 0 ? "color:#c0392b;font-weight:700" : ""}">${c.perdas > 0 ? fmt(c.perdas) : "—"}</td>
        <td>${c.ultimaData ? diaBR(c.ultimaData) : "—"}</td>
      </tr>`).join("");
    const body = `
      <img class="logo" src="/icons/logo.png" alt="" />
      <div class="c nome">${emp.nome}</div>
      <div class="c small">NUIT ${emp.nuit} · ${emp.local}</div>
      <div class="c titulo">CRM — CARTEIRA DE CLIENTES</div>
      <div class="c small">
        ${res?.totalClientes ?? 0} clientes · ${res?.comVendas ?? 0} compradores ·
        Vendas: ${fmt(res?.totalVendas ?? 0)} MZN · Perdas: ${fmt(res?.totalPerdas ?? 0)} MZN
      </div>
      <div class="sep"></div>
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead>
          <tr style="background:#581c87;color:#fff">
            <th style="padding:5px">#</th><th style="padding:5px;text-align:left">Cliente</th>
            <th style="padding:5px">Contacto</th><th style="padding:5px;text-align:left">Origens</th>
            <th style="padding:5px">Compras</th><th style="padding:5px;text-align:right">Total gasto (MZN)</th>
            <th style="padding:5px;text-align:right">Perdas (MZN)</th><th style="padding:5px">Última act.</th>
          </tr>
        </thead>
        <tbody>${linhas}</tbody>
      </table>
      <div class="sep"></div>
      <div class="c small">Emitido em ${new Date().toLocaleString("pt-PT")} — uso interno · na janela de impressão pode escolher «Guardar como PDF»</div>`;
    printDoc(`CRM clientes — ${emp.nome}`, body);
  };

  return (
    <div>
      <Voltar onClick={voltar} />
      <div className="c-titulo">👥 CRM — Clientes</div>
      <p className="c-sub" style={{ marginTop: -6 }}>
        Todos os clientes do sistema: reservas, buffets, casamentos, braai, compras online, restaurante, fiado e leads dos afiliados.
      </p>

      {q.isLoading && <Vazio icon="⏳">A juntar os clientes de todas as origens…</Vazio>}

      {res && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 10, marginBottom: 12 }}>
            <Stat cls="az" lbl="👥 Clientes">{res.totalClientes} <small>· {res.comContacto} c/ contacto</small></Stat>
            <Stat lbl="🛒 Compradores">{res.comVendas}</Stat>
            <Stat cls="v" lbl="💰 Vendas acumuladas">{mt(res.totalVendas)}</Stat>
            <Stat cls="vm" lbl="⚠️ Perdas">{mt(res.totalPerdas)} <small>· {res.nPerdas} ocorrência(s)</small></Stat>
          </div>

          <input className="c-input" placeholder="🔎 Buscar por nome ou telefone…" value={busca}
            onChange={(e) => setBusca(e.target.value)} style={{ marginBottom: 8 }} />
          <div className="c-abas" style={{ marginBottom: 10 }}>
            {([["todos", "Todos"], ["compradores", "🛒 Compradores"], ["perdas", "⚠️ Com perdas"], ["semContacto", "📵 Sem contacto"]] as Array<[typeof filtro, string]>).map(([k, l]) => (
              <button key={k} className={filtro === k ? "ativo" : ""} onClick={() => setFiltro(k)}>{l}</button>
            ))}
          </div>

          {filtrada.length === 0 && <Vazio icon="👥">Nenhum cliente encontrado.</Vazio>}
          {filtrada.map((c) => (
            <div key={c.nome + (c.telefone ?? "")} className="c-card" style={{ padding: "10px 12px" }}>
              <div className="c-linha" style={{ border: "none", padding: 0 }}>
                <div className="grow">
                  <b style={{ fontSize: 14.5 }}>{c.nome}</b>
                  <div className="c-sub" style={{ margin: 0 }}>
                    {c.telefone ?? "sem contacto"}
                    {c.ultimaData && <> · última act. {diaBR(c.ultimaData)}</>}
                  </div>
                </div>
                {c.telefone && (
                  <a className="c-btn c-btn-verde c-btn-peq" target="_blank" rel="noreferrer"
                    href={waLink(c.telefone, `Olá ${c.nome.split(" ")[0]}! Aqui é a ${emp.nome}. 😊`)}>💬</a>
                )}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, margin: "6px 0" }}>
                {c.origens.map((o) => <span key={o} className="c-chip-roxo" style={{ fontSize: 10.5 }}>{o}</span>)}
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5 }}>
                <span>🛒 {c.nVendas} compra(s) · <b style={{ color: "var(--verde-c)" }}>{mt(c.totalGasto)}</b></span>
                {c.perdas > 0
                  ? <span style={{ color: "var(--vermelho-c)" }}>⚠️ {c.nPerdas} perda(s) · <b>{mt(c.perdas)}</b></span>
                  : <span className="c-sub" style={{ margin: 0 }}>sem perdas</span>}
              </div>
            </div>
          ))}

          <button className="c-btn c-btn-prim c-btn-bloco" style={{ marginTop: 8 }} onClick={imprimir} disabled={filtrada.length === 0}>
            🖨️ Imprimir CRM em A4 (ou guardar em PDF)
          </button>
        </>
      )}
    </div>
  );
}
