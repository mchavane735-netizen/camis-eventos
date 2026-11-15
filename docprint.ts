import { fmt } from "@/lib/fmt";
import { precoEspacoSemDecoracao, ESPACOS_EVENTO, type EmpresaCfg } from "@contracts/types";

/* ============================================================
   Documentos em formato pequeno (talão térmico 80mm):
   Pro-forma, Factura e Recibo — prontos para impressão.
   ============================================================ */

export type DocItem = { nome: string; qtd: number; precoUnit: number; total: number; personalizado?: boolean; obs?: string };

export type DocData = {
  id: number;
  codigo: string;
  tipo: "Proforma" | "Factura";
  pedidoRef: string | null;
  clienteNome: string | null;
  clienteEmail: string | null;
  clienteNuit: string | null;
  representante: string | null;
  ivaModo: "incluido" | "adicional" | "isento";
  desconto: number; // %
  subtotal: number;
  ivaValor: number;
  total: number;
  itens: DocItem[];
  criadoEm: string | Date;
};

const esc = (s: unknown) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const dataHora = (d: string | Date) => {
  const dt = new Date(d);
  return (
    dt.toLocaleDateString("pt-PT", { day: "2-digit", month: "2-digit", year: "numeric" }) +
    " " +
    dt.toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" })
  );
};

function cabecalho(emp: EmpresaCfg) {
  return `
    <img class="logo" src="/icons/logo.png" alt="" />
    <div class="c nome">${esc(emp.nome)}</div>
    <div class="c slogan">${esc(emp.slogan)}</div>
    <div class="c"><b>NUIT: ${esc(emp.nuit)}</b></div>
    <div class="c">${esc(emp.local)}</div>
    <div class="c">Tel: ${esc(emp.tel1)} / ${esc(emp.tel2)}</div>
    <div class="sep"></div>`;
}

function clienteBloco(d: {
  clienteNome?: string | null; clienteEmail?: string | null;
  clienteNuit?: string | null; representante?: string | null;
}) {
  const linhas: string[] = [];
  if (d.clienteNome) linhas.push(`<div class="r"><span>Cliente:</span><b>${esc(d.clienteNome)}</b></div>`);
  if (d.clienteNuit) linhas.push(`<div class="r"><span>NUIT do cliente:</span><b>${esc(d.clienteNuit)}</b></div>`);
  if (d.clienteEmail) linhas.push(`<div class="r"><span>Email:</span><span>${esc(d.clienteEmail)}</span></div>`);
  if (d.representante) linhas.push(`<div class="r"><span>Representante:</span><span>${esc(d.representante)}</span></div>`);
  return linhas.length ? linhas.join("") + '<div class="sep"></div>' : "";
}

function tabelaItens(itens: DocItem[]) {
  const rows = itens
    .map(
      (i) => `<tr>
        <td>${esc(i.nome)}${i.obs ? `<br/><small style="color:#0d6e3f">🍽 ${esc(i.obs)}</small>` : ""}</td>
        <td class="n">${i.qtd}</td>
        <td class="n">${fmt(i.precoUnit)}</td>
        <td class="n">${fmt(i.total)}</td>
      </tr>`,
    )
    .join("");
  return `<table>
    <tr class="hd"><td>Descrição</td><td class="n">Qtd</td><td class="n">V.Unit</td><td class="n">Total</td></tr>
    ${rows}
  </table><div class="sep"></div>`;
}

function totais(d: { subtotal: number; desconto: number; ivaModo: string; ivaValor: number; total: number }, emp: EmpresaCfg) {
  const taxa = emp.iva || "16";
  const linhas: string[] = [];
  linhas.push(`<div class="r"><span>Subtotal</span><span>${fmt(d.subtotal)} MZN</span></div>`);
  if (d.desconto > 0) {
    const descValor = (d.subtotal * d.desconto) / 100;
    linhas.push(`<div class="r"><span>Desconto (${d.desconto}%)</span><span>− ${fmt(descValor)} MZN</span></div>`);
  }
  if (d.ivaModo === "incluido")
    linhas.push(`<div class="r"><span>IVA (${taxa}%) incluído</span><span>${fmt(d.ivaValor)} MZN</span></div>`);
  else if (d.ivaModo === "adicional")
    linhas.push(`<div class="r"><span>IVA (${taxa}%)</span><span>+ ${fmt(d.ivaValor)} MZN</span></div>`);
  else linhas.push(`<div class="r"><span>IVA</span><span>Isento</span></div>`);
  linhas.push(`<div class="r tot"><span>TOTAL</span><span>${fmt(d.total)} MZN</span></div>`);
  return linhas.join("");
}

function bancoBloco(emp: EmpresaCfg) {
  return `
    <div class="sep"></div>
    <div class="c"><b>DADOS DE PAGAMENTO</b></div>
    <div>Transferência eMola: ${esc(emp.emola)} — Titular: ${esc(emp.titular)}</div>
    <div>Levantamento eMola: ${esc(emp.emolaLev)} — Titular: ${esc(emp.emolaLevTitular)}</div>
    <div>${esc(emp.banco)}: ${esc(emp.conta)} · NIB ${esc(emp.nib)}</div>
    <div>Titular: ${esc(emp.beneficiario)}</div>
    <div class="small">Nota: para pagamentos por transferência bancária, contacte o restaurante (87 458 9150) para flexibilizar a confirmação.</div>`;
}

function rodape(emp: EmpresaCfg, extra?: string) {
  return `
    <div class="sep"></div>
    ${extra ? `<div class="c">${extra}</div>` : ""}
    <div class="c">Obrigado pela preferência!</div>
    <div class="c small">Documento processado por computador<br/>${esc(emp.nome)} · NUIT ${esc(emp.nuit)}</div>`;
}

