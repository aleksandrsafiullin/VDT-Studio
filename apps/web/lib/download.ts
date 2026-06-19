export function downloadTextFile(filename: string, text: string, type: string) {
  const testWindow = window as Window & {
    __vdtCaptureDownload?: (artifact: { filename: string; text: string; type: string }) => void;
  };

  testWindow.__vdtCaptureDownload?.({ filename, text, type });

  const blob = new Blob([text], { type });
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
