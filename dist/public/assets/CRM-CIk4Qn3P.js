import{u as y,a as v,r as h,t as $,j as s,e as N,V as u,S as d,m as c,i as C,w as V,f as i}from"./index-CQone4IR.js";import{p as P}from"./docprint-CVLlNuS6.js";function D({voltar:f}){const{user:x}=y(),r=v(),[p,M]=h.useState(""),[l,j]=h.useState("todos"),m=$.crm.clientes.useQuery({usuarioId:x?.id??0},{enabled:!!x}),g=m.data?.lista??[],a=m.data?.resumo,n=h.useMemo(()=>{const e=p.trim().toLowerCase();return g.filter(t=>!(l==="compradores"&&t.nVendas===0||l==="perdas"&&t.nPerdas===0||l==="semContacto"&&t.telefone||e&&!t.nome.toLowerCase().includes(e)&&!(t.telefone??"").includes(e.replace(/\D/g,""))))},[g,p,l]),R=()=>{if(!n.length)return;const e=n.map((o,b)=>`
      <tr>
        <td>${b+1}</td>
        <td><b>${o.nome}</b></td>
        <td>${o.telefone??"—"}</td>
        <td style="font-size:11px">${o.origens.join(", ")}</td>
        <td style="text-align:center">${o.nVendas}</td>
        <td style="text-align:right">${i(o.totalGasto)}</td>
        <td style="text-align:right;${o.perdas>0?"color:#c0392b;font-weight:700":""}">${o.perdas>0?i(o.perdas):"—"}</td>
        <td>${o.ultimaData?C(o.ultimaData):"—"}</td>
      </tr>`).join(""),t=`
      <img class="logo" src="/icons/logo.png" alt="" />
      <div class="c nome">${r.nome}</div>
      <div class="c small">NUIT ${r.nuit} · ${r.local}</div>
      <div class="c titulo">CRM — CARTEIRA DE CLIENTES</div>
      <div class="c small">
        ${a?.totalClientes??0} clientes · ${a?.comVendas??0} compradores ·
        Vendas: ${i(a?.totalVendas??0)} MZN · Perdas: ${i(a?.totalPerdas??0)} MZN
      </div>
      <div class="sep"></div>
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead>
          <tr style="background:#581c87;color:#fff">
            <th style="padding:5px">#</th><th style="padding:5px;text-align:left">Cliente</th>
            <th style="padding:5px">Contacto</th><th style="padding:5px;text-align:left">Origens</th>
            <th style="padding:5px">Compras</th><th style="padding:5px;text-align:right">Total gasto (MZN)</th>
            <th style="padding:5px;text-align:right">Perdas (MZN)</th><th style="padding:5px">Última act.</th>
          </tr>
        </thead>
        <tbody>${e}</tbody>
      </table>
      <div class="sep"></div>
      <div class="c small">Emitido em ${new Date().toLocaleString("pt-PT")} — uso interno · na janela de impressão pode escolher «Guardar como PDF»</div>`;P(`CRM clientes — ${r.nome}`,t)};return s.jsxs("div",{"code-path":"src/pages/CRM.tsx:75:5",children:[s.jsx(N,{"code-path":"src/pages/CRM.tsx:76:7",onClick:f}),s.jsx("div",{"code-path":"src/pages/CRM.tsx:77:7",className:"c-titulo",children:"👥 CRM — Clientes"}),s.jsx("p",{"code-path":"src/pages/CRM.tsx:78:7",className:"c-sub",style:{marginTop:-6},children:"Todos os clientes do sistema: reservas, buffets, casamentos, braai, compras online, restaurante, fiado e leads dos afiliados."}),m.isLoading&&s.jsx(u,{"code-path":"src/pages/CRM.tsx:82:23",icon:"⏳",children:"A juntar os clientes de todas as origens…"}),a&&s.jsxs(s.Fragment,{children:[s.jsxs("div",{"code-path":"src/pages/CRM.tsx:86:11",style:{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:10,marginBottom:12},children:[s.jsxs(d,{"code-path":"src/pages/CRM.tsx:87:13",cls:"az",lbl:"👥 Clientes",children:[a.totalClientes," ",s.jsxs("small",{"code-path":"src/pages/CRM.tsx:87:66",children:["· ",a.comContacto," c/ contacto"]})]}),s.jsx(d,{"code-path":"src/pages/CRM.tsx:88:13",lbl:"🛒 Compradores",children:a.comVendas}),s.jsx(d,{"code-path":"src/pages/CRM.tsx:89:13",cls:"v",lbl:"💰 Vendas acumuladas",children:c(a.totalVendas)}),s.jsxs(d,{"code-path":"src/pages/CRM.tsx:90:13",cls:"vm",lbl:"⚠️ Perdas",children:[c(a.totalPerdas)," ",s.jsxs("small",{"code-path":"src/pages/CRM.tsx:90:66",children:["· ",a.nPerdas," ocorrência(s)"]})]})]}),s.jsx("input",{"code-path":"src/pages/CRM.tsx:93:11",className:"c-input",placeholder:"🔎 Buscar por nome ou telefone…",value:p,onChange:e=>M(e.target.value),style:{marginBottom:8}}),s.jsx("div",{"code-path":"src/pages/CRM.tsx:95:11",className:"c-abas",style:{marginBottom:10},children:[["todos","Todos"],["compradores","🛒 Compradores"],["perdas","⚠️ Com perdas"],["semContacto","📵 Sem contacto"]].map(([e,t])=>s.jsx("button",{"code-path":"src/pages/CRM.tsx:97:15",className:l===e?"ativo":"",onClick:()=>j(e),children:t},e))}),n.length===0&&s.jsx(u,{"code-path":"src/pages/CRM.tsx:101:37",icon:"👥",children:"Nenhum cliente encontrado."}),n.map(e=>s.jsxs("div",{"code-path":"src/pages/CRM.tsx:103:13",className:"c-card",style:{padding:"10px 12px"},children:[s.jsxs("div",{"code-path":"src/pages/CRM.tsx:104:15",className:"c-linha",style:{border:"none",padding:0},children:[s.jsxs("div",{"code-path":"src/pages/CRM.tsx:105:17",className:"grow",children:[s.jsx("b",{"code-path":"src/pages/CRM.tsx:106:19",style:{fontSize:14.5},children:e.nome}),s.jsxs("div",{"code-path":"src/pages/CRM.tsx:107:19",className:"c-sub",style:{margin:0},children:[e.telefone??"sem contacto",e.ultimaData&&s.jsxs(s.Fragment,{children:[" · última act. ",C(e.ultimaData)]})]})]}),e.telefone&&s.jsx("a",{"code-path":"src/pages/CRM.tsx:113:19",className:"c-btn c-btn-verde c-btn-peq",target:"_blank",rel:"noreferrer",href:V(e.telefone,`Olá ${e.nome.split(" ")[0]}! Aqui é a ${r.nome}. 😊`),children:"💬"})]}),s.jsx("div",{"code-path":"src/pages/CRM.tsx:117:15",style:{display:"flex",flexWrap:"wrap",gap:4,margin:"6px 0"},children:e.origens.map(t=>s.jsx("span",{"code-path":"src/pages/CRM.tsx:118:39",className:"c-chip-roxo",style:{fontSize:10.5},children:t},t))}),s.jsxs("div",{"code-path":"src/pages/CRM.tsx:120:15",style:{display:"flex",justifyContent:"space-between",fontSize:12.5},children:[s.jsxs("span",{"code-path":"src/pages/CRM.tsx:121:17",children:["🛒 ",e.nVendas," compra(s) · ",s.jsx("b",{"code-path":"src/pages/CRM.tsx:121:50",style:{color:"var(--verde-c)"},children:c(e.totalGasto)})]}),e.perdas>0?s.jsxs("span",{"code-path":"src/pages/CRM.tsx:123:21",style:{color:"var(--vermelho-c)"},children:["⚠️ ",e.nPerdas," perda(s) · ",s.jsx("b",{"code-path":"src/pages/CRM.tsx:123:92",children:c(e.perdas)})]}):s.jsx("span",{"code-path":"src/pages/CRM.tsx:124:21",className:"c-sub",style:{margin:0},children:"sem perdas"})]})]},e.nome+(e.telefone??""))),s.jsx("button",{"code-path":"src/pages/CRM.tsx:129:11",className:"c-btn c-btn-prim c-btn-bloco",style:{marginTop:8},onClick:R,disabled:n.length===0,children:"🖨️ Imprimir CRM em A4 (ou guardar em PDF)"})]})]})}export{D as default};