/** Corpo HTML de uma Pro-forma ou Factura */
export function docBodyHtml(d: DocData, emp: EmpresaCfg): string {
  const titulo = d.tipo === "Proforma" ? "FACTURA PRO-FORMA" : "FACTURA";
  return `
    ${cabecalho(emp)}
    <div class="c titulo">${titulo}</div>
    <div class="c"><b>Nº ${esc(d.codigo)}</b> · ${dataHora(d.criadoEm)}</div>
    ${d.pedidoRef ? `<div class="c small">Ref.: ${esc(d.pedidoRef)}</div>` : ""}
    <div class="sep"></div>
    ${clienteBloco(d)}
    ${tabelaItens(d.itens)}
    ${totais(d, emp)}
    ${d.tipo === "Proforma" ? '<div class="c small" style="margin-top:2mm">Documento sem valor fiscal — válido como cotação por 15 dias.</div>' : ""}
    ${bancoBloco(emp)}
    ${rodape(emp)}`;
}

/** Corpo HTML do recibo simples de um pedido fechado */
/** Comanda de produção/balcão — talão 80mm com os itens em letra grande (sem preços) */
export function comandaHtml(o: {
  titulo: string; // ex.: "COMANDA — COZINHA" ou "COMANDA — BALCÃO"
  origem: string; // ex.: "Pedido nº 12 — Mesa 7" ou "Online OL-0031 — Delivery"
  extra?: string | null; // área, bairro, observações gerais
  itens: { nome: string; qtd: number; obs?: string | null; personalizado?: boolean }[];
  emp: EmpresaCfg;
}): string {
  const linhas: string[] = [];
  linhas.push(cabecalho(o.emp));
  linhas.push(`<div class="c titulo">${esc(o.titulo)}</div>`);
  linhas.push(`<div class="c" style="font-weight:800;font-size:12.5px">${esc(o.origem)}</div>`);
  if (o.extra) linhas.push(`<div class="c small">${esc(o.extra)}</div>`);
  linhas.push('<div class="sep"></div>');
  for (const i of o.itens) {
    linhas.push(`<div style="font-size:15px;font-weight:800;margin:1.2mm 0 0">${i.personalizado ? "✳️ " : ""}${i.qtd}× ${esc(i.nome)}</div>`);
    if (i.obs) linhas.push(`<div style="font-size:11px;margin-left:4mm">🍽 ${esc(i.obs)}</div>`);
  }
  linhas.push('<div class="sep"></div>');
  linhas.push(`<div class="c small">${new Date(Date.now() + 2 * 3600e3).toISOString().slice(11, 16)} · ${new Date(Date.now() + 2 * 3600e3).toISOString().slice(0, 10)}</div>`);
  return linhas.join("");
}

export function reciboBodyHtml(p: {
  numero: number; dataDia: string; referencia?: string | null; area?: string | null;
  itens: DocItem[]; subtotal: number; desconto: number; total: number; adiantDeduzido?: number;
  metodo?: string | null; recebido?: number | null; troco?: number | null;
}, emp: EmpresaCfg): string {
  const linhas: string[] = [];
  linhas.push(cabecalho(emp));
  linhas.push(`<div class="c titulo">RECIBO</div>`);
  linhas.push(`<div class="r"><span>Pedido:</span><b>nº ${p.numero} — ${esc(p.dataDia)}</b></div>`);
  if (p.referencia) linhas.push(`<div class="r"><span>Referência:</span><span>${esc(p.referencia)}</span></div>`);
  if (p.area) linhas.push(`<div class="r"><span>Local:</span><span>${esc(p.area)}</span></div>`);
  linhas.push('<div class="sep"></div>');
  linhas.push(tabelaItens(p.itens));
  linhas.push(`<div class="r"><span>Subtotal</span><span>${fmt(p.subtotal)} MZN</span></div>`);
  if (p.desconto > 0)
    linhas.push(`<div class="r"><span>Desconto (${p.desconto}%)</span><span>− ${fmt((p.subtotal * p.desconto) / 100)} MZN</span></div>`);
  if (p.adiantDeduzido && p.adiantDeduzido > 0)
    linhas.push(`<div class="r"><span>Adiantamento (reserva)</span><span>− ${fmt(p.adiantDeduzido)} MZN</span></div>`);
  linhas.push(`<div class="r tot"><span>TOTAL</span><span>${fmt(p.total)} MZN</span></div>`);
  if (p.metodo) linhas.push(`<div class="r"><span>Pagamento</span><span>${esc(p.metodo)}</span></div>`);
  if (p.metodo?.includes("Dinheiro")) {
    linhas.push(`<div class="r"><span>Recebido</span><span>${fmt(p.recebido ?? 0)} MZN</span></div>`);
    linhas.push(`<div class="r"><span>Troco</span><span>${fmt(p.troco ?? 0)} MZN</span></div>`);
  }
  linhas.push('<div style="font-size:9.5px;margin-top:1mm">🎁 <b>Bónus grátis para crianças:</b> baloiço, escorrega e balanço (parque infantil). Válido apenas no dia de consumo deste pedido.</div>');
  linhas.push(rodape(emp));
  return linhas.join("");
}

