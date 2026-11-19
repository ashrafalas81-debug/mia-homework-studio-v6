/**
 * Reads files students upload. Digital PDFs, Word, PowerPoint and text are read
 * locally (fast). Images, screenshots and scanned PDF pages are read by the vision
 * model on the server instead of on-device OCR, which was slow and could hang on
 * phones while downloading language data.
 */
import { extract } from '../files';
import { api } from '../store';

export type ReadResult = { name: string; text: string; image?: string; warnings: string[] };

const withTimeout = <T,>(p: Promise<T>, ms: number, msg: string) =>
  Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(msg)), ms))]);

/** Downscales an image or canvas to a JPEG data URL small enough for the vision model. */
export async function toJpeg(src: Blob | HTMLCanvasElement, max = 1600, quality = 0.82): Promise<string> {
  let w: number, h: number, draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
  if (src instanceof HTMLCanvasElement) { w = src.width; h = src.height; draw = (c, a, b) => c.drawImage(src, 0, 0, a, b); }
  else { const bmp = await createImageBitmap(src); w = bmp.width; h = bmp.height; draw = (c, a, b) => { c.drawImage(bmp, 0, 0, a, b); bmp.close(); }; }
  const k = Math.min(1, max / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * k); canvas.height = Math.round(h * k);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  draw(ctx, canvas.width, canvas.height);
  let q = quality, url = canvas.toDataURL('image/jpeg', q);
  while (url.length > 1_800_000 && q > 0.4) { q -= 0.12; url = canvas.toDataURL('image/jpeg', q); }
  return url;
}

async function vision(image: string, name: string) {
  const r = await withTimeout(api('vision', { image, name: name.slice(0, 240) }), 90000, 'قراءة الصورة أخدت وقت طويل. جرّب صورة أوضح أو أصغر.');
  const d = r.data || r;
  return [d.text, d.description].filter(Boolean).join('\n\n').trim();
}

async function scannedPdfPages(file: File, report: (s: string) => void, maxPages = 6) {
  const m = await import('pdfjs-dist');
  const worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  m.GlobalWorkerOptions.workerSrc = worker;
  const task = m.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const pdf = await task.promise;
  const n = Math.min(pdf.numPages, maxPages);
  const out: string[] = [];
  for (let i = 1; i <= n; i++) {
    report(`بقرا الصفحة ${i} من ${n} بالذكاء الاصطناعي…`);
    const page = await pdf.getPage(i);
    const v = page.getViewport({ scale: 1.4 });
    const canvas = document.createElement('canvas');
    canvas.width = v.width; canvas.height = v.height;
    await page.render({ canvasContext: canvas.getContext('2d')!, viewport: v, canvas } as any).promise;
    out.push(`[Page ${i}]\n` + await vision(await toJpeg(canvas), `${file.name} p${i}`));
  }
  await task.destroy();
  return { text: out.join('\n\n'), more: pdf.numPages > maxPages ? pdf.numPages : 0 };
}

export async function readFile(file: File, report: (s: string) => void, signal = new AbortController().signal): Promise<ReadResult> {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (!file.size || file.size > 25 * 1024 * 1024) throw new Error('الملف لازم يكون أقل من 25 ميجا.');
  if (['jpg', 'jpeg', 'png', 'webp', 'heic'].includes(ext) || file.type.startsWith('image/')) {
    report('بجهز الصورة…');
    const image = await toJpeg(file);
    report('بقرا الصورة بالذكاء الاصطناعي…');
    const text = await vision(image, file.name);
    return { name: file.name, text, image, warnings: [] };
  }
  report('بقرا الملف…');
  const a = await withTimeout(extract(file, 'instructions', false, report, signal).catch(e => {
    if (ext === 'pdf' && /OCR|No usable text/i.test(String(e?.message))) return null;
    throw e;
  }), 60000, 'قراءة الملف أخدت وقت طويل.');
  const text = a?.text || '';
  const thin = text.replace(/\[Page \d+\]/g, '').trim().length < 200;
  if (ext === 'pdf' && thin) {
    // Scanned PDF: read the first pages with the vision model.
    const s = await scannedPdfPages(file, report);
    return { name: file.name, text: s.text, warnings: s.more ? [`اتقرت أول 6 صفحات بس من ${s.more} (الملف متصوّر سكانر).`] : [] };
  }
  return { name: file.name, text, warnings: (a?.warnings || []).filter(w => !/OCR/i.test(w)) };
}
