import { trpc } from "@/providers/trpc";
import { EMPRESA, type EmpresaCfg } from "@contracts/types";

/** Dados da empresa (editáveis pelo Admin em Configurações), com valores por defeito */
export function useEmpresa(): EmpresaCfg {
  const q = trpc.config.get.useQuery(undefined, { staleTime: 60000 });
  const d = q.data as Partial<EmpresaCfg> | undefined;
  const out = {} as Record<string, string>;
  for (const k of Object.keys(EMPRESA))
    out[k] = (d?.[k as keyof EmpresaCfg] as string) || String(EMPRESA[k as keyof typeof EMPRESA]);
  return out as EmpresaCfg;
}
