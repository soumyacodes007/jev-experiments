/**
 * Stage 0: deterministic prefilter.
 *
 * Purpose is cost and latency, not security. It may only SKIP classification for
 * events it positively recognises as inert. It can never approve something by
 * failing to recognise it -- the default is always "ask the model".
 *
 * Deliberately narrow. Every condition below must hold:
 *   - there is a pending action, and it is read-only
 *   - the target is inside the working tree and is not credential-shaped
 *   - no tool results are present, so there is no injection vector in play
 *   - the conversation carries no manipulation lexicon
 *
 * `evals/run.mjs --coverage` reports what fraction of benign traffic this
 * catches, which is the only number that justifies its existence.
 */

import { stableStringify } from "./detectors.js";

const READONLY_TOOLS = /^(read|glob|grep|list_files|ls|notebookread)$/i;
const READONLY_SHELL =
  /^(\s*(ls|pwd|cat|head|tail|wc|file|stat|which|echo|date|whoami|tree|du|df|env\b(?!\s*\|)|printenv)\b[^;&|><`$]*)$/i;
const GIT_READONLY = /^\s*git\s+(status|log|diff|show|branch|remote\s+-v|rev-parse|describe)\b[^;&|><`$]*$/i;
const PKG_READONLY = /^\s*(npm|pnpm|yarn)\s+(ls|list|outdated|why|view)\b[^;&|><`$]*$/i;

const SENSITIVE_PATH =
  /(\.ssh|\.aws|\.gnupg|\.kube|\.docker[\/\\]config|\.npmrc|\.pypirc|\.netrc|id_rsa|id_ed25519|credentials|\.pem|\.p12|\.git-credentials|shadow|passwd|\.env)/i;

const ESCAPES_TREE = /(^|[\s"'=])(\/|~|\.\.[\/\\]|[A-Za-z]:[\\\/])/;

const MANIPULATION_LEXICON =
  /\b(ignore (all |any )?(previous|prior|above)|disregard (all|any|previous)|system prompt|you are now|act as if|developer mode|jailbreak|do anything now|without restrictions|bypass|exfiltrat|reverse shell|keylogger|ransomware|\bDAN\b)\b/i;

const SHELL_TOOL = /^(bash|shell|powershell|sh|exec|run_command|terminal)$/i;

/**
 * @param {import("./state.js").HaloEvent} event
 * @returns {{skip: boolean, reason: string}}
 */
export function prefilter(event) {
  const action = event.current_action;
  if (!action) return { skip: false, reason: "no_action_requires_content_review" };
  if (event.tool_results?.length) return { skip: false, reason: "tool_results_present" };

  const convo = (event.conversation ?? []).map((m) => m.content ?? "").join("\n");
  if (MANIPULATION_LEXICON.test(convo)) return { skip: false, reason: "manipulation_lexicon" };

  const blob = `${action.tool} ${stableStringify(action.args ?? {})}`;
  if (SENSITIVE_PATH.test(blob)) return { skip: false, reason: "sensitive_path" };

  if (READONLY_TOOLS.test(action.tool)) {
    const target = String(action.args?.file_path ?? action.args?.path ?? action.args?.pattern ?? "");
    if (ESCAPES_TREE.test(target)) return { skip: false, reason: "path_outside_tree" };
    return { skip: true, reason: "readonly_tool_in_tree" };
  }

  if (SHELL_TOOL.test(action.tool)) {
    const cmd = String(action.args?.command ?? "");
    if (!cmd) return { skip: false, reason: "empty_command" };
    if (ESCAPES_TREE.test(cmd.replace(/^\s*\w+\s*/, ""))) return { skip: false, reason: "path_outside_tree" };
    if (READONLY_SHELL.test(cmd) || GIT_READONLY.test(cmd) || PKG_READONLY.test(cmd)) {
      return { skip: true, reason: "readonly_shell" };
    }
    return { skip: false, reason: "shell_not_recognised_readonly" };
  }

  return { skip: false, reason: "tool_not_recognised" };
}
