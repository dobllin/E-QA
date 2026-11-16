# Cara update E-QA (Windows + Docker Desktop)

> Ingin membuka dari HP lewat internet (demo)? Lihat **PASANG-CLOUD.md** (Neon + Render + Vercel).

Ikuti urut. Data (santri, saldo, kartu, top up) **tidak hilang** karena database ada di volume Docker, tapi tetap backup dulu.

## 0. Persiapan
1. Buka **Docker Desktop**, tunggu sampai kiri bawah tertulis **Engine running**.
2. Buka **PowerShell**, masuk ke folder yang berisi `docker-compose.yml`:
   ```
   cd C:\Users\nayak\Downloads\e-qa\e-qa
   ```
3. Cek Docker siap: `docker version` harus menampilkan **Client** dan **Server**. Kalau Server error, Docker belum siap.

## 1. Backup (disarankan)
```
docker compose up -d
docker compose exec -T db pg_dump -U eqa -d eqa --no-owner -f /tmp/backup.sql
docker compose cp db:/tmp/backup.sql backup-sebelum-update.sql
```
Pastikan file `backup-sebelum-update.sql` muncul di folder dan ukurannya wajar (puluhan KB atau lebih).

## 2. Timpa file
- **Zip lengkap (`e-qa.zip`):** ekstrak, salin **isi** folder `e-qa` hasil ekstrak (`apps`, `docs`, `scripts`, `README.md`, `docker-compose.yml`, dll.) ke folder di langkah 0, pilih **Replace the files**.
- **Update sebagian (hanya folder/file yang berubah):** salin file ke path yang **sama** di folder lo (mis. `apps\api\src\...`), timpa yang lama.
- **Jangan hapus atau timpa `.env` lo.** Zip tidak berisi `.env`. Jika `.env.example` mendapat variabel baru, salin baris barunya ke `.env`.

## 3. Build ulang
```
docker compose up -d --build
```
Tunggu sampai kembali ke prompt (2-5 menit; lebih lama bila ada library baru).

## 4. Cek hasil
```
docker compose ps
docker compose logs api | Select-String "migrate"
```
- `docker compose ps`: `db`, `api`, `web`, dan `backup` harus **Up**.
- Log migrasi: harus ada baris `applied 0XX_....sql` untuk migrasi **baru** (yang sudah pernah terpasang tidak muncul lagi). **Update ke v1.0: harus ada `applied 015_impor_santri.sql`** (dan `014_notifikasi_bayar.sql` bila sebelumnya masih v0.8.x) (dan `012_absen_pengingat.sql` bila sebelumnya Anda belum memasang v0.8; bila masih di versi sebelum v0.7, juga 010 dan 011). Daftar migrasi per versi ada di bawah.

## 5. Buka aplikasi
Buka http://localhost:3000 dan tekan **Ctrl+F5** (muat ulang bersih), lalu login.

## Kalau gagal
| Gejala | Tindakan |
|---|---|
| `failed to connect to the docker API ... dockerDesktopLinuxEngine` | Docker Desktop belum menyala. Buka, tunggu "Engine running", ulangi. |
| Build gagal (`ERROR [web build ...` / `[api build ...`) | Salin bagian error di bawah baris `ERROR` dan kirim. |
| `api` Exited / Restarting | `docker compose logs api` lalu kirim 20 baris terakhir. |
| Login "Tidak bisa terhubung ke server" | API belum jalan: cek `docker compose ps` dan `docker compose logs api`. |
| Menu/tampilan baru tidak muncul | Ctrl+F5; pastikan `docker compose up -d --build` selesai tanpa error. |

## Kembali ke data sebelum update (restore)
**Hanya kalau perlu.** Ini MENGGANTI seluruh data dengan isi backup.
```
docker compose stop api web
docker compose exec -T db psql -U eqa -d postgres -c "DROP DATABASE IF EXISTS eqa;" -c "CREATE DATABASE eqa OWNER eqa;"
docker compose cp backup-sebelum-update.sql db:/tmp/restore.sql
docker compose exec -T db psql -U eqa -d eqa -v ON_ERROR_STOP=1 -q -f /tmp/restore.sql
docker compose start api web
```
Catatan: kembali ke data lama berarti memakai kode lama juga; jika perlu, pasang kembali zip versi sebelumnya.

