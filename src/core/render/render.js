// SPDX-License-Identifier: GPL-3.0-only
/**
 * T-018 pure Markdown renderer (FR-006, FR-009, FR-028, FR-033, FR-040..044,
 * NFR-006; plan.md 5.2 / 6.1 / 8).
 *
 * Pure function: no IO, no clock, no network, no mutation. All user-visible
 * strings come from the injected language pack; all numeric / date DISPLAY
 * formatting comes from the injected intl formatter; all machine-relevant
 * values are emitted as raw backticked Canonical IDs / numbers and repeated in
 * the pack-independent `rr-data` block. Switching language therefore changes
 * only rendered strings (FR-044).
 *
 * Output is deterministic UTF-8 Markdown: LF endings, stable sorted order,
 * table-based, no trailing whitespace, no binary dependency (Git-diffable).
 */
import {
  RENDER_PREFIX,
  RENDER_VERSION,
  DATA_FENCE,
  RX_FIELDS,
  RX_UNIT_KEYS,
  VERSION_KEYS,
  REQUIRED_NOTICE_KEYS,
  validateLanguagePack,
  validateIntlFormatter,
  validatePlanObject,
  resolvePackKey,
} from './contract.js';
import { canonicalLines } from './data.js';

const AIGC_KEY = REQUIRED_NOTICE_KEYS[2];

/**
 * @param {ReturnType<typeof validateLanguagePack>} pack
 * @param {string} key
 * @returns {string}
 */
function label(pack, key) {
  const resolved = resolvePackKey(pack, key);
  if (resolved.state === 'missing') {
    return `${pack.strings['render.marker.untranslated']} \`${key}\``;
  }
  if (resolved.state === 'fallback') {
    return `${pack.strings['render.marker.fallback']} ${resolved.text}`;
  }
  return resolved.text;
}

/**
 * @param {unknown} planObject T-013 unstructured plan object
 * @param {unknown} languagePack resolved language pack (T-031)
 * @param {unknown} intlFormatter number / date formatter (T-031 / T-019)
 * @returns {string} UTF-8 Markdown
 */
export function render(planObject, languagePack, intlFormatter) {
  const plan = validatePlanObject(planObject);
  const pack = validateLanguagePack(languagePack);
  const fmt = validateIntlFormatter(intlFormatter);
  const h = plan.header;
  const c = plan.calendar;
  const w = h.execution_window;

  const t = (key) => label(pack, key);
  const cell = (value) => `\`${String(value)}\``;
  const num = (value, unitKey) => fmt.number(value, unitKey);
  const date = (value) => fmt.date(value);

  /** @type {string[]} */
  const L = [];
  const blank = () => L.push('');
  const section = (name) => {
    L.push(`## ${t(`render.section.${name}`)}`);
    blank();
  };
  /** @param {ReadonlyArray<string>} columns @param {ReadonlyArray<ReadonlyArray<string>>} rows */
  const table = (columns, rows) => {
    L.push(`| ${columns.map(t).join(' | ')} |`);
    L.push(`| ${columns.map(() => '---').join(' | ')} |`);
    for (const row of rows) L.push(`| ${row.join(' | ')} |`);
    blank();
  };

  L.push(`# ${t(`render.title.${plan.level}`)} ${cell(plan.period_id)}`);
  blank();

  // FR-033: disclaimer, estimated values, [AIGC] marker -- all localized.
  for (const key of h.notice_keys) {
    L.push(key === AIGC_KEY ? `> [AIGC] ${t(key)}` : `> ${t(key)}`);
  }
  blank();
  L.push(`${RENDER_PREFIX}${RENDER_VERSION} lang=${pack.tag} level=${plan.level} period=${plan.period_id} -->`);
  blank();

  // FR-009: cycle id, generated date, five versions, parent / child links.
  section('metadata');
  table(['render.col.field', 'render.col.value'], [
    [t('render.meta.level'), cell(plan.level)],
    [t('render.meta.period_id'), cell(plan.period_id)],
    [t('render.meta.file_name'), cell(plan.file_name)],
    [t('render.meta.generated_date'), date(h.generated_date)],
    [t('render.meta.generated_at'), cell(h.generated_at)],
    [t('render.meta.run_date'), date(h.run_date)],
    [t('render.meta.trigger'), cell(h.trigger)],
    [t('render.meta.language_tag'), cell(h.language_tag)],
    [t('render.meta.locale_source'), cell(h.locale_source)],
    [t('render.meta.guideline_id'), cell(h.guideline_id)],
  ]);

  section('versions');
  table(['render.col.field', 'render.col.value'], VERSION_KEYS.map((key) => [
    t(`render.version.${key}`), cell(h.version_ids[key]),
  ]));

  section('links');
  /** @type {Array<Array<string>>} */
  const links = [];
  const briefRow = (b, kind) => [
    cell(b.level), cell(b.period_id), cell(b.file_name), t(`render.link.${kind}`),
  ];
  if (h.parent) links.push(briefRow(h.parent, 'parent'));
  for (const b of h.children) links.push(briefRow(b, 'children'));
  for (const b of h.link_references) links.push(briefRow(b, 'references'));
  if (links.length === 0) {
    links.push([cell('null'), cell('null'), cell('null'), t('render.link.none')]);
  }
  table(['render.col.level', 'render.col.period_id', 'render.col.file_name', 'render.col.key'], links);

  section('prescription');
  table(['render.col.field', 'render.col.min', 'render.col.max', 'render.col.unit'],
    RX_FIELDS.map((field) => [
      t(`render.field.${field}`),
      num(plan.prescription[field][0], RX_UNIT_KEYS[field]),
      num(plan.prescription[field][1], RX_UNIT_KEYS[field]),
      t(RX_UNIT_KEYS[field]),
    ]));

  section('guardrails');
  table(['render.col.field', 'render.col.value', 'render.col.unit'], [
    [t('render.guardrail.energy_floor_kcal'), cell(plan.guardrails.energy_floor_kcal), t('render.unit.kcal')],
    [t('render.guardrail.protein_floor_g'), cell(plan.guardrails.protein_floor_g), t('render.unit.g')],
  ]);

  section('calendar');
  /** @type {Array<Array<string>>} */
  const calRows = [
    [t('render.meta.calendar_status'), cell(c.status)],
    [t('render.meta.cache_id'), cell(c.cache_id)],
    [t('render.meta.active_term_id'), cell(c.active_term_id ?? 'null')],
    [t('render.meta.execution_window'), cell(String(w.remaining_days))],
    ...c.term_ids.map((id) => [t('render.meta.term_id'), cell(id)]),
  ];
  table(['render.col.field', 'render.col.value'], calRows);

  section('days');
  table(['render.col.plan_date', 'render.col.file_name', 'render.col.level'],
    plan.days.map((d) => [date(d.plan_date), cell(d.file_name), cell(plan.level)]));

  section('notices');
  table(['render.col.field', 'render.col.state'],
    h.notice_keys.map((key) => [cell(key), cell(resolvePackKey(pack, key).state)]));

  // T-019 hook: extra structured tables without adding business knowledge here.
  for (const s of plan.sections) {
    L.push(`## ${t(s.title_key)}`);
    blank();
    table(s.columns, s.rows.map((row) => row.map((v) => cell(String(v)))));
  }

  // Language-invariant canonical data (FR-044 evidence, Git-diffable).
  section('canonical_data');
  L.push(DATA_FENCE, ...canonicalLines(plan), '```');

  return `${L.join('\n')}\n`;
}
