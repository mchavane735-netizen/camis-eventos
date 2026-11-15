import {
  mysqlTable,
  mysqlEnum,
  serial,
  bigint,
  varchar,
  text,
  mediumtext,
  int,
  double,
  boolean,
  timestamp,
  index,
  json,
} from "drizzle-orm/mysql-core";

/* ---------- Utilizadores ---------- */
export const usuarios = mysqlTable("usuarios", {
  id: serial("id").primaryKey(),
  nome: varchar("nome", { length: 120 }).notNull(),
  perfil: mysqlEnum("perfil", ["Admin", "Gestor", "Vendedor", "Cozinha", "Logistica", "Entregador", "RH", "Eventos"]).notNull().default("Vendedor"),
  pin: varchar("pin", { length: 60 }).notNull(),
  telefone: varchar("telefone", { length: 30 }), // contacto (entregadores: usado nas entregas)
  tentativas: int("tentativas").notNull().default(0), // falhas de login seguidas
  bloqueado: boolean("bloqueado").notNull().default(false), // bloqueado após 3 falhas (só o Admin desbloqueia)
  // Controlo de acesso dos vendedores (v17): fora do horário de funcionamento o vendedor
  // fica bloqueado; o Gerente/Admin pode desbloquear até uma hora (desbloqueadoAte)
  // ou bloquear manualmente no fecho da loja (bloqueioManual).
  desbloqueadoAte: timestamp("desbloqueado_ate"),
  bloqueioManual: boolean("bloqueio_manual").notNull().default(false),
  podeReabrirReserva: boolean("pode_reabrir_reserva").notNull().default(false), // Admin concede ao Gerente: reabrir reserva concluída por engano
  podeEditarStock: boolean("pode_editar_stock").notNull().default(false), // Admin concede ao Gerente: entradas/ajustes de stock
  podeEditarNomes: boolean("pode_editar_nomes").notNull().default(false), // Admin concede: corrigir nomes (mesa/atendente, evento, titular do bilhete)
  ultimoPing: timestamp("ultimo_ping"), // presença do entregador (heartbeat)
  ativo: boolean("ativo").notNull().default(true),
  criadoEm: timestamp("criado_em").notNull().defaultNow(),
});
export type Usuario = typeof usuarios.$inferSelect;

/* ---------- Sessões persistentes (cookie de servidor) ----------
   Guardam o login por 7 dias mesmo em aparelhos com armazenamento local
   bloqueado (modo privado, WebViews) — o cookie é lido automaticamente. */
export const sessoes = mysqlTable("sessoes", {
  token: varchar("token", { length: 64 }).primaryKey(),
  usuarioId: bigint("usuario_id", { mode: "number", unsigned: true }).notNull(),
  expiraEm: timestamp("expira_em").notNull(),
  criadoEm: timestamp("criado_em").notNull().defaultNow(),
});

/* ---------- Produtos ---------- */
export const produtos = mysqlTable(
  "produtos",
  {
    id: serial("id").primaryKey(),
    codigo: varchar("codigo", { length: 20 }).notNull().unique(),
    nome: varchar("nome", { length: 255 }).notNull(),
    categoria: varchar("categoria", { length: 80 }).notNull(),
    tipo: mysqlEnum("tipo", ["Bebida", "Refeição", "Serviço"]).notNull().default("Bebida"),
    preco: double("preco").notNull().default(0),
    precoCompra: double("preco_compra").notNull().default(0), // custo de compra — base do CMV/EBITDA
    foto: mediumtext("foto"), // data URL (base64) — foto do produto para a loja online
    ingredientes: varchar("ingredientes", { length: 500 }), // ingredientes/acompanhantes do prato (ex.: Pizza) — aparece no menu impresso e na loja online
    estoqueMin: int("estoque_min").notNull().default(0),
    estoqueAtual: double("estoque_atual").notNull().default(0), // double: stock fraccionário (ex.: 9.75 frangos)
    // stock partilhado por fracções: produtos como "1/4 Frango" apontam para o produto "mãe"
    // (ex.: Frango Inteiro) e descontam apenas a sua fracção (0.25 / 0.5 / 1)
    estoqueRefId: int("estoque_ref_id"), // id do produto que detém o stock (null = o próprio)
    fraccao: double("fraccao").notNull().default(1), // fracção da unidade de stock que cada venda desconta
    qtdDecimal: boolean("qtd_decimal").notNull().default(false), // venda por peso (kg) — quantidade com decimais
    ativo: boolean("ativo").notNull().default(true),
    criadoEm: timestamp("criado_em").notNull().defaultNow(),
  },
  (t) => ({ catIdx: index("cat_idx").on(t.categoria) }),
);
export type Produto = typeof produtos.$inferSelect;

/* ---------- Pedidos (comandas com nº sequencial diário) ---------- */
export const pedidos = mysqlTable(
  "pedidos",
  {
    id: serial("id").primaryKey(),
    numero: int("numero").notNull(), // nº sequencial do dia (1, 2, 3…)
    dataDia: varchar("data_dia", { length: 10 }).notNull(), // YYYY-MM-DD
    referencia: varchar("referencia", { length: 120 }), // mesa / nome do cliente (opcional)
    status: mysqlEnum("status", ["Aberto", "Fechado", "Anulado"]).notNull().default("Aberto"),
    desconto: double("desconto").notNull().default(0), // %
    subtotal: double("subtotal").notNull().default(0),
    total: double("total").notNull().default(0),
    metodo: varchar("metodo", { length: 160 }),
    recebido: double("recebido"),
    troco: double("troco"),
    trocoDetalhe: text("troco_detalhe"), // JSON [{forma, valor}] — como o troco foi entregue (Dinheiro, eMola, Mpesa…)
    reservaId: bigint("reserva_id", { mode: "number", unsigned: true }),
    afiliadoId: bigint("afiliado_id", { mode: "number", unsigned: true }), // afiliado que trouxe o cliente (null = venda directa)
    adiantDeduzido: double("adiant_deduzido").notNull().default(0), // adiantamento da reserva deduzido no fecho
    area: varchar("area", { length: 80 }), // onde o cliente está sentado (alterável durante a estadia)
    atendente: varchar("atendente", { length: 120 }), // funcionário que atende a mesa/pedido
    reaberturaPor: varchar("reabertura_por", { length: 160 }), // quem pediu para alterar o pedido fechado (gerente/caixa)
    reaberturaMotivo: varchar("reabertura_motivo", { length: 255 }), // motivo do pedido de alteração
    cozinhaStatus: varchar("cozinha_status", { length: 20 }), // Pendente → Em Preparo → Pronto (null = sem itens de cozinha)
    usuarioId: bigint("usuario_id", { mode: "number", unsigned: true }).notNull(),
    criadoEm: timestamp("criado_em").notNull().defaultNow(),
    fechadoEm: timestamp("fechado_em"),
    fechadoPor: varchar("fechado_por", { length: 120 }), // funcionário que fechou a conta (auditoria)
    dividaGerada: double("divida_gerada").notNull().default(0), // valor ficado a dever no fecho (fiado)
  },
  (t) => ({ diaIdx: index("dia_idx").on(t.dataDia, t.status) }),
);
export type Pedido = typeof pedidos.$inferSelect;

