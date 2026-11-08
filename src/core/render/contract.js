// SPDX-License-Identifier: GPL-3.0-only
/**
 * T-018 render layer contracts (FR-006, FR-009, FR-028, FR-033, FR-040..044,
 * NFR-006, P-11; plan.md 5.2 / 5.4 / 6.1 / 8).
 *
 * This module owns NO natural-language strings. Every human-readable label is
 * a Canonical ID resolved by an injected language pack (T-031). The fixed key
 * set below is the required subset that T-031 language packs MUST satisfy.
 *
 * Language pack resolution chain (request -> base tag -> default -> en) belongs
 * to T-031. This layer only consumes the resolved result: `fallback_keys`
 * marks keys that were resolved through the chain, and any still-missing key is
 * annotated explicitly instead of failing generation (FR-042).
 */
import { RENDER_ERROR, RenderError, renderIssue } from './errors.js';
import { PLAN_LEVELS } from '../planner/period.js';
import { RX_FIELDS } from '../rx/compute-rx.js';
import { VERSION_KEYS } from '../profile/versions.js';

export { PLAN_LEVELS, RX_FIELDS, VERSION_KEYS };

export const RENDER_VERSION = 'v=1';
export const RENDER_PREFIX = '<!-- rr-render ';
export const DATA_FENCE = '```rr-data';

export const REQUIRED_NOTICE_KEYS = Object.freeze([
  'plan.notice.disclaimer',
  'plan.notice.estimated',
  'plan.marker.aigc',
]);

const SECTION_NAMES = Object.freeze([
  'metadata', 'versions', 'links', 'prescription', 'guardrails',
  'calendar', 'days', 'notices', 'canonical_data',
]);
const META_NAMES = Object.freeze([
  'level', 'period_id', 'file_name', 'generated_date', 'generated_at',
  'run_date', 'trigger', 'language_tag', 'locale_source', 'guideline_id',
  'calendar_status', 'execution_window', 'cache_id', 'active_term_id',
  'term_id', 'days_count',
]);
const COL_NAMES = Object.freeze([
  'field', 'value', 'min', 'max', 'unit', 'level', 'period_id',
  'file_name', 'start_date', 'end_date', 'plan_date', 'key', 'state',
]);
const LINK_NAMES = Object.freeze(['parent', 'children', 'references', 'none']);
const UNIT_NAMES = Object.freeze(['kcal', 'g', 'ml']);
const MARKER_NAMES = Object.freeze(['fallback', 'untranslated']);
const GUARDRAIL_NAMES = Object.freeze(['energy_floor_kcal', 'protein_floor_g']);

/** Fixed key set: sorted, unique, all Canonical IDs. T-031 MUST cover it. */
export const LANGUAGE_PACK_KEYS = Object.freeze([
  ...PLAN_LEVELS.map((k) => `render.title.${k}`),
  ...SECTION_NAMES.map((k) => `render.section.${k}`),
  ...META_NAMES.map((k) => `render.meta.${k}`),
  ...COL_NAMES.map((k) => `render.col.${k}`),
  ...VERSION_KEYS.map((k) => `render.version.${k}`),
  ...LINK_NAMES.map((k) => `render.link.${k}`),
  ...UNIT_NAMES.map((k) => `render.unit.${k}`),
  ...MARKER_NAMES.map((k) => `render.marker.${k}`),
  ...RX_FIELDS.map((k) => `render.field.${k}`),
  ...GUARDRAIL_NAMES.map((k) => `render.guardrail.${k}`),
  ...REQUIRED_NOTICE_KEYS,
].sort());

/** Canonical unit key per prescription field (ASCII stable keys only). */
export const RX_UNIT_KEYS = Object.freeze({
  energy_kcal: 'render.unit.kcal',
  protein_g: 'render.unit.g',
  fat_g: 'render.unit.g',
  carb_g: 'render.unit.g',
  fiber_g: 'render.unit.g',
  water_ml: 'render.unit.ml',
  salt_g: 'render.unit.g',
  oil_g: 'render.unit.g',
  added_sugar_g: 'render.unit.g',
});

