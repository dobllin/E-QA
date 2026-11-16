# E-QA — Kartu Santri, Kantin Cashless, dan Tagihan SPP

> **MODE DEMO.** Saldo dan pembayaran di sistem ini adalah **simulasi**, bukan uang sungguhan.
> Jangan dipakai untuk menampung uang santri sebelum aspek hukum dan mitra pembayaran berizin beres
> (lihat bagian *Sebelum dipakai uang sungguhan*).

## Yang sudah jalan (dan sudah diuji)

| Fitur | Keterangan |
|---|---|
| Login 6 peran | Super Admin, Admin, Bendahara, Kasir, Guru, Wali santri. Hak akses dicek di **backend**. |
| Data santri | Tambah, cari, ubah, **impor CSV** (tempel dari Excel). Santri tidak punya akun login. |
| Kartu QR + PIN | Terbit kartu (barcode acak 16 karakter + PIN awal 6 angka), cetak kartu & slip PIN, ganti PIN, **nonaktifkan sementara**, buka kunci, reset PIN, **ganti kartu hilang** (barcode lama mati, saldo ikut ke kartu baru). |
| Kasir kantin | Scan barcode → santri ketik PIN → bayar. Pilih produk atau nominal bebas. Stok berkurang otomatis. |
| Saldo | Top up oleh bendahara, refund (transaksi pembalik), batas belanja harian/per transaksi. Ledger tidak bisa diubah/dihapus. |
| Tagihan (SPP dan biaya lain) | Buat tagihan bulanan massal (aman diulang), terima bayar tunai/transfer (boleh dicicil), kwitansi bernomor unik, status Menunggak otomatis. |
| **Portal wali santri** | Saldo, **detail belanja (nama barang, harga, jam)**, mutasi saldo, tagihan/SPP dan riwayat bayar, status kartu. Hanya anak yang terhubung. |
| **Top up transfer bank** | Wali buat permintaan di portal → nominal unik (kode 1–999 ikut jadi saldo) + **biaya layanan opsional di atas nominal** → transfer ke rekening pesantren → bendahara unggah mutasi CSV → sistem mencocokkan → bendahara menyetujui → saldo masuk. Laporan bulanan fee. |
| Laporan | Ringkasan harian, **rekonsiliasi saldo vs ledger**, audit log. |

Diuji: **93 test otomatis backend** (termasuk 20 transaksi bersamaan, anti debit ganda, PIN salah, refund, akses wali) dan **14 langkah UI di browser** (kasir, walsan, admin, bendahara, tampilan HP).

## Yang BELUM ada (jujur)

Tabungan siswa, payment gateway/Virtual Account (top up masih dicatat manual oleh bendahara), kartu NFC & terminal ESP32,
perpustakaan, aplikasi mobile Flutter (portal walsan berupa **web responsif** yang bisa dibuka di HP),
notifikasi push, pengiriman WhatsApp otomatis (v0.8 hanya membuka WhatsApp dengan pesan terisi, pengurus menekan Kirim sendiri), import/export XLSX. Struktur kodenya modular sehingga bisa ditambah bertahap.

## Teknologi

Backend: **NestJS + TypeScript + PostgreSQL** (driver `pg`, migrasi SQL). Web: **Next.js + React + TypeScript + Tailwind**.
> Catatan: spesifikasi awal menyebut Prisma. Backend ini memakai SQL murni karena operasi saldo butuh kontrol transaksi
> (`SELECT … FOR UPDATE`) dan bisa diuji penuh. Skema ada di `apps/api/src/db/migrations/001_init.sql`.

---

## A. Instalasi dengan Docker (disarankan)

