"use client";

import { useEffect, useRef, useState } from "react";
import { Copy, Download, FileJson } from "lucide-react";
import { Button } from "@/components/ui/button";
import { resolveVdtAppMode } from "@/lib/app-mode";
import { downloadBinaryFile } from "@/lib/download";
import {
  compiledSupportBuildInfo, createSupportReport, sanitizeSupportBuildInfo,
  SUPPORT_GUIDE_URL, SUPPORT_REPORT_URL, supportGuidance, supportReportFilename,
  type SupportBuildInfo, type SupportReport
} from "@/lib/support-diagnostics";
import { useVdtStudioStore } from "./vdt-store";
import styles from "./support-settings.module.css";

function SupportAddress({ label, address }: { label: string; address: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState("");
  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(address);
      setStatus("Link copied. Paste it into your browser.");
    } catch {
      input.current?.focus();
      input.current?.select();
      setStatus("The address is selected. Copy it and paste it into your browser.");
    }
  }
  return <div className={styles.address}>
    <label>{label}<input ref={input} aria-label={`${label} address`} value={address} readOnly onFocus={event => event.currentTarget.select()} /></label>
    <Button size="sm" type="button" icon={<Copy className="h-3.5 w-3.5" aria-hidden />} onClick={() => void copyAddress()}>Copy {label.toLowerCase()} link</Button>
    <span className={styles.notice} role="status">{status}</span>
  </div>;
}

function buildLabel(build: SupportBuildInfo) {
  const source = build.commit ? build.commit.slice(0, 12) : "Build identity unavailable";
  return `${build.version ?? "Version unavailable"} · ${source}${build.dirty === true ? " · modified source" : ""}`;
}

export function SupportSettings() {
  const [build, setBuild] = useState(compiledSupportBuildInfo);
  const [identityStatus, setIdentityStatus] = useState("Loading platform details…");
  const [includeModelNames, setIncludeModelNames] = useState(false);
  const [report, setReport] = useState<SupportReport>();
  const [exportStatus, setExportStatus] = useState("");
  const preview = useRef<HTMLTextAreaElement>(null);
  const serialized = report ? JSON.stringify(report, null, 2) : "";
  const guidance = report ? [...new Set(report.recentErrors.map(error => supportGuidance(error.code)).filter((value): value is string => Boolean(value)))] : [];

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/support/build", { cache: "no-store", signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error("Unavailable");
      const info = sanitizeSupportBuildInfo(await response.json());
      if (!controller.signal.aborted) {
        setBuild(info);
        setIdentityStatus(info.platform === "unknown" ? "Platform details are unavailable." : "");
      }
    }).catch(() => {
      if (!controller.signal.aborted) setIdentityStatus("Platform details could not be loaded. You can still prepare a report; unknown fields will be marked.");
    });
    return () => controller.abort();
  }, []);

  function prepareReport() {
    try {
      setReport(createSupportReport(useVdtStudioStore.getState(), build, resolveVdtAppMode(), new Date(), { includeModelNames }));
      setExportStatus("Preview prepared locally. Nothing has been sent.");
      requestAnimationFrame(() => preview.current?.focus());
    } catch {
      setReport(undefined);
      setExportStatus("The report could not be prepared. Report the app version above and describe what happened; do not attach raw application storage.");
    }
  }

  function downloadReport() {
    if (!report) return;
    try {
      // Download precisely the snapshot the user previewed, not a fresh store read.
      downloadBinaryFile(supportReportFilename(report), new TextEncoder().encode(serialized), "application/json");
      setExportStatus("Download requested. Check your downloads and review the file before attaching it to a report.");
    } catch {
      preview.current?.focus();
      preview.current?.select();
      setExportStatus("The download could not start. Copy the selected preview into a text file, then review it before sharing.");
    }
  }

  return <div className={styles.root} data-testid="support-settings">
    <section className={styles.card} aria-labelledby="support-build-heading">
      <h3 id="support-build-heading">This installation</h3>
      <p className={styles.identity} data-testid="support-build-identity">{buildLabel(build)}</p>
      <p>{build.platform === "darwin" ? "macOS" : build.platform === "win32" ? "Windows" : build.platform === "linux" ? "Linux" : "Platform unknown"} · {build.architecture}</p>
      {identityStatus ? <p role="status">{identityStatus}</p> : null}
    </section>

    <section className={styles.card} aria-labelledby="support-get-started">
      <h3 id="support-get-started">Getting started</h3>
      <ol className={styles.steps}>
        <li>Create a project and a VDT, then add or edit KPI values manually.</li>
        <li>For AI features, open <strong>Execution mode</strong>, select a provider and model, and complete the provider’s setup or sign-in.</li>
        <li>If a file is rejected, export a smaller table containing the needed sheets and cells. If an agent task is interrupted, use its recovery action and keep your saved project.</li>
      </ol>
      <SupportAddress label="Setup guide" address={SUPPORT_GUIDE_URL} />
    </section>

    <section className={styles.card} aria-labelledby="support-report-heading">
      <h3 id="support-report-heading">Report a problem</h3>
      <p>Describe the steps, what you expected and what happened. Include the app version above. GitHub reports may be public; share only information you have reviewed.</p>
      <SupportAddress label="Report" address={SUPPORT_REPORT_URL} />
      <p>Prepare an optional diagnostic file below, review it, then attach it yourself. No report is sent automatically.</p>
    </section>

    <section className={styles.card} aria-labelledby="support-diagnostics-heading">
      <h3 id="support-diagnostics-heading">Diagnostic report</h3>
      <p>Includes build and platform details, selected backends and reasoning, task status, error codes and random run/revision identifiers for the current workspace.</p>
      <p>The report omits model names by default and excludes credential fields, prompts, project records, configured paths, source files and raw logs. Review the preview before sharing.</p>
      <label className={styles.modelOption}>
        <input type="checkbox" checked={includeModelNames} aria-describedby="support-model-warning" onChange={event => {
          setIncludeModelNames(event.currentTarget.checked);
          setReport(undefined);
          setExportStatus("Prepare a new preview to download with this setting.");
        }} />
        Include model names
      </label>
      <p id="support-model-warning">Custom chat and Suggested KPI model names may contain private names, paths or domains. Include them only if you can share them.</p>
      <div className={styles.actions}>
        <Button size="sm" type="button" icon={<FileJson className="h-3.5 w-3.5" aria-hidden />} onClick={prepareReport}>{report ? "Refresh diagnostic preview" : "Prepare diagnostic report"}</Button>
        <Button size="sm" type="button" icon={<Download className="h-3.5 w-3.5" aria-hidden />} disabled={!report} onClick={downloadReport}>Download diagnostics</Button>
      </div>
      {report ? <label className={styles.previewLabel}>Diagnostic report preview
        <textarea ref={preview} className={styles.preview} aria-label="Diagnostic report preview" value={serialized} readOnly spellCheck={false} rows={14} />
      </label> : null}
      <p className={styles.notice} role="status" aria-live="polite">{exportStatus}</p>
      {guidance.length ? <div className={styles.guidance}><h4>Suggested next steps</h4><ul>{guidance.map(message => <li key={message}>{message}</li>)}</ul></div> : null}
    </section>
  </div>;
}
