function appendEscapedWordContent(target: HTMLElement, raw: string): void {
  const pattern = /\\(.)|\[([^[\]]*)\]/g;
  let lastIndex = 0;
  let match = pattern.exec(raw);

  while (match) {
    if (match.index > lastIndex) {
      target.append(document.createTextNode(raw.slice(lastIndex, match.index)));
    }

    const escaped = match[1];
    const url = match[2];

    if (escaped !== undefined) {
      target.append(document.createTextNode(escaped));
    } else {
      const image = document.createElement('img');
      image.className = 'xddh-word-img';
      image.src = url ?? '';
      target.append(image);
    }

    lastIndex = pattern.lastIndex;
    match = pattern.exec(raw);
  }

  if (lastIndex < raw.length) {
    target.append(document.createTextNode(raw.slice(lastIndex)));
  }
}

function processWordElement(element: Element): void {
  if (!(element instanceof HTMLElement)) {
    return;
  }

  const raw = element.textContent ?? '';

  if (element.dataset.xddhImgRaw === raw) {
    return;
  }

  if (!raw.includes('\\') && !raw.includes('[')) {
    return;
  }

  element.dataset.xddhImg = '1';
  element.dataset.xddhImgRaw = raw;
  element.textContent = '';
  appendEscapedWordContent(element, raw);
}

function setWordElementRaw(element: HTMLElement, raw: string): void {
  delete element.dataset.xddhImg;
  delete element.dataset.xddhImgRaw;
  element.textContent = raw;
  processWordElement(element);
}

function buildWordIndex(words: readonly unknown[]): Map<string, number[]> {
  const indexes = new Map<string, number[]>();

  words.forEach((word, index) => {
    if (typeof word !== 'string') {
      return;
    }

    const existing = indexes.get(word);

    if (existing) {
      existing.push(index);
      return;
    }

    indexes.set(word, [index]);
  });

  return indexes;
}

function processNode(node: Node): void {
  if (!(node instanceof Element)) {
    return;
  }

  if (node.classList.contains('xddh-word')) {
    processWordElement(node);
  }

  for (const word of node.querySelectorAll('.xddh-word')) {
    processWordElement(word);
  }
}

export function reloadWordImages(): void {
  processNode(document.documentElement);
}

export function replaceVisibleWords(
  previousWords: readonly unknown[],
  nextWords: readonly unknown[]
): void {
  const previousIndexes = buildWordIndex(previousWords);

  for (const word of document.querySelectorAll('.xddh-word')) {
    if (!(word instanceof HTMLElement)) {
      continue;
    }

    const raw = word.dataset.xddhImgRaw ?? word.textContent ?? '';
    const indexes = previousIndexes.get(raw);
    const index = indexes?.shift();
    const nextWord = index === undefined ? undefined : nextWords[index];

    if (typeof nextWord !== 'string') {
      continue;
    }

    setWordElementRaw(word, nextWord);
  }
}

export function installWordButtonStyle(): void {
  const style = document.createElement('style');
  style.textContent = `
    .xddh-word {
      height: auto !important;
      min-height: 2.5rem;
      padding: 0.5rem 0.375rem;
      line-height: 1.2 !important;
      white-space: normal !important;
      word-break: break-all;
      overflow-wrap: anywhere;
      display: flex !important;
      flex-wrap: wrap;
      align-items: center;
      justify-content: center;
    }

    :has(> .xddh-word) {
      align-self: stretch !important;
    }

    :has(> .xddh-word) > .xddh-word {
      height: 100% !important;
    }

    .xddh-word-img {
      display: block;
      width: 100%;
      height: auto;
      object-fit: contain;
    }
  `;
  document.documentElement.appendChild(style);

  const pendingNodes = new Set<Node>();
  let scheduled = false;

  const queueNode = (node: Node) => {
    pendingNodes.add(node instanceof Element ? node : (node.parentElement ?? node));
  };

  const flush = () => {
    scheduled = false;
    const nodes = Array.from(pendingNodes);
    pendingNodes.clear();

    for (const node of nodes) {
      processNode(node);
    }
  };

  const schedule = () => {
    if (scheduled) {
      return;
    }

    scheduled = true;
    requestAnimationFrame(flush);
  };

	  const observer = new MutationObserver(records => {
	    for (const record of records) {
	      queueNode(record.target);

	      for (const node of record.addedNodes) {
	        queueNode(node);
	      }
	    }

    schedule();
  });

  observer.observe(document.documentElement, {
    childList: true,
    characterData: true,
    subtree: true
  });

  reloadWordImages();
}
