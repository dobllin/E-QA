# DRAFT — Dokumen Kebijakan E-QA

> **DRAFT. Bukan nasihat hukum.** Seluruh isi perlu diperiksa penasihat hukum dan disesuaikan dengan aturan pesantren sebelum dipakai.

## 1. Pemberitahuan privasi & persetujuan wali (DRAFT)
- **Data yang diproses:** nama, NIS, kelas, saldo, riwayat belanja kantin, tagihan dan pembayaran SPP, status kartu.
- **Tujuan:** layanan kartu santri, belanja kantin, pencatatan tagihan, dan pelaporan kepada wali.
- **Tidak dikumpulkan:** data biometrik, lokasi GPS, atau data lain di luar tujuan di atas.
- **Akses:** wali hanya melihat data anaknya; staf sesuai peran; semua aksi penting tercatat di audit log.
- **Hak wali:** meminta salinan, koreksi, atau penghapusan data sesuai ketentuan yang berlaku dan kewajiban pencatatan keuangan.
- **Retensi:** (tentukan, misal data transaksi disimpan sekian tahun) — [ISI OLEH PESANTREN]
- **Persetujuan wali:** tanda tangan wali pada formulir pendaftaran (lampirkan teks ini).

## 2. Aturan kartu & PIN (DRAFT) — untuk santri dan wali
1. Kartu dan PIN adalah tanggung jawab santri. PIN diketik sendiri dan tidak boleh diberitahukan.
2. Transaksi dengan kartu + PIN yang benar dianggap sah.
3. Kartu hilang: segera lapor admin agar kartu **dinonaktifkan**. Transaksi sebelum laporan menjadi tanggungan santri, dibatasi **batas belanja harian** sebesar Rp[ISI].
4. Kartu pengganti dikenai biaya Rp[ISI]. Saldo dipindahkan ke kartu baru.
5. Salah PIN 3 kali mengunci kartu; hubungi admin untuk membuka.

## 3. Pernyataan batas tanggung jawab (DRAFT)
- Pengembang menyediakan perangkat lunak. Pengembang **tidak memegang, menampung, atau memutuskan** penggunaan dana santri.
- Dana dikelola oleh pesantren melalui rekening atas nama pesantren atau mitra berizin.
- Pengelola operasional (bendahara/admin) bertanggung jawab atas input saldo, penerimaan tunai, dan rekonsiliasi.
- Pemeliharaan, hak atas kode sumber, lisensi, dan SLA diatur dalam perjanjian tertulis terpisah. [ISI]

## 4. SOP rekonsiliasi harian (DRAFT)
1. Akhir hari: bendahara membuka **Laporan & audit → Rekonsiliasi saldo**. Harus "tidak ada selisih".
2. Cocokkan total top up tunai hari itu dengan uang tunai di loket dan bukti setoran.
3. Cocokkan pembayaran SPP transfer dengan mutasi rekening resmi pesantren.
4. Jika ada selisih: hentikan top up/koreksi manual, catat, laporkan ke penanggung jawab. Koreksi hanya lewat transaksi pembalik, tidak pernah mengubah data lama.
5. Lakukan backup (`./scripts/backup.sh`) dan simpan salinan di tempat terpisah.

## 5. Top up, biaya layanan, dan penagihan jasa (DRAFT)
1. **Rekening tujuan top up** adalah rekening atas nama pesantren. Pengembang tidak menerima atau memegang dana santri.
2. **Biaya layanan** (Rp[ISI] per top up) ditambahkan di atas nominal dan ditampilkan jelas ke wali sebelum membayar. Biaya ini **tidak** masuk saldo santri.
3. Saldo santri bertambah hanya setelah bendahara memverifikasi bahwa uang masuk ke rekening pesantren (mutasi bank). Foto/screenshot bukti transfer hanya alat bantu dan **bukan** dasar penambahan saldo.
4. **Kelebihan transfer** sampai batas toleransi Rp[ISI] dikenali otomatis dan **seluruh jumlah yang diterima dikurangi biaya layanan** menjadi saldo santri. Kelebihan di atas batas, dan **kekurangan** transfer, ditangani bendahara secara manual (kekurangan tidak disetujui sampai dilunasi, atau disetujui sebesar jumlah yang benar-benar diterima dengan catatan). [ISI]
5. **Penagihan jasa:** tiap akhir bulan sistem menghasilkan rincian total biaya layanan. Pesantren menyetor total itu ke rekening pengembang paling lambat [ISI] hari setelah bulan berakhir. Pengembang mengonfirmasi penerimaan di sistem.
6. Perbedaan angka antara rincian sistem dan catatan pesantren diselesaikan dengan memeriksa audit log dan mutasi rekening bersama-sama.
