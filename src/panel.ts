import { GM_xmlhttpRequest } from '$';
import {
  addWordlist,
  dbGetAllWordlists,
  deleteWordlist,
  getActiveWordlist,
  selectWordlist,
  setWordListUIRefresh
} from './storage';
import type { WordlistRecord, WordListUI } from './types';
import { pageWindow } from './window-env';
import { deriveWordlistNameFromUrl, normalizeWordText } from './wordlist';
import { state } from './webpack-hook';

function requestText(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (typeof GM_xmlhttpRequest !== 'function') {
      reject(new Error('当前脚本管理器未提供 GM_xmlhttpRequest'));
      return;
    }

    GM_xmlhttpRequest({
      method: 'GET',
      url,
      timeout: 20000,
      onload(response) {
        if (response.status >= 200 && response.status < 300) {
          resolve(response.responseText);
          return;
        }

        reject(new Error(`请求失败：HTTP ${response.status}`));
      },
      onerror() {
        reject(new Error('网络请求失败'));
      },
      ontimeout() {
        reject(new Error('请求超时'));
      }
    });
  });
}

function getElement<T extends HTMLElement>(root: ShadowRoot, id: string): T {
  const element = root.getElementById(id);

  if (!element) {
    throw new Error(`缺少 UI 元素：${id}`);
  }

  return element as T;
}

