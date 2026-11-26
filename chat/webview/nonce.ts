// Read while the bundle first runs: currentScript is null afterwards.
export const nonce = (document.currentScript as HTMLScriptElement | null)?.nonce ?? "";
