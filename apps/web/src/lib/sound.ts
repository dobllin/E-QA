'use client';
/** Suara pemberitahuan (WebAudio, tanpa file audio). "Ada yang bayar" sengaja dibuat berbeda: nada naik seperti mesin kasir + suara ucapan. */
let ctx: AudioContext | null = null;
const LS = { sound: 'eqa.sound', voice: 'eqa.voice' };
function get(k: string, d: boolean) { try { const v = localStorage.getItem(k); return v === null ? d : v === '1'; } catch { return d; } }
function set(k: string, v: boolean) { try { localStorage.setItem(k, v ? '1' : '0'); } catch { /* abaikan */ } }
export const soundOn = () => get(LS.sound, true);
export const voiceOn = () => get(LS.voice, true);
export const setSoundOn = (v: boolean) => set(LS.sound, v);
export const setVoiceOn = (v: boolean) => set(LS.voice, v);

function ac(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) { const C = window.AudioContext || (window as any).webkitAudioContext; if (!C) return null; ctx = new C(); }
  return ctx;
}
/** Harus dipanggil dari ketukan/klik pengguna agar browser mengizinkan suara. */
export async function unlockAudio() { const c = ac(); if (c && c.state !== 'running') { try { await c.resume(); } catch { /* abaikan */ } } return c?.state === 'running'; }
export const audioReady = () => ctx?.state === 'running';

function tone(freq: number, start: number, dur: number, type: OscillatorType, vol: number) {
  const c = ac(); if (!c) return;
  const o = c.createOscillator(); const g = c.createGain();
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, c.currentTime + start);
  g.gain.exponentialRampToValueAtTime(vol, c.currentTime + start + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + start + dur);
  o.connect(g).connect(c.destination); o.start(c.currentTime + start); o.stop(c.currentTime + start + dur + 0.05);
}
/** "Ka-ching": C6 E6 G6 C7 naik cepat + kilau. Beda jauh dari bunyi info. */
export function playPayment() {
  [1046.5, 1318.5, 1568, 2093].forEach((f, i) => tone(f, i * 0.11, 0.28, 'triangle', 0.35));
  [3136, 3951, 4186].forEach((f, i) => tone(f, 0.45 + i * 0.05, 0.18, 'sine', 0.12));
}
/** Bunyi lembut dua nada untuk pemberitahuan biasa. */
export function playInfo() { tone(660, 0, 0.18, 'sine', 0.2); tone(880, 0.16, 0.22, 'sine', 0.2); }
export function speak(text: string) {
  try {
    if (!('speechSynthesis' in window)) return;
    const u = new SpeechSynthesisUtterance(text); u.lang = 'id-ID'; u.rate = 0.95;
    window.speechSynthesis.cancel(); window.speechSynthesis.speak(u);
  } catch { /* abaikan */ }
}
export function announce(kind: 'PAYMENT' | 'INFO', force = false) {
  if (!force && !soundOn()) return;
  if (kind === 'PAYMENT') { playPayment(); if (voiceOn()) setTimeout(() => speak('Ada yang bayar'), 900); }
  else playInfo();
}
