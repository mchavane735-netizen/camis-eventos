import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { useSession } from "@/lib/session";
import { mt } from "@/lib/fmt";
import { Modal, Voltar } from "@/components/bits";
import {
  METODOS_PAGAMENTO, EMPRESA_CAMPOS, PERFIS, PERFIL_ROTULO, SENHA_RE, SENHA_REGRA,
  type EmpresaCfg, type HorarioDia, type Perfil,
} from "@contracts/types";
import { useEmpresa } from "@/lib/empresa";
import SenhaInput from "@/components/SenhaInput";

export default function Config({ voltar }: { voltar: () => void }) {
  const { user, toast } = useSession();
  const utils = trpc.useUtils();
  const emp = useEmpresa();
  const usuarios = trpc.usuarios.list.useQuery();
  const usuariosAll = trpc.usuarios.listAll.useQuery(
    { adminId: user?.id ?? 0 },
    { enabled: user?.perfil === "Admin" },
  );
  const produtos = trpc.produtos.list.useQuery();
  const horarios = trpc.operacao.horarios.useQuery();
  const bairros = trpc.operacao.bairros.useQuery();
  const [novoUser, setNovoUser] = useState(false);
  const [editEmp, setEditEmp] = useState(false);
  const [editAfiliados, setEditAfiliados] = useState(false);
  const [editEspacos, setEditEspacos] = useState(false);
  const [editHor, setEditHor] = useState(false);
  const [editBairros, setEditBairros] = useState(false);
  const [minhaSenha, setMinhaSenha] = useState(false);
  const [editUser, setEditUser] = useState<{ id: number; nome: string; perfil: string; ativo: boolean; telefone?: string; podeReabrirReserva?: boolean; podeEditarStock?: boolean; podeEditarNomes?: boolean } | null>(null);
  const [f, setF] = useState({ nome: "", perfil: "Vendedor" as Perfil, pin: "", telefone: "" });

  const isAdmin = user?.perfil === "Admin";

  const createUser = trpc.usuarios.create.useMutation({
    onSuccess: () => { toast("Utilizador criado!"); setNovoUser(false); setF({ nome: "", perfil: "Vendedor", pin: "", telefone: "" }); utils.usuarios.list.invalidate(); utils.usuarios.listAll.invalidate(); },
    onError: (e) => toast("⚠️ " + e.message),
  });
  const desbloq = trpc.usuarios.desbloquear.useMutation({
    onSuccess: () => { toast("🔓 Conta desbloqueada."); utils.usuarios.listAll.invalidate(); utils.usuarios.list.invalidate(); },
    onError: (e) => toast("⚠️ " + e.message),
  });
  const atualizarUser = trpc.usuarios.atualizar.useMutation({
    onSuccess: () => { toast("Utilizador atualizado!"); setEditUser(null); utils.usuarios.list.invalidate(); utils.usuarios.listAll.invalidate(); },
    onError: (e) => toast("⚠️ " + e.message),
  });
  const salvarEmp = trpc.config.set.useMutation({
    onSuccess: () => { toast("Dados da empresa guardados!"); setEditEmp(false); utils.config.get.invalidate(); },
    onError: (e) => toast("⚠️ " + e.message),
  });

  const saloes = (produtos.data ?? []).filter((p) => p.categoria === "Salão");
  const piscina = (produtos.data ?? []).filter((p) => p.categoria === "Piscina & Parque");
  const listaUsers = isAdmin ? (usuariosAll.data ?? []) : (usuarios.data ?? []);

  return (
    <div>
      <Voltar onClick={voltar} />
      <div className="c-titulo">⚙️ Configurações</div>

      <div className="c-card" style={{ textAlign: "center" }}>
        <img src="/icons/logo.png" style={{ width: 110, display: "block", margin: "0 auto" }} alt="logo" /><br />
        <b style={{ color: "var(--roxo)", fontSize: 16 }}>{emp.nome}</b><br />
        <span className="c-sub">{emp.slogan}</span><br />
        <span style={{ fontSize: 12.5, fontWeight: 700 }}>NUIT: {emp.nuit}</span><br />
        <span style={{ fontSize: 12 }}>{emp.local}</span><br />
        <span style={{ fontSize: 12 }}>📞 {emp.tel1} · {emp.tel2}</span>
        {isAdmin && (
          <div style={{ marginTop: 10 }}>
            <button className="c-btn c-btn-linha c-btn-peq" onClick={() => setEditEmp(true)}>
              ✏️ Editar Dados da Empresa
            </button>
          </div>
        )}
      </div>

      <div className="c-card">
        <div className="c-titulo" style={{ fontSize: 15 }}>🏦 Dados Bancários (saem nos documentos)</div>
        <div className="c-linha"><div className="grow tit">Banco</div><span>{emp.banco} · Conta {emp.conta}</span></div>
        <div className="c-linha"><div className="grow tit">NIB</div><span>{emp.nib}</span></div>
        <div className="c-linha"><div className="grow tit">Beneficiário</div><span>{emp.beneficiario}</span></div>
        <div className="c-linha"><div className="grow tit">Transferência eMola</div><span>{emp.emola} — {emp.titular}</span></div>
        <div className="c-linha"><div className="grow tit">Levantamento eMola</div><span>{emp.emolaLev} — {emp.emolaLevTitular}</span></div>
        <div className="c-linha"><div className="grow tit">Taxa de Delivery</div><span>{mt(parseFloat(emp.taxaDelivery) || 0)}</span></div>
        <div className="c-linha"><div className="grow tit">Direcção (salão)</div><span>{emp.direcaoTels}</span></div>
        <div className="c-linha"><div className="grow tit">IVA</div><span>{emp.iva}%</span></div>
      </div>

      <div className="c-card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div className="c-titulo" style={{ fontSize: 15, margin: 0 }}>🤝 Afiliados — meta mensal e bónus</div>
          {isAdmin && (
            <button className="c-btn c-btn-linha c-btn-peq" onClick={() => setEditAfiliados(true)}>✏️ Editar</button>
          )}
        </div>
        <div className="c-linha"><div className="grow tit">Meta mensal de vendas (por afiliado)</div><b>{mt(parseFloat(emp.metaAfiliadoMes) || 80000)}</b></div>
        <div className="c-linha"><div className="grow tit">Bónus por atingir a meta</div><b>{mt(parseFloat(emp.bonusAfMeta) || 1000)}</b></div>
        <div className="c-linha"><div className="grow tit">Prémio Afiliado do Mês</div><b>{mt(parseFloat(emp.bonusAfMes) || 1500)}</b></div>
        <div className="c-linha"><div className="grow tit">Bónus de indicação (1ª venda)</div><b>{mt(parseFloat(emp.bonusAfIndicacao) || 300)}</b></div>
        <div className="c-linha"><div className="grow tit">1ª venda mínima do indicado</div><b>{mt(parseFloat(emp.minVendaIndicacao) || 2000)}</b></div>
        <div className="c-sub" style={{ marginTop: 6 }}>
          Comissões: 5% no aluguer do salão · 3% em refeições, bebidas, piscina e parque infantil.
          A meta é o mínimo para o bónus — o afiliado pode vender mais e ganhar mais comissões, sem tecto.
        </div>
      </div>

      <div className="c-card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div className="c-titulo" style={{ fontSize: 15, margin: 0 }}>🏛 Espaços de evento — aluguer SEM decoração</div>
          {isAdmin && (
            <button className="c-btn c-btn-linha c-btn-peq" onClick={() => setEditEspacos(true)}>✏️ Editar</button>
          )}
        </div>
        <div className="c-linha"><div className="grow tit">Salão Rés-do-chão</div><b>{mt(parseFloat(emp.precoEspacoRC) || 0)}</b></div>
        <div className="c-linha"><div className="grow tit">Salão primeiro andar</div><b>{mt(parseFloat(emp.precoEspacoAndar) || 0)}</b></div>
        <div className="c-linha"><div className="grow tit">Área da piscina</div><b>{mt(parseFloat(emp.precoEspacoPiscina) || 0)}</b></div>
        <div className="c-linha"><div className="grow tit">Área do Jardim</div><b>{mt(parseFloat(emp.precoEspacoJardim) || 0)}</b></div>
        <div className="c-linha"><div className="grow tit">Todo o recinto (todos os salões)</div><b>{mt(parseFloat(emp.precoEspacoRecinto) || 0)}</b></div>
        <div className="c-sub" style={{ marginTop: 6 }}>
          Preços base do aluguer do espaço, sem decoração. Com decoração, usa-se o pacote de salão
          escolhido na reserva. Só o Administrador pode alterar estes valores.
        </div>
      </div>

      <div className="c-card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div className="c-titulo" style={{ fontSize: 15, margin: 0 }}>🕐 Horário de Funcionamento</div>
          {isAdmin && (
            <button className="c-btn c-btn-linha c-btn-peq" onClick={() => setEditHor(true)}>✏️ Editar</button>
          )}
        </div>
        {(horarios.data ?? []).map((h) => (
          <div className="c-linha" key={h.dia}>
            <div className="grow tit">{h.dia}</div>
            <span className={`c-chip ${h.aberto ? "c-chip-verde" : "c-chip-vermelho"}`}>
              {h.aberto ? `${h.abre} – ${h.fecha}` : "Fechado"}
            </span>
          </div>
        ))}
      </div>

      <div className="c-card">
        <div className="c-titulo" style={{ fontSize: 15, margin: 0 }}>🛵 Horário-limite do Delivery</div>
        <DeliveryHorarioCard isAdmin={isAdmin} />
      </div>

      <div className="c-card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div className="c-titulo" style={{ fontSize: 15, margin: 0 }}>📍 Bairros de Entrega (Delivery)</div>
          {isAdmin && (
            <button className="c-btn c-btn-linha c-btn-peq" onClick={() => setEditBairros(true)}>✏️ Editar</button>
          )}
        </div>
        <div className="c-sub" style={{ margin: "4px 0 6px" }}>
          Aparecem no dropdown de entrega da loja online. {bairros.data?.length ?? 0} bairros activos.
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          {(bairros.data ?? []).slice(0, 12).map((b) => (
            <span key={b} className="c-chip c-chip-roxo">{b}</span>
          ))}
          {(bairros.data?.length ?? 0) > 12 && <span className="c-chip c-chip-cinza">+{(bairros.data?.length ?? 0) - 12}…</span>}
        </div>
      </div>

      <div className="c-card">
        <div className="c-titulo" style={{ fontSize: 15 }}>🏊 Piscina & Parque</div>
        <div className="c-sub" style={{ marginBottom: 6 }}>Agora são produtos do menu de vendas — os preços alteram-se em Produtos.</div>
        {piscina.map((s) => (
          <div className="c-linha" key={s.id}>
            <div className="grow tit">{s.nome}</div>
            <b>{mt(s.preco)}</b>
          </div>
        ))}
      </div>

      <div className="c-card">
        <div className="c-titulo" style={{ fontSize: 15 }}>🎪 Pacotes do Salão</div>
        <div className="c-sub" style={{ marginBottom: 6 }}>Inclui: Salão + Decoração + Banhos-maria + Cenário de Fotos + Garçons</div>
        {saloes.map((s) => (
          <div className="c-linha" key={s.id}>
            <div className="grow tit">{s.nome.replace("Aluguer Salão - ", "")}</div>
            <b>{mt(s.preco)}</b>
          </div>
        ))}
      </div>

      <div className="c-card">
        <div className="c-titulo" style={{ fontSize: 15 }}>💳 Métodos de Pagamento</div>
        {METODOS_PAGAMENTO.map((m) => <span key={m} className="c-chip c-chip-roxo" style={{ margin: 3 }}>{m}</span>)}
        <div className="c-sub" style={{ marginTop: 8 }}>Reservas exigem adiantamento (definido em cada reserva).</div>
      </div>

      <div className="c-card">
        <div className="c-titulo" style={{ fontSize: 15 }}>🔐 Senhas / PIN</div>
        <div className="c-sub" style={{ marginBottom: 8 }}>
          Regra: {SENHA_REGRA}. O sistema bloqueia após 10 minutos sem uso.
          {user?.perfil === "Admin"
            ? " Só o Administrador pode alterar PINs — o seu aqui, o dos outros na edição do utilizador."
            : " Só o Administrador pode alterar PINs. Para mudar o seu PIN, peça ao Administrador."}
        </div>
        {user?.perfil === "Admin" && (
          <button className="c-btn c-btn-linha c-btn-peq" onClick={() => setMinhaSenha(true)}>🔑 Alterar a minha senha</button>
        )}
      </div>

      {/* v17: vendedores NÃO podem visualizar os utilizadores do sistema */}
      {(user?.perfil === "Admin" || user?.perfil === "Gestor") && (
      <div className="c-card">
        <div className="c-titulo" style={{ fontSize: 15 }}>👥 Utilizadores</div>
        {listaUsers.map((u: any) => (
          <div className="c-linha" key={u.id}>
            <div className="grow tit">
              {u.nome}
              {"ativo" in u && !u.ativo && <span className="c-chip c-chip-vermelho" style={{ marginLeft: 6 }}>Inativo</span>}
              {"bloqueado" in u && u.bloqueado && <span className="c-chip c-chip-vermelho" style={{ marginLeft: 6 }}>🔒 Bloqueado</span>}
            </div>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <span className="c-chip c-chip-roxo">{u.perfil}</span>
              {isAdmin && "bloqueado" in u && u.bloqueado && (
                <button className="c-btn c-btn-linha c-btn-peq" title="Desbloquear conta"
                  onClick={() => user && desbloq.mutate({ adminId: user.id, id: u.id })}>
                  🔓
                </button>
              )}
              {isAdmin && (
                <button className="c-btn c-btn-linha c-btn-peq"
                  onClick={() => setEditUser({ id: u.id, nome: u.nome, perfil: u.perfil, ativo: "ativo" in u ? u.ativo : true, telefone: "telefone" in u ? (u.telefone ?? "") : "", podeReabrirReserva: "podeReabrirReserva" in u ? !!u.podeReabrirReserva : false, podeEditarStock: "podeEditarStock" in u ? !!u.podeEditarStock : false, podeEditarNomes: "podeEditarNomes" in u ? !!u.podeEditarNomes : false })}>
                  ✏️
                </button>
              )}
            </div>
          </div>
        ))}
        {isAdmin && (
          <button className="c-btn c-btn-linha c-btn-peq" style={{ marginTop: 8 }} onClick={() => setNovoUser(true)}>
            ＋ Adicionar Utilizador
          </button>
        )}
      </div>
      )}

      {/* v17: controlo de acesso dos vendedores por horário (Admin e Gestor) */}
      {(user?.perfil === "Admin" || user?.perfil === "Gestor") && <AcessoVendedoresCard />}

      {novoUser && (
        <Modal onClose={() => setNovoUser(false)}>
          <h3>＋ Novo Utilizador</h3>
          <label className="c-label">Nome *</label>
          <input className="c-input" value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} placeholder="Ex.: Cozinheiro 1" />
          <label className="c-label">Perfil</label>
          <select className="c-select" value={f.perfil} onChange={(e) => setF({ ...f, perfil: e.target.value as Perfil })}>
            {PERFIS.map((p) => <option key={p} value={p}>{PERFIL_ROTULO[p]}</option>)}
          </select>
          <label className="c-label">Telefone (obrigatório para Entregador)</label>
          <input className="c-input" value={f.telefone} onChange={(e) => setF({ ...f, telefone: e.target.value })} placeholder="Ex.: 84 123 4567" />
          <label className="c-label">Senha forte *</label>
          <SenhaInput maxLength={60} value={f.pin} onChange={(v) => setF({ ...f, pin: v })} placeholder={SENHA_REGRA} />
          {f.pin && !SENHA_RE.test(f.pin) && <p style={{ color: "var(--vermelho-c)", fontSize: 12 }}>⚠️ {SENHA_REGRA}</p>}
          <button className="c-btn c-btn-prim c-btn-bloco" style={{ marginTop: 14 }} disabled={createUser.isPending}
            onClick={() => {
              if (!f.nome.trim()) { toast("⚠️ Indique o nome."); return; }
              if (!SENHA_RE.test(f.pin)) { toast("⚠️ " + SENHA_REGRA); return; }
              if (f.perfil === "Entregador" && !f.telefone.trim()) { toast("⚠️ Indique o telefone do entregador (o cliente vê este contacto)."); return; }
              user && createUser.mutate({ adminId: user.id, nome: f.nome, perfil: f.perfil, pin: f.pin, telefone: f.telefone || undefined });
            }}>
            {createUser.isPending ? "A criar…" : "✅ Criar Utilizador"}
          </button>
        </Modal>
      )}

      {editEmp && (
        <EditEmpresa
          emp={emp}
          pendente={salvarEmp.isPending}
          onClose={() => setEditEmp(false)}
          onSave={(dados) => user && salvarEmp.mutate({ adminId: user.id, dados })}
        />
      )}

      {editAfiliados && (
        <EditCamposEmpresa
          titulo="🤝 Afiliados — meta mensal e bónus"
          campos={[
            { chave: "metaAfiliadoMes", rotulo: "Meta mensal de vendas do afiliado (MZN)" },
            { chave: "bonusAfMeta", rotulo: "Bónus por atingir a meta mensal (MZN)" },
            { chave: "bonusAfMes", rotulo: "Prémio Afiliado do Mês (MZN)" },
            { chave: "bonusAfIndicacao", rotulo: "Bónus de indicação — 1ª venda do indicado (MZN)" },
            { chave: "minVendaIndicacao", rotulo: "1ª venda mínima do indicado para o bónus (MZN)" },
          ]}
          emp={emp}
          pendente={salvarEmp.isPending}
          onClose={() => setEditAfiliados(false)}
          onSave={(dados) => user && salvarEmp.mutate({ adminId: user.id, dados })}
        />
      )}

      {editEspacos && (
        <EditCamposEmpresa
          titulo="🏛 Espaços de evento — aluguer SEM decoração"
          campos={[
            { chave: "precoEspacoRC", rotulo: "Salão Rés-do-chão (MZN)" },
            { chave: "precoEspacoAndar", rotulo: "Salão primeiro andar (MZN)" },
            { chave: "precoEspacoPiscina", rotulo: "Área da piscina (MZN)" },
            { chave: "precoEspacoJardim", rotulo: "Área do Jardim (MZN)" },
            { chave: "precoEspacoRecinto", rotulo: "Todo o recinto (MZN)" },
          ]}
          emp={emp}
          pendente={salvarEmp.isPending}
          onClose={() => setEditEspacos(false)}
          onSave={(dados) => user && salvarEmp.mutate({ adminId: user.id, dados })}
        />
      )}

      {editUser && (
        <EditUser
          u={editUser}
          pendente={atualizarUser.isPending}
          onClose={() => setEditUser(null)}
          onSave={(d) => user && atualizarUser.mutate({ adminId: user.id, id: editUser.id, ...d })}
        />
      )}

      {editHor && user && <EditHorarios atual={horarios.data ?? []} onClose={() => setEditHor(false)} />}
      {editBairros && user && <EditBairros atual={bairros.data ?? []} onClose={() => setEditBairros(false)} />}
      {minhaSenha && user && <MinhaSenha onClose={() => setMinhaSenha(false)} />}
    </div>
  );
}

