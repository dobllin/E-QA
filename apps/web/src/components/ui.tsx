'use client';
import { ButtonHTMLAttributes, forwardRef, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, useEffect, useLayoutEffect, useRef, useState } from 'react';

type Tone = 'ok' | 'warn' | 'bad' | 'muted' | 'info';

export function Button({ variant = 'primary', size = 'md', className = '', ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' | 'ghost'; size?: 'md' | 'lg' }) {
  const v = {
    primary: 'bg-navy-800 text-white hover:bg-navy-700 disabled:bg-navy-200',
    secondary: 'bg-white text-navy-800 border border-navy-200 hover:bg-navy-50 disabled:text-navy-200',
    danger: 'bg-red-600 text-white hover:bg-red-700 disabled:bg-red-200',
    ghost: 'text-navy-700 hover:bg-navy-50 disabled:text-navy-200',
  }[variant];
  return <button {...p} className={`inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:cursor-not-allowed ${size === 'lg' ? 'min-h-[52px] px-6 py-3 text-base' : 'px-4 py-2 text-sm'} ${v} ${className}`} />;
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-navy-800">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-navy-700/70">{hint}</span>}
    </label>
  );
}
const inputCls = 'w-full rounded-lg border border-navy-200 bg-white px-3 py-2 text-sm text-navy-900 placeholder:text-navy-200 focus:border-teal-500';
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(p, ref) {
  return <input ref={ref} {...p} className={`${inputCls} ${p.className ?? ''}`} />;
});
export const Select = (p: SelectHTMLAttributes<HTMLSelectElement>) => <select {...p} className={`${inputCls} ${p.className ?? ''}`} />;

