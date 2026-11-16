/** CSV yang langsung terbuka rapi di Excel Indonesia: pemisah `;`, UTF-8 BOM, tanda kutip bila perlu. */
export function toCsv(headers: string[], rows: unknown[][]): string {
  const esc = (v: unknown) => { const s = String(v ?? ''); return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return '\ufeff' + [headers.map(esc).join(';'), ...rows.map((r) => r.map(esc).join(';'))].join('\r\n') + '\r\n';
}
