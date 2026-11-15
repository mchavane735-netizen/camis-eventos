export * from "./errors";

/* Constantes partilhadas frontend ↔ backend — CAMI'S EVENTOS */
/* Valores por defeito dos dados da empresa — o Admin pode alterá-los
   em Configurações (ficam guardados na tabela `config` da base de dados). */
export const EMPRESA = {
  nome: "CAMI'S EVENTOS",
  slogan: "Transformando Sonhos em Realidade",
  local: "Chimoio, Bairro Vila Nova, Chizombero, Moçambique",
  tel1: "87 458 9150",
  tel2: "86 059 8335",
  moeda: "MZN",
  nuit: "401259198",
  banco: "FNB",
  conta: "4169916510001",
  nib: "001400004169916510148",
  beneficiario: "Cami's Eventos e Serviços", // titular da conta FNB
  emola: "86 059 8335",
  titular: "Milagre Chavane", // titular do e-Mola
  emolaLev: "461770", // código de levantamento e-Mola
  emolaLevTitular: "Carla Chavane",
  iva: "16",
  taxaDelivery: "100",
  direcaoTels: "87 458 9150 / 84 849 9214",
  resumoWhats: "87 458 9150", // número que recebe o resumo diário (23:00) por WhatsApp
  taxaAgenteMpesaDep: "0.30", // % comissão de agente M-Pesa em depósitos
  taxaAgenteMpesaLev: "0.50", // % comissão de agente M-Pesa em levantamentos
  taxaAgenteEmolaDep: "0.30", // % comissão de agente eMola em depósitos
  taxaAgenteEmolaLev: "0.50", // % comissão de agente eMola em levantamentos
  metaAfiliadoMes: "80000", // MZN — meta mensal de vendas do afiliado (atingir = bónus de meta)
  bonusAfMeta: "1000", // MZN — bónus por atingir a meta mensal de vendas
  bonusAfMes: "1500", // MZN — prémio Afiliado do Mês (maior volume de comissões)
  bonusAfIndicacao: "300", // MZN — bónus por indicado cuja 1ª venda supera o mínimo
  minVendaIndicacao: "2000", // MZN — valor mínimo da 1ª venda do indicado para gerar o bónus
  precoEspacoRC: "35000", // MZN — aluguer SEM decoração: Salão Rés-do-chão
  precoEspacoAndar: "45000", // MZN — aluguer SEM decoração: Salão primeiro andar
  precoEspacoPiscina: "35000", // MZN — aluguer SEM decoração: Área da piscina
  precoEspacoJardim: "25000", // MZN — aluguer SEM decoração: Área do Jardim
  precoEspacoRecinto: "100000", // MZN — aluguer SEM decoração: Todo o recinto
} as const;

export type EmpresaCfg = {
  [K in keyof typeof EMPRESA]: string;
};