const CANONICAL_ID = /^[a-z][a-z0-9._-]{0,63}$/;
const SAFE_ID = /^[A-Za-z0-9._-]{1,64}$/;
const BCP47 = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{2,8})*$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/;
const UNSAFE_TEXT = /[\x00-\x1F\x7F|`]/;

const PACK_KEYS = Object.freeze(['tag', 'strings', 'fallback_keys']);
const FORMATTER_KEYS = Object.freeze(['number', 'date']);
const PLAN_BASE_KEYS = Object.freeze([
  'level', 'period_id', 'file_name', 'header',
  'prescription', 'guardrails', 'calendar', 'days',
]);
const PLAN_OPTIONAL_KEYS = Object.freeze(['period', 'comparison', 'recalc', 'sections']);
const HEADER_KEYS = Object.freeze([
  'level', 'period_id', 'title', 'file_name', 'generated_date', 'generated_at',
  'run_date', 'trigger', 'version_ids', 'parent', 'children', 'link_references',
  'language_tag', 'locale_source', 'guideline_id', 'calendar',
  'execution_window', 'notice_keys',
]);
const BRIEF_KEYS = Object.freeze([
  'level', 'period_id', 'title', 'file_name', 'start_date', 'end_date',
]);
const SECTION_KEYS = Object.freeze(['id', 'title_key', 'columns', 'rows']);

/** @param {unknown} v */
const isRecord = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/** @param {unknown} v */
const isSafeText = (v) => typeof v === 'string' && v.length > 0 && !UNSAFE_TEXT.test(v);

/** @param {unknown} v */
const isSafeId = (v) => typeof v === 'string' && SAFE_ID.test(v);

/** @param {Record<string, unknown>} r @param {ReadonlyArray<string>} allowed */
const keysOk = (r, allowed) => {
  const keys = Object.keys(r);
  return keys.length === allowed.length && keys.every((k) => allowed.includes(k));
};

/** @param {string} code @param {string} field @param {string} hint */
function fail(code, field, hint) {
  throw new RenderError([renderIssue(code, field, hint)]);
}

/**
 * Validate and freeze a resolved language pack (built by T-031).
 * Fixed outer key set prevents key/field injection (FR-041).
 * @param {unknown} raw
 */
export function validateLanguagePack(raw) {
  if (!isRecord(raw) || !keysOk(/** @type {Record<string, unknown>} */ (raw), PACK_KEYS)) {
    fail(RENDER_ERROR.PACK, '(languagePack)', 'action.render.pack_object');
  }
  const p = /** @type {Record<string, unknown>} */ (raw);
  if (typeof p.tag !== 'string' || !BCP47.test(p.tag)) {
    fail(RENDER_ERROR.PACK_TAG, '(languagePack).tag', 'action.render.pack_tag');
  }
  if (!isRecord(p.strings)) {
    fail(RENDER_ERROR.PACK_STRING, '(languagePack).strings', 'action.render.pack_strings');
  }
  const strings = /** @type {Record<string, unknown>} */ (p.strings);
  for (const [key, value] of Object.entries(strings)) {
    if (!CANONICAL_ID.test(key) || !isSafeText(value)) {
      fail(RENDER_ERROR.PACK_STRING, `(languagePack).strings.${key}`, 'action.render.pack_string');
    }
  }
  for (const key of LANGUAGE_PACK_KEYS) {
    if (!Object.hasOwn(strings, key)) {
      fail(RENDER_ERROR.PACK_KEY, `(languagePack).strings.${key}`, 'action.render.pack_key');
    }
  }
  const fb = p.fallback_keys;
  if (!Array.isArray(fb)
    || fb.some((k) => typeof k !== 'string' || !CANONICAL_ID.test(k))
    || new Set(fb).size !== fb.length) {
    fail(RENDER_ERROR.PACK, '(languagePack).fallback_keys', 'action.render.fallback_keys');
  }
  for (const key of /** @type {string[]} */ (fb)) {
    if (!Object.hasOwn(strings, key)) {
      fail(RENDER_ERROR.PACK, '(languagePack).fallback_keys', 'action.render.fallback_unresolved');
    }
  }
  return Object.freeze({
    tag: p.tag,
    strings: Object.freeze({ ...strings }),
    fallback_keys: Object.freeze([.../** @type {string[]} */ (fb)]),
  });
}

/**
 * Resolve one Canonical ID to a localized string. Never throws: a missing key
 * is reported as `missing` so FR-042 can annotate it without failing output.
 * @param {ReturnType<typeof validateLanguagePack>} pack
 * @param {string} key
 */
export function resolvePackKey(pack, key) {
  if (!isRecord(pack) || !Object.hasOwn(pack.strings, key)) {
    return Object.freeze({ state: 'missing', text: key });
  }
  const state = pack.fallback_keys.includes(key) ? 'fallback' : 'direct';
  return Object.freeze({ state, text: /** @type {string} */ (pack.strings[key]) });
}

/**
 * Validate and freeze an injected intl formatter (T-031 / T-019).
 * Probe outputs MUST be deterministic, non-empty, single-line and table-safe;
 * otherwise localized text could corrupt the Markdown structure (NFR-006).
 * @param {unknown} raw
 */
export function validateIntlFormatter(raw) {
  if (!isRecord(raw)
    || !keysOk(/** @type {Record<string, unknown>} */ (raw), FORMATTER_KEYS)
    || typeof /** @type {Record<string, unknown>} */ (raw).number !== 'function'
    || typeof /** @type {Record<string, unknown>} */ (raw).date !== 'function') {
    fail(RENDER_ERROR.FORMATTER, '(intlFormatter)', 'action.render.formatter_object');
  }
  const f = /** @type {Record<string, Function>} */ (raw);
  const probes = [
    () => f.number(1450, 'render.unit.kcal'),
    () => f.number(1.5, 'render.unit.g'),
    () => f.date('2026-11-06'),
  ];
  for (const probe of probes) {
    const a = probe();
    const b = probe();
    if (typeof a !== 'string' || a !== b || !isSafeText(a)) {
      fail(RENDER_ERROR.FORMATTER_OUTPUT, '(intlFormatter)', 'action.render.formatter_output');
    }
  }
  return Object.freeze({ number: f.number, date: f.date });
}

/** @param {unknown} v @param {string} field */
function brief(v, field) {
  if (!isRecord(v) || !keysOk(/** @type {Record<string, unknown>} */ (v), BRIEF_KEYS)) {
    fail(RENDER_ERROR.HEADER, field, 'action.render.header_brief');
  }
  const b = /** @type {Record<string, unknown>} */ (v);
  if (!PLAN_LEVELS.includes(/** @type {string} */ (b.level))
    || ![b.period_id, b.file_name].every(isSafeId)
    || !isSafeId(b.title)
    || ![b.start_date, b.end_date].every((x) => typeof x === 'string' && ISO_DATE.test(x))) {
    fail(RENDER_ERROR.HEADER, field, 'action.render.header_brief_value');
  }
  return b;
}

/** @param {unknown} v @param {string} field */
function briefList(v, field) {
  if (!Array.isArray(v)) fail(RENDER_ERROR.HEADER, field, 'action.render.header_links');
  return /** @type {unknown[]} */ (v).map((x, i) => brief(x, `${field}[${i}]`));
}

/** @param {unknown} v */
function scalarCell(v) {
  return v === null || typeof v === 'boolean'
    || (typeof v === 'number' && Number.isFinite(v))
    || (typeof v === 'string' && !UNSAFE_TEXT.test(v));
}

/**
 * Validate and freeze a T-013 plan object (unrendered structured object).
 * Unknown top-level keys are rejected so body data cannot be injected (P-14).
 * Optional `sections` is the T-019 hook for other structured objects
 * (purchase / daily / feedback) without adding business logic here.
 * @param {unknown} raw
 */
export function validatePlanObject(raw) {
  if (!isRecord(raw)) fail(RENDER_ERROR.PLAN, '(planObject)', 'action.render.plan_object');
  const p = /** @type {Record<string, unknown>} */ (raw);
  const keys = Object.keys(p);
  if (keys.some((k) => ![...PLAN_BASE_KEYS, ...PLAN_OPTIONAL_KEYS].includes(k))
    || !PLAN_BASE_KEYS.every((k) => keys.includes(k))) {
    fail(RENDER_ERROR.PLAN, '(planObject)', 'action.render.plan_keys');
  }
  if (!PLAN_LEVELS.includes(/** @type {string} */ (p.level))
    || ![p.period_id, p.file_name].every(isSafeId)) {
    fail(RENDER_ERROR.PLAN, '(planObject).level', 'action.render.plan_level');
  }
  if (!isRecord(p.header)) fail(RENDER_ERROR.HEADER, '(planObject).header', 'action.render.header_object');
  const h = /** @type {Record<string, unknown>} */ (p.header);
  if (!HEADER_KEYS.every((k) => Object.hasOwn(h, k))) {
    fail(RENDER_ERROR.HEADER, '(planObject).header', 'action.render.header_keys');
  }
  if (h.level !== p.level || h.period_id !== p.period_id || h.file_name !== p.file_name
    || !isSafeId(h.title)
    || !ISO_DATE.test(String(h.generated_date)) || !ISO_DATE.test(String(h.run_date))
    || !ISO_INSTANT.test(String(h.generated_at))
    || typeof h.trigger !== 'string' || !CANONICAL_ID.test(h.trigger)
    || typeof h.language_tag !== 'string' || !BCP47.test(h.language_tag)
    || typeof h.locale_source !== 'string' || !/^[A-Za-z0-9._:-]{1,64}$/.test(h.locale_source)
    || typeof h.guideline_id !== 'string' || !SAFE_ID.test(h.guideline_id)) {
    fail(RENDER_ERROR.HEADER, '(planObject).header', 'action.render.header_values');
  }
  if (!isRecord(h.version_ids)
    || !keysOk(/** @type {Record<string, unknown>} */ (h.version_ids), VERSION_KEYS)
    || !Object.values(/** @type {Record<string, unknown>} */ (h.version_ids)).every(isSafeId)) {
    fail(RENDER_ERROR.HEADER, '(header).version_ids', 'action.render.header_versions');
  }
  if (!Array.isArray(h.notice_keys)
    || h.notice_keys.some((k) => typeof k !== 'string' || !CANONICAL_ID.test(k))
    || !REQUIRED_NOTICE_KEYS.every((k) => /** @type {unknown[]} */ (h.notice_keys).includes(k))) {
    fail(RENDER_ERROR.NOTICE, '(header).notice_keys', 'action.render.header_notices');
  }
  if (h.parent !== null && h.parent !== undefined) brief(h.parent, '(header).parent');
  briefList(h.children, '(header).children');
  briefList(h.link_references, '(header).link_references');
  if (!isRecord(h.calendar) || !isRecord(h.execution_window)) {
    fail(RENDER_ERROR.HEADER, '(header).calendar', 'action.render.header_calendar');
  }

  if (!isRecord(p.prescription)
    || !RX_FIELDS.every((k) => Array.isArray(/** @type {Record<string, unknown>} */ (p.prescription)[k])
      && /** @type {unknown[]} */ (/** @type {Record<string, unknown>} */ (p.prescription)[k]).length === 2
      && /** @type {number[]} */ (/** @type {Record<string, unknown>} */ (p.prescription)[k])
        .every((n) => typeof n === 'number' && Number.isFinite(n)))) {
    fail(RENDER_ERROR.PLAN, '(planObject).prescription', 'action.render.plan_prescription');
  }
  if (!isRecord(p.guardrails)
    || !GUARDRAIL_NAMES.every((k) => typeof /** @type {Record<string, unknown>} */ (p.guardrails)[k] === 'number'
      && Number.isFinite(/** @type {number} */ (/** @type {Record<string, unknown>} */ (p.guardrails)[k])))) {
    fail(RENDER_ERROR.PLAN, '(planObject).guardrails', 'action.render.plan_guardrails');
  }
  const pc = isRecord(p.calendar) ? /** @type {Record<string, unknown>} */ (p.calendar) : {};
  if (!isRecord(p.calendar)
    || typeof pc.cache_id !== 'string' || !SAFE_ID.test(pc.cache_id)
    || !Number.isInteger(pc.year)
    || typeof pc.status !== 'string' || !SAFE_ID.test(pc.status)
    || !Array.isArray(pc.term_ids)
    || pc.term_ids.some((t) => typeof t !== 'string' || !SAFE_ID.test(t))
    || (pc.active_term_id !== null && pc.active_term_id !== undefined
      && (typeof pc.active_term_id !== 'string' || !SAFE_ID.test(pc.active_term_id)))) {
    fail(RENDER_ERROR.PLAN, '(planObject).calendar', 'action.render.plan_calendar');
  }
  if (!Array.isArray(p.days)
    || p.days.some((d) => !isRecord(d)
      || typeof /** @type {Record<string, unknown>} */ (d).plan_date !== 'string'
      || !ISO_DATE.test(String(/** @type {Record<string, unknown>} */ (d).plan_date))
      || typeof /** @type {Record<string, unknown>} */ (d).file_name !== 'string'
      || UNSAFE_TEXT.test(String(/** @type {Record<string, unknown>} */ (d).file_name)))) {
    fail(RENDER_ERROR.PLAN, '(planObject).days', 'action.render.plan_days');
  }
  const sections = p.sections ?? [];
  if (!Array.isArray(sections)) fail(RENDER_ERROR.SECTION, '(planObject).sections', 'action.render.sections');
  for (const s of /** @type {unknown[]} */ (sections)) {
    if (!isRecord(s) || !keysOk(/** @type {Record<string, unknown>} */ (s), SECTION_KEYS)) {
      fail(RENDER_ERROR.SECTION, '(sections)', 'action.render.section_object');
    }
    const sec = /** @type {Record<string, unknown>} */ (s);
    if (typeof sec.id !== 'string' || !CANONICAL_ID.test(sec.id)
      || typeof sec.title_key !== 'string' || !CANONICAL_ID.test(sec.title_key)
      || !Array.isArray(sec.columns) || sec.columns.length === 0
      || sec.columns.some((c) => typeof c !== 'string' || !CANONICAL_ID.test(c))
      || !Array.isArray(sec.rows)
      || sec.rows.some((r) => !Array.isArray(r)
        || r.length !== sec.columns.length
        || r.some((v) => !scalarCell(v)))) {
      fail(RENDER_ERROR.SECTION, '(sections)', 'action.render.section_shape');
    }
  }
  return Object.freeze({ ...p, sections: Object.freeze([.../** @type {unknown[]} */ (sections)]) });
}
