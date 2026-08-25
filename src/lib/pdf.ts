// Client-side rasterization of uploaded PDFs / images into page images.
// Output is JPEG (compact enough for the serverless request-body limit while
// keeping handwriting legible). Runs only in the browser.
import * as pdfjsLib from "pdfjs-dist";

if (
  typeof window !== "undefined" &&
  !pdfjsLib.GlobalWorkerOptions.workerSrc
) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;
}

const JPEG_QUALITY = 0.78;

export interface RenderedPage {
  dataUrl: string; // for on-screen display
  base64: string; // raw base64 (no prefix) for the API
  mime: "image/jpeg";
  w: number;
  h: number;
}

function canvasToPage(canvas: HTMLCanvasElement): RenderedPage {
  const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
  return {
    dataUrl,
    base64: dataUrl.slice(dataUrl.indexOf(",") + 1),
    mime: "image/jpeg",
    w: canvas.width,
    h: canvas.height,
  };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

export async function fileToPages(
  file: File,
  maxEdge = 1200,
): Promise<RenderedPage[]> {
  const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
  return isPdf ? renderPdf(file, maxEdge) : [await renderImage(file, maxEdge)];
}

/** Cheap page count (no rendering) for the upload chip's "N Pages" label. */
export async function getPageCount(file: File): Promise<number> {
  const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
  if (!isPdf) return 1;
  const buf = await file.arrayBuffer();
  const doc = await pdfjsLib.getDocument({ data: buf }).promise;
  try {
    return doc.numPages;
  } finally {
    await doc.destroy();
  }
}

async function renderPdf(file: File, maxEdge: number): Promise<RenderedPage[]> {
  const buf = await file.arrayBuffer();
  const doc = await pdfjsLib.getDocument({ data: buf }).promise;
  const pages: RenderedPage[] = [];
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(maxEdge / Math.max(base.width, base.height), 2.5);
      const viewport = page.getViewport({ scale: scale > 0 ? scale : 1 });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#ffffff"; // opaque bg (JPEG has no alpha)
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, canvasContext: ctx, viewport }).promise;
      pages.push(canvasToPage(canvas));
      page.cleanup();
    }
  } finally {
    await doc.destroy();
  }
  return pages;
}

async function renderImage(file: File, maxEdge: number): Promise<RenderedPage> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const natural = Math.max(img.naturalWidth, img.naturalHeight) || 1;
    const scale = Math.min(maxEdge / natural, 1); // never upscale a photo
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return canvasToPage(canvas);
  } finally {
    URL.revokeObjectURL(url);
  }
}
