import { useState, type ChangeEvent, type PointerEvent as RPointerEvent } from "react";
import { trpc } from "@/providers/trpc";
import { useAfiliado, setAfiliadoToken } from "@/lib/afiliado";
import { useEmpresa } from "@/lib/empresa";
import { mt, dataBR } from "@/lib/fmt";
import { waLink } from "@/lib/loja";
import { fileToDataUrl } from "@/lib/img";
import { AF_COMISSAO_ALTA, AF_COMISSAO_BASE, AF_BONUS_META, AF_BONUS_MES, AF_BONUS_INDICACAO, AF_DIA_PAGAMENTO, AF_PROTECAO_DIAS, AF_INTERESSES, AF_INDICACAO_MIN } from "@contracts/types";

const COR = "#7B1E3B";

function CampoSenha({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [ver, setVer] = useState(false);
  return (
    <div style={{ position: "relative" }}>
      <label className="c-label">{label}</label>
      <input className="c-input" type={ver ? "text" : "password"} value={value} placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)} style={{ paddingRight: 44 }} />
      <button type="button" onClick={() => setVer(!ver)} title={ver ? "Esconder" : "Ver senha"}
        style={{ position: "absolute", right: 6, top: 27, border: "none", background: "none", fontSize: 18, cursor: "pointer", padding: 6 }}>
        {ver ? "🙈" : "👁️"}
      </button>
    </div>
  );
}

/** Editor de corte: arraste para seleccionar a área do documento antes de guardar */
function CortadorFoto({ bruta, onConfirmar, onCancelar }: {
  bruta: string; onConfirmar: (dataUrl: string) => void; onCancelar: () => void;
}) {
  const [sel, setSel] = useState<{ x: number; y: number; w: number; h: number } | null>(null); // fracções 0..1
  const [inicio, setInicio] = useState<{ x: number; y: number } | null>(null);
  const [dim, setDim] = useState<{ w: number; h: number } | null>(null);

  const posFracao = (e: RPointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    };
  };

  const confirmar = (usarTudo: boolean) => {
    const img = new Image();
    img.onload = () => {
      const f = usarTudo || !sel || sel.w < 0.02 || sel.h < 0.02
        ? { x: 0, y: 0, w: 1, h: 1 } : sel;
      const sx = Math.round(f.x * img.naturalWidth), sy = Math.round(f.y * img.naturalHeight);
      const sw = Math.round(f.w * img.naturalWidth), sh = Math.round(f.h * img.naturalHeight);
      const canvas = document.createElement("canvas");
      canvas.width = sw; canvas.height = sh;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, sw, sh);
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
      onConfirmar(canvas.toDataURL("image/jpeg", 0.85));
    };
    img.src = bruta;
  };

  return (
    <div className="c-card" style={{ border: `2px solid ${COR}` }}>
      <b style={{ fontSize: 14 }}>✂️ Ajustar a foto do documento</b>
      <p className="c-sub" style={{ fontSize: 12, margin: "4px 0 8px" }}>
        Arraste o dedo sobre a foto para seleccionar apenas o documento. Depois toque em «Confirmar corte».
      </p>
      <div
        style={{ position: "relative", touchAction: "none", userSelect: "none", borderRadius: 8, overflow: "hidden", background: "#111" }}
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); const p = posFracao(e); setInicio(p); setSel({ x: p.x, y: p.y, w: 0, h: 0 }); }}
        onPointerMove={(e) => {
          if (!inicio) return;
          const p = posFracao(e);
          setSel({ x: Math.min(inicio.x, p.x), y: Math.min(inicio.y, p.y), w: Math.abs(p.x - inicio.x), h: Math.abs(p.y - inicio.y) });
        }}
        onPointerUp={() => setInicio(null)}
      >
        <img src={bruta} alt="documento" draggable={false}
          onLoad={(e) => setDim({ w: e.currentTarget.clientWidth, h: e.currentTarget.clientHeight })}
          style={{ width: "100%", display: "block", pointerEvents: "none" }} />
        {sel && dim && (
          <>
            <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,.45)", pointerEvents: "none" }} />
            <div style={{
              position: "absolute", pointerEvents: "none",
              left: sel.x * 100 + "%", top: sel.y * 100 + "%", width: sel.w * 100 + "%", height: sel.h * 100 + "%",
              border: "2px dashed #FFD700", boxShadow: "0 0 0 9999px rgba(0,0,0,.45)", background: "transparent",
            }}>
              <span style={{ position: "absolute", right: -2, bottom: -2, width: 16, height: 16, background: "#FFD700", borderRadius: 3 }} />
            </div>
          </>
        )}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button type="button" className="c-btn c-btn-peq" style={{ flex: 1.4, background: COR, color: "#fff", border: "none" }} onClick={() => confirmar(false)}>
          ✂️ Confirmar corte
        </button>
        <button type="button" className="c-btn c-btn-peq c-btn-cinza" style={{ flex: 1 }} onClick={() => confirmar(true)}>
          🖼 Usar foto inteira
        </button>
        <button type="button" className="c-btn c-btn-peq c-btn-cinza" onClick={onCancelar}>✖</button>
      </div>
    </div>
  );
}

