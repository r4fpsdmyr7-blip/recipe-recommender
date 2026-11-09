// SPDX-License-Identifier: GPL-3.0-only
/** CLI 适配层统一出口（plan.md §4 / §6.2 / §9 · tasks.md T-019 / T-020）。 */

export { CLI_ERROR, CliError, cliIssue } from './errors.js';
export { COMMANDS, P2_COMMANDS, ALL_COMMANDS, COMMAND_OPTIONS, FLAG_KEYS, isIsoDate, parseArgs } from './args.js';
export {
  CONFIG_PATH,
  ENV_KEYS,
  OVERRIDE_KEYS,
  overrideProblem,
  parseConfigText,
  resolveOverrides,
} from './config.js';
export { createIntlFormatter } from './intl.js';
export { line, issueLines, requirePort, resolveCommandOverrides } from './shared.js';
export { runInit } from './init.js';
export { runPlan } from './plan.js';
export { runValidate } from './validate.js';
export { LEDGER_PATHS, ledgerRows, runLedger } from './ledger.js';
export { runAcceptance } from './acceptance.js';
export {
  DATA_DIRS,
  DATA_ROOT_FILES,
  EXPORT_PATH,
  EXPORT_VERSION,
  buildExportText,
  isDataPath,
  listDataFiles,
  parseExportText,
} from './inventory.js';
export { runExportData } from './export-data.js';
export { runDeleteData } from './delete-data.js';
export { runServeMcp } from './serve-mcp.js';
export { EXIT, runCli } from './run.js';