export function Card({ title, action, children, className = '' }: { title?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`min-w-0 rounded-card border border-navy-100 bg-white p-5 ${className}`}>
      {(title || action) && (
        <header className="mb-4 flex items-center justify-between gap-3">
          {title && <h2 className="text-base font-semibold text-navy-900">{title}</h2>}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function Badge({ tone = 'muted', children }: { tone?: Tone; children: ReactNode }) {
  const t = { ok: 'bg-teal-50 text-teal-700', warn: 'bg-amber-50 text-amber-800', bad: 'bg-red-50 text-red-700', muted: 'bg-navy-50 text-navy-700', info: 'bg-sky-50 text-sky-800' }[tone];
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${t}`}>{children}</span>;
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: string; tone?: 'bad' }) {
  return (
    <div className="rounded-card border border-navy-100 bg-white p-4">
      <div className="text-sm text-navy-700">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${tone === 'bad' ? 'text-red-700' : 'text-navy-900'}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-navy-700/70">{sub}</div>}
    </div>
  );
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const [leaving, setLeaving] = useState(false);
  // Tutup lewat X atau Esc: meluncur keluar dulu (180 ms), baru dilepas.
  const close = () => { if (leaving) return; setLeaving(true); setTimeout(() => { onClose(); setLeaving(false); }, 180); };
  const closeRef = useRef(close); closeRef.current = close;
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && closeRef.current();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);
  return (
    <div className={`modal-back fixed inset-0 z-40 flex items-end justify-center bg-navy-900/50 p-0 sm:items-center sm:p-4 ${leaving ? 'is-leaving' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
      <div className={`modal-card max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-white p-6 shadow-xl sm:rounded-2xl ${wide ? 'sm:max-w-2xl' : 'sm:max-w-md'}`}>
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 className="text-lg font-semibold text-navy-900">{title}</h2>
          <button onClick={close} className="rounded p-1 text-navy-700 hover:bg-navy-50" aria-label="Tutup">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export const Alert = ({ tone = 'bad', children }: { tone?: 'bad' | 'ok' | 'warn'; children: ReactNode }) => (
  <div role="alert" className={`rounded-lg px-3 py-2 text-sm ${tone === 'bad' ? 'bg-red-50 text-red-800' : tone === 'ok' ? 'bg-teal-50 text-teal-700' : 'bg-amber-50 text-amber-900'}`}>{children}</div>
);

export const Loading = () => <div className="py-10 text-center text-sm text-navy-700">Memuat…</div>;
export const Empty = ({ children }: { children: ReactNode }) => <div className="rounded-lg border border-dashed border-navy-200 py-10 text-center text-sm text-navy-700">{children}</div>;

export function Table({ head, children }: { head: string[]; children: ReactNode }) {
  const ref = useRef<HTMLTableElement>(null);
  // Di layar sempit (HP/tablet) setiap baris tampil sebagai kartu; label diambil dari judul kolom.
  useLayoutEffect(() => {
    ref.current?.querySelectorAll('tbody tr').forEach((tr) => Array.from(tr.children).forEach((td, i) => td.setAttribute('data-label', head[i] ?? '')));
  });
  return (
    <div className="eqa-table-wrap overflow-x-auto">
      <table ref={ref} className="eqa-table w-full text-left text-sm">
        <thead><tr className="border-b border-navy-100 text-navy-700">{head.map((h, i) => <th key={`${h}-${i}`} className="whitespace-nowrap px-3 py-2 font-medium">{h}</th>)}</tr></thead>
        <tbody className="divide-y divide-navy-50">{children}</tbody>
      </table>
    </div>
  );
}
export const Td = ({ children, right, className = '' }: { children?: ReactNode; right?: boolean; className?: string }) => <td className={`px-3 py-2.5 ${right ? 'text-right tabular-nums' : ''} ${className}`}>{children}</td>;

export function PageHeader({ title, sub, action }: { title: string; sub?: string; action?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold text-navy-900">{title}</h1>
        {sub && <p className="mt-1 text-sm text-navy-700">{sub}</p>}
      </div>
      {action}
    </div>
  );
}


/**
 * Kolom uang: langsung tampil "Rp 100.000" (titik ribuan + Rp) saat diketik. Yang disimpan di state hanya angka ("100000").
 * `min`/`max` dicek sebagai validasi form (pesan dalam Rupiah).
 */
export const MoneyInput = forwardRef<HTMLInputElement, Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange' | 'value' | 'min' | 'max' | 'step'> & {
  value: string | number; onChange: (e: { target: { value: string } }) => void; min?: number; max?: number; step?: number;
}>(function MoneyInput({ value, onChange, min, max, step: _step, className, ...rest }, ref) {
  const digits = String(value ?? '').replace(/\D/g, '');
  const shown = digits ? `Rp ${Number(digits).toLocaleString('id-ID')}` : '';
  const inner = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    const el = inner.current; if (!el) return;
    const n = digits ? Number(digits) : null;
    el.setCustomValidity(n !== null && min !== undefined && n < min ? `Minimal Rp ${min.toLocaleString('id-ID')}` : n !== null && max !== undefined && n > max ? `Maksimal Rp ${max.toLocaleString('id-ID')}` : '');
  }, [digits, min, max]);
  return (
    <input
      ref={(el) => { inner.current = el; if (typeof ref === 'function') ref(el); else if (ref) (ref as { current: HTMLInputElement | null }).current = el; }}
      type="text" inputMode="numeric" autoComplete="off" placeholder="Rp 0" {...rest} value={shown}
      onChange={(e) => onChange({ target: { value: e.target.value.replace(/\D/g, '').replace(/^0+(?=\d)/, '').slice(0, 11) } })}
      className={`${inputCls} tabular-nums ${className ?? ''}`}
    />
  );
});

/** Tombol salin teks (tetap jalan di http biasa lewat cadangan execCommand). */
export function CopyButton({ text, label = 'Salin', size = 'md' }: { text: string; label?: string; size?: 'md' | 'lg' }) {
  const [done, setDone] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(text); }
    catch {
      const t = document.createElement('textarea'); t.value = text; t.style.position = 'fixed'; t.style.opacity = '0'; document.body.appendChild(t); t.select();
      try { document.execCommand('copy'); } finally { document.body.removeChild(t); }
    }
    setDone(true); setTimeout(() => setDone(false), 2000);
  }
  return <Button type="button" variant="secondary" size={size} onClick={copy} aria-live="polite">{done ? 'Tersalin ✓' : label}</Button>;
}