/** Chaves editáveis pelo Admin na página Configurações */
export const EMPRESA_CAMPOS: Array<{ chave: keyof EmpresaCfg; rotulo: string }> = [
  { chave: "nome", rotulo: "Nome da empresa" },
  { chave: "slogan", rotulo: "Slogan" },
  { chave: "local", rotulo: "Residência / Endereço" },
  { chave: "tel1", rotulo: "Telefone 1" },
  { chave: "tel2", rotulo: "Telefone 2" },
  { chave: "nuit", rotulo: "NUIT" },
  { chave: "banco", rotulo: "Banco" },
  { chave: "conta", rotulo: "Nº de Conta" },
  { chave: "nib", rotulo: "NIB" },
  { chave: "beneficiario", rotulo: "Titular da conta bancária" },
  { chave: "emola", rotulo: "Transferência eMola (número)" },
  { chave: "titular", rotulo: "Titular da Transferência eMola" },
  { chave: "emolaLev", rotulo: "Código de Levantamento eMola" },
  { chave: "emolaLevTitular", rotulo: "Titular do Levantamento eMola" },
  { chave: "iva", rotulo: "Taxa de IVA (%)" },
  { chave: "taxaDelivery", rotulo: "Taxa base de Delivery (MZN)" },
  { chave: "direcaoTels", rotulo: "Contactos da Direcção (nota de salão)" },
  { chave: "resumoWhats", rotulo: "WhatsApp do resumo diário (23:00)" },
  { chave: "taxaAgenteMpesaDep", rotulo: "Comissão agente M-Pesa — Depósito (%)" },
  { chave: "taxaAgenteMpesaLev", rotulo: "Comissão agente M-Pesa — Levantamento (%)" },
  { chave: "taxaAgenteEmolaDep", rotulo: "Comissão agente eMola — Depósito (%)" },
  { chave: "taxaAgenteEmolaLev", rotulo: "Comissão agente eMola — Levantamento (%)" },
  { chave: "metaAfiliadoMes", rotulo: "🤝 Meta mensal de vendas do afiliado (MZN)" },
  { chave: "bonusAfMeta", rotulo: "🤝 Bónus por atingir a meta mensal (MZN)" },
  { chave: "bonusAfMes", rotulo: "🤝 Prémio Afiliado do Mês (MZN)" },
  { chave: "bonusAfIndicacao", rotulo: "🤝 Bónus de indicação — 1ª venda do indicado (MZN)" },
  { chave: "minVendaIndicacao", rotulo: "🤝 1ª venda mínima do indicado para o bónus (MZN)" },
  { chave: "precoEspacoRC", rotulo: "🏛 Aluguer SEM decoração — Salão Rés-do-chão (MZN)" },
  { chave: "precoEspacoAndar", rotulo: "🏛 Aluguer SEM decoração — Salão primeiro andar (MZN)" },
  { chave: "precoEspacoPiscina", rotulo: "🏛 Aluguer SEM decoração — Área da piscina (MZN)" },
  { chave: "precoEspacoJardim", rotulo: "🏛 Aluguer SEM decoração — Área do Jardim (MZN)" },
  { chave: "precoEspacoRecinto", rotulo: "🏛 Aluguer SEM decoração — Todo o recinto (MZN)" },
];

export const IVA_MODOS = [
  { id: "incluido", rotulo: "IVA incluído nos preços" },
  { id: "adicional", rotulo: "IVA adicionado ao subtotal" },
  { id: "isento", rotulo: "Isento / sem IVA" },
] as const;
export type IvaModo = (typeof IVA_MODOS)[number]["id"];

export const METODOS_PAGAMENTO = [
  "Dinheiro",
  "M-Pesa", // legado: equivale a «Levantamento M-Pesa»
  "Transferência M-Pesa",
  "Levantamento M-Pesa",
  "Transferência eMola",
  "Levantamento eMola",
  "FNB",
  "Cartão",
  "Crédito",
] as const;

/** Formas de entregar o troco ao cliente (uma ou mais em simultâneo) —
    permite controlar a circulação do dinheiro físico vs. contas móveis/banco */
export const FORMAS_TROCO = [
  "Dinheiro",
  "Trans. eMola",
  "Trans. Mpesa",
  "Depósito eMola",
  "Depósito Mpesa",
  "Trans. Bancária",
] as const;
export type FormaTroco = (typeof FORMAS_TROCO)[number];
export type TrocoParte = { forma: string; valor: number };

/** Sistemas de carteira móvel em que a CAMI'S é agente (gera comissões) */
export const AGENTE_SISTEMAS = ["eMola", "Mpesa"] as const;
export const AGENTE_TIPOS = ["Levantamento", "Deposito"] as const;

/** Métodos que o cliente pode escolher na loja online */
export const METODOS_ONLINE = ["Transferência eMola", "Levantamento eMola", "FNB", "Dinheiro"] as const;
export type MetodoOnline = (typeof METODOS_ONLINE)[number];

/** Horário de funcionamento — o valor por defeito pode ser editado pelo Admin
    (guardado na tabela `config`, chave "horarios", em JSON). */
export type HorarioDia = { dia: string; abre: string; fecha: string; aberto: boolean };
export const HORARIOS_PADRAO: HorarioDia[] = [
  { dia: "Segunda-feira", abre: "08:00", fecha: "18:00", aberto: false },
  { dia: "Terça-feira", abre: "08:00", fecha: "18:00", aberto: true },
  { dia: "Quarta-feira", abre: "08:00", fecha: "18:00", aberto: true },
  { dia: "Quinta-feira", abre: "08:00", fecha: "18:00", aberto: true },
  { dia: "Sexta-feira", abre: "08:00", fecha: "21:00", aberto: true },
  { dia: "Sábado", abre: "08:00", fecha: "21:00", aberto: true },
  { dia: "Domingo", abre: "08:00", fecha: "21:00", aberto: true },
];

