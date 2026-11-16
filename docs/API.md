# Dokumentasi API E-QA (v0.8.1, DEMO)

Basis URL: `http://localhost:4000`. Semua endpoint (kecuali login/refresh/logout) butuh header `Authorization: Bearer <accessToken>`.
Error selalu berbentuk `{ "statusCode", "code", "message" }` dengan `message` berbahasa Indonesia.
Nominal = Rupiah bulat (integer). SUPER_ADMIN lolos semua pemeriksaan peran.

## Auth
| Metode | Path | Peran | Keterangan |
|---|---|---|---|
| POST | /auth/login | publik | `{username,password}` → `{accessToken,refreshToken,user}` (batas 20/menit/IP) |
| POST | /auth/refresh | publik | `{refreshToken}` → token baru; token lama langsung dicabut |
| POST | /auth/logout | publik | `{refreshToken}` |
| GET | /auth/me | login | profil singkat |

## Pengguna (ADMIN)
GET /users · POST /users `{username,password,fullName,role}` · PATCH /users/:id/active `{isActive}` · POST /users/:id/reset-password `{password}`
(Hanya SUPER_ADMIN yang boleh membuat akun ADMIN.)

## Santri (ADMIN, BENDAHARA, GURU baca; ADMIN tulis)
GET /santri?q=&kelas= · GET /santri/:id · POST /santri `{nis,fullName,kelas?}` · POST /santri/bulk `{rows:[{nis,fullName,kelas?}]}` (maks 1000; NIS ada = dilewati)
PATCH /santri/:id · POST /santri/:id/walsan `{userId,relation?}` · DELETE /santri/:id/walsan/:userId

## Kartu
| Metode | Path | Peran | Keterangan |
|---|---|---|---|
| POST | /cards/issue | ADMIN | `{santriId, pin?, mustChange?}` → `{cardId,publicNumber,barcodeToken,initialPin}` **tampil sekali**. `pin` (6 angka) opsional: kosong = acak. `mustChange` default `true` (santri wajib ganti PIN saat pertama bayar). `barcodeToken` = isi kode QR di kartu. |
| GET | /cards/:id/preview | ADMIN | Lihat kartu (QR) untuk dicetak ulang: `{publicNumber,barcodeToken,santri}`. Hanya kartu hidup yang dibuat setelah fitur ini; tercatat di audit log (`CARD_VIEW`). Token disimpan terenkripsi. Error `PREVIEW_UNAVAILABLE` untuk kartu lama. |
| GET | /cards?santriId= | ADMIN, BENDAHARA, KASIR | riwayat kartu + event |
| POST | /cards/:id/suspend | ADMIN | `{reason}` nonaktif sementara |
| POST | /cards/:id/unsuspend · /unlock | ADMIN | aktifkan / buka kunci |
| POST | /cards/:id/reset-pin | ADMIN | `{pin?, mustChange?}` → `{initialPin}` sekali |
| POST | /cards/:id/replace | ADMIN | `{reason, pin?, mustChange?}` → kartu baru; kartu lama mati permanen; saldo ikut ke kartu baru |
| POST | /cards/change-pin | ADMIN, KASIR | `{barcode,currentPin,newPin}` (6 angka, bukan urutan/angka sama) |

## Saldo
| POST | /wallet/topup | BENDAHARA | `{santriId,amount(1.000–5.000.000),method:CASH_COUNTER\|BANK_TRANSFER,idempotencyKey,note?}` |
|---|---|---|---|
| POST | /wallet/refund | BENDAHARA | `{orderId,reason}` → entri pembalik; stok kembali; tidak bisa dua kali |
| PATCH | /wallet/:santriId/limits | BENDAHARA, ADMIN | `{dailyLimit?,perTxLimit?}` (null = tanpa batas) |
| GET | /wallet/:santriId/ledger | BENDAHARA, ADMIN | mutasi |

**Tidak ada endpoint untuk mengubah saldo langsung.** Saldo hanya berubah lewat entri ledger.