/* ============ EDITAR DADOS DA EMPRESA (Admin) ============ */
function EditEmpresa({ emp, onClose, onSave, pendente }: {
  emp: EmpresaCfg; onClose: () => void;
  onSave: (dados: Record<string, string>) => void;
  pendente: boolean;
}) {
  const [f, setF] = useState<Record<string, string>>({ ...emp });
  return (
    <Modal onClose={onClose}>
      <h3>✏️ Dados da Empresa</h3>
      <p className="c-sub">Estes dados aparecem no cabeçalho do aplicativo e em todos os documentos (pro-formas, facturas e recibos).</p>
      <div style={{ maxHeight: "52dvh", overflowY: "auto", paddingRight: 4 }}>
        {EMPRESA_CAMPOS.map((c) => (
          <div key={c.chave}>
            <label className="c-label">{c.rotulo}</label>
            <input className="c-input" value={f[c.chave] ?? ""}
              onChange={(e) => setF((p) => ({ ...p, [c.chave]: e.target.value }))} />
          </div>
        ))}
      </div>
      <button className="c-btn c-btn-prim c-btn-bloco" style={{ marginTop: 14 }} disabled={pendente}
        onClick={() => onSave(f)}>
        {pendente ? "A guardar…" : "💾 Guardar Alterações"}
      </button>
    </Modal>
  );
}