/** Bairros do município de Chimoio (dropdown de delivery — editável pelo Admin,
    guardado na tabela `config`, chave "bairros", em JSON) */
export const BAIRROS_CHIMOIO: string[] = [
  "1º de Maio", "16 de Junho", "25 de Junho", "7 de Abril", "7 de Setembro",
  "Agostinho Neto", "Bairro 1", "Bairro 2", "Bairro 3", "Bairro 4", "Bairro 5",
  "Bloco 9", "Centro Hípico", "Chianga", "Chinfura", "Chissui", "Chissungana",
  "Chizombero", "Feira", "Francisco Manyanga", "Heróis Moçambicanos", "Hómbua",
  "Mudzingazi", "Nhamaonha", "Nhamatsane", "Nhamadjessa", "Nhauriri", "Piloto",
  "Soalpo", "Sitania", "Tambara 1", "Tambara 2", "Témbwe", "Textáfrica",
  "Trangapasso", "Vila Nova", "Outro",
];

/** Centro aproximado da cidade de Chimoio (mapa de entregas) */
export const CHIMOIO_CENTRO: [number, number] = [-19.1164, 33.4834];

/** Tipos de referência do Novo Pedido (POS) — ex.: "Mesa 5", "Família Nhaca" */
export const REF_TIPOS = ["Mesa", "Família", "Grupo"] as const; // «Balcão» foi substituído pela ⚡ Venda Rápida

/** Espaços do restaurante onde o cliente pode estar sentado (alterável durante a estadia) */
export const AREAS_ESTAR = [
  "Área da Piscina",
  "Salão primeiro andar",
  "Salão Rés-do-chão",
  "Jardim",
  "Parque Infantil",
  "Corredor das máquinas",
] as const;

/** Espaços de evento que podem ser ALUGADOS numa reserva de salão (bloqueio por espaço/data).
   «Todo o recinto» inclui todos os salões e áreas. Preços SEM decoração configuráveis
   pelo Admin (EMPRESA.precoEspaco*); com decoração usa-se o pacote de salão escolhido. */
export const ESPACOS_EVENTO = [
  "Salão Rés-do-chão",
  "Salão primeiro andar",
  "Área da piscina",
  "Área do Jardim",
  "Todo o recinto",
] as const;
export type EspacoEvento = (typeof ESPACOS_EVENTO)[number];

/** Espaços cujo aluguer conta como «aluguer do salão» (comissão de afiliado 5%) */
export const ESPACOS_COMISSAO_ALTA: readonly string[] = ["Salão Rés-do-chão", "Salão primeiro andar", "Todo o recinto"];

/** Preço base (sem decoração) de cada espaço, lido da configuração da empresa */
export function precoEspacoSemDecoracao(emp: Record<string, string>, espaco: string): number {
  const mapa: Record<string, string> = {
    "Salão Rés-do-chão": "precoEspacoRC",
    "Salão primeiro andar": "precoEspacoAndar",
    "Área da piscina": "precoEspacoPiscina",
    "Área do Jardim": "precoEspacoJardim",
    "Todo o recinto": "precoEspacoRecinto",
  };
  const chave = mapa[espaco];
  return chave ? (parseFloat(emp[chave]) || 0) : 0;
}

/** Dois espaços entram em conflito na mesma data? (Todo o recinto choca com tudo) */
export function espacosEmConflito(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return true; // reservas antigas sem espaço: por segurança, bloqueiam tudo
  return a === "Todo o recinto" || b === "Todo o recinto" || a === b;
}

/** Perfis de utilizador do sistema */
export const PERFIS = ["Admin", "Gestor", "Vendedor", "Cozinha", "Logistica", "Entregador", "RH", "Eventos"] as const;
export type Perfil = (typeof PERFIS)[number];