## Kantin
| GET | /products | KASIR, ADMIN, BENDAHARA | |
|---|---|---|---|
| POST/PATCH | /products(/:id) | ADMIN, BENDAHARA | `{name,price,stock,isActive?}` |
| POST | /pos/pay | KASIR | `{barcode,pin,idempotencyKey, items:[{productId,qty}] ATAU amount, note?}` |

Kode error `/pos/pay`: `CARD_UNKNOWN` 404 · `CARD_SUSPENDED/LOCKED/REPLACED` 403 · `PIN_WRONG` 422 (+`attemptsLeft`) · `PIN_MUST_CHANGE` 409 · `INSUFFICIENT_BALANCE` 422 · `OUT_OF_STOCK` 409 · `PER_TX_LIMIT`/`DAILY_LIMIT` 422.
Mengulang request dengan `idempotencyKey` yang sama mengembalikan hasil yang sama dengan `duplicate:true` dan **tidak mendebit lagi**.

## Tagihan (BENDAHARA tulis; ADMIN baca)
POST /billing/generate `{period:"YYYY-MM",title,amount,dueDate,kelas?}` (idempotent per santri+periode+jenis) ·
GET /billing/invoices?status=&period=&santriId=&q= (status: UNPAID, PARTIAL, OVERDUE, PAID, CANCELLED) ·
POST /billing/pay `{invoiceId,amount,method:CASH\|TRANSFER,idempotencyKey,note?}` (melebihi sisa ditolak) ·
POST /billing/invoices/:id/cancel (hanya yang belum dibayar sama sekali) · GET /billing/payments/:id (data kwitansi)

## Portal wali (WALSAN) — hanya anak yang terhubung, selain itu 404
GET /portal/children · GET /portal/children/:id/ledger · /orders (dengan item) · /invoices (dengan riwayat bayar)

## Top up transfer bank (kode unik)

Wali membuat permintaan → transfer **tepat** `total` ke rekening pesantren → bendahara mencocokkan mutasi bank → menyetujui → saldo masuk.
`total = amount + uniqueCode + fee`. Saldo yang masuk = **jumlah yang benar-benar diterima di rekening dikurangi `fee`** (`receivedAmount - fee`). Bila transfer persis sama, itu sama dengan `amount + uniqueCode`. **Fee bukan saldo.** `total` unik di antara permintaan terbuka.

**Sisi wali (WALSAN, hanya anak yang terhubung, selain itu 404)**
| Metode | Path | Keterangan |
|---|---|---|
| GET | /portal/topup-info | `{fee,min,max,expiryHours,bankInfo,bankName,bankAccount,bankHolder,tolerance,hasQris}` (nomor rekening terpisah supaya bisa disalin) |
| GET | /portal/topup-qris | gambar QRIS pesantren (404 bila belum diunggah) |
| POST | /portal/children/:id/topups | `{amount}` → `{id,amount,uniqueCode,fee,total,credited,expiresAt,bankInfo}`. Maks 3 permintaan terbuka per santri. Error: `AMOUNT_RANGE`, `BANK_NOT_SET`, `TOO_MANY_OPEN` |
| GET | /portal/children/:id/topups | riwayat + `proofs`, `proofMatch` |
| POST | /portal/topups/:rid/cancel | batalkan (hanya `PENDING` milik sendiri) |
| POST | /portal/topups/:rid/proof | **multipart**: `file` (JPG/PNG/WebP ≤ 3 MB, jenis dicek dari isi file) + `ocrAmounts` (JSON array angka yang terbaca di foto). Maks 3 foto/permintaan. `amountMatch` = salah satu angka sama dengan `total`. Foto yang sama (hash) tidak bisa dipakai dua kali: `PROOF_DUPLICATE`. **Tidak mengubah saldo.** |

