import { createRouter, publicQuery } from "./middleware";
import { usuariosRouter, produtosRouter, pedidosRouter } from "./camis";
import {
  reservasRouter, stockRouter,
  pagamentosRouter, dashboardRouter, relatoriosRouter,
} from "./camis2";
import { configRouter, documentosRouter, operacaoRouter } from "./camis3";
import { lojaRouter, onlineRouter } from "./camis4";
import { presencaRouter } from "./camis5";
import { despesasRouter, financeiroRouter, agenteRouter } from "./camis6";
import { crmRouter } from "./crm";
import { gerenciaRouter } from "./camis7";
import { entregasRouter } from "./camis8";
import { afiliadosRouter } from "./afiliados";
import { vagasRouter } from "./vagas";
import { dividasRouter } from "./dividas";
import { buffetRouter } from "./buffet";
import { rhRouter } from "./rh";
import { trabalhoVagasRouter } from "./trabalho-vagas";
import { eventosRouter } from "./eventos";

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),
  usuarios: usuariosRouter,
  produtos: produtosRouter,
  pedidos: pedidosRouter,
  reservas: reservasRouter,
  stock: stockRouter,
  pagamentos: pagamentosRouter,
  dashboard: dashboardRouter,
  relatorios: relatoriosRouter,
  config: configRouter,
  operacao: operacaoRouter,
  documentos: documentosRouter,
  loja: lojaRouter,
  online: onlineRouter,
  presenca: presencaRouter,
  despesas: despesasRouter,
  financeiro: financeiroRouter,
  crm: crmRouter,
  gerencia: gerenciaRouter,
  entregas: entregasRouter,
  afiliados: afiliadosRouter,
  agente: agenteRouter,
  vagas: vagasRouter,
  dividas: dividasRouter,
  buffet: buffetRouter,
  rh: rhRouter,
  trabalhoVagas: trabalhoVagasRouter,
  eventos: eventosRouter,
});

export type AppRouter = typeof appRouter;