export const pedidoItens = mysqlTable(
  "pedido_itens",
  {
    id: serial("id").primaryKey(),
    pedidoId: bigint("pedido_id", { mode: "number", unsigned: true }).notNull(),
    produtoId: bigint("produto_id", { mode: "number", unsigned: true }), // null = item personalizado (fora do menu)
    nome: varchar("nome", { length: 255 }).notNull(), // snapshot
    categoria: varchar("categoria", { length: 80 }).notNull(),
    precoUnit: double("preco_unit").notNull(),
    qtd: double("qtd").notNull().default(1), // double: permite venda por peso (ex.: 0.5 kg)
    obs: varchar("obs", { length: 255 }), // acompanhamentos escolhidos (pratos)
  },
  (t) => ({ pedIdx: index("ped_idx").on(t.pedidoId) }),
);
export type PedidoItem = typeof pedidoItens.$inferSelect;

/* Histórico de lançamentos de itens («caderno» digital): cada toque no +/−,
   cada produto adicionado e cada item fora do menu fica registado com hora e autor.
   A conta continua aglutinada por produto; isto é só o rasto de auditoria. */
export const pedidoItensLog = mysqlTable(
  "pedido_itens_log",
  {
    id: serial("id").primaryKey(),
    pedidoId: bigint("pedido_id", { mode: "number", unsigned: true }).notNull(),
    produtoId: bigint("produto_id", { mode: "number", unsigned: true }),
    nome: varchar("nome", { length: 255 }).notNull(),
    delta: double("delta").notNull(), // +1, +2, -0.25...
    qtdFinal: double("qtd_final").notNull(), // quantidade da linha após o movimento (0 = linha removida)
    origem: varchar("origem", { length: 20 }).notNull().default("ajuste"), // menu | ajuste | adicional
    usuarioNome: varchar("usuario_nome", { length: 120 }),
    criadoEm: timestamp("criado_em").notNull().defaultNow(),
  },
  (t) => ({ pedLogIdx: index("ped_log_idx").on(t.pedidoId) }),
);
export type PedidoItemLog = typeof pedidoItensLog.$inferSelect;

/* ---------- Reservas ---------- */
export const reservas = mysqlTable("reservas", {
  id: serial("id").primaryKey(),
  codigo: varchar("codigo", { length: 12 }).notNull().unique(),
  cliente: varchar("cliente", { length: 160 }).notNull(),
  contacto: varchar("contacto", { length: 60 }),
  dataReserva: varchar("data_reserva", { length: 10 }).notNull(),
  dataConsumo: varchar("data_consumo", { length: 10 }).notNull(),
  hora: varchar("hora", { length: 5 }),
  area: varchar("area", { length: 80 }), // onde o cliente pretende sentar (obrigatório nas novas reservas)
  espaco: varchar("espaco", { length: 40 }), // espaço de evento alugado (ESPACOS_EVENTO) — bloqueio por espaço/data
  tipo: varchar("tipo", { length: 60 }).notNull(),
  tipoOutro: varchar("tipo_outro", { length: 160 }),
  pessoas: int("pessoas").notNull().default(0),
  servicos: text("servicos"),
  pacoteNome: varchar("pacote_nome", { length: 160 }),
  valor: double("valor").notNull().default(0),
  desconto: double("desconto").notNull().default(0), // desconto combinado (MZN) — já deduzido no valor
  adiantPct: double("adiant_pct").notNull().default(20),
  adiant: double("adiant").notNull().default(0),
  saldo: double("saldo").notNull().default(0),
  status: mysqlEnum("status", ["Pendente", "Confirmada", "Concluída", "Cancelada"]).notNull().default("Pendente"),
  condicoes: text("condicoes"),
  pedidoId: bigint("pedido_id", { mode: "number", unsigned: true }),
  afiliadoId: bigint("afiliado_id", { mode: "number", unsigned: true }), // afiliado que trouxe o cliente
  /* --- BRAAI (cliente traz os seus produtos — taxa não consumível) --- */
  braai: boolean("braai").notNull().default(false), // reserva de braai
  braaiModalidade: varchar("braai_modalidade", { length: 1 }), // "A" traz tudo · "B" traz comida OU bebidas
  braaiTraz: varchar("braai_traz", { length: 20 }), // modalidade B: "Comida" | "Bebidas"
  criancasMenores: int("criancas_menores").notNull().default(0), // crianças até 9 anos (não pagam)
  checkinEm: timestamp("checkin_em"), // entrada confirmada no dia (antes de ocupar o espaço)
  checkinPor: varchar("checkin_por", { length: 120 }), // funcionário que fez o check-in
  checkinObs: varchar("checkin_obs", { length: 255 }), // o que o cliente trouxe de facto
  saldoPago: boolean("saldo_pago").notNull().default(false), // saldo pago na entrada
  onlineId: bigint("online_id", { mode: "number", unsigned: true }), // pedido online de origem (Reserva Buffet)
  usuarioId: bigint("usuario_id", { mode: "number", unsigned: true }).notNull(),
  criadoEm: timestamp("criado_em").notNull().defaultNow(),
});
export type Reserva = typeof reservas.$inferSelect;

/* ---------- Eventos & Bilheteira ----------
   Cada pessoa que paga a entrada fica registada (nome + contacto).
   A receita entra no Financeiro via pagamentos («Bilhete EV-…»). */
export const eventos = mysqlTable("eventos", {
  id: serial("id").primaryKey(),
  codigo: varchar("codigo", { length: 12 }).notNull().unique(), // EV-0001
  nome: varchar("nome", { length: 160 }).notNull(),
  descricao: text("descricao"),
  dataEvento: varchar("data_evento", { length: 10 }).notNull(), // YYYY-MM-DD
  horaInicio: varchar("hora_inicio", { length: 5 }),
  horaFim: varchar("hora_fim", { length: 5 }),
  local: varchar("local", { length: 160 }),
  precoNormal: double("preco_normal").notNull().default(0), // 0 = entrada livre
  precoVip: double("preco_vip").notNull().default(0), // 0 = sem bilhete VIP
  incluiNormal: text("inclui_normal"), // o que o bilhete NORMAL inclui (ex.: entrada + 1 bebida)
  incluiVip: text("inclui_vip"), // o que o bilhete VIP inclui
  capacidade: int("capacidade"), // null = sem limite
  maxPrestacoes: int("max_prestacoes").notNull().default(1), // 1 = só à vista; 2+ = permite pagar em N prestações (última até ao dia do evento)
  status: mysqlEnum("status", ["Rascunho", "Aberto", "Esgotado", "Encerrado", "Concluído", "Cancelado"]).notNull().default("Rascunho"),
  criadoPor: bigint("criado_por", { mode: "number", unsigned: true }),
  criadoEm: timestamp("criado_em").notNull().defaultNow(),
});
export type Evento = typeof eventos.$inferSelect;

