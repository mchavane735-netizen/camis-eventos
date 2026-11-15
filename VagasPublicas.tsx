/* ============================================================
   PÁGINA PÚBLICA DE RECRUTAMENTO (?vagas=1) — sem login
   · Lista de vagas abertas da CAMI'S Eventos
   · Candidatura simplificada com anexo de CV
   · Subscrição de notificações de novas vagas (WhatsApp/Email)
   ============================================================ */
import { useState } from "react";
import { trpc } from "@/providers/trpc";
import TelInput from "@/components/TelInput";
import { useEmpresa } from "@/lib/empresa";
import { waLink } from "@/lib/loja";

type VagaPub = {
  id: number; titulo: string; area: string; tipo: string; local: string;
  salario: string | null; descricao: string | null; requisitos: string | null;
  oferecemos: string | null; criadoEm: string | Date;
};

function lerFicheiro(file: File): Promise<string> {
  return new Promise((ok, erro) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result));
    r.onerror = () => erro(new Error("falha"));
    r.readAsDataURL(file);
  });
}

export default function VagasPublicas() {
  const emp = useEmpresa();
  const vagas = trpc.vagas.listAbertas.useQuery(undefined, { refetchInterval: 60_000 });
  const [vaga, setVaga] = useState<VagaPub | null>(null);
  const [verVaga, setVerVaga] = useState<VagaPub | null>(null);
  const [subscrever, setSubscrever] = useState(false);
  const [feito, setFeito] = useState<{ codigo: string; vaga: string } | null>(null);

  const lista = vagas.data ?? [];

  return (
    <div style={{ maxWidth: 560, margin: "0 auto", padding: "12px 12px 60px" }}>
      {/* cabeçalho */}
      <div style={{ textAlign: "center", padding: "18px 0 6px" }}>
        <img src="/icons/logo.png" alt="CAMI'S Eventos" style={{ width: 72, height: 72, borderRadius: "50%", background: "#fff", padding: 3 }} />
        <div style={{ fontWeight: 800, fontSize: 20, letterSpacing: 1 }}>{emp.nome}</div>
        <div style={{ fontSize: 14, opacity: .8 }}>💼 Trabalhe connosco — Concursos de vagas</div>
      </div>

      {feito ? (
        <div className="c-card" style={{ textAlign: "center", padding: 22 }}>
          <div style={{ fontSize: 46 }}>🎉</div>
          <div className="c-titulo">Candidatura enviada!</div>
          <p>Recebemos a sua candidatura à vaga de <b>{feito.vaga}</b>.</p>
          <p>O seu código de candidatura é:</p>
          <div style={{ fontSize: 26, fontWeight: 900, letterSpacing: 2, color: "var(--roxo)" }}>{feito.codigo}</div>
          <p className="c-sub">Guarde este código. Entraremos em contacto pelo telefone indicado caso seja seleccionado(a) para entrevista.</p>
          <button className="c-btn c-btn-cinza c-btn-bloco" style={{ marginTop: 10 }} onClick={() => setFeito(null)}>← Ver outras vagas</button>
        </div>
      ) : vaga ? (
        <FormCandidatura vaga={vaga} onVoltar={() => setVaga(null)} onFeito={(codigo) => setFeito({ codigo, vaga: vaga.titulo })} />
      ) : (
        <>
          {vagas.isLoading && <div className="c-vazio"><span className="big">⏳</span>A carregar vagas…</div>}
          {!vagas.isLoading && lista.length === 0 && (
            <div className="c-card" style={{ textAlign: "center", padding: 22 }}>
              <div style={{ fontSize: 40 }}>📭</div>
              <div className="c-titulo" style={{ fontSize: 16 }}>De momento não há vagas abertas</div>
              <p className="c-sub">Inscreva-se abaixo para ser avisado(a) assim que abrir um novo concurso.</p>
            </div>
          )}

          {lista.map((v) => (
            <div className="c-card" key={v.id}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                <div>
                  <div style={{ fontWeight: 800, fontSize: 16 }}>{v.titulo}</div>
                  <div className="c-sub">{v.area} · {v.tipo} · 📍 {v.local}</div>
                  {v.salario && <div className="c-sub">💰 {v.salario}</div>}
                </div>
                <span className="c-chip c-chip-verde">Aberta</span>
              </div>
              <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
                <button className="c-btn c-btn-linha c-btn-peq grow" onClick={() => setVerVaga(v)}>📄 Ver detalhes</button>
                <button className="c-btn c-btn-prim c-btn-peq grow" onClick={() => setVaga(v)}>✍️ Candidatar-me</button>
              </div>
            </div>
          ))}

          {/* subscrição de notificações */}
          <div className="c-card" style={{ background: "#f7f1fc", border: "1.5px solid var(--roxo2)", marginTop: 12 }}>
            <div className="c-titulo" style={{ fontSize: 15 }}>🔔 Receber aviso de novas vagas</div>
            <p className="c-sub">Quer ser dos primeiros a saber quando abrir um novo concurso na {emp.nome}? Deixe o seu contacto — sem registo, sem compromisso.</p>
            <button className="c-btn c-btn-prim c-btn-bloco" onClick={() => setSubscrever(true)}>🔔 Quero receber notificações</button>
          </div>

          <p className="c-sub" style={{ textAlign: "center", marginTop: 14 }}>
            Dúvidas? Fale connosco pelo WhatsApp
          </p>
          <a className="c-btn c-btn-verde c-btn-bloco" href={waLink(emp.tel1, `Olá ${emp.nome}! Gostaria de saber mais sobre as vagas abertas.`)} target="_blank" rel="noreferrer">
            💬 Falar no WhatsApp
          </a>
        </>
      )}

      {/* detalhes da vaga */}
      {verVaga && (
        <div className="c-modal-fundo" onClick={() => setVerVaga(null)}>
          <div className="c-modal" onClick={(e) => e.stopPropagation()} style={{ maxHeight: "86vh", overflow: "auto" }}>
            <h3>{verVaga.titulo}</h3>
            <p className="c-sub">{verVaga.area} · {verVaga.tipo} · 📍 {verVaga.local}{verVaga.salario ? ` · 💰 ${verVaga.salario}` : ""}</p>
            {verVaga.descricao && (<><div className="c-label">O que vai fazer</div><p style={{ whiteSpace: "pre-line", fontSize: 13.5 }}>{verVaga.descricao}</p></>)}
            {verVaga.requisitos && (<><div className="c-label">Perfil do candidato</div><p style={{ whiteSpace: "pre-line", fontSize: 13.5 }}>{verVaga.requisitos}</p></>)}
            {verVaga.oferecemos && (<><div className="c-label">O que oferecemos</div><p style={{ whiteSpace: "pre-line", fontSize: 13.5 }}>{verVaga.oferecemos}</p></>)}
            <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
              <button className="c-btn c-btn-cinza grow" onClick={() => setVerVaga(null)}>Fechar</button>
              <button className="c-btn c-btn-prim grow" onClick={() => { setVaga(verVaga); setVerVaga(null); }}>✍️ Candidatar-me</button>
            </div>
          </div>
        </div>
      )}

      {subscrever && <SubscreverModal onClose={() => setSubscrever(false)} />}
    </div>
  );
}

