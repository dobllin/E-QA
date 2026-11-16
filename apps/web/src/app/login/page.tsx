'use client';
import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { errMsg, login } from '@/lib/api';
import { homeFor } from '@/components/Shell';
import { Alert, Button, Field, Input } from '@/components/ui';
import { schoolLogoUrl, useSchool } from '@/lib/school';

export default function LoginPage() {
  const router = useRouter();
  const [username, setU] = useState('');
  const [password, setP] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const school = useSchool();

  async function submit(e: FormEvent) {
    e.preventDefault(); setErr(''); setBusy(true);
    try { const u = await login(username, password); router.replace(homeFor(u.role)); }
    catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  }

  return (
    <main className="grid min-h-screen lg:grid-cols-[1fr_480px]">
      <section className="hidden bg-navy-900 p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="flex items-center gap-3">{school?.hasLogo && <img src={schoolLogoUrl(1)} alt="" className="h-12 w-12 rounded-md bg-white object-contain" />}<div className="text-2xl font-bold tracking-wide">{school?.name || 'E-QA'}</div></div>
        <div>
          <h1 className="max-w-md text-4xl font-semibold leading-tight">Satu kartu untuk jajan, SPP, dan kabar dari pesantren.</h1>
          <p className="mt-4 max-w-md text-navy-100">Walsan bisa melihat saldo, belanja, dan tagihan anak kapan saja. Kasir cukup scan kartu dan santri memasukkan PIN.</p>
        </div>
        <div className="text-sm text-navy-200">Mode DEMO — saldo simulasi, bukan uang sungguhan.</div>
      </section>
      <section className="flex items-center justify-center p-6">
        <form onSubmit={submit} className="w-full max-w-sm space-y-4">
          <div>
            <div className="text-xl font-bold text-navy-900 lg:hidden">{school?.name || 'E-QA'}</div>
            <h2 className="text-2xl font-semibold text-navy-900">Masuk</h2>
            <p className="mt-1 text-sm text-navy-700">Gunakan akun yang diberikan oleh admin pesantren.</p>
          </div>
          {err && <Alert>{err}</Alert>}
          <Field label="Username"><Input value={username} onChange={(e) => setU(e.target.value)} autoComplete="username" autoFocus required /></Field>
          <Field label="Password"><Input type="password" value={password} onChange={(e) => setP(e.target.value)} autoComplete="current-password" required /></Field>
          <Button type="submit" disabled={busy} className="w-full">{busy ? 'Memeriksa…' : 'Masuk'}</Button>
        </form>
      </section>
    </main>
  );
}