export const eventoBilhetes = mysqlTable("evento_bilhetes", {
  id: serial("id").primaryKey(),
  codigo: varchar("codigo", { length: 12 }).notNull().unique(), // BL-0001
  eventoId: bigint("evento_id", { mode: "number", unsigned: true }).notNull(),
  nomePessoa: varchar("nome_pessoa", { length: 160 }).notNull(), // quem paga/entra
  telefone: varchar("telefone", { length: 40 }),
  tipo: mysqlEnum("tipo", ["Normal", "VIP"]).notNull().default("Normal"),
  valor: double("valor").notNull().default(0),
  metodo: varchar("metodo", { length: 160 }),
  vendedorId: bigint("vendedor_id", { mode: "number", unsigned: true }).notNull(),
  valorPago: double("valor_pago").notNull().default(0), // quanto já foi pago (valorPago < valor = em prestações — NÃO entra à porta)
  nPrestacoes: int("n_prestacoes").notNull().default(1), // nº de prestações combinado na venda (1 = à vista)
  status: mysqlEnum("status", ["Pago", "Anulado"]).notNull().default("Pago"),
  dataDia: varchar("data_dia", { length: 10 }).notNull(), // YYYY-MM-DD da venda (MZ)
  criadoEm: timestamp("criado_em").notNull().defaultNow(),
  anuladoEm: timestamp("anulado_em"),
  anuladoPor: varchar("anulado_por", { length: 120 }),
  usadoEm: timestamp("usado_em"), // entrada registada à porta (scanner) — impede reutilização
  usadoPor: varchar("usado_por", { length: 120 }),
}, (t) => ({ evIdx: index("bilhete_ev_idx").on(t.eventoId, t.status) }));
export type EventoBilhete = typeof eventoBilhetes.$inferSelect;

/* ---------- Piscina & Parque ---------- */
export const piscina = mysqlTable("piscina", {
  id: serial("id").primaryKey(),
  codigo: varchar("codigo", { length: 12 }).notNull().unique(),
  adultos: int("adultos").notNull().default(0),
  criancas: int("criancas").notNull().default(0),
  brinquedos: int("brinquedos").notNull().default(0),
  desconto: double("desconto").notNull().default(0),
  total: double("total").notNull().default(0),
  metodo: varchar("metodo", { length: 160 }).notNull(),
  obs: varchar("obs", { length: 255 }),
  usuarioId: bigint("usuario_id", { mode: "number", unsigned: true }).notNull(),
  criadoEm: timestamp("criado_em").notNull().defaultNow(),
});
export type Piscina = typeof piscina.$inferSelect;

/* ---------- Pagamentos ---------- */
export const pagamentos = mysqlTable("pagamentos", {
  id: serial("id").primaryKey(),
  codigo: varchar("codigo", { length: 12 }).notNull().unique(),
  tipoVenda: varchar("tipo_venda", { length: 80 }).notNull(),
  cliente: varchar("cliente", { length: 160 }),
  valor: double("valor").notNull().default(0),
  metodo: varchar("metodo", { length: 160 }).notNull(),
  status: varchar("status", { length: 20 }).notNull().default("Recebido"),
  criadoEm: timestamp("criado_em").notNull().defaultNow(),
});
export type Pagamento = typeof pagamentos.$inferSelect;

/* ---------- Movimentos de stock ---------- */
export const stockMov = mysqlTable("stock_mov", {
  id: serial("id").primaryKey(),
  produtoId: bigint("produto_id", { mode: "number", unsigned: true }).notNull(),
  qtd: double("qtd").notNull(),
  tipo: mysqlEnum("tipo", ["entrada", "saida", "ajuste"]).notNull(),
  obs: varchar("obs", { length: 255 }),
  usuarioId: bigint("usuario_id", { mode: "number", unsigned: true }).notNull(),
  criadoEm: timestamp("criado_em").notNull().defaultNow(),
});
export type StockMov = typeof stockMov.$inferSelect;

/* ---------- Contadores (códigos sequenciais) ---------- */
export const contadores = mysqlTable("contadores", {
  id: serial("id").primaryKey(),
  chave: varchar("chave", { length: 40 }).notNull().unique(),
  valor: int("valor").notNull().default(0),
});

/* ---------- Configuração da empresa (editável pelo Admin) ---------- */
export const config = mysqlTable("config", {
  id: serial("id").primaryKey(),
  chave: varchar("chave", { length: 60 }).notNull().unique(),
  valor: text("valor"),
});
export type ConfigRow = typeof config.$inferSelect;

/* ---------- Documentos fiscais: Pro-forma e Factura ---------- */
export type DocItem = { nome: string; qtd: number; precoUnit: number; total: number; personalizado?: boolean; obs?: string };

export const documentos = mysqlTable(
  "documentos",
  {
    id: serial("id").primaryKey(),
    codigo: varchar("codigo", { length: 12 }).notNull().unique(), // PF-0001 / FT-0001
    tipo: mysqlEnum("tipo", ["Proforma", "Factura"]).notNull(),
    pedidoId: bigint("pedido_id", { mode: "number", unsigned: true }),
    pedidoRef: varchar("pedido_ref", { length: 80 }), // "Pedido nº 3 — 2026-08-19"
    clienteNome: varchar("cliente_nome", { length: 160 }),
    clienteEmail: varchar("cliente_email", { length: 160 }),
    clienteNuit: varchar("cliente_nuit", { length: 20 }),
    representante: varchar("representante", { length: 160 }),
    ivaModo: mysqlEnum("iva_modo", ["incluido", "adicional", "isento"]).notNull().default("incluido"),
    desconto: double("desconto").notNull().default(0), // %
    subtotal: double("subtotal").notNull().default(0),
    ivaValor: double("iva_valor").notNull().default(0),
    total: double("total").notNull().default(0),
    itens: json("itens").$type<DocItem[]>().notNull(),
    usuarioId: bigint("usuario_id", { mode: "number", unsigned: true }).notNull(),
    criadoEm: timestamp("criado_em").notNull().defaultNow(),
  },
  (t) => ({ pedIdx: index("doc_ped_idx").on(t.pedidoId) }),
);
export type Documento = typeof documentos.$inferSelect;

/* ============================================================
   LOJA ONLINE (pedidos do cliente estilo iFood)
   ============================================================ */

/* ---------- Clientes registados (cadastro opcional) ---------- */
export const clientes = mysqlTable("clientes", {
  id: serial("id").primaryKey(),
  nome: varchar("nome", { length: 160 }).notNull(),
  telefone: varchar("telefone", { length: 30 }).notNull().unique(), // WhatsApp
  email: varchar("email", { length: 160 }),
  senhaHash: varchar("senha_hash", { length: 128 }).notNull(),
  tentativas: int("tentativas").notNull().default(0), // falhas de login seguidas
  bloqueado: boolean("bloqueado").notNull().default(false), // após 3 falhas — recuperar por email+telefone
  criadoEm: timestamp("criado_em").notNull().defaultNow(),
});
export type Cliente = typeof clientes.$inferSelect;

