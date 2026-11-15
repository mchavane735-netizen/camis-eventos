import { z } from "zod";
import { createHash, randomBytes } from "crypto";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { createRouter, publicQuery } from "./middleware";
import { getDb } from "./queries/connection";
import {
  avaliacoes, clientes, clienteTokens, contadores, notificacoes, pagamentos, pedidosOnline,
  produtos, stockMov, usuarios, type DocItem, type ExtraOnline, type PropostaOnline,
} from "@db/schema";
import { afiliadoPorCodigo, leadProtegido, lancarComissao, estornarComissoes } from "./afiliados";
import { TAXA_RESERVA_PESSOA, LOJA_DESCONTO_PCT, braaiRotulo, braaiTaxaPessoa, taxaReservaPessoa, type EmpresaCfg } from "@contracts/types";
import { buffetPacotes, reservas } from "@db/schema";
import { getEmpresa, getEstadoEstab, getDeliveryHorario, getHorarios, baixarStockProduto, reporStockProduto } from "./camis3";

/* ---------- helpers ---------- */
async function requirePerfil(userId: number, perfis: string[]) {
  const u = await getDb().query.usuarios.findFirst({ where: eq(usuarios.id, userId) });
  if (!u || !u.ativo) throw new TRPCError({ code: "UNAUTHORIZED", message: "Utilizador inválido" });
  if (!perfis.includes(u.perfil))
    throw new TRPCError({ code: "FORBIDDEN", message: "Ação reservada a: " + perfis.join(", ") });
  return u;
}

async function nextCodigo(chave: string, prefix: string) {
  const db = getDb();
  await db
    .insert(contadores)
    .values({ chave, valor: 1 })
    .onDuplicateKeyUpdate({ set: { valor: sql`${contadores.valor} + 1` } });
  const c = await db.query.contadores.findFirst({ where: eq(contadores.chave, chave) });
  return prefix + String(c?.valor ?? 1).padStart(4, "0");
}

/** Janela T-6h da reserva: abre 6h antes da data/hora marcada (sem hora → abre às 08:00 desse dia).
    Hora de Moçambique = UTC+2. */
function janelaT6hAberta(dataAgendada: string | null, horaAgendada: string | null): boolean {
  if (!dataAgendada) return false;
  const [y, m, d] = dataAgendada.split("-").map(Number);
  const [hh, mm] = (horaAgendada || "08:00").split(":").map(Number);
  const alvoMs = Date.UTC(y, m - 1, d, hh - 2, mm); // converter MZ (UTC+2) para UTC
  if (!horaAgendada) return Date.now() >= alvoMs; // sem hora: abre às 08:00 desse dia
  return Date.now() >= alvoMs - 6 * 3600e3 && Date.now() <= alvoMs + 12 * 3600e3;
}

const hashSenha = (senha: string, tel: string) =>
  createHash("sha256").update(`camis:${tel}:${senha}`).digest("hex");

async function clientePorToken(token: string) {
  const t = await getDb().query.clienteTokens.findFirst({ where: eq(clienteTokens.token, token) });
  if (!t) return null;
  return getDb().query.clientes.findFirst({ where: eq(clientes.id, t.clienteId) }) ?? null;
}

/** Normaliza telefone moçambicano para wa.me (258XXXXXXXXX) */
export function telWa(tel: string) {
  const d = tel.replace(/\D/g, "");
  if (d.startsWith("258")) return d;
  if (d.length === 9 && d.startsWith("8")) return "258" + d;
  return d;
}

/** Hora actual em Moçambique (UTC+2), HH:MM */
function horaMZ(d = new Date()) {
  const m = new Date(d.getTime() + 2 * 3600e3);
  return m.toISOString().slice(11, 16);
}

const CATS_SEM_DELIVERY = ["Piscina & Parque", "Piscina", "Parque", "Salão"];

/** true se o pedido tem itens especiais (✳️) por cotar ou à espera da resposta do cliente */
function extrasPendentes(p: { extras: ExtraOnline[] | null }) {
  return (p.extras ?? []).some((e) => !e.cotado || e.aceite == null);
}

/** true se há uma proposta do restaurante à espera da resposta do cliente */
function propostaPendente(p: { proposta: PropostaOnline | null }) {
  return !!p.proposta && !p.proposta.respondidaEm;
}

/** Nome do item de menu gerado a partir de um extra aceite (para anexar/remover do pedido) */
function nomeExtra(e: ExtraOnline) {
  return `✳️ ${e.descricao}${e.detalhes ? ` (${e.detalhes})` : ""}`;
}

/* ============================================================
   LOJA ONLINE — lado público (cliente, sem PIN)
   ============================================================ */
