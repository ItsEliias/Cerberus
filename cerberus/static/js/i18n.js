/**
 * static/js/i18n.js
 *
 * Tiny key→string locale system. Foundation only — the codebase has
 * thousands of strings; this exists so the FIRST surfaces (CC nav,
 * common actions) can opt in incrementally without a runtime
 * dependency.
 *
 *   import { t, setLocale, getLocale, AVAILABLE_LOCALES } from '/static/js/i18n.js';
 *
 *   t("nav.chat")            → "Chat"        (current locale, falls back to en, then key)
 *   setLocale("es")          → persists to localStorage, dispatches
 *                              "cerberus:locale-changed" on document
 *   getLocale()              → active locale code (default "en")
 *
 * Behaviour:
 *   - Unknown keys return the key itself so the UI degrades to the
 *     identifier rather than rendering empty.
 *   - Unknown locales fall back to "en". setLocale("zz") leaves the
 *     active locale as "en" and stores "en" in localStorage (NOT "zz")
 *     so subsequent reads don't keep re-falling-back.
 *   - Locale change fires a CustomEvent on `document` so any module
 *     that needs to re-render can subscribe without coupling.
 *
 * Tested in tests/test_i18n.test.mjs (Node fast-lane). The module
 * tolerates a missing `localStorage` / `document` so the same Node
 * runner can import it.
 */

const LOCALES = Object.freeze({
  en: {
    // CC nav (TABS array in command-center/index.js)
    "nav.command":       "Command",
    "nav.council":       "Council",
    "nav.workspace":     "Workspace",
    "nav.finance":       "Finance",
    "nav.assistant":     "Assistant",
    "nav.gateway":       "Gateway",
    "nav.agents":        "Agents",
    "nav.rooms":         "Rooms",
    "nav.compare":       "Compare",
    "nav.observability": "Observe",
    "nav.trader":        "Trader",
    "nav.chat":          "Chat",
    "nav.research":      "Research",

    // Common actions (deliberately small set — covers the buttons
    // that already appear across multiple panels).
    "action.save":     "Save",
    "action.cancel":   "Cancel",
    "action.delete":   "Delete",
    "action.edit":     "Edit",
    "action.confirm":  "Confirm",
    "action.search":   "Search",
    "action.new":      "New",
    "action.export":   "Export",
    "action.close":    "Close",
    "action.back":     "Back",
  },
  es: {
    "nav.command":       "Comando",
    "nav.council":       "Consejo",
    "nav.workspace":     "Espacio",
    "nav.finance":       "Finanzas",
    "nav.assistant":     "Asistente",
    "nav.gateway":       "Enlace",
    "nav.agents":        "Agentes",
    "nav.rooms":         "Salas",
    "nav.compare":       "Comparar",
    "nav.observability": "Observar",
    "nav.trader":        "Trader",
    "nav.chat":          "Chat",
    "nav.research":      "Investigación",

    "action.save":     "Guardar",
    "action.cancel":   "Cancelar",
    "action.delete":   "Eliminar",
    "action.edit":     "Editar",
    "action.confirm":  "Confirmar",
    "action.search":   "Buscar",
    "action.new":      "Nuevo",
    "action.export":   "Exportar",
    "action.close":    "Cerrar",
    "action.back":     "Atrás",
  },
});

const DEFAULT_LOCALE = "en";
const STORAGE_KEY = "cerberus.locale";

export const AVAILABLE_LOCALES = Object.keys(LOCALES);

let _current = _readPersisted();

function _readPersisted() {
  try {
    if (typeof localStorage === "undefined") return DEFAULT_LOCALE;
    const v = localStorage.getItem(STORAGE_KEY);
    if (v && Object.prototype.hasOwnProperty.call(LOCALES, v)) return v;
  } catch (_) { /* private mode / disabled — fall through */ }
  return DEFAULT_LOCALE;
}

/**
 * Return the translated string for `key` in the current locale.
 * Falls back to the default locale, then to the key itself so the
 * UI never renders empty when a translation is missing.
 */
export function t(key) {
  if (typeof key !== "string" || !key) return "";
  const cur = LOCALES[_current];
  if (cur && Object.prototype.hasOwnProperty.call(cur, key)) return cur[key];
  const def = LOCALES[DEFAULT_LOCALE];
  if (def && Object.prototype.hasOwnProperty.call(def, key)) return def[key];
  return key;
}

/**
 * Set the active locale. Unknown locales coerce to the default and the
 * coerced value is what's persisted — so a typoed "ZZ" doesn't sit in
 * localStorage triggering the fallback path on every page load.
 * Dispatches `cerberus:locale-changed` on `document`.
 */
export function setLocale(lang) {
  const resolved = Object.prototype.hasOwnProperty.call(LOCALES, lang)
    ? lang
    : DEFAULT_LOCALE;
  _current = resolved;
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(STORAGE_KEY, resolved);
    }
  } catch (_) { /* ignore */ }
  try {
    if (typeof document !== "undefined" && typeof CustomEvent === "function") {
      document.dispatchEvent(new CustomEvent("cerberus:locale-changed", {
        detail: { locale: resolved },
      }));
    }
  } catch (_) { /* ignore */ }
  return resolved;
}

/** Return the current locale code. */
export function getLocale() {
  return _current;
}

// Test-only: reset module state without spinning a fresh import.
export const __testables = {
  STORAGE_KEY,
  DEFAULT_LOCALE,
  LOCALES,
  _setCurrent: (loc) => { _current = loc; },
};