## Riwayat migrasi database (otomatis saat `api` menyala)
| Migrasi | Isi |
|---|---|
| 001_init | Tabel dasar: pengguna, santri, kartu, saldo, ledger, kantin, tagihan SPP, audit |
| 002_card_token | Kode QR kartu disimpan terenkripsi (tombol **Lihat kartu**) |
| 003_topup_requests | Top up transfer bank (kode unik, fee, pengaturan) |
| 004_topup_proofs | Foto bukti transfer |
| 005_fee_settlements | Tagihan jasa bulanan |
| 006_topup_tolerance_qris | Toleransi kelebihan transfer, jumlah diterima, QRIS |
| 007_pockets_laundry_spp | Kantong saldo (Jajan/Laundry/SPP), peran Laundry, produk per merchant, SPP per santri, bayar tagihan dari saldo |
| 008_split_bank_fields | Pembagian otomatis per nominal, rekening terstruktur (bank, nomor, atas nama) |
| 009_school_notifications_consent | Nama/logo pesantren, pemberitahuan wali, persetujuan privasi wali |
| 011_saldo_utama | Kantong Saldo, sisa kantong SPP dipindah ke Saldo, top up tunai dengan biaya layanan (tabel cash_topups, view fee_items) |
| 010_notification_kind | Jenis pemberitahuan (INFO/PAYMENT) untuk bunyi "Ada yang bayar" |
| 015_impor_santri | **v1.0:** kolom `santri.status_label`, `santri.bagian`, `santri.catatan` (dari impor Excel) |
| 014_notifikasi_bayar | **v0.9:** tabel `notification_prefs` (jenis notifikasi pembayaran yang dimatikan per pengguna) dan kolom `notifications.pay_type` |
| 013_pengingat_ulang | **v0.8.1:** pengaturan "ingatkan lagi setelah N hari" (standar 3) dan penanda pemberitahuan pengingat ulang (invoices.alert_sent_at) |
| 012_absen_pengingat | **v0.8:** jadwal pelajaran dan absen santri (tabel class_schedules, attendance), penanda "sudah diingatkan" di tagihan (invoices.last_reminded_at), log pengingat (reminder_log) |

## Yang harus terlihat per versi
- **Terbaru (v0.5):** menu samping punya judul kelompok; halaman **Transaksi** dan **Pengaturan sekolah**; dashboard punya kotak **Perlu tindakan** dan grafik; di Santri ada tombol **Kelola kelas**; saat wali login pertama muncul **persetujuan privasi**; ada tombol **Ganti password** di menu samping (semua peran); layar kasir menampilkan layar sukses besar. Lakukan juga:
  1. **Admin: isi nama pesantren** di *Pengaturan sekolah* (dan unggah logo) agar tampil di kartu baru.
  2. **Layanan `backup`** otomatis ikut menyala; cek `docker compose ps` harus ada 4 layanan (db, api, web, backup) dan folder `backups` terisi setelah beberapa saat. Folder itu ada di komputer yang sama dengan database, jadi **salin juga ke flashdisk/cloud**.
- Sebelumnya (tampilan sederhana): portal wali memakai huruf besar dan tombol besar; kolom uang tampil `Rp 100.000`; layar cara transfer punya tombol **Salin no. rekening** dan **Salin jumlah**; **Top up masuk → Pengaturan** (Admin) punya kolom *Nama bank*, *Nomor rekening*, *Atas nama* (**isi ulang ketiganya sekali**, karena rekening lama ditulis sebagai satu teks); di Kasir, tombol **Scan pakai kamera** punya tombol **Foto QR**.
- Sebelumnya lagi (kantong, laundry):- **Terbaru (kantong, laundry, SPP per santri):** portal wali punya kartu *Kantong saldo* dan tombol **Pindahkan saldo**; tab Tagihan punya **Bayar dari saldo**; menu **Laundry** untuk peran Laundry; halaman Tagihan SPP punya **Tagihan per santri** dan **Ubah**; kolom **cari** di Kasir dan Produk; tombol **Pengaturan** di Top up masuk hanya untuk Admin.
- Sebelumnya: Top up masuk → Pengaturan punya *Toleransi kelebihan transfer* dan *Gambar QRIS*; layar top up wali menampilkan QRIS bila diunggah; **Setujui manual** punya kolom *jumlah yang masuk di rekening*.
- Sebelumnya lagi: menu **Tagihan jasa**; tombol **Unggah bukti transfer** di portal wali; tombol **Lihat kartu** di detail santri; kamera scan di Kasir.