export const lojaRouter = createRouter({
  /** Menu público com fotos. Delivery exclui Piscina & Parque e Salão. */
  menu: publicQuery
    .input(z.object({ tipo: z.enum(["Local", "Delivery", "TakeAway", "Reserva"]).default("Local") }))
    .query(async ({ input }) => {
      const lista = await getDb().select({
        id: produtos.id, codigo: produtos.codigo, nome: produtos.nome,
        categoria: produtos.categoria, tipo: produtos.tipo, preco: produtos.preco, foto: produtos.foto,
        ingredientes: produtos.ingredientes,
      }).from(produtos).where(eq(produtos.ativo, true)).orderBy(produtos.categoria, produtos.nome);
      if (input.tipo === "Delivery")
        return lista.filter((p) => !CATS_SEM_DELIVERY.includes(p.categoria));
      return lista;
    }),

  /** Dados públicos da empresa (pagamento, contactos) */
  empresa: publicQuery.query(() => getEmpresa()),

  /** Cadastro opcional do cliente (nome, telefone WhatsApp, email, password) */
  registo: publicQuery
    .input(z.object({
      nome: z.string().min(2).max(160),
      telefone: z.string().min(9).max(30),
      email: z.string().email().max(160).optional().or(z.literal("")),
      senha: z.string().min(4).max(60),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const tel = input.telefone.replace(/\s+/g, " ").trim();
      const existe = await db.query.clientes.findFirst({ where: eq(clientes.telefone, tel) });
      if (existe) throw new TRPCError({ code: "CONFLICT", message: "Este telefone já está registado. Faça login." });
      const [{ id }] = await db.insert(clientes).values({
        nome: input.nome.trim(), telefone: tel,
        email: input.email || null, senhaHash: hashSenha(input.senha, tel),
      }).$returningId();
      const token = randomBytes(24).toString("hex");
      await db.insert(clienteTokens).values({ token, clienteId: id });
      return { token, cliente: { id, nome: input.nome.trim(), telefone: tel, email: input.email || null } };
    }),

  login: publicQuery
    .input(z.object({ telefone: z.string().min(9), senha: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const tel = input.telefone.replace(/\s+/g, " ").trim();
      const c = await db.query.clientes.findFirst({ where: eq(clientes.telefone, tel) });
      if (c?.bloqueado)
        throw new TRPCError({ code: "FORBIDDEN", message: "🔒 Conta bloqueada após 3 tentativas falhadas. Use «Esqueci a senha» para definir uma nova senha." });
      if (!c || c.senhaHash !== hashSenha(input.senha, tel)) {
        if (c) {
          const n = c.tentativas + 1;
          await db.update(clientes).set({ tentativas: n, bloqueado: n >= 3 }).where(eq(clientes.id, c.id));
          if (n >= 3)
            throw new TRPCError({ code: "FORBIDDEN", message: "🔒 Conta bloqueada após 3 tentativas falhadas. Use «Esqueci a senha» para definir uma nova senha." });
        }
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Telefone ou senha incorrectos" });
      }
      if (c.tentativas > 0)
        await db.update(clientes).set({ tentativas: 0 }).where(eq(clientes.id, c.id));
      const token = randomBytes(24).toString("hex");
      await db.insert(clienteTokens).values({ token, clienteId: c.id });
      return { token, cliente: { id: c.id, nome: c.nome, telefone: c.telefone, email: c.email } };
    }),

  /** Recuperação de senha: cliente confirma identidade com telefone + email e define nova senha */
  recuperarSenha: publicQuery
    .input(z.object({
      telefone: z.string().min(9),
      email: z.string().email().max(160),
      senhaNova: z.string().min(4).max(60),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const tel = input.telefone.replace(/\s+/g, " ").trim();
      const c = await db.query.clientes.findFirst({ where: eq(clientes.telefone, tel) });
      if (!c || !c.email || c.email.toLowerCase() !== input.email.trim().toLowerCase())
        throw new TRPCError({ code: "BAD_REQUEST", message: "O telefone e o email não correspondem a nenhuma conta. Se não registou email, contacte o restaurante." });
      await db.update(clientes)
        .set({ senhaHash: hashSenha(input.senhaNova, tel), tentativas: 0, bloqueado: false })
        .where(eq(clientes.id, c.id));
      return { ok: true };
    }),

  me: publicQuery
    .input(z.object({ token: z.string() }))
    .query(async ({ input }) => {
      const c = await clientePorToken(input.token);
      if (!c) return null;
      return { id: c.id, nome: c.nome, telefone: c.telefone, email: c.email };
    }),

  sair: publicQuery
    .input(z.object({ token: z.string() }))
    .mutation(async ({ input }) => {
      await getDb().delete(clienteTokens).where(eq(clienteTokens.token, input.token));
      return { ok: true };
    }),

  /** Histórico de pedidos do cliente registado */
  historico: publicQuery
    .input(z.object({ token: z.string() }))
    .query(async ({ input }) => {
      const c = await clientePorToken(input.token);
      if (!c) throw new TRPCError({ code: "UNAUTHORIZED", message: "Sessão expirada. Faça login de novo." });
      return getDb().select({
        id: pedidosOnline.id, codigo: pedidosOnline.codigo, tipo: pedidosOnline.tipo,
        total: pedidosOnline.total, status: pedidosOnline.status, criadoEm: pedidosOnline.criadoEm,
        mesa: pedidosOnline.mesa, dataAgendada: pedidosOnline.dataAgendada,
      }).from(pedidosOnline).where(eq(pedidosOnline.clienteTelefone, c.telefone))
        .orderBy(desc(pedidosOnline.criadoEm));
    }),

  /** Cria um pedido online — fica "Pendente" até o cliente enviar o comprovativo */
  criarPedido: publicQuery
    .input(z.object({
      token: z.string().optional(),
      clienteNome: z.string().min(2).max(160),
      clienteTelefone: z.string().min(9).max(30),
      tipo: z.enum(["Local", "Delivery", "TakeAway", "Reserva"]),
      mesa: z.string().max(20).optional(),
      endereco: z.string().max(400).optional(),
      lat: z.number().min(-90).max(90).optional(),
      lng: z.number().min(-180).max(180).optional(),
      dataAgendada: z.string().length(10).optional(),
      horaAgendada: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
      pessoas: z.number().int().min(1).max(500).optional(),
      area: z.string().max(80).optional(), // reserva: espaço onde o cliente pretende sentar (obrigatório)
      buffetPacoteId: z.number().int().positive().optional(), // reserva com buffet: pacote escolhido (preço/pessoa)
      adiantValor: z.number().min(0).optional(),
      /* --- braai online (taxa NÃO consumível, paga 100% antecipado) --- */
      braaiModalidade: z.enum(["A", "B"]).optional(),
      braaiTraz: z.enum(["Comida", "Bebidas"]).optional(),
      criancasMenores: z.number().int().min(0).max(200).optional(),
      itens: z.array(z.object({ produtoId: z.number().int().positive(), qtd: z.number().int().min(1).max(99), obs: z.string().max(255).optional() })).default([]),
      // pedidos adicionais fora do menu (ex.: "bolo de aniversário") — SEM preço:
      // o restaurante cota e o cliente aceita antes de pagar
      extras: z.array(z.object({
        descricao: z.string().min(2).max(255),
        detalhes: z.string().max(500).optional(),
        qtd: z.number().int().min(1).max(99).default(1),
      })).max(10).default([]),
      afiliadoCodigo: z.string().max(12).optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const emp = await getEmpresa();
      const ehBraai = !!input.braaiModalidade;

      if (input.tipo !== "Reserva" && input.itens.length + input.extras.length === 0)
        throw new TRPCError({ code: "BAD_REQUEST", message: "O pedido precisa de pelo menos um item" });
      // braai online = reserva com taxa NÃO consumível — regras próprias
      if (ehBraai && input.tipo !== "Reserva")
        throw new TRPCError({ code: "BAD_REQUEST", message: "O braai é um tipo de reserva." });
      if (ehBraai) {
        if (input.braaiModalidade === "B" && !input.braaiTraz)
          throw new TRPCError({ code: "BAD_REQUEST", message: "Indique o que vai trazer: só comida ou só bebidas." });
        if (!input.horaAgendada)
          throw new TRPCError({ code: "BAD_REQUEST", message: "Indique a hora de entrada — a taxa de braai dá direito a 5 horas de uso do espaço." });
      }
      // reserva = garantia de mesa por número de pessoas (400 MZN/pessoa);
      // os pratos são escolhidos NO LOCAL, no dia do consumo — não entram aqui
      if (input.tipo === "Reserva" && !input.pessoas)
        throw new TRPCError({ code: "BAD_REQUEST", message: "Indique o número de pessoas da reserva" });
      if (input.tipo === "Reserva" && !input.dataAgendada)
        throw new TRPCError({ code: "BAD_REQUEST", message: "Indique a data do evento para a reserva" });
      if (input.tipo === "Reserva" && !input.area)
        throw new TRPCError({ code: "BAD_REQUEST", message: "Seleccione o espaço onde pretende sentar (ex.: Jardim, Salão Rés-do-chão, Área da Piscina…)" });
      if (input.tipo === "Reserva" && input.itens.length > 0)
        throw new TRPCError({ code: "BAD_REQUEST", message: "Na reserva online os pratos são escolhidos no local, no dia do consumo" });

      // valida produtos e calcula totais com os preços da base de dados
      const itens: DocItem[] = [];
      for (const it of input.itens) {
        const p = await db.query.produtos.findFirst({ where: eq(produtos.id, it.produtoId) });
        if (!p || !p.ativo) throw new TRPCError({ code: "BAD_REQUEST", message: `Produto indisponível (id ${it.produtoId})` });
        if (input.tipo === "Delivery" && CATS_SEM_DELIVERY.includes(p.categoria))
          throw new TRPCError({ code: "BAD_REQUEST", message: `«${p.nome}» não está disponível para Delivery` });
        itens.push({
          nome: p.nome, qtd: it.qtd, precoUnit: p.preco,
          total: Math.round(it.qtd * p.preco * 100) / 100,
          ...(it.obs ? { obs: it.obs } : {}),
        });
      }
      // itens especiais ficam FORA do total até serem cotados pelo restaurante e aceites pelo cliente
      const extras: ExtraOnline[] = input.extras.map((ex) => ({
        descricao: ex.descricao.trim(), detalhes: ex.detalhes?.trim() || undefined,
        qtd: ex.qtd, preco: 0, cotado: false, aceite: null,
      }));
      // RESERVA: garantia de mesa = nº de pessoas × taxa; depósito flexível (recomendado: 50%, consumível).
      // Item simbólico 🎟 sem produto — não mexe no stock.
      if (input.tipo === "Reserva" && !ehBraai) {
        const nPess = input.pessoas!;
        if (input.buffetPacoteId) {
          // RESERVA COM BUFFET: o menu é o pacote escolhido (preço por pessoa) — item simbólico, sem stock
          const pac = await db.query.buffetPacotes.findFirst({ where: eq(buffetPacotes.id, input.buffetPacoteId) });
          if (!pac || !pac.ativo)
            throw new TRPCError({ code: "BAD_REQUEST", message: "Pacote de buffet indisponível." });
          itens.push({
            nome: `🍽 ${pac.nome} — ${nPess} pessoa${nPess > 1 ? "s" : ""} · 🪑 ${input.area} (${pac.itens.join(", ")})`,
            qtd: nPess, precoUnit: pac.preco,
            total: Math.round(nPess * pac.preco * 100) / 100,
          });
        } else {
          const taxaRes = taxaReservaPessoa(input.area); // Salão 1.º andar: 500; outros: 400
          itens.push({
            nome: `🎟 Reserva — ${nPess} pessoa${nPess > 1 ? "s" : ""} · 🪑 ${input.area} (pratos escolhidos no local, no dia do consumo)`,
            qtd: nPess, precoUnit: taxaRes,
            total: Math.round(nPess * taxaRes * 100) / 100,
          });
        }
      }
      // BRAAI: taxa NÃO consumível (uso do espaço, mesas, cadeiras e água) — 5 horas,
      // utensílios/ingredientes/carvão são do cliente; assadura sempre fora, no espaço
      // indicado pela equipa; crianças até 9 anos não pagam; piscina e parque à parte.
      if (ehBraai) {
        const nPess = input.pessoas!;
        const taxa = braaiTaxaPessoa(input.braaiModalidade!, nPess);
        itens.push({
          nome: `🔥 ${braaiRotulo(input.braaiModalidade!, input.braaiTraz ?? null)} — ${nPess} pagante${nPess > 1 ? "s" : ""} (10+ anos)${input.criancasMenores ? ` · ${input.criancasMenores} criança${input.criancasMenores > 1 ? "s" : ""} até 9 anos (grátis)` : ""} · 🪑 ${input.area} · entrada às ${input.horaAgendada} (5 horas)`,
          qtd: nPess, precoUnit: taxa,
          total: Math.round(nPess * taxa * 100) / 100,
        });
      }
      const subtotal = Math.round(itens.reduce((a, i) => a + i.total, 0) * 100) / 100;
      // taxa de entrega: mínimo 100 MZN; o restaurante define o valor final conforme o local.
      // É PAGA AO ENTREGADOR na entrega — NÃO entra no total a pagar ao restaurante.
      const taxaEntrega = input.tipo === "Delivery" ? Math.max(100, parseFloat(emp.taxaDelivery) || 100) : 0;
      // desconto de cliente online: SÓ com código de afiliado VÁLIDO (já não é automático).
      // A taxa de braai NUNCA tem desconto — não é consumo, é uso do espaço.
      const af = await afiliadoPorCodigo(input.afiliadoCodigo);
      const total = ehBraai || !af ? subtotal : Math.round(subtotal * (1 - LOJA_DESCONTO_PCT / 100) * 100) / 100;
      // braai online: pagamento INTEGRAL (100%) antecipado — sem depósito parcial
      const adiant = ehBraai ? total
        : input.tipo === "Reserva"
          ? (input.adiantValor != null && input.adiantValor > 0
              ? Math.min(total, Math.round(input.adiantValor * 100) / 100)
              : Math.round(total * 0.5 * 100) / 100)
          : 0;
      // reserva online: depósito mínimo de 50% (pronto pagamento para os outros tipos)
      if (input.tipo === "Reserva" && !ehBraai && adiant < Math.round(total * 0.5 * 100) / 100 - 0.01)
        throw new TRPCError({ code: "BAD_REQUEST", message: `Na loja online o depósito mínimo da reserva é 50% (${Math.round(total * 0.5 * 100) / 100} MZN).` });

      // estabelecimento FECHADO (declarado pela equipa) → rejeita todos os pedidos online
      const est = await getEstadoEstab();
      if (est.estado === "fechado")
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `🔴 De momento o estabelecimento encontra-se FECHADO e não estamos a aceitar pedidos online. Por favor, tente mais tarde ou ligue ${emp.tel1}. Obrigado pela compreensão!`,
        });

      // delivery e take away: limites de horário (modo automático) — se a equipa
      // declarar "aberto", aceita-se fora do limite enquanto não declararem o fecho
      if ((input.tipo === "Delivery" || input.tipo === "TakeAway") && est.estado !== "aberto") {
        const agora = new Date(Date.now() + 2 * 3600e3); // hora de Moçambique
        const dow = agora.getUTCDay(); // 0 = domingo
        const horarios = await getHorarios();
        const hoje = horarios[(dow + 6) % 7]; // HORARIOS começa na segunda-feira
        const rotulo = input.tipo === "Delivery" ? "🛵 entregas ao domicílio" : "🥡 pedidos Take Away";
        if (hoje && !hoje.aberto)
          throw new TRPCError({ code: "BAD_REQUEST", message: `Hoje não fazemos ${rotulo}. Pode fazer o pedido para consumir no local. Obrigado!` });
        const hm = agora.toISOString().slice(11, 16);
        if (hoje && (hm < hoje.abre || hm > hoje.fecha))
          throw new TRPCError({ code: "BAD_REQUEST", message: `Estamos fora do horário de funcionamento (hoje: ${hoje.abre} – ${hoje.fecha}). Pode deixar o pedido dentro do horário. Obrigado!` });
        const dh = await getDeliveryHorario();
        const fimSemana = dow === 0 || dow === 6;
        const limite = fimSemana ? dh.fimSemana : dh.semana;
        if (hm > limite)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `${input.tipo === "Delivery" ? "🛵" : "🥡"} Os pedidos de ${input.tipo === "Delivery" ? "delivery" : "take away"} são aceites até às ${limite} (${fimSemana ? "sábados e domingos" : "de terça a sexta"}). Pode fazer o pedido para consumir no local. Obrigado!`,
          });
      }

      let clienteId: number | null = null;
      let email: string | null = null;
      if (input.token) {
        const c = await clientePorToken(input.token);
        if (c) { clienteId = c.id; email = c.email; }
      }
      const codigo = await nextCodigo("online", "OL-");
      await db.insert(pedidosOnline).values({
        codigo, clienteId,
        clienteNome: input.clienteNome.trim(), clienteTelefone: input.clienteTelefone.trim(), clienteEmail: email,
        tipo: input.tipo, mesa: input.mesa || null, endereco: input.endereco || null,
        lat: input.lat ?? null, lng: input.lng ?? null,
        dataAgendada: input.dataAgendada || null,
        horaAgendada: input.horaAgendada || null, pessoas: input.pessoas ?? null,
        area: input.tipo === "Reserva" ? (input.area || null) : null,
        itens, subtotal, taxaEntrega, total, adiant,
        extras: extras.length ? extras : null,
        afiliadoId: af?.id ?? null,
        braaiModalidade: ehBraai ? input.braaiModalidade! : null,
        braaiTraz: ehBraai && input.braaiModalidade === "B" ? input.braaiTraz! : null,
        criancasMenores: ehBraai ? (input.criancasMenores ?? 0) : 0,
      });
      // notificação inicial com os números de pagamento (visível na página do pedido)
      {
        const emp0 = await getEmpresa();
        const novo = await db.query.pedidosOnline.findFirst({ where: eq(pedidosOnline.codigo, codigo) });
        const valor = input.tipo === "Reserva" && adiant > 0 ? adiant : total;
        const notaTaxa = input.tipo === "Delivery"
          ? ` 🛵 A taxa de entrega é de pelo menos ${taxaEntrega.toFixed(2)} MZN — o restaurante confirma o valor final conforme o seu local ANTES do pedido sair, e a taxa é paga directamente ao entregador na entrega (não faz parte do valor do pedido).`
          : "";
        const pacBuf = input.buffetPacoteId
          ? await db.query.buffetPacotes.findFirst({ where: eq(buffetPacotes.id, input.buffetPacoteId) })
          : null;
        const msgReserva = pacBuf
          ? `🍽 ${emp0.nome}: O seu pedido de BUFFET ${codigo} foi registado — pacote ${pacBuf.nome} (${pacBuf.preco.toFixed(2)} MZN/pessoa) para ${input.pessoas} pessoa${(input.pessoas ?? 1) > 1 ? "s" : ""}, no dia ${input.dataAgendada}${input.horaAgendada ? " às " + input.horaAgendada : ""} (🪑 ${input.area}). Menu do pacote: ${pacBuf.itens.join(", ")}. TOTAL: ${total.toFixed(2)} MZN. Pague agora o ADIANTAMENTO de ${adiant.toFixed(2)} MZN${total > 0 ? ` (${Math.round((adiant / total) * 100)}% do total)` : ""} (consumível) por Transferência eMola ${emp0.emola} (Titular: ${emp0.titular}), Código de Levantamento eMola ${(emp0 as any).emolaLev ?? ""} ou transferência FNB (Titular: ${emp0.beneficiario}). A nossa equipa confirma o buffet após o adiantamento e a reserva aparece na nossa página de Reservas como «Reserva Buffet». ${adiant < total - 0.009 ? `⏰ ATENÇÃO: o remanescente de ${(total - adiant).toFixed(2)} MZN deve ser liquidado até 48 HORAS antes do evento — sob pena de NÃO ABERTURA da mesa. ` : "Pagamento integral — obrigado pela confiança! "}Faltando 6h para o evento, poderá confirmar a sua vinda e ACRESCENTAR outros produtos da casa (bebidas, sobremesas…) nesta página — pagos no local, no dia. Obrigado!`
          : ehBraai
          ? `🔥 ${emp0.nome}: A sua reserva de BRAAI ${codigo} foi registada — ${braaiRotulo(input.braaiModalidade!, input.braaiTraz ?? null)}, ${input.pessoas} pagante${(input.pessoas ?? 1) > 1 ? "s" : ""} (10+ anos)${input.criancasMenores ? ` + ${input.criancasMenores} criança${input.criancasMenores > 1 ? "s" : ""} até 9 anos (grátis)` : ""}, no dia ${input.dataAgendada} com entrada às ${input.horaAgendada} (direito a 5 horas de uso do espaço, 🪑 ${input.area}). TOTAL: ${total.toFixed(2)} MZN — taxa NÃO consumível, paga 100% antecipadamente: Transferência eMola ${emp0.emola} (Titular: ${emp0.titular}), Código de Levantamento eMola ${(emp0 as any).emolaLev ?? ""} ou transferência FNB (Titular: ${emp0.beneficiario}). A taxa cobre espaço, mesas, cadeiras e água; NÃO inclui utensílios, ingredientes nem carvão (pode trazer o seu fogão/grelhador). A assadura é feita fora, no espaço indicado pela nossa equipa. Bebidas trazidas: máx. 3 por pessoa e apenas as que não vendemos/temos em stock; whisky ou vinho: apenas 1 garrafa por cada 10 pessoas. A taxa não inclui piscina nem parque infantil (pagos à parte). Na entrada, a nossa equipa confirma o que foi efectivamente trazido. Obrigado!`
          : input.tipo === "Reserva"
          ? `🎟 ${emp0.nome}: A sua reserva ${codigo} para ${input.pessoas} pessoa${(input.pessoas ?? 1) > 1 ? "s" : ""} no dia ${input.dataAgendada}${input.horaAgendada ? " às " + input.horaAgendada : ""} (🪑 ${input.area}) foi registada (${total.toFixed(2)} MZN = ${input.pessoas} × ${taxaReservaPessoa(input.area)} MZN). Pague o DEPÓSITO de ${adiant.toFixed(2)} MZN (consumível no local) por Transferência eMola ${emp0.emola} (Titular: ${emp0.titular}), Código de Levantamento eMola ${(emp0 as any).emolaLev ?? ""} ou transferência FNB (Titular: ${emp0.beneficiario}). A escolha dos pratos será feita no local, no dia do consumo. Faltando 6h para a reserva, poderá confirmar a sua vinda e pré-seleccionar os pratos nesta página.`
          : null;
        const msgPag = msgReserva ?? (extras.length
          ? `📋 ${emp0.nome}: O seu pedido ${codigo} foi registado e aguarda a cotação dos itens especiais (✳️). Depois de aceitar a cotação, pague por e-Mola ${emp0.emola} (Titular: ${emp0.titular}), Código de Levantamento e-Mola ${(emp0 as any).emolaLev ?? ""} (Titular: ${(emp0 as any).emolaLevTitular ?? ""}) ou transferência FNB (Titular: ${emp0.beneficiario}).${notaTaxa}`
          : `💳 ${emp0.nome}: O seu pedido ${codigo} foi registado (${valor.toFixed(2)} MZN). Pague por Transferência eMola ${emp0.emola} (Titular: ${emp0.titular}), Código de Levantamento eMola ${(emp0 as any).emolaLev ?? ""} (Titular: ${(emp0 as any).emolaLevTitular ?? ""}) ou transferência FNB (Titular: ${emp0.beneficiario}) — depois de transferir, contacte 87 458 9150 para flexibilizar a confirmação — ou em dinheiro no local. Depois confirme na página do pedido.${notaTaxa}`);
        if (novo) await db.insert(notificacoes).values({ pedidoOnlineId: novo.id, telefone: novo.clienteTelefone, mensagem: msgPag });
      }
      return { codigo, subtotal, taxaEntrega, total, adiant, aguardaCotacao: extras.length > 0 };
    }),

  /** Cliente envia o comprovativo (foto/documento em data URL). A acção do cliente termina aqui. */
  enviarComprovativo: publicQuery
    .input(z.object({
      codigo: z.string().min(4).max(12),
      telefone: z.string().min(9).max(30),
      metodo: z.enum(["Transferência eMola", "Levantamento eMola", "FNB", "Dinheiro"]),
      comprovativo: z.string().min(50).max(6_000_000).optional(), // data URL (não obrigatório em Dinheiro)
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const p = await db.query.pedidosOnline.findFirst({
        where: and(eq(pedidosOnline.codigo, input.codigo), eq(pedidosOnline.clienteTelefone, input.telefone.trim())),
      });
      if (!p) throw new TRPCError({ code: "NOT_FOUND", message: "Pedido não encontrado. Confira o código e o telefone." });
      if (p.status !== "Pendente" && p.status !== "Comprovativo Enviado")
        throw new TRPCError({ code: "BAD_REQUEST", message: "Este pedido já está a ser processado." });
      if (propostaPendente(p))
        throw new TRPCError({ code: "BAD_REQUEST", message: "Responda primeiro à proposta de alteração do restaurante (na página «Acompanhar Pedido»)." });
      if (extrasPendentes(p))
        throw new TRPCError({ code: "BAD_REQUEST", message: "Os seus itens especiais (✳️) ainda estão a ser cotados pelo restaurante ou aguardam a sua aceitação. O pagamento só fica disponível depois de os aceitar." });
      if (input.metodo !== "Dinheiro" && !input.comprovativo)
        throw new TRPCError({ code: "BAD_REQUEST", message: "Anexe o comprovativo da transferência " + input.metodo + "." });
      await db.update(pedidosOnline)
        .set({
          ...(input.comprovativo ? { comprovativo: input.comprovativo } : {}),
          metodoPagamento: input.metodo,
          status: "Comprovativo Enviado", atualizadoEm: new Date(),
        })
        .where(eq(pedidosOnline.id, p.id));
      // regista a escolha no histórico de notificações do pedido
      const valor = p.tipo === "Reserva" && p.adiant > 0 ? p.adiant : p.total;
      await db.insert(notificacoes).values({
        pedidoOnlineId: p.id, telefone: p.clienteTelefone,
        mensagem: input.metodo === "Dinheiro"
          ? `💵 Cliente optou por pagar ${valor.toFixed(2)} MZN em DINHEIRO (no local). Aguarda a confirmação do restaurante.`
          : `💳 Cliente enviou o comprovativo de ${valor.toFixed(2)} MZN por ${input.metodo}. Aguarda a confirmação do restaurante.`,
      });
      return { ok: true };
    }),

  /** Acompanhamento público do pedido (código + telefone) */
  acompanhar: publicQuery
    .input(z.object({ codigo: z.string().min(4).max(12), telefone: z.string().min(9).max(30) }))
    .query(async ({ input }) => {
      const db = getDb();
      const p = await db.query.pedidosOnline.findFirst({
        where: and(eq(pedidosOnline.codigo, input.codigo), eq(pedidosOnline.clienteTelefone, input.telefone.trim())),
      });
      if (!p) throw new TRPCError({ code: "NOT_FOUND", message: "Pedido não encontrado. Confira o código e o telefone." });
      const notifs = await db.select().from(notificacoes)
        .where(eq(notificacoes.pedidoOnlineId, p.id)).orderBy(notificacoes.criadoEm);
      const { comprovativo, ...pub } = p;
      const avaliacao = await db.query.avaliacoes.findFirst({
        where: eq(avaliacoes.pedidoOnlineId, p.id),
      });
      return { ...pub, temComprovativo: !!comprovativo, notificacoes: notifs, avaliacao: avaliacao ?? null };
    }),

  /** RESERVA: nas últimas 6h antes da data/hora, o cliente confirma que vem */
  confirmarVinda: publicQuery
    .input(z.object({ codigo: z.string().min(4).max(12), telefone: z.string().min(9).max(30) }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const p = await db.query.pedidosOnline.findFirst({
        where: and(eq(pedidosOnline.codigo, input.codigo), eq(pedidosOnline.clienteTelefone, input.telefone.trim())),
      });
      if (!p) throw new TRPCError({ code: "NOT_FOUND", message: "Pedido não encontrado. Confira o código e o telefone." });
      if (p.tipo !== "Reserva")
        throw new TRPCError({ code: "BAD_REQUEST", message: "A confirmação de vinda é só para reservas." });
      if (p.status !== "Aguarda Consumo")
        throw new TRPCError({ code: "BAD_REQUEST", message: "A confirmação fica disponível depois de o restaurante confirmar o pagamento." });
      if (p.vindaConfirmada)
        throw new TRPCError({ code: "BAD_REQUEST", message: "A sua vinda já está confirmada. Até breve! 😊" });
      if (!janelaT6hAberta(p.dataAgendada, p.horaAgendada))
        throw new TRPCError({ code: "BAD_REQUEST", message: "A confirmação de vinda abre 6 horas antes da data/hora da reserva." });
      await db.update(pedidosOnline).set({ vindaConfirmada: true, atualizadoEm: new Date() })
        .where(eq(pedidosOnline.id, p.id));
      await db.insert(notificacoes).values({
        pedidoOnlineId: p.id, telefone: p.clienteTelefone,
        mensagem: `✅ Vinda CONFIRMADA pelo cliente para ${p.dataAgendada}${p.horaAgendada ? " às " + p.horaAgendada : ""}. Mesa garantida para ${p.pessoas ?? "?"} pessoa(s).`,
      });
      return { ok: true };
    }),

  /** RESERVA: nas últimas 6h o cliente pode pré-seleccionar os pratos para o consumo no local
      (facultativo — acelera o atendimento; paga no local, no dia) */
  preSelecionar: publicQuery
    .input(z.object({
      codigo: z.string().min(4).max(12),
      telefone: z.string().min(9).max(30),
      itens: z.array(z.object({ produtoId: z.number().int().positive(), qtd: z.number().int().min(1).max(99) })).min(1).max(30),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const p = await db.query.pedidosOnline.findFirst({
        where: and(eq(pedidosOnline.codigo, input.codigo), eq(pedidosOnline.clienteTelefone, input.telefone.trim())),
      });
      if (!p) throw new TRPCError({ code: "NOT_FOUND", message: "Pedido não encontrado. Confira o código e o telefone." });
      if (p.tipo !== "Reserva")
        throw new TRPCError({ code: "BAD_REQUEST", message: "A pré-selecção de pratos é só para reservas." });
      if (p.status !== "Aguarda Consumo")
        throw new TRPCError({ code: "BAD_REQUEST", message: "A pré-selecção fica disponível depois de o restaurante confirmar o pagamento." });
      if (!janelaT6hAberta(p.dataAgendada, p.horaAgendada))
        throw new TRPCError({ code: "BAD_REQUEST", message: "A pré-selecção de pratos abre 6 horas antes da data/hora da reserva." });

      const novos: DocItem[] = [];
      for (const o of input.itens) {
        const pr = await db.query.produtos.findFirst({ where: eq(produtos.id, o.produtoId) });
        if (!pr || !pr.ativo) throw new TRPCError({ code: "BAD_REQUEST", message: `Produto indisponível (id ${o.produtoId})` });
        novos.push({ nome: pr.nome, qtd: o.qtd, precoUnit: pr.preco, total: Math.round(o.qtd * pr.preco * 100) / 100 });
      }
      // os pratos pré-seleccionados ficam comprometidos — baixa já no stock
      for (const n of novos) {
        const prod = await db.query.produtos.findFirst({ where: eq(produtos.nome, n.nome) });
        if (prod) await baixarStockProduto(db, prod, n.qtd, `Reserva ${p.codigo} (pré-selecção do cliente)`, 1);
      }
      const itens = [...p.itens, ...novos];
      const subtotal = Math.round(itens.reduce((a, i) => a + i.total, 0) * 100) / 100;
      const total = p.afiliadoId && !p.braaiModalidade ? Math.round(subtotal * (1 - LOJA_DESCONTO_PCT / 100) * 100) / 100 : subtotal; // desconto online só com afiliado; braai nunca
      const somaNovos = Math.round(novos.reduce((a, i) => a + i.total, 0) * 100) / 100;
      await db.update(pedidosOnline).set({ itens, subtotal, total, atualizadoEm: new Date() })
        .where(eq(pedidosOnline.id, p.id));
      await db.insert(notificacoes).values({
        pedidoOnlineId: p.id, telefone: p.clienteTelefone,
        mensagem: `🍽 Pré-selecção de ${novos.length} item(ns) registada (+${somaNovos.toFixed(2)} MZN, a pagar no local no dia do consumo): ${novos.map((n) => `${n.qtd}× ${n.nome}`).join(", ")}.`,
      });
      return { ok: true, subtotal, total };
    }),

  /** Cliente responde à proposta do restaurante: aceita/recusa substitutos e pode escolher outros itens do menu */
  responderProposta: publicQuery
    .input(z.object({
      codigo: z.string().min(4).max(12),
      telefone: z.string().min(9).max(30),
      aceites: z.array(z.number().int().min(0)).default([]), // índices em proposta.adicionados aceites
      outros: z.array(z.object({ produtoId: z.number().int().positive(), qtd: z.number().int().min(1).max(99) })).max(10).default([]),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const p = await db.query.pedidosOnline.findFirst({
        where: and(eq(pedidosOnline.codigo, input.codigo), eq(pedidosOnline.clienteTelefone, input.telefone.trim())),
      });
      if (!p) throw new TRPCError({ code: "NOT_FOUND", message: "Pedido não encontrado. Confira o código e o telefone." });
      if (!p.proposta) throw new TRPCError({ code: "BAD_REQUEST", message: "Este pedido não tem proposta pendente." });
      const prop = p.proposta;
      // base de cálculo: fotografia dos itens no momento da proposta (permite reeditar a resposta)
      const base = prop.itensOriginais ?? p.itens;

      // itens originais menos os rejeitados pelo restaurante (fora de stock)
      const novos: DocItem[] = base.filter((_, i) => !prop.removidos.includes(i)).map((i) => ({ ...i }));
      // substitutos aceites pelo cliente
      const aceitesSet = new Set(input.aceites);
      prop.adicionados.forEach((ad, i) => { if (aceitesSet.has(i)) novos.push({ ...ad }); });
      // outros itens que o cliente escolheu no menu
      for (const o of input.outros) {
        const pr = await db.query.produtos.findFirst({ where: eq(produtos.id, o.produtoId) });
        if (!pr || !pr.ativo) continue;
        if (p.tipo === "Delivery" && CATS_SEM_DELIVERY.includes(pr.categoria)) continue;
        novos.push({ nome: pr.nome, qtd: o.qtd, precoUnit: pr.preco, total: Math.round(o.qtd * pr.preco * 100) / 100 });
      }
      if (novos.length === 0)
        throw new TRPCError({ code: "BAD_REQUEST", message: "O pedido ficaria vazio. Fale connosco ou cancele o pedido." });

      const subtotal = Math.round(novos.reduce((a, i) => a + i.total, 0) * 100) / 100;
      const total = p.afiliadoId && !p.braaiModalidade ? Math.round(subtotal * (1 - LOJA_DESCONTO_PCT / 100) * 100) / 100 : subtotal; // desconto online só com afiliado; braai nunca
      const adiant = p.tipo === "Reserva" ? Math.round(total * (p.total > 0 ? p.adiant / p.total : 0.5) * 100) / 100 : 0;
      await db.update(pedidosOnline)
        .set({
          itens: novos, subtotal, total, adiant,
          proposta: { ...prop, respondidaEm: new Date().toISOString() },
          atualizadoEm: new Date(),
        })
        .where(eq(pedidosOnline.id, p.id));

      const emp = await getEmpresa();
      const nome = p.clienteNome.split(" ")[0];
      const msg = `✅ ${emp.nome}: Olá ${nome}! Obrigado pela resposta sobre o pedido ${p.codigo}. Itens actualizados — novo total: ${total.toFixed(2)} MZN${p.tipo === "Reserva" ? ` (depósito: ${adiant.toFixed(2)} MZN)` : ""}.`;
      await db.insert(notificacoes).values({ pedidoOnlineId: p.id, telefone: p.clienteTelefone, mensagem: msg });
      return { ok: true, subtotal, total, adiant };
    }),

  /** Cliente responde à cotação dos itens especiais (✳️): aceita/recusa cada um.
      Os aceites entram no pedido e no total; só depois disto o pagamento é possível. */
  responderCotacao: publicQuery
    .input(z.object({
      codigo: z.string().min(4).max(12),
      telefone: z.string().min(9).max(30),
      aceites: z.array(z.number().int().min(0)).default([]), // índices dos extras aceites
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const p = await db.query.pedidosOnline.findFirst({
        where: and(eq(pedidosOnline.codigo, input.codigo), eq(pedidosOnline.clienteTelefone, input.telefone.trim())),
      });
      if (!p) throw new TRPCError({ code: "NOT_FOUND", message: "Pedido não encontrado. Confira o código e o telefone." });
      const extras = p.extras ?? [];
      if (extras.length === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "Este pedido não tem itens especiais." });
      if (extras.some((e) => !e.cotado))
        throw new TRPCError({ code: "BAD_REQUEST", message: "O restaurante ainda não terminou a cotação. Aguarde a notificação." });
      if (extras.every((e) => e.aceite != null))
        throw new TRPCError({ code: "BAD_REQUEST", message: "Já respondeu a esta cotação." });

      const aceitesSet = new Set(input.aceites);
      const novosExtras = extras.map((e, i) => ({ ...e, aceite: aceitesSet.has(i) }));
      const aceitesItens: DocItem[] = novosExtras.filter((e) => e.aceite).map((e) => ({
        nome: `✳️ ${e.descricao}${e.detalhes ? ` (${e.detalhes})` : ""}`,
        qtd: e.qtd, precoUnit: e.preco,
        total: Math.round(e.qtd * e.preco * 100) / 100, personalizado: true,
      }));
      const itens = [...p.itens, ...aceitesItens];
      if (itens.length === 0)
        throw new TRPCError({ code: "BAD_REQUEST", message: "O pedido ficaria vazio. Fale connosco ou cancele o pedido." });

      const subtotal = Math.round(itens.reduce((a, i) => a + i.total, 0) * 100) / 100;
      const total = p.afiliadoId && !p.braaiModalidade ? Math.round(subtotal * (1 - LOJA_DESCONTO_PCT / 100) * 100) / 100 : subtotal; // desconto online só com afiliado; braai nunca
      const adiant = p.tipo === "Reserva" ? Math.round(total * (p.total > 0 ? p.adiant / p.total : 0.5) * 100) / 100 : 0;
      await db.update(pedidosOnline)
        .set({ itens, subtotal, total, adiant, extras: novosExtras, atualizadoEm: new Date() })
        .where(eq(pedidosOnline.id, p.id));

      const emp = await getEmpresa();
      const nome = p.clienteNome.split(" ")[0];
      const nAce = aceitesItens.length;
      const msg = nAce > 0
        ? `✅ ${emp.nome}: Olá ${nome}! Obrigado — aceitou ${nAce} ${nAce === 1 ? "item especial" : "itens especiais"} do pedido ${p.codigo}. Novo total: ${total.toFixed(2)} MZN${p.tipo === "Reserva" ? ` (depósito: ${adiant.toFixed(2)} MZN)` : ""}. Já pode enviar o comprovativo de pagamento.`
        : `✅ ${emp.nome}: Olá ${nome}! Registámos a sua resposta sobre os itens especiais do pedido ${p.codigo} (recusados). O total mantém-se: ${total.toFixed(2)} MZN.`;
      await db.insert(notificacoes).values({ pedidoOnlineId: p.id, telefone: p.clienteTelefone, mensagem: msg });
      return { ok: true, subtotal, total, adiant };
    }),

  /** Estado do estabelecimento para a loja (popup de "fechado" no cliente) */
  estabelecimento: publicQuery.query(async () => {
    const e = await getEstadoEstab();
    return { estado: e.estado, fechado: e.estado === "fechado" };
  }),

  /** RESERVA: no dia do consumo, o cliente abre o pedido (código + telefone) e o
      acompanhamento normal recomeça — Confirmado → Em Preparo → Pronto → Concluído */
  abrirPedido: publicQuery
    .input(z.object({ codigo: z.string().min(4).max(12), telefone: z.string().min(9).max(30) }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const p = await db.query.pedidosOnline.findFirst({
        where: and(eq(pedidosOnline.codigo, input.codigo), eq(pedidosOnline.clienteTelefone, input.telefone.trim())),
      });
      if (!p) throw new TRPCError({ code: "NOT_FOUND", message: "Pedido não encontrado. Confira o código e o telefone." });
      if (p.status !== "Aguarda Consumo")
        throw new TRPCError({ code: "BAD_REQUEST", message: "Este pedido não está a aguardar o dia do consumo." });
      // Se o cliente chegar ANTES da data combinada, o pedido abre na mesma
      // (a data agendada fica registada no histórico do pedido)
      const msg = await abrirPedidoReservaOnline(p.id, p.codigo, p.clienteTelefone, p.clienteNome);
      return { ok: true, mensagem: msg };
    }),

  /** Cliente cancela o próprio pedido — apenas ANTES do pagamento (status Pendente) */
  cancelarPedido: publicQuery
    .input(z.object({ codigo: z.string().min(4).max(12), telefone: z.string().min(9).max(30) }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const p = await db.query.pedidosOnline.findFirst({
        where: and(eq(pedidosOnline.codigo, input.codigo), eq(pedidosOnline.clienteTelefone, input.telefone.trim())),
      });
      if (!p) throw new TRPCError({ code: "NOT_FOUND", message: "Pedido não encontrado. Confira o código e o telefone." });
      if (p.status !== "Pendente")
        throw new TRPCError({ code: "BAD_REQUEST", message: "Já não é possível cancelar: o pedido já está a ser processado. Fale connosco." });
      await db.update(pedidosOnline).set({ status: "Cancelado", atualizadoEm: new Date() })
        .where(eq(pedidosOnline.id, p.id));
      const emp = await getEmpresa();
      const msg = `❌ ${emp.nome}: O pedido ${p.codigo} foi cancelado a pedido do cliente (${p.clienteNome.split(" ")[0]}), antes do pagamento.`;
      await db.insert(notificacoes).values({ pedidoOnlineId: p.id, telefone: p.clienteTelefone, mensagem: msg });
      return { ok: true };
    }),

  /** Cliente volta atrás na resposta que deu à PROPOSTA do restaurante (enquanto o pedido está Pendente) */
  reabrirResposta: publicQuery
    .input(z.object({ codigo: z.string().min(4).max(12), telefone: z.string().min(9).max(30) }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const p = await db.query.pedidosOnline.findFirst({
        where: and(eq(pedidosOnline.codigo, input.codigo), eq(pedidosOnline.clienteTelefone, input.telefone.trim())),
      });
      if (!p) throw new TRPCError({ code: "NOT_FOUND", message: "Pedido não encontrado. Confira o código e o telefone." });
      if (p.status !== "Pendente")
        throw new TRPCError({ code: "BAD_REQUEST", message: "Já não é possível alterar a resposta nesta fase do pedido." });
      if (!p.proposta?.respondidaEm)
        throw new TRPCError({ code: "BAD_REQUEST", message: "Não há resposta anterior para reeditar." });
      await db.update(pedidosOnline)
        .set({ proposta: { ...p.proposta, respondidaEm: null }, atualizadoEm: new Date() })
        .where(eq(pedidosOnline.id, p.id));
      return { ok: true };
    }),

  /** Cliente volta atrás na resposta que deu à COTAÇÃO dos itens especiais (enquanto Pendente).
      Os itens aceites saem do pedido e a cotação fica de novo à espera de resposta. */
  reabrirCotacao: publicQuery
    .input(z.object({ codigo: z.string().min(4).max(12), telefone: z.string().min(9).max(30) }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const p = await db.query.pedidosOnline.findFirst({
        where: and(eq(pedidosOnline.codigo, input.codigo), eq(pedidosOnline.clienteTelefone, input.telefone.trim())),
      });
      if (!p) throw new TRPCError({ code: "NOT_FOUND", message: "Pedido não encontrado. Confira o código e o telefone." });
      if (p.status !== "Pendente")
        throw new TRPCError({ code: "BAD_REQUEST", message: "Já não é possível alterar a resposta nesta fase do pedido." });
      const extras = p.extras ?? [];
      if (extras.length === 0 || extras.some((e) => !e.cotado) || extras.some((e) => e.aceite == null))
        throw new TRPCError({ code: "BAD_REQUEST", message: "Não há resposta anterior para reeditar." });

      // remove do pedido os itens especiais que tinham sido aceites
      const nomesExtras = new Set(extras.filter((e) => e.aceite).map(nomeExtra));
      const itens = p.itens.filter((i) => !(i.personalizado && nomesExtras.has(i.nome)));
      const novosExtras = extras.map((e) => ({ ...e, aceite: null as boolean | null }));
      const subtotal = Math.round(itens.reduce((a, i) => a + i.total, 0) * 100) / 100;
      const total = p.afiliadoId && !p.braaiModalidade ? Math.round(subtotal * (1 - LOJA_DESCONTO_PCT / 100) * 100) / 100 : subtotal; // desconto online só com afiliado; braai nunca
      const adiant = p.tipo === "Reserva" ? Math.round(total * (p.total > 0 ? p.adiant / p.total : 0.5) * 100) / 100 : 0;
      await db.update(pedidosOnline)
        .set({ itens, subtotal, total, adiant, extras: novosExtras, atualizadoEm: new Date() })
        .where(eq(pedidosOnline.id, p.id));
      return { ok: true, subtotal, total, adiant };
    }),

  /** Avaliação do cliente no fim da entrega — estrelas obrigatórias, comentário opcional */
  avaliar: publicQuery
    .input(z.object({
      codigo: z.string().min(4).max(12),
      telefone: z.string().min(9).max(30),
      estrelas: z.number().int().min(1).max(5),
      comentario: z.string().max(500).optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const p = await db.query.pedidosOnline.findFirst({
        where: and(eq(pedidosOnline.codigo, input.codigo), eq(pedidosOnline.clienteTelefone, input.telefone.trim())),
      });
      if (!p) throw new TRPCError({ code: "NOT_FOUND", message: "Pedido não encontrado. Confira o código e o telefone." });
      if (p.status !== "Entregue" && p.status !== "Concluído")
        throw new TRPCError({ code: "BAD_REQUEST", message: "A avaliação fica disponível no fim da entrega do pedido." });
      const ja = await db.query.avaliacoes.findFirst({ where: eq(avaliacoes.pedidoOnlineId, p.id) });
      if (ja) throw new TRPCError({ code: "BAD_REQUEST", message: "Este pedido já foi avaliado. Obrigado!" });
      await db.insert(avaliacoes).values({
        pedidoOnlineId: p.id, clienteNome: p.clienteNome,
        estrelas: input.estrelas, comentario: input.comentario?.trim() || null,
      });
      return { ok: true };
    }),
});
/* ============================================================
   PEDIDOS ONLINE — lado da equipa (autenticado por PIN)
   ============================================================ */
type Estado = "Pendente" | "Comprovativo Enviado" | "Aguarda Consumo" | "Confirmado" | "Em Preparo" | "Pronto" | "Em Entrega" | "Entregue" | "Concluído" | "Cancelado";

/* Permissões por fase do pedido:
   Pendente / Comprovativo / Confirmado → caixa (Vendedor) e gerente
   Em Preparo / Pronto                  → cozinheiro
   Saiu p/ entrega / Entregue / Concluído → caixa */
const CAIXA = ["Admin", "Gestor", "Vendedor"];
const COZINHA = ["Admin", "Gestor", "Cozinha"];
const TODOS_STAFF = ["Admin", "Gestor", "Vendedor", "Cozinha"];

/** Abre um pedido de RESERVA que estava a aguardar o dia do consumo — volta ao fluxo
    normal como "Confirmado" (pagamento já registado) e notifica o cliente */
/** Buffet pago online → cria a «Reserva Buffet» na página de Reservas (uma só vez por pedido) */
export async function registarReservaBuffet(pedidoOnlineId: number, usuarioId: number): Promise<void> {
  const db = getDb();
  const p = await db.query.pedidosOnline.findFirst({ where: eq(pedidosOnline.id, pedidoOnlineId) });
  if (!p || p.tipo !== "Reserva") return;
  const itens = (p.itens as DocItem[] | null) ?? [];
  const itemBuf = itens.find((i) => i.nome.startsWith("🍽"));
  if (!itemBuf) return; // reserva normal (sem buffet) — não entra na página de Reservas
  const ja = await db.query.reservas.findFirst({ where: eq(reservas.onlineId, pedidoOnlineId) });
  if (ja) return;
  const pct = p.total > 0 ? Math.round((p.adiant / p.total) * 100) : 0;
  const pacoteNome = itemBuf.nome.replace(/^🍽\s*/, "").split(" — ")[0];
  const hojeMZ = new Date(Date.now() + 2 * 3600e3).toISOString().slice(0, 10);
  await db.insert(reservas).values({
    codigo: p.codigo, // OL-xxxx — único e rastreável até ao pedido online
    cliente: p.clienteNome, contacto: p.clienteTelefone,
    dataReserva: hojeMZ, dataConsumo: p.dataAgendada ?? hojeMZ,
    hora: p.horaAgendada || null, area: p.area || null,
    tipo: "Buffet", tipoOutro: pacoteNome,
    pessoas: p.pessoas ?? itemBuf.qtd ?? 1,
    pacoteNome,
    valor: p.total, adiantPct: pct, adiant: p.adiant,
    saldo: Math.max(0, Math.round((p.total - p.adiant) * 100) / 100),
    status: "Confirmada",
    condicoes: `Reserva Buffet — pedido online ${p.codigo}. ${pct < 100
      ? "⏰ O remanescente deve ser liquidado até 48 HORAS antes do evento, sob pena de não abertura da mesa."
      : "Pago integralmente (100%)."} No dia do consumo, abra o pedido aqui mesmo para levantar os pratos e acrescentar outros produtos da casa.`,
    onlineId: p.id,
    usuarioId,
  });
}

export async function abrirPedidoReservaOnline(id: number, codigo: string, telefone: string, clienteNome: string) {
  const db = getDb();
  await db.update(pedidosOnline).set({ status: "Confirmado", atualizadoEm: new Date() })
    .where(eq(pedidosOnline.id, id));
  const emp = await getEmpresa();
  const msg = `🔓 ${emp.nome}: Olá ${clienteNome.split(" ")[0]}! O seu pedido ${codigo} foi ABERTO. Vamos começar o preparo — acompanhe o estado na página «Acompanhar Pedido» até ficar pronto. Bem-vindo!`;
  await db.insert(notificacoes).values({ pedidoOnlineId: id, telefone, mensagem: msg });
  return msg;
}

async function mudarEstado(input: {
  usuarioId: number; id: number; para: Estado;
  perfis?: string[]; tempoEstimado?: number; taxaEntrega?: number;
}) {
  const db = getDb();
  const uActor = await requirePerfil(input.usuarioId, input.perfis ?? ["Admin", "Gestor", "Vendedor"]);
  const p = await db.query.pedidosOnline.findFirst({ where: eq(pedidosOnline.id, input.id) });
  if (!p) throw new TRPCError({ code: "NOT_FOUND", message: "Pedido não encontrado" });
  if (p.status === "Aguarda Consumo" && input.para !== "Cancelado")
    throw new TRPCError({ code: "BAD_REQUEST", message: "Esta reserva aguarda o dia do consumo — o cliente (ou o caixa) deve ABRIR o pedido primeiro." });

  // entregador OBRIGATÓRIO antes de sair para entrega — o cliente precisa de poder ligar ao entregador
  if (input.para === "Em Entrega" && p.tipo === "Delivery" && (!p.entregadorNome || !p.entregadorTel))
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Antes de enviar o pedido, registe o NOME e o CONTACTO do entregador (cartão 🛵 Entregador: solicite um entregador cadastrado ou use «Entregador não cadastrado»). O cliente precisa de ligar ao entregador para o direccionar até ao local.",
    });

  const emp = await getEmpresa();
  // o pagamento só pode ser confirmado depois de resolvidas propostas e cotações pendentes.
  // ("Aguarda Consumo" = pagamento confirmado de uma RESERVA, à espera do dia do evento)
  const aConfirmar = input.para === "Confirmado" || input.para === "Aguarda Consumo";
  if (aConfirmar) {
    if (propostaPendente(p))
      throw new TRPCError({ code: "BAD_REQUEST", message: "Há uma proposta de alteração à espera da resposta do cliente." });
    if (extrasPendentes(p))
      throw new TRPCError({ code: "BAD_REQUEST", message: "Há itens especiais (✳️) por cotar ou à espera da aceitação do cliente." });
  }
  const set: Record<string, unknown> = { status: input.para, atualizadoEm: new Date(), atualizadoPor: uActor.nome };
  let total = p.total;

  // taxa de entrega definida pelo restaurante (mín. 100 MZN) — paga ao entregador, fora do total
  if (input.taxaEntrega !== undefined && p.tipo === "Delivery") {
    if (input.taxaEntrega < 100)
      throw new TRPCError({ code: "BAD_REQUEST", message: "A taxa de entrega mínima é 100,00 MZN." });
    set.taxaEntrega = Math.round(input.taxaEntrega * 100) / 100;
  }
  // tempo estimado: calcula hora de início e fim (hora de Maputo)
  if (input.para === "Em Preparo") {
    const min = input.tempoEstimado ?? 30;
    const ini = new Date();
    const fim = new Date(ini.getTime() + min * 60000);
    set.tempoEstimado = min;
    set.inicioEstimado = horaMZ(ini);
    set.fimEstimado = horaMZ(fim);
  }
  await db.update(pedidosOnline).set(set).where(eq(pedidosOnline.id, p.id));

  // receita da loja online: regista o pagamento ao confirmar; anula se cancelado depois
  if (aConfirmar) {
    const jaExiste = await db.query.pagamentos.findFirst({
      where: eq(pagamentos.tipoVenda, `Online ${p.codigo}`),
    });
    if (!jaExiste) {
      const cod = await nextCodigo("pagamento", "PG-");
      await db.insert(pagamentos).values({
        codigo: cod, tipoVenda: `Online ${p.codigo}`, cliente: p.clienteNome,
        valor: p.tipo === "Reserva" && p.adiant > 0 ? p.adiant : p.total,
        metodo: p.metodoPagamento ?? "Transferência eMola",
      });
    }
    // baixa automática de stock (itens do menu; ✳️ personalizados não têm produto)
    for (const i of p.itens) {
      if (i.personalizado || i.nome.startsWith("✳️")) continue;
      const prod = await db.query.produtos.findFirst({ where: eq(produtos.nome, i.nome) });
      if (prod) await baixarStockProduto(db, prod, i.qtd, `Online ${p.codigo}`, input.usuarioId);
    }
    // comissão do afiliado: compras online (refeições, bebidas, reservas de mesa…) = 3%; pagamento confirmado = as duas metades
    if (p.afiliadoId) {
      const alta = false; // 5% é apenas para aluguer do salão (eventos com pacote, no POS/reservas)
      const lead = await leadProtegido(p.afiliadoId, p.clienteTelefone);
      await lancarComissao({
        afiliadoId: p.afiliadoId, origem: "Online", origemId: p.id, origemRef: p.codigo,
        descricao: `Pedido online ${p.codigo} (${p.tipo}) — ${p.clienteNome}`,
        valorVenda: p.tipo === "Reserva" && p.adiant > 0 ? p.adiant : p.total,
        alta, parcela: 0, leadId: lead?.id ?? null,
      });
    }
  }
  if (input.para === "Cancelado") {
    await db.update(pagamentos).set({ status: "Anulado" })
      .where(eq(pagamentos.tipoVenda, `Online ${p.codigo}`));
    await estornarComissoes("Online", p.id);
    // se o pedido já tinha sido confirmado (stock descontado), repõe o stock
    const estavaPago = ["Aguarda Consumo", "Confirmado", "Em Preparo", "Pronto", "Em Entrega"].includes(p.status);
    if (estavaPago) {
      for (const i of p.itens) {
        if (i.personalizado || i.nome.startsWith("✳️")) continue;
        const prod = await db.query.produtos.findFirst({ where: eq(produtos.nome, i.nome) });
        if (prod) await reporStockProduto(db, prod, i.qtd, `Online ${p.codigo} (cancelado)`, input.usuarioId);      }
    }
  }

  // regista a notificação (WhatsApp/SMS) no histórico do pedido, com o autor
  const msg = mensagemEstado(input.para, { ...p, ...set, total } as typeof p, emp);
  if (msg) {
    await db.insert(notificacoes).values({ pedidoOnlineId: p.id, telefone: p.clienteTelefone, mensagem: msg, autor: uActor.nome });
  }
  const wa = `https://wa.me/${telWa(p.clienteTelefone)}?text=${encodeURIComponent(msg ?? "")}`;
  return { ok: true, wa, mensagem: msg };
}

function mensagemEstado(estado: Estado, p: { codigo: string; clienteNome: string; tipo: string; total: number; adiant: number; tempoEstimado: number | null; inicioEstimado: string | null; fimEstimado: string | null; entregadorNome?: string | null; entregadorTel?: string | null; taxaEntrega?: number }, emp: EmpresaCfg) {
  const nome = p.clienteNome.split(" ")[0];
  switch (estado) {
    case "Aguarda Consumo":
      return `✅ ${emp.nome}: Olá ${nome}! O adiantamento da sua reserva ${p.codigo} foi CONFIRMADO (${p.adiant.toFixed(2)} MZN) e a conversa fica concluída por aqui. A sua FACTURA já está disponível na página «Acompanhar Pedido». 📅 No dia do evento, antes de chegar, ABRA o seu pedido na mesma página — basta o código ${p.codigo} e o seu telefone, ou entrar na sua conta — e acompanhe o preparo até ficar pronto. Guarde bem o código do pedido! 🎁 BÓNUS: as crianças que vierem consigo têm 3 diversões GRÁTIS no parque infantil — baloiço, escorrega e balanço! Válido apenas no dia de consumo deste pedido. Vai ser um dia inesquecível — nós tratamos de tudo! 🎉`;
    case "Confirmado":
      return `✅ ${emp.nome}: Olá ${nome}! O pagamento do seu pedido ${p.codigo} foi CONFIRMADO (${p.total.toFixed(2)} MZN). Vamos começar a preparar. A sua FACTURA já está disponível para baixar na página «Acompanhar Pedido». Obrigado!${p.tipo === "Local" ? " 🎁 BÓNUS: as crianças que vierem consigo têm 3 diversões GRÁTIS no parque infantil — baloiço, escorrega e balanço! Válido apenas no dia de consumo deste pedido." : ""}`;
    case "Em Preparo":
      return `👨‍🍳 ${emp.nome}: O seu pedido ${p.codigo} está EM PREPARO — a nossa cozinha já está a caprichar! 🧡 Tempo estimado: ${p.tempoEstimado ?? 30} min (início ${p.inicioEstimado ?? ""}, fim previsto ${p.fimEstimado ?? ""}).`;
    case "Pronto":
      return p.tipo === "Delivery"
        ? `🛵 ${emp.nome}: O seu pedido ${p.codigo} está PRONTO e será entregue em breve no endereço indicado. Taxa de entrega: ${(p.taxaEntrega ?? 0).toFixed(2)} MZN — paga ao entregador no momento da entrega.`
        : `🍽️ ${emp.nome}: O seu pedido ${p.codigo} está PRONTO! Pode levantar/dirigir-se ao balcão. Bom apetite — volte sempre! 🧡`;
    case "Em Entrega":
      return `🛵 ${emp.nome}: O seu pedido ${p.codigo} SAIU PARA ENTREGA. ${p.entregadorNome ? `Entregador: ${p.entregadorNome}${p.entregadorTel ? ` — contacto ${p.entregadorTel}` : ""}.` : "O entregador está a caminho!"} Taxa de entrega: ${(p.taxaEntrega ?? 0).toFixed(2)} MZN — paga ao entregador na entrega.`;
    case "Entregue":
      return `✔️ ${emp.nome}: O seu pedido ${p.codigo} foi ENTREGUE. Obrigado pela preferência — ${emp.slogan}! E lembre-se: casamentos, buffets, braai e lazer em família — conte sempre connosco. 🎉`;
    case "Concluído":
      return `✔️ ${emp.nome}: Pedido ${p.codigo} concluído. Obrigado pela preferência — ${emp.slogan}! Os seus próximos momentos especiais têm lugar garantido aqui. 🎉`;
    case "Cancelado":
      return `❌ ${emp.nome}: O seu pedido ${p.codigo} foi cancelado. Para mais informações contacte-nos: ${emp.tel1} / ${emp.tel2}. Esperamos recebê-lo numa próxima — a CAMI'S está sempre de portas abertas para si. 🧡`;
    default:
      return "";
  }
}

export const onlineRouter = createRouter({
  list: publicQuery
    .input(z.object({ usuarioId: z.number().int().positive() }))
    .query(async ({ input }) => {
      await requirePerfil(input.usuarioId, TODOS_STAFF);
      return getDb().select({
        id: pedidosOnline.id, codigo: pedidosOnline.codigo, clienteNome: pedidosOnline.clienteNome,
        clienteTelefone: pedidosOnline.clienteTelefone, tipo: pedidosOnline.tipo, mesa: pedidosOnline.mesa,
        endereco: pedidosOnline.endereco, dataAgendada: pedidosOnline.dataAgendada,
        horaAgendada: pedidosOnline.horaAgendada, pessoas: pedidosOnline.pessoas,
        area: pedidosOnline.area, vindaConfirmada: pedidosOnline.vindaConfirmada,
        braaiModalidade: pedidosOnline.braaiModalidade, braaiTraz: pedidosOnline.braaiTraz,
        criancasMenores: pedidosOnline.criancasMenores,
        itens: pedidosOnline.itens, subtotal: pedidosOnline.subtotal, taxaEntrega: pedidosOnline.taxaEntrega,
        total: pedidosOnline.total, adiant: pedidosOnline.adiant, status: pedidosOnline.status,
        metodoPagamento: pedidosOnline.metodoPagamento,
        atualizadoPor: pedidosOnline.atualizadoPor,
        entregadorNome: pedidosOnline.entregadorNome, entregadorTel: pedidosOnline.entregadorTel,
        tempoEstimado: pedidosOnline.tempoEstimado, inicioEstimado: pedidosOnline.inicioEstimado,
        fimEstimado: pedidosOnline.fimEstimado, atrasoNotificado: pedidosOnline.atrasoNotificado,
        proposta: pedidosOnline.proposta,
        extras: pedidosOnline.extras,
        temComprovativo: sql<boolean>`(${pedidosOnline.comprovativo} IS NOT NULL)`,
        criadoEm: pedidosOnline.criadoEm,
      }).from(pedidosOnline).orderBy(desc(pedidosOnline.criadoEm)).limit(300);
    }),

  get: publicQuery
    .input(z.object({ usuarioId: z.number().int().positive(), id: z.number().int().positive() }))
    .query(async ({ input }) => {
      await requirePerfil(input.usuarioId, TODOS_STAFF);
      const db = getDb();
      const p = await db.query.pedidosOnline.findFirst({ where: eq(pedidosOnline.id, input.id) });
      if (!p) throw new TRPCError({ code: "NOT_FOUND" });
      const notifs = await db.select().from(notificacoes)
        .where(eq(notificacoes.pedidoOnlineId, p.id)).orderBy(notificacoes.criadoEm);
      const avaliacao = await db.query.avaliacoes.findFirst({
        where: eq(avaliacoes.pedidoOnlineId, p.id),
      });
      return { ...p, notificacoes: notifs, avaliacao: avaliacao ?? null };
    }),

  confirmarPagamento: publicQuery
    .input(z.object({ usuarioId: z.number().int().positive(), id: z.number().int().positive(), taxaEntrega: z.number().min(0).optional() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const p = await db.query.pedidosOnline.findFirst({ where: eq(pedidosOnline.id, input.id) });
      if (!p) throw new TRPCError({ code: "NOT_FOUND" });
      // Reserva: a conversa termina com o adiantamento — o pedido fica a aguardar o dia do consumo
      const r = await mudarEstado({ ...input, para: p.tipo === "Reserva" ? "Aguarda Consumo" : "Confirmado", perfis: CAIXA });
      // buffet pago → a informação passa para a página de Reservas como «Reserva Buffet»
      if (p.tipo === "Reserva") {
        try { await registarReservaBuffet(p.id, input.usuarioId); }
        catch (e) { console.error("[reserva-buffet] falhou:", (e as Error)?.message); }
      }
      return r;
    }),

  /** Caixa/gerente abre manualmente um pedido de reserva que aguarda o dia do consumo */
  abrirPedido: publicQuery
    .input(z.object({ usuarioId: z.number().int().positive(), id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      await requirePerfil(input.usuarioId, CAIXA);
      const db = getDb();
      const p = await db.query.pedidosOnline.findFirst({ where: eq(pedidosOnline.id, input.id) });
      if (!p) throw new TRPCError({ code: "NOT_FOUND", message: "Pedido não encontrado" });
      if (p.status !== "Aguarda Consumo")
        throw new TRPCError({ code: "BAD_REQUEST", message: "Este pedido não está a aguardar o dia do consumo." });
      const msg = await abrirPedidoReservaOnline(p.id, p.codigo, p.clienteTelefone, p.clienteNome);
      const wa = `https://wa.me/${telWa(p.clienteTelefone)}?text=${encodeURIComponent(msg)}`;
      return { ok: true, wa, mensagem: msg };
    }),

  iniciarPreparo: publicQuery
    .input(z.object({ usuarioId: z.number().int().positive(), id: z.number().int().positive(), tempoEstimado: z.number().int().min(5).max(600).default(30) }))
    .mutation(({ input }) => mudarEstado({ ...input, para: "Em Preparo", perfis: COZINHA })),

  marcarPronto: publicQuery
    .input(z.object({ usuarioId: z.number().int().positive(), id: z.number().int().positive() }))
    .mutation(({ input }) => mudarEstado({ ...input, para: "Pronto", perfis: COZINHA })),

  saiuEntrega: publicQuery
    .input(z.object({ usuarioId: z.number().int().positive(), id: z.number().int().positive() }))
    .mutation(({ input }) => mudarEstado({ ...input, para: "Em Entrega", perfis: CAIXA })),

  concluir: publicQuery
    .input(z.object({ usuarioId: z.number().int().positive(), id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const p = await db.query.pedidosOnline.findFirst({ where: eq(pedidosOnline.id, input.id) });
      if (!p) throw new TRPCError({ code: "NOT_FOUND" });
      return mudarEstado({ ...input, para: p.tipo === "Delivery" ? "Entregue" : "Concluído", perfis: CAIXA });
    }),

  cancelar: publicQuery
    .input(z.object({ usuarioId: z.number().int().positive(), id: z.number().int().positive() }))
    .mutation(({ input }) => mudarEstado({ ...input, para: "Cancelado", perfis: ["Admin"] })),

  /** Definir a taxa de entrega final (mín. 100 MZN) conforme o local do cliente — ANTES do pagamento.
      A taxa é paga ao entregador na entrega: NÃO entra no total nem nos pagamentos do restaurante. */
  ajustarTaxa: publicQuery
    .input(z.object({
      usuarioId: z.number().int().positive(),
      id: z.number().int().positive(),
      taxaEntrega: z.number().min(100).max(100000),
    }))
    .mutation(async ({ input }) => {
      const u = await requirePerfil(input.usuarioId, CAIXA);
      const db = getDb();
      const p = await db.query.pedidosOnline.findFirst({ where: eq(pedidosOnline.id, input.id) });
      if (!p) throw new TRPCError({ code: "NOT_FOUND", message: "Pedido não encontrado" });
      if (p.tipo !== "Delivery")
        throw new TRPCError({ code: "BAD_REQUEST", message: "Só pedidos de delivery têm taxa de entrega." });
      if (!["Pendente", "Comprovativo Enviado"].includes(p.status))
        throw new TRPCError({ code: "BAD_REQUEST", message: "A taxa de entrega só pode ser definida ANTES do pagamento ser confirmado." });
      const taxa = Math.round(input.taxaEntrega * 100) / 100;
      await db.update(pedidosOnline)
        .set({ taxaEntrega: taxa, atualizadoEm: new Date(), atualizadoPor: u.nome })
        .where(eq(pedidosOnline.id, p.id));
      const msg = `🛵 ${(await getEmpresa()).nome}: a taxa de entrega do seu pedido ${p.codigo} foi definida em ${taxa.toFixed(2)} MZN, conforme o seu local de entrega. Este valor é pago directamente ao entregador no momento da entrega — não faz parte do valor do pedido (${p.total.toFixed(2)} MZN).`;
      await db.insert(notificacoes).values({ pedidoOnlineId: p.id, telefone: p.clienteTelefone, mensagem: msg });
      return { ok: true, taxaEntrega: taxa };
    }),

  /** Entregador NÃO cadastrado: registar nome + contacto directamente no pedido (visível para o cliente) */
  entregadorManual: publicQuery
    .input(z.object({
      usuarioId: z.number().int().positive(),
      id: z.number().int().positive(),
      nome: z.string().min(2).max(120),
      telefone: z.string().min(9).max(30),
    }))
    .mutation(async ({ input }) => {
      const u = await requirePerfil(input.usuarioId, CAIXA);
      const db = getDb();
      const p = await db.query.pedidosOnline.findFirst({ where: eq(pedidosOnline.id, input.id) });
      if (!p) throw new TRPCError({ code: "NOT_FOUND", message: "Pedido não encontrado" });
      if (p.tipo !== "Delivery")
        throw new TRPCError({ code: "BAD_REQUEST", message: "Só pedidos de delivery têm entregador." });
      if (!["Confirmado", "Em Preparo", "Pronto", "Em Entrega"].includes(p.status))
        throw new TRPCError({ code: "BAD_REQUEST", message: "Só é possível indicar o entregador depois do pagamento confirmado." });
      await db.update(pedidosOnline)
        .set({ entregadorNome: input.nome.trim(), entregadorTel: input.telefone.trim(), atualizadoEm: new Date(), atualizadoPor: u.nome })
        .where(eq(pedidosOnline.id, p.id));
      const msg = `🛵 ${(await getEmpresa()).nome}: a entrega do seu pedido ${p.codigo} ficará a cargo de ${input.nome.trim()} — contacto ${input.telefone.trim()}. A taxa de entrega (${p.taxaEntrega.toFixed(2)} MZN) é paga ao entregador na entrega.`;
      await db.insert(notificacoes).values({ pedidoOnlineId: p.id, telefone: p.clienteTelefone, mensagem: msg });
      return { ok: true, entregadorNome: input.nome.trim(), entregadorTel: input.telefone.trim() };
    }),

  /** Caixa/cozinha: rejeita itens fora de stock e/ou propõe substitutos — o cliente aceita ou recusa */
  proporItens: publicQuery
    .input(z.object({
      usuarioId: z.number().int().positive(),
      id: z.number().int().positive(),
      remover: z.array(z.number().int().min(0)).max(50).default([]), // índices dos itens fora de stock
      adicionar: z.array(z.object({ produtoId: z.number().int().positive(), qtd: z.number().int().min(1).max(99) })).max(10).default([]),
    }))
    .mutation(async ({ input }) => {
      const u = await requirePerfil(input.usuarioId, TODOS_STAFF);
      const db = getDb();
      const p = await db.query.pedidosOnline.findFirst({ where: eq(pedidosOnline.id, input.id) });
      if (!p) throw new TRPCError({ code: "NOT_FOUND", message: "Pedido não encontrado" });
      if (!["Pendente", "Comprovativo Enviado"].includes(p.status))
        throw new TRPCError({ code: "BAD_REQUEST", message: "Após a confirmação do pagamento já não é possível rejeitar itens nem propor substitutos" });
      const removidos = [...new Set(input.remover)].filter((i) => i >= 0 && i < p.itens.length);
      const adicionados: DocItem[] = [];
      for (const a of input.adicionar) {
        const pr = await db.query.produtos.findFirst({ where: eq(produtos.id, a.produtoId) });
        if (!pr || !pr.ativo) continue;
        if (p.tipo === "Delivery" && CATS_SEM_DELIVERY.includes(pr.categoria)) continue;
        adicionados.push({ nome: pr.nome, qtd: a.qtd, precoUnit: pr.preco, total: Math.round(a.qtd * pr.preco * 100) / 100 });
      }
      if (removidos.length === 0 && adicionados.length === 0)
        throw new TRPCError({ code: "BAD_REQUEST", message: "Indique itens a rejeitar e/ou substitutos a propor" });
      if (p.itens.length - removidos.length + adicionados.length <= 0)
        throw new TRPCError({ code: "BAD_REQUEST", message: "O pedido ficaria vazio — nesse caso cancele o pedido" });

      const proposta: PropostaOnline = {
        removidos, adicionados, itensOriginais: p.itens.map((i) => ({ ...i })),
        criadoPor: u.nome, criadoEm: new Date().toISOString(), respondidaEm: null,
      };
      await db.update(pedidosOnline).set({ proposta, atualizadoEm: new Date() }).where(eq(pedidosOnline.id, p.id));

      const emp = await getEmpresa();
      const nome = p.clienteNome.split(" ")[0];
      const partes: string[] = [];
      if (removidos.length)
        partes.push(`Infelizmente não temos em stock: ${removidos.map((i) => p.itens[i].nome).join(", ")}.`);
      if (adicionados.length)
        partes.push(`Propomos em substituição: ${adicionados.map((a) => `${a.qtd}× ${a.nome}`).join(", ")}.`);
      const msg = `⚠️ ${emp.nome}: Olá ${nome}! Sobre o seu pedido ${p.codigo}: ${partes.join(" ")} Entre na página «Acompanhar Pedido» para aceitar ou recusar. Obrigado!`;
      await db.insert(notificacoes).values({ pedidoOnlineId: p.id, telefone: p.clienteTelefone, mensagem: msg });
      const wa = `https://wa.me/${telWa(p.clienteTelefone)}?text=${encodeURIComponent(msg)}`;
      return { ok: true, wa, mensagem: msg };
    }),

  /** Restaurante volta atrás numa proposta já enviada: retira-a e repõe os itens originais do cliente */
  retirarProposta: publicQuery
    .input(z.object({ usuarioId: z.number().int().positive(), id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const u = await requirePerfil(input.usuarioId, TODOS_STAFF);
      const db = getDb();
      const p = await db.query.pedidosOnline.findFirst({ where: eq(pedidosOnline.id, input.id) });
      if (!p) throw new TRPCError({ code: "NOT_FOUND", message: "Pedido não encontrado" });
      if (!p.proposta)
        throw new TRPCError({ code: "BAD_REQUEST", message: "Este pedido não tem proposta para retirar." });
      if (!["Pendente", "Comprovativo Enviado"].includes(p.status))
        throw new TRPCError({ code: "BAD_REQUEST", message: "Já não é possível retirar a proposta nesta fase do pedido." });

      // se o cliente já tinha respondido, repõe os itens tal como ele pediu originalmente
      const set: Record<string, unknown> = { proposta: null, atualizadoEm: new Date() };
      if (p.proposta.respondidaEm && p.proposta.itensOriginais) {
        const itens = p.proposta.itensOriginais;
        const subtotal = Math.round(itens.reduce((a, i) => a + i.total, 0) * 100) / 100;
        set.itens = itens;
        set.subtotal = subtotal;
        set.total = p.afiliadoId && !p.braaiModalidade ? Math.round(subtotal * (1 - LOJA_DESCONTO_PCT / 100) * 100) / 100 : subtotal; // desconto online só com afiliado; braai nunca
        set.adiant = p.tipo === "Reserva" ? Math.round(subtotal * (p.total > 0 ? p.adiant / p.total : 0.5) * 100) / 100 : 0;
      }
      await db.update(pedidosOnline).set(set).where(eq(pedidosOnline.id, p.id));

      const emp = await getEmpresa();
      const msg = `ℹ️ ${emp.nome}: Olá ${p.clienteNome.split(" ")[0]}! Retirámos a proposta de alteração do pedido ${p.codigo} (por ${u.nome}). O pedido segue como estava originalmente. Obrigado!`;
      await db.insert(notificacoes).values({ pedidoOnlineId: p.id, telefone: p.clienteTelefone, mensagem: msg });
      const wa = `https://wa.me/${telWa(p.clienteTelefone)}?text=${encodeURIComponent(msg)}`;
      return { ok: true, wa, mensagem: msg };
    }),

  /** Avaliações recebidas dos clientes online (média + últimas) — para a equipa */
  avaliacoes: publicQuery
    .input(z.object({ usuarioId: z.number().int().positive() }))
    .query(async ({ input }) => {
      await requirePerfil(input.usuarioId, TODOS_STAFF);
      const db = getDb();
      const rows = await db.select({
        id: avaliacoes.id, pedidoOnlineId: avaliacoes.pedidoOnlineId,
        clienteNome: avaliacoes.clienteNome, estrelas: avaliacoes.estrelas,
        comentario: avaliacoes.comentario, criadoEm: avaliacoes.criadoEm,
        codigo: pedidosOnline.codigo,
      }).from(avaliacoes)
        .leftJoin(pedidosOnline, eq(avaliacoes.pedidoOnlineId, pedidosOnline.id))
        .orderBy(desc(avaliacoes.criadoEm)).limit(50);
      const media = rows.length
        ? Math.round((rows.reduce((a, r) => a + r.estrelas, 0) / rows.length) * 10) / 10
        : null;
      return { media, total: rows.length, rows };
    }),

  /** Restaurante define o preço dos itens especiais (✳️) pedidos pelo cliente.
      O cliente recebe notificação e aceita/recusa na página «Acompanhar Pedido». */
  cotarExtras: publicQuery
    .input(z.object({
      usuarioId: z.number().int().positive(),
      id: z.number().int().positive(),
      precos: z.array(z.number().min(0)).min(1).max(10), // preço por índice do extra
    }))
    .mutation(async ({ input }) => {
      const u = await requirePerfil(input.usuarioId, TODOS_STAFF);
      const db = getDb();
      const p = await db.query.pedidosOnline.findFirst({ where: eq(pedidosOnline.id, input.id) });
      if (!p) throw new TRPCError({ code: "NOT_FOUND", message: "Pedido não encontrado" });
      const extras = p.extras ?? [];
      if (extras.length === 0)
        throw new TRPCError({ code: "BAD_REQUEST", message: "Este pedido não tem itens especiais" });
      if (input.precos.length !== extras.length)
        throw new TRPCError({ code: "BAD_REQUEST", message: "Indique o preço de todos os itens especiais" });
      if (!["Pendente", "Comprovativo Enviado"].includes(p.status))
        throw new TRPCError({ code: "BAD_REQUEST", message: "Após a confirmação do pagamento já não é possível alterar a cotação" });
      if (extras.some((e) => e.aceite != null))
        throw new TRPCError({ code: "BAD_REQUEST", message: "O cliente já respondeu à cotação — peça-lhe para usar «Mudar a minha resposta» na página Acompanhar, ou ajuste por mensagem." });

      // re-cotação: volta a pôr tudo à espera da resposta do cliente

      const novos = extras.map((e, i) => ({
        ...e, preco: Math.round(input.precos[i] * 100) / 100, cotado: true, cotadoPor: u.nome, aceite: null,
      }));
      await db.update(pedidosOnline).set({ extras: novos, atualizadoEm: new Date() })
        .where(eq(pedidosOnline.id, p.id));

      const emp = await getEmpresa();
      const nome = p.clienteNome.split(" ")[0];
      const lista = novos.map((e) => `${e.qtd}× ${e.descricao} — ${(e.qtd * e.preco).toFixed(2)} MZN`).join("; ");
      const totExtras = novos.reduce((a, e) => a + e.qtd * e.preco, 0);
      const msg = `💰 ${emp.nome}: Olá ${nome}! Cotámos os itens especiais do seu pedido ${p.codigo}: ${lista} (total dos especiais: ${totExtras.toFixed(2)} MZN). Entre na página «Acompanhar Pedido» para ACEITAR ou RECUSAR cada item. O pagamento segue depois da sua resposta. Obrigado!`;
      await db.insert(notificacoes).values({ pedidoOnlineId: p.id, telefone: p.clienteTelefone, mensagem: msg });
      const wa = `https://wa.me/${telWa(p.clienteTelefone)}?text=${encodeURIComponent(msg)}`;
      return { ok: true, wa, mensagem: msg };
    }),

  /** Eliminar DEFINITIVAMENTE um pedido online e as suas notificações (apenas Admin — limpeza de testes) */
  eliminar: publicQuery
    .input(z.object({ usuarioId: z.number().int().positive(), id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      await requirePerfil(input.usuarioId, ["Admin"]);
      const db = getDb();
      await db.delete(notificacoes).where(eq(notificacoes.pedidoOnlineId, input.id));
      await db.delete(pedidosOnline).where(eq(pedidosOnline.id, input.id));
      return { ok: true };
    }),

  /** Mensagem humana da equipa ao cliente (ex.: aviso antes do atraso) — qualquer funcionário */
  mensagemManual: publicQuery
    .input(z.object({
      usuarioId: z.number().int().positive(),
      id: z.number().int().positive(),
      mensagem: z.string().min(3).max(500),
    }))
    .mutation(async ({ input }) => {
      await requirePerfil(input.usuarioId, TODOS_STAFF);
      const db = getDb();
      const p = await db.query.pedidosOnline.findFirst({ where: eq(pedidosOnline.id, input.id) });
      if (!p) throw new TRPCError({ code: "NOT_FOUND" });
      const emp = await getEmpresa();
      const u = await db.query.usuarios.findFirst({ where: eq(usuarios.id, input.usuarioId) });
      const msg = `💬 ${emp.nome} (${u?.nome ?? "Equipa"}): ${input.mensagem.trim()} — pedido ${p.codigo}`;
      await db.insert(notificacoes).values({ pedidoOnlineId: p.id, telefone: p.clienteTelefone, mensagem: msg, autor: u?.nome ?? null });
      const wa = `https://wa.me/${telWa(p.clienteTelefone)}?text=${encodeURIComponent(msg)}`;
      return { ok: true, wa, mensagem: msg };
    }),

  /** Watchdog de atraso: pedidos EM PREPARO cuja hora prevista passou há 3+ minutos.
      Na primeira detecção regista automaticamente uma mensagem de desculpas ao cliente
      e devolve a lista para o popup de alerta no ecrã do restaurante. */
  atrasos: publicQuery
    .input(z.object({ usuarioId: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      await requirePerfil(input.usuarioId, TODOS_STAFF);
      const db = getDb();
      const emp = await getEmpresa();
      const agora = new Date();
      const agoraMin = (() => { const [h, m] = horaMZ(agora).split(":").map(Number); return h * 60 + m; })();

      const emPreparo = await db.select().from(pedidosOnline)
        .where(eq(pedidosOnline.status, "Em Preparo"));
      const atrasados: Array<{ id: number; codigo: string; clienteNome: string; tipo: string; fimEstimado: string | null }> = [];

      for (const p of emPreparo) {
        if (!p.fimEstimado || p.atrasoNotificado) continue;
        // ignora pedidos de preparo iniciado há muito tempo (outro dia)
        if (agora.getTime() - new Date(p.atualizadoEm).getTime() > 12 * 3600e3) continue;
        const [h, m] = p.fimEstimado.split(":").map(Number);
        const fimMin = h * 60 + m;
        const diff = ((agoraMin - fimMin) + 1440) % 1440; // minutos desde a hora prevista
        if (diff < 3 || diff > 360) continue;
        // marca primeiro para não disparar em duplicado
        await db.update(pedidosOnline).set({ atrasoNotificado: agora }).where(eq(pedidosOnline.id, p.id));
        const nome = p.clienteNome.split(" ")[0];
        const msg = `🙏 ${emp.nome}: Olá ${nome}! Pedimos desculpa pelo atraso do seu pedido ${p.codigo}. Estamos a fazer o máximo para ${p.tipo === "Delivery" ? "entregar" : "concluir o preparo"} dentro em breve. Obrigado pela compreensão!`;
        await db.insert(notificacoes).values({ pedidoOnlineId: p.id, telefone: p.clienteTelefone, mensagem: msg });
        atrasados.push({ id: p.id, codigo: p.codigo, clienteNome: p.clienteNome, tipo: p.tipo, fimEstimado: p.fimEstimado });
      }
      return { atrasados };
    }),
});