**Yang perlu dipasang:** [Docker Desktop](https://www.docker.com/products/docker-desktop/) (Windows/Mac) atau Docker Engine (Linux). Tidak perlu pasang Node atau PostgreSQL.

1. Ekstrak zip, buka terminal di folder `e-qa`.
2. Buat file pengaturan:
   ```bash
   cp .env.example .env        # Windows PowerShell: Copy-Item .env.example .env
   ```
3. Buka `.env` dengan Notepad/VS Code dan **ganti**: `DB_PASSWORD`, `JWT_SECRET` (minimal 32 karakter acak), `BOOTSTRAP_ADMIN_PASSWORD`.
   Membuat teks acak: `openssl rand -base64 48`
4. Jalankan:
   ```bash
   docker compose up -d --build
   ```
   Pertama kali butuh beberapa menit. Database dan tabel dibuat otomatis, begitu juga akun Super Admin pertama.
5. Buka **http://localhost:3000** lalu login dengan `BOOTSTRAP_ADMIN_USERNAME` / `BOOTSTRAP_ADMIN_PASSWORD` dari `.env`.

**Mau coba cepat dengan data contoh?** Di `.env` isi `ALLOW_DEMO_SEED=true`, jalankan `docker compose up -d`, lalu:
```bash
docker compose exec api node dist/seed.js
```
Layar akan menampilkan 3 kartu demo (barcode + PIN). **Catat sekarang**, barcode hanya tampil sekali. Akun demo (password `Demo12345!`): `admin`, `bendahara`, `kasir`, `walsan1`, `walsan2`.

Perintah berguna: `docker compose logs -f api` (lihat log), `docker compose down` (berhenti), `docker compose up -d --build` (setelah ubah kode).

**Diakses dari HP / komputer lain di jaringan yang sama:** di `.env` ganti `WEB_ORIGIN=http://IP-SERVER:3000` dan `NEXT_PUBLIC_API_URL=http://IP-SERVER:4000`, lalu `docker compose up -d --build`. (IP server: `ipconfig` / `ip a`.)

---

## B. Instalasi tanpa Docker

**Yang perlu dipasang:** Node.js 22+, PostgreSQL 16, Git (opsional).

1. Buat database:
   ```sql
   CREATE USER eqa WITH PASSWORD 'ganti-password';
   CREATE DATABASE eqa OWNER eqa;
   ```
2. API:
   ```bash
   cd apps/api
   cp .env.example .env          # lalu edit DATABASE_URL dan JWT_SECRET
   npm install
   npm run build
   npm start                     # berjalan di http://localhost:4000, migrasi otomatis
   ```
   Data demo (opsional): `npm run seed`
3. Web (terminal baru):
   ```bash
   cd apps/web
   cp .env.example .env.local
   npm install
   npm run build && npm start    # http://localhost:3000     (mode pengembangan: npm run dev)
   ```

---

## Alur pemakaian pertama kali

1. Login sebagai Super Admin → menu **Pengguna**: buat akun Admin, Bendahara, Kasir, dan akun **Wali santri**.
2. **Santri → Tambah santri** (atau **Impor CSV**: tempel `NIS, Nama, Kelas` per baris).
3. Buka detail santri → **Hubungkan wali** (tanpa ini wali tidak bisa melihat apa pun).
4. **Terbitkan kartu** → cetak kartu dan **slip PIN** (hanya tampil sekali). Berikan keduanya ke santri.
5. Bendahara: **Top up** saldo santri.
6. Di kasir, saat pertama dipakai, santri diminta **membuat PIN baru** (PIN awal wajib diganti).
7. Bendahara: **Tagihan → Buat tagihan bulanan**, lalu **Terima bayar** di loket (kwitansi bisa dicetak).
8. Wali login → melihat saldo, belanja, dan tagihan anak.

**Scanner:** kartu memakai **kode QR**, jadi butuh scanner **2D (imager)**. Scanner 1D/laser murah tidak bisa membaca QR. Scanner USB 2D bekerja seperti keyboard: klik kolom "Scan kartu santri", scan, lalu kursor pindah ke kolom PIN. Tanpa scanner, pakai kamera (tombol "Scan pakai kamera") atau ketik kode 16 karakter di bawah QR.

**Kartu hilang:** Santri → detail → **Nonaktifkan sementara** (langsung menolak transaksi). Setelah kartu baru siap: **Kartu hilang / ganti**. Saldo otomatis pindah.

---

## Kartu PNG, PIN sendiri, dan scan kamera

- **Kartu PNG:** setelah **Terbitkan kartu**, pratinjau kartu tampil dan bisa diunduh lewat **Unduh kartu (PNG)** (ukuran kartu standar 85,6 x 54 mm, 300 dpi). Kode QR dan teks kodenya ada di kartu. Kartu lama berbarcode garis tetap terbaca oleh kamera.
- **Lihat kartu di halaman santri:** tombol **Lihat kartu** (khusus Admin) menampilkan kartu + QR kapan saja, lengkap dengan unduh PNG, unduh QR besar, dan cetak. Setiap pembukaan tercatat di audit log. Kode QR disimpan **terenkripsi** (AES-256-GCM) memakai `CARD_TOKEN_KEY` (opsional di `.env`; jika kosong diturunkan dari `JWT_SECRET`, jadi jangan ganti `JWT_SECRET` sembarangan). **PIN tetap tidak pernah bisa dilihat.** Kartu yang dibuat sebelum fitur ini tidak punya preview; buat kartu baru lewat **Kartu hilang / ganti**.
- **Kamera tidak terbaca?** Pakai **Unduh QR besar (PNG)**, kirim ke HP, zoom, dan naikkan kecerahan layar. Atau pakai tombol **Baca dari gambar** di jendela scan, atau ketik kode 16 karakter di bawah QR.
- **PIN sendiri:** saat terbit kartu, reset PIN, atau ganti kartu, pilih **Saya tentukan sendiri** (6 angka; angka sama semua atau berurutan ditolak). Centang **wajib ganti** bila santri harus membuat PIN sendiri di kasir.
- **Scan kamera di kasir:** tombol **Scan pakai kamera** membaca kode QR otomatis lalu kursor pindah ke kolom PIN. Santri mengetik PINnya sendiri.
  **Kamera hanya bisa dipakai lewat `http://localhost` atau `https://`.** Kalau kasir membuka lewat `http://192.168.x.x` dari HP, browser memblokir kamera. Solusinya pasang HTTPS, atau pakai laptop kasir lewat `localhost`, atau scanner USB.

## Top up transfer bank (kode unik) dan biaya layanan

1. **Admin:** menu **Top up masuk → Pengaturan**: isi rekening tujuan (WAJIB atas nama pesantren), biaya layanan (Rp, default 0), minimal/maksimal, dan masa berlaku.
2. **Wali:** di portal klik **Top up saldo**, pilih nominal. Rincian tampil sebelum bayar: nominal + kode unik + biaya layanan = total transfer. Saldo santri yang masuk = nominal + kode unik (**biaya layanan tidak masuk saldo**).
3. **Bendahara:** **Unggah mutasi bank** (CSV dari internet banking), pilih kolom jumlah, **Cocokkan**, lalu **Setujui**. Tanpa mutasi yang cocok, bisa **Setujui manual** dengan catatan bukti.
4. **Laporan bulanan** di halaman yang sama (jumlah top up, total saldo masuk, total biaya layanan).

Keamanan: nominal transfer unik di antara permintaan terbuka; mutasi yang sama tidak bisa dicocokkan dua kali; saldo baru masuk setelah disetujui; pembuat permintaan tidak boleh menyetujui sendiri; setiap persetujuan tercatat di audit log.
**Biaya layanan** harus disepakati tertulis dengan pesantren dan ditampilkan jelas ke wali. Uangnya ikut masuk ke rekening pesantren; penagihan jasa aplikasi dilakukan ke pesantren berdasarkan laporan bulanan. Jangan menaruhnya ke rekening pribadi. Untuk pembayaran QRIS, tanyakan ke bank apakah biaya tambahan di atas nominal diperbolehkan.

## Bukti transfer (screenshot) dengan pembaca nominal otomatis

- Di portal wali (tab **Top up**), wali bisa **Unggah bukti transfer** (foto/screenshot). Nominal dibaca otomatis **di browser wali** (OCR, berkas OCR dilayani dari server sendiri, tanpa layanan pihak luar) lalu dicocokkan dengan total transfer yang diminta.
- Bendahara melihat tombol **Lihat bukti** di daftar permintaan: foto, penanda "nominal sesuai / belum cocok", dan angka yang terbaca.
- **Foto hanya pembantu, bukan penentu.** Saldo TIDAK pernah masuk hanya karena foto. ACC tetap oleh bendahara setelah uangnya terlihat di mutasi rekening pesantren. Foto mudah diedit.
- Aturan: JPG/PNG/WebP maksimal 3 MB (jenis file dicek dari isi, bukan nama), maksimal 3 foto per permintaan, foto yang sama tidak bisa dipakai dua kali, hanya staf berwenang yang bisa membuka foto dan setiap pembukaan tercatat di audit log.
- Akurasi OCR berbeda tiap aplikasi bank. Diuji dengan screenshot buatan; **coba dengan screenshot asli** dari beberapa bank. Jika tidak terbaca, foto tetap bisa dikirim.
- Build web menyalin berkas OCR otomatis (`npm run build` menjalankan `scripts/copy-ocr.mjs`). Jangan membangun dengan `npx next build` langsung.

## Tagihan jasa bulanan (fee aplikasi)

Menu **Tagihan jasa** (Super Admin, Admin, Bendahara). Fee dari top up yang selesai dihitung per bulan (angka fee dikunci saat permintaan dibuat, jadi mengubah pengaturan tidak mengubah bulan lama).
1. Akhir bulan: **Rincian** menampilkan tiap top up dan total fee; **Unduh CSV** atau **Cetak** sebagai lampiran penagihan.
2. Pesantren menyetor total fee bulan itu ke rekening pengembang (disarankan dengan transfer terjadwal).
3. Bendahara klik **Tandai dibayar** (tanggal + nomor bukti transfer). Status: *Dibayar, menunggu konfirmasi*.
4. Pengembang (**Super Admin**) klik **Konfirmasi diterima** setelah uang benar-benar masuk. Status: *Lunas*. Hanya Super Admin yang bisa membatalkan penandaan (tercatat di audit log).
5. **Pengingat** tampil di Ringkasan dan Top up masuk selama ada bulan yang belum dibayar.
Dokumen ini bukan faktur pajak; bentuk penagihan resmi mengikuti perjanjian dan ketentuan pajak. Gunakan akun Super Admin untuk pengembang agar konfirmasi penerimaan hanya bisa dilakukan oleh pengembang.

## Toleransi kelebihan transfer dan QRIS

- **Transfer tidak harus persis sama.** Di **Top up masuk → Pengaturan** ada *Toleransi kelebihan transfer* (default Rp5.000). Mutasi yang **sama atau lebih** dari total sampai batas itu tetap dicocokkan otomatis, dan **seluruh jumlah yang diterima dikurangi biaya layanan** masuk saldo (tidak dibulatkan, tidak ada yang menggantung di rekening). **Kurang** dari total tidak dicocokkan otomatis.
- Bila ada beberapa permintaan terbuka dengan nominal berdekatan dan tidak ada yang persis, baris mutasi ditandai *ambigu* dan diproses manual (**Setujui manual** + isi jumlah yang masuk di rekening). Sistem sengaja tidak menebak untuk menghindari uang masuk ke santri yang salah. Makin banyak permintaan terbuka, makin sering kasus ini muncul.
- **QRIS:** Admin mengunggah gambar QRIS pesantren di Pengaturan; tampil di layar top up wali (wali memasukkan nominal tepat). Mutasi rekening untuk QRIS biasanya sudah dipotong biaya merchant atau digabung per hari sehingga tidak cocok per transaksi; untuk mencocokkan, pakai laporan transaksi (CSV) dari aplikasi merchant QRIS.

## Kantong saldo, bayar SPP dari portal, dan peran Laundry

- **Saldo utama + kantong:** semua top up (transfer, QRIS, tunai) masuk ke *Saldo* dulu. Wali memindahkannya ke *Uang jajan* atau *Uang laundry*, atau ke **kartu tagihan** (SPP, Uang Gedung, dll.): memindahkan uang ke kartu tagihan = membayar tagihan itu (yang paling lama dulu, boleh cicil). Kasir hanya memotong *Uang jajan*. Top up tunai juga kena biaya layanan (di atas nominal). Pembagian otomatis sudah dihapus. [Catatan lama:] Wali memindahkan saldo antar kantong di portal (**Pindahkan saldo**), mis. masuk Rp500.000 → Rp100.000 jajan, Rp300.000 SPP, Rp100.000 laundry. Saat membuat permintaan top up wali juga bisa memilih kantong tujuannya.
- **Bayar SPP/tagihan dari portal wali:** tab *Tagihan & SPP* → **Bayar dari saldo** (boleh dicicil, tidak boleh melebihi sisa, saldo kantong harus cukup). Kwitansi tercatat.
- **Peran Laundry:** terpisah dari Kasir. Admin membuat akun berperan *Laundry* (menu Pengguna) dan layanan/harga di menu *Produk kantin → tab Laundry*. Petugas Laundry hanya melihat layanan laundry dan memotong kantong Laundry; Kasir hanya kantin dan kantong Jajan.
- **SPP per santri:** nominal SPP khusus santri diatur di detail santri (*SPP per bulan*). Saat **Buat tagihan bulanan**, centang *Pakai nominal SPP masing-masing santri*. Untuk satu santri saja: **Tagihan per santri**. Tagihan yang sudah dibuat bisa diubah lewat tombol **Ubah** (perubahan nominal wajib beralasan, tidak boleh di bawah yang sudah dibayar, tercatat di audit log).
- **Kolom cari** ada di layar Kasir/Laundry dan halaman Produk.
- **Pengaturan rekening/QRIS/biaya layanan hanya Admin**; Bendahara tidak melihatnya.

## Tampilan sederhana untuk wali, salin rekening, dan format Rupiah

- **Portal wali disederhanakan**: tombol besar, huruf lebih besar, bahasa sehari-hari (*Uang jajan / Uang SPP / Uang laundry*, *Lewat jatuh tempo*, *Isi saldo*, *Tagihan sekolah*). Di atas tampil satu kotak **"Yang harus dibayar sekarang"** dan tombol "Lihat dan bayar tagihan". Ada kotak "Cara pakai".
- **Cara transfer**: nominal dan **nomor rekening bisa disalin dengan satu tombol** (jalan juga di http biasa). Admin mengisi rekening terpisah di Pengaturan: *Nama bank*, *Nomor rekening*, *Atas nama*.
- **Bayar tagihan**: dari uang SPP. Jika kurang, sistem **bertanya** mau menambah dari uang jajan atau laundry (wali memilih sendiri; tidak diambil diam-diam). Boleh dicicil.
- **Semua kolom uang** langsung tampil dengan titik dan "Rp", misalnya `Rp 100.000`, saat diketik.
- **Scan QR di kasir**: tombol **Foto QR** membuka kamera HP bawaan (fokus otomatis, **tidak butuh https**), lalu QR dibaca dari fotonya. Kamera langsung tetap ada (butuh `https://` atau `localhost`), memakai pembaca bawaan browser bila tersedia. Cadangan: pilih gambar dari galeri, atau ketik kode 16 karakter.

## Fitur tambahan v0.5

- **Nama dan logo pesantren** (menu *Pengaturan sekolah*): tampil di menu, halaman login, dan **kartu santri**.
- **Menu dikelompokkan** (Harian, Santri dan uang, Kantin dan laundry, Laporan, Pengaturan). Dashboard punya kotak **Perlu tindakan** (top up menunggu dicek, tagihan lewat jatuh tempo, kartu terkunci, stok menipis) dan grafik 7 hari.
- **Santri**: ubah data (nama, NIS, kelas, status) dari layar; **Kelola kelas**: kartu massal (lembar kartu 2 kolom + daftar PIN untuk dicetak), naik kelas massal, luluskan kelas.
- **Transaksi**: semua belanja kantin/laundry dengan pencarian; bendahara bisa **membatalkan** transaksi yang salah (uang kembali, riwayat asli tetap tersimpan).
- **Laporan (CSV untuk Excel)**: penjualan per hari, tunggakan per kelas, rekap top up, saldo semua santri.
- **Kasir/Laundry**: layar sukses besar, bunyi (bisa dimatikan), transaksi terakhir, dan **struk cetak** (58 mm).
- **Wali**: lonceng **Pemberitahuan** (anak belanja, saldo masuk, tagihan baru, kartu terkunci), persetujuan privasi saat login pertama (teks DRAFT), dan **ganti password** untuk semua peran.
- **Cadangan database otomatis**: layanan `backup` di `docker-compose.yml` menyimpan `backups/eqa-TANGGAL.sql.gz` tiap 24 jam (atur lewat `BACKUP_EVERY_HOURS` dan `BACKUP_KEEP_DAYS` di `.env`). Simpan salinannya juga di tempat lain. Backup manual Windows: `scripts\backup.ps1`.
- **Responsif**: semua halaman dan dialog diuji otomatis di lebar 360 (HP), 768 (tablet), dan 1280 (desktop).
- **Pengurus**: bunyi + ucapan "Ada yang bayar" yang khas saat ada bukti transfer/pembayaran masuk (dropdown Pemberitahuan, bisa dimatikan). Perlu satu ketukan di layar agar browser mengizinkan suara.
- Menu samping berupa dropdown; aplikasi bisa **dipasang ke layar utama (PWA)** lewat HTTPS.
- Pemberitahuan bersifat **di dalam aplikasi** (WhatsApp/push saat tab tertutup belum ada).

## Fitur v0.8: absen guru, rekap harian, WhatsApp tunggakan

- **Absen kelas (Guru):** admin mengatur **jadwal pelajaran** (mata pelajaran, hari, jam mulai-selesai, kelas, akun guru; bisa ditambah/diubah/dinonaktifkan) di menu *Jadwal & laporan absen*. Guru membuka *Absen kelas*, memilih pelajaran, lalu **scan kartu santri tanpa PIN** (scanner USB, ketik kode + Enter, atau kamera). Hadir / Terlambat (batas diatur Admin, standar 10 menit); scan boleh mulai 10 menit sebelum jam mulai dan ditolak setelah selesai atau di hari lain; scan ganda tidak dihitung dua kali; jadwal ber-kelas hanya menerima santri kelas itu dan menampilkan daftar **belum hadir**; salah scan bisa **dibatalkan** (hari itu saja, tercatat di audit log). Admin melihat dan mengunduh **laporan absen (CSV)** per tanggal, kelas, atau pelajaran.
- **Satu akun dipakai beberapa orang ("joki"):** di awal sesi guru mengetik namanya; setiap absen tercatat atas nama itu **dan** akun yang dipakai. Nama itu diketik sendiri (tidak diverifikasi), jadi cocok untuk absen tetapi **jangan dipakai untuk akun yang memegang uang**.
- **Rekap harian Kasir/Laundry:** tombol *Rekap hari ini*: total, jumlah transaksi, **per barang**, daftar transaksi; pilih tanggal lain. Unduh **CSV** (langsung terbuka di Excel) atau **Cetak / simpan PDF**. Transaksi yang dikembalikan (refund) tidak dihitung di total tetapi tetap terlihat. Kantin dan laundry terpisah.
- **Tambah barang jualan:** tombol *Kelola barang* (Kasir) / *Kelola layanan* (Laundry): tambah, ubah nama/harga/stok, sembunyikan (tidak ada hapus). Kasir hanya mengelola barang kantin dan Laundry hanya layanan laundry. Perubahan harga tercatat (nilai lama dan baru) di audit log.
- **Pengingat tunggakan lewat WhatsApp:** di *Tagihan*, **setiap tunggakan** (lewat jatuh tempo, belum lunas) punya **titik merah berkedip**, dengan keterangan *Belum diingatkan* / *Diingatkan tanggal ...* / *Perlu diingatkan lagi*. Tombol *WhatsApp* di baris, atau *Ingatkan lewat WhatsApp* (satu per satu untuk semua), membuka WhatsApp wali dengan pesan terisi (**satu pesan per santri**, merangkum semua tunggakannya). Isi pesan bisa diatur (*Atur isi pesan*; penanda `{nama_wali} {nama_santri} {tagihan} {sisa} {jatuh_tempo} {pesantren}`). Setelah tombol ditekan, tagihan ditandai "Diingatkan". **Sistem tidak bisa tahu apakah pesan benar-benar terkirim**; tanda itu berarti tombolnya sudah ditekan. Nomor HP wali diisi di *Pengguna → Ubah*; wali tanpa nomor ditandai dan dilewati.
- **Tagihan per santri, bayar dari "Pindahkan uang", impor Excel (v1.0):** menu *Tagihan* (dulu Tagihan SPP) menggabungkan tagihan satu santri dalam satu baris yang bisa dibuka, dengan keterangan "diingatkan lagi hari apa". Portal wali: tujuan *Pindahkan uang* bisa berupa tagihan (dibayar dari Saldo saja). *Pengaturan → Impor santri & tagihan* membaca hasil copy dari Excel/Google Sheets (kolom dikenali dari judul), pratinjau + pemeriksaan total, lalu membuat santri (nomor 01, 02, ...) dan tagihannya; "Rp -" = lunas dilewati; SPP jatuh tempo tanggal 10. Pembaca ada di `apps/api/src/import/sheet-parser.ts`. Migrasi 015. Tes: 134.
- **Animasi dan notifikasi pembayaran (v0.9):** menu HP/tablet berupa panel geser, popup naik dari bawah, halaman berganti dengan efek pudar (semua dimatikan bila perangkat diatur "kurangi gerakan"). Admin/Bendahara memilih sendiri jenis pembayaran yang diberi notifikasi (**Pemberitahuan → Atur notifikasi**): bukti top up dari wali, top up masuk, wali bayar dari saldo, dan pembayaran di loket oleh orang lain. Saat tab ditinggal: popup browser (lewat service worker), judul tab berkedip, bunyi. Hanya jalan selama aplikasi terbuka di browser; push saat browser tertutup menunggu aplikasi online (HTTPS). Tabel `notification_prefs` (migrasi 014) menyimpan jenis yang dimatikan. Tes: 123.
- **Tampilan HP dan tablet (v0.8.2):** di layar di bawah 900 px, tabel otomatis menjadi kartu (komponen `Table` di `apps/web/src/components/ui.tsx` + CSS `.eqa-table` di `globals.css`). Diperiksa lewat browser Chrome tanpa kepala pada 360, 390, 768 dan 1024 px untuk semua halaman semua peran: tidak ada halaman yang melebar ke samping. Belum dicoba di perangkat HP/tablet sungguhan.
- **Pengingat ulang (v0.8.1):** bila sudah diingatkan tetapi setelah **N hari** (diatur di *Atur pesan & pengingat*, standar 3, 0 = mati) tagihan masih belum lunas, tagihan ditandai **Perlu diingatkan lagi** dan pengurus mendapat pemberitahuan (sekali per putaran). Menu samping menampilkan titik merah + angka jumlah wali yang perlu diingatkan di **Tagihan**. Pemeriksaannya berjalan saat ada pengurus yang membuka aplikasi (tidak ada pengirim terjadwal di server, dan tidak ada push saat tab tertutup). Sistem tidak bisa tahu wali membalas atau tidak, hanya apakah tagihan masih belum lunas.

## Menjalankan test

Butuh PostgreSQL dan database kosong `eqa_test` (jika tanpa Docker):
```bash
cd apps/api
npm test        # 116 test; ubah TEST_DB di test/e2e.spec.ts bila perlu
```
Test akan **menghapus isi** database `eqa_test`. Jangan arahkan ke database yang berisi data asli.

## Backup & pemulihan (Docker)

```bash
./scripts/backup.sh                          # hasil: backups/eqa-TANGGAL.sql.gz
./scripts/restore.sh backups/eqa-XXXX.sql.gz # MENGGANTI seluruh data
```
Jadwalkan `backup.sh` harian (cron) dan **simpan salinannya di tempat lain** (flashdisk/cloud). Uji pemulihan secara berkala.

## Keamanan yang sudah diterapkan

Password Argon2id; PIN Argon2id; barcode disimpan sebagai hash (token asli tidak tersimpan); token login 30 menit + refresh token yang bisa dicabut;
kartu terkunci setelah 3x salah PIN; PIN lemah ditolak; batas belanja; rate limiting; header keamanan (helmet); validasi semua input;
ledger immutable (trigger database); saldo tidak bisa negatif (constraint database); idempotency key anti debit ganda; audit log aksi penting;
wali hanya bisa melihat anak yang terhubung (jawaban 404 untuk anak orang lain).

**Keterbatasan barcode statis (penting dipahami):** barcode di kartu bisa difoto/difotokopi. Perlindungannya adalah **PIN + batas belanja harian**.
Jangan beri limit besar. PIN diketik santri sendiri di kasir, kasir jangan melihat layar PIN.

## Sebelum dipakai uang sungguhan

1. Uang harus berada di **rekening atas nama pesantren** atau mitra berizin (bank / PJP / koperasi), **bukan rekening pribadi siapa pun**.
2. Konsultasikan ke penasihat hukum dan bank/PJP: saldo yang dipakai belanja bisa tergolong uang elektronik (izin Bank Indonesia).
3. Pasang **HTTPS** (jangan jalankan lewat http biasa di internet). Contoh dengan Caddy (belum diuji di paket ini): arahkan domain ke `web:3000` dan `api:4000` lewat `reverse_proxy`, lalu set `WEB_ORIGIN` dan `NEXT_PUBLIC_API_URL` ke alamat https.
4. Ganti semua password/secret, matikan `ALLOW_DEMO_SEED`, siapkan backup terjadwal, dan tentukan SOP (lihat `docs/DRAFT-kebijakan.md`).
5. Banner "MODE DEMO" sengaja ditanam di `apps/web/src/components/Shell.tsx`. Hapus hanya setelah poin 1–4 selesai.

## Kendala umum

| Masalah | Solusi |
|---|---|
| `docker compose` minta DB_PASSWORD / JWT_SECRET | Isi di file `.env` (langkah 2–3). |
| Web terbuka tapi login gagal "Tidak bisa terhubung ke server" | `NEXT_PUBLIC_API_URL` salah atau API belum jalan: `docker compose logs api`. Setelah mengubahnya, jalankan `docker compose up -d --build`. |
| Error CORS saat dibuka dari HP | `WEB_ORIGIN` harus sama persis dengan alamat web yang dibuka (termasuk http/https dan port). |
| "JWT_SECRET wajib diisi" | Minimal 32 karakter. |
| Port 3000/4000 dipakai aplikasi lain | Ubah angka kiri di bagian `ports:` pada `docker-compose.yml`. |
| Scanner tidak mengisi kolom | Klik dulu kolom "Scan kartu santri"; pastikan scanner mode keyboard (HID). |
| Ingin mulai dari nol | `docker compose down -v` (**menghapus seluruh data**). |

## Struktur folder

```
e-qa/
  apps/api/      Backend NestJS (src/<modul>, src/db/migrations, test/)
  apps/web/      Web Next.js (src/app = halaman, src/components, src/lib)
  scripts/       backup.sh, restore.sh
  docs/          API.md, DRAFT-kebijakan.md
  docker-compose.yml, .env.example
```

Dokumentasi endpoint: `docs/API.md`. Draft kebijakan (butuh pemeriksaan hukum): `docs/DRAFT-kebijakan.md`.