/* ---------- Sessões de clientes (tokens) ---------- */
export const clienteTokens = mysqlTable("cliente_tokens", {
  id: serial("id").primaryKey(),
  token: varchar("token", { length: 80 }).notNull().unique(),
  clienteId: bigint("cliente_id", { mode: "number", unsigned: true }).notNull(),
  criadoEm: timestamp("criado_em").notNull().defaultNow(),
});

/* ---------- Pedidos online ---------- */
export type PropostaOnline = {
  removidos: number[]; // índices dos itens fora de stock (rejeitados pelo restaurante)
  adicionados: DocItem[]; // substitutos propostos
  itensOriginais?: DocItem[]; // fotografia dos itens no momento da proposta (permite reeditar/retirar)
  criadoPor: string;
  criadoEm: string; // ISO
  respondidaEm?: string | null; // ISO — preenchido quando o cliente responde (permite reeditar)
};

/** Item especial (fora do menu) pedido pelo cliente na loja online.
    O cliente NÃO define o preço — o restaurante cota e o cliente aceita/recusa. */
export type ExtraOnline = {
  descricao: string;
  detalhes?: string; // detalhes do pedido (tamanho, cores, data, etc.)
  qtd: number;
  preco: number; // definido pelo restaurante na cotação
  cotado: boolean;
  cotadoPor?: string;
  aceite?: boolean | null; // null = a aguardar resposta do cliente
};

export const pedidosOnline = mysqlTable(
  "pedidos_online",
  {
    id: serial("id").primaryKey(),
    codigo: varchar("codigo", { length: 12 }).notNull().unique(), // OL-0001
    clienteId: bigint("cliente_id", { mode: "number", unsigned: true }),
    clienteNome: varchar("cliente_nome", { length: 160 }).notNull(),
    clienteTelefone: varchar("cliente_telefone", { length: 30 }).notNull(),
    clienteEmail: varchar("cliente_email", { length: 160 }),
    tipo: mysqlEnum("tipo", ["Local", "Delivery", "TakeAway", "Reserva"]).notNull(),
    mesa: varchar("mesa", { length: 20 }), // vem do QR code da mesa
    endereco: text("endereco"), // delivery
    dataAgendada: varchar("data_agendada", { length: 10 }), // reserva (consumo a posterior)
    horaAgendada: varchar("hora_agendada", { length: 5 }), // reserva: hora prevista de chegada
    pessoas: int("pessoas"), // reserva online: nº de participantes (valor = pessoas × taxa)
    area: varchar("area", { length: 80 }), // reserva online: espaço onde o cliente pretende sentar (obrigatório)
    afiliadoId: bigint("afiliado_id", { mode: "number", unsigned: true }), // código de afiliado usado no pedido
    vindaConfirmada: boolean("vinda_confirmada").notNull().default(false), // reserva: cliente confirmou a vinda (T-6h)
    /* --- BRAAI online (tipo "Reserva" + braai_modalidade preenchida) --- */
    braaiModalidade: varchar("braai_modalidade", { length: 1 }), // "A" traz tudo · "B" traz comida OU bebidas
    braaiTraz: varchar("braai_traz", { length: 20 }), // modalidade B: "Comida" | "Bebidas"
    criancasMenores: int("criancas_menores").notNull().default(0), // crianças até 9 anos (não pagam)
    itens: json("itens").$type<DocItem[]>().notNull(),
    subtotal: double("subtotal").notNull().default(0),
    taxaEntrega: double("taxa_entrega").notNull().default(0),
    total: double("total").notNull().default(0),
    adiant: double("adiant").notNull().default(0), // reserva: 50%
    status: mysqlEnum("status", [
      "Pendente", "Comprovativo Enviado", "Aguarda Consumo", "Confirmado", "Em Preparo",
      "Pronto", "Em Entrega", "Entregue", "Concluído", "Cancelado",
    ]).notNull().default("Pendente"),
    comprovativo: mediumtext("comprovativo"), // foto/documento em data URL
    metodoPagamento: varchar("metodo_pagamento", { length: 24 }), // "e-Mola" | "e-Mola Levantamento" | "FNB" | "Dinheiro"
    atualizadoPor: varchar("atualizado_por", { length: 120 }), // último funcionário que mexeu no pedido
    entregadorNome: varchar("entregador_nome", { length: 120 }), // entregador atribuído (delivery)
    entregadorTel: varchar("entregador_tel", { length: 30 }),
    lat: double("lat"), // coordenadas do mapa de entrega (delivery)
    lng: double("lng"),
    tempoEstimado: int("tempo_estimado"), // minutos
    inicioEstimado: varchar("inicio_estimado", { length: 5 }), // HH:MM (Maputo)
    fimEstimado: varchar("fim_estimado", { length: 5 }),
    atrasoNotificado: timestamp("atraso_notificado"), // watchdog de atraso já disparou
    proposta: json("proposta").$type<PropostaOnline | null>(), // alteração proposta pelo restaurante (aguarda cliente)
    extras: json("extras").$type<ExtraOnline[] | null>(), // itens especiais fora do menu — cotados pelo restaurante
    criadoEm: timestamp("criado_em").notNull().defaultNow(),
    atualizadoEm: timestamp("atualizado_em").notNull().defaultNow(),
  },
  (t) => ({
    telIdx: index("ol_tel_idx").on(t.clienteTelefone),
    statusIdx: index("ol_status_idx").on(t.status),
  }),
);
export type PedidoOnline = typeof pedidosOnline.$inferSelect;

/* ---------- Notificações (registo das mensagens WhatsApp/SMS ao cliente) ---------- */
export const notificacoes = mysqlTable(
  "notificacoes",
  {
    id: serial("id").primaryKey(),
    pedidoOnlineId: bigint("pedido_online_id", { mode: "number", unsigned: true }).notNull(),
    telefone: varchar("telefone", { length: 30 }).notNull(),
    mensagem: text("mensagem").notNull(),
    autor: varchar("autor", { length: 120 }), // funcionário que gerou a mensagem (null = automático)
    criadoEm: timestamp("criado_em").notNull().defaultNow(),
  },
  (t) => ({ pedIdx: index("not_ped_idx").on(t.pedidoOnlineId) }),
);
export type Notificacao = typeof notificacoes.$inferSelect;

