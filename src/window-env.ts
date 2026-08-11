export const pageWindow: Window & typeof globalThis =
  typeof unsafeWindow === 'undefined' ? window : unsafeWindow;
