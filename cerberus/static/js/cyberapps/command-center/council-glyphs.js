/**
 * council-glyphs.js — Greek persona portrait SVG glyphs (64x64).
 *
 * Each glyph is a minimal geometric motif:
 *   Daedalus    — two angled wing chevrons
 *   Hephaestus  — hammer (vertical shaft + horizontal head)
 *   Themis      — balance scales (bar + two hanging triangles)
 *   Argus       — cluster of 5 eyes (circles)
 *   Athena      — stylized owl (circle + two eyes + beak)
 *   Aegis       — rounded-pentagon shield outline
 *   default     — shield with a center dot
 *
 * Exported as a map: GLYPHS[name] → SVG string (inline-safe, no <svg> wrapper).
 * Colours use currentColor so CSS can tint them via the card's accent variable.
 */

export const GLYPH_VIEWBOX = '0 0 64 64';

// Internal stroke-based paths (currentColor, no fill for hollow motifs)
const _STROKE = 'stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" fill="none"';
const _FILL   = 'fill="currentColor"';

function _svgEl(content) {
  return `<svg viewBox="${GLYPH_VIEWBOX}" xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true" class="cc-agent-portrait-svg">${content}</svg>`;
}

// Daedalus: two wing chevrons pointing outward
const _daedalus = _svgEl(`
  <g ${_STROKE} stroke-width="2.5">
    <polyline points="10,42 32,20 54,42"/>
    <polyline points="16,50 32,32 48,50"/>
  </g>`);

// Hephaestus: hammer — shaft + wide flat head
const _hephaestus = _svgEl(`
  <g ${_STROKE} stroke-width="2.5">
    <line x1="32" y1="20" x2="32" y2="54"/>
    <rect x="16" y="14" width="32" height="12" rx="2" ${_STROKE} stroke-width="2.5"/>
  </g>`);

// Themis: balance scales — center pivot, horizontal beam, two hanging triangles
const _themis = _svgEl(`
  <g ${_STROKE} stroke-width="2.5">
    <line x1="32" y1="10" x2="32" y2="54"/>
    <line x1="12" y1="26" x2="52" y2="26"/>
    <line x1="12" y1="26" x2="12" y2="36"/>
    <line x1="52" y1="26" x2="52" y2="36"/>
    <polygon points="6,36 18,36 12,46" ${_STROKE} stroke-width="2"/>
    <polygon points="46,36 58,36 52,46" ${_STROKE} stroke-width="2"/>
  </g>`);

// Argus: 5 circles arranged as eyes (center + 4 around)
const _argus = _svgEl(`
  <g ${_STROKE} stroke-width="2">
    <circle cx="32" cy="32" r="5"/>
    <circle cx="32" cy="32" r="2" ${_FILL} stroke="none"/>
    <circle cx="16" cy="22" r="4"/>
    <circle cx="48" cy="22" r="4"/>
    <circle cx="16" cy="42" r="4"/>
    <circle cx="48" cy="42" r="4"/>
    <circle cx="16" cy="22" r="1.5" ${_FILL} stroke="none"/>
    <circle cx="48" cy="22" r="1.5" ${_FILL} stroke="none"/>
    <circle cx="16" cy="42" r="1.5" ${_FILL} stroke="none"/>
    <circle cx="48" cy="42" r="1.5" ${_FILL} stroke="none"/>
  </g>`);

// Athena: stylized owl — round head-circle + two large eye-circles + V beak
const _athena = _svgEl(`
  <g ${_STROKE} stroke-width="2.5">
    <circle cx="32" cy="30" r="18"/>
    <circle cx="24" cy="27" r="6"/>
    <circle cx="40" cy="27" r="6"/>
    <circle cx="24" cy="27" r="2.5" ${_FILL} stroke="none"/>
    <circle cx="40" cy="27" r="2.5" ${_FILL} stroke="none"/>
    <polyline points="28,38 32,44 36,38"/>
  </g>`);

// Aegis: rounded-pentagon shield
const _aegis = _svgEl(`
  <g ${_STROKE} stroke-width="2.5">
    <path d="M32,10 L54,20 L54,36 Q54,52 32,58 Q10,52 10,36 L10,20 Z" rx="4"/>
    <line x1="32" y1="22" x2="32" y2="48" stroke-width="1.5" opacity="0.5"/>
    <line x1="20" y1="30" x2="44" y2="30" stroke-width="1.5" opacity="0.5"/>
  </g>`);

// Default: shield with center dot
const _default = _svgEl(`
  <g ${_STROKE} stroke-width="2.5">
    <path d="M32,10 L52,18 L52,34 Q52,50 32,56 Q12,50 12,34 L12,18 Z"/>
    <circle cx="32" cy="32" r="4" ${_FILL} stroke="none"/>
  </g>`);

/**
 * Map from agent name (uppercase) to SVG string.
 * Falls back to `_default` for unrecognised names.
 */
export const GLYPHS = {
  DAEDALUS:   _daedalus,
  HEPHAESTUS: _hephaestus,
  THEMIS:     _themis,
  ARGUS:      _argus,
  ATHENA:     _athena,
  AEGIS:      _aegis,
};

/**
 * Return the SVG string for a given agent name.
 * @param {string} name
 * @returns {string} inline SVG markup
 */
export function getGlyph(name) {
  return GLYPHS[(name || '').toUpperCase()] || _default;
}
