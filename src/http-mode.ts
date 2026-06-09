/**
 * Tracks the HTTP base URL when the server is running in HTTP mode.
 * Set once at startup; null in stdio mode.
 */
let _sseBaseUrl: string | null = null;

export function setSseBaseUrl(url: string): void {
  _sseBaseUrl = url;
}

export function getSseBaseUrl(): string | null {
  return _sseBaseUrl;
}