/** Rótulos amigáveis dos perfis (selects de utilizadores) */
export const PERFIL_ROTULO: Record<Perfil, string> = {
  Admin: "Admin",
  Gestor: "Gestor",
  Vendedor: "Vendedor",
  Cozinha: "Cozinha (👨‍🍳 só pedidos)",
  Logistica: "Logística (📦 despesas/compras)",
  Entregador: "Entregador (🛵 só entregas)",
  RH: "Gestor de RH (👥 RH · vagas · afiliados)",
  Eventos: "Gestor de Eventos (🎟 só eventos/bilhetes)",
};

/** Categorias de despesas diárias (lançadas pela Logística / Gestão) */
export const CATS_DESPESA = [
  "Compras — Cozinha",
  "Compras — Bar",
  "Compras — Piscina",
  "Compras — Área de Serviços",
  "Compras — Parque Infantil",
  "Compras — Decoração",
  "Transporte",
  "Energia Eléctrica",
  "Água",
  "Salários & Pessoal",
  "Manutenção & Reparações",
  "Comunicações (Net/Telefone)",
  "Renda & Arrendamento",
  "Seguros & Licenças",
  "Afiliados — Comissões",
  "Outros",
] as const;

/** Regra da senha forte da equipa: mín. 6 caracteres com maiúscula, minúscula, número e símbolo */
export const SENHA_RE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{6,}$/;
export const SENHA_REGRA = "Mínimo 6 caracteres, com letra maiúscula, minúscula, número e símbolo (ex.: Camis@2026)";

export const TIPOS_RESERVA = [
  "Salão + Comida",
  "Só Salão",
  "Só Comida",
  "Piscina/Parque",
  "Outro",
] as const;

/** Opções combináveis de reserva (multi-selecção — ex.: "Salão + Comida + Piscina") */
export const OPCOES_RESERVA = ["Salão", "Comida", "Piscina", "Parque", "Outro"] as const;

/** Tipos de evento para reservas do salão */
export const TIPOS_EVENTO_RESERVA = [
  "Casamento",
  "Aniversário",
  "Data Comemorativa",
  "Feriado",
  "Comemoração Especial",
  "Comemoração da Igreja",
  "Outro",
] as const;

/** Taxa de reserva por pessoa/participante (MZN).
    Regra da Direcção (Out/2026): Salão primeiro andar = 500 MZN/pessoa;
    todos os outros espaços para sentar = 400 MZN/pessoa. */
export const TAXA_RESERVA_PESSOA = 400;
export const TAXA_RESERVA_PESSOA_SALAO1 = 500;
export const taxaReservaPessoa = (area?: string | null) =>
  area === "Salão primeiro andar" ? TAXA_RESERVA_PESSOA_SALAO1 : TAXA_RESERVA_PESSOA;

/* ---------- BRAAI — cliente traz os seus produtos (taxa NÃO consumível) ----------
   Regras de negócio (definidas pela Direcção em 01/10/2026):
   · Modalidade A — o cliente traz comida E bebidas (não compra nada na casa):
       500 MZN/pessoa até 9 pessoas · 400 MZN/pessoa a partir de 10 pessoas
   · Modalidade B — o cliente traz SÓ comida OU SÓ bebidas (o resto compra na casa):
       300 MZN/pessoa até 9 pessoas · 250 MZN/pessoa a partir de 10 pessoas
   · A taxa NÃO é consumível: compensa o espaço, as mesas, as cadeiras e a água
     usados, e os produtos que a casa deixa de vender.
   · A taxa NÃO inclui utensílios de cozinha, ingredientes nem carvão da CAMI'S.
     O cliente pode trazer o seu próprio fogão/grelhador e utensílios.
   · A assadura da carne é SEMPRE fora, num espaço indicado pela equipa,
     independentemente da área de estar escolhida.
   · Bebidas trazidas: máximo 3 por pessoa e apenas bebidas que a casa não vende
     ou não tem em stock.
   · Crianças até 9 anos NÃO pagam taxa de braai (pagam a partir dos 10 anos).
   · A taxa dá direito a 5 horas de uso do espaço — a hora de entrada é marcada.
   · Piscina e parque infantil NÃO estão incluídos — pagam-se à parte.
   · Pagamento: online 100% antecipado; no restaurante mínimo 50% de
     adiantamento e o saldo NA ENTRADA, antes de ocupar o espaço. */
export const BRAAI_DURACAO_HORAS = 5;
export const BRAAI_IDADE_MIN_PAGANTE = 10; // crianças pagam a partir dos 10 anos

