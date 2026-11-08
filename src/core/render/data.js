// SPDX-License-Identifier: GPL-3.0-only
/**
 * T-018 canonical data block (FR-028, FR-044, NFR-006, P-11).
 *
 * The fenced `rr-data` block is pure ASCII: Canonical IDs plus raw numeric and
 * date values. It is built from the plan object ALONE -- never from the
 * language pack and never from the intl formatter. Two renders of the same
 * plan in different languages therefore produce byte-identical data blocks,
 * which is the executable evidence for FR-044 / SC-011 (values never change
 * when the output language changes) and keeps Git diffs stable.
 */
import { RENDER_ERROR, RenderError, renderIssue } from './errors.js';
import { DATA_FENCE, RX_FIELDS, VERSION_KEYS } from './contract.js';

const DATA_KEY = /^[a-z][a-z0-9._-]*$/;
const DATA_VALUE = /^[\x20-\x7E]*$/;
const FENCE_RE = /^```rr-data[ \t]*\r?\n([\s\S]*?)^```[ \t]*$/m;

/** @param {string} code @param {string} field @param {string} hint */
function fail(code, field, hint) {
  throw new RenderError([renderIssue(code, field, hint)]);
}

/**
 * Build the sorted, deterministic list of canonical key/value pairs.
 * @param {Readonly<Record<string, any>>} plan validated plan object
 * @returns {ReadonlyArray<readonly [string, string]>}
 */
export function buildRenderData(plan) {
  /** @type {Array<[string, string]>} */
  const pairs = [];
  const put = (key, value) => pairs.push([key, String(value)]);
  const h = plan.header;
  const c = plan.calendar;
  const w = h.execution_window;

  put('level', plan.level);
  put('period_id', plan.period_id);
  put('file_name', plan.file_name);
  put('generated_date', h.generated_date);
  put('generated_at', h.generated_at);
  put('run_date', h.run_date);
  put('trigger', h.trigger);
  put('language_tag', h.language_tag);
  put('locale_source', h.locale_source);
  put('guideline_id', h.guideline_id);
  for (const key of VERSION_KEYS) put(`version.${key}`, h.version_ids[key]);
  for (const field of RX_FIELDS) {
    put(`rx.${field}.min`, plan.prescription[field][0]);
    put(`rx.${field}.max`, plan.prescription[field][1]);
  }
  put('guardrail.energy_floor_kcal', plan.guardrails.energy_floor_kcal);
  put('guardrail.protein_floor_g', plan.guardrails.protein_floor_g);
  put('calendar.cache_id', c.cache_id);
  put('calendar.year', c.year);
  put('calendar.status', c.status);
  put('calendar.active_term_id', c.active_term_id ?? 'null');
  put('calendar.term_count', c.term_ids.length);
  put('execution_window.start_date', w.start_date ?? 'null');
  put('execution_window.end_date', w.end_date ?? 'null');
  put('execution_window.total_days', w.total_days);
  put('execution_window.executed_days', w.executed_days);
  put('execution_window.remaining_days', w.remaining_days);
  put('days.count', plan.days.length);
  put('notices.count', h.notice_keys.length);
  put('sections.count', plan.sections.length);
  put('recalc.needs_recalc', plan.recalc?.needs_recalc ?? false);

  pairs.sort((a, b) => a[0].localeCompare(b[0], 'en'));
  for (const [key, value] of pairs) {
    if (!DATA_KEY.test(key) || !DATA_VALUE.test(value)) {
      fail(RENDER_ERROR.INVARIANT, '(rr-data)', 'action.render.data_ascii');
    }
  }
  return Object.freeze(pairs.map(([k, v]) => Object.freeze([k, v])));
}

/** @param {Readonly<Record<string, any>>} plan */
export function canonicalLines(plan) {
  return buildRenderData(plan).map(([k, v]) => `${k}=${v}`);
}

/**
 * Extract the whole canonical data block from a rendered document.
 * @param {string} markdown
 */
export function extractCanonicalBlock(markdown) {
  const hit = FENCE_RE.exec(markdown);
  if (!hit) fail(RENDER_ERROR.DATA, '(markdown)', 'action.render.data_block_missing');
  const body = hit[1].replace(/\r?\n$/, '');
  return `${DATA_FENCE}\n${body}\n\`\`\``;
}

/**
 * Parse the canonical data block back into a frozen ASCII record.
 * Rejects duplicate, unsorted, non-canonical or non-ASCII entries so a
 * tampered block cannot masquerade as language-invariant data.
 * @param {string} markdown
 */
export function extractRenderData(markdown) {
  const block = extractCanonicalBlock(markdown);
  const lines = block.split('\n').slice(1, -1);
  /** @type {Record<string, string>} */
  const out = {};
  const keys = [];
  for (const line of lines) {
    const at = line.indexOf('=');
    if (at <= 0) fail(RENDER_ERROR.DATA, '(rr-data)', 'action.render.data_line');
    const key = line.slice(0, at);
    const value = line.slice(at + 1);
    if (!DATA_KEY.test(key) || !DATA_VALUE.test(value)) {
      fail(RENDER_ERROR.DATA, '(rr-data)', 'action.render.data_value');
    }
    if (Object.hasOwn(out, key)) fail(RENDER_ERROR.DATA, '(rr-data)', 'action.render.data_duplicate');
    out[key] = value;
    keys.push(key);
  }
  if (keys.join('\n') !== [...keys].sort((a, b) => a.localeCompare(b, 'en')).join('\n')) {
    fail(RENDER_ERROR.DATA, '(rr-data)', 'action.render.data_order');
  }
  return Object.freeze(out);
}
