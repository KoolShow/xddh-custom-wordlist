import type { WordlistRecord } from './types';

export function normalizeWordText(text: unknown): string[] {
  return String(text ?? '')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map(word => word.trim())
    .filter(Boolean);
}

export function normalizeImportedWords(words: readonly unknown[]): string[] {
  return words
    .map(word => String(word).trim())
    .filter(Boolean);
}

export function deriveWordlistNameFromUrl(url: string): string {
  try {
    let filename = new URL(url).pathname.split('/').pop() || '';

    try {
      filename = decodeURIComponent(filename);
    } catch {}

    const base = filename.replace(/\.[^.]*$/, '') || filename;
    return base || '网址词库';
  } catch {
    return '网址词库';
  }
}

export function resizeWordList(words: readonly string[], targetLength: number): string[] {
  if (words.length === 0 || targetLength <= 0) {
    return [];
  }

  return Array.from(
    { length: targetLength },
    (_, index) => words[index % words.length]
  );
}

export function buildReplacementN(
  originalN: unknown,
  activeWordlist: WordlistRecord | null
): unknown[] {
  if (!Array.isArray(originalN)) {
    return [];
  }

  if (originalN.length === 0) {
    return [];
  }

  if (!activeWordlist || activeWordlist.words.length === 0) {
    return originalN.slice();
  }

  return resizeWordList(activeWordlist.words, originalN.length);
}

export function copyArray(target: unknown[], source: readonly unknown[]): void {
  target.length = 0;

  for (const item of source) {
    target.push(item);
  }
}
