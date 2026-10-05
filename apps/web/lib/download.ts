export function getExcelDownloadFilename(displayName: string) {
  const unsafeCharacters = /[<>:"/\\|?*\u0000-\u001f\u007f-\u009f]/g;
  let basename = displayName
    .replace(unsafeCharacters, "_")
    .replace(/[. ]+$/g, "");
  if (!displayName.replace(unsafeCharacters, "").replace(/[. ]+$/g, "")) basename = "VDT";
  // Windows reserves these names even when followed by a file extension.
  if (/^(CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])(?:\.|$)/i.test(basename)) basename = `_${basename}`;
  return `${basename}.xlsx`;
}

export function downloadTextFile(filename: string, text: string, type: string) {
  const testWindow = window as Window & {
    __vdtCaptureDownload?: (artifact: { filename: string; text: string; type: string }) => void;
  };

  testWindow.__vdtCaptureDownload?.({ filename, text, type });

  downloadBlob(filename, new Blob([text], { type }));
}

export function downloadBinaryFile(filename: string, bytes: Uint8Array, type: string) {
  // Copy the view so only the workbook bytes are downloaded, including when the
  // exporter returns a slice of a larger buffer.
  const data = new Uint8Array(bytes).buffer;
  downloadBlob(filename, new Blob([data], { type }));
}

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();

  window.setTimeout(() => {
    anchor.remove();
    URL.revokeObjectURL(url);
  }, 0);
}