export const BRAAI_MODALIDADES = [
  { id: "A", rotulo: "Braai Completo", traz: "Comida e bebidas", desc: "O cliente traz tudo — não compra comida nem bebida na casa" },
  { id: "B", rotulo: "Braai Parcial", traz: "Só comida OU só bebidas", desc: "O cliente traz uma das duas coisas — o resto compra na casa" },
] as const;
export type BraaiModalidade = (typeof BRAAI_MODALIDADES)[number]["id"];

/** Na modalidade B, o que o cliente traz (o resto compra na casa) */
export const BRAAI_TRAZ_OPCOES = ["Comida", "Bebidas"] as const;
export type BraaiTraz = (typeof BRAAI_TRAZ_OPCOES)[number];

/** Taxa de braai POR PESSOA pagante (10+ anos), conforme a modalidade e o grupo */
export function braaiTaxaPessoa(modalidade: BraaiModalidade, pessoasPagantes: number): number {
  const grupo10 = pessoasPagantes >= 10;
  return modalidade === "A" ? (grupo10 ? 400 : 500) : (grupo10 ? 250 : 300);
}

/** Valor total da taxa de braai (NÃO consumível) */
export function braaiTotal(modalidade: BraaiModalidade, pessoasPagantes: number): number {
  return Math.round(pessoasPagantes * braaiTaxaPessoa(modalidade, pessoasPagantes) * 100) / 100;
}

/** Descrição curta da modalidade (para recibos, listas e notificações) */
export function braaiRotulo(modalidade: BraaiModalidade, traz?: BraaiTraz | null): string {
  return modalidade === "A"
    ? "Braai Completo (traz comida e bebidas)"
    : `Braai Parcial (traz só ${traz === "Comida" ? "comida" : "bebidas"})`;
}

/** Regras do braai — texto oficial para o cliente (loja online, página de regras e recibos) */
export const BRAAI_REGRAS: string[] = [
  "A taxa de braai cobre o uso do espaço, das mesas, das cadeiras e da água da CAMI'S EVENTOS. NÃO é descontada em consumos (taxa não consumível).",
  "A taxa NÃO inclui utensílios de cozinha, ingredientes nem carvão — o cliente traz os seus. É permitido trazer o próprio fogão/grelhador e utensílios.",
  "A assadura da carne é feita sempre fora, num espaço indicado pela equipa da CAMI'S EVENTOS, independentemente da área de estar escolhida.",
  "Bebidas trazidas de fora: máximo 3 por pessoa e apenas bebidas que a CAMI'S EVENTOS não vende ou não tem em stock.",
  "Whisky ou vinho: apenas 1 garrafa por cada 10 pessoas.",
  "Braai Completo (traz comida e bebidas): 500 MZN por pessoa até 9 pessoas; 400 MZN por pessoa a partir de 10 pessoas.",
  "Braai Parcial (traz só comida OU só bebidas — o resto compra na casa): 300 MZN por pessoa até 9 pessoas; 250 MZN por pessoa a partir de 10 pessoas.",
  "Crianças até 9 anos não pagam taxa de braai. A partir dos 10 anos pagam como adulto.",
  `A taxa dá direito a ${BRAAI_DURACAO_HORAS} horas de uso do espaço, contadas a partir da hora de entrada marcada na reserva.`,
  "A taxa NÃO inclui piscina nem parque infantil — estes são pagos à parte.",
  "Reservas online: pagamento integral (100%) antecipado. Reservas no restaurante: adiantamento mínimo de 50% e o saldo é pago NA ENTRADA, antes de ocupar o espaço.",
  "Na entrada, a equipa confirma o que foi efectivamente trazido. Se o cliente declarou «Braai Parcial» mas trouxe comida e bebidas, aplica-se a taxa do Braai Completo.",
];

/** Tipos de pedido online (loja do cliente) */
export const TIPOS_PEDIDO_ONLINE = [
  { id: "Local", rotulo: "Consumo no Local", icon: "🍽️", desc: "Peça da sua mesa via QR code — comida caseira, sem filas" },
  { id: "Delivery", rotulo: "Delivery", icon: "🛵", desc: "A CAMI'S vai até si — receba quentinho em casa" },
  { id: "TakeAway", rotulo: "Take Away", icon: "🛍️", desc: "Encomende já e levante sem espera" },
  { id: "Reserva", rotulo: "Reserva", icon: "📅", desc: "Garanta o seu dia especial — 50% de adiantamento" },
] as const;
export type TipoPedidoOnline = "Local" | "Delivery" | "TakeAway" | "Reserva";

