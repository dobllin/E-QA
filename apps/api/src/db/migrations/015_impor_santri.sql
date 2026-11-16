-- v1.0: data tambahan santri dari impor Excel (label status, bagian, catatan ukuran seragam/peci).
ALTER TABLE santri ADD COLUMN status_label text;
ALTER TABLE santri ADD COLUMN bagian text;
ALTER TABLE santri ADD COLUMN catatan text;
