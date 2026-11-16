-- Token QR disimpan TERENKRIPSI (AES-256-GCM) agar admin bisa melihat/mencetak ulang kartu.
-- Hash untuk pencarian (barcode_hash) tetap ada. PIN tidak pernah bisa dilihat.
-- Kartu lama (sebelum migrasi ini) berisi NULL: preview tidak tersedia sampai kartu diganti.
ALTER TABLE cards ADD COLUMN token_enc text;