/** Estados possíveis de um pedido online */
export const ESTADOS_ONLINE = [
  "Pendente", "Comprovativo Enviado", "Confirmado", "Em Preparo",
  "Pronto", "Em Entrega", "Entregue", "Concluído", "Cancelado",
] as const;
export type EstadoOnline = (typeof ESTADOS_ONLINE)[number];

/** Notas e moedas de MZN para cálculo de troco */
export const DENOMS_MZN = [1000, 500, 200, 100, 50, 20, 10, 5, 2, 1, 0.5] as const;

/* ---------- Acompanhamentos de pratos (restaurante + loja online) ---------- */
/** Peixe/Mariscos: base 1; Aves/Carne: base 2. Ambos têm dropdown de molho/legumes. */
export const ACOMP_BASE_PEIXE = ["Chima", "Arroz", "Batata frita", "Batata cozida"] as const;
export const ACOMP_BASE_CARNE = ["Chima", "Arroz e batata frita", "Batata cozida"] as const;
export const ACOMP_MOLHO = ["Molho de tomate", "Couve salteada", "Salada (repolho/alface)"] as const;
export const CATS_ACOMP_PEIXE = ["Peixe", "Mariscos"];
export const CATS_ACOMP_CARNE = ["Aves", "Carne"];

/** Devolve a lista de bases para a categoria (null = prato sem acompanhamentos) */
export function acompBasePara(categoria: string): readonly string[] | null {
  if (CATS_ACOMP_PEIXE.includes(categoria)) return ACOMP_BASE_PEIXE;
  if (CATS_ACOMP_CARNE.includes(categoria)) return ACOMP_BASE_CARNE;
  return null;
}

/* ---------- Programa de Afiliados (CRM) ---------- */
/** Regras de comissão e bónus — partilhadas entre API e frontend */
export const AF_COMISSAO_ALTA = 5;    // % — aluguer do salão (eventos com pacote)
export const AF_COMISSAO_BASE = 3;    // % — refeições, bebidas, piscina, parque infantil e restantes
export const AF_LIMITE_ACTIVOS = 20;  // vagas de afiliados activos (1ª fase)
export const AF_BONUS_META = 1000;    // MZN — afiliado que alcança a meta mensal de vendas
export const AF_BONUS_MES = 1500;     // MZN — Afiliado do Mês (maior volume)
export const AF_BONUS_INDICACAO = 300; // MZN — indicado faz a 1ª venda ACIMA de 2.000 MZN (só na 1ª)
export const AF_INDICACAO_MIN = 2000; // MZN — valor mínimo da 1ª venda do indicado p/ o bónus
export const AF_DIA_PAGAMENTO = 5;    // dia do mês seguinte em que as comissões são pagas
export const AF_PROTECAO_DIAS = 90;   // protecção renovável do cliente registado

/** Desconto automático de TODOS os clientes na loja online (%) */
export const LOJA_DESCONTO_PCT = 3;

export const AF_NIVEIS = ["Bronze", "Prata", "Ouro"] as const;
export type AfNivel = (typeof AF_NIVEIS)[number];

export const AF_STATUS = ["Pendente", "Experimental", "Activo", "ListaEspera", "Suspenso", "Rejeitado"] as const;
export type AfStatus = (typeof AF_STATUS)[number];

export const AF_LEAD_ESTADOS = ["Novo", "Negociacao", "Convertido", "Perdido"] as const;
export type AfLeadEstado = (typeof AF_LEAD_ESTADOS)[number];

export const AF_INTERESSES = ["Salão de eventos", "Decoração", "Piscina/Parque", "Restaurante/Catering", "Evento completo", "Outro"] as const;

/** Nível por número de vendas concluídas */
export function afNivelPorVendas(vendas: number): AfNivel {
  if (vendas >= 15) return "Ouro";
  if (vendas >= 5) return "Prata";
  return "Bronze";
}