**Sisi staf**
| Metode | Path | Peran | Keterangan |
|---|---|---|---|
| GET | /topups?status= | ADMIN, BENDAHARA | status: `PENDING, MATCHED, CREDITED, REJECTED, EXPIRED, CANCELLED` |
| POST | /topups/match | BENDAHARA | `{lines:[{ref,amount}]}` (baris mutasi bank). Jumlah boleh **sama atau lebih** dari `total` sampai batas `tolerance`; kurang dari `total` tidak dicocokkan. Bila ada beberapa kandidat dan tidak ada yang persis → `ambiguous` (diproses manual). Hanya menandai `MATCHED` dan menyimpan `receivedAmount`; baris dengan `ref` sama dilewati (`duplicates`). Respons: `{matched,ambiguous,duplicates,unmatched}` |
| POST | /topups/:id/approve | BENDAHARA | `{note?, receivedAmount?}`. `MATCHED` boleh tanpa catatan; `PENDING` (manual) wajib `note`. `receivedAmount` = jumlah yang benar-benar masuk di rekening bila berbeda dari yang tercatat (catatan wajib, `RECEIVED_NOTE`); saldo masuk = `receivedAmount - fee`, minimal Rp1.000 (`CREDIT_TOO_SMALL`). Pembuat permintaan tidak boleh menyetujui sendiri. Tidak bisa dua kali (`ALREADY_CREDITED`) |
| POST | /topups/:id/reject | BENDAHARA | `{note}` |
| GET | /topups/:id/proofs | ADMIN, BENDAHARA | daftar foto bukti (metadata) |
| GET | /topups/proofs/:pid/image | ADMIN, BENDAHARA | isi foto; tercatat di audit log (`TOPUP_PROOF_VIEW`) |
| GET/PUT | /topups/settings | **ADMIN** (hanya Admin; Bendahara tidak punya akses rekening/QRIS) | `{fee(0–20000),min,max,expiryHours,bankName,bankAccount,bankHolder,tolerance(0–20000)}` (teks rekening untuk wali, `bankInfo`, disusun otomatis dari tiga kolom itu; `bankInfo` lama masih diterima bila rekening terstruktur kosong); GET juga mengembalikan `hasQris`. `tolerance` = batas kelebihan transfer yang masih dicocokkan otomatis (0 = wajib persis) |
| PUT | /topups/qris | ADMIN | **multipart** `file` (JPG/PNG/WebP ≤ 2 MB): gambar QRIS pesantren. Tercatat di audit log |
| DELETE | /topups/qris | ADMIN | hapus QRIS |
| GET | /topups/qris | ADMIN | gambar QRIS |
| GET | /topups/report?month=YYYY-MM | ADMIN, BENDAHARA | `{count,feeTotal,creditedTotal}` |

## Tagihan jasa bulanan (fee aplikasi) — ADMIN, BENDAHARA
| Metode | Path | Keterangan |
|---|---|---|
| GET | /fees/months | per bulan: `count,feeTotal,creditedTotal,status`. Status: `BERJALAN, TIDAK_ADA, BELUM_DIBAYAR, DIBAYAR, LUNAS` |
| GET | /fees/summary | `{unpaidMonths,unpaidTotal,awaitingConfirmation}` untuk pengingat |
| GET | /fees/months/:month | rincian top up selesai bulan itu + total |
| GET | /fees/months/:month/csv | unduh CSV (pemisah `;`, UTF-8 BOM, bisa dibuka di Excel) |
| POST | /fees/months/:month/paid | `{paidAt:"YYYY-MM-DD", note}` — pesantren menandai sudah menyetor. Bulan berjalan ditolak (`MONTH_OPEN`); tidak bisa dua kali (`ALREADY_PAID`) |
| POST | /fees/months/:month/received | **SUPER_ADMIN saja**: konfirmasi uang diterima → `LUNAS` |
| DELETE | /fees/months/:month/paid | **SUPER_ADMIN saja**: batalkan penandaan (tercatat di audit log) |