export function installWordListPanel(): WordListUI | null {
  const install = () => {
    if (document.getElementById('xddh-word-list-panel-host')) {
      return null;
    }

    const host = document.createElement('div');
    host.id = 'xddh-word-list-panel-host';
    Object.assign(host.style, {
      position: 'fixed',
      right: '16px',
      bottom: '16px',
      zIndex: '2147483647',
      width: 'min(384px, calc(100vw - 32px))',
      pointerEvents: 'none'
    });

    const shadow = host.attachShadow({ mode: 'open' });
    const tailwindStyle = document.createElement('link');
    tailwindStyle.rel = 'stylesheet';
    tailwindStyle.href = 'https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css';
    shadow.appendChild(tailwindStyle);

    const container = document.createElement('div');
    container.className = 'flex flex-col items-end space-y-3';
    container.style.pointerEvents = 'auto';
    container.innerHTML = `
      <section id="xddh-word-panel" class="hidden w-full overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl">
        <header class="flex items-center justify-between border-b border-gray-200 px-4 py-3">
          <div>
            <h2 class="text-base font-semibold text-gray-900">自定义词库</h2>
            <p class="mt-1 text-xs text-gray-500">导入内容会保存在浏览器本地</p>
          </div>
          <button id="xddh-close-panel" type="button" class="rounded-md px-2 py-1 text-lg text-gray-500 hover:bg-gray-100 hover:text-gray-900" aria-label="关闭">×</button>
        </header>
        <div class="space-y-4 p-4">
          <div class="rounded-lg bg-gray-50 p-3 text-sm">
            <div class="flex justify-between"><span class="text-gray-500">本地词库</span><span id="xddh-stored-count" class="font-medium text-gray-900">0</span></div>
            <div class="mt-1 flex justify-between"><span class="text-gray-500">游戏词库长度</span><span id="xddh-target-count" class="font-medium text-gray-900">等待模块</span></div>
            <div class="mt-1 flex items-start justify-between gap-3"><span class="shrink-0 text-gray-500">来源</span><span id="xddh-source" class="break-all text-right font-medium text-gray-900">游戏原词库</span></div>
          </div>
          <div class="space-y-2">
            <label for="xddh-wordlist-select" class="block text-sm font-medium text-gray-700">选择词库</label>
            <select id="xddh-wordlist-select" class="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200"></select>
          </div>
          <div class="space-y-2">
            <label for="xddh-word-url" class="block text-sm font-medium text-gray-700">从网址导入</label>
            <input id="xddh-word-url" type="url" placeholder="https://example.com/words.txt" class="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200">
            <button id="xddh-import-url" type="button" class="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">从网址导入</button>
          </div>
          <div class="flex items-center gap-3"><div class="h-px flex-1 bg-gray-200"></div><span class="text-xs text-gray-400">或</span><div class="h-px flex-1 bg-gray-200"></div></div>
          <div class="space-y-2">
            <label for="xddh-word-text" class="block text-sm font-medium text-gray-700">粘贴词库</label>
            <textarea id="xddh-word-text" rows="7" placeholder="一行一个词&#10;苹果&#10;香蕉&#10;西瓜" class="block w-full resize-y rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200"></textarea>
            <button id="xddh-import-text" type="button" class="w-full rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-black">导入粘贴内容</button>
          </div>
          <button id="xddh-reset-words" type="button" class="w-full rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-100">删除当前词库并恢复默认</button>
          <p id="xddh-word-status" class="min-h-5 text-sm text-gray-500"></p>
          <p class="text-xs leading-5 text-gray-400">导入后会立即修改当前导出数组。游戏已经缓存词库时，刷新页面后可确保全部生效。</p>
        </div>
      </section>
      <button id="xddh-toggle-panel" type="button" class="rounded-full bg-gray-900 px-4 py-3 text-sm font-medium text-white shadow-xl hover:bg-black">词库</button>
    `;

    shadow.appendChild(container);
    document.documentElement.appendChild(host);

    const panel = getElement<HTMLElement>(shadow, 'xddh-word-panel');
    const toggleButton = getElement<HTMLButtonElement>(shadow, 'xddh-toggle-panel');
    const closeButton = getElement<HTMLButtonElement>(shadow, 'xddh-close-panel');
    const urlInput = getElement<HTMLInputElement>(shadow, 'xddh-word-url');
    const textInput = getElement<HTMLTextAreaElement>(shadow, 'xddh-word-text');
    const importUrlButton = getElement<HTMLButtonElement>(shadow, 'xddh-import-url');
    const importTextButton = getElement<HTMLButtonElement>(shadow, 'xddh-import-text');
    const resetButton = getElement<HTMLButtonElement>(shadow, 'xddh-reset-words');
    const wordlistSelect = getElement<HTMLSelectElement>(shadow, 'xddh-wordlist-select');
    const storedCount = getElement<HTMLElement>(shadow, 'xddh-stored-count');
    const targetCount = getElement<HTMLElement>(shadow, 'xddh-target-count');
    const sourceElement = getElement<HTMLElement>(shadow, 'xddh-source');
    const statusElement = getElement<HTMLElement>(shadow, 'xddh-word-status');

    const setStatus: WordListUI['setStatus'] = (message, type = 'normal') => {
      statusElement.textContent = message;
      const classNames = {
        normal: 'min-h-5 text-sm text-gray-500',
        success: 'min-h-5 text-sm text-green-600',
        error: 'min-h-5 text-sm text-red-600'
      };
      statusElement.className = classNames[type] ?? classNames.normal;
    };

    const refresh = async () => {
      let lists: WordlistRecord[] = [];

      try {
        lists = await dbGetAllWordlists();
      } catch (error) {
        console.error('[XDDH Hook] 读取词库列表失败', error);
      }

      const activeWordlist = getActiveWordlist();
      wordlistSelect.innerHTML = '';

      const defaultOption = document.createElement('option');
      defaultOption.value = '';
      defaultOption.textContent = '默认词库（游戏原词库）';
      wordlistSelect.appendChild(defaultOption);

      for (const list of lists) {
        const option = document.createElement('option');
        option.value = list.id;
        option.textContent = list.name;
        wordlistSelect.appendChild(option);
      }

      wordlistSelect.value = activeWordlist?.id ?? '';
      storedCount.textContent = String(activeWordlist?.words.length ?? 0);
      targetCount.textContent = state.target?.originalN && Array.isArray(state.target.originalN)
        ? String(state.target.originalN.length)
        : '等待模块';

      if (!activeWordlist) {
        sourceElement.textContent = '游戏原词库';
        return;
      }

      sourceElement.textContent = activeWordlist.source.type === 'url'
        ? activeWordlist.source.value
        : '用户粘贴文本';
    };

    const importWords = async (name: string, words: string[], source: Parameters<typeof addWordlist>[0]['source']) => {
      const { record, applied } = await addWordlist({ name, words, source });
      await refresh();
      setStatus(
        applied
          ? `已导入「${record.name}」${record.words.length} 个词，并应用到当前词库`
          : `已导入「${record.name}」${record.words.length} 个词，刷新页面后生效`,
        'success'
      );
    };

    toggleButton.addEventListener('click', () => {
      panel.classList.toggle('hidden');
      refresh();
    });

    closeButton.addEventListener('click', () => {
      panel.classList.add('hidden');
    });

    importTextButton.addEventListener('click', async () => {
      try {
        const words = normalizeWordText(textInput.value);
        await importWords(
          `粘贴词库 ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
          words,
          { type: 'text' }
        );
      } catch (error) {
        setStatus(error instanceof Error ? error.message : String(error), 'error');
      }
    });

    importUrlButton.addEventListener('click', async () => {
      importUrlButton.disabled = true;
      setStatus('正在下载词库……');

      try {
        const parsedUrl = new URL(urlInput.value.trim(), pageWindow.location.href);

        if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
          throw new Error('仅支持 HTTP 或 HTTPS 地址');
        }

        const text = await requestText(parsedUrl.href);
        const words = normalizeWordText(text);
        await importWords(deriveWordlistNameFromUrl(parsedUrl.href), words, {
          type: 'url',
          value: parsedUrl.href
        });
      } catch (error) {
        setStatus(error instanceof Error ? error.message : String(error), 'error');
      } finally {
        importUrlButton.disabled = false;
      }
    });

    wordlistSelect.addEventListener('change', async () => {
      try {
        await selectWordlist(wordlistSelect.value);
        await refresh();
      } catch (error) {
        setStatus(error instanceof Error ? error.message : String(error), 'error');
      }
    });

    resetButton.addEventListener('click', async () => {
      const activeWordlist = getActiveWordlist();

      if (!activeWordlist) {
        setStatus('当前已经是默认词库', 'normal');
        return;
      }

      try {
        await deleteWordlist(activeWordlist.id);
        await refresh();
        setStatus('已删除当前词库，恢复默认词库', 'success');
      } catch (error) {
        setStatus(error instanceof Error ? error.message : String(error), 'error');
      }
    });

    const ui: WordListUI = {
      refresh,
      setStatus
    };

    setWordListUIRefresh(refresh);
    refresh();

    return ui;
  };

  if (document.documentElement) {
    return install();
  }

  document.addEventListener('DOMContentLoaded', install, { once: true });
  return null;
}
