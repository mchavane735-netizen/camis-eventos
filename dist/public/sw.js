/* CAMI'S Eventos — PWA: aplicativo instalável, sempre actualizado.
   Estratégia: network-first para navegação/API (dados sempre frescos quando há
   ligação) com cache de reserva para abrir SEM ligação; versões novas instalam
   e activam-se sozinhas (skipWaiting + clients.claim) — o utilizador recebe
   sempre a última versão sem fazer nada. */
const CACHE = "camis-v5"; // ← muda a cada versão: ao mudar, os aparelhos purgam sozinhos os ficheiros antigos

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(["/", "/manifest.json", "/icons/icon-192.png"])).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return; // mutações nunca passam pela cache
  if (url.pathname.startsWith("/api/")) return; // dados sempre da rede
  const ehNavegacao = e.request.mode === "navigate";
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok && url.origin === location.origin) {
          const copia = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copia));
        }
        return res;
      })
      .catch(() =>
        caches.match(e.request).then((r) => {
          if (r) return r;
          /* FALLBACK SEGURO (v5): só a NAVEGAÇÃO (abrir/mudar de página) recebe o
             index.html guardado. Um ficheiro .js/.css NUNCA pode receber HTML —
             era isso que deixava o ecrã TODO BRANCO quando o aparelho misturava
             ficheiros de versões diferentes. */
          if (ehNavegacao) return caches.match("/");
          return Response.error();
        })
      )
  );
});