/** Corpo HTML da FACTURA de um pedido online (emitida após a confirmação do pagamento) */
export function facturaOnlineHtml(p: {
  codigo: string; clienteNome: string; clienteTelefone: string;
  tipo: string; dataAgendada?: string | null; horaAgendada?: string | null; pessoas?: number | null; mesa?: string | null;
  itens: DocItem[]; subtotal: number; taxaEntrega: number; total: number; adiant: number;
  metodoPagamento?: string | null;
  criadoEm: string | Date;
}, emp: EmpresaCfg): string {
  const linhas: string[] = [];
  const reserva = p.tipo === "Reserva";
  linhas.push(cabecalho(emp));
  linhas.push(`<div class="c titulo">FACTURA${reserva ? " DE RESERVA" : ""}</div>`);
  linhas.push(`<div class="c"><b>Nº ${esc(p.codigo)}</b> · ${dataHora(p.criadoEm)}</div>`);
  linhas.push('<div class="sep"></div>');
  linhas.push(`<div class="r"><span>Cliente:</span><b>${esc(p.clienteNome)}</b></div>`);
  linhas.push(`<div class="r"><span>Telefone:</span><span>${esc(p.clienteTelefone)}</span></div>`);
  linhas.push(`<div class="r"><span>Tipo:</span><span>${esc(p.tipo)}${p.mesa ? " — Mesa " + esc(p.mesa) : ""}</span></div>`);
  if (p.dataAgendada) linhas.push(`<div class="r"><span>Data da reserva:</span><b>${esc(p.dataAgendada)}${p.horaAgendada ? " às " + esc(p.horaAgendada) : ""}</b></div>`);
  if (reserva && p.pessoas) linhas.push(`<div class="r"><span>Pessoas:</span><b>${p.pessoas}</b></div>`);
  linhas.push('<div class="sep"></div>');
  linhas.push(tabelaItens(p.itens));
  linhas.push(`<div class="r"><span>Subtotal</span><span>${fmt(p.subtotal)} MZN</span></div>`);
  linhas.push(`<div class="r tot"><span>TOTAL ${reserva ? "DA RESERVA" : "PAGO AO RESTAURANTE"}</span><span>${fmt(p.total)} MZN</span></div>`);
  if (p.taxaEntrega > 0) {
    linhas.push(`<div class="r"><span>🛵 Taxa de entrega</span><span>${fmt(p.taxaEntrega)} MZN</span></div>`);
    linhas.push(`<div style="font-size:9px">ℹ️ A taxa de entrega é paga ao entregador no momento da entrega — não faz parte do total acima.</div>`);
  }
  if (reserva) {
    const remanescente = Math.max(0, p.total - p.adiant);
    linhas.push(`<div class="r"><span>✅ ADIANTAMENTO PAGO (50%)</span><span>${fmt(p.adiant)} MZN</span></div>`);
    linhas.push(`<div class="r tot"><span>⏳ REMANESCENTE (no local)</span><span>${fmt(remanescente)} MZN</span></div>`);
    linhas.push('<div style="font-size:9.5px;margin-top:1mm">📌 <b>Guarde esta factura e apresente-a no local no dia de consumo.</b> O remanescente é pago no restaurante — o adiantamento desconta no que consumir. A escolha dos pratos é feita no local, durante o consumo.</div>');
  } else if (p.adiant > 0) {
    linhas.push(`<div class="r"><span>Adiantamento pago (50%)</span><span>${fmt(p.adiant)} MZN</span></div>`);
  }
  if (p.tipo === "Local" || reserva)
    linhas.push('<div style="font-size:9.5px;margin-top:1mm">🎁 <b>Bónus grátis para crianças:</b> baloiço, escorrega e balanço (parque infantil). Válido apenas no dia de consumo deste pedido.</div>');
  linhas.push(`<div class="r"><span>Pagamento</span><span>Online (${esc(p.metodoPagamento ?? "Transferência eMola/FNB")}) — ${reserva ? "ADIANTAMENTO PAGO" : "PAGO"}</span></div>`);
  linhas.push(rodape(emp));
  return linhas.join("");
}

/* ---------- CSS partilhado (ecrã + impressão 80mm) ---------- */
export const DOC_CSS = `
  .docp { font-family: "Courier New", monospace; font-size: 11px; line-height: 1.45; color: #000; }
  .docp .logo { display: block; margin: 0 auto 1.5mm; width: 17mm; height: auto; }
  .docp .c { text-align: center; }
  .docp .nome { font-size: 15px; font-weight: 800; letter-spacing: 1px; }
  .docp .slogan { font-size: 9.5px; font-style: italic; }
  .docp .titulo { font-size: 13px; font-weight: 800; margin-top: 1mm; letter-spacing: 1px; }
  .docp .small { font-size: 9px; color: #333; }
  .docp .sep { border-top: 1px dashed #000; margin: 2mm 0; }
  .docp .r { display: flex; justify-content: space-between; gap: 4mm; }
  .docp .r.tot { font-weight: 800; font-size: 14px; border-top: 1px solid #000; border-bottom: 1px solid #000; padding: 1mm 0; margin-top: 1mm; }
  .docp table { width: 100%; border-collapse: collapse; }
  .docp td { vertical-align: top; padding: 0.4mm 0; }
  .docp td.n { text-align: right; white-space: nowrap; }
  .docp tr.hd td { border-top: 1px solid #000; border-bottom: 1px solid #000; font-weight: 700; font-size: 10px; }
`;

