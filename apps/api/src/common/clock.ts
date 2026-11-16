/** Jam sistem yang bisa diganti saat tes (absen bergantung pada hari dan jam). Di produksi selalu jam asli. */
export const clock = { now: (): Date => new Date() };

/** Waktu Jakarta (UTC+7, tanpa jam musim panas) dari sebuah momen: tanggal, hari ISO (1=Senin..7=Ahad), dan menit sejak tengah malam. */
export function jakarta(d: Date = clock.now()) {
  const j = new Date(d.getTime() + 7 * 3600_000);
  return { date: j.toISOString().slice(0, 10), isoDow: ((j.getUTCDay() + 6) % 7) + 1, minutes: j.getUTCHours() * 60 + j.getUTCMinutes() };
}