## Yang harus terlihat setelah update ini (v0.6)
- Menu samping berupa **dropdown**: Santri dan uang, Kantin dan laundry, Laporan, Pengaturan (klik judul untuk buka/tutup; grup yang berisi halaman aktif selalu terbuka; pilihan diingat).
- Tombol **Pemberitahuan ▾** (dropdown) juga muncul untuk Super Admin, Admin, dan Bendahara. Di dalamnya ada pilihan **bunyi** dan **ucapan**, plus tombol coba bunyi.
- Saat wali mengirim bukti transfer atau membayar tagihan dari saldo, pengurus mendengar **nada naik "ka-ching" + ucapan "Ada yang bayar"** dan melihat kotak pemberitahuan. Nada ini beda dari bunyi pemberitahuan biasa. Aplikasi memeriksa tiap 20 detik selagi halaman terbuka.
- **Penting:** browser hanya mengizinkan suara setelah layar diketuk/diklik sekali. Jadi setelah membuka aplikasi, sentuh layar sekali. Tab yang ditutup tidak berbunyi (push notification belum ada).
- **Pasang di layar utama (PWA):** Android Chrome: menu ⋮ → Instal aplikasi / Tambahkan ke layar utama. iPhone Safari: Bagikan → Tambah ke Layar Utama. Pemasangan hanya muncul bila alamat memakai **HTTPS** (atau localhost). Lewat alamat IP http biasa, fitur pasang tidak tersedia, tapi aplikasi tetap jalan di browser.

## v1.0.1 (tanpa migrasi): siap dipasang online
Perubahan kode: koneksi database mendukung SSL (alamat berisi `sslmode=require`), `TRUST_PROXY` untuk pembatas laju, koneksi menganggur terputus tidak mematikan API. **Di Docker lokal tidak ada perubahan perilaku**; langkah update sama seperti di atas. Panduan online: PASANG-CLOUD.md.

## Yang harus terlihat setelah update v1.0 (Tagihan per santri, bayar tagihan dari "Pindahkan uang", Impor Excel)

Ada **migrasi 015** (menambah kolom label/bagian/catatan di data santri; data lama tidak berubah). Langkah update sama seperti di atas. Setelah `docker compose up -d --build`:
- `docker compose logs api | Select-String "migrate"` harus ada `applied 015_impor_santri.sql`.
- Buka aplikasi lalu **Ctrl+F5** (di HP: tutup tab lalu buka lagi).

Yang bisa dicoba:
1. **Menu "Tagihan"** (dulu "Tagihan SPP"). Satu santri satu baris; klik panah untuk membuka daftar tagihannya (Terima bayar dan Ubah ada di dalamnya). Ada tombol **Buka semua / Tutup semua**. Santri yang hanya punya satu tagihan tampil langsung tanpa dropdown.
2. Di tiap santri ada keterangan pengingat, mis. **"Diingatkan hari ini · diingatkan lagi Kamis 19/11/2026"**. Tanggalnya = hari terakhir diingatkan + jumlah hari di *Atur pesan & pengingat*. Bila belum pernah: "Belum diingatkan"; bila sudah waktunya: "Perlu diingatkan lagi".
3. **Portal wali → Pindahkan uang:** di pilihan *Pindahkan ke* ada kelompok **Bayar tagihan** (Uang Gedung, Kurang Bayar, SPP, dst). Pilih salah satunya, isi jumlah (boleh dicicil), tekan **Bayar**. Tagihan dibayar dari **Saldo** saja (kolom *Ambil dari* terkunci), jadi uang jajan dan uang laundry tidak terpakai.
4. **Pengaturan → Impor santri & tagihan** (Admin): tempel hasil copy dari Excel/Google Sheets **beserta baris judul**, isi *Tahun ajaran mulai* (mis. 2026) dan *Jatuh tempo biaya awal*, tekan **Periksa data**. Cek ringkasan dan daftar santri, centang konfirmasi, tekan **Impor**.

Aturan impor:
- Santri diberi nomor **01, 02, 03, ...** (lanjut dari nomor terakhir). Kelompok jadi kelas, "Keringanan" jadi label, ukuran seragam/peci jadi catatan (bukan tagihan).
- **"Rp -" = lunas** dan sel kosong = tidak ada tagihan: tidak dibuatkan tagihan. Hanya angka di atas nol yang jadi tagihan (belum dibayar).
- SPP: jatuh tempo **tanggal 10** (Jul-Des tahun mulai, Jan-Jun tahun berikutnya). Biaya lain (Form Pendaftaran, U Gedung, Uang Kegiatan, KBM, Daftar Ulang, Kurang Bayar, SKTM, Peci) jatuh tempo pada *Jatuh tempo biaya awal*, jadi yang sudah lewat langsung berkedip merah.
- Angka total di ujung baris dicocokkan dengan jumlah kolom. **Bila tidak sama, baris itu ditolak** dan tidak diimpor.
- Aman diulang: santri dengan nama yang sama dan tagihan yang sudah ada dilewati, tidak dobel. Nama kembar di data yang ditempel ditolak (bedakan namanya).
- Kartu QR/PIN dan akun wali **tidak** dibuat. Hubungkan wali lewat *Pengguna* dan halaman santri. Sebelum wali terhubung dan punya nomor HP, tombol **WhatsApp** menolak dengan pesan nomor belum diisi.
- **Data asli anak:** MODE DEMO masih menyala. Disarankan mencoba impor pertama di salinan, atau cadangkan database dulu (langkah backup di atas).