/** Imprime um documento num iframe oculto, formato talão 80mm */
export function printDoc(titulo: string, bodyHtml: string) {
  const ifr = document.createElement("iframe");
  ifr.style.position = "fixed";
  ifr.style.right = "0";
  ifr.style.bottom = "0";
  ifr.style.width = "0";
  ifr.style.height = "0";
  ifr.style.border = "0";
  document.body.appendChild(ifr);
  const win = ifr.contentWindow!;
  const doc = win.document;
  doc.open();
  doc.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${titulo}</title>
    <style>
      @page { size: 80mm auto; margin: 2mm; }
      * { box-sizing: border-box; }
      body { margin: 0; padding: 0; width: 76mm; }
      ${DOC_CSS}
    </style></head><body><div class="docp">${bodyHtml}</div></body></html>`);
  doc.close();
  win.focus();
  // Aguarda o carregamento das imagens (logotipo) antes de imprimir
  const imgs = Array.from(doc.images);
  Promise.all(
    imgs.map((img) =>
      img.complete
        ? Promise.resolve()
        : new Promise<void>((res) => {
            img.onload = () => res();
            img.onerror = () => res();
          }),
    ),
  ).then(() => {
    setTimeout(() => {
      win.print();
      setTimeout(() => ifr.remove(), 2000);
    }, 150);
  });
}

/** Garante que o logotipo está carregado antes de renderizar para PDF */
function preloadLogo(): Promise<void> {
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => res();
    img.onerror = () => res();
    img.src = "/icons/logo.png";
  });
}

/* ============================================================
   COMPROVATIVO DE RESERVA (talão 80mm)
   ============================================================ */

export type ReservaDoc = {
  codigo?: string | null;
  cliente: string;
  contacto?: string | null;
  dataConsumo: string;
  hora?: string | null;
  tipo: string;
  tipoOutro?: string | null;
  area?: string | null;
  espaco?: string | null; // espaço de evento alugado (reserva de salão)
  semDecoracao?: boolean; // aluguer do espaço sem pacote/decoração
  pessoas: number;
  taxaReserva?: number;
  pacoteNome?: string | null;
  condicoes?: string | null;
  valor: number;
  adiantPct: number;
  /* --- braai --- */
  braai?: boolean;
  braaiModalidade?: "A" | "B" | null;
  braaiTraz?: "Comida" | "Bebidas" | null;
  criancasMenores?: number;
  desconto?: number; // desconto combinado (MZN) — já deduzido no valor
};

const reservaNotas = (r: ReservaDoc): string[] => {
  const notas: string[] = [];
  if (r.braai) {
    notas.push("TAXA DE BRAAI NÃO CONSUMÍVEL: cobre o uso do espaço, mesas, cadeiras e água. Não é descontada em consumos.");
    notas.push("NÃO inclui utensílios de cozinha, ingredientes nem carvão — o cliente pode trazer o seu fogão/grelhador e utensílios.");
    notas.push("A assadura da carne é feita FORA, no espaço indicado pela equipa da CAMI'S EVENTOS.");
    notas.push("Bebidas trazidas de fora: máximo 3 por pessoa e apenas bebidas que a casa não vende ou não tem em stock. Whisky ou vinho: apenas 1 garrafa por cada 10 pessoas.");
    notas.push("Duração: 5 horas de uso do espaço, contadas a partir da hora de entrada marcada.");
    notas.push("Crianças até 9 anos não pagam taxa de braai.");
    notas.push("A taxa NÃO inclui piscina nem parque infantil — pagos à parte.");
    notas.push("O saldo (se houver) é pago NA ENTRADA, antes de ocupar o espaço. A equipa confirma na entrada o que foi efectivamente trazido.");
    return notas;
  }
  if (r.pacoteNome)
    notas.push("O adiantamento do pacote de salão inclui a decoração. Os detalhes da decoração e outros aspectos serão discutidos em privado com o cliente, de preferência no dia do pagamento.");
  else if (r.espaco)
    notas.push("Aluguer do espaço SEM decoração. O adiantamento (mínimo 50%) garante o bloqueio do espaço na data reservada.");
  else
    notas.push("O adiantamento (nº de pessoas × taxa de reserva) é CONSUMÍVEL no local no dia do evento e serve como garantia da reserva.");
  notas.push("Os pedidos de comida e bebida são feitos no local, no dia do evento.");
  return notas;
};

/** Corpo HTML do comprovativo de reserva */
export function reservaBodyHtml(r: ReservaDoc, emp: EmpresaCfg): string {
  const adiant = Math.round(r.valor * (r.adiantPct / 100) * 100) / 100;
  const saldo = Math.round((r.valor - adiant) * 100) / 100;
  const [y, m, d] = r.dataConsumo.split("-");
  const dataBR = r.dataConsumo.includes("-") ? `${d}/${m}/${y}` : r.dataConsumo;
  const linhas: string[] = [];
  linhas.push(cabecalho(emp));
  linhas.push(`<div class="c titulo">COMPROVATIVO DE RESERVA</div>`);
  if (r.codigo) linhas.push(`<div class="c"><b>Nº ${esc(r.codigo)}</b></div>`);
  linhas.push('<div class="sep"></div>');
  linhas.push(`<div class="r"><span>Cliente:</span><b>${esc(r.cliente)}</b></div>`);
  if (r.contacto) linhas.push(`<div class="r"><span>Contacto:</span><span>${esc(r.contacto)}</span></div>`);
  linhas.push(`<div class="r"><span>Data do evento:</span><b>${dataBR}${r.hora ? " " + esc(r.hora) : ""}</b></div>`);
  linhas.push(`<div class="r"><span>Evento:</span><span>${esc(r.tipo)}${r.tipoOutro ? ` — ${esc(r.tipoOutro)}` : ""}</span></div>`);
  if (r.area) linhas.push(`<div class="r"><span>Espaço (sentar):</span><b>${esc(r.area)}</b></div>`);
  if (r.espaco) linhas.push(`<div class="r"><span>Espaço reservado:</span><b>${esc(r.espaco)}${r.semDecoracao ? " (sem decoração)" : ""}</b></div>`);
  if (r.pessoas > 0) linhas.push(`<div class="r"><span>Pessoas:</span><span>${r.pessoas}</span></div>`);
  linhas.push('<div class="sep"></div>');
  if (r.braai) {
    const taxa = r.pessoas > 0 ? r.valor / r.pessoas : 0;
    linhas.push(`<div class="r"><span>Modalidade:</span><b>${r.braaiModalidade === "A" ? "Braai Completo" : "Braai Parcial"}</b></div>`);
    linhas.push(`<div class="r"><span>Cliente traz:</span><span>${r.braaiModalidade === "A" ? "Comida e bebidas" : r.braaiTraz === "Comida" ? "Só comida" : "Só bebidas"}</span></div>`);
    linhas.push(`<div class="r"><span>Taxa de braai (não consumível):</span><span>${r.pessoas} × ${fmt(taxa)} MZN</span></div>`);
    if (r.criancasMenores) linhas.push(`<div class="r"><span>Crianças até 9 anos:</span><span>${r.criancasMenores} (grátis)</span></div>`);
    if (r.hora) linhas.push(`<div class="r"><span>Entrada / duração:</span><b>${esc(r.hora)} · 5 horas</b></div>`);
  } else if (r.pacoteNome) {
    linhas.push(`<div class="r"><span>Pacote de salão:</span><b>${esc(r.pacoteNome)}</b></div>`);
  } else if (r.espaco) {
    linhas.push(`<div class="r"><span>Aluguer do espaço (sem decoração):</span><span>${fmt(r.valor)} MZN</span></div>`);
  } else {
    const taxa = r.taxaReserva ?? 400;
    linhas.push(`<div class="r"><span>Taxa de reserva:</span><span>${r.pessoas} × ${fmt(taxa)} MZN</span></div>`);
  }
  if (r.condicoes) linhas.push(`<div><b>Condições:</b> ${esc(r.condicoes)}</div>`);
  linhas.push('<div class="sep"></div>');
  if (r.desconto && r.desconto > 0) {
    linhas.push(`<div class="r"><span>Valor antes do desconto:</span><span>${fmt(r.valor + r.desconto)} MZN</span></div>`);
    linhas.push(`<div class="r"><span>Desconto combinado:</span><span>− ${fmt(r.desconto)} MZN</span></div>`);
  }
  linhas.push(`<div class="r"><span>Valor total</span><span>${fmt(r.valor)} MZN</span></div>`);
  linhas.push(`<div class="r"><span>Adiantamento (${r.adiantPct}%)</span><span>${fmt(adiant)} MZN</span></div>`);
  linhas.push(`<div class="r tot"><span>SALDO A PAGAR</span><span>${fmt(saldo)} MZN</span></div>`);
  linhas.push('<div class="sep"></div>');
  for (const n of reservaNotas(r)) linhas.push(`<div style="font-size:9px">ℹ️ ${esc(n)}</div>`);
  linhas.push(bancoBloco(emp));
  linhas.push(rodape(emp, "O adiantamento confirma a sua reserva."));
  return linhas.join("");
}

/** Factura provisória da reserva: valor pago (adiantamento) e remanescente — para enviar ao cliente */
export function reservaProvisoriaHtml(r: ReservaDoc & { pago: boolean }, emp: EmpresaCfg): string {
  const adiant = Math.round(r.valor * (r.adiantPct / 100) * 100) / 100;
  const saldo = Math.round((r.valor - adiant) * 100) / 100;
  const [y, m, d] = r.dataConsumo.split("-");
  const dataBR = r.dataConsumo.includes("-") ? `${d}/${m}/${y}` : r.dataConsumo;
  const hojeMz = new Date(Date.now() + 2 * 3600e3);
  const emissao = `${String(hojeMz.getUTCDate()).padStart(2, "0")}/${String(hojeMz.getUTCMonth() + 1).padStart(2, "0")}/${hojeMz.getUTCFullYear()}`;
  const linhas: string[] = [];
  linhas.push(cabecalho(emp));
  linhas.push(`<div class="c titulo">FACTURA PROVISÓRIA</div>`);
  if (r.codigo) linhas.push(`<div class="c"><b>Ref. Reserva ${esc(r.codigo)}</b></div>`);
  linhas.push(`<div class="c" style="font-size:9px">Emitida em ${emissao} — documento provisório, não substitui a factura final</div>`);
  linhas.push('<div class="sep"></div>');
  linhas.push(`<div class="r"><span>Cliente:</span><b>${esc(r.cliente)}</b></div>`);
  if (r.contacto) linhas.push(`<div class="r"><span>Contacto:</span><span>${esc(r.contacto)}</span></div>`);
  linhas.push(`<div class="r"><span>Evento:</span><span>${esc(r.tipo)}${r.tipoOutro ? ` — ${esc(r.tipoOutro)}` : ""}</span></div>`);
  if (r.area) linhas.push(`<div class="r"><span>Espaço (sentar):</span><b>${esc(r.area)}</b></div>`);
  if (r.espaco) linhas.push(`<div class="r"><span>Espaço reservado:</span><b>${esc(r.espaco)}${r.semDecoracao ? " (sem decoração)" : ""}</b></div>`);
  linhas.push(`<div class="r"><span>Data do evento:</span><b>${dataBR}${r.hora ? " " + esc(r.hora) : ""}</b></div>`);
  linhas.push('<div class="sep"></div>');
  if (r.braai)
    linhas.push(`<div class="r"><span>🔥 ${esc(r.tipoOutro ?? (r.braaiModalidade === "A" ? "Braai Completo" : "Braai Parcial"))} — ${r.pessoas} pagantes × ${fmt(r.pessoas > 0 ? r.valor / r.pessoas : 0)} MZN (não consumível)</span><span>${fmt(r.valor)} MZN</span></div>`);
  else if (r.pacoteNome)
    linhas.push(`<div class="r"><span>${esc(r.pacoteNome)}</span><span>${fmt(r.valor)} MZN</span></div>`);
  else if (r.espaco)
    linhas.push(`<div class="r"><span>Aluguer: ${esc(r.espaco)} (sem decoração)</span><span>${fmt(r.valor)} MZN</span></div>`);
  else
    linhas.push(`<div class="r"><span>Reserva: ${r.pessoas} pessoas × ${fmt(r.taxaReserva ?? 400)} MZN</span><span>${fmt(r.valor)} MZN</span></div>`);
  linhas.push(`<div class="r tot"><span>VALOR TOTAL</span><span>${fmt(r.valor)} MZN</span></div>`);
  linhas.push('<div class="sep"></div>');
  linhas.push(`<div class="r"><span>${r.pago ? "✅ Adiantamento PAGO" : "Adiantamento a pagar"} (${r.adiantPct}%)</span><b style="color:${r.pago ? "#1a7a3c" : "#b3261e"}">${fmt(adiant)} MZN</b></div>`);
  linhas.push(`<div class="r tot"><span>REMANESCENTE</span><span>${fmt(saldo)} MZN</span></div>`);
  linhas.push('<div class="sep"></div>');
  for (const n of reservaNotas(r)) linhas.push(`<div style="font-size:9px">ℹ️ ${esc(n)}</div>`);
  linhas.push(bancoBloco(emp));
  linhas.push(rodape(emp, "Obrigado pela preferência!"));
  return linhas.join("");
}

