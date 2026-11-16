import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { PoolClient } from 'pg';
import { Db } from '../db/db.service';
import { appErr } from '../common/errors';
import { audit } from '../common/audit';
import { notifyWalsan } from '../common/notify';
import { decryptToken, encryptToken, hashBarcode, MAX_PIN_ATTEMPTS, newBarcodeToken, newInitialPin, validatePin } from './card-crypto';

const STATUS_MSG: Record<string, string> = {
  SUSPENDED: 'Kartu dinonaktifkan sementara. Hubungi admin.',
  LOCKED: 'Kartu terkunci karena salah PIN. Hubungi admin.',
  REPLACED: 'Kartu ini sudah diganti dan tidak berlaku lagi.',
  REVOKED: 'Kartu ini sudah dicabut.',
};

export interface PinOpts { pin?: string; mustChange?: boolean }

/** Admin boleh menentukan PIN sendiri (6 angka, tidak boleh terlalu mudah ditebak). Kosong = acak. */
function checkPinOpts(opts: PinOpts) {
  if (opts.pin) {
    const bad = validatePin(opts.pin);
    if (bad) throw appErr(400, 'PIN_WEAK', bad);
  }
}

export type VerifyResult =
  | { ok: true; card: any }
  | { ok: false; error: ReturnType<typeof appErr> };

@Injectable()
export class CardsService {
  constructor(private db: Db) {}

  /**
   * Cari kartu dari barcode (row di-lock), cek status, lalu cek PIN.
   * Kalau PIN salah, hitungan gagal tetap di-commit (fungsi ini tidak melempar error),
   * jadi caller harus commit transaksi lalu melempar `error` SETELAH commit.
   */
  async verify(c: PoolClient, barcode: string, pin: string, opts: { allowMustChange?: boolean } = {}): Promise<VerifyResult> {
    const { rows } = await c.query(
      `SELECT c.*, s.full_name, s.status AS santri_status
         FROM cards c JOIN santri s ON s.id = c.santri_id
        WHERE c.barcode_hash = $1 FOR UPDATE OF c`, [hashBarcode(barcode)]);
    const card = rows[0];
    if (!card) return { ok: false, error: appErr(404, 'CARD_UNKNOWN', 'Kartu tidak dikenali') };
    if (card.status !== 'ACTIVE') return { ok: false, error: appErr(403, `CARD_${card.status}`, STATUS_MSG[card.status] ?? 'Kartu tidak aktif') };
    if (card.santri_status !== 'ACTIVE') return { ok: false, error: appErr(403, 'SANTRI_INACTIVE', 'Santri tidak aktif') };
    if (!card.pin_hash) return { ok: false, error: appErr(409, 'PIN_MUST_CHANGE', 'PIN belum dibuat. Buat PIN baru dulu.') };

    const good = await argon2.verify(card.pin_hash, pin);
    if (!good) {
      const failed = card.pin_failed + 1;
      const lock = failed >= MAX_PIN_ATTEMPTS;
      await c.query(`UPDATE cards SET pin_failed = $2, status = $3, updated_at = now() WHERE id = $1`,
        [card.id, failed, lock ? 'LOCKED' : 'ACTIVE']);
      if (lock) {
        await c.query(`INSERT INTO card_events(card_id, event, reason) VALUES ($1,'LOCKED','Salah PIN berulang')`, [card.id]);
        await notifyWalsan(c, card.santri_id, 'Kartu terkunci', `Kartu ${card.full_name} terkunci karena PIN salah beberapa kali. Hubungi pengurus pesantren untuk membukanya.`);
      }
      return {
        ok: false,
        error: lock
          ? appErr(403, 'CARD_LOCKED', 'PIN salah. Kartu terkunci, hubungi admin.')
          : appErr(422, 'PIN_WRONG', `PIN salah. Sisa percobaan: ${MAX_PIN_ATTEMPTS - failed}`, { attemptsLeft: MAX_PIN_ATTEMPTS - failed }),
      };
    }
    if (card.pin_failed > 0) await c.query('UPDATE cards SET pin_failed = 0 WHERE id = $1', [card.id]);
    if (card.pin_must_change && !opts.allowMustChange) {
      return { ok: false, error: appErr(409, 'PIN_MUST_CHANGE', 'Anda harus mengganti PIN awal sebelum bertransaksi.') };
    }
    return { ok: true, card };
  }

