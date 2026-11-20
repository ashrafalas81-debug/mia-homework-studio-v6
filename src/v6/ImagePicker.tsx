import { useEffect, useState } from 'react';
import { api } from '../store';
import { toJpeg } from './readFile';

export type PickedImage = { data: string; credit: string; width: number; height: number };

type Item = { thumb: string; full: string; title: string; credit: string; license: string; source: string; page: string };

/** Loads any image URL (data/svg/png) into a JPEG data URL with its size. */
async function normalise(url: string): Promise<PickedImage & { credit: '' }> {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error('مقدرتش أفتح الصورة.')); img.src = url; });
  const w = img.naturalWidth || 800, h = img.naturalHeight || 600;
  const canvas = document.createElement('canvas');
  const k = Math.min(1, 1600 / Math.max(w, h));
  canvas.width = Math.round(w * k); canvas.height = Math.round(h * k);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return { data: await toJpeg(canvas), credit: '', width: canvas.width, height: canvas.height };
}

/**
 * Student-controlled image choice: search licensed libraries (Wikimedia Commons + Openverse),
 * upload their own picture, or choose no image.
 */
export function ImagePicker({ query, title, onPick, close, allowNone = true }: { query: string; title: string; onPick: (img: PickedImage | null) => void; close: () => void; allowNone?: boolean }) {
  const [q, setQ] = useState(query);
  const [items, setItems] = useState<Item[] | null>(null);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const search = async (text: string) => {
    if (text.trim().length < 2) return;
    setItems(null); setErr(''); setBusy('بدوّر…');
    try { const r = await api('v6/images/search', { query: text.trim().slice(0, 110) }); setItems(r.results || []); if (!r.results?.length) setErr('ملقيتش صور مناسبة. جرّب كلمات أبسط بالإنجليزي، زي "shoulder anatomy".'); }
    catch (e) { setErr((e as Error).message); setItems([]); }
    setBusy('');
  };
  useEffect(() => { if (query.trim().length >= 2) search(query); else setItems([]); }, []);
  const choose = async (it: Item) => {
    setBusy('بنزّل الصورة…');
    try {
      const r = await api('v6/images/fetch', { url: it.full });
      const img = await normalise(r.data);
      onPick({ ...img, credit: it.credit });
      close();
    } catch (e) { setErr((e as Error).message); }
    setBusy('');
  };
  const upload = async (f: File | undefined) => {
    if (!f) return;
    setBusy('بجهز صورتك…');
    try { const img = await normalise(URL.createObjectURL(f)); onPick(img); close(); }
    catch (e) { setErr((e as Error).message); }
    setBusy('');
  };
  return (
    <div className="sheet-bg" onClick={close}>
      <div className="sheet picker" onClick={e => e.stopPropagation()} dir="rtl">
        <div className="sheet-hd"><b>🖼️ {title}</b><button className="icon-btn" onClick={close} aria-label="إغلاق">✕</button></div>
        <div className="sheet-body">
          <form className="pick-search" onSubmit={e => { e.preventDefault(); search(q); }}>
            <input dir="auto" value={q} onChange={e => setQ(e.target.value)} placeholder="ابحث بالإنجليزي: shoulder anatomy" />
            <button className="primary">بحث</button>
          </form>
          <div className="pick-actions">
            <label className="ghost">📷 صورة من موبايلك<input type="file" accept="image/*" onChange={e => upload(e.target.files?.[0])} /></label>
            {allowNone && <button className="ghost" onClick={() => { onPick(null); close(); }}>🚫 من غير صورة</button>}
          </div>
          {busy && <p className="hint">⏳ {busy}</p>}
          {err && <p className="hint">{err}</p>}
          {!items && <div className="pick-grid">{Array.from({ length: 6 }, (_, i) => <span key={i} className="pick-ph" />)}</div>}
          {items && items.length > 0 && <div className="pick-grid">{items.map((it, i) => (
            <button key={i} className="pick-item" onClick={() => choose(it)} disabled={!!busy} title={it.credit}>
              <img src={it.thumb} alt={it.title} loading="lazy" referrerPolicy="no-referrer" onError={e => { const b = (e.currentTarget.closest('button') as HTMLElement | null); if (b) b.style.display = 'none'; }} />
              <small>{it.source} · {it.license}</small>
            </button>
          ))}</div>}
          <p className="hint">الصور من مكتبات مفتوحة ومرخّصة (Wikimedia Commons و Openverse)، واسم صاحبها بيتكتب تحت الصورة تلقائيًا.</p>
        </div>
      </div>
    </div>
  );
}
