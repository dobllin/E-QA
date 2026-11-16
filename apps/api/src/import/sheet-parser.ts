/**
 * Pembaca data santri + tagihan yang ditempel dari Excel / Google Sheets (dipisah tab).
 * Murni (tanpa database) supaya mudah diuji. Satu baris santri bisa menghasilkan banyak tagihan.
 *
 * Aturan:
 *  - Baris judul wajib ada (kolom pertama "NAMA"). Kolom dikenali dari judulnya, bukan dari urutan.
 *  - "Rp -" = lunas dan sel kosong = tidak ada tagihan: keduanya tidak dibuatkan tagihan. Hanya angka > 0 jadi tagihan.
 *  - Angka di ujung baris (tanpa judul) dianggap TOTAL dan harus sama dengan jumlah semua kolom uang; bila tidak sama, baris itu ditolak.
 *  - Baris yang hanya berisi satu nama (mis. "ULA/ SD IKHWAN") adalah judul bagian.
 */
export interface ParseOptions { startYear: number; entryDue: string }
export interface ColumnInfo { index: number; header: string; kind: 'name' | 'size' | 'kelas' | 'status' | 'fee' | 'spp' | 'ignored'; title?: string; period?: string; dueDate?: string; label: string }
export interface InvoiceItem { column: string; title: string; period: string; dueDate: string; amount: number }
export interface ParsedRow {
  line: number; name: string; bagian: string | null; kelas: string | null; statusLabel: string | null; catatan: string | null;
  invoices: InvoiceItem[]; sum: number; total: number | null; totalCheck: 'OK' | 'NONE' | 'MISMATCH'; warnings: string[]; errors: string[];
}
export interface ParseResult { ok: boolean; error?: string; columns: ColumnInfo[]; sections: string[]; rows: ParsedRow[]; ignoredLines: { line: number; reason: string }[] }

const norm = (s: string) => s.toLowerCase().replace(/[. ]/g, ' ').replace(/\s+/g, ' ').trim();
const MONTHS: Record<string, number> = { jul: 7, ags: 8, agu: 8, sep: 9, sept: 9, okt: 10, nov: 11, des: 12, jan: 1, feb: 2, mar: 3, apr: 4, mei: 5, jun: 6 };
const MONTH_NAME = ['', 'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const FEES: Record<string, string> = {
  'form pendaftaran': 'Form Pendaftaran', 'formulir pendaftaran': 'Form Pendaftaran', 'u gedung': 'Uang Gedung', 'uang gedung': 'Uang Gedung',
  'uang kegiatan': 'Uang Kegiatan', 'kbm smt1': 'KBM Semester 1', 'kbm smt 1': 'KBM Semester 1', 'kbm smt2': 'KBM Semester 2', 'kbm smt 2': 'KBM Semester 2',
  'daftar ulang': 'Daftar Ulang', 'kurang bayar': 'Kurang Bayar', 'sktm': 'SKTM', 'peci': 'Peci', 'seragam': 'Seragam',
};

/** "Rp 3,300,000" / "Rp3.300.000" / "3300000" → 3300000; "Rp -" / "-" → 0; kosong → null; selain itu NaN. */
export function parseMoney(raw: string): number | null {
  if (raw.trim() === '') return null;
  const t = raw.replace(/[\s ]/g, '').replace(/^rp\.?/i, '');
  if (t === '') return null;
  if (/^[-–—]+$/.test(t)) return 0;
  if (/^\d+$/.test(t) || /^\d{1,3}([.,]\d{3})+$/.test(t)) return Number(t.replace(/[.,]/g, ''));
  return NaN;
}
const money = (n: number) => 'Rp' + n.toLocaleString('id-ID');
const pad2 = (n: number) => String(n).padStart(2, '0');