  private async createCard(c: PoolClient, santriId: string, actorId: string, event: string, reason?: string, opts: PinOpts = {}) {
    const token = newBarcodeToken();
    const pin = opts.pin || newInitialPin();
    const { rows } = await c.query(
      `INSERT INTO cards(santri_id, public_number, barcode_hash, pin_hash, pin_must_change, token_enc)
       VALUES ($1, 'EQA-' || nextval('card_public_seq'), $2, $3, $4, $5)
       RETURNING id, public_number AS "publicNumber"`,
      [santriId, hashBarcode(token), await argon2.hash(pin), opts.mustChange ?? true, encryptToken(token)]);
    await c.query('INSERT INTO card_events(card_id, event, actor_id, reason) VALUES ($1,$2,$3,$4)', [rows[0].id, event, actorId, reason ?? null]);
    // Token & PIN awal hanya dikembalikan SEKALI ini. Di database hanya tersimpan hash.
    return { cardId: rows[0].id as string, publicNumber: rows[0].publicNumber as string, barcodeToken: token, initialPin: pin };
  }

  async issue(actorId: string, santriId: string, opts: PinOpts = {}) {
    checkPinOpts(opts);
    return this.db.tx(async (c) => {
      const s = (await c.query('SELECT id, status FROM santri WHERE id = $1 FOR UPDATE', [santriId])).rows[0];
      if (!s) throw appErr(404, 'SANTRI_NOT_FOUND', 'Santri tidak ditemukan');
      const live = (await c.query(`SELECT 1 FROM cards WHERE santri_id = $1 AND status IN ('ACTIVE','SUSPENDED','LOCKED')`, [santriId])).rows[0];
      if (live) throw appErr(409, 'CARD_EXISTS', 'Santri sudah punya kartu aktif. Gunakan "Ganti kartu" jika hilang.');
      const r = await this.createCard(c, santriId, actorId, 'ISSUED', undefined, opts);
      await audit(c, actorId, 'CARD_ISSUE', 'card', r.cardId, { santriId });
      return r;
    });
  }

  /** Terbitkan kartu untuk banyak santri sekaligus (satu kelas atau daftar). Hanya santri aktif yang belum punya kartu hidup. Token dan PIN hanya dikembalikan sekali. */
  async issueBulk(actorId: string, opts: { kelas?: string; santriIds?: string[] }) {
    const { rows } = await this.db.query(
      `SELECT s.id, s.full_name, s.nis, s.kelas FROM santri s
        WHERE s.status = 'ACTIVE' AND ($1::text IS NULL OR s.kelas = $1) AND ($2::uuid[] IS NULL OR s.id = ANY($2))
          AND NOT EXISTS (SELECT 1 FROM cards c WHERE c.santri_id = s.id AND c.status IN ('ACTIVE','SUSPENDED','LOCKED'))
        ORDER BY s.kelas, s.full_name LIMIT 300`, [opts.kelas?.trim() || null, opts.santriIds?.length ? opts.santriIds : null]);
    const out: any[] = []; let i = 0;
    const worker = async () => {
      while (i < rows.length) {
        const s = rows[i++];
        try { const r = await this.issue(actorId, s.id); out.push({ santriId: s.id, fullName: s.full_name, nis: s.nis, kelas: s.kelas, ...r }); } catch { /* lewati santri yang gagal */ }
      }
    };
    await Promise.all(Array.from({ length: 4 }, worker));
    out.sort((a, b) => (a.kelas ?? '').localeCompare(b.kelas ?? '') || a.fullName.localeCompare(b.fullName));
    await audit(this.db.pool, actorId, 'CARD_ISSUE_BULK', 'card', undefined, { kelas: opts.kelas ?? null, issued: out.length });
    return { issued: out, candidates: rows.length };
  }