## Saldo utama, kantong, dan kartu tagihan — v0.7 (migrasi 011)
Tiap santri punya 3 kantong: `SALDO` (semua top up masuk ke sini), `JAJAN` (dipakai Kasir), `LAUNDRY` (dipakai petugas Laundry). Kantong `SPP` lama dihapus; sisa isinya dipindah ke `SALDO` oleh migrasi (dua entri ledger `TRANSFER`). **Pembagian otomatis dihapus.**
| Method | Path | Keterangan |
|---|---|---|
| GET | /portal/children | `balance` (= Jajan) dan `pockets: {SALDO,JAJAN,LAUNDRY}` |
| POST | /portal/children/:id/transfer | `{from,to,amount(≥1000),idempotencyKey}` antar kantong (`SALDO`/`JAJAN`/`LAUNDRY`). Dua entri ledger `TRANSFER` dalam satu transaksi |
| GET | /portal/children/:id/bills | kartu tagihan: tagihan belum lunas dikelompokkan per `title`: `[{title, remaining, count, nextDue, overdue}]` |
| POST | /portal/children/:id/bills/pay | `{title, amount, idempotencyKey}` pindahkan **Saldo → tagihan** = bayar. Dialokasikan ke tagihan paling lama dulu (`due_date`, `period`), boleh cicil, maks sebesar sisa (`OVERPAY`), saldo harus cukup (`INSUFFICIENT_BALANCE`). Satu kwitansi per tagihan tersentuh; respons `{receipts[], balanceAfter, remaining}`. Pengurus mendapat "Ada yang bayar" |
| POST | /portal/children/:id/invoices/:invId/pay | cara lama per tagihan: `{sources:[{pocket,amount}], idempotencyKey}` |
| POST | /portal/children/:id/topups | `{amount}`. Tidak ada lagi `targetPocket`/`allocSpp`/`allocLaundry` (ditolak 400). Saat disetujui, uang masuk ke `SALDO` |
| POST | /wallet/topup | bendahara, top up tunai/manual: `{santriId, amount, method, pocket?='SALDO', idempotencyKey}`. **Biaya layanan ditambahkan di atas nominal**: respons `{fee, collect (= amount+fee), balanceAfter}`; masuk ke santri tetap `amount`. Dicatat di `cash_topups` dan ikut tagihan jasa bulanan |
| GET | /wallet/topup-fee | `{fee}` agar petugas tahu tunai yang harus diterima |
| GET | /fees/months/:month | item memuat `kind` (`TRANSFER`/`TUNAI`); view `fee_items` menggabungkan keduanya |


## Peran Laundry — v0.3
Peran `LAUNDRY` seperti Kasir tetapi **terpisah**: hanya melihat layanan laundry, membayar dari kantong `LAUNDRY`, dan tidak bisa memakai fitur lain. Kasir hanya melihat produk kantin dan membayar dari kantong `JAJAN`. Produk bertipe `LAUNDRY` tidak melacak stok.
| Metode | Path | Keterangan |
|---|---|---|
| POST | /pos/pay | peran `KASIR` (kantin) atau `LAUNDRY`; merchant dan kantong ditentukan dari peran. Produk lintas merchant → `PRODUCT_NOT_FOUND` |
| GET | /products?merchant= | Kasir/Laundry otomatis terfilter; Admin/Bendahara boleh `KANTIN` atau `LAUNDRY` |
| POST | /products | tambahan `merchant?` (`KANTIN` default, atau `LAUNDRY`) |
| POST | /users | `role: LAUNDRY` boleh dibuat oleh Admin |

## SPP per santri dan edit tagihan — v0.3 (BENDAHARA)
| Metode | Path | Keterangan |
|---|---|---|
| PATCH | /santri/:id/spp | ADMIN, BENDAHARA: `{sppAmount|null}` nominal SPP khusus santri |
| POST | /billing/generate | `usePerStudent?: true` memakai nominal SPP tiap santri; `amount` jadi nominal cadangan (opsional). Respons: `{created, skippedNoRate}` |
| POST | /billing/invoices | `{santriId,period,title,amount,dueDate}` tagihan untuk satu santri; duplikat `santri+periode+judul` → `INVOICE_EXISTS` |
| PATCH | /billing/invoices/:id | `{title?,dueDate?,total?,reason?}` ubah tagihan. `total` tidak boleh di bawah yang sudah dibayar (`BELOW_PAID`); perubahan `total` wajib `reason` (`REASON_REQUIRED`); status menyesuaikan; nilai lama/baru tercatat di audit log (`INVOICE_EDIT`). Tagihan `CANCELLED/WAIVED` tidak bisa diubah |


