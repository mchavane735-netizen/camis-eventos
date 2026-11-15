/** Instruções de uso do sistema — específicas para cada perfil.
    Conteúdo resumido do Manual do Utilizador, acessível dentro do sistema. */
import { useSession } from "@/lib/session";
import { Voltar } from "@/components/bits";

type Bloco = { titulo: string; itens: string[] };

const COMUM: Bloco[] = [
  {
    titulo: "🔐 Acesso e segurança",
    itens: [
      "Entre com o seu nome e a sua senha. Tem 3 tentativas — ao 3º erro a conta bloqueia e só o Administrador a desbloqueia.",
      "Toque no 👁️ junto ao campo da senha para ver o que escreveu.",
      "O sistema bloqueia sozinho após 10 minutos sem uso — volte a entrar só com a senha.",
      "Só o Administrador pode alterar senhas/PINs.",
    ],
  },
  {
    titulo: "🛎️ Pedidos online (loja)",
    itens: [
      "Quando chega um pedido novo, aparece um alerta com som no fundo do ecrã.",
      "Pagamentos por confirmar deslizam da barra inferior — toque para abrir os Pedidos Online.",
      "Cada pedido mostra quem fez a última acção («por …») — responsabilidade registada.",
    ],
  },
  {
    titulo: "📅 Reservas",
    itens: [
      "Se o salão já estiver reservado na data escolhida, o sistema avisa e mostra o calendário de datas livres.",
      "Alertas automáticos: 1 dia antes e 3 horas antes do consumo, com o contacto do cliente.",
    ],
  },
];

const POR_PERFIL: Record<string, Bloco[]> = {
  Admin: [
    {
      titulo: "👑 Administrador — acesso total",
      itens: [
        "Cria/edita utilizadores (inclui entregadores), altera senhas e desbloqueia contas.",
        "Configura dados da empresa, horários, bairros de entrega e horário-limite do delivery.",
        "É o único que pode cancelar um pedido online já pago (o stock é reposto).",
        "Abre/fecha o estabelecimento manualmente e vê quem está online.",
      ],
    },
  ],
  Gestor: [
    {
      titulo: "🧭 Gestor",
      itens: [
        "Faz quase tudo: vendas, reservas, documentos, estoque, despesas, gerência e relatórios financeiros.",
        "Confirma pagamentos online e gere solicitações de entregador (pode cancelar e pedir outro).",
        "Não altera dados da empresa nem senhas — isso é do Administrador.",
      ],
    },
  ],
  Vendedor: [
    {
      titulo: "🛒 Vendedor",
      itens: [
        "Regista vendas no POS, reservas e documentos (pro-formas, facturas).",
        "Atende pedidos online: confirma comprovativos, propõe substitutos, solicita entregador.",
        "Campos de dinheiro ganham os dois zeros automaticamente ao sair do campo.",
      ],
    },
  ],
  Cozinha: [
    {
      titulo: "👨‍🍳 Cozinha",
      itens: [
        "Vê os pedidos confirmados e marca «Em Preparo» (com tempo estimado) e «Pronto».",
        "Pratos de aves, carnes, peixe e marisco trazem os acompanhamentos escolhidos pelo cliente na observação do item.",
      ],
    },
  ],
  Logistica: [
    {
      titulo: "🚚 Logística",
      itens: [
        "Gere o estoque: entradas de produtos, alertas de stock baixo e movimentos.",
        "Regista as despesas e compras do dia, com upload dos comprovativos (área do dia, não por produto) e nota para compras sem comprovativo.",
        "Acompanha as entregas de delivery e o estado dos pedidos online.",
      ],
    },
  ],
  Entregador: [
    {
      titulo: "🛵 Entregador",
      itens: [
        "Mantenha a página «As minhas entregas» aberta — assim fica online e recebe solicitações com som.",
        "Veja a taxa e o bairro antes de aceitar. O primeiro a aceitar fica com a entrega.",
        "Depois de entregar, toque em «✅ Entregue» — o cliente é notificado automaticamente.",
        "Pode ligar ao cliente directamente pelo botão «📞 Ligar ao cliente».",
      ],
    },
  ],
};

export default function Ajuda({ voltar }: { voltar: () => void }) {
  const { user } = useSession();
  const blocos = [...COMUM, ...(POR_PERFIL[user?.perfil ?? ""] ?? [])];
  return (
    <div>
      <Voltar onClick={voltar} />
      <div className="c-titulo">❓ Instruções de Uso</div>
      <p className="c-sub">
        Guia rápido para o seu perfil ({user?.perfil}). Para o manual completo, peça ao Administrador
        o documento «Manual de Uso» (PDF).
      </p>
      {blocos.map((b) => (
        <div className="c-card" key={b.titulo}>
          <div className="c-titulo" style={{ fontSize: 15 }}>{b.titulo}</div>
          <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
            {b.itens.map((i, k) => <li key={k} style={{ fontSize: 13.5, marginBottom: 5, lineHeight: 1.45 }}>{i}</li>)}
          </ul>
        </div>
      ))}
    </div>
  );
}