export function parseSheet(text: string, opt: ParseOptions): ParseResult {
  const lines = text.replace(/\r/g, '').split('\n');
  const hIdx = lines.findIndex((l) => norm(l.split('\t')[0] ?? '') === 'nama');
  const fail = (error: string): ParseResult => ({ ok: false, error, columns: [], sections: [], rows: [], ignoredLines: [] });
  if (hIdx < 0) return fail('Baris judul tidak ditemukan. Tempel juga baris judul yang kolom pertamanya "NAMA" (NAMA, Seragam, peci, KELOMPOK, STATUS, ...).');
  const head = lines[hIdx].split('\t').map((c) => c.trim());
  while (head.length && head[head.length - 1] === '') head.pop();
  const H = head.length;
  const kelompokAt = head.findIndex((h) => norm(h) === 'kelompok');
  const used = new Map<string, number>();
  const columns: ColumnInfo[] = head.map((h, index) => {
    const n = norm(h);
    const base = { index, header: h };
    if (index === 0) return { ...base, kind: 'name', label: 'Nama santri' } as ColumnInfo;
    if (n === 'kelompok') return { ...base, kind: 'kelas', label: 'Kelas / kelompok' } as ColumnInfo;
    if (n === 'status') return { ...base, kind: 'status', label: 'Label status (mis. Keringanan)' } as ColumnInfo;
    if (n === 'seragam' || (n === 'peci' && kelompokAt >= 0 && index < kelompokAt)) return { ...base, kind: 'size', title: h.trim(), label: `Ukuran ${n} (catatan, bukan tagihan)` } as ColumnInfo;
    const sp = /^spp\s+([a-z]+)$/.exec(n);
    if (sp && MONTHS[sp[1]]) {
      const m = MONTHS[sp[1]]; const y = m >= 7 ? opt.startYear : opt.startYear + 1; const period = `${y}-${pad2(m)}`;
      return { ...base, kind: 'spp', title: 'SPP', period, dueDate: `${period}-10`, label: `SPP ${MONTH_NAME[m]} ${y} (jatuh tempo tanggal 10)` } as ColumnInfo;
    }
    if (n === '') return { ...base, kind: 'ignored', label: 'Kolom tanpa judul (diabaikan)' } as ColumnInfo;
    let title = FEES[n] ?? h.trim();
    const c = (used.get(title) ?? 0) + 1; used.set(title, c); if (c > 1) title = `${title} ${c}`;
    const known = !!FEES[n];
    return { ...base, kind: 'fee', title, period: `${opt.startYear}-07`, dueDate: opt.entryDue, label: `${title} (biaya awal, jatuh tempo ${opt.entryDue.split('-').reverse().join('/')})${known ? '' : ' — judul tidak dikenal, dianggap biaya awal'}` } as ColumnInfo;
  });
  const colOf = (k: ColumnInfo['kind']) => columns.find((c) => c.kind === k);
  const moneyCols = columns.filter((c) => c.kind === 'fee' || c.kind === 'spp');
  if (!moneyCols.length) return fail('Tidak ada kolom biaya yang dikenali di baris judul.');

  const rows: ParsedRow[] = []; const ignoredLines: { line: number; reason: string }[] = []; const sections: string[] = [];
  let bagian: string | null = null;
  for (let li = hIdx + 1; li < lines.length; li++) {
    const raw = lines[li]; if (raw.trim() === '') continue;
    const cells = raw.split('\t').map((c) => c.trim());
    const line = li + 1;
    const name = cells[0] ?? '';
    if (norm(name) === 'nama') { ignoredLines.push({ line, reason: 'Baris judul yang diulang' }); continue; }
    const cell = (i: number) => (i >= 0 ? cells[i] ?? '' : '');
    const errors: string[] = []; const warnings: string[] = [];
    // uang di tiap kolom biaya
    const items: { col: ColumnInfo; value: number | null; raw: string }[] = moneyCols.map((col) => {
      const rawv = cell(col.index); const v = parseMoney(rawv);
      if (v !== null && Number.isNaN(v)) errors.push(`Kolom "${col.header}": angka "${rawv}" tidak dikenali`);
      return { col, value: v === null || Number.isNaN(v) ? null : v, raw: rawv };
    });
    const kelas = cell(colOf('kelas')?.index ?? -1) || null;
    const statusRaw = cell(colOf('status')?.index ?? -1);
    const sizes = columns.filter((c) => c.kind === 'size').map((c) => ({ t: c.title!, v: cell(c.index) })).filter((x) => x.v);
    const anyMoney = items.some((x) => (x.value ?? 0) > 0);
    if (name === '') { if (cells.some((c) => c !== '')) ignoredLines.push({ line, reason: 'Baris tanpa nama (mungkin subtotal) dilewati' }); continue; }
    if (!kelas && !statusRaw && !sizes.length && !anyMoney) { bagian = name; sections.push(name); continue; }   // judul bagian

    // total di ujung baris
    let total: number | null = null;
    let lastIdx = -1; for (let i = cells.length - 1; i >= 0; i--) if (cells[i] !== '') { lastIdx = i; break; }
    const lastVal = lastIdx >= H ? parseMoney(cells[lastIdx]) : null;
    if (lastIdx >= H && lastVal !== null && !Number.isNaN(lastVal)) total = lastVal;
    else {
      const withVal = items.filter((x) => x.value !== null && x.raw !== '');
      const last = withVal[withVal.length - 1];
      if (last && withVal.length >= 2 && (last.value ?? 0) > 0) {
        const others = withVal.slice(0, -1).reduce((a, x) => a + (x.value ?? 0), 0);
        if (others === last.value) { total = last.value; items.splice(items.indexOf(last), 1); warnings.push(`Total ${money(total)} ditemukan di kolom "${last.col.header}" (posisi kolom bergeser dari judul)`); }
      }
    }
    const invoices: InvoiceItem[] = items.filter((x) => (x.value ?? 0) > 0).map((x) => ({ column: x.col.header, title: x.col.title!, period: x.col.period!, dueDate: x.col.dueDate!, amount: x.value! }));
    for (const inv of invoices) if (inv.amount < 1000) errors.push(`${inv.title}: nominal ${money(inv.amount)} terlalu kecil (minimal Rp1.000)`);
    const sum = invoices.reduce((a, x) => a + x.amount, 0);
    let totalCheck: ParsedRow['totalCheck'] = 'NONE';
    if (total !== null) {
      if (total === sum) totalCheck = 'OK';
      else { totalCheck = 'MISMATCH'; errors.push(`Total di baris ${money(total)} tidak sama dengan jumlah kolom ${money(sum)}`); }
    } else warnings.push('Tidak ada angka total di ujung baris, jadi jumlah tidak bisa dicek');
    const label = statusRaw ? statusRaw.charAt(0).toUpperCase() + statusRaw.slice(1).toLowerCase() : null;
    rows.push({
      line, name: name.replace(/\s+/g, ' '), bagian, kelas, statusLabel: label,
      catatan: sizes.length ? sizes.map((x) => `${x.t} ${x.v}`).join(', ') : null,
      invoices, sum, total, totalCheck, warnings, errors,
    });
  }
  if (!rows.length) return { ...fail('Tidak ada baris santri di bawah baris judul.'), columns };
  return { ok: true, columns, sections, rows, ignoredLines };
}