## Identitas pesantren, akun, dan persetujuan — v0.5
| Metode | Path | Peran | Keterangan |
|---|---|---|---|
| GET | /public/school | publik | `{name, hasLogo}` (dipakai halaman login dan kartu) |
| GET | /public/school/logo | publik | gambar logo (404 bila belum ada) |
| PUT | /settings/school | ADMIN | `{name}` |
| PUT/DELETE | /settings/school/logo | ADMIN | multipart `file` (JPG/PNG/WebP ≤ 1 MB; jenis dicek dari isi) / hapus |
| POST | /auth/change-password | login | `{currentPassword,newPassword(≥8)}`; semua sesi login dicabut. Error: `PASSWORD_WRONG`, `PASSWORD_SAME` |
| GET | /auth/me | login | profil + `consentAt`, `consentVersion` |
| POST | /portal/consent | WALSAN | `{version}` persetujuan privasi wali (tercatat di audit log) |

## Pemberitahuan dalam aplikasi — v0.5
Pemberitahuan dibuat otomatis untuk wali anak terkait: belanja (kantin/laundry), isi saldo disetujui, tagihan baru (satu dan massal), kartu dinonaktifkan sementara / terkunci. Tiap pengguna hanya melihat miliknya. Untuk pengurus (Super Admin/Admin/Bendahara) dibuat pemberitahuan `PAYMENT` berjudul "Ada yang bayar" saat wali mengunggah bukti transfer (`POST /portal/topups/:rid/proof`) atau membayar tagihan dari saldo (`POST /portal/children/:id/invoices/:invId/pay`); web membunyikan nada khusus untuk jenis ini (migrasi 010).
| GET | /notifications | login | `{unread, items:[{id,title,body,link,kind,readAt,createdAt}]}` (50 terbaru). `kind` = `INFO` atau `PAYMENT` |
|---|---|---|---|
| POST | /notifications/read-all, /notifications/:id/read | login | tandai dibaca |
| POST | /import/preview | ADMIN | `{text, startYear, entryDue}` → pratinjau impor santri + tagihan dari data tempel Excel (tidak mengubah apa pun): `{columns, sections, ignoredLines, rows:[{line,name,nis,isNew,kelas,statusLabel,bagian,catatan,invoices:[{title,period,dueDate,amount,exists}],sum,total,totalCheck,warnings,errors}], summary}`. Total ujung baris harus sama dengan jumlah kolom, bila tidak baris `errors`. Nama kembar di data → error. 422 `IMPORT_PARSE` bila baris judul tidak ada |
| POST | /import/commit | ADMIN | sama + `confirm:true` (wajib). Hanya baris tanpa `errors` yang masuk; santri baru diberi nomor urut (01, 02, ...) dan 3 dompet; tagihan `ON CONFLICT DO NOTHING` (aman diulang). → `{santriCreated, santriExisting, invoicesCreated, invoicesExisting, overdueCreated, skipped}`. Tercatat di audit `IMPORT_SANTRI_TAGIHAN` |
| GET | /notifications/prefs | ADMIN, BENDAHARA | `{types:[{key,label,hint,enabled}]}`. Kunci: `TOPUP_PROOF`, `TOPUP_DONE`, `WALI_PAY`, `LOKET_PAY` (standar semua menyala) |
| PUT | /notifications/prefs | ADMIN, BENDAHARA | `{muted:[kunci...]}` jenis yang DIMATIKAN untuk akun ini (kunci asing/dobel → 400). Pelaku tidak diberi notifikasi atas tindakannya sendiri (`TOPUP_DONE`, `LOKET_PAY`) |

