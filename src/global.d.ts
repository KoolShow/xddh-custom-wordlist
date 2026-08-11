/// <reference types="vite-plugin-monkey/client" />

declare const unsafeWindow: Window & typeof globalThis;

type GmHttpResponse = {
  status: number;
  responseText: string;
};

declare function GM_xmlhttpRequest(options: {
  method: string;
  url: string;
  timeout?: number;
  onload(response: GmHttpResponse): void;
  onerror(): void;
  ontimeout(): void;
}): void;