/* ============ EDITAR CAMPOS DA EMPRESA (subconjunto — Admin) ============ */
function EditCamposEmpresa({ titulo, campos, emp, onClose, onSave, pendente }: {
  titulo: string;
  campos: Array<{ chave: keyof EmpresaCfg; rotulo: string }>;
  emp: EmpresaCfg; onClose: () => void;
  onSave: (dados: Record<string, string>) => void;
  pendente: boolean;
}) {
  const [f, setF] = useState<Record<string, string>>({ ...emp });
  return (
    <Modal onClose={onClose}>
      <h3>{titulo}</h3>
      {campos.map((c) => (
        <div key={c.chave}>
          <label className="c-label">{c.rotulo}</label>
          <input className="c-input" inputMode="decimal" value={f[c.chave] ?? ""}
            onChange={(e) => setF((p) => ({ ...p, [c.chave]: e.target.value }))} />
        </div>
      ))}
      <button className="c-btn c-btn-prim c-btn-bloco" style={{ marginTop: 14 }} disabled={pendente}
        onClick={() => onSave(f)}>
        {pendente ? "A guardar…" : "💾 Guardar Alterações"}
      </button>
    </Modal>
  );
}

/* ============ EDITAR UTILIZADOR (Admin) ============ */
function EditUser({ u, onClose, onSave, pendente }: {
  u: { id: number; nome: string; perfil: string; ativo: boolean; telefone?: string; podeReabrirReserva?: boolean; podeEditarStock?: boolean; podeEditarNomes?: boolean };
  onClose: () => void;
  onSave: (d: { nome?: string; perfil?: Perfil; pin?: string; ativo?: boolean; telefone?: string; podeReabrirReserva?: boolean; podeEditarStock?: boolean; podeEditarNomes?: boolean }) => void;
  pendente: boolean;
}) {
  const { toast } = useSession();
  const [nome, setNome] = useState(u.nome);
  const [perfil, setPerfil] = useState(u.perfil as Perfil);
  const [pin, setPin] = useState("");
  const [telefone, setTelefone] = useState(u.telefone ?? "");
  const [podeReabrir, setPodeReabrir] = useState(!!u.podeReabrirReserva);
  const [podeStock, setPodeStock] = useState(!!u.podeEditarStock);
  const [podeNomes, setPodeNomes] = useState(!!u.podeEditarNomes);
  return (
    <Modal onClose={onClose}>
      <h3>✏️ Editar Utilizador</h3>
      <label className="c-label">Nome</label>
      <input className="c-input" value={nome} onChange={(e) => setNome(e.target.value)} />
      <label className="c-label">Perfil (papel no sistema)</label>
      <select className="c-select" value={perfil} onChange={(e) => setPerfil(e.target.value as Perfil)}>
        {PERFIS.map((p) => <option key={p} value={p}>{PERFIL_ROTULO[p]}</option>)}
      </select>
      <label className="c-label">Telefone {perfil === "Entregador" && "(obrigatório — o cliente vê este contacto)"}</label>
      <input className="c-input" value={telefone} onChange={(e) => setTelefone(e.target.value)} placeholder="Ex.: 84 123 4567" />
      <label className="c-label">Nova senha forte (deixe em branco para manter)</label>
      <SenhaInput maxLength={60} value={pin} onChange={setPin} placeholder={SENHA_REGRA} />
      {pin && !SENHA_RE.test(pin) && <p style={{ color: "var(--vermelho-c)", fontSize: 12 }}>⚠️ {SENHA_REGRA}</p>}
      {perfil === "Gestor" && (
        <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10, fontSize: 14, cursor: "pointer" }}>
          <input type="checkbox" checked={podeReabrir} onChange={(e) => setPodeReabrir(e.target.checked)} style={{ width: 18, height: 18 }} />
          <span>↩️ <b>Pode reabrir reservas concluídas</b> <span className="c-sub">(se concluir uma reserva por engano, pode repô-la em «Confirmada» e voltar a abrir/editar o pedido)</span></span>
        </label>
      )}
      {perfil === "Gestor" && (
        <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10, fontSize: 14, cursor: "pointer" }}>
          <input type="checkbox" checked={podeStock} onChange={(e) => setPodeStock(e.target.checked)} style={{ width: 18, height: 18 }} />
          <span>📦 <b>Pode editar o stock</b> <span className="c-sub">(entradas e ajustes de inventário — sem esta autorização o Gestor só consulta)</span></span>
        </label>
      )}
      {perfil !== "Admin" && ["Gestor", "Vendedor", "Eventos"].includes(perfil) && (
        <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10, fontSize: 14, cursor: "pointer" }}>
          <input type="checkbox" checked={podeNomes} onChange={(e) => setPodeNomes(e.target.checked)} style={{ width: 18, height: 18 }} />
          <span>✏️ <b>Pode corrigir nomes já registados</b> <span className="c-sub">(mesa/referência e atendente nas vendas, nome do evento e do titular do bilhete — sem esta autorização só o Administrador corrige)</span></span>
        </label>
      )}
      <button className="c-btn c-btn-prim c-btn-bloco" style={{ marginTop: 14 }} disabled={pendente}
        onClick={() => {
          if (pin && !SENHA_RE.test(pin)) { toast("⚠️ " + SENHA_REGRA); return; }
          if (perfil === "Entregador" && !telefone.trim()) { toast("⚠️ Indique o telefone do entregador."); return; }
          onSave({ nome, perfil, telefone: telefone.trim(), podeReabrirReserva: perfil === "Gestor" ? podeReabrir : false, podeEditarStock: perfil === "Gestor" ? podeStock : false, podeEditarNomes: ["Gestor", "Vendedor", "Eventos"].includes(perfil) ? podeNomes : false, ...(pin ? { pin } : {}) });
        }}>
        {pendente ? "A guardar…" : "💾 Guardar"}
      </button>
      <button className={`c-btn ${u.ativo ? "c-btn-perigo" : "c-btn-verde"} c-btn-bloco`} style={{ marginTop: 8 }} disabled={pendente}
        onClick={() => onSave({ ativo: !u.ativo })}>
        {u.ativo ? "🚫 Desativar utilizador" : "✅ Reativar utilizador"}
      </button>
    </Modal>
  );
}