/** Campo de foto: escolher ficheiro OU tirar foto/scanear — com corte antes de guardar */
function FotoCampo({ label, valor, onFoto, maxDim = 1100, obrigatorio = false }: {
  label: string; valor: string; onFoto: (dataUrl: string) => void; maxDim?: number; obrigatorio?: boolean;
}) {
  const idFicheiro = useState(() => "fc-f" + Math.random().toString(36).slice(2))[0];
  const idCamara = useState(() => "fc-c" + Math.random().toString(36).slice(2))[0];
  const [bruta, setBruta] = useState("");
  const ler = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) setBruta(await fileToDataUrl(file, Math.max(1600, maxDim), 0.88)); // abre o editor de corte
    e.target.value = "";
  };
  return (
    <div style={{ marginBottom: 4 }}>
      <label className="c-label">{label}{obrigatorio ? " *" : ""}</label>
      <input id={idFicheiro} type="file" accept="image/*" style={{ display: "none" }} onChange={ler} />
      <input id={idCamara} type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={ler} />
      {bruta ? (
        <CortadorFoto bruta={bruta}
          onConfirmar={(url) => { onFoto(url); setBruta(""); }}
          onCancelar={() => setBruta("")} />
      ) : (
        <div style={{ display: "flex", gap: 8 }}>
          <label htmlFor={idFicheiro} className="c-btn c-btn-cinza c-btn-peq" style={{ flex: 1, textAlign: "center", cursor: "pointer", margin: 0 }}>
            📁 Escolher ficheiro
          </label>
          <label htmlFor={idCamara} className="c-btn c-btn-peq" style={{ flex: 1, textAlign: "center", cursor: "pointer", margin: 0, background: COR, color: "#fff", border: "none" }}>
            📷 Tirar foto / Scanear
          </label>
        </div>
      )}
      {valor && !bruta && (
        <div style={{ position: "relative", marginTop: 6 }}>
          <img src={valor} alt={label} style={{ width: "100%", maxHeight: 170, objectFit: "cover", borderRadius: 10, border: "1px solid #e5e0da" }} />
          <button type="button" onClick={() => setBruta(valor)} title="Voltar a cortar"
            style={{ position: "absolute", right: 6, top: 6, background: "rgba(0,0,0,.55)", color: "#fff", border: "none", borderRadius: 8, padding: "4px 8px", fontSize: 12, cursor: "pointer" }}>
            ✂️ Ajustar corte
          </button>
        </div>
      )}
    </div>
  );
}

