/** Open the browser/OS date picker from a user click. Hidden overlays often do nothing in Electron. */
export function openNativeDatePicker(input: HTMLInputElement): boolean {
  if (typeof input.showPicker === "function") {
    try {
      input.showPicker();
      return true;
    } catch {
      /* not allowed for this input */
    }
  }
  input.focus();
  return false;
}