/* ---------- formulário simplificado de candidatura ---------- */
function FormCandidatura({ vaga, onVoltar, onFeito }: { vaga: VagaPub; onVoltar: () => void; onFeito: (codigo: string) => void }) {
  const [nome, setNome] = useState("");
  const [telefone, setTelefone] = useState("");
  const [email, setEmail] = useState("");
  const [idade, setIdade] = useState("");
  const [residencia, setResidencia] = useState("");
  const [exp, setExp] = useState("0");
  const [disp, setDisp] = useState<"Imediata" | "A combinar">("Imediata");
  const [apres, setApres] = useState("");
  const [cv, setCv] = useState<{ data: string; nome: string } | null>(null);
  const [erro, setErro] = useState("");

  const enviar = trpc.vagas.candidatar.useMutation({
    onSuccess: (r) => onFeito(r.codigo),
    onError: (e) => setErro(e.message),
  });

  const escolherCv = async (f: File | null) => {
    if (!f) return;
    if (!/pdf|image\//.test(f.type)) { setErro("⚠️ O CV deve ser PDF ou imagem (JPG/PNG)."); return; }
    if (f.size > 2_400_000) { setErro("⚠️ Ficheiro demasiado grande (máx. ~2,4 MB). Comprima ou fotografe o CV."); return; }
    setErro("");
    setCv({ data: await lerFicheiro(f), nome: f.name });
  };

  const valido = nome.trim().length >= 3 && /^8[2-7]\d{7}$/.test(telefone.replace(/\D/g, "").replace(/^258/, ""));

  return (
    <div>
      <button className="c-btn c-btn-cinza c-btn-peq" style={{ marginBottom: 10 }} onClick={onVoltar}>← Voltar</button>
      <div className="c-titulo">✍️ Candidatura</div>

      {/* título da vaga sempre visível enquanto o candidato preenche */}
      <div style={{
        position: "sticky", top: 0, zIndex: 20, margin: "0 -2px 10px",
        background: "var(--roxo)", color: "#fff", borderRadius: 12,
        padding: "10px 14px", boxShadow: "0 2px 10px rgba(30,8,33,.25)",
        display: "flex", alignItems: "center", gap: 8,
      }}>
        <span style={{ fontSize: 18 }}>💼</span>
        <div>
          <div style={{ fontSize: 11, opacity: .85 }}>Está a candidatar-se à vaga de</div>
          <div style={{ fontWeight: 800, fontSize: 15, lineHeight: 1.2 }}>{vaga.titulo}</div>
          <div style={{ fontSize: 11, opacity: .85 }}>{vaga.area} · {vaga.tipo} · 📍 {vaga.local}</div>
        </div>
      </div>

      <p className="c-sub" style={{ marginBottom: 8 }}>Formulário simplificado: preencha em menos de 2 minutos. Não precisa de registo.</p>

      <div className="c-card">
        <label className="c-label">Nome completo *</label>
        <input className="c-input" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Ana Maria Sitoe" />
        <label className="c-label">Telefone / WhatsApp *</label>
        <TelInput value={telefone} onChange={setTelefone} required />
        <label className="c-label">Email (opcional)</label>
        <input className="c-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="voce@email.com" />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div>
            <label className="c-label">Idade</label>
            <input className="c-input" type="number" min={14} max={80} value={idade} onChange={(e) => setIdade(e.target.value)} placeholder="Ex.: 25" />
          </div>
          <div>
            <label className="c-label">Anos de experiência</label>
            <input className="c-input" type="number" min={0} max={50} step="0.5" value={exp} onChange={(e) => setExp(e.target.value)} />
          </div>
        </div>
        <label className="c-label">Onde reside? (bairro/cidade)</label>
        <input className="c-input" value={residencia} onChange={(e) => setResidencia(e.target.value)} placeholder="Ex.: Bairro 5, Chimoio" />
        <label className="c-label">Disponibilidade para começar</label>
        <select className="c-select" value={disp} onChange={(e) => setDisp(e.target.value as typeof disp)}>
          <option value="Imediata">Imediata</option>
          <option value="A combinar">A combinar</option>
        </select>
        <label className="c-label">Apresentação breve (porque é a pessoa certa?)</label>
        <textarea className="c-input" rows={4} value={apres} onChange={(e) => setApres(e.target.value)}
          placeholder="Ex.: Trabalhei 2 anos na cozinha de um restaurante em Chimoio, sou rápida, organizada e gosto de trabalhar em eventos…" />
        <label className="c-label">CV (PDF ou foto — opcional mas valorizado)</label>
        <input className="c-input" type="file" accept="application/pdf,image/*" onChange={(e) => escolherCv(e.target.files?.[0] ?? null)} />
        {cv && <p className="c-sub" style={{ color: "var(--verde-c)" }}>📎 {cv.nome} anexado</p>}
        {erro && <p style={{ color: "var(--vermelho-c)", fontSize: 13 }}>{erro}</p>}
        <button className="c-btn c-btn-prim c-btn-bloco" style={{ marginTop: 10 }} disabled={!valido || enviar.isPending}
          onClick={() => enviar.mutate({
            vagaId: vaga.id, nome: nome.trim(), telefone,
            email: email.trim() || undefined,
            idade: idade ? parseInt(idade) : undefined,
            residencia: residencia.trim() || undefined,
            experienciaAnos: parseFloat(exp) || 0,
            disponibilidade: disp,
            apresentacao: apres.trim() || undefined,
            cv: cv?.data, cvNome: cv?.nome,
          })}>
          {enviar.isPending ? "A enviar…" : "📨 Enviar candidatura"}
        </button>
      </div>
    </div>
  );
}

/* ---------- subscrição de notificações ---------- */
function SubscreverModal({ onClose }: { onClose: () => void }) {
  const [nome, setNome] = useState("");
  const [contacto, setContacto] = useState("");
  const [canal, setCanal] = useState<"WhatsApp" | "Email">("WhatsApp");
  const [ok, setOk] = useState(false);
  const [erro, setErro] = useState("");
  const mut = trpc.vagas.subscrever.useMutation({
    onSuccess: () => setOk(true),
    onError: (e) => setErro(e.message),
  });
  const contactoValido = canal === "WhatsApp"
    ? /^8[2-7]\d{7}$/.test(contacto.replace(/\D/g, "").replace(/^258/, ""))
    : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contacto);

  return (
    <div className="c-modal-fundo" onClick={onClose}>
      <div className="c-modal" onClick={(e) => e.stopPropagation()}>
        <h3>🔔 Notificações de novas vagas</h3>
        {ok ? (
          <>
            <p>✅ Inscrição registada! Avisaremos assim que abrir um novo concurso.</p>
            <button className="c-btn c-btn-prim c-btn-bloco" onClick={onClose}>Fechar</button>
          </>
        ) : (
          <>
            <label className="c-label">Nome *</label>
            <input className="c-input" value={nome} onChange={(e) => setNome(e.target.value)} />
            <label className="c-label">Receber por</label>
            <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
              {(["WhatsApp", "Email"] as const).map((c) => (
                <button key={c} className={`c-btn c-btn-peq ${canal === c ? "c-btn-prim" : "c-btn-cinza"}`} style={{ flex: 1 }} onClick={() => { setCanal(c); setContacto(""); }}>
                  {c === "WhatsApp" ? "💬 WhatsApp" : "✉️ Email"}
                </button>
              ))}
            </div>
            {canal === "WhatsApp" ? (
              <TelInput value={contacto} onChange={setContacto} required />
            ) : (
              <input className="c-input" type="email" value={contacto} onChange={(e) => setContacto(e.target.value)} placeholder="voce@email.com" />
            )}
            {erro && <p style={{ color: "var(--vermelho-c)", fontSize: 13 }}>{erro}</p>}
            <div style={{ display: "flex", gap: 6, marginTop: 12 }}>
              <button className="c-btn c-btn-cinza grow" onClick={onClose}>Cancelar</button>
              <button className="c-btn c-btn-prim grow" disabled={nome.trim().length < 2 || !contactoValido || mut.isPending}
                onClick={() => mut.mutate({ nome: nome.trim(), contacto: contacto.trim(), canal })}>
                {mut.isPending ? "A guardar…" : "✅ Inscrever-me"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