## Santri dan kartu massal — v0.5 (ADMIN)
| Metode | Path | Keterangan |
|---|---|---|
| PATCH | /santri/:id | `{fullName?, nis?, kelas?, status?}`; NIS ganda → `NIS_TAKEN`. Status selain `ACTIVE` membuat kartu tidak bisa bertransaksi (`SANTRI_INACTIVE`); saldo dan riwayat tetap |
| POST | /santri/promote | `{fromKelas,toKelas}` naik kelas massal (hanya santri aktif) → `{moved}` |
| POST | /santri/graduate | `{kelas}` luluskan santri aktif di kelas itu → `{graduated}` |
| POST | /cards/issue-bulk | `{kelas}` atau `{santriIds:[…]}` (maks 300). Menerbitkan kartu untuk santri aktif yang belum punya kartu hidup; respons `{issued:[{santriId,fullName,nis,kelas,publicNumber,barcodeToken,initialPin}], candidates}` — **token dan PIN hanya dikembalikan sekali**. Tanpa target → `TARGET_REQUIRED` |

## Dashboard, transaksi, dan laporan — v0.5 (ADMIN, BENDAHARA)
| Metode | Path | Keterangan |
|---|---|---|
| GET | /reports/todo | "perlu tindakan": `topupMatched, topupPending, topupPendingWithProof, overdueCount, overdueTotal, cardsLocked, cardsSuspended, lowStock` |
| GET | /reports/trend | 7 hari terakhir: `[{date, sales, topups}]` (penjualan tidak menghitung transaksi yang dibatalkan) |
| GET | /reports/orders?q=&merchant=&from=&to= | daftar transaksi (maks 200) dengan item, kasir, dan `refunded`. Pembatalan memakai `POST /wallet/refund` (BENDAHARA) |
| GET | /reports/sales, /sales.csv | `?from=&to=&merchant=` penjualan per hari dan jenis |
| GET | /reports/arrears, /arrears.csv | tagihan lewat jatuh tempo per kelas dan santri |
| GET | /reports/topups, /topups.csv | `?from=&to=` rekap top up yang sudah masuk |
| GET | /reports/balances, /balances.csv | saldo tiap santri per kantong |

Berkas `.csv`: pemisah `;`, UTF-8 dengan BOM, langsung terbuka rapi di Excel Indonesia.

## Laporan
GET /reports/summary (ADMIN, BENDAHARA) · GET /reports/reconcile (BENDAHARA) · GET /reports/audit (ADMIN, BENDAHARA)

## Absen guru dan jadwal — v0.8 (migrasi 012)
Hari = 1 (Senin) sampai 7 (Ahad). Jam format `HH:MM`, zona Asia/Jakarta.
| Metode | Path | Peran | Keterangan |
|---|---|---|---|
| GET | /attendance/schedules | ADMIN | semua jadwal + nama akun guru |
| GET | /attendance/teachers | ADMIN | akun Guru aktif (untuk dipilih) |
| POST | /attendance/schedules | ADMIN | `{subject,kelas?,teacherId?,days:[1..7],startTime,endTime}` → satu jadwal per hari |
| PATCH | /attendance/schedules/:id | ADMIN | `{subject?,kelas?,teacherId?,dayOfWeek?,startTime?,endTime?,isActive?}` (`kelas`/`teacherId` string kosong = semua) |
| GET / PUT | /attendance/settings | ADMIN | `{lateMinutes}` (0-120, standar 10); guru boleh scan 10 menit sebelum mulai |
| GET | /attendance/report?from&to&scheduleId&kelas | ADMIN | baris absen (maks 2000); `/attendance/report.csv` untuk Excel |
| GET | /attendance/my-today | GURU | jadwal hari ini milik akun (atau jadwal tanpa guru tertentu) + `state` NOW/LATER/DONE + `present` |
| GET | /attendance/operators | GURU | nama yang pernah dipakai di akun ini |
| GET | /attendance/schedules/:id/today | GURU | `{schedule, present[], absent[]\|null}` (`absent` hanya bila jadwal punya kelas) |
| POST | /attendance/scan | GURU | `{scheduleId, barcode, operatorName}` → `{duplicate,status:HADIR\|TERLAMBAT,time,santriName}`. Tanpa PIN. Error: `NOT_STARTED`, `ALREADY_ENDED`, `WRONG_DAY`, `WRONG_CLASS`, `SCHEDULE_INACTIVE`, `CARD_UNKNOWN`, `CARD_REPLACED`, `NOT_YOUR_SCHEDULE` |
| DELETE | /attendance/:id | GURU | batalkan absen hari ini (audit `ATTENDANCE_REMOVE`) |