/* ============================================================
   MENU COMPLETO (A4) — impressão e PDF
   ============================================================ */

export type MenuProduto = { nome: string; preco: number; categoria: string; ingredientes?: string | null; tipo?: string };
export type MenuBuffet = {
  nome: string; preco: number; descricao?: string | null;
  itens: string[]; categorias?: { nome: string; itens: string[] }[] | null;
};

const MENU_CSS = `
  .menu { font-family: Georgia, "Times New Roman", serif; color: #2b2140; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  /* — capa (hero) com logotipo — */
  .menu .m-hero { background: linear-gradient(135deg, #2a1450 0%, #4b2e83 55%, #6239a8 100%); border-radius: 3mm; padding: 6mm 6mm 5mm; text-align: center; color: #ffffff; page-break-inside: avoid; break-inside: avoid; }
  .menu .m-logo { display: block; margin: 0 auto 2.5mm; width: 24mm; background: #ffffff; border-radius: 50%; padding: 2mm; box-shadow: 0 0 0 1.1mm #e8b53a; }
  .menu .m-nome { font-size: 21pt; font-weight: 800; letter-spacing: 2.5px; color: #e8b53a; line-height: 1.1; }
  .menu .m-slogan { font-style: italic; font-size: 10pt; color: #e9ddf7; margin-top: 0.6mm; }
  .menu .m-menu { font-size: 12.5pt; font-weight: 800; letter-spacing: 6px; color: #ffffff; margin-top: 2.6mm; }
  .menu .m-nuit { font-size: 8.5pt; font-weight: 700; margin-top: 1.6mm; color: #e9ddf7; }
  .menu .m-local { font-size: 8pt; color: #cdbce6; }
  .menu .m-tript { display: flex; gap: 2mm; margin-top: 3.5mm; }
  .menu .m-tript .ph { flex: 1; height: 23mm; border-radius: 1.8mm; background-size: cover; background-position: center; box-shadow: inset 0 0 0 0.5mm rgba(232,181,58,.9); }
  /* — faixa fotográfica de cada grupo (bebidas / refeições / serviços) — */
  .menu .g-band { display: flex; height: 20mm; border-radius: 2mm; overflow: hidden; margin: 5.5mm 0 2.2mm; position: relative; page-break-inside: avoid; break-inside: avoid; page-break-after: avoid; break-after: avoid; }
  .menu .g-band .ph { flex: 1; background-size: cover; background-position: center; }
  .menu .g-over { position: absolute; top: 0; left: 0; right: 0; bottom: 0; display: flex; align-items: center; justify-content: center; background: rgba(38,18,70,.42); }
  .menu .g-tit { font-size: 14pt; font-weight: 800; letter-spacing: 3.5px; color: #ffffff; border-top: 0.7mm solid #e8b53a; border-bottom: 0.7mm solid #e8b53a; padding: 0.8mm 6mm; text-shadow: 0 1px 3px rgba(0,0,0,.55); }
  /* — categorias e itens (compactos, 2 colunas) — */
  .menu h3 { font-size: 10pt; color: #4b2e83; letter-spacing: 1.1px; text-transform: uppercase; margin: 2.8mm 0 0.8mm; border-bottom: 0.8px solid #d9c8f0; padding-bottom: 0.5mm; page-break-after: avoid; break-after: avoid; }
  .menu .cols { display: flex; gap: 5mm; }
  .menu .col { flex: 1; min-width: 0; }
  .menu .mi { display: flex; align-items: baseline; gap: 1.5mm; padding: 0.32mm 0; font-size: 8.8pt; line-height: 1.2; }
  .menu .mi .pontos { flex: 1; border-bottom: 0.7px dotted #b9a6d9; }
  .menu .mi .preco { font-weight: 700; white-space: nowrap; color: #8a5a00; }
  .menu .m-ing { font-size: 7.2pt; font-style: italic; color: #7a6a99; line-height: 1.15; margin-bottom: 0.5mm; }
  .menu .m-nota { font-size: 7.8pt; font-style: italic; color: #6a5a8a; margin: 0 0 1.2mm; line-height: 1.25; page-break-after: avoid; break-after: avoid; }
  .menu .bf { border: 0.8px solid #d9c8f0; border-left: 1.1mm solid #e8b53a; border-radius: 1.5mm; padding: 1.6mm 2.5mm; margin: 0 0 2mm; page-break-inside: avoid; break-inside: avoid; }
  .menu .bf-head { display: flex; align-items: baseline; gap: 1.5mm; font-size: 9.5pt; }
  .menu .bf-head .pontos { flex: 1; border-bottom: 0.7px dotted #b9a6d9; }
  .menu .bf-head .preco { font-weight: 800; color: #8a5a00; white-space: nowrap; }
  .menu .bf-cats { font-size: 7.6pt; color: #4a3a6a; line-height: 1.3; margin-top: 0.5mm; }
  .menu .bf-cats b { color: #4b2e83; }
  .menu .bf-desc { font-size: 7.6pt; font-style: italic; color: #7a6a99; margin-top: 0.5mm; }
  .menu .m-rodape { margin-top: 5mm; text-align: center; font-size: 8pt; color: #ffffff; background: #4b2e83; border-radius: 2mm; padding: 2.2mm 3mm; }
`;

