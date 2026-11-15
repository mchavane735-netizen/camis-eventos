/**
 * CAMI'S EVENTOS — Auto-seed no arranque
 * Se a base de dados estiver vazia (instalação nova / restauro), cria os
 * utilizadores iniciais, os produtos do seed e os contadores — garantindo
 * que o login funciona sempre (Administrador/1234, Gerente/2345, Vendedor 1/3456).
 * Nunca falha o arranque: qualquer erro é apenas registado no log.
 */
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { getDb } from "./queries/connection";
import { usuarios, produtos, contadores, vagas, buffetPacotes } from "@db/schema";
import { inArray, like, sql } from "drizzle-orm";

/* Migrações idempotentes aplicadas no arranque (erros de "coluna já existe" são ignorados).
   NOTA: a lista da v16 é importada inline para o bundle de produção não depender de db/. */
const AUTO_MIGRATIONS: string[] = [
  "CREATE TABLE IF NOT EXISTS sessoes (token VARCHAR(64) PRIMARY KEY, usuario_id BIGINT UNSIGNED NOT NULL, expira_em TIMESTAMP NOT NULL, criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)",
  // v34 — ingredientes/acompanhantes do produto (menu impresso + loja online)
  "ALTER TABLE produtos ADD COLUMN ingredientes VARCHAR(500) NULL AFTER foto",
  // v35 — data do consumo na Conta Gerência (permite lançar consumos atrasados)
  "ALTER TABLE gerencia ADD COLUMN data_consumo VARCHAR(10) NULL AFTER total",

  // v26
  "ALTER TABLE usuarios ADD COLUMN pode_reabrir_reserva TINYINT(1) NOT NULL DEFAULT 0",
  // v28
  "ALTER TABLE usuarios ADD COLUMN pode_editar_stock TINYINT(1) NOT NULL DEFAULT 0",
  // v39 — correcção de nomes já registados (mesa/atendente, evento, titular do bilhete) — concedida pelo Admin
  "ALTER TABLE usuarios ADD COLUMN pode_editar_nomes TINYINT(1) NOT NULL DEFAULT 0",
  // v40 — bilhetes em PRESTAÇÕES: limite por evento + quanto já foi pago por bilhete
  "ALTER TABLE eventos ADD COLUMN max_prestacoes INT NOT NULL DEFAULT 1",
  "ALTER TABLE evento_bilhetes ADD COLUMN valor_pago DOUBLE NOT NULL DEFAULT 0",
  "ALTER TABLE evento_bilhetes ADD COLUMN n_prestacoes INT NOT NULL DEFAULT 1",
  // bilhetes antigos (pagos na íntegra) ficam com valor_pago = valor; bilhetes em prestações
  // têm sempre valor_pago >= 1 (o sinal é obrigatório), por isso esta actualização nunca lhes toca
  "UPDATE evento_bilhetes SET valor_pago = valor WHERE status = 'Pago' AND valor_pago = 0",
  // v29
  "ALTER TABLE usuarios MODIFY COLUMN perfil ENUM('Admin','Gestor','Vendedor','Cozinha','Logistica','Entregador','RH') NOT NULL DEFAULT 'Vendedor'",
  // v30
  "ALTER TABLE pedidos ADD COLUMN atendente varchar(120) NULL AFTER area",
  // v31
  "ALTER TABLE pedidos ADD COLUMN reabertura_por varchar(160) NULL AFTER atendente",
  "ALTER TABLE pedidos ADD COLUMN reabertura_motivo varchar(255) NULL AFTER reabertura_por",
  // v32 — eventos & bilheteira
  `CREATE TABLE IF NOT EXISTS eventos (
    id INT AUTO_INCREMENT PRIMARY KEY,
    codigo varchar(12) NOT NULL UNIQUE,
    nome varchar(160) NOT NULL,
    descricao text NULL,
    data_evento varchar(10) NOT NULL,
    hora_inicio varchar(5) NULL,
    hora_fim varchar(5) NULL,
    local varchar(160) NULL,
    preco_normal double NOT NULL DEFAULT 0,
    preco_vip double NOT NULL DEFAULT 0,
    capacidade int NULL,
    status ENUM('Rascunho','Aberto','Esgotado','Encerrado','Concluído','Cancelado') NOT NULL DEFAULT 'Rascunho',
    criado_por BIGINT UNSIGNED NULL,
    criado_em timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS evento_bilhetes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    codigo varchar(12) NOT NULL UNIQUE,
    evento_id BIGINT UNSIGNED NOT NULL,
    nome_pessoa varchar(160) NOT NULL,
    telefone varchar(40) NULL,
    tipo ENUM('Normal','VIP') NOT NULL DEFAULT 'Normal',
    valor double NOT NULL DEFAULT 0,
    metodo varchar(160) NULL,
    vendedor_id BIGINT UNSIGNED NOT NULL,
    status ENUM('Pago','Anulado') NOT NULL DEFAULT 'Pago',
    data_dia varchar(10) NOT NULL,
    criado_em timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    anulado_em timestamp NULL,
    anulado_por varchar(120) NULL,
    INDEX bilhete_ev_idx (evento_id, status)
  )`,
  // v33 — perfil Gestor de Eventos
  "ALTER TABLE usuarios MODIFY COLUMN perfil ENUM('Admin','Gestor','Vendedor','Cozinha','Logistica','Entregador','RH','Eventos') NOT NULL DEFAULT 'Vendedor'",
  // v35 — buffet: menu por secções (categorias) — Menus do Chefe 2026
  "ALTER TABLE buffet_pacotes ADD COLUMN categorias JSON NULL",
  // v37 — histórico de lançamentos de itens (auditoria dos toques no +/−)
  `CREATE TABLE IF NOT EXISTS pedido_itens_log (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    pedido_id BIGINT UNSIGNED NOT NULL,
    produto_id BIGINT UNSIGNED NULL,
    nome VARCHAR(255) NOT NULL,
    delta DOUBLE NOT NULL,
    qtd_final DOUBLE NOT NULL,
    origem VARCHAR(20) NOT NULL DEFAULT 'ajuste',
    usuario_nome VARCHAR(120) NULL,
    criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX ped_log_idx (pedido_id)
  )`,
  // v38 — salários: adiantamentos e pagamento em parcelas (tipo do lançamento)
  "ALTER TABLE rh_salario_pagamentos ADD COLUMN tipo VARCHAR(20) NOT NULL DEFAULT 'Pagamento' AFTER valor",
  // v34 — pacotes com descrição + entrada por scanner
  "ALTER TABLE eventos ADD COLUMN inclui_normal text NULL AFTER preco_vip",
  "ALTER TABLE eventos ADD COLUMN inclui_vip text NULL AFTER inclui_normal",
  "ALTER TABLE evento_bilhetes ADD COLUMN usado_em timestamp NULL AFTER anulado_por",
  "ALTER TABLE evento_bilhetes ADD COLUMN usado_por varchar(120) NULL AFTER usado_em",
  // v27
  `CREATE TABLE IF NOT EXISTS trabalho_vagas (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    codigo VARCHAR(12) NOT NULL UNIQUE,
    data_trabalho VARCHAR(10) NOT NULL,
    hora_inicio VARCHAR(5),
    area ENUM('Restaurante','Decoração','Catering','Apoio em eventos') NOT NULL,
    descricao VARCHAR(255),
    vagas INT NOT NULL DEFAULT 1,
    diaria DOUBLE NOT NULL DEFAULT 500,
    limite_aceite VARCHAR(16),
    status ENUM('Aberta','Preenchida','Cancelada','Concluída') NOT NULL DEFAULT 'Aberta',
    criado_por VARCHAR(120),
    criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS trabalho_vaga_destinos (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    vaga_id BIGINT UNSIGNED NOT NULL,
    afiliado_id BIGINT UNSIGNED NOT NULL,
    estado ENUM('Pendente','Aceite','Recusado') NOT NULL DEFAULT 'Pendente',
    resposta_em TIMESTAMP NULL,
    criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX tvd_vgaf_idx (vaga_id, afiliado_id)
  )`,
  // v16 — BRAAI
  "ALTER TABLE reservas ADD braai TINYINT(1) NOT NULL DEFAULT 0",
  "ALTER TABLE reservas ADD braai_modalidade VARCHAR(1) NULL",
  "ALTER TABLE reservas ADD braai_traz VARCHAR(20) NULL",
  "ALTER TABLE reservas ADD criancas_menores INT NOT NULL DEFAULT 0",
  "ALTER TABLE reservas ADD checkin_em TIMESTAMP NULL",
  "ALTER TABLE reservas ADD checkin_por VARCHAR(120) NULL",
  "ALTER TABLE reservas ADD checkin_obs VARCHAR(255) NULL",
  "ALTER TABLE reservas ADD saldo_pago TINYINT(1) NOT NULL DEFAULT 0",
  "ALTER TABLE pedidos_online ADD braai_modalidade VARCHAR(1) NULL",
  "ALTER TABLE pedidos_online ADD braai_traz VARCHAR(20) NULL",
  "ALTER TABLE pedidos_online ADD criancas_menores INT NOT NULL DEFAULT 0",
  // v17 — controlo de acesso dos vendedores por horário
  "ALTER TABLE usuarios ADD desbloqueado_ate TIMESTAMP NULL",
  "ALTER TABLE usuarios ADD bloqueio_manual TINYINT(1) NOT NULL DEFAULT 0",
  // v18 — vagas & recrutamento
  "CREATE TABLE IF NOT EXISTS vagas (id INT AUTO_INCREMENT PRIMARY KEY, titulo VARCHAR(120) NOT NULL, area VARCHAR(80) NOT NULL DEFAULT 'Cozinha', tipo VARCHAR(60) NOT NULL DEFAULT 'Tempo inteiro', local VARCHAR(120) NOT NULL DEFAULT 'Chimoio — CAMI''S Eventos', salario VARCHAR(80) NULL, descricao TEXT NULL, requisitos TEXT NULL, oferecemos TEXT NULL, estado VARCHAR(12) NOT NULL DEFAULT 'Aberta', criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)",
  "CREATE TABLE IF NOT EXISTS candidaturas (id INT AUTO_INCREMENT PRIMARY KEY, codigo VARCHAR(12) NOT NULL UNIQUE, vaga_id BIGINT UNSIGNED NOT NULL, nome VARCHAR(160) NOT NULL, telefone VARCHAR(30) NOT NULL, email VARCHAR(120) NULL, idade INT NULL, residencia VARCHAR(120) NULL, experiencia_anos DOUBLE NOT NULL DEFAULT 0, disponibilidade VARCHAR(40) NOT NULL DEFAULT 'Imediata', apresentacao TEXT NULL, cv MEDIUMTEXT NULL, cv_nome VARCHAR(160) NULL, status VARCHAR(20) NOT NULL DEFAULT 'Nova', pontuacao INT NULL, pontuacao_detalhe TEXT NULL, nota_interna VARCHAR(255) NULL, criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, INDEX cand_vaga_idx (vaga_id), INDEX cand_status_idx (status))",
  "CREATE TABLE IF NOT EXISTS vagas_subscritores (id INT AUTO_INCREMENT PRIMARY KEY, nome VARCHAR(160) NOT NULL, contacto VARCHAR(60) NOT NULL, canal VARCHAR(10) NOT NULL DEFAULT 'WhatsApp', criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)",
  // v18b — remover a promessa de refeição no local das vagas iniciais (empresa nova no mercado)
  "UPDATE vagas SET oferecemos = 'Integração numa equipa em crescimento; ambiente de trabalho organizado; oportunidade de assinar o menu de um dos espaços de eventos mais procurados de Chimoio.' WHERE titulo = 'Chef de Cozinha' AND oferecemos LIKE '%refeição no local%'",
  "UPDATE vagas SET oferecemos = 'Formação prática com o nosso Chef; possibilidade de progressão na carreira de cozinha dentro da CAMI''S Eventos.' WHERE titulo = 'Auxiliar de Cozinha' AND oferecemos LIKE '%refeição no local%'",
  // v19 — dívidas de clientes (fiado)
  "ALTER TABLE pedidos ADD divida_gerada DOUBLE NOT NULL DEFAULT 0",
  "CREATE TABLE IF NOT EXISTS dividas (id INT AUTO_INCREMENT PRIMARY KEY, codigo VARCHAR(12) NOT NULL UNIQUE, pedido_id BIGINT UNSIGNED NULL, cliente_nome VARCHAR(160) NOT NULL, cliente_tel VARCHAR(30) NULL, obs VARCHAR(255) NULL, valor_total DOUBLE NOT NULL DEFAULT 0, status VARCHAR(12) NOT NULL DEFAULT 'Aberta', data_dia VARCHAR(10) NOT NULL, criado_por BIGINT UNSIGNED NOT NULL, criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, liquidada_em TIMESTAMP NULL)",
  "CREATE TABLE IF NOT EXISTS dividas_pagamentos (id INT AUTO_INCREMENT PRIMARY KEY, divida_id BIGINT UNSIGNED NOT NULL, valor DOUBLE NOT NULL, metodo VARCHAR(160) NOT NULL, usuario_id BIGINT UNSIGNED NOT NULL, criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)",
  // v20 — contacto do fornecedor nas despesas (dívidas a fornecedores)
  "ALTER TABLE despesas ADD fornecedor_tel VARCHAR(30) NULL",
  // v21 — buffet: pacotes por pessoa editáveis
  "CREATE TABLE IF NOT EXISTS buffet_pacotes (id INT AUTO_INCREMENT PRIMARY KEY, nome VARCHAR(80) NOT NULL, preco DOUBLE NOT NULL, itens JSON NOT NULL, descricao VARCHAR(255) NULL, ativo TINYINT(1) NOT NULL DEFAULT 1, ordem INT NOT NULL DEFAULT 0, criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)",
  // v21b — nomes oficiais dos pacotes
  "UPDATE buffet_pacotes SET nome = 'Buffet Mini' WHERE nome = 'Buffet 600'",
  "UPDATE buffet_pacotes SET nome = 'Buffet Médio' WHERE nome = 'Buffet 800'",
  "UPDATE buffet_pacotes SET nome = 'Buffet Max' WHERE nome = 'Buffet 1200'",
  // v22 — fotos dos pacotes de buffet
  "ALTER TABLE buffet_pacotes ADD foto VARCHAR(120) NULL",
  "UPDATE buffet_pacotes SET foto = '/fotos/buffet-mini.jpg' WHERE nome = 'Buffet Mini' AND foto IS NULL",
  "UPDATE buffet_pacotes SET foto = '/fotos/buffet-medio.jpg' WHERE nome = 'Buffet Médio' AND foto IS NULL",
  "UPDATE buffet_pacotes SET foto = '/fotos/buffet-max.jpg' WHERE nome = 'Buffet Max' AND foto IS NULL",
  // v23 — Recursos Humanos (só Administrador): trabalhadores, presenças, licenças e salários
  "CREATE TABLE IF NOT EXISTS trabalhadores (id INT AUTO_INCREMENT PRIMARY KEY, codigo VARCHAR(12) NOT NULL UNIQUE, nome VARCHAR(160) NOT NULL, telefone VARCHAR(40) NULL, bi_numero VARCHAR(60) NULL, regime VARCHAR(12) NOT NULL DEFAULT 'Permanente', area VARCHAR(12) NOT NULL DEFAULT 'Restaurante', cargo VARCHAR(120) NOT NULL, atividades TEXT NULL, data_inicio VARCHAR(10) NOT NULL, salario_mensal DOUBLE NOT NULL DEFAULT 0, diaria DOUBLE NOT NULL DEFAULT 500, afiliado_id BIGINT UNSIGNED NULL, notas VARCHAR(255) NULL, ativo TINYINT(1) NOT NULL DEFAULT 1, criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)",
  "CREATE TABLE IF NOT EXISTS rh_presencas (id INT AUTO_INCREMENT PRIMARY KEY, trabalhador_id BIGINT UNSIGNED NOT NULL, data_dia VARCHAR(10) NOT NULL, status VARCHAR(10) NOT NULL DEFAULT 'Presente', area VARCHAR(12) NOT NULL DEFAULT 'Restaurante', justificativa VARCHAR(255) NULL, criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, INDEX rhp_trdia_idx (trabalhador_id, data_dia), INDEX rhp_dia_idx (data_dia))",
  "CREATE TABLE IF NOT EXISTS rh_licencas (id INT AUTO_INCREMENT PRIMARY KEY, trabalhador_id BIGINT UNSIGNED NOT NULL, tipo VARCHAR(12) NOT NULL DEFAULT 'Anual', motivo VARCHAR(255) NOT NULL, inicio VARCHAR(10) NOT NULL, fim VARCHAR(10) NOT NULL, criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, INDEX rhl_tr_idx (trabalhador_id))",
  "CREATE TABLE IF NOT EXISTS rh_salario_pagamentos (id INT AUTO_INCREMENT PRIMARY KEY, trabalhador_id BIGINT UNSIGNED NOT NULL, mes_referencia VARCHAR(7) NOT NULL, valor DOUBLE NOT NULL, metodo VARCHAR(60) NULL, obs VARCHAR(255) NULL, pago_por VARCHAR(120) NULL, pago_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, INDEX rhs_trmes_idx (trabalhador_id, mes_referencia))",  // v24 — Reserva Buffet: ligação da reserva ao pedido online de origem
  "ALTER TABLE reservas ADD online_id BIGINT UNSIGNED NULL",
  // v25 — desconto combinado na reserva (MZN)
  "ALTER TABLE reservas ADD desconto DOUBLE NOT NULL DEFAULT 0",
];


