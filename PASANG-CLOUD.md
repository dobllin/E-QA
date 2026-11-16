# Pasang E-QA di internet untuk DEMO (Neon + Render + Vercel)

Tujuan: aplikasi bisa dibuka dari HP lewat internet, tanpa komputer Anda menyala.
Susunan: **Neon** (database) + **Render** (API) + **Vercel** (web). Semua pilih wilayah **Singapore**.

> **Hanya untuk DEMO dengan data dummy.** MODE DEMO tetap menyala dan urusan legal belum selesai. Jangan masukkan data asli anak.
> Panduan ini disusun dari dokumentasi layanan, tetapi **belum diuji di server asli**. Tampilan tiap layanan bisa berubah; bila ada tombol yang namanya beda, cari yang paling mirip dan kirim tangkapan layar ke saya bila macet.

## Rahasia: jangan bocor
- **Jangan unggah file `.env` ke GitHub.** `.gitignore` di zip ini sudah mengabaikannya. Cek di repositori GitHub Anda: bila ada file bernama `.env`, **hapus** dan ganti semua kata sandi.
- Alamat database Neon berisi kata sandi. Simpan hanya di catatan pribadi dan di isian Render. Jangan kirim ke chat.
- `JWT_SECRET` untuk cloud harus **baru** (jangan sama dengan yang di komputer Anda). Buat dengan PowerShell:
  ```
  node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
  ```
  Bila `node` tidak ada, ketik sendiri teks acak panjang (minimal 40 karakter huruf/angka campur).

## Urutan (jangan dibalik)
Neon dulu, lalu Render (API), lalu Vercel (web), lalu sambungkan alamat keduanya.

## 1. Neon (database) — sudah Anda buat
1. Buka console.neon.tech, project Anda, tombol **Connect**.
2. Salin `DATABASE_URL` yang **tanpa** kata `-pooler` (koneksi langsung). Bagian `&channel_binding=require` boleh dibiarkan, kode sudah menanganinya.

## 2. Render (API)
1. Buka dashboard.render.com, **New > Web Services**, hubungkan GitHub, pilih repositori E-QA.
2. Isi:
   | Kolom | Isi |
   |---|---|
   | Name | `eqa-api` (bebas) |
   | Language | **Docker** |
   | Region | **Singapore** |
   | Branch | `main` |
   | Root Directory | `apps/api` |
   | Dockerfile Path | `./Dockerfile` (bila Render bilang "Dockerfile not found", ganti menjadi `./apps/api/Dockerfile` atau sebaliknya) |
   | Instance Type | **Free** untuk demo (lihat catatan tidur di bawah) |
3. **Environment Variables** (Add Environment Variable), isi satu per satu:
   | Key | Value |
   |---|---|
   | `DATABASE_URL` | alamat Neon langkah 1 (tanpa `-pooler`) |
   | `JWT_SECRET` | teks acak baru, minimal 32 karakter |
   | `BOOTSTRAP_ADMIN_USERNAME` | `superadmin` |
   | `BOOTSTRAP_ADMIN_PASSWORD` | kata sandi awal yang **kuat** (ganti lagi setelah login) |
   | `WEB_ORIGIN` | isi dulu `http://localhost:3000`; **diganti** di langkah 4 |
   | `TRUST_PROXY` | `1` |
   | `NODE_ENV` | `production` |
   Jangan isi `PORT` (Render mengatur sendiri; kode membacanya).
   Opsional: `ALLOW_DEMO_SEED` biarkan tidak diisi.
4. Tekan **Create Web Service**. Tunggu build selesai (beberapa menit). Buka tab **Logs**: harus ada baris
   `[migrate] applied 001_init.sql` ... sampai `applied 015_impor_santri.sql`, lalu `[bootstrap] akun Super Admin "superadmin" dibuat` dan `[api] E-QA API ... berjalan`.