/** Corpo HTML do menu completo — estilo CARTAZ A4: capa com logotipo, faixas
    fotográficas por grupo (Bebidas / Refeições / Serviços & Lazer) e itens em
    2 colunas compactas. Apenas produtos activos; lido sempre da base de dados. */
export function menuHtml(produtos: MenuProduto[], emp: EmpresaCfg, buffets: MenuBuffet[] = []): string {
  const linha = (nome: string, preco: number, ingredientes?: string | null) =>
    `<div class="mi"><span>${esc(nome)}</span><span class="pontos"></span><span class="preco">${fmt(preco)} MZN</span></div>`
    + (ingredientes?.trim() ? `<div class="m-ing">${esc(ingredientes.trim())}</div>` : "");
  // itens de uma categoria repartidos por 2 colunas (menu mais curto e fácil de ler)
  const colunas = (its: MenuProduto[]) => {
    const meio = Math.ceil(its.length / 2);
    const metade = (l: MenuProduto[]) => l.map((p) => linha(p.nome, p.preco, p.ingredientes)).join("");
    return `<div class="cols"><div class="col">${metade(its.slice(0, meio))}</div><div class="col">${metade(its.slice(meio))}</div></div>`;
  };
  const blocoCat = (cat: string, its: MenuProduto[]) => {
    // «Salão» = pacotes de aluguer COM decoração (preço varia pelo nº de pessoas) — título explícito
    if (cat === "Salão")
      return `<h3>Aluguer de Salão com Decoração — pacotes por nº de pessoas</h3>`
        + `<p class="m-nota">O pacote inclui: aluguer do espaço, decoração, cenário, mesas e cadeiras decoradas e casas de banho. Os detalhes da decoração são combinados em privado com o cliente.</p>`
        + colunas(its);
    return `<h3>${esc(cat)}</h3>` + colunas(its);
  };
  // faixa fotográfica do grupo: 3 fotos que representam o conjunto + título sobreposto
  const faixa = (fotos: string[], titulo: string) =>
    `<div class="g-band">${fotos.map((f) => `<div class="ph" style="background-image:url('${f}')"></div>`).join("")}`
    + `<div class="g-over"><span class="g-tit">${titulo}</span></div></div>`;
  // secção de BUFFETS (menus por pessoa para eventos) — cartões com o conteúdo de cada pacote
  const secBuffets = buffets.length === 0 ? "" :
    faixa(["/fotos/buffet-mini.jpg", "/fotos/buffet-medio.jpg", "/fotos/buffet-max.jpg"], "MENUS DE BUFFET — POR PESSOA")
    + `<p class="m-nota">Buffet completo servido na nossa casa — preço por pessoa. O conteúdo de cada menu é ajustável ao gosto do cliente; reservas com adiantamento.</p>`
    + buffets.map((b) => {
        const secs = b.categorias?.length
          ? b.categorias.map((c) => `<b>${esc(c.nome)}:</b> ${esc(c.itens.join(", "))}`).join(" &nbsp;·&nbsp; ")
          : esc(b.itens.join(", "));
        return `<div class="bf"><div class="bf-head"><b>${esc(b.nome)}</b><span class="pontos"></span><span class="preco">${fmt(b.preco)} MZN /pessoa</span></div>`
          + `<div class="bf-cats">${secs}</div>`
          + (b.descricao?.trim() ? `<div class="bf-desc">${esc(b.descricao.trim())}</div>` : "")
          + `</div>`;
      }).join("");
  // grupos principais do menu — bebidas, refeições, BUFFETS, e serviços/lazer no fim
  const GRUPOS: Array<[string, string, string[]]> = [
    ["Bebida", "MENU DE BEBIDAS", ["/fotos/cerveja.jpg", "/fotos/sumos.jpg", "/fotos/vinho.jpg"]],
    ["Refeição", "MENU DE REFEIÇÕES", ["/fotos/aves-prato.jpg", "/fotos/carne-grelha.jpg", "/fotos/camarao.jpg"]],
    ["Serviço", "SERVIÇOS & LAZER", ["/fotos/menu-piscina.jpg", "/fotos/parque.jpg", "/fotos/menu-salao.jpg"]],
  ];
  const blocos = GRUPOS.map(([tipo, titulo, fotos]) => {
    const cats = new Map<string, MenuProduto[]>();
    for (const p of produtos) {
      if ((p.tipo ?? "Refeição") !== tipo) continue;
      const arr = cats.get(p.categoria) ?? [];
      arr.push(p);
      cats.set(p.categoria, arr);
    }
    if (cats.size === 0) return "";
    const inner = [...cats.entries()]
      .sort((a, b) => a[0].localeCompare(b[0], "pt"))
      .map(([cat, its]) => blocoCat(cat, its))
      .join("");
    // a secção de buffets entra logo após as refeições
    return faixa(fotos, titulo) + inner + (tipo === "Refeição" ? secBuffets : "");
  }).join("");
  // aluguer dos espaços SEM decoração (preços fixos, configuráveis em ⚙️ Configurações)
  const semDecoracao = `<h3>Aluguer de Espaços — sem decoração (preço fixo por evento)</h3>`
    + `<p class="m-nota">Apenas o uso do espaço — decoração e catering podem ser contratados à parte. «Todo o recinto» inclui todos os salões e áreas.</p>`
    + `<div class="cols"><div class="col">`
    + ESPACOS_EVENTO.slice(0, Math.ceil(ESPACOS_EVENTO.length / 2)).map((e) => linha(e, precoEspacoSemDecoracao(emp as unknown as Record<string, string>, e))).join("")
    + `</div><div class="col">`
    + ESPACOS_EVENTO.slice(Math.ceil(ESPACOS_EVENTO.length / 2)).map((e) => linha(e, precoEspacoSemDecoracao(emp as unknown as Record<string, string>, e))).join("")
    + `</div></div>`;
  return `
    <div class="m-hero">
      <img class="m-logo" src="/icons/logo.png" alt="" />
      <div class="m-nome">${esc(emp.nome)}</div>
      <div class="m-slogan">${esc(emp.slogan)}</div>
      <div class="m-menu">M E N U</div>
      <div class="m-nuit">NUIT: ${esc(emp.nuit)}</div>
      <div class="m-local">${esc(emp.local)} · Tel: ${esc(emp.tel1)} / ${esc(emp.tel2)}</div>
      <div class="m-tript">
        <div class="ph" style="background-image:url('/fotos/cerveja.jpg')"></div>
        <div class="ph" style="background-image:url('/fotos/aves-prato.jpg')"></div>
        <div class="ph" style="background-image:url('/fotos/menu-piscina.jpg')"></div>
      </div>
    </div>
    ${blocos}
    ${semDecoracao}
    <div class="m-rodape">${esc(emp.nome)} · ${esc(emp.slogan)} · NUIT ${esc(emp.nuit)}</div>`;
}