  async replace(actorId: string, cardId: string, reason: string, opts: PinOpts = {}) {
    checkPinOpts(opts);
    return this.db.tx(async (c) => {
      const old = (await c.query('SELECT * FROM cards WHERE id = $1 FOR UPDATE', [cardId])).rows[0];
      if (!old) throw appErr(404, 'CARD_NOT_FOUND', 'Kartu tidak ditemukan');
      if (!['ACTIVE', 'SUSPENDED', 'LOCKED'].includes(old.status)) throw appErr(409, 'CARD_NOT_LIVE', 'Kartu ini sudah tidak aktif');
      await c.query(`UPDATE cards SET status = 'REPLACED', reason = $2, updated_at = now() WHERE id = $1`, [cardId, reason]);
      await c.query(`INSERT INTO card_events(card_id, event, actor_id, reason) VALUES ($1,'REPLACED',$2,$3)`, [cardId, actorId, reason]);
      const r = await this.createCard(c, old.santri_id, actorId, 'ISSUED', `Pengganti kartu ${old.public_number}: ${reason}`, opts);
      await c.query('UPDATE cards SET replaced_by = $2 WHERE id = $1', [cardId, r.cardId]);
      await audit(c, actorId, 'CARD_REPLACE', 'card', cardId, { newCardId: r.cardId, reason });
      return r; // saldo menempel ke santri, jadi otomatis ikut ke kartu baru
    });
  }

  private async setStatus(actorId: string, cardId: string, from: string[], to: string, event: string, reason: string | null) {
    return this.db.tx(async (c) => {
      const card = (await c.query('SELECT status, santri_id FROM cards WHERE id = $1 FOR UPDATE', [cardId])).rows[0];
      if (!card) throw appErr(404, 'CARD_NOT_FOUND', 'Kartu tidak ditemukan');
      if (to === 'SUSPENDED') await notifyWalsan(c, card.santri_id, 'Kartu dinonaktifkan sementara', 'Kartu anak dinonaktifkan sementara oleh pengurus pesantren. Hubungi pengurus untuk keterangan.');
      if (!from.includes(card.status)) throw appErr(409, 'BAD_STATE', `Aksi tidak bisa dilakukan pada kartu berstatus ${card.status}`);
      await c.query('UPDATE cards SET status = $2, pin_failed = 0, reason = $3, updated_at = now() WHERE id = $1', [cardId, to, reason]);
      await c.query('INSERT INTO card_events(card_id, event, actor_id, reason) VALUES ($1,$2,$3,$4)', [cardId, event, actorId, reason]);
      await audit(c, actorId, `CARD_${event}`, 'card', cardId, { reason });
      return { ok: true, status: to };
    });
  }
  suspend(actorId: string, id: string, reason: string) { return this.setStatus(actorId, id, ['ACTIVE', 'LOCKED'], 'SUSPENDED', 'SUSPENDED', reason); }
  unsuspend(actorId: string, id: string) { return this.setStatus(actorId, id, ['SUSPENDED'], 'ACTIVE', 'UNSUSPENDED', null); }
  unlock(actorId: string, id: string) { return this.setStatus(actorId, id, ['LOCKED'], 'ACTIVE', 'UNLOCKED', null); }

