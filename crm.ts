/* ============================================================
   CRM — carteira de clientes da CAMI'S
   Junta todos os clientes conhecidos do sistema, de TODAS as
   origens: cadastro online, reservas (casamentos, buffets,
   braai…), compras online, vendas no restaurante (POS com
   referência), fiado (dívidas) e leads trazidas pelos afiliados.
   Por cliente: nome, contacto, origens, nº de compras, total
   gasto, PERDAS (reservas canceladas, pedidos anulados, fiado
   em aberto, leads perdidas) e a data da última actividade.
   ============================================================ */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { createRouter, publicQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { afiliadoLeads, clientes, dividas, pedidos, pedidosOnline, reservas, usuarios } from "@db/schema";

async function requirePerfil(userId: number, perfis: string[]) {
  const u = await getDb().query.usuarios.findFirst({ where: eq(usuarios.id, userId) });
  if (!u || !u.ativo) throw new TRPCError({ code: "UNAUTHORIZED", message: "Utilizador inválido" });
  if (!perfis.includes(u.perfil))
    throw new TRPCError({ code: "FORBIDDEN", message: "Ação reservada a: " + perfis.join(", ") });
  return u;
}

const GESTAO = ["Admin", "Gestor"];
const r2 = (n: number) => Math.round(n * 100) / 100;
const mzDia = (d: Date | string) => new Date(new Date(d).getTime() + 2 * 3600e3).toISOString().slice(0, 10);

const ESTADOS_PAGOS_ONLINE = ["Aguarda Consumo", "Confirmado", "Em Preparo", "Pronto", "Em Entrega", "Entregue", "Concluído"];

type Entrada = {
  nome: string;
  telefone: string;
  origens: Set<string>;
  nVendas: number;
  totalGasto: number;
  nPerdas: number;
  perdas: number;
  ultimaData: string;
};

export const crmRouter = createRouter({
  /** Lista agregada de todos os clientes (visão de gestão) */
  clientes: publicQuery
    .input(z.object({ usuarioId: z.number().int().positive() }))
    .query(async ({ input }) => {
      await requirePerfil(input.usuarioId, GESTAO);
      const db = getDb();
      const mapa = new Map<string, Entrada>();

      const normTel = (t?: string | null) => (t ?? "").replace(/\D/g, "").replace(/^258/, "");
      const entrada = (nome: string, telefone?: string | null): Entrada => {
        const tel = normTel(telefone);
        const chave = tel ? "tel:" + tel : "nome:" + nome.trim().toLowerCase();
        let e = mapa.get(chave);
        if (!e) {
          e = { nome: nome.trim(), telefone: tel, origens: new Set(), nVendas: 0, totalGasto: 0, nPerdas: 0, perdas: 0, ultimaData: "" };
          mapa.set(chave, e);
        }
        // preenche o telefone se aparecer noutra fonte (mesmo cliente por nome)
        if (tel && !e.telefone) e.telefone = tel;
        return e;
      };
      const toca = (e: Entrada, data?: string | null) => {
        if (data && data > e.ultimaData) e.ultimaData = data;
      };

      /* --- 1. Clientes com cadastro na loja online --- */
      for (const c of await db.select().from(clientes)) {
        const e = entrada(c.nome, c.telefone);
        e.origens.add("Cadastro online");
        toca(e, mzDia(c.criadoEm));
      }

      /* --- 2. Reservas (casamentos, buffets, braai, aniversários…) --- */
      for (const r of await db.select().from(reservas)) {
        const e = entrada(r.cliente, r.contacto);
        e.origens.add(r.braai ? "Braai" : r.tipo === "Buffet" ? "Buffet" : r.tipo || "Reserva");
        toca(e, r.dataConsumo);
        if (r.status === "Cancelada") {
          e.nPerdas++;
          e.perdas = r2(e.perdas + (r.valor > 0 ? r.valor : r.adiant));
        } else if (r.status === "Confirmada" || r.status === "Concluída") {
          e.nVendas++;
          e.totalGasto = r2(e.totalGasto + (r.status === "Concluída" && r.valor > 0 ? r.valor : r.adiant));
        }
      }

      /* --- 3. Compras online (delivery, takeaway, reservas online) --- */
      for (const o of await db.select().from(pedidosOnline)) {
        const e = entrada(o.clienteNome, o.clienteTelefone);
        e.origens.add(o.tipo === "Reserva" ? "Reserva online" : o.tipo === "Delivery" ? "Delivery" : o.tipo === "TakeAway" ? "TakeAway" : "Compra online");
        toca(e, mzDia(o.criadoEm));
        if (ESTADOS_PAGOS_ONLINE.includes(o.status)) {
          e.nVendas++;
          e.totalGasto = r2(e.totalGasto + (o.tipo === "Reserva" && o.adiant > 0 ? o.adiant : o.total));
        } else if (o.status === "Cancelado") {
          e.nPerdas++;
          e.perdas = r2(e.perdas + o.total);
        }
      }

      /* --- 4. Vendas no restaurante (POS) com referência de cliente --- */
      for (const p of await db.select().from(pedidos)) {
        if (p.status !== "Fechado" || !p.referencia || p.referencia.trim().length < 2) continue;
        const e = entrada(p.referencia, null);
        e.origens.add("Restaurante");
        e.nVendas++;
        e.totalGasto = r2(e.totalGasto + (p.total - (p.dividaGerada ?? 0)));
        toca(e, p.dataDia);
      }

      /* --- 5. Fiado (dívidas) — abertas são perdas potenciais; liquidadas são vendas --- */
      for (const d of await db.select().from(dividas)) {
        const e = entrada(d.clienteNome, d.clienteTel);
        e.origens.add("Fiado");
        toca(e, d.dataDia);
        if (d.status === "Aberta") {
          e.nPerdas++;
          e.perdas = r2(e.perdas + d.valorTotal);
        } else {
          e.nVendas++;
          e.totalGasto = r2(e.totalGasto + d.valorTotal);
        }
      }

      /* --- 6. Clientes trazidos pelos afiliados (leads) --- */
      for (const l of await db.select().from(afiliadoLeads)) {
        const e = entrada(l.clienteNome, l.clienteContacto);
        e.origens.add("Via afiliado");
        toca(e, mzDia(l.criadoEm));
        if (l.estado === "Perdido") e.nPerdas++;
        else if (l.estado === "Convertido") e.nVendas++;
      }

      const lista = [...mapa.values()]
        .map((e) => ({
          nome: e.nome,
          telefone: e.telefone || null,
          origens: [...e.origens].sort(),
          nVendas: e.nVendas,
          totalGasto: r2(e.totalGasto),
          nPerdas: e.nPerdas,
          perdas: r2(e.perdas),
          ultimaData: e.ultimaData || null,
        }))
        .sort((a, b) => b.totalGasto - a.totalGasto || a.nome.localeCompare(b.nome));

      return {
        lista,
        resumo: {
          totalClientes: lista.length,
          comContacto: lista.filter((x) => x.telefone).length,
          comVendas: lista.filter((x) => x.nVendas > 0).length,
          totalVendas: r2(lista.reduce((a, x) => a + x.totalGasto, 0)),
          totalPerdas: r2(lista.reduce((a, x) => a + x.perdas, 0)),
          nPerdas: lista.reduce((a, x) => a + x.nPerdas, 0),
        },
      };
    }),
});