## Rekap harian dan barang jualan — v0.8
| Metode | Path | Peran | Keterangan |
|---|---|---|---|
| GET | /pos/daily?date=YYYY-MM-DD | KASIR, LAUNDRY, ADMIN, BENDAHARA | `{date,merchant,count,total,refundedCount,refundedTotal,byItem[],orders[]}`. Kasir=kantin, Laundry=laundry (ditentukan peran); Admin/Bendahara memakai `?merchant=KANTIN\|LAUNDRY`. Refund tidak dihitung di total |
| GET | /pos/daily.csv?date= | sama | CSV: transaksi, rekap per barang, total |
| POST / PATCH | /products | KASIR, LAUNDRY, ADMIN, BENDAHARA | Kasir/Laundry hanya untuk jenisnya sendiri (jenis ditentukan peran, bukan isian); PATCH jenis lain → 404. Audit `PRODUCT_UPDATE` menyimpan nilai lama dan baru |

## Pengingat tunggakan WhatsApp — v0.8 (ADMIN, BENDAHARA)
| Metode | Path | Keterangan |
|---|---|---|
| GET / PUT | /reminders/template | `{template}` (maks 1000 huruf); penanda `{nama_wali} {nama_santri} {tagihan} {sisa} {jatuh_tempo} {pesantren}`; GET juga memberi `defaultTemplate` |
| POST | /reminders/prepare | `{santriIds?[], onlyDue?}` (`onlyDue` = hanya yang perlu diingatkan: belum pernah, atau lewat batas hari) → `{items[{santriId,santriName,waliName,phone,hasPhone,invoiceIds,total,message,waUrl,reminded,needsReminder,lastRemindedAt}], withoutPhone}`. Satu item per santri yang punya tunggakan (jatuh tempo lewat). Tidak mengubah data |
| POST | /reminders/mark | `{santriId, invoiceIds[]}` → tandai `last_reminded_at`, catat `reminder_log` + audit `ARREARS_REMINDER`. Hanya tagihan milik santri itu yang belum lunas |
`GET /billing/invoices` kini memuat `lastRemindedAt`. `PATCH /users/:id` (ADMIN) `{fullName?, phone?}` mengubah nama/nomor HP (nomor divalidasi; `POST /users` kini juga menerima `phone`).

### Pengingat ulang — v0.8.1 (migrasi 013)
| Metode | Path | Peran | Keterangan |
|---|---|---|---|
| GET / PUT | /reminders/settings | ADMIN, BENDAHARA | `{repeatDays}` 0-60 (standar 3; 0 = tanpa pengingat ulang) |
| GET | /reminders/summary | ADMIN, BENDAHARA | `{needSantri, needInvoices, overdueSantri, repeatDays, alertedNow}` untuk titik merah menu samping. Sekaligus membuat pemberitahuan "Perlu diingatkan lagi" (INFO) **sekali per putaran** bila ada tagihan yang sudah diingatkan, lewat `repeatDays`, dan masih belum lunas |
`GET /billing/invoices` memuat `remindState`: `null` (tidak menunggak), `NEVER` (belum diingatkan), `WAIT` (baru diingatkan), `AGAIN` (perlu diingatkan lagi).