## Yang harus terlihat setelah update v0.9 (animasi halus + notifikasi pembayaran)

Ada **migrasi 014** (menambah tabel pilihan notifikasi; data lama tidak berubah). Langkah update sama seperti di atas. Setelah `docker compose up -d --build`:
- `docker compose logs api | Select-String "migrate"` harus ada `applied 014_notifikasi_bayar.sql`.
- Buka aplikasi lalu **Ctrl+F5**. Di HP/tablet: tutup tab lalu buka lagi. Bila popup notifikasi tidak muncul padahal sudah diizinkan, tutup semua tab E-QA lalu buka lagi (service worker diperbarui).

Yang bisa dicoba:
1. **HP/tablet:** tekan **Menu**, panel meluncur dari kiri dengan latar gelap yang memudar. Popup (mis. Terima bayar) naik dari bawah.
2. Login **Admin** atau **Bendahara**, tekan **Pemberitahuan**, lalu **Atur notifikasi**. Pilih jenis pembayaran yang mau diberi tahu, tekan **Simpan pilihan**. Tekan **Aktifkan notifikasi browser** dan pilih **Izinkan**.
3. Pindah ke tab lain. Dari akun lain (mis. Bendahara) catat pembayaran di loket. Dalam sekitar 10 detik (bisa sampai satu menit bila tab lama tersembunyi): popup muncul, judul tab berkedip "Pembayaran baru", dan bunyi berbunyi.

Catatan penting:
- Notifikasi hanya jalan **selama aplikasi masih terbuka di browser** (boleh di tab lain). Bila browser ditutup atau HP terkunci lama, tidak ada notifikasi. Notifikasi saat browser tertutup butuh "push" sungguhan dan baru bisa setelah aplikasi online dengan HTTPS.
- Bunyi baru boleh keluar setelah Anda menyentuh halaman sekali (aturan browser).
- Pilihan jenis notifikasi berlaku **per akun**; pelaku sendiri tidak diberi tahu soal tindakannya (mis. Bendahara yang mencatat bayar tidak mendapat notifikasi "Pembayaran di loket").

## Yang harus terlihat setelah update v0.8.2 (tampilan HP dan tablet)

Update ini hanya mengubah tampilan web. **Tidak ada migrasi database**, data tidak berubah. Langkah update sama seperti di atas; setelah `docker compose up -d --build`, buka aplikasi lalu tekan **Ctrl+F5** (di HP: tutup tab lalu buka lagi, atau hapus cache situs bila tampilan masih lama).

- Di HP dan tablet (layar di bawah 900 px) semua tabel tampil sebagai **kartu**: satu kartu per baris, tiap data punya label di kirinya. Tombol seperti **WhatsApp**, **Terima bayar**, **Ubah** selalu terlihat tanpa menggeser ke samping.
- Di laptop/komputer tampilan tabel tetap seperti biasa.
- Jendela popup (antrean WhatsApp, atur pesan, terima bayar) tampil sebagai lembar dari bawah dan bisa digulir.