  /** Reset PIN: PIN lama tidak pernah bisa dilihat; admin hanya bisa membuat PIN awal baru. */
  async resetPin(actorId: string, cardId: string, opts: PinOpts = {}) {
    checkPinOpts(opts);
    return this.db.tx(async (c) => {
      const card = (await c.query('SELECT status FROM cards WHERE id = $1 FOR UPDATE', [cardId])).rows[0];
      if (!card) throw appErr(404, 'CARD_NOT_FOUND', 'Kartu tidak ditemukan');
      if (!['ACTIVE', 'SUSPENDED', 'LOCKED'].includes(card.status)) throw appErr(409, 'CARD_NOT_LIVE', 'Kartu ini sudah tidak aktif');
      const pin = opts.pin || newInitialPin();
      await c.query(`UPDATE cards SET pin_hash = $2, pin_must_change = $3, pin_failed = 0,
                        status = CASE WHEN status = 'LOCKED' THEN 'ACTIVE' ELSE status END, updated_at = now() WHERE id = $1`,
        [cardId, await argon2.hash(pin), opts.mustChange ?? true]);
      await c.query(`INSERT INTO card_events(card_id, event, actor_id) VALUES ($1,'PIN_RESET',$2)`, [cardId, actorId]);
      await audit(c, actorId, 'CARD_PIN_RESET', 'card', cardId);
      return { initialPin: pin };
    });
  }

  /** Santri mengganti PIN di terminal (kasir/admin yang membuka layarnya). */
  async changePin(actorId: string, barcode: string, currentPin: string, newPin: string) {
    const bad = validatePin(newPin);
    if (bad) throw appErr(400, 'PIN_WEAK', bad);
    if (newPin === currentPin) throw appErr(400, 'PIN_SAME', 'PIN baru harus berbeda dari PIN lama');
    const out = await this.db.tx(async (c) => {
      const v = await this.verify(c, barcode, currentPin, { allowMustChange: true });
      if (!v.ok) return v;
      await c.query('UPDATE cards SET pin_hash = $2, pin_must_change = false, updated_at = now() WHERE id = $1', [v.card.id, await argon2.hash(newPin)]);
      await c.query(`INSERT INTO card_events(card_id, event, actor_id) VALUES ($1,'PIN_CHANGED',$2)`, [v.card.id, actorId]);
      return v;
    });
    if (!out.ok) throw out.error;
    return { ok: true };
  }

  /** Lihat kartu (QR) untuk dicetak ulang/diunduh. Hanya admin, hanya kartu yang masih hidup, dan tercatat di audit log. */
  async preview(actorId: string, cardId: string) {
    const r = (await this.db.query(
      `SELECT c.public_number, c.status, c.token_enc, s.full_name, s.nis, s.kelas
         FROM cards c JOIN santri s ON s.id = c.santri_id WHERE c.id = $1`, [cardId])).rows[0];
    if (!r) throw appErr(404, 'CARD_NOT_FOUND', 'Kartu tidak ditemukan');
    if (!['ACTIVE', 'SUSPENDED', 'LOCKED'].includes(r.status)) throw appErr(409, 'CARD_NOT_LIVE', 'Kartu ini sudah tidak berlaku');
    const unavailable = appErr(409, 'PREVIEW_UNAVAILABLE', 'Preview tidak tersedia untuk kartu ini (dibuat sebelum fitur preview). Gunakan "Kartu hilang / ganti" untuk membuat kartu baru.');
    if (!r.token_enc) throw unavailable;
    let token: string;
    try { token = decryptToken(r.token_enc); } catch { throw unavailable; }
    await audit(this.db.pool, actorId, 'CARD_VIEW', 'card', cardId);
    return { publicNumber: r.public_number, barcodeToken: token, santri: { fullName: r.full_name, nis: r.nis, kelas: r.kelas } };
  }

  async history(santriId: string) {
    const { rows } = await this.db.query(
      `SELECT c.id, c.public_number AS "publicNumber", c.status, c.reason, c.pin_must_change AS "pinMustChange",
              c.created_at AS "createdAt",
              COALESCE((SELECT json_agg(json_build_object('event', e.event, 'reason', e.reason, 'at', e.created_at) ORDER BY e.created_at DESC)
                          FROM card_events e WHERE e.card_id = c.id), '[]') AS events
         FROM cards c WHERE c.santri_id = $1 ORDER BY c.created_at DESC`, [santriId]);
    return rows;
  }
}