/* ================= CANDIDATURA ================= */
function Candidatura({ onFeita }: { onFeita: () => void }) {
  const emp = useEmpresa();
  const cand = trpc.afiliados.candidatura.useMutation();
  const [f, setF] = useState({
    nome: "", biNumero: "", dataNascimento: "", residencia: "", email: "",
    telefone: "", telefoneAlternativo: "", senha: "", senha2: "",
    disponibilidade: "", experiencia: "", redesSociais: "",
    metodoPagamento: "M-Pesa", contaPagamento: "", nuit: "", indicadoPorCodigo: "",
  });
  const [biDoc, setBiDoc] = useState("");
  const [foto, setFoto] = useState("");
  const [erro, setErro] = useState("");
  const [ok, setOk] = useState<{ codigo: string; codigoVerificacao: string; listaEspera: boolean } | null>(null);

  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));

  const enviar = async () => {
    setErro("");
    if (f.senha !== f.senha2) { setErro("As senhas não coincidem."); return; }
    if (f.senha.length < 6) { setErro("A senha deve ter pelo menos 6 caracteres."); return; }
    if (!biDoc) { setErro("Anexe a foto do seu BI ou passaporte."); return; }
    try {
      const r = await cand.mutateAsync({
        nome: f.nome, biNumero: f.biNumero, biDocumento: biDoc,
        dataNascimento: f.dataNascimento || undefined,
        residencia: f.residencia, email: f.email, telefone: f.telefone,
        telefoneAlternativo: f.telefoneAlternativo, senha: f.senha,
        fotoPerfil: foto || undefined,
        disponibilidade: f.disponibilidade, experiencia: f.experiencia,
        redesSociais: f.redesSociais, metodoPagamento: f.metodoPagamento,
        contaPagamento: f.contaPagamento, nuit: f.nuit,
        indicadoPorCodigo: f.indicadoPorCodigo,
      });
      setOk(r);
    } catch (e) { setErro((e as Error).message); }
  };

  if (ok) {
    const msgWa = `Olá ${emp.nome}! Envio o meu código de verificação de afiliado: ${ok.codigoVerificacao} (${ok.codigo} — ${f.nome})`;
    return (
      <div className="c-card" style={{ textAlign: "center" }}>
        <div style={{ fontSize: 46 }}>🎉</div>
        <h3 style={{ color: COR, margin: "6px 0" }}>Candidatura recebida!</h3>
        <p className="c-sub">O seu código de afiliado é <b style={{ fontSize: 18 }}>{ok.codigo}</b>.</p>
        {ok.listaEspera && (
          <p style={{ background: "#FFF4D6", borderRadius: 10, padding: 10, fontSize: 13 }}>
            ⏳ As vagas da 1ª fase estão cheias — entrou automaticamente na <b>lista de espera</b> e será contactado assim que abrir uma vaga.
          </p>
        )}
        <div style={{ background: "#F5F0EB", borderRadius: 12, padding: 14, margin: "12px 0", textAlign: "left" }}>
          <b>Último passo: verificar o seu WhatsApp</b>
          <p className="c-sub" style={{ margin: "6px 0" }}>
            Toque no botão abaixo para nos enviar o código <b>{ok.codigoVerificacao}</b> a partir do número {f.telefone}. Assim confirmamos que o número é mesmo seu.
          </p>
          <a className="c-btn c-btn-prim c-btn-bloco" style={{ background: "#128C7E", textDecoration: "none", display: "block" }}
            href={waLink(emp.tel1, msgWa)} target="_blank" rel="noreferrer">
            ✅ Enviar código pelo WhatsApp
          </a>
          <p className="c-sub" style={{ fontSize: 11, marginTop: 8 }}>
            Não tem WhatsApp neste número? Sem problema — a Direcção vai validar o seu contacto alternativo presencialmente.
          </p>
        </div>
        <button className="c-btn c-btn-cinza c-btn-bloco" onClick={onFeita}>Entrar na minha conta →</button>
      </div>
    );
  }

  return (
    <div className="c-card">
      <h3 style={{ color: COR, margin: "0 0 4px" }}>📝 Candidatura a Afiliado</h3>
      <p className="c-sub">Preencha com os dados exactos do seu BI. A Direcção analisa e responde por WhatsApp.</p>

      <label className="c-label">Nome completo (como no BI) *</label>
      <input className="c-input" value={f.nome} onChange={(e) => set("nome", e.target.value)} />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div>
          <label className="c-label">Nº do BI / Passaporte *</label>
          <input className="c-input" value={f.biNumero} onChange={(e) => set("biNumero", e.target.value)} />
        </div>
        <div>
          <label className="c-label">Data de nascimento</label>
          <input className="c-input" type="date" value={f.dataNascimento} onChange={(e) => set("dataNascimento", e.target.value)} />
        </div>
      </div>
      <FotoCampo label="Foto do BI / Passaporte" obrigatorio valor={biDoc} onFoto={setBiDoc} maxDim={1100} />
      <FotoCampo label="Foto de perfil (opcional)" valor={foto} onFoto={setFoto} maxDim={400} />
      <label className="c-label">Residência (bairro, cidade) *</label>
      <input className="c-input" value={f.residencia} onChange={(e) => set("residencia", e.target.value)} placeholder="Ex.: Bairro 5, Chimoio" />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div>
          <label className="c-label">Telefone / WhatsApp *</label>
          <input className="c-input" inputMode="tel" value={f.telefone} onChange={(e) => set("telefone", e.target.value)} placeholder="84/85/86…" />
        </div>
        <div>
          <label className="c-label">Contacto alternativo</label>
          <input className="c-input" inputMode="tel" value={f.telefoneAlternativo} onChange={(e) => set("telefoneAlternativo", e.target.value)} placeholder="Se não tiver WhatsApp" />
        </div>
      </div>
      <label className="c-label">Email (opcional)</label>
      <input className="c-input" type="email" value={f.email} onChange={(e) => set("email", e.target.value)} />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <CampoSenha label="Crie uma senha *" value={f.senha} onChange={(v) => set("senha", v)} />
        <CampoSenha label="Repita a senha *" value={f.senha2} onChange={(v) => set("senha2", v)} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div>
          <label className="c-label">Método de pagamento</label>
          <select className="c-select" value={f.metodoPagamento} onChange={(e) => set("metodoPagamento", e.target.value)}>
            <option>M-Pesa</option><option>e-Mola</option><option>Conta bancária</option><option>Dinheiro</option>
          </select>
        </div>
        <div>
          <label className="c-label">Nº da conta / carteira</label>
          <input className="c-input" value={f.contaPagamento} onChange={(e) => set("contaPagamento", e.target.value)} />
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div>
          <label className="c-label">NUIT (opcional)</label>
          <input className="c-input" value={f.nuit} onChange={(e) => set("nuit", e.target.value)} />
        </div>
        <div>
          <label className="c-label">Quem o indicou? (código AF-)</label>
          <input className="c-input" value={f.indicadoPorCodigo} onChange={(e) => set("indicadoPorCodigo", e.target.value)} placeholder="Opcional" />
        </div>
      </div>
      <label className="c-label">Disponibilidade</label>
      <select className="c-select" value={f.disponibilidade} onChange={(e) => set("disponibilidade", e.target.value)}>
        <option value="">Escolher…</option>
        <option>Tempo inteiro</option><option>Part-time (manhãs)</option>
        <option>Part-time (tardes)</option><option>Fins de semana</option><option>Flexível</option>
      </select>
      <label className="c-label">Experiência em vendas (opcional)</label>
      <textarea className="c-input" rows={2} value={f.experiencia} onChange={(e) => set("experiencia", e.target.value)} />
      <label className="c-label">Redes sociais (Facebook, Instagram…)</label>
      <input className="c-input" value={f.redesSociais} onChange={(e) => set("redesSociais", e.target.value)} />

      {erro && <p style={{ color: "#b91c1c", fontSize: 13 }}>⚠️ {erro}</p>}
      <button className="c-btn c-btn-prim c-btn-bloco" style={{ marginTop: 10, background: COR }} disabled={cand.isPending} onClick={enviar}>
        {cand.isPending ? "A enviar…" : "🚀 Enviar candidatura"}
      </button>
    </div>
  );
}

