import { useMemo, useState } from "react";
import { trpc } from "@/providers/trpc";
import { useSession } from "@/lib/session";
import { mt, fmt } from "@/lib/fmt";
import { Modal, Vazio, Voltar } from "@/components/bits";
import MoneyInput from "@/components/MoneyInput";
import { useEmpresa } from "@/lib/empresa";
import { menuHtml, printMenu, downloadMenuPdf } from "@/lib/docprint";
import { fileToDataUrl } from "@/lib/img";

type Prod = {
  id: number; codigo: string; nome: string; categoria: string; tipo: string; preco: number;
  precoCompra?: number;
  ingredientes?: string | null;
  foto?: string | null; estoqueMin: number; estoqueAtual: number;
  estoqueRefId?: number | null; fraccao?: number; qtdDecimal?: boolean;
};
/** Campos de stock fraccionado partilhados pelos formulários de produto */
type FracCfg = { estoqueRefId: number | null; fraccao: number; qtdDecimal: boolean };

export default function Produtos({ voltar }: { voltar: () => void }) {
  const { user, toast } = useSession();
  const utils = trpc.useUtils();
  const emp = useEmpresa();
  const produtos = trpc.produtos.list.useQuery();
  const [busca, setBusca] = useState("");
  const [editar, setEditar] = useState<Prod | null>(null);
  const [novo, setNovo] = useState(false);
  const [gerirCat, setGerirCat] = useState(false);
  const [baixandoMenu, setBaixandoMenu] = useState(false);
  const categoriasQ = trpc.operacao.categorias.useQuery();
  const categorias = categoriasQ.data ?? [];

  const isAdmin = user?.perfil === "Admin" || user?.perfil === "Gestor";
  const isAdminTotal = user?.perfil === "Admin";

  const update = trpc.produtos.update.useMutation({
    onSuccess: () => { toast("Produto atualizado!"); setEditar(null); utils.produtos.list.invalidate(); },
    onError: (e) => toast("⚠️ " + e.message),
  });
  const create = trpc.produtos.create.useMutation({
    onSuccess: (r) => { toast(`Produto ${r.codigo} adicionado!`); setNovo(false); utils.produtos.list.invalidate(); },
    onError: (e) => toast("⚠️ " + e.message),
  });
  const desativar = trpc.produtos.desativar.useMutation({
    onSuccess: () => { toast("Produto retirado do menu"); setEditar(null); utils.produtos.list.invalidate(); },
    onError: (e) => toast("⚠️ " + e.message),
  });
  const eliminar = trpc.produtos.eliminar.useMutation({
    onSuccess: () => { toast("Produto eliminado definitivamente"); utils.produtos.list.invalidate(); },
    onError: (e) => toast("⚠️ " + e.message),
  });

  const [cat, setCat] = useState("Todos");
  const cats = useMemo(
    () => ["Todos", ...new Set((produtos.data ?? []).map((p) => p.categoria))],
    [produtos.data],
  );
  const lista = useMemo(
    () => (produtos.data ?? []).filter((p) =>
      (cat === "Todos" || p.categoria === cat) &&
      (busca === "" || p.nome.toLowerCase().includes(busca) || p.categoria.toLowerCase().includes(busca) || p.codigo.toLowerCase().includes(busca))),
    [produtos.data, busca, cat],
  );

  return (
    <div>
      <Voltar onClick={voltar} />
      <div className="c-titulo">📦 Produtos & Preços</div>

      {isAdmin && (
        <button className="c-btn c-btn-prim c-btn-bloco" style={{ marginBottom: 12 }} onClick={() => setNovo(true)}>
          ＋ Adicionar Novo Produto
        </button>
      )}

      {isAdmin && (
        <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
          <button className="c-btn c-btn-linha" style={{ flex: 1 }}
            onClick={() => setGerirCat(true)}>
            🗂 Categorias
          </button>
          <button className="c-btn c-btn-linha" style={{ flex: 1 }} disabled={baixandoMenu}
            title="Imprime o menu com os preços ACTUAIS — lê os dados directamente da base de dados antes de gerar"
            onClick={async () => {
              setBaixandoMenu(true);
              try {
                const [ps, bs] = await Promise.all([utils.produtos.list.fetch(), utils.buffet.list.fetch()]);
                printMenu(menuHtml(ps ?? [], emp, bs ?? []));
              }
              finally { setBaixandoMenu(false); }
            }}>
            {baixandoMenu ? "A gerar…" : "🖨 Imprimir Menu"}
          </button>
          <button className="c-btn c-btn-linha" style={{ flex: 1 }} disabled={baixandoMenu}
            title="Baixa o menu em PDF com os preços ACTUAIS — lê os dados directamente da base de dados antes de gerar"
            onClick={async () => {
              setBaixandoMenu(true);
              try {
                const [ps, bs] = await Promise.all([utils.produtos.list.fetch(), utils.buffet.list.fetch()]);
                await downloadMenuPdf(menuHtml(ps ?? [], emp, bs ?? []), "Menu-Camis-Eventos.pdf");
              }
              finally { setBaixandoMenu(false); }
            }}>
            {baixandoMenu ? "A gerar…" : "⬇️ Baixar Menu"}
          </button>
        </div>
      )}

      <div style={{ position: "relative", marginBottom: 12 }}>
        <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", opacity: .6 }}>🔍</span>
        <input className="c-input" style={{ paddingLeft: 38 }} placeholder="Pesquisar por nome, categoria ou código…"
          onChange={(e) => setBusca(e.target.value.toLowerCase())} />
      </div>

      {/* categorias em botões — toque numa para ver só os produtos dela (página mais curta) */}
      <div className="c-cats">
        {cats.map((c) => (
          <button key={c} className={c === cat ? "ativo" : ""} onClick={() => setCat(c)}>{c}</button>
        ))}
      </div>

      <div className="c-card"><b>{lista.length}</b> de {produtos.data?.length ?? 0} produtos{cat !== "Todos" ? ` · ${cat}` : ""}</div>

      <div className="c-card">
        {produtos.isLoading && <Vazio icon="⏳">A carregar…</Vazio>}
        {lista.map((p) => (
          <div className="c-linha" key={p.id}>
            {p.foto && (
              <img src={p.foto} alt="" style={{ width: 40, height: 40, borderRadius: 10, objectFit: "cover", marginRight: 10 }} />
            )}
            <div className="grow">
              <div className="tit">{p.nome}</div>
              <div className="det">{p.codigo} · {p.categoria} · {p.tipo}
                {p.tipo !== "Serviço" ? p.estoqueRefId
                  ? ` · ${p.fraccao === 0.25 ? "¼" : p.fraccao === 0.5 ? "½" : "1"} de ${(produtos.data ?? []).find((m) => m.id === p.estoqueRefId)?.nome ?? "mãe"}`
                  : ` · stock ${p.qtdDecimal ? `${String(p.estoqueAtual).replace(".", ",")} kg` : p.estoqueAtual}` : ""}
                {p.foto ? " · 📷" : ""}</div>
              {p.ingredientes && (
                <div className="det" style={{ fontStyle: "italic", color: "var(--roxo)" }}>🧾 {p.ingredientes}</div>
              )}
            </div>
            <div className="fim">
              <b style={{ color: "var(--roxo)" }}>{mt(p.preco)}</b><br />
              {(p.precoCompra ?? 0) > 0 && (
                <span className="c-sub" style={{ fontSize: 11 }}>
                  margem {fmt(((p.preco - (p.precoCompra ?? 0)) / p.preco) * 100)}%
                </span>
              )}
              <div style={{ display: "flex", gap: 6, marginTop: 4, justifyContent: "flex-end" }}>
                {isAdmin && (
                  <button className="c-btn c-btn-linha c-btn-peq" onClick={() => setEditar(p)}>✏️ Editar</button>
                )}
                {isAdminTotal && (
                  <button
                    className="c-btn c-btn-perigo c-btn-peq"
                    title="Eliminar definitivamente (apenas Admin)"
                    onClick={() => {
                      if (confirm(`Eliminar «${p.nome}» do menu definitivamente?\n\nSe o produto tiver histórico de vendas, o sistema irá propor «Desativar».`))
                        user && eliminar.mutate({ usuarioId: user.id, id: p.id });
                    }}
                  >
                    🗑
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {editar && user && (
        <EditProduto
          p={editar}
          categorias={categorias}
          produtos={produtos.data ?? []}
          onClose={() => setEditar(null)}
          onSave={(d) => update.mutate({ usuarioId: user.id, id: editar.id, ...d })}
          onDesativar={() => {
            if (confirm(`Retirar «${editar.nome}» do menu? (o histórico de vendas é mantido)`))
              desativar.mutate({ usuarioId: user.id, id: editar.id });
          }}
          pendente={update.isPending || desativar.isPending}
        />
      )}
      {gerirCat && <CategoriasModal onClose={() => setGerirCat(false)} />}
      {novo && user && (
        <NovoProduto
          categorias={categorias}
          produtos={produtos.data ?? []}
          onClose={() => setNovo(false)}
          onSave={(d) => create.mutate({ usuarioId: user.id, ...d })}
          pendente={create.isPending}
        />
      )}
    </div>
  );
}

/** Secção «stock fraccionado / por peso» usada nos formulários de produto. */
function FracSection({ produtos, excluirId, valor, onChange }: {
  produtos: Prod[]; excluirId?: number; valor: FracCfg; onChange: (v: FracCfg) => void;
}) {
  const maes = produtos.filter((m) => !m.estoqueRefId && m.id !== excluirId && m.tipo !== "Serviço");
  const mae = valor.estoqueRefId != null ? produtos.find((m) => m.id === valor.estoqueRefId) : null;
  return (
    <div style={{ border: "1px solid var(--borda)", borderRadius: 12, padding: 12, marginTop: 12, background: "var(--cinza, #fafafa)" }}>
      <b style={{ fontSize: 13 }}>🐔 Stock fraccionado / por peso (opcional)</b>
      <p className="c-sub" style={{ fontSize: 11.5, marginTop: 4 }}>
        Para produtos vendidos em fracções (1/4, 1/2…) de uma unidade «mãe» (ex.: frango inteiro), ou vendidos a peso (kg).
      </p>
      <label className="c-label">Unidade de stock («produto mãe»)</label>
      <select className="c-select" value={valor.estoqueRefId ?? ""}
        onChange={(e) => {
          const id = e.target.value === "" ? null : +e.target.value;
          onChange({ ...valor, estoqueRefId: id, fraccao: id == null ? 1 : valor.fraccao });
        }}>
        <option value="">— stock próprio (padrão) —</option>
        {maes.map((m) => <option key={m.id} value={m.id}>{m.nome} ({m.codigo})</option>)}
      </select>
      {valor.estoqueRefId != null && (
        <>
          <label className="c-label">Cada unidade vendida consome…</label>
          <select className="c-select" value={valor.fraccao} onChange={(e) => onChange({ ...valor, fraccao: +e.target.value })}>
            <option value={0.25}>¼ (25%) de «{mae?.nome}»</option>
            <option value={0.5}>½ (50%) de «{mae?.nome}»</option>
            <option value={1}>1 unidade inteira</option>
          </select>
          <p className="c-sub" style={{ fontSize: 11.5, marginTop: 4 }}>
            Ex.: com 10 {mae?.nome} em stock, vender 1 unidade deste produto baixa {valor.fraccao} — ficam {Math.round((10 - valor.fraccao) * 10000) / 10000}.
          </p>
        </>
      )}
      <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, fontSize: 13 }}>
        <input type="checkbox" checked={valor.qtdDecimal} onChange={(e) => onChange({ ...valor, qtdDecimal: e.target.checked })} />
        ⚖️ Vendido a peso (kg) — permite quantidades decimais (ex.: 0,750 kg)
      </label>
    </div>
  );
}

function EditProduto({ p, categorias, produtos, onClose, onSave, onDesativar, pendente }: {
  p: Prod; categorias: string[]; produtos: Prod[]; onClose: () => void;
  onSave: (d: { nome?: string; categoria?: string; tipo?: "Bebida" | "Refeição" | "Serviço"; preco?: number; precoCompra?: number; foto?: string | null; ingredientes?: string | null; estoqueMin?: number } & Partial<FracCfg>) => void;
  onDesativar: () => void;
  pendente: boolean;
}) {
  const [nome, setNome] = useState(p.nome);
  const [categoria, setCategoria] = useState(p.categoria);
  const [tipo, setTipo] = useState<"Bebida" | "Refeição" | "Serviço">(p.tipo as "Bebida" | "Refeição" | "Serviço");
  const [preco, setPreco] = useState(p.preco);
  const [precoCompra, setPrecoCompra] = useState(p.precoCompra ?? 0);
  const [min, setMin] = useState(p.estoqueMin);
  const [foto, setFoto] = useState<string | null>(p.foto ?? null);
  const [ingredientes, setIngredientes] = useState(p.ingredientes ?? "");
  const [frac, setFrac] = useState<FracCfg>({
    estoqueRefId: p.estoqueRefId ?? null,
    fraccao: p.fraccao ?? 1,
    qtdDecimal: p.qtdDecimal ?? false,
  });
  const { toast } = useSession();
  return (
    <Modal onClose={onClose}>
      <h3>✏️ Editar Produto</h3>
      <p className="c-sub">{p.codigo}</p>
      <FotoPicker foto={foto} onChange={setFoto} onErro={toast} />
      <label className="c-label">Nome</label>
      <input className="c-input" value={nome} onChange={(e) => setNome(e.target.value)} />
      <label className="c-label">Categoria</label>
      <select className="c-select" value={categoria} onChange={(e) => setCategoria(e.target.value)}>
        {!categorias.includes(categoria) && <option value={categoria}>{categoria}</option>}
        {categorias.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
      <label className="c-label">Tipo (define o grupo do menu impresso)</label>
      <select className="c-select" value={tipo} onChange={(e) => setTipo(e.target.value as "Bebida" | "Refeição" | "Serviço")}>
        <option value="Bebida">🍹 Bebida — MENU DE BEBIDAS</option>
        <option value="Refeição">🍽 Refeição — MENU DE REFEIÇÕES</option>
        <option value="Serviço">🎪 Serviço — SERVIÇOS & LAZER</option>
      </select>
      <label className="c-label">Ingredientes / acompanhantes (opcional)</label>
      <textarea className="c-input" rows={2} maxLength={500}
        placeholder="Ex. (Pizza): tomate, queijo mozzarella, fiambre, orégãos…"
        value={ingredientes} onChange={(e) => setIngredientes(e.target.value)} />
      <p className="c-sub" style={{ fontSize: 11.5, marginTop: 2 }}>Aparece no 🖨 menu impresso e na 🛒 loja online, por baixo do nome do produto.</p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
        <div><label className="c-label">Preço de venda (MZN)</label>
          <MoneyInput value={preco} onChange={setPreco} /></div>
        <div><label className="c-label">Preço de compra</label>
          <MoneyInput value={precoCompra} onChange={setPrecoCompra} /></div>
        <div><label className="c-label">Estoque Mínimo</label>
          <input className="c-input" type="number" min={0} value={min} onChange={(e) => setMin(+e.target.value || 0)} /></div>
      </div>
      {preco > 0 && precoCompra > 0 && (
        <p className="c-sub" style={{ margin: "2px 0 0" }}>
          💹 Margem: <b>{mt(preco - precoCompra)}</b> ({fmt(((preco - precoCompra) / preco) * 100)}%)
        </p>
      )}
      {p.tipo !== "Serviço" && <FracSection produtos={produtos} excluirId={p.id} valor={frac} onChange={setFrac} />}
      <button className="c-btn c-btn-prim c-btn-bloco" style={{ marginTop: 14 }} disabled={pendente}
        onClick={() => onSave({ nome, categoria, tipo, preco, precoCompra, estoqueMin: min, foto, ingredientes: ingredientes.trim() || null, estoqueRefId: frac.estoqueRefId, fraccao: frac.fraccao, qtdDecimal: frac.qtdDecimal })}>
        {pendente ? "A guardar…" : "💾 Guardar"}
      </button>
      <button className="c-btn c-btn-perigo c-btn-bloco" style={{ marginTop: 8 }} disabled={pendente}
        onClick={onDesativar}>
        🚫 Desativar (retirar do menu)
      </button>
    </Modal>
  );
}

/** Selector de foto do produto (comprime antes de guardar) */
function FotoPicker({ foto, onChange, onErro }: {
  foto: string | null; onChange: (f: string | null) => void; onErro: (m: string) => void;
}) {
  const [aLer, setALer] = useState(false);
  return (
    <div style={{ marginBottom: 6 }}>
      <label className="c-label">Foto do produto (aparece na loja online)</label>
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        {foto ? (
          <img src={foto} alt="foto" style={{ width: 72, height: 72, borderRadius: 12, objectFit: "cover" }} />
        ) : (
          <div style={{ width: 72, height: 72, borderRadius: 12, background: "var(--lilas)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26 }}>📷</div>
        )}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
          <label className="c-btn c-btn-linha c-btn-peq" style={{ textAlign: "center", cursor: "pointer" }}>
            {aLer ? "A processar…" : foto ? "🔁 Trocar foto" : "📤 Carregar foto"}
            <input type="file" accept="image/*" style={{ display: "none" }} disabled={aLer}
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (!f) return;
                setALer(true);
                try { onChange(await fileToDataUrl(f, 800, 0.82)); }
                catch (err) { onErro("⚠️ " + (err as Error).message); }
                finally { setALer(false); }
              }} />
          </label>
          {foto && (
            <button className="c-btn c-btn-cinza c-btn-peq" onClick={() => onChange(null)}>🗑 Remover foto</button>
          )}
        </div>
      </div>
    </div>
  );
}

function NovoProduto({ categorias, produtos, onClose, onSave, pendente }: {
  categorias: string[]; produtos: Prod[]; onClose: () => void;
  onSave: (d: { nome: string; categoria: string; tipo: "Bebida" | "Refeição" | "Serviço"; preco: number; precoCompra?: number; foto?: string; ingredientes?: string; estoqueMin: number; estoqueAtual: number } & FracCfg) => void;
  pendente: boolean;
}) {
  const [f, setF] = useState({ nome: "", categoria: "", tipo: "Bebida" as "Bebida" | "Refeição" | "Serviço", preco: 0, precoCompra: 0, estoqueMin: 10, estoqueAtual: 0 });
  const [frac, setFrac] = useState<FracCfg>({ estoqueRefId: null, fraccao: 1, qtdDecimal: false });
  const [foto, setFoto] = useState<string | null>(null);
  const [ingredientes, setIngredientes] = useState("");
  const { toast } = useSession();
  const set = (k: string, v: unknown) => setF((p) => ({ ...p, [k]: v }));
  return (
    <Modal onClose={onClose}>
      <h3>＋ Novo Produto</h3>
      <p className="c-sub">O código (PROD-…) é atribuído automaticamente.</p>
      <FotoPicker foto={foto} onChange={setFoto} onErro={toast} />
      <label className="c-label">Nome *</label>
      <input className="c-input" placeholder="Ex.: Sumo Tropical 1L" value={f.nome} onChange={(e) => set("nome", e.target.value)} autoFocus />
      <label className="c-label">Categoria *</label>
      <select className="c-select" value={f.categoria} onChange={(e) => set("categoria", e.target.value)}>
        <option value="">— Escolha a categoria —</option>
        {categorias.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
      <p className="c-sub" style={{ fontSize: 11.5, marginTop: 2 }}>Para criar ou renomear categorias, use o botão «🗂 Categorias» na lista de produtos.</p>
      <label className="c-label">Ingredientes / acompanhantes (opcional)</label>
      <textarea className="c-input" rows={2} maxLength={500}
        placeholder="Ex. (Pizza): tomate, queijo mozzarella, fiambre, orégãos…"
        value={ingredientes} onChange={(e) => setIngredientes(e.target.value)} />
      <p className="c-sub" style={{ fontSize: 11.5, marginTop: 2 }}>Aparece no 🖨 menu impresso e na 🛒 loja online, por baixo do nome do produto.</p>
      <label className="c-label">Tipo</label>
      <select className="c-select" value={f.tipo} onChange={(e) => set("tipo", e.target.value)}>
        <option>Bebida</option><option>Refeição</option><option>Serviço</option>
      </select>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div><label className="c-label">Preço de venda *</label>
          <MoneyInput value={f.preco} onChange={(v) => set("preco", v)} /></div>
        <div><label className="c-label">Preço de compra</label>
          <MoneyInput value={f.precoCompra} onChange={(v) => set("precoCompra", v)} /></div>
        <div><label className="c-label">Stock Inicial</label>
          <input className="c-input" type="number" min={0} value={f.estoqueAtual || ""} placeholder="0" onChange={(e) => set("estoqueAtual", +e.target.value || 0)} /></div>
        <div><label className="c-label">Stock Mín.</label>
          <input className="c-input" type="number" min={0} value={f.estoqueMin} onChange={(e) => set("estoqueMin", +e.target.value || 0)} /></div>
      </div>
      {f.tipo !== "Serviço" && <FracSection produtos={produtos} valor={frac} onChange={setFrac} />}
      <button className="c-btn c-btn-verde c-btn-bloco" style={{ marginTop: 14 }} disabled={pendente}
        onClick={() => {
          if (!f.nome.trim() || !f.categoria.trim() || f.preco <= 0) { toast("⚠️ Preencha nome, categoria e preço."); return; }
          onSave({ ...f, ...frac, ...(foto ? { foto } : {}), ...(ingredientes.trim() ? { ingredientes: ingredientes.trim() } : {}) });
        }}>
        {pendente ? "A adicionar…" : "✅ Adicionar Produto"}
      </button>
    </Modal>
  );
}

/* ============ GERIR CATEGORIAS ============ */
function CategoriasModal({ onClose }: { onClose: () => void }) {
  const { user, toast } = useSession();
  const utils = trpc.useUtils();
  const q = trpc.operacao.categorias.useQuery();
  const [nova, setNova] = useState("");
  const [editando, setEditando] = useState<string | null>(null);
  const [novoNome, setNovoNome] = useState("");

  const invalidar = () => { utils.operacao.categorias.invalidate(); utils.produtos.list.invalidate(); };
  const opts = {
    onSuccess: () => { invalidar(); setNova(""); setEditando(null); },
    onError: (e: { message: string }) => toast("⚠️ " + e.message),
  };
  const add = trpc.operacao.addCategoria.useMutation({ ...opts, onSuccess: () => { toast("🗂 Categoria adicionada!"); opts.onSuccess(); } });
  const ren = trpc.operacao.renomearCategoria.useMutation({ ...opts, onSuccess: () => { toast("✏️ Categoria renomeada em todos os produtos!"); opts.onSuccess(); } });
  const rem = trpc.operacao.removerCategoria.useMutation({ ...opts, onSuccess: () => { toast("🗑 Categoria removida."); opts.onSuccess(); } });

  return (
    <Modal onClose={onClose}>
      <h3>🗂 Categorias de produtos</h3>
      <p className="c-sub">Crie, renomeie ou remova categorias. Renomear actualiza automaticamente todos os produtos dessa categoria.</p>

      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <input className="c-input" placeholder="Nova categoria (ex.: Sobremesas)" value={nova} onChange={(e) => setNova(e.target.value)} />
        <button className="c-btn c-btn-prim" disabled={add.isPending || nova.trim().length < 2}
          onClick={() => user && add.mutate({ usuarioId: user.id, nome: nova.trim() })}>
          ＋
        </button>
      </div>

      {(q.data ?? []).map((c) => (
        <div className="c-linha" key={c}>
          {editando === c ? (
            <>
              <input className="c-input" style={{ flex: 1 }} value={novoNome} onChange={(e) => setNovoNome(e.target.value)} />
              <button className="c-btn c-btn-verde c-btn-peq" disabled={ren.isPending || novoNome.trim().length < 2}
                onClick={() => user && ren.mutate({ usuarioId: user.id, de: c, para: novoNome.trim() })}>
                💾
              </button>
              <button className="c-btn c-btn-cinza c-btn-peq" onClick={() => setEditando(null)}>✕</button>
            </>
          ) : (
            <>
              <div className="grow tit">{c}</div>
              <button className="c-btn c-btn-linha c-btn-peq" onClick={() => { setEditando(c); setNovoNome(c); }}>✏️</button>
              <button className="c-btn c-btn-perigo c-btn-peq"
                onClick={() => { if (confirm(`Remover a categoria «${c}»? (só é possível se não tiver produtos)`)) user && rem.mutate({ usuarioId: user.id, nome: c }); }}>
                🗑
              </button>
            </>
          )}
        </div>
      ))}
      {q.data?.length === 0 && <p className="c-sub">Sem categorias.</p>}

      <button className="c-btn c-btn-cinza c-btn-bloco" style={{ marginTop: 12 }} onClick={onClose}>Fechar</button>
    </Modal>
  );
}
