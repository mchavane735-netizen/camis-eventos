/** Comprime uma imagem (foto de produto ou comprovativo) para data URL JPEG */
export function fileToDataUrl(file: File, maxDim = 900, quality = 0.82): Promise<string> {
  return new Promise((resolve, reject) => {
    // PDFs e outros documentos passam sem compressão (comprovativo)
    if (!file.type.startsWith("image/")) {
      if (file.size > 4_500_000) return reject(new Error("Ficheiro demasiado grande (máx. 4 MB)"));
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(new Error("Não foi possível ler o ficheiro"));
      r.readAsDataURL(file);
      return;
    }
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const escala = Math.min(1, maxDim / Math.max(img.width, img.height));
      const w = Math.round(img.width * escala);
      const h = Math.round(img.height * escala);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Imagem inválida")); };
    img.src = url;
  });
}