## Yang harus terlihat setelah update v0.8.1 (pengingat ulang + titik merah tunggakan)
Tes cepat (sekitar 5 menit), login sebagai **Bendahara** atau **Admin**:
1. **Tagihan SPP:** setiap tunggakan (lewat jatuh tempo, belum lunas) punya **titik merah berkedip** di kolom Status, plus tulisan: **Belum diingatkan** / **Diingatkan tanggal ...** / **Perlu diingatkan lagi**.
2. **Menu samping:** di **Tagihan SPP** ada titik merah + angka = jumlah wali yang **perlu diingatkan** (belum pernah, atau sudah lewat batas hari). Di judul grup **Santri dan uang** juga ada titik merah supaya terlihat saat grup tertutup. Angka turun setelah Anda menekan tombol WhatsApp.
3. **Atur pesan & pengingat** (tombol di atas daftar tagihan): isi **"Ingatkan lagi bila masih belum bayar setelah ... hari"** (standar 3; isi 0 untuk mematikan), lalu Simpan.
4. **Pemberitahuan ▾:** bila ada wali yang sudah diingatkan tetapi setelah batas hari masih belum bayar, muncul "**Perlu diingatkan lagi**" (sekali per putaran, bukan berulang-ulang).
- **Penting:** pemberitahuan itu dibuat saat ada pengurus yang **membuka aplikasi** (diperiksa tiap 20 detik). Jika tidak ada yang membuka aplikasi, pemberitahuan muncul begitu aplikasi dibuka lagi. Tidak ada push saat tab tertutup.
- Sistem **tidak bisa tahu wali membalas pesan atau tidak**. "Belum menjawab" di sini berarti **tagihan masih belum lunas** setelah N hari sejak diingatkan terakhir.
- Data lama tidak berubah. Migrasi 013 hanya menambah satu pengaturan dan satu kolom.

## Yang harus terlihat setelah update v0.8 (Absen, rekap harian, WhatsApp tunggakan)
Tes cepat (sekitar 10 menit), urut:
1. **Pengguna → Ubah:** ada kolom **Nomor HP** dan tombol **Ubah** di tiap akun. **Isi nomor HP semua wali** (contoh `081234567890`); yang belum diisi tertulis merah "Belum diisi". Tanpa nomor, tombol WhatsApp tidak bisa membuka chat.
2. **Tagihan SPP:** tunggakan punya **titik merah berkedip** (belum diingatkan) dan tombol **WhatsApp**. Tekan: WhatsApp (aplikasi atau WhatsApp Web) terbuka dengan pesan sudah terisi; tekan **Kirim** di WhatsApp. Kembali ke sini: titik merah hilang dan tertulis "Diingatkan tanggal ...". Tombol **Ingatkan lewat WhatsApp** (kanan atas) membuka wali satu per satu; **Atur isi pesan** mengubah kalimatnya.
3. **Buat akun Guru** di Pengguna (peran Guru). Lalu **Jadwal & laporan absen** (menu Absensi, Admin): **Tambah jadwal** (pelajaran, jam mulai-selesai, hari, kelas, akun guru). Di situ juga atur batas terlambat (standar 10 menit).
4. **Login sebagai Guru** → menu **Absen kelas**: isi nama yang memakai akun, pilih pelajaran, scan kartu santri (scanner USB, ketik kode + Enter, atau kamera). Tanpa PIN. Scan di luar jam pelajaran ditolak. Coba scan kartu yang sama dua kali: tidak dihitung dua.
5. **Login sebagai Kasir (atau Laundry):** tombol **Rekap hari ini** (lihat, **Unduh Excel (CSV)**, **Cetak / simpan PDF**) dan **Kelola barang** (tambah/ubah barang jualan sendiri).
- Semua data lama (santri, saldo, tagihan) tidak berubah. Migrasi 012 hanya menambah tabel/kolom baru.
- **Belum terbukti di perangkat asli:** pembukaan WhatsApp di HP/komputer Anda, scan kamera/scanner USB untuk absen, dan cetak PDF dari printer Anda. Mohon dicoba dan dikabari hasilnya.

## Yang harus terlihat setelah update v0.7 (Saldo utama)
- Wali: bagian **Uang anak Anda saat ini** berisi kartu **Saldo**, **Uang jajan**, **Uang laundry**, dan satu kartu untuk **setiap tagihan belum lunas** (SPP, Uang Gedung, ...). Tombol "Atur pembagian otomatis" dan kotak "Bagi untuk apa saja" sudah tidak ada.
- Top up masuk ke **Saldo**. Wali menekan **Pindahkan ke sini** pada Uang jajan/laundry, atau **Bayar dari saldo** pada kartu tagihan (langsung terbayar, ada kwitansi).
- Kantin hanya memotong **Uang jajan**. Anak baru bisa jajan setelah wali memindahkan uang ke Uang jajan. Untuk santri yang walinya tidak memakai aplikasi, bendahara bisa memilih **Masuk ke: Uang jajan langsung** saat top up tunai.
- Top up tunai: layar bendahara menampilkan "Terima dari wali: nominal + biaya layanan". Biaya tunai ikut masuk **Tagihan jasa** bulanan (ditandai "(tunai)").
- Sisa uang di kantong SPP lama otomatis pindah ke Saldo (cek log: `applied 011_saldo_utama.sql`).
