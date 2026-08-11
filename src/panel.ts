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
import { createWordlistPanelView, hasWordlistPanelView } from './wordlist-panel-view';
import { deriveWordlistNameFromUrl, normalizeWordText } from './wordlist';
import { state } from './webpack-hook';

type GmHttpResponse = {
  status: number;
  responseText: string;
};

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
      onload(response: GmHttpResponse) {
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

function getDroppedWordlistFile(event: DragEvent): File | null {
  const files = event.dataTransfer?.files;
  return files && files.length > 0 ? files[0] : null;
}

function readWordlistFile(file: File): Promise<string> {
  return file.text();
}

export function installWordListPanel(): WordListUI | null {
  const install = () => {
    if (hasWordlistPanelView()) {
      return null;
    }

    const view = createWordlistPanelView();
    const {
      panel,
      toggleButton,
      closeButton,
      urlInput,
      textInput,
      importUrlButton,
      importTextButton,
      resetButton,
      wordlistSelect,
      storedCount,
      targetCount,
      sourceElement,
      statusElement
    } = view;

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
      const isHidden = panel.classList.toggle('hidden');
      panel.classList.toggle('flex', !isHidden);
      toggleButton.classList.toggle('hidden', !isHidden);
      refresh();
    });

    closeButton.addEventListener('click', () => {
      panel.classList.add('hidden');
      panel.classList.remove('flex');
      toggleButton.classList.remove('hidden');
    });

    const setTextDropActive = (active: boolean) => {
      textInput.classList.toggle('border-blue-500', active);
      textInput.classList.toggle('bg-blue-50', active);
      textInput.classList.toggle('ring-2', active);
      textInput.classList.toggle('ring-blue-200', active);
    };

    textInput.addEventListener('dragover', event => {
      event.preventDefault();
      setTextDropActive(true);
    });

    textInput.addEventListener('dragleave', () => {
      setTextDropActive(false);
    });

    textInput.addEventListener('drop', async event => {
      event.preventDefault();
      setTextDropActive(false);

      const file = getDroppedWordlistFile(event);

      if (!file) {
        return;
      }

      try {
        textInput.value = await readWordlistFile(file);
        setStatus(`已读取本地文件「${file.name}」，点击导入粘贴内容后生效`, 'success');
      } catch (error) {
        setStatus(error instanceof Error ? error.message : String(error), 'error');
      }
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