/* ============ EDITAR HORÁRIOS (Admin) ============ */
function EditHorarios({ atual, onClose }: { atual: HorarioDia[]; onClose: () => void }) {
  const { user, toast } = useSession();
  const utils = trpc.useUtils();
  const [dias, setDias] = useState<HorarioDia[]>(atual.map((d) => ({ ...d })));
  const salvar = trpc.operacao.setHorarios.useMutation({
    onSuccess: () => { toast("Horários guardados!"); utils.operacao.horarios.invalidate(); onClose(); },
    onError: (e) => toast("⚠️ " + e.message),
  });
  const set = (i: number, k: keyof HorarioDia, v: string | boolean) =>
    setDias((ds) => ds.map((d, j) => (j === i ? { ...d, [k]: v } : d)));

  return (
    <Modal onClose={onClose}>
      <h3>🕐 Horário de Funcionamento</h3>
      <p className="c-sub">Defina os dias e horas de abertura. Saem na página de configurações.</p>
      <div style={{ maxHeight: "52dvh", overflowY: "auto" }}>
        {dias.map((d, i) => (
          <div key={d.dia} className="c-card" style={{ margin: "0 0 8px", padding: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <b style={{ fontSize: 13.5 }}>{d.dia}</b>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>
                <input type="checkbox" checked={d.aberto} onChange={(e) => set(i, "aberto", e.target.checked)} />
                Aberto
              </label>
            </div>
            {d.aberto && (
              <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
                <input className="c-input" type="time" value={d.abre} onChange={(e) => set(i, "abre", e.target.value)} style={{ flex: 1 }} />
                <span className="c-sub">às</span>
                <input className="c-input" type="time" value={d.fecha} onChange={(e) => set(i, "fecha", e.target.value)} style={{ flex: 1 }} />
              </div>
            )}
          </div>
        ))}
      </div>
      <button className="c-btn c-btn-prim c-btn-bloco" disabled={salvar.isPending}
        onClick={() => user && salvar.mutate({ adminId: user.id, horarios: dias })}>
        {salvar.isPending ? "A guardar…" : "💾 Guardar Horários"}
      </button>
    </Modal>
  );
}

/* ============ EDITAR BAIRROS (Admin) ============ */
function EditBairros({ atual, onClose }: { atual: string[]; onClose: () => void }) {
  const { user, toast } = useSession();
  const utils = trpc.useUtils();
  const [lista, setLista] = useState<string[]>(atual);
  const [novo, setNovo] = useState("");
  const salvar = trpc.operacao.setBairros.useMutation({
    onSuccess: () => { toast("Bairros guardados!"); utils.operacao.bairros.invalidate(); onClose(); },
    onError: (e) => toast("⚠️ " + e.message),
  });

  const add = () => {
    const b = novo.trim();
    if (b.length < 2) return;
    if (lista.some((x) => x.toLowerCase() === b.toLowerCase())) { toast("⚠️ Esse bairro já existe."); return; }
    setLista((l) => [...l, b].sort((a, b2) => a.localeCompare(b2, "pt")));
    setNovo("");
  };

  return (
    <Modal onClose={onClose}>
      <h3>📍 Bairros de Entrega</h3>
      <p className="c-sub">Lista de bairros de Chimoio que aparece no dropdown de delivery da loja online.</p>
      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <input className="c-input" style={{ flex: 1 }} value={novo} placeholder="Nome do bairro"
          onChange={(e) => setNovo(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
        <button className="c-btn c-btn-prim c-btn-peq" onClick={add}>＋</button>
      </div>
      <div style={{ maxHeight: "46dvh", overflowY: "auto" }}>
        {lista.map((b) => (
          <div className="c-linha" key={b} style={{ padding: "6px 0" }}>
            <div className="grow tit" style={{ fontSize: 13.5 }}>{b}</div>
            <button className="c-btn c-btn-perigo c-btn-peq" onClick={() => setLista((l) => l.filter((x) => x !== b))}>✕</button>
          </div>
        ))}
      </div>
      <button className="c-btn c-btn-prim c-btn-bloco" style={{ marginTop: 10 }} disabled={salvar.isPending || lista.length === 0}
        onClick={() => user && salvar.mutate({ adminId: user.id, bairros: lista })}>
        {salvar.isPending ? "A guardar…" : `💾 Guardar ${lista.length} bairros`}
      </button>
    </Modal>
  );
}

/* ============ ALTERAR A MINHA SENHA (qualquer utilizador) ============ */
function MinhaSenha({ onClose }: { onClose: () => void }) {
  const { user, toast } = useSession();
  const [antiga, setAntiga] = useState("");
  const [nova, setNova] = useState("");
  const [nova2, setNova2] = useState("");
  const trocar = trpc.usuarios.trocarSenha.useMutation({
    onSuccess: () => { toast("✅ Senha alterada com sucesso!"); onClose(); },
    onError: (e) => toast("⚠️ " + e.message),
  });
  return (
    <Modal onClose={onClose}>
      <h3>🔑 Alterar a minha senha</h3>
      <label className="c-label">Senha actual</label>
      <SenhaInput value={antiga} onChange={setAntiga} />
      <label className="c-label">Nova senha forte</label>
      <SenhaInput value={nova} onChange={setNova} placeholder={SENHA_REGRA} />
      {nova && !SENHA_RE.test(nova) && <p style={{ color: "var(--vermelho-c)", fontSize: 12 }}>⚠️ {SENHA_REGRA}</p>}
      <label className="c-label">Repetir a nova senha</label>
      <SenhaInput value={nova2} onChange={setNova2} />
      {nova2 && nova !== nova2 && <p style={{ color: "var(--vermelho-c)", fontSize: 12 }}>⚠️ As senhas não coincidem.</p>}
      <button className="c-btn c-btn-prim c-btn-bloco" style={{ marginTop: 14 }}
        disabled={trocar.isPending || !antiga || !SENHA_RE.test(nova) || nova !== nova2}
        onClick={() => user && trocar.mutate({ usuarioId: user.id, senhaAntiga: antiga, senhaNova: nova })}>
        {trocar.isPending ? "A guardar…" : "🔐 Guardar nova senha"}
      </button>
    </Modal>
  );
}

/* ============ PRESENÇA — quem está online (Admin, no Dashboard) ============ */
export function PresencaCard() {
  const { user } = useSession();
  const stats = trpc.presenca.stats.useQuery(
    { adminId: user?.id ?? 0 },
    { enabled: user?.perfil === "Admin", refetchInterval: 20000, retry: false },
  );
  if (user?.perfil !== "Admin" || !stats.data) return null;
  return (
    <div className="c-card" style={{ background: "#eef7ee" }}>
      <div className="c-titulo" style={{ fontSize: 15 }}>🟢 Online agora</div>
      <div style={{ display: "flex", gap: 16, fontSize: 14 }}>
        <span>🛍️ Loja pública: <b>{stats.data.loja}</b> {stats.data.loja === 1 ? "cliente" : "clientes"}</span>
        <span>🖥️ Sistema: <b>{stats.data.sistema}</b> {stats.data.sistema === 1 ? "usuário" : "usuários"}</span>
      </div>
    </div>
  );
}

/** Horário-limite do delivery — editável apenas pelo Admin */
function DeliveryHorarioCard({ isAdmin }: { isAdmin: boolean }) {
  const { user, toast } = useSession();
  const utils = trpc.useUtils();
  const q = trpc.operacao.deliveryHorario.useQuery();
  const [editar, setEditar] = useState(false);
  const [semana, setSemana] = useState("");
  const [fimSemana, setFimSemana] = useState("");
  const salvar = trpc.operacao.setDeliveryHorario.useMutation({
    onSuccess: () => { toast("Horário de delivery guardado!"); utils.operacao.deliveryHorario.invalidate(); setEditar(false); },
    onError: (e) => toast("⚠️ " + e.message),
  });
  const d = q.data;
  if (!d) return null;
  return (
    <div style={{ marginTop: 6 }}>
      <div className="c-linha"><div className="grow tit">Terça a Sexta</div><span className="c-chip c-chip-roxo">até às {d.semana}</span></div>
      <div className="c-linha"><div className="grow tit">Sábado e Domingo</div><span className="c-chip c-chip-roxo">até às {d.fimSemana}</span></div>
      <p className="c-sub" style={{ margin: "6px 0 0" }}>
        Depois do limite, o delivery só continua se a equipa estiver a trabalhar e ainda não tiver declarado o fecho do estabelecimento.
      </p>
      {isAdmin && !editar && (
        <button className="c-btn c-btn-linha c-btn-peq" style={{ marginTop: 6 }}
          onClick={() => { setSemana(d.semana); setFimSemana(d.fimSemana); setEditar(true); }}>
          ✏️ Editar
        </button>
      )}
      {isAdmin && editar && (
        <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
          <label className="c-label">Terça a Sexta — aceite até:
            <input className="c-input" type="time" value={semana} onChange={(e) => setSemana(e.target.value)} />
          </label>
          <label className="c-label">Sábado e Domingo — aceite até:
            <input className="c-input" type="time" value={fimSemana} onChange={(e) => setFimSemana(e.target.value)} />
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="c-btn c-btn-prim grow" disabled={salvar.isPending || !semana || !fimSemana}
              onClick={() => user && salvar.mutate({ adminId: user.id, semana, fimSemana })}>
              {salvar.isPending ? "A guardar…" : "💾 Guardar"}
            </button>
            <button className="c-btn c-btn-cinza grow" onClick={() => setEditar(false)}>Cancelar</button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ============ v17 — CONTROLO DE ACESSO DOS VENDEDORES (Admin e Gestor) ============
   · O acesso dos vendedores abre/fecha sozinho com o horário do dia.
   · A gerência pode: estender o fecho de HOJE, desbloquear um vendedor até uma
     hora (ex.: ainda há clientes a consumir) e bloquear manualmente no fecho. */
function AcessoVendedoresCard() {
  const { user, toast } = useSession();
  const utils = trpc.useUtils();
  const q = trpc.usuarios.listarAcessoVendedores.useQuery(
    { usuarioId: user?.id ?? 0 },
    { enabled: !!user, refetchInterval: 30_000, retry: false },
  );
  const mut = trpc.usuarios.controloAcesso.useMutation({
    onSuccess: () => { toast("✅ Acesso actualizado."); utils.usuarios.listarAcessoVendedores.invalidate(); },
    onError: (e) => toast("⚠️ " + e.message),
  });
  const [horas, setHoras] = useState<Record<number, string>>({});
  const [novaHoraFecho, setNovaHoraFecho] = useState("");
  if (!q.data) return null;
  const { vendedores, hoje } = q.data;
  const fmtAte = (d: string | Date | null) => d ? new Date(d).toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" }) : null;
  return (
    <div className="c-card" style={{ border: "1.5px solid #fdba74", background: "#fffaf4" }}>
      <div className="c-titulo" style={{ fontSize: 15 }}>⏰ Controlo de Acesso dos Vendedores</div>
      <div className="c-sub" style={{ marginBottom: 8 }}>
        Hoje ({hoje.dia}): {hoje.aberto ? <>aberto das <b>{hoje.abre}</b> às <b>{hoje.fecha}</b></> : <b>fechado</b>}.
        O acesso abre e fecha sozinho com este horário.
      </div>

      {/* estender o fecho de HOJE (vale para todos os vendedores) */}
      <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 10 }}>
        <input className="c-input" type="time" style={{ maxWidth: 120 }} value={novaHoraFecho} onChange={(e) => setNovaHoraFecho(e.target.value)} />
        <button className="c-btn c-btn-linha c-btn-peq" disabled={!novaHoraFecho || mut.isPending}
          onClick={() => user && mut.mutate({ usuarioId: user.id, accao: "estenderFecho", hora: novaHoraFecho })}>
          🕘 Estender o fecho de hoje
        </button>
      </div>

      {vendedores.length === 0 && <div className="c-sub">Sem vendedores activos.</div>}
      {vendedores.map((v) => (
        <div key={v.id} style={{ borderTop: "1px solid #fde3c7", paddingTop: 8, marginTop: 8 }}>
          <div className="c-linha">
            <div className="grow tit">
              {v.nome}{" "}
              {v.permitidoAgora
                ? <span className="c-chip c-chip-verde">🟢 com acesso{v.desbloqueadoAte ? ` (até ${fmtAte(v.desbloqueadoAte)})` : ""}</span>
                : <span className="c-chip c-chip-vermelho">🔒 bloqueado{v.bloqueioManual ? " (manual)" : ""}</span>}
            </div>
            <button className="c-btn c-btn-cinza c-btn-peq" disabled={mut.isPending}
              title="Bloquear manualmente (ex.: ao fechar a loja ou após um atendimento fora de horas)"
              onClick={() => user && mut.mutate({ usuarioId: user.id, accao: "bloquearManual", vendedorId: v.id, bloquear: true })}>
              🔒 Bloquear
            </button>
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 6 }}>
            <input className="c-input" type="time" style={{ maxWidth: 120 }} value={horas[v.id] ?? ""}
              onChange={(e) => setHoras((p) => ({ ...p, [v.id]: e.target.value }))} />
            <button className="c-btn c-btn-verde c-btn-peq" disabled={!horas[v.id] || mut.isPending}
              title="Desbloquear o acesso deste vendedor até à hora indicada (hoje)"
              onClick={() => user && mut.mutate({ usuarioId: user.id, accao: "desbloquearAte", vendedorId: v.id, hora: horas[v.id] })}>
              🔓 Desbloquear até
            </button>
            {v.bloqueioManual && (
              <button className="c-btn c-btn-linha c-btn-peq" disabled={mut.isPending}
                onClick={() => user && mut.mutate({ usuarioId: user.id, accao: "bloquearManual", vendedorId: v.id, bloquear: false })}>
                ↩️ Tirar bloqueio manual
              </button>
            )}
          </div>
        </div>
      ))}
      <div className="c-sub" style={{ marginTop: 8 }}>
        ⚠️ Depois do atendimento ou ao fechar a loja, bloqueie manualmente os acessos que tenham sido desbloqueados fora de horas.
      </div>
    </div>
  );
}