/* ============ MENUS DO CHEFE 2026 — 4 pacotes de buffet por pessoa ============
   Menu organizado por secções (categorias); «itens» é a lista plana derivada
   (usada em recibos, pedidos e notificações). */
const MENUS_CHEFE: {
  nome: string; preco: number; ordem: number; foto: string; descricao: string;
  categorias: { nome: string; itens: string[] }[];
}[] = [
  {
    nome: "Menu de 1200", preco: 1200, ordem: 1, foto: "/fotos/menu-1200.jpg",
    descricao: "O essencial da casa, com sabor a festa",
    categorias: [
      { nome: "Entradas", itens: ["Rissóis", "Chamussas"] },
      { nome: "Pratos principais", itens: ["Feijoada com todos", "Galinha cafreal à água e sal"] },
      { nome: "Guarnições", itens: ["Arroz branco", "Arroz de cenoura e legumes", "Xima", "Legumes salteados", "Batata frita"] },
      { nome: "Saladas", itens: ["Salada russa", "Salada mista"] },
      { nome: "Sobremesas", itens: ["Mousse de malambe"] },
    ],
  },
  {
    nome: "Menu de 1500", preco: 1500, ordem: 2, foto: "/fotos/menu-1500.jpg",
    descricao: "Mais variedade à mesa — do mar à terra",
    categorias: [
      { nome: "Entradas", itens: ["Chamussas", "Spring rolls"] },
      { nome: "Pratos principais", itens: ["Frango grelhado", "Peixe serra em postas", "Guisado de vaca", "Bife assado na panela"] },
      { nome: "Guarnições", itens: ["Arroz de legumes", "Arroz de cebola", "Xima", "Batata dourada"] },
      { nome: "Saladas", itens: ["Salada de massa espiral", "Salada de pepino"] },
      { nome: "Sobremesas", itens: ["Fruta à limonada"] },
    ],
  },
  {
    nome: "Menu de 1800", preco: 1800, ordem: 3, foto: "/fotos/menu-1800.jpg",
    descricao: "O favorito das grandes celebrações",
    categorias: [
      { nome: "Entradas", itens: ["Coxinhas", "Chamussas"] },
      { nome: "Pratos principais", itens: ["Frango grelhado", "Peixe vermelhão", "Guisado de cabrito", "Lombo com legumes", "Matapa com camarão"] },
      { nome: "Guarnições", itens: ["Arroz malandro", "Arroz de tomate", "Xima", "Batata ao murro", "Batata frita", "Maionese com atum"] },
      { nome: "Saladas", itens: ["Salada de feijão-preto mista", "Salada de beterraba"] },
      { nome: "Sobremesas", itens: ["Salada de frutas"] },
    ],
  },
  {
    nome: "Menu de 2500", preco: 2500, ordem: 4, foto: "/fotos/menu-2500.jpg",
    descricao: "A experiência completa do Chefe — o melhor da casa",
    categorias: [
      { nome: "Entradas", itens: ["Spring rolls", "Chamussas"] },
      { nome: "Pratos principais", itens: ["Frango grelhado", "Lulas grelhadas", "Camarão frito", "Coelho na brasa", "Matapa com camarão", "Galinha cafreal à zambeziana", "Cafreal à água e sal"] },
      { nome: "Guarnições", itens: ["Arroz de pato", "Arroz branco", "Arroz malandro", "Xima", "Legumes", "Batata frita"] },
      { nome: "Saladas", itens: ["Salada mista", "Salada de alface", "Salada de massa espiral"] },
      { nome: "Sobremesas", itens: ["Mousse de malambe", "Sorvete"] },
    ],
  },
];
const menusChefeValores = () =>
  MENUS_CHEFE.map((m) => ({
    nome: m.nome, preco: m.preco, ordem: m.ordem, foto: m.foto, descricao: m.descricao,
    categorias: m.categorias,
    itens: m.categorias.flatMap((c) => c.itens),
  }));