/* ---------- Despesas diárias (compras, energia, transporte, etc.) ---------- */
export const despesas = mysqlTable(
  "despesas",
  {
    id: serial("id").primaryKey(),
    dataDia: varchar("data_dia", { length: 10 }).notNull(), // YYYY-MM-DD (dia do gasto)
    categoria: varchar("categoria", { length: 80 }).notNull(),
    descricao: varchar("descricao", { length: 255 }).notNull(),
    fornecedor: varchar("fornecedor", { length: 160 }),
    fornecedorTel: varchar("fornecedor_tel", { length: 30 }), // contacto do fornecedor (opcional)
    valor: double("valor").notNull().default(0),
    tipoCusto: mysqlEnum("tipo_custo", ["Fixo", "Variavel"]).notNull().default("Variavel"),
    // pagamento: Pago (total) · Credito (nada pago) · Parcelado (valorPago parcial)
    formaPagamento: mysqlEnum("forma_pagamento", ["Pago", "Credito", "Parcelado"]).notNull().default("Pago"),
    valorPago: double("valor_pago").notNull().default(0), // quanto já foi pago (Pago → igual ao valor)
    // compra de mercadoria ligada ao stock: entra automaticamente no inventário
    produtoId: bigint("produto_id", { mode: "number", unsigned: true }),
    quantidade: double("quantidade"),
    usuarioId: bigint("usuario_id", { mode: "number", unsigned: true }).notNull(),
    criadoEm: timestamp("criado_em").notNull().defaultNow(),
  },
  (t) => ({ diaIdx: index("desp_dia_idx").on(t.dataDia) }),
);
export type Despesa = typeof despesas.$inferSelect;

/* ---------- Pagamentos/amortizações de despesas a crédito ou em parcelas ---------- */
export const despesaPagamentos = mysqlTable(
  "despesa_pagamentos",
  {
    id: serial("id").primaryKey(),
    despesaId: bigint("despesa_id", { mode: "number", unsigned: true }).notNull(),
    valor: double("valor").notNull(),
    dataDia: varchar("data_dia", { length: 10 }).notNull(),
    usuarioId: bigint("usuario_id", { mode: "number", unsigned: true }).notNull(),
    criadoEm: timestamp("criado_em").notNull().defaultNow(),
  },
  (t) => ({ despIdx: index("desppag_desp_idx").on(t.despesaId) }),
);
export type DespesaPagamento = typeof despesaPagamentos.$inferSelect;

/* ---------- Movimentos de agente eMola / M-Pesa (comissões da empresa como agente) ---------- */
export const agenteMovimentos = mysqlTable(
  "agente_movimentos",
  {
    id: serial("id").primaryKey(),
    dataDia: varchar("data_dia", { length: 10 }).notNull(), // YYYY-MM-DD (hora de Moçambique)
    sistema: mysqlEnum("sistema", ["eMola", "Mpesa"]).notNull(),
    tipo: mysqlEnum("tipo", ["Levantamento", "Deposito"]).notNull(),
    valor: double("valor").notNull(), // valor movimentado pelo cliente
    taxaPct: double("taxa_pct").notNull().default(0), // % de comissão aplicada (snapshot)
    comissao: double("comissao").notNull().default(0), // comissão calculada
    recebidoEm: varchar("recebido_em", { length: 10 }), // data em que a operadora pagou a comissão (null = a receber)
    usuarioId: bigint("usuario_id", { mode: "number", unsigned: true }).notNull(),
    criadoEm: timestamp("criado_em").notNull().defaultNow(),
  },
  (t) => ({ diaIdx: index("agente_dia_idx").on(t.dataDia) }),
);
export type AgenteMovimento = typeof agenteMovimentos.$inferSelect;

/* ---------- Avaliações dos clientes online (estrelas + comentário, opcional) ---------- */
export const avaliacoes = mysqlTable(
  "avaliacoes",
  {
    id: serial("id").primaryKey(),
    pedidoOnlineId: bigint("pedido_online_id", { mode: "number", unsigned: true }).notNull(),
    clienteNome: varchar("cliente_nome", { length: 160 }).notNull(),
    estrelas: int("estrelas").notNull(), // 1..5
    comentario: varchar("comentario", { length: 500 }),
    criadoEm: timestamp("criado_em").notNull().defaultNow(),
  },
  (t) => ({ pedIdx: index("aval_ped_idx").on(t.pedidoOnlineId) }),
);
export type Avaliacao = typeof avaliacoes.$inferSelect;

/* ---------- Conta Gerência — consumo dos proprietários (stock sempre descontado) ---------- */
export const gerencia = mysqlTable("gerencia", {
  id: serial("id").primaryKey(),
  codigo: varchar("codigo", { length: 12 }).notNull().unique(), // GR-0001
  itens: json("itens").$type<DocItem[]>().notNull(),
  total: double("total").notNull().default(0),
  dataConsumo: varchar("data_consumo", { length: 10 }), // dia do consumo (pode ser ANTERIOR ao registo — consumo atrasado); null = dia do registo
  pago: boolean("pago").notNull().default(false), // na maioria das vezes não é pago
  metodo: varchar("metodo", { length: 160 }), // método de pagamento (quando pago)
  obs: varchar("obs", { length: 255 }), // quem consumiu / nota
  usuarioId: bigint("usuario_id", { mode: "number", unsigned: true }).notNull(),
  criadoEm: timestamp("criado_em").notNull().defaultNow(),
});
export type Gerencia = typeof gerencia.$inferSelect;

/* ---------- Comprovativos de compras do dia (despesas) ---------- */
export const despesaAnexos = mysqlTable(
  "despesa_anexos",
  {
    id: serial("id").primaryKey(),
    dataDia: varchar("data_dia", { length: 10 }).notNull(), // YYYY-MM-DD (dia da compra)
    nota: varchar("nota", { length: 255 }), // obrigatória quando não há comprovativo
    imagem: mediumtext("imagem"), // data URL (null = compra sem comprovativo)
    usuarioId: bigint("usuario_id", { mode: "number", unsigned: true }).notNull(),
    criadoEm: timestamp("criado_em").notNull().defaultNow(),
  },
  (t) => ({ diaIdx: index("dex_dia_idx").on(t.dataDia) }),
);
export type DespesaAnexo = typeof despesaAnexos.$inferSelect;

/* ---------- Solicitações de entregador (delivery online) ---------- */
export const entregaSolicitacoes = mysqlTable(
  "entrega_solicitacoes",
  {
    id: serial("id").primaryKey(),
    pedidoOnlineId: bigint("pedido_online_id", { mode: "number", unsigned: true }).notNull(),
    codigo: varchar("codigo", { length: 12 }).notNull(), // OL-XXXX (para mostrar ao entregador)
    taxa: double("taxa").notNull().default(0),
    estado: mysqlEnum("estado", ["Aberta", "Atribuida", "Cancelada", "Concluida"]).notNull().default("Aberta"),
    entregadorId: bigint("entregador_id", { mode: "number", unsigned: true }), // primeiro a aceitar ganha
    entregadorNome: varchar("entregador_nome", { length: 120 }),
    criadoEm: timestamp("criado_em").notNull().defaultNow(),
    atualizadoEm: timestamp("atualizado_em").notNull().defaultNow(),
  },
  (t) => ({ estIdx: index("es_est_idx").on(t.estado) }),
);
export type EntregaSolicitacao = typeof entregaSolicitacoes.$inferSelect;

