"use client";

import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import styles from "../app/page.module.css";

type Detection = { start: number; end: number; category: string; subtype: string; path_score?: number };
type MaskResult = { masked_text: string; detections: Detection[]; meta?: { latency_ms?: number; api_calls?: number; profile?: string } };
const SAMPLE_TEXT = "Hi, I'm Sarah Chen. You can reach me at sarah.chen@example.com or +1 (415) 555-0199. Please keep my API key sk_live_demo_789 private.";
const CATEGORY_COLORS: Record<string, string> = { IDENTITY: "identity", CREDENTIAL: "credential", FINANCIAL: "financial", HEALTH: "health", DIGITAL: "digital" };

function HighlightedText({ text, detections }: { text: string; detections: Detection[] }) {
  const pieces: ReactNode[] = [];
  let cursor = 0;
  for (const detection of [...detections].sort((a, b) => a.start - b.start)) {
    if (detection.start < cursor) continue;
    if (detection.start > cursor) pieces.push(<span key={`text-${cursor}`}>{text.slice(cursor, detection.start)}</span>);
    pieces.push(<mark className={`${styles.highlight} ${styles[CATEGORY_COLORS[detection.category] ?? "identity"]}`} key={`mark-${detection.start}`} title={`${detection.category} · ${detection.subtype}`}>{text.slice(detection.start, detection.end)}<span className={styles.highlightLabel}>{detection.subtype}</span></mark>);
    cursor = detection.end;
  }
  if (cursor < text.length) pieces.push(<span key="text-end">{text.slice(cursor)}</span>);
  return <>{pieces}</>;
}

function MaskedOutput({ text, detections }: { text: string; detections: Detection[] }) {
  const pieces: ReactNode[] = [];
  let cursor = 0;
  for (const detection of [...detections].sort((a, b) => a.start - b.start)) {
    if (detection.start < cursor) continue;
    if (detection.start > cursor) pieces.push(<span key={`output-${cursor}`}>{text.slice(cursor, detection.start)}</span>);
    pieces.push(<span className={styles.outputToken} key={`token-${detection.start}`}>[{detection.subtype}]</span>);
    cursor = detection.end;
  }
  if (cursor < text.length) pieces.push(<span key="output-end">{text.slice(cursor)}</span>);
  return <>{pieces}</>;
}

export function RedactionDemo() {
  const [draft, setDraft] = useState(SAMPLE_TEXT);
  const [result, setResult] = useState<MaskResult | null>(null);
  const [isMasking, setIsMasking] = useState(false);
  const [error, setError] = useState("");
  const detections = result?.detections ?? [];
  const detectedLabel = useMemo(() => !result ? "Waiting for a message" : detections.length === 0 ? "No sensitive values found" : `${detections.length} ${detections.length === 1 ? "value" : "values"} protected`, [detections.length, result]);

  async function handleMask(event?: FormEvent) {
    event?.preventDefault();
    if (!draft.trim()) { setError("Write something first."); return; }
    setError(""); setIsMasking(true);
    try {
      const response = await fetch("/api/mask", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: draft }) });
      const body = (await response.json()) as MaskResult & { detail?: string; error?: string };
      if (!response.ok) throw new Error(body.detail ?? body.error ?? "The PRISM backend could not mask this text.");
      setResult(body);
    } catch (caught) { setResult(null); setError(caught instanceof Error ? caught.message : "The PRISM backend could not mask this text."); }
    finally { setIsMasking(false); }
  }

  function loadSample() { setDraft(SAMPLE_TEXT); setResult(null); setError(""); }

  return <section className={styles.demoSection} id="demo"><div className={styles.sectionKicker}><span>01</span> THE REDACTION DESK <span className={styles.kickerLine} /></div><div className={styles.demoHeading}><div><h2>Say anything.<br /><em>Keep it private.</em></h2></div><p>Write a message below. PRISM spots the sensitive values, shows you exactly what it found, and returns a safe version in one click.</p></div><form className={styles.demoShell} onSubmit={handleMask}><div className={styles.editorPane}><div className={styles.paneHeader}><span className={styles.windowDots}><i /><i /><i /></span><span>YOUR MESSAGE</span><button type="button" className={styles.sampleButton} onClick={loadSample}>Load sample</button></div><div className={styles.editorBody}><div className={styles.editorHighlight} aria-hidden="true">{result ? <HighlightedText text={draft} detections={detections} /> : <span className={styles.placeholderText}>{draft}</span>}</div><textarea aria-label="Text to mask" className={styles.editorInput} value={draft} onChange={(event) => { setDraft(event.target.value); setResult(null); }} spellCheck={false} placeholder="Write or paste something with personal data..." /></div><div className={styles.editorFooter}><span>{draft.length} characters</span><span>{result ? "Highlighted values are masked below" : "Nothing leaves this screen until you choose Done"}</span></div></div><div className={styles.doneColumn}><button className={styles.doneButton} type="submit" disabled={isMasking}>{isMasking ? "Masking…" : "Done"}<span>→</span></button><span className={styles.doneHint}>Run PRISM</span></div><div className={styles.outputPane}><div className={styles.paneHeader}><span className={styles.statusLight} /> MASKED OUTPUT <span className={styles.liveBadge}>{result ? "LIVE" : "READY"}</span></div><div className={`${styles.outputBody} ${!result ? styles.outputEmpty : ""}`}>{result ? <p><MaskedOutput text={draft} detections={detections} /></p> : <><span className={styles.outputPlaceholder}>Your safe version</span><span className={styles.outputExample}>This is <b>[EMAIL]</b></span></>}</div><div className={styles.outputFooter}><span>{detectedLabel}</span>{result?.meta?.latency_ms ? <span>{result.meta.latency_ms}ms · {result.meta.profile ?? "economy"}</span> : <span>PRISM engine</span>}</div></div></form>{error && <p className={styles.errorMessage} role="alert">{error}</p>}<p className={styles.demoNote}><span>⌁</span> This demo calls the real PRISM backend through a server-side Next.js route. Start <code>npm run prism:serve</code> before testing.</p></section>;
}