5. Salin alamat API di bagian atas halaman (bentuk `https://eqa-api-xxxx.onrender.com`).
6. Tes: buka `alamat-API/` di browser. Tulisan "Cannot GET /" atau error 404 **normal** (artinya API hidup).

## 3. Vercel (web)
1. Project Vercel Anda: pastikan **Root Directory = `apps/web`** dan hanya project **web** yang diimpor (bukan `api`). Preset: Next.js.
2. Settings > **Environment Variables**: `NEXT_PUBLIC_API_URL` = alamat API dari Render (tanpa `/` di ujung), untuk Production dan Preview.
3. **Deployments > titik tiga > Redeploy** (variabel `NEXT_PUBLIC_` ditanam saat build; mengubahnya wajib redeploy).
4. Salin alamat web (bentuk `https://e-qa-xxxx.vercel.app`).

## 4. Sambungkan
1. Render > service API > **Environment**: ubah `WEB_ORIGIN` menjadi alamat web Vercel (persis, tanpa `/` di ujung). Bila Anda punya beberapa alamat, pisahkan dengan koma.
2. Simpan. Render otomatis restart.
3. Buka alamat web di HP, login `superadmin` dengan kata sandi dari `BOOTSTRAP_ADMIN_PASSWORD`.

## 5. Isi data
- Login Admin > **Pengaturan > Impor santri & tagihan** > tempel data Excel > Periksa data > Impor.
- Database cloud mulai **kosong** (tidak ada data dari komputer Anda).
- Isi juga: nama pesantren, rekening (Top up masuk > Pengaturan), akun wali, kartu santri.

## Catatan penting
- **Paket Free bisa tertidur.** Render Free mematikan API bila lama tidak dipakai, dan akses pertama setelahnya bisa lambat (puluhan detik). Neon Free juga bisa tidur ringan. Syarat paket sering berubah; cek di situs Render dan Neon. Untuk menghilangkan tidur, naikkan paket API Render ke yang berbayar paling murah.
- Notifikasi, bunyi, dan kamera QR sekarang bisa jalan lewat HTTPS, tetapi **belum pernah dicoba di HP asli**.
- `CARD_TOKEN_KEY`: kode kartu QR dienkripsi dengan kunci turunan `JWT_SECRET`. Jangan mengganti `JWT_SECRET` setelah kartu dicetak, atau tombol "Lihat kartu" gagal. Bila ingin kunci terpisah, isi `CARD_TOKEN_KEY` sejak awal.
- Backup: layanan `backup` di Docker tidak ikut di cloud. Neon menyimpan riwayat singkat; untuk cadangan sendiri gunakan `pg_dump` dengan alamat Neon (butuh `psql`/Docker di komputer Anda).
- Pembatas laju: dengan `TRUST_PROXY=1` setiap pengguna dihitung dari alamat aslinya, bukan satu alamat bersama.

## Bila macet
| Gejala | Tindakan |
|---|---|
| Login "Tidak bisa terhubung ke server" | `NEXT_PUBLIC_API_URL` salah atau belum Redeploy; atau API sedang tidur (tunggu 1 menit, coba lagi). |
| Login gagal, Console browser (F12) menyebut CORS | `WEB_ORIGIN` di Render tidak sama persis dengan alamat web (cek `https`, tanpa `/` di ujung). |
| Render Logs: `DATABASE_URL belum diisi` / error SSL / `password authentication failed` | Salin ulang alamat dari Neon (tanpa `-pooler`). Bila error sertifikat, kirim barisnya ke saya. |
| Render: `Dockerfile not found` | Ubah Dockerfile Path (lihat langkah 2). |
| Render: `JWT_SECRET wajib diisi` | Isi minimal 32 karakter. |
| Halaman web kosong/error saat build di Vercel | Pastikan Root Directory `apps/web` dan salin teks error ke saya. |

## Kembali ke lokal
Di komputer, `.env` lokal tidak berubah. Cukup buka `http://localhost:3000` seperti biasa (data lokal terpisah dari data cloud).