/** Imprime o menu completo em A4 num iframe oculto */
export function printMenu(html: string) {
  const ifr = document.createElement("iframe");
  ifr.style.position = "fixed";
  ifr.style.right = "0";
  ifr.style.bottom = "0";
  ifr.style.width = "0";
  ifr.style.height = "0";
  ifr.style.border = "0";
  document.body.appendChild(ifr);
  const win = ifr.contentWindow!;
  const doc = win.document;
  doc.open();
  doc.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Menu — Cami's Eventos</title>
    <style>
      @page { size: A4; margin: 9mm 11mm; }
      * { box-sizing: border-box; }
      body { margin: 0; padding: 0; }
      ${MENU_CSS}
    </style></head><body><div class="menu">${html}</div></body></html>`);
  doc.close();
  win.focus();
  const imgs = Array.from(doc.images);
  Promise.all(
    imgs.map((img) =>
      img.complete
        ? Promise.resolve()
        : new Promise<void>((res) => {
            img.onload = () => res();
            img.onerror = () => res();
          }),
    ),
  ).then(() => {
    setTimeout(() => {
      win.print();
      setTimeout(() => ifr.remove(), 2000);
    }, 150);
  });
}

/** Descarrega o menu completo em PDF A4 (com paginação automática) */
export async function downloadMenuPdf(html: string, filename: string) {
  await preloadLogo();
  const [{ default: JsPDF }, { default: html2canvas }] = await Promise.all([
    import("jspdf"),
    import("html2canvas"),
  ]);

  // A4: 210mm de largura; margens de 11mm de cada lado -> conteúdo 188mm ≈ 710px a 96dpi
  const wrap = document.createElement("div");
  wrap.style.position = "fixed";
  wrap.style.left = "-10000px";
  wrap.style.top = "0";
  wrap.style.width = "710px";
  wrap.style.background = "#ffffff";
  wrap.innerHTML = `<style>${MENU_CSS}</style><div class="menu">${html}</div>`;
  document.body.appendChild(wrap);

  try {
    const canvas = await html2canvas(wrap, { scale: 2, backgroundColor: "#ffffff" });
    const pageH = 297, margin = 9;
    const contentW = 210 - margin * 2;
    const pdf = new JsPDF({ unit: "mm", format: "a4" });

    // corta o canvas em páginas A4
    const pagePxH = Math.floor((canvas.width * (pageH - margin * 2)) / contentW);
    let y = 0, page = 0;
    while (y < canvas.height) {
      const h = Math.min(pagePxH, canvas.height - y);
      const fatia = document.createElement("canvas");
      fatia.width = canvas.width;
      fatia.height = h;
      fatia.getContext("2d")!.drawImage(canvas, 0, y, canvas.width, h, 0, 0, canvas.width, h);
      const fatiaHmm = (h * contentW) / canvas.width;
      if (page > 0) pdf.addPage();
      pdf.addImage(fatia.toDataURL("image/png"), "PNG", margin, margin, contentW, fatiaHmm);
      y += h;
      page++;
    }
    pdf.save(filename);
  } finally {
    wrap.remove();
  }
}

/** Gera o documento em PDF (largura de talão 80mm) e devolve o Blob */
export async function gerarPdfBlob(bodyHtml: string): Promise<Blob> {
  await preloadLogo();
  const [{ default: JsPDF }, { default: html2canvas }] = await Promise.all([
    import("jspdf"),
    import("html2canvas"),
  ]);

  // contentor oculto com a largura do talão (80mm ≈ 302px a 96dpi)
  const wrap = document.createElement("div");
  wrap.style.position = "fixed";
  wrap.style.left = "-10000px";
  wrap.style.top = "0";
  wrap.style.width = "302px";
  wrap.style.background = "#ffffff";
  wrap.innerHTML = `<style>${DOC_CSS}</style><div class="docp" style="padding:8px">${bodyHtml}</div>`;
  document.body.appendChild(wrap);

  try {
    const canvas = await html2canvas(wrap, { scale: 3, backgroundColor: "#ffffff" });
    const imgW = 76; // mm (80mm - margens de 2mm de cada lado)
    const imgH = (canvas.height * imgW) / canvas.width;
    const pdf = new JsPDF({ unit: "mm", format: [80, imgH + 6] });
    pdf.addImage(canvas.toDataURL("image/png"), "PNG", 2, 3, imgW, imgH);
    return pdf.output("blob");
  } finally {
    wrap.remove();
  }
}

/** Descarrega o documento em PDF (largura de talão 80mm) */
export async function downloadPdf(titulo: string, bodyHtml: string, filename: string) {
  const blob = await gerarPdfBlob(bodyHtml);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  void titulo;
}