/* ================= CRM DE AFILIADOS ================= */
export const afiliados = mysqlTable(
  "afiliados",
  {
    id: serial("id").primaryKey(),
    codigo: varchar("codigo", { length: 12 }).notNull().unique(), // AF-0001
    nome: varchar("nome", { length: 160 }).notNull(), // nome completo do BI
    biNumero: varchar("bi_numero", { length: 60 }).notNull(),
    biDocumento: mediumtext("bi_documento"), // foto do BI/passaporte (data URL)
    dataNascimento: varchar("data_nascimento", { length: 10 }), // YYYY-MM-DD
    residencia: varchar("residencia", { length: 200 }).notNull(),
    email: varchar("email", { length: 160 }),
    telefone: varchar("telefone", { length: 40 }).notNull().unique(), // WhatsApp principal
    telefoneAlternativo: varchar("telefone_alternativo", { length: 40 }), // se não tiver WhatsApp
    whatsVerificado: boolean("whats_verificado").notNull().default(false),
    codigoVerificacao: varchar("codigo_verificacao", { length: 12 }), // código p/ enviar por WhatsApp
    fotoPerfil: mediumtext("foto_perfil"),
    senhaHash: varchar("senha_hash", { length: 128 }).notNull(),
    tentativas: int("tentativas").notNull().default(0),
    bloqueado: boolean("bloqueado").notNull().default(false),
    nivel: mysqlEnum("nivel", ["Bronze", "Prata", "Ouro"]).notNull().default("Bronze"),
    status: mysqlEnum("status", ["Pendente", "Experimental", "Activo", "ListaEspera", "Suspenso", "Rejeitado"]).notNull().default("Pendente"),
    disponibilidade: varchar("disponibilidade", { length: 120 }),
    experiencia: varchar("experiencia", { length: 500 }),
    redesSociais: varchar("redes_sociais", { length: 300 }),
    metodoPagamento: varchar("metodo_pagamento", { length: 60 }), // M-Pesa / e-Mola / Conta bancária
    contaPagamento: varchar("conta_pagamento", { length: 120 }),
    nuit: varchar("nuit", { length: 30 }),
    indicadoPorId: bigint("indicado_por_id", { mode: "number", unsigned: true }),
    indicadoPorNome: varchar("indicado_por_nome", { length: 160 }),
    vendasTotal: int("vendas_total").notNull().default(0), // nº de vendas atribuídas (define o nível)
    aprovadoEm: timestamp("aprovado_em"),
    criadoEm: timestamp("criado_em").notNull().defaultNow(),
    atualizadoEm: timestamp("atualizado_em").notNull().defaultNow(),
  },
  (t) => ({ stIdx: index("af_st_idx").on(t.status) }),
);
export type Afiliado = typeof afiliados.$inferSelect;

export const afiliadoTokens = mysqlTable(
  "afiliado_tokens",
  {
    id: serial("id").primaryKey(),
    token: varchar("token", { length: 80 }).notNull().unique(),
    afiliadoId: bigint("afiliado_id", { mode: "number", unsigned: true }).notNull(),
    criadoEm: timestamp("criado_em").notNull().defaultNow(),
  },
  (t) => ({ afIdx: index("aft_af_idx").on(t.afiliadoId) }),
);
export type AfiliadoToken = typeof afiliadoTokens.$inferSelect;

export const afiliadoLeads = mysqlTable(
  "afiliado_leads",
  {
    id: serial("id").primaryKey(),
    afiliadoId: bigint("afiliado_id", { mode: "number", unsigned: true }).notNull(),
    clienteNome: varchar("cliente_nome", { length: 160 }).notNull(),
    clienteContacto: varchar("cliente_contacto", { length: 60 }).notNull(),
    interesse: varchar("interesse", { length: 120 }).notNull(),
    obs: varchar("obs", { length: 500 }),
    estado: mysqlEnum("estado", ["Novo", "Negociacao", "Convertido", "Perdido"]).notNull().default("Novo"),
    protegidoAte: varchar("protegido_ate", { length: 10 }), // YYYY-MM-DD (90 dias renováveis)
    reservaId: bigint("reserva_id", { mode: "number", unsigned: true }),
    pedidoId: bigint("pedido_id", { mode: "number", unsigned: true }),
    criadoEm: timestamp("criado_em").notNull().defaultNow(),
    atualizadoEm: timestamp("atualizado_em").notNull().defaultNow(),
  },
  (t) => ({ afIdx: index("afl_af_idx").on(t.afiliadoId), estIdx: index("afl_est_idx").on(t.estado) }),
);
export type AfiliadoLead = typeof afiliadoLeads.$inferSelect;

export const afiliadoComissoes = mysqlTable(
  "afiliado_comissoes",
  {
    id: serial("id").primaryKey(),
    afiliadoId: bigint("afiliado_id", { mode: "number", unsigned: true }).notNull(),
    leadId: bigint("lead_id", { mode: "number", unsigned: true }),
    origem: mysqlEnum("origem", ["Reserva", "Pedido", "Online"]).notNull(),
    origemId: bigint("origem_id", { mode: "number", unsigned: true }).notNull(),
    origemRef: varchar("origem_ref", { length: 20 }), // R-0007 / #123 / OL-0001
    descricao: varchar("descricao", { length: 300 }),
    valorVenda: double("valor_venda").notNull().default(0),
    pct: double("pct").notNull().default(3),
    valorComissao: double("valor_comissao").notNull().default(0),
    parcela: int("parcela").notNull().default(1), // 1 = primeira prestação, 2 = última
    estado: mysqlEnum("estado", ["Pendente", "Paga", "Estornada"]).notNull().default("Pendente"),
    mesReferencia: varchar("mes_referencia", { length: 7 }), // YYYY-MM
    reciboId: bigint("recibo_id", { mode: "number", unsigned: true }),
    pagoEm: timestamp("pago_em"),
    criadoEm: timestamp("criado_em").notNull().defaultNow(),
  },
  (t) => ({ afIdx: index("afc_af_idx").on(t.afiliadoId), mesIdx: index("afc_mes_idx").on(t.mesReferencia), estIdx: index("afc_est_idx").on(t.estado) }),
);
export type AfiliadoComissao = typeof afiliadoComissoes.$inferSelect;

