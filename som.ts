/** Sons de alerta do sistema (Web Audio API — sem ficheiros externos).
    O primeiro som só toca depois de uma interacção do utilizador (política dos browsers). */

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  try {
    if (!ctx) ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

/** Toca uma sequência de notas (frequência Hz, duração s, pausa s) */
function tocar(notas: Array<[number, number, number]>, tipo: OscillatorType = "sine", ganho = 0.18) {
  const c = audio();
  if (!c) return;
  let t = c.currentTime + 0.02;
  for (const [freq, dur, pausa] of notas) {
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = tipo;
    o.frequency.value = freq;
    g.gain.setValueAtTime(ganho, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(c.destination);
    o.start(t);
    o.stop(t + dur);
    t += dur + pausa;
  }
}

/** 🔔 Novo pedido online — campainha alegre (3 toques ascendentes) */
export function somNovoPedido() {
  tocar([[880, 0.12, 0.04], [1108, 0.12, 0.04], [1318, 0.22, 0]]);
}

/** 💳 Pagamento/comprovativo à espera — dois toques graves de atenção */
export function somPagamento() {
  tocar([[659, 0.15, 0.06], [659, 0.15, 0.06], [523, 0.3, 0]], "triangle", 0.22);
}

/** 🛵 Solicitação de entrega ao entregador — chamada insistente */
export function somEntrega() {
  tocar([[784, 0.1, 0.05], [784, 0.1, 0.05], [988, 0.18, 0.05], [988, 0.18, 0.05], [1175, 0.3, 0]], "square", 0.1);
}

/** 📅 Lembrete de reserva — toque suave duplo */
export function somReserva() {
  tocar([[988, 0.14, 0.08], [1319, 0.25, 0]]);
}