export async function autoMigrate(): Promise<void> {
  const db = getDb();
  for (const a of AUTO_MIGRATIONS) {
    try { await db.execute(sql.raw(a)); console.log("[auto-migrate] OK:", a.slice(0, 72)); }
    catch (e) {
      const msg = (e as Error)?.message ?? "";
      if (/duplicate|exists/i.test(msg)) continue; // coluna já existe — ignorado
      console.error("[auto-migrate] FALHOU:", a.slice(0, 72), "—", msg.slice(0, 200));
    }
  }
}

const here = dirname(fileURLToPath(import.meta.url));

export async function autoSeed(): Promise<void> {
  try {
    const db = getDb();

    const us = await db.query.usuarios.findMany();
    if (us.length === 0) {
      await db.insert(usuarios).values([
        { nome: "Administrador", perfil: "Admin", pin: "1234" },
        { nome: "Gerente", perfil: "Gestor", pin: "2345" },
        { nome: "Vendedor 1", perfil: "Vendedor", pin: "3456" },
      ]);
      console.log("[auto-seed] ✔ 3 utilizadores criados (Administrador/1234 · Gerente/2345 · Vendedor 1/3456)");
    }

    const ps = await db.query.produtos.findMany({ limit: 1 });
    if (ps.length === 0) {
      const data = JSON.parse(readFileSync(join(here, "../db/seed-data.json"), "utf-8")) as unknown[];
      const CHUNK = 50;
      for (let i = 0; i < data.length; i += CHUNK) {
        await db.insert(produtos).values(data.slice(i, i + CHUNK) as never[]);
      }
      console.log(`[auto-seed] ✔ ${data.length} produtos inseridos`);
    }

    const cs = await db.query.contadores.findMany({ limit: 1 });
    if (cs.length === 0) {
      await db.insert(contadores).values([
        { chave: "reserva", valor: 0 },
        { chave: "piscina", valor: 0 },
        { chave: "pagamento", valor: 0 },
      ]);
      console.log("[auto-seed] ✔ contadores criados");
    }

    // v18 — vagas iniciais de cozinha (só se a tabela estiver vazia)
    try {
      const vs = await db.select({ id: vagas.id }).from(vagas).limit(1);
      if (vs.length === 0) {
        await db.insert(vagas).values([
          {
            titulo: "Chef de Cozinha",
            area: "Cozinha",
            tipo: "Tempo inteiro",
            local: "Chimoio — CAMI'S Eventos",
            salario: "A combinar (conforme experiência)",
            descricao: "Liderar a cozinha da CAMI'S Eventos: planear e executar o menu do restaurante e dos eventos (casamentos, baptizados, conferências), garantir a qualidade e a apresentação dos pratos, gerir a equipa de cozinha, controlar porções e desperdício, e assegurar as normas de higiene e segurança alimentar.",
            requisitos: "Experiência comprovada como Chef ou Sub-chef (mín. 3 anos); domínio da cozinha moçambicana e internacional; capacidade de liderança e de trabalho sob pressão em eventos de grande dimensão; noções de gestão de custos (CMV) e de stock; higiene e organização exemplares; disponibilidade para fins de semana e feriados; residir em Chimoio ou arredores.",
            oferecemos: "Integração numa equipa em crescimento; ambiente de trabalho organizado; oportunidade de assinar o menu de um dos espaços de eventos mais procurados de Chimoio.",
          },
          {
            titulo: "Auxiliar de Cozinha",
            area: "Cozinha",
            tipo: "Tempo inteiro",
            local: "Chimoio — CAMI'S Eventos",
            salario: "A combinar",
            descricao: "Apoiar o Chef na mise en place (lavar, cortar e preparar ingredientes), ajudar na confecção e empratamento durante o serviço do restaurante e dos eventos, manter a cozinha limpa e organizada, e apoiar na recepção e arrumação de mercadorias.",
            requisitos: "Experiência anterior em cozinha é valorizada mas NÃO é obrigatória — valorizamos vontade de aprender; higiene pessoal e organização; rapidez e resistência para dias de evento; pontualidade e espírito de equipa; disponibilidade para fins de semana e feriados; residir em Chimoio ou arredores.",
            oferecemos: "Formação prática com o nosso Chef; possibilidade de progressão na carreira de cozinha dentro da CAMI'S Eventos.",
          },
        ]);
        console.log("[auto-seed] ✔ 2 vagas iniciais criadas (Chef de Cozinha, Auxiliar de Cozinha)");
      }
    } catch (e) {
      console.warn("[auto-seed] vagas ignorado:", (e as Error).message?.slice(0, 120));
    }

    // v21/v36 — pacotes de buffet iniciais (só se a tabela estiver vazia): os 4 Menus do Chefe 2026
    try {
      const bp = await db.select({ id: buffetPacotes.id }).from(buffetPacotes).limit(1);
      if (bp.length === 0) {
        await db.insert(buffetPacotes).values(menusChefeValores());
        console.log("[auto-seed] ✔ 4 Menus do Chefe criados (1200 / 1500 / 1800 / 2500 MZN)");
      }
    } catch (e) {
      console.warn("[auto-seed] buffet ignorado:", (e as Error).message?.slice(0, 120));
    }

    // v36 — Menus do Chefe 2026: desactiva os pacotes antigos e cria os 4 menus por secções
    try {
      const jaExiste = await db.select({ id: buffetPacotes.id }).from(buffetPacotes)
        .where(like(buffetPacotes.nome, "Menu de %")).limit(1);
      if (jaExiste.length === 0) {
        await db.update(buffetPacotes).set({ ativo: false })
          .where(inArray(buffetPacotes.nome, ["Buffet Mini", "Buffet Médio", "Buffet Max", "Buffet 600", "Buffet 800", "Buffet 1200"]));
        await db.delete(buffetPacotes).where(like(buffetPacotes.nome, "Menu de %")); // segurança
        await db.insert(buffetPacotes).values(menusChefeValores());
        console.log("[auto-seed] ✔ Menus do Chefe 2026 activos (pacotes antigos desactivados)");
      }
    } catch (e) {
      console.warn("[auto-seed] buffet ignorado:", (e as Error).message?.slice(0, 120));
    }
  } catch (e) {
    console.warn("[auto-seed] ignorado (BD indisponível ou já populada):", (e as Error).message);
  }
}
