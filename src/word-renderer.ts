function appendEscapedWordContent(target: HTMLElement, raw: string): void {
  const pattern = /\\(.)|\[([^[]\]]*)\]/g;
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
  if (!(element instanceof HTMLElement) || element.dataset.xddhImg === '1') {
    return;
  }

  const raw = element.textContent ?? '';

  if (!raw.includes('\\') && !raw.includes('[')) {
    return;
  }

  element.dataset.xddhImg = '1';
  element.textContent = '';
  appendEscapedWordContent(element, raw);
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
      for (const node of record.addedNodes) {
        pendingNodes.add(node);
      }
    }

    schedule();
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  pendingNodes.add(document.documentElement);
  schedule();
}