/* ================= LOGIN ================= */
function Login({ onEntrar, toast }: { onEntrar: (t: string) => void; toast: (m: string) => void }) {
  const login = trpc.afiliados.login.useMutation();
  const [tel, setTel] = useState("");
  const [senha, setSenha] = useState("");
  return (
    <div className="c-card">
      <h3 style={{ color: COR, margin: "0 0 4px" }}>🔐 Entrar</h3>
      <p className="c-sub">Área exclusiva dos afiliados CAMI'S.</p>
      <label className="c-label">Telefone</label>
      <input className="c-input" inputMode="tel" value={tel} onChange={(e) => setTel(e.target.value)} />
      <CampoSenha label="Senha" value={senha} onChange={setSenha} />
      <button className="c-btn c-btn-prim c-btn-bloco" style={{ marginTop: 10, background: COR }} disabled={login.isPending}
        onClick={() => login.mutate({ telefone: tel, senha }, {
          onSuccess: (r) => onEntrar(r.token),
          onError: (e) => toast("⚠️ " + e.message),
        })}>
        {login.isPending ? "…" : "Entrar"}
      </button>
    </div>
  );
}

/* ================= PAINEL DO AFILIADO ================= */
function Painel({ token, afiliado, onSair, toast }: { token: string; afiliado: { codigo: string; nome: string; status: string }; onSair: () => void; toast: (m: string) => void }) {
  const emp = useEmpresa();
  const utils = trpc.useUtils();
  const painel = trpc.afiliados.painel.useQuery({ token }, { refetchInterval: 30_000 });
  const novoLead = trpc.afiliados.registarLead.useMutation();
  const leadEstado = trpc.afiliados.leadEstadoProprio.useMutation();
  const assinar = trpc.afiliados.assinarRecibo.useMutation();
  const [tab, setTab] = useState<"resumo" | "leads" | "comissoes" | "recibos" | "vagas">("resumo");
  const oport = trpc.trabalhoVagas.minhas.useQuery({ token }, { refetchInterval: 15_000 });
  const responder = trpc.trabalhoVagas.responder.useMutation({
    onSuccess: (r) => {
      toast(r.aceite ? `✅ Vaga garantida! Ficou com o lugar ${r.lugar} de ${r.de}. Apresente-se na data combinada.` : "Resposta registada. Fique atento às próximas oportunidades!");
      utils.trabalhoVagas.minhas.invalidate();
    },
    onError: (e) => { toast("⚠️ " + e.message); utils.trabalhoVagas.minhas.invalidate(); },
  });
  const ops = (oport.data ?? []) as Array<Record<string, unknown> & { destinoId: number; vagaId: number; codigo: string; dataTrabalho: string; horaInicio: string | null; area: string; descricao: string | null; vagas: number; diaria: number; limiteAceite: string | null; estado: string; aceites: number; vagasRestantes: number; passada: boolean }>;
  const pendentes = ops.filter((o) => o.estado === "Pendente" && !o.passada);
  const [lead, setLead] = useState({ nome: "", contacto: "", interesse: AF_INTERESSES[0] as string, obs: "" });
  const [assinatura, setAssinatura] = useState<Record<number, string>>({});
  const d = painel.data;

  const partilhar = () => {
    const url = `${location.origin}/?afiliado=1`;
    const msg = `🤝 Sou afiliado ${emp.nome} (código ${afiliado.codigo}). Reserve salões, decoração, piscina e restaurante comigo e use o meu código ${afiliado.codigo}! ${url}`;
    window.open(waLink("", msg), "_blank");
  };

  /* link da loja online com o código embutido — gatilhos mentais: escassez, urgência, conveniência, exclusividade */
  const linkLoja = `${location.origin}/?loja=1&ref=${afiliado.codigo}`;
  const msgLoja = `🔥 *NOVIDADE: a ${emp.nome} agora atende ONLINE!*

Já não precisa de sair de casa nem fazer fila 🙌
🍗 Refeições e bebidas geladas à sua porta
🏊 Piscina e Parque Infantil para a família
🎉 Salão e decoração para o seu evento

⏰ *ATENÇÃO:* as reservas de fim de semana esgotam rápido — quem pede primeiro, garante o lugar.

✅ Toque agora no meu link e peça em 2 minutos:
👉 ${linkLoja}

💛 Ao usar o meu link, eu acompanho pessoalmente o seu pedido do início ao fim — atendimento VIP garantido!`;

  const partilharLoja = () => window.open(waLink("", msgLoja), "_blank");
  const copiarLoja = async () => {
    try { await navigator.clipboard.writeText(msgLoja); toast("📋 Mensagem copiada! Cole no WhatsApp, Facebook ou SMS."); }
    catch { try { await navigator.clipboard.writeText(linkLoja); toast("📋 Link copiado: " + linkLoja); } catch { toast("⚠️ Copie manualmente: " + linkLoja); } }
  };

  if (!d) return <p className="c-sub" style={{ textAlign: "center", padding: 30 }}>A carregar o seu painel…</p>;
  const k = d.kpis;

  return (
    <div>
      <div className="c-card" style={{ background: `linear-gradient(120deg,${COR},#5E152C)`, color: "#fff" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {d.afiliado.fotoPerfil
            ? <img src={d.afiliado.fotoPerfil} alt="" style={{ width: 54, height: 54, borderRadius: "50%", objectFit: "cover", border: "2px solid #B8860B" }} />
            : <span style={{ fontSize: 40 }}>🤝</span>}
          <div style={{ flex: 1 }}>
            <b style={{ fontSize: 17 }}>{d.afiliado.nome}</b>
            <div style={{ fontSize: 12, opacity: .9 }}>
              {d.afiliado.codigo} · Nível {d.afiliado.nivel === "Ouro" ? "🥇 Ouro" : d.afiliado.nivel === "Prata" ? "🥈 Prata" : "🥉 Bronze"}
              {" · "}{d.afiliado.status}
              {d.afiliado.whatsVerificado ? " · ✅ WhatsApp" : " · ⏳ WhatsApp por verificar"}
            </div>
          </div>
          <button className="c-btn c-btn-peq" style={{ background: "#fff", color: COR, border: "none" }} onClick={onSair}>🚪</button>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 100, background: "rgba(255,255,255,.12)", borderRadius: 10, padding: 10, textAlign: "center" }}>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{mt(k.pendente)}</div>
            <div style={{ fontSize: 10.5, opacity: .85 }}>A receber (dia {AF_DIA_PAGAMENTO})</div>
          </div>
          <div style={{ flex: 1, minWidth: 100, background: "rgba(255,255,255,.12)", borderRadius: 10, padding: 10, textAlign: "center" }}>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{mt(k.mes)}</div>
            <div style={{ fontSize: 10.5, opacity: .85 }}>Este mês</div>
          </div>
          <div style={{ flex: 1, minWidth: 100, background: "rgba(255,255,255,.12)", borderRadius: 10, padding: 10, textAlign: "center" }}>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{k.posicao ? `#${k.posicao}` : "—"}</div>
            <div style={{ fontSize: 10.5, opacity: .85 }}>Ranking do mês</div>
          </div>
        </div>
        {k.faltaMeta > 0
          ? <div style={{ marginTop: 10, fontSize: 12, background: "rgba(184,134,11,.35)", borderRadius: 8, padding: 8 }}>🎯 Faltam <b>{mt(k.faltaMeta)}</b> em vendas este mês para ganhar o bónus de meta de <b>{mt(k.bonusMeta ?? AF_BONUS_META)}</b>!</div>
          : <div style={{ marginTop: 10, fontSize: 12, background: "rgba(18,140,126,.5)", borderRadius: 8, padding: 8 }}>🏆 Meta mensal atingida — bónus de {mt(k.bonusMeta ?? AF_BONUS_META)} garantido!</div>}
        <div style={{ marginTop: 10, background: "rgba(255,255,255,.14)", borderRadius: 12, padding: 10 }}>
          <b style={{ fontSize: 13 }}>🛍️ O seu link da loja online</b>
          <p style={{ fontSize: 11.5, margin: "4px 0 8px", opacity: .92 }}>
            Envie aos seus clientes: o seu código <b>{d.afiliado.codigo}</b> fica <b>automático</b> nas compras deles durante <b>90 dias</b> — comissões sem esforço! O link normal da loja não tem código.
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="c-btn c-btn-peq" style={{ flex: 1, background: "#128C7E", color: "#fff", border: "none" }} onClick={partilharLoja}>
              📲 Partilhar no WhatsApp
            </button>
            <button className="c-btn c-btn-peq" style={{ flex: 1, background: "#fff", color: COR, border: "none" }} onClick={() => void copiarLoja()}>
              📋 Copiar mensagem
            </button>
          </div>
        </div>
        <button className="c-btn c-btn-bloco" style={{ marginTop: 8, background: "#B8860B", color: "#fff", border: "none" }} onClick={partilhar}>
          📣 Partilhar o meu código {d.afiliado.codigo}
        </button>
      </div>

      <div style={{ display: "flex", gap: 6, margin: "10px 0" }}>
        {([["resumo", "🏠"], ["leads", `👥 Leads (${d.leads.length})`], ["comissoes", "💰 Comissões"], ["recibos", `🧾 Recibos (${d.recibos.length})`], ["vagas", `🔔 Vagas${pendentes.length > 0 ? ` (${pendentes.length})` : ""}`]] as const).map(([t, l]) => (
          <button key={t} className="c-btn c-btn-peq" onClick={() => setTab(t)}
            style={{ flex: 1, background: tab === t ? COR : "#eee", color: tab === t ? "#fff" : "#333", border: "none", fontSize: 11.5 }}>
            {l}
          </button>
        ))}
      </div>

      {tab === "resumo" && (
        <div className="c-card">
          <b>Como ganho?</b>
          <ul style={{ fontSize: 13, lineHeight: 1.7, paddingLeft: 18, margin: "8px 0" }}>
            <li><b>{AF_COMISSAO_ALTA}%</b> no aluguer do salão; <b>{AF_COMISSAO_BASE}%</b> em refeições, bebidas, piscina e parque infantil.</li>
            <li>Metade na primeira prestação do cliente, metade na última.</li>
            <li>Pagamento no <b>dia {AF_DIA_PAGAMENTO}</b> do mês seguinte, com recibo assinado aqui na app.</li>
            <li>Bónus: {mt(k.bonusMeta ?? AF_BONUS_META)} por atingir a meta mensal de vendas ({mt(k.metaMes)}) · {mt(k.bonusMes ?? AF_BONUS_MES)} Afiliado do Mês · {mt(k.bonusIndicacao ?? AF_BONUS_INDICACAO)} por cada afiliado que indicar, quando ele fizer a 1ª venda acima de {mt(k.minIndicacao ?? AF_INDICACAO_MIN)}.</li>
            <li>Os seus clientes ficam <b>protegidos por {AF_PROTECAO_DIAS} dias</b> (renováveis a cada contacto/venda).</li>
          </ul>
          <p className="c-sub" style={{ fontSize: 12 }}>Total já pago: <b>{mt(k.pago)}</b> · Vendas atribuídas: <b>{d.afiliado.vendasTotal}</b></p>
        </div>
      )}

      {tab === "leads" && (
        <div className="c-card">
          <b>👥 Registar cliente interessado (lead)</b>
          <p className="c-sub" style={{ fontSize: 12 }}>Registe ANTES da reserva para garantir a protecção de {AF_PROTECAO_DIAS} dias. A Direcção é notificada de cada lead novo.</p>
          <label className="c-label">Nome do cliente *</label>
          <input className="c-input" value={lead.nome} onChange={(e) => setLead({ ...lead, nome: e.target.value })} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <label className="c-label">Contacto *</label>
              <input className="c-input" inputMode="tel" value={lead.contacto} onChange={(e) => setLead({ ...lead, contacto: e.target.value })} />
            </div>
            <div>
              <label className="c-label">Interesse *</label>
              <select className="c-select" value={lead.interesse} onChange={(e) => setLead({ ...lead, interesse: e.target.value })}>
                {AF_INTERESSES.map((i) => <option key={i}>{i}</option>)}
              </select>
            </div>
          </div>
          <label className="c-label">Notas</label>
          <input className="c-input" value={lead.obs} onChange={(e) => setLead({ ...lead, obs: e.target.value })} placeholder="Ex.: casamento em Dezembro, ~150 convidados" />
          <button className="c-btn c-btn-prim c-btn-bloco" style={{ background: COR, marginTop: 8 }} disabled={novoLead.isPending}
            onClick={() => novoLead.mutate({ token, clienteNome: lead.nome, clienteContacto: lead.contacto, interesse: lead.interesse as never, obs: lead.obs }, {
              onSuccess: (r) => {
                toast(r.renovado ? `🔄 Protecção renovada até ${dataBR(r.protegidoAte!)}` : `✅ Lead protegido até ${dataBR(r.protegidoAte!)}`);
                setLead({ nome: "", contacto: "", interesse: AF_INTERESSES[0], obs: "" });
                utils.afiliados.painel.invalidate();
              },
              onError: (e) => toast("⚠️ " + e.message),
            })}>
            {novoLead.isPending ? "…" : "💾 Registar lead"}
          </button>
          <hr style={{ border: "none", borderTop: "1px solid #eee", margin: "14px 0" }} />
          {d.leads.length === 0 && <p className="c-sub">Ainda não tem clientes registados.</p>}
          {d.leads.map((l) => (
            <div key={l.id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 0", borderBottom: "1px solid #f0f0f0" }}>
              <span style={{ fontSize: 22 }}>{l.estado === "Convertido" ? "✅" : l.estado === "Perdido" ? "❌" : l.estado === "Negociacao" ? "💬" : "🆕"}</span>
              <div style={{ flex: 1 }}>
                <b style={{ fontSize: 13.5 }}>{l.clienteNome}</b> <span className="c-sub" style={{ fontSize: 12 }}>· {l.interesse}</span>
                <div className="c-sub" style={{ fontSize: 11.5 }}>
                  {l.clienteContacto} · protegido até {l.protegidoAte ? dataBR(l.protegidoAte) : "—"} · <b>{l.estado}</b>
                </div>
              </div>
              {["Novo", "Negociacao"].includes(l.estado) && (
                <select className="c-select" style={{ width: 118, padding: 5 }} value={l.estado}
                  onChange={(e) => leadEstado.mutate({ token, leadId: l.id, estado: e.target.value as never }, {
                    onSuccess: () => utils.afiliados.painel.invalidate(),
                    onError: (er) => toast("⚠️ " + er.message),
                  })}>
                  <option value="Novo">🆕 Novo</option>
                  <option value="Negociacao">💬 Negociação</option>
                  <option value="Perdido">❌ Perdido</option>
                </select>
              )}
            </div>
          ))}
        </div>
      )}

      {tab === "vagas" && (
        <div>
          {pendentes.length > 0 && (
            <div className="c-card" style={{ background: "#fff7e0", border: "1px solid #ecd27a", fontSize: 13 }}>
              🔔 Tem <b>{pendentes.length}</b> oportunidade{pendentes.length === 1 ? "" : "s"} de trabalho eventual à sua espera — <b>os primeiros a aceitar ficam com a vaga!</b>
            </div>
          )}
          {oport.isLoading && <div className="c-card c-sub">A carregar…</div>}
          {!oport.isLoading && ops.length === 0 && (
            <div className="c-card c-sub">Sem oportunidades de momento. Quando a CAMI'S precisar de reforço (restaurante, decoração, catering ou apoio em eventos) e o escolher, a vaga aparece aqui. ⚡</div>
          )}
          {ops.map((o) => (
            <div key={o.destinoId} className="c-card" style={{ marginTop: 10, border: o.estado === "Pendente" ? `2px solid ${COR}` : "1px solid #eee" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <b>💼 {o.area}</b>
                <span style={{ fontSize: 11, fontWeight: 700,
                  color: o.estado === "Aceite" ? "#15803d" : o.estado === "Recusado" ? "#b91c1c" : "#a16207" }}>
                  {o.estado === "Aceite" ? "✅ Vaga sua!" : o.estado === "Recusado" ? "Recusada" : "⏳ A aguardar a sua resposta"}
                </span>
              </div>
              <div style={{ fontSize: 13, marginTop: 6, lineHeight: 1.7 }}>
                📅 <b>{dataBR(o.dataTrabalho)}</b>{o.horaInicio ? <> às <b>{o.horaInicio}</b></> : null}<br />
                👥 {o.vagas} vaga{o.vagas === 1 ? "" : "s"} no total{o.estado === "Pendente" ? <> · restam <b>{o.vagasRestantes}</b></> : null} · 💵 diária <b>{mt(o.diaria)}</b><br />
                {o.descricao ? <>📋 {o.descricao}<br /></> : null}
                {o.limiteAceite && o.estado === "Pendente" && (
                  <span style={{ color: "#b91c1c", fontWeight: 600 }}>⏳ Responda até {dataBR(o.limiteAceite.slice(0, 10))} às {o.limiteAceite.slice(11, 16)} — depois a vaga desaparece.</span>
                )}
              </div>
              {o.estado === "Pendente" && !o.passada && (
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <button className="c-btn c-btn-verde" style={{ flex: 1 }} disabled={responder.isPending}
                    onClick={() => responder.mutate({ token, vagaId: o.vagaId, aceitar: true })}>
                    ✅ Aceitar — estou disponível!
                  </button>
                  <button className="c-btn c-btn-cinza" disabled={responder.isPending}
                    onClick={() => responder.mutate({ token, vagaId: o.vagaId, aceitar: false })}>
                    ✕ Não posso
                  </button>
                </div>
              )}
              {o.estado === "Aceite" && (
                <p style={{ fontSize: 12, color: "#15803d", marginTop: 6, marginBottom: 0 }}>
                  🎉 Compromisso assumido! Apresente-se no dia e local combinados. A equipa conta consigo.
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {tab === "comissoes" && (
        <div className="c-card">
          <b>💰 As minhas comissões</b>
          {d.comissoes.length === 0 && <p className="c-sub">Ainda sem comissões — registe leads e partilhe o seu código!</p>}
          {d.comissoes.map((c) => (
            <div key={c.id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 0", borderBottom: "1px solid #f0f0f0" }}>
              <span style={{ fontSize: 20 }}>{c.estado === "Paga" ? "🟢" : c.estado === "Estornada" ? "🔴" : "🟡"}</span>
              <div style={{ flex: 1 }}>
                <b style={{ fontSize: 13 }}>{mt(c.valorComissao)}</b>
                <span className="c-sub" style={{ fontSize: 11.5 }}> · {c.pct}% · {c.parcela === 1 ? "1ª metade" : "2ª metade"}</span>
                <div className="c-sub" style={{ fontSize: 11.5 }}>{c.descricao} · {c.origemRef}</div>
              </div>
              <span style={{ fontSize: 11, fontWeight: 600, color: c.estado === "Paga" ? "#15803d" : c.estado === "Estornada" ? "#b91c1c" : "#a16207" }}>
                {c.estado === "Paga" ? "Paga" : c.estado === "Estornada" ? "Estornada" : "Pendente"}
              </span>
            </div>
          ))}
        </div>
      )}

      {tab === "recibos" && (
        <div className="c-card">
          <b>🧾 Recibos de pagamento</b>
          <p className="c-sub" style={{ fontSize: 12 }}>No dia {AF_DIA_PAGAMENTO} de cada mês assine o recibo aqui (assinatura online) ou presencialmente.</p>
          {d.recibos.length === 0 && <p className="c-sub">Ainda não há recibos emitidos.</p>}
          {d.recibos.map((r) => (
            <div key={r.id} style={{ border: "1px solid #eee", borderRadius: 12, padding: 12, marginTop: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <b>{r.codigo}</b>
                <span style={{ fontSize: 12, fontWeight: 700, color: r.estado === "Pago" ? "#15803d" : r.estado === "Assinado" ? "#a16207" : COR }}>
                  {r.estado === "Pago" ? "🟢 Pago" : r.estado === "Assinado" ? "✍️ Assinado" : "📄 Emitido"}
                </span>
              </div>
              <div className="c-sub" style={{ fontSize: 12, marginTop: 4 }}>Mês: {r.mesReferencia}</div>
              <div style={{ fontSize: 12.5, marginTop: 6, lineHeight: 1.6 }}>
                Comissões: {mt(r.totalComissoes)}<br />
                {r.bonusMeta > 0 && <>🎯 Bónus meta: {mt(r.bonusMeta)}<br /></>}
                {r.bonusMes > 0 && <>🏆 Afiliado do Mês: {mt(r.bonusMes)}<br /></>}
                {r.bonusIndicacao > 0 && <>🤝 Bónus indicação: {mt(r.bonusIndicacao)}<br /></>}
                <b>Total: {mt(r.total)}</b>{r.metodo ? ` · ${r.metodo}` : ""}
              </div>
              {r.estado === "Emitido" && (
                <div style={{ marginTop: 8 }}>
                  <input className="c-input" placeholder="Digite o seu nome completo para assinar"
                    value={assinatura[r.id] ?? ""} onChange={(e) => setAssinatura({ ...assinatura, [r.id]: e.target.value })} />
                  <button className="c-btn c-btn-prim c-btn-bloco" style={{ background: COR, marginTop: 6 }} disabled={assinar.isPending}
                    onClick={() => assinar.mutate({ token, reciboId: r.id, nomeAssinatura: assinatura[r.id] ?? "" }, {
                      onSuccess: () => { toast("✍️ Recibo assinado! A Direcção fará o pagamento."); utils.afiliados.painel.invalidate(); },
                      onError: (e) => toast("⚠️ " + e.message),
                    })}>
                    ✍️ Assinar recibo online
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ================= APP ================= */
export default function AfiliadoApp() {
  const emp = useEmpresa();
  const { token, afiliado, entrar, sair } = useAfiliado();
  const [modo, setModo] = useState<"landing" | "login" | "candidatura">("landing");
  const [toastMsg, setToastMsg] = useState("");
  const toast = (m: string) => { setToastMsg(m); setTimeout(() => setToastMsg(""), 4000); };
  const sairM = trpc.afiliados.sair.useMutation();

  return (
    <div style={{ minHeight: "100vh", background: "#F7F4F0", paddingBottom: 40 }}>
      <header style={{ background: `linear-gradient(120deg,${COR},#5E152C)`, color: "#fff", padding: "16px 14px", textAlign: "center" }}>
        <img src="/icons/logo.png" alt="" style={{ width: 52, height: 52, borderRadius: "50%", background: "#fff", padding: 2, display: "block", margin: "0 auto" }} />
        <h1 style={{ margin: "6px 0 2px", fontSize: 20 }}>Programa de Afiliados</h1>
        <div style={{ fontSize: 12, opacity: .9 }}>{emp.nome} · Chimoio</div>
      </header>

      <main style={{ maxWidth: 560, margin: "0 auto", padding: "14px 14px 0" }}>
        {token && afiliado ? (
          <Painel token={token} afiliado={afiliado} toast={toast}
            onSair={() => { sairM.mutate({ token }); sair(); setAfiliadoToken(""); setModo("landing"); }} />
        ) : modo === "login" ? (
          <>
            <Login toast={toast} onEntrar={(t) => { entrar(t); }} />
            <button className="c-btn c-btn-cinza c-btn-bloco" style={{ marginTop: 8 }} onClick={() => setModo("landing")}>← Voltar</button>
          </>
        ) : modo === "candidatura" ? (
          <>
            <Candidatura onFeita={() => setModo("login")} />
            <button className="c-btn c-btn-cinza c-btn-bloco" style={{ marginTop: 8 }} onClick={() => setModo("landing")}>← Voltar</button>
          </>
        ) : (
          <>
            <div className="c-card" style={{ textAlign: "center" }}>
              <div style={{ fontSize: 44 }}>💼</div>
              <h2 style={{ color: COR, margin: "4px 0" }}>Ganhe comissões a vender eventos</h2>
              <p className="c-sub" style={{ lineHeight: 1.7 }}>
                Indique clientes para o nosso salão, restaurante, piscina e parque infantil e ganhe
                <b> {AF_COMISSAO_ALTA}%</b> no aluguer do salão e <b>{AF_COMISSAO_BASE}%</b> em refeições, bebidas, piscina e parque —
                com bónus mensais (meta, Afiliado do Mês e indicação).
              </p>
              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <button className="c-btn c-btn-prim" style={{ flex: 1, background: COR }} onClick={() => setModo("candidatura")}>🚀 Quero ser afiliado</button>
                <button className="c-btn c-btn-cinza" style={{ flex: 1 }} onClick={() => setModo("login")}>🔐 Já sou afiliado</button>
              </div>
            </div>
            <div className="c-card">
              <b>Como funciona</b>
              <ol style={{ fontSize: 13.5, lineHeight: 1.8, paddingLeft: 20, margin: "8px 0" }}>
                <li>Candidate-se aqui (leva 3 minutos — tenha o BI à mão).</li>
                <li>Receba o seu código de afiliado (AF-…).</li>
                <li>Registe os seus clientes interessados e partilhe o código.</li>
                <li>Em cada venda com o seu código, a comissão é sua — acompanhe tudo nesta página e no WhatsApp.</li>
                <li>Receba no dia {AF_DIA_PAGAMENTO} de cada mês, com recibo assinado.</li>
              </ol>
            </div>
          </>
        )}
      </main>

      {toastMsg && (
        <div style={{ position: "fixed", bottom: 18, left: "50%", transform: "translateX(-50%)", background: "#1f2937", color: "#fff", padding: "10px 18px", borderRadius: 12, zIndex: 99, maxWidth: "92vw", fontSize: 13 }}>
          {toastMsg}
        </div>
      )}
    </div>
  );
}