export const afiliadoRecibos = mysqlTable(
  "afiliado_recibos",
  {
    id: serial("id").primaryKey(),
    codigo: varchar("codigo", { length: 12 }).notNull().unique(), // RAF-0001
    afiliadoId: bigint("afiliado_id", { mode: "number", unsigned: true }).notNull(),
    mesReferencia: varchar("mes_referencia", { length: 7 }).notNull(), // YYYY-MM
    totalComissoes: double("total_comissoes").notNull().default(0),
    bonusMeta: double("bonus_meta").notNull().default(0), // 2.000 MZN (3+ eventos no mês)
    bonusMes: double("bonus_mes").notNull().default(0), // 5.000 MZN (Afiliado do Mês)
    bonusIndicacao: double("bonus_indicacao").notNull().default(0), // 1.000 MZN por indicação produtiva
    total: double("total").notNull().default(0),
    metodo: varchar("metodo", { length: 60 }),
    estado: mysqlEnum("estado", ["Emitido", "Assinado", "Pago"]).notNull().default("Emitido"),
    assinadoPor: varchar("assinado_por", { length: 160 }), // nome digitado (assinatura online)
    assinadoEm: timestamp("assinado_em"),
    pagoEm: timestamp("pago_em"),
    despesaId: bigint("despesa_id", { mode: "number", unsigned: true }),
    criadoEm: timestamp("criado_em").notNull().defaultNow(),
  },
  (t) => ({ afIdx: index("afr_af_idx").on(t.afiliadoId), mesIdx: index("afr_mes_idx").on(t.mesReferencia) }),
);
export type AfiliadoRecibo = typeof afiliadoRecibos.$inferSelect;


/* ============================================================
   VAGAS & RECRUTAMENTO (v18) — concursos públicos de emprego
   ============================================================ */
export const vagas = mysqlTable("vagas", {
  id: serial("id").primaryKey(),
  titulo: varchar("titulo", { length: 120 }).notNull(),
  area: varchar("area", { length: 80 }).notNull().default("Cozinha"),
  tipo: varchar("tipo", { length: 60 }).notNull().default("Tempo inteiro"), // Tempo inteiro / Part-time / Estágio
  local: varchar("local", { length: 120 }).notNull().default("Chimoio — CAMI'S Eventos"),
  salario: varchar("salario", { length: 80 }), // opcional — ex.: "a combinar"
  descricao: text("descricao"), // o que a pessoa vai fazer
  requisitos: text("requisitos"), // perfil/requisitos do candidato
  oferecemos: text("oferecemos"), // benefícios
  estado: varchar("estado", { length: 12 }).notNull().default("Aberta"), // Aberta / Fechada
  criadoEm: timestamp("criado_em").notNull().defaultNow(),
});
export type Vaga = typeof vagas.$inferSelect;

export const candidaturas = mysqlTable(
  "candidaturas",
  {
    id: serial("id").primaryKey(),
    codigo: varchar("codigo", { length: 12 }).notNull().unique(), // CND-0001
    vagaId: bigint("vaga_id", { mode: "number", unsigned: true }).notNull(),
    nome: varchar("nome", { length: 160 }).notNull(),
    telefone: varchar("telefone", { length: 30 }).notNull(),
    email: varchar("email", { length: 120 }),
    idade: int("idade"),
    residencia: varchar("residencia", { length: 120 }), // bairro/cidade
    experienciaAnos: double("experiencia_anos").notNull().default(0),
    disponibilidade: varchar("disponibilidade", { length: 40 }).notNull().default("Imediata"),
    apresentacao: text("apresentacao"), // breve apresentação do candidato
    cv: mediumtext("cv"), // ficheiro em data URL (PDF/imagem)
    cvNome: varchar("cv_nome", { length: 160 }),
    status: varchar("status", { length: 20 }).notNull().default("Nova"),
    // Nova → Em análise → Pré-seleccionado → Entrevista → Contratado / Rejeitado
    pontuacao: int("pontuacao"), // 0–100, triagem automática
    pontuacaoDetalhe: text("pontuacao_detalhe"), // justificação da triagem (JSON de linhas)
    notaInterna: varchar("nota_interna", { length: 255 }),
    criadoEm: timestamp("criado_em").notNull().defaultNow(),
  },
  (t) => ({ vagaIdx: index("cand_vaga_idx").on(t.vagaId), statusIdx: index("cand_status_idx").on(t.status) }),
);
export type Candidatura = typeof candidaturas.$inferSelect;

/** Pessoas que querem receber notificações de novas vagas (sem registo) */
export const vagasSubscritores = mysqlTable("vagas_subscritores", {
  id: serial("id").primaryKey(),
  nome: varchar("nome", { length: 160 }).notNull(),
  contacto: varchar("contacto", { length: 60 }).notNull(), // telefone (WhatsApp) ou email
  canal: varchar("canal", { length: 10 }).notNull().default("WhatsApp"), // WhatsApp / Email
  criadoEm: timestamp("criado_em").notNull().defaultNow(),
});
export type VagaSubscritor = typeof vagasSubscritores.$inferSelect;

/* ---------- Dívidas de clientes (fiado) ---------- */
/** Dívida registada quando um cliente fica a dever (total ou parcial) numa venda */
export const dividas = mysqlTable("dividas", {
  id: serial("id").primaryKey(),
  codigo: varchar("codigo", { length: 12 }).notNull().unique(), // DIV-0001
  pedidoId: bigint("pedido_id", { mode: "number", unsigned: true }), // venda de origem (se houver)
  clienteNome: varchar("cliente_nome", { length: 160 }).notNull(),
  clienteTel: varchar("cliente_tel", { length: 30 }),
  obs: varchar("obs", { length: 255 }),
  valorTotal: double("valor_total").notNull().default(0),
  status: varchar("status", { length: 12 }).notNull().default("Aberta"), // Aberta / Liquidada
  dataDia: varchar("data_dia", { length: 10 }).notNull(), // YYYY-MM-DD (MZ)
  criadoPor: bigint("criado_por", { mode: "number", unsigned: true }).notNull(),
  criadoEm: timestamp("criado_em").notNull().defaultNow(),
  liquidadaEm: timestamp("liquidada_em"),
});
export type Divida = typeof dividas.$inferSelect;

/** Amortizações/pagamentos feitos sobre uma dívida */
export const dividasPagamentos = mysqlTable("dividas_pagamentos", {
  id: serial("id").primaryKey(),
  dividaId: bigint("divida_id", { mode: "number", unsigned: true }).notNull(),
  valor: double("valor").notNull(),
  metodo: varchar("metodo", { length: 160 }).notNull(),
  usuarioId: bigint("usuario_id", { mode: "number", unsigned: true }).notNull(),
  criadoEm: timestamp("criado_em").notNull().defaultNow(),
});
export type DividaPagamento = typeof dividasPagamentos.$inferSelect;

/* ---------- Buffet (pacotes por pessoa, editáveis pelo Admin/Gestor) ---------- */
export const buffetPacotes = mysqlTable("buffet_pacotes", {
  id: serial("id").primaryKey(),
  nome: varchar("nome", { length: 80 }).notNull(), // ex.: "Menu de 1200"
  preco: double("preco").notNull(), // preço POR PESSOA (MZN)
  itens: json("itens").$type<string[]>().notNull(), // elementos incluídos (lista plana — usada em recibos/notificações)
  // menu organizado por secções (Entradas, Pratos principais, Guarnições, Saladas, Sobremesas) — Menus do Chefe 2026
  categorias: json("categorias").$type<{ nome: string; itens: string[] }[] | null>(),
  foto: varchar("foto", { length: 120 }), // imagem do pacote (ex.: /fotos/buffet-mini.jpg)
  descricao: varchar("descricao", { length: 255 }),
  ativo: boolean("ativo").notNull().default(true),
  ordem: int("ordem").notNull().default(0),
  criadoEm: timestamp("criado_em").notNull().defaultNow(),
});
export type BuffetPacote = typeof buffetPacotes.$inferSelect;

