// Cerberus OS — voice activation and standby phrase matching

export const ACTIVATION_PHRASES = [
  'hey cerberus',
  'good morning cerberus',
  'good afternoon cerberus',
  'good evening cerberus',
  'cerberus are you here',
  'cerberus are you awake',
  'cerberus are you online',
  'wake up cerberus',
];

export const STANDBY_PHRASES = [
  'cerberus standby',
  'cerberus stand by',
  'standby cerberus',
  'stand by cerberus',
  'cerberus take a break',
  'cerberus stop listening',
];

function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[\u2018\u2019\u201B\u0060']/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function findActivationPhrase(text) {
  const norm = normalize(text);
  if (!norm) return null;
  let best = null;
  let bestLen = 0;
  for (const p of ACTIVATION_PHRASES) {
    const phrase = normalize(p);
    if (phrase && norm.includes(phrase) && phrase.length > bestLen) {
      best = p;
      bestLen = phrase.length;
    }
  }
  return best;
}

export function findStandbyPhrase(text) {
  const norm = normalize(text);
  if (!norm) return null;
  for (const p of STANDBY_PHRASES) {
    const phrase = normalize(p);
    if (!phrase) continue;
    if (norm === phrase) return p;
    if (norm.startsWith(`${phrase} `)) return p;
    if (norm.endsWith(` ${phrase}`)) return p;
    if (norm.includes(` ${phrase} `)) return p;
  }
  return null;
}

export function isActivationOnly(text) {
  const stripped = stripVoicePrefixes(text);
  return !stripped || stripped.length < 3;
}

export function stripVoicePrefixes(text) {
  let t = String(text || '').trim();
  const norm = normalize(t);
  const prefixes = [
    ...ACTIVATION_PHRASES,
    'so atlas',
    'okay atlas',
    'ok atlas',
    'right atlas',
    'cerberus',
  ].sort((a, b) => b.length - a.length);
  for (const p of prefixes) {
    const phrase = normalize(p);
    if (norm === phrase) return '';
    if (norm.startsWith(`${phrase} `)) {
      t = t.slice(t.toLowerCase().indexOf(phrase) + phrase.length).trim();
      t = t.replace(/^[,:\s]+/, '').trim();
      break;
    }
  }
  return t;
}

export function classifyConfirmation(text) {
  const norm = normalize(text);
  if (/^(yes|yeah|yep|confirm|do it|go ahead|ok|okay|proceed|sure)\b/.test(norm)) return 'confirm';
  if (/^(no|nope|cancel|stop|never mind|nevermind|abort)\b/.test(norm)) return 'cancel';
  return 'other';
}
