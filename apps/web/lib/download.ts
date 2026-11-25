export function getExcelDownloadFilename(displayName: string) {
  return getVdtDownloadFilename(displayName, "xlsx");
}

export function getVdtDownloadFilename(displayName: string, extension: "xlsx" | "json" | "md") {
  const unsafeCharacters = /[<>:"/\\|?*\u0000-\u001f\u007f-\u009f]/g;
  let basename = displayName
    .replace(unsafeCharacters, "_")
    .replace(/[. ]+$/g, "");
  if (!displayName.replace(unsafeCharacters, "").replace(/[. ]+$/g, "")) basename = "VDT";
  // Windows reserves these names even when followed by a file extension.
  if (/^(CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])(?:\.|$)/i.test(basename)) basename = `_${basename}`;
  return `${basename}.${extension}`;
}

export function downloadBinaryFile(filename: string, bytes: Uint8Array, type: string) {
  // Copy the view so a slice of a larger buffer downloads only its own bytes.
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
