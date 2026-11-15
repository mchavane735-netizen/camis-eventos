/**
 * CAMI'S EVENTOS — Fotos dos produtos
 * -----------------------------------
 * Resolve a foto de cada produto em 3 níveis:
 *  1. Foto carregada pelo Admin na base de dados (p.foto) — tem prioridade;
 *  2. Foto específica por palavras-chave do nome (ex.: hambúrguer, chamussas);
 *  3. Foto da categoria (gerada por IA, incluída na aplicação em /fotos/).
 * Assim o menu online e o restaurante mostram SEMPRE uma imagem,
 * mesmo que a base de dados não tenha foto registada.
 */

const F = (n: string) => `/fotos/${n}.jpg`;

/** Mapa categoria (normalizada) → imagem */
const POR_CATEGORIA: Record<string, string> = {
  cerveja: F("cerveja"),
  vinho: F("vinho"),
  "bebida doce": F("bebida-doce"),
  "bebida quente": F("bebida-quente"),
  aves: F("aves"),
  carne: F("carne"),
  entrada: F("fritos"),
  salgado: F("hero-hamburguer"),
  embalado: F("embalado"),
  salao: F("salao"),
  salão: F("salao"),
  wisk: F("wisk"),
  whisky: F("wisk"),
  agua: F("agua"),
  água: F("agua"),
  extra: F("extra"),
  chips: F("chips"),
  mariscos: F("mariscos"),
  peixe: F("peixe"),
  petisco: F("petisco"),
  parque: F("parque"),
  "piscina & parque": F("piscina"),
  piscina: F("piscina"),
  misturador: F("misturador"),
  massa: F("massa"),
  energetico: F("energetico"),
  energético: F("energetico"),
  refrigerante: F("refrigerante"),
  cocktail: F("cocktail-camis-special"),
  cocktails: F("cocktail-camis-special"),
  "cocktail da casa": F("cocktail-camis-special"),
};

/** Palavras-chave no nome do produto → imagem específica (prioridade sobre a categoria) */
const POR_NOME: Array<[RegExp, string]> = [
  // Cocktails do bar (fotos geradas por IA em /fotos/) — "paradise mojito" antes de "mojito"
  [/cami'?s special/i, F("cocktail-camis-special")],
  [/dohwa/i, F("cocktail-dohwa")],
  [/margarita/i, F("cocktail-margarita")],
  [/paradise mojito/i, F("cocktail-paradise-mojito")],
  [/mojito/i, F("cocktail-mojito")],
  [/old ?fashion/i, F("cocktail-old-fashion")],
  [/play in the pool|blue lagoon/i, F("cocktail-play-in-the-pool")],
  [/rose merry/i, F("cocktail-rose-merry")],
  [/side ?car/i, F("cocktail-side-car")],
  [/tequ?illa? sunrise/i, F("cocktail-tequila-sunrise")],
  // Pratos novos
  [/babalaze/i, F("babalaze")],
  [/asas/i, F("asas-frango")],
  [/amb[uú]rguer|hamb[uú]rguer|burger/i, F("hero-hamburguer")],
  [/sandes|sandwich|tosta/i, F("hero-sandes")],
  [/chamu/i, F("hero-chamussas")],
  [/rissol|riss[oó]is|croquete|cochinho|spring/i, F("fritos")],
  [/batata frita|dose de batata/i, F("hero-batata")],
  [/camar[aã]o|lula|marisco/i, F("camarao")],
  [/galinha (cafreal|zambeziana)|caril de galinha/i, F("galinha")],
  [/frango|pato|ave\b/i, F("aves")],
  [/bife|vaca|porco|cabrito|costela|grelhado/i, F("carne")],
  [/peixe|posta/i, F("peixe")],
  [/esparguete|cotovelo|massa/i, F("massa")],
  [/bolo|brigadeiro|nata|berlim|tran[cç]a|arofada|paozinho|doce/i, F("doces")],
  [/sumo|cappy|compal|ceres/i, F("sumos")],
  [/coca|fanta|sprite|refrigerante|peti/i, F("refrigerante")],
  [/caf[eé]|ch[aá]|chocolate quente/i, F("bebida-quente")],
  [/cerveja|2m|manica|txilar|brutal|laurentina|dourada|castle|heineken|corona|budweiser|stela|stella/i, F("cerveja")],
  [/vinho/i, F("vinho")],
  [/wisk|whisky|whiskey|jb|jack|red label|black label/i, F("wisk")],
  [/energ[eé]tico|red bull|monster|moçambique energy/i, F("energetico")],
  [/[aá]gua t[oó]nica|ginger|dry lemon|schwepp|shwepp/i, F("misturador")],
  [/[aá]gua/i, F("agua")],
  [/simba|lays|bon bon|chips/i, F("chips")],
  [/sal[aã]o|decora/i, F("salao")],
  [/piscina/i, F("piscina")],
  [/parque|baloi[cç]o|escorrega|balan[cç]o/i, F("parque")],
  [/sopa|mutxutxu|petisco|dobrada/i, F("petisco")],
  [/arroz|chima|pur[eê]|salada|acompanhamento|dose de/i, F("extra")],
  [/pipoca|picoca|chocolate|caramelo|mentol|pin pop|yogi/i, F("embalado")],
];

function norm(s: string): string {
  return (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
}

/** Devolve SEMPRE uma foto para o produto (data URL da BD ou imagem local) */
export function fotoProduto(p: { nome: string; categoria?: string; cat?: string; foto?: string | null }): string {
  if (p.foto) return p.foto;
  const nome = p.nome || "";
  for (const [re, img] of POR_NOME) if (re.test(nome)) return img;
  const cat = norm(p.categoria || p.cat || "");
  if (POR_CATEGORIA[cat]) return POR_CATEGORIA[cat];
  return F("default");
}

/** True se a foto vem da base de dados (carregada pelo Admin) */
export function fotoEbd(p: { foto?: string | null }): boolean {
  return !!p.foto;
}
