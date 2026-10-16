/** Files dropped anywhere on Home wait here for the Files panel, which loads them (it may have to open first). */
let queue: File[] = [];

export function dropFiles(files: File[]) {
  queue = [...queue, ...files];
  window.dispatchEvent(new Event('ip-drop-files'));
}

export function takeDroppedFiles(): File[] {
  const q = queue;
  queue = [];
  return q;
}
