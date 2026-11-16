/** Cetak HTML di jendela baru (andal untuk banyak halaman: lembar kartu, daftar PIN, struk). */
export function printHtml(title: string, bodyHtml: string, css = '') {
  const w = window.open('', '_blank', 'width=900,height=700');
  if (!w) { alert('Jendela cetak diblokir browser. Izinkan pop-up untuk situs ini lalu coba lagi.'); return; }
  w.document.write(`<!doctype html><html lang="id"><head><meta charset="utf-8"><title>${title}</title><style>
    *{box-sizing:border-box} body{font-family:"Segoe UI",system-ui,Arial,sans-serif;margin:0;padding:10mm;color:#0B2040}
    @page{margin:8mm} ${css}</style></head><body>${bodyHtml}</body></html>`);
  w.document.close();
  const imgs = Array.from(w.document.images);
  const go = () => { w.focus(); w.print(); };
  if (imgs.length === 0) setTimeout(go, 150);
  else { let n = imgs.length; imgs.forEach((i) => { const d = () => { if (--n === 0) setTimeout(go, 150); }; if (i.complete) d(); else { i.onload = d; i.onerror = d; } }); }
}
export const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