/* ---------- RECURSOS HUMANOS (v23) — só Administrador ---------- */
export const trabalhadores = mysqlTable("trabalhadores", {
  id: serial("id").primaryKey(),
  codigo: varchar("codigo", { length: 12 }).notNull().unique(), // TRB-0001
  nome: varchar("nome", { length: 160 }).notNull(),
  telefone: varchar("telefone", { length: 40 }),
  biNumero: varchar("bi_numero", { length: 60 }),
  regime: mysqlEnum("regime", ["Permanente", "Eventual", "Afiliado"]).notNull().default("Permanente"),
  area: mysqlEnum("area", ["Restaurante", "Decoração", "Ambas"]).notNull().default("Restaurante"),
  cargo: varchar("cargo", { length: 120 }).notNull(),
  atividades: text("atividades"), // o que faz na empresa (alimenta o contrato)
  dataInicio: varchar("data_inicio", { length: 10 }).notNull(), // YYYY-MM-DD — o salário cai no dia do mês da entrada
  salarioMensal: double("salario_mensal").notNull().default(0), // Permanente
  diaria: double("diaria").notNull().default(500), // Eventual / Afiliado a dias (500 MZN por dia e por área)
  afiliadoId: bigint("afiliado_id", { mode: "number", unsigned: true }), // ligação ao perfil de afiliado, se houver
  notas: varchar("notas", { length: 255 }),
  ativo: boolean("ativo").notNull().default(true),
  criadoEm: timestamp("criado_em").notNull().defaultNow(),
});
export type Trabalhador = typeof trabalhadores.$inferSelect;

export const rhPresencas = mysqlTable(
  "rh_presencas",
  {
    id: serial("id").primaryKey(),
    trabalhadorId: bigint("trabalhador_id", { mode: "number", unsigned: true }).notNull(),
    dataDia: varchar("data_dia", { length: 10 }).notNull(), // YYYY-MM-DD
    status: mysqlEnum("status", ["Presente", "Ausente"]).notNull().default("Presente"),
    area: mysqlEnum("area", ["Restaurante", "Decoração"]).notNull().default("Restaurante"),
    justificativa: varchar("justificativa", { length: 255 }), // obrigatória quando ausente (opcional mas prevista)
    criadoEm: timestamp("criado_em").notNull().defaultNow(),
  },
  (t) => ({ trDia: index("rhp_trdia_idx").on(t.trabalhadorId, t.dataDia), dia: index("rhp_dia_idx").on(t.dataDia) }),
);
export type RhPresenca = typeof rhPresencas.$inferSelect;

export const rhLicencas = mysqlTable(
  "rh_licencas",
  {
    id: serial("id").primaryKey(),
    trabalhadorId: bigint("trabalhador_id", { mode: "number", unsigned: true }).notNull(),
    tipo: mysqlEnum("tipo", ["Anual", "Periódica", "Doença", "Outra"]).notNull().default("Anual"),
    motivo: varchar("motivo", { length: 255 }).notNull(),
    inicio: varchar("inicio", { length: 10 }).notNull(),
    fim: varchar("fim", { length: 10 }).notNull(),
    criadoEm: timestamp("criado_em").notNull().defaultNow(),
  },
  (t) => ({ tr: index("rhl_tr_idx").on(t.trabalhadorId) }),
);
export type RhLicenca = typeof rhLicencas.$inferSelect;

/* ---------- Oportunidades de trabalho eventual para afiliados (v27) ---------- */
export const trabalhoVagas = mysqlTable("trabalho_vagas", {
  id: serial("id").primaryKey(),
  codigo: varchar("codigo", { length: 12 }).notNull().unique(), // TV-0001
  dataTrabalho: varchar("data_trabalho", { length: 10 }).notNull(), // YYYY-MM-DD
  horaInicio: varchar("hora_inicio", { length: 5 }), // HH:MM
  area: mysqlEnum("area", ["Restaurante", "Decoração", "Catering", "Apoio em eventos"]).notNull(),
  descricao: varchar("descricao", { length: 255 }),
  vagas: int("vagas").notNull().default(1), // quantos eventuais serão aceites
  diaria: double("diaria").notNull().default(500),
  limiteAceite: varchar("limite_aceite", { length: 16 }), // "YYYY-MM-DD HH:MM" — passado o limite, a vaga some para quem não respondeu
  status: mysqlEnum("status", ["Aberta", "Preenchida", "Cancelada", "Concluída"]).notNull().default("Aberta"),
  criadoPor: varchar("criado_por", { length: 120 }),
  criadoEm: timestamp("criado_em").notNull().defaultNow(),
});
export type TrabalhoVaga = typeof trabalhoVagas.$inferSelect;

export const trabalhoVagaDestinos = mysqlTable(
  "trabalho_vaga_destinos",
  {
    id: serial("id").primaryKey(),
    vagaId: bigint("vaga_id", { mode: "number", unsigned: true }).notNull(),
    afiliadoId: bigint("afiliado_id", { mode: "number", unsigned: true }).notNull(),
    estado: mysqlEnum("estado", ["Pendente", "Aceite", "Recusado"]).notNull().default("Pendente"),
    respostaEm: timestamp("resposta_em"),
    criadoEm: timestamp("criado_em").notNull().defaultNow(),
  },
  (t) => ({ vgAf: index("tvd_vgaf_idx").on(t.vagaId, t.afiliadoId) }),
);
export type TrabalhoVagaDestino = typeof trabalhoVagaDestinos.$inferSelect;

export const rhSalarioPagamentos = mysqlTable(
  "rh_salario_pagamentos",
  {
    id: serial("id").primaryKey(),
    trabalhadorId: bigint("trabalhador_id", { mode: "number", unsigned: true }).notNull(),
    mesReferencia: varchar("mes_referencia", { length: 7 }).notNull(), // YYYY-MM
    valor: double("valor").notNull(),
    // «Adiantamento» (o funcionário pede antes do dia do salário) ou «Pagamento» (parcela normal)
    tipo: varchar("tipo", { length: 20 }).notNull().default("Pagamento"),
    metodo: varchar("metodo", { length: 60 }),
    obs: varchar("obs", { length: 255 }),
    pagoPor: varchar("pago_por", { length: 120 }),
    pagoEm: timestamp("pago_em").notNull().defaultNow(),
  },
  (t) => ({ trMes: index("rhs_trmes_idx").on(t.trabalhadorId, t.mesReferencia) }),
);
export type RhSalarioPagamento = typeof rhSalarioPagamentos.$inferSelect;
