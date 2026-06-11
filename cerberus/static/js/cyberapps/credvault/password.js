/**
 * CredVault — password generator + strength scorer
 * Pure JS port of the Electron renderer utilities.
 * Uses crypto.getRandomValues for unbiased sampling (rejection method).
 */

const UPPER    = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LOWER    = 'abcdefghijklmnopqrstuvwxyz';
const DIGITS   = '0123456789';
const SYMBOLS  = '!@#$%^&*()-_=+[]{};:,.<>/?';
const AMBIGUOUS = /[O0Il1|`'"]/g;

/** @param {{ length:number, upper:boolean, lower:boolean, digits:boolean, symbols:boolean, noAmbiguous:boolean }} opts */
export function generatePassword(opts) {
  let cs = '';
  if (opts.upper)   cs += UPPER;
  if (opts.lower)   cs += LOWER;
  if (opts.digits)  cs += DIGITS;
  if (opts.symbols) cs += SYMBOLS;
  if (opts.noAmbiguous) cs = cs.replace(AMBIGUOUS, '');
  if (!cs) return '';
  const len = Math.max(1, Math.min(128, Math.floor(opts.length)));
  const ceiling = Math.floor(0xFFFFFFFF / cs.length) * cs.length;
  const buf = new Uint32Array(len * 2);
  const out = [];
  let bi = 0;
  while (out.length < len) {
    if (bi === 0 || bi >= buf.length) { crypto.getRandomValues(buf); bi = 0; }
    const v = buf[bi++];
    if (v < ceiling) out.push(cs[v % cs.length]);
  }
  return out.join('');
}

/**
 * @param {string} pw
 * @returns {{ score: number, level: number, label: string, color: string }}
 */
export function scorePassword(pw) {
  if (!pw) return { score: 0, level: 0, label: 'None', color: '#4a5568' };
  let score = 0;
  if (pw.length >= 8)  score += 20;
  if (pw.length >= 12) score += 15;
  if (pw.length >= 16) score += 15;
  if (/[A-Z]/.test(pw)) score += 10;
  if (/[a-z]/.test(pw)) score += 10;
  if (/[0-9]/.test(pw)) score += 10;
  if (/[^A-Za-z0-9]/.test(pw)) score += 20;
  // Unique char ratio
  const unique = new Set(pw).size / pw.length;
  score += Math.round(unique * 10);
  score = Math.min(100, score);
  if (score < 30)  return { score, level: 1, label: 'Very Weak', color: '#f85149' };
  if (score < 50)  return { score, level: 2, label: 'Weak',      color: '#f85149' };
  if (score < 70)  return { score, level: 3, label: 'Fair',      color: '#d29922' };
  if (score < 85)  return { score, level: 4, label: 'Strong',    color: '#3fb950' };
  return             { score, level: 5, label: 'Very Strong', color: '#3fb950' };
}
