/**
 * Malý obojsmerný prevodník Markdown <-> HTML.
 *
 * Zámerne pokrýva len tie prvky, ktoré vie vyrobiť panel nástrojov editora
 * (nadpisy, tučné, kurzíva, kód, zoznamy, odkazy). Vďaka tomu je spätný
 * prevod HTML -> Markdown spoľahlivý — nespracúva ľubovoľné HTML, len to,
 * čo sme sami vygenerovali.
 *
 * Vstup sa vždy escapuje, takže sa cez Markdown nedá prepašovať HTML.
 */

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Inline značky vnútri jedného riadku. */
function inlineToHtml(text: string): string {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
}

export function markdownToHtml(markdown: string): string {
  const lines = (markdown ?? '').replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let listType: 'ul' | 'ol' | null = null;
  let paragraph: string[] = [];

  const closeList = () => {
    if (listType) {
      out.push(`</${listType}>`);
      listType = null;
    }
  };

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      out.push(`<p>${paragraph.join('<br>')}</p>`);
      paragraph = [];
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed) {
      flushParagraph();
      closeList();
      continue;
    }

    const heading = /^(#{2,3})\s+(.*)$/.exec(trimmed);
    if (heading) {
      flushParagraph();
      closeList();
      const level = heading[1].length;
      out.push(`<h${level}>${inlineToHtml(heading[2])}</h${level}>`);
      continue;
    }

    const bullet = /^[-*]\s+(.*)$/.exec(trimmed);
    if (bullet) {
      flushParagraph();
      if (listType !== 'ul') {
        closeList();
        out.push('<ul>');
        listType = 'ul';
      }
      out.push(`<li>${inlineToHtml(bullet[1])}</li>`);
      continue;
    }

    const numbered = /^\d+[.)]\s+(.*)$/.exec(trimmed);
    if (numbered) {
      flushParagraph();
      if (listType !== 'ol') {
        closeList();
        out.push('<ol>');
        listType = 'ol';
      }
      out.push(`<li>${inlineToHtml(numbered[1])}</li>`);
      continue;
    }

    closeList();
    paragraph.push(inlineToHtml(trimmed));
  }

  flushParagraph();
  closeList();
  return out.join('');
}

/** Inline obsah jedného uzla -> Markdown. */
function inlineToMarkdown(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return (node.textContent ?? '').replace(/\s+/g, ' ');
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return '';

  const element = node as HTMLElement;
  const inner = Array.from(element.childNodes).map(inlineToMarkdown).join('');

  switch (element.tagName) {
    case 'BR':
      return '\n';
    case 'STRONG':
    case 'B':
      return inner.trim() ? `**${inner.trim()}**` : '';
    case 'EM':
    case 'I':
      return inner.trim() ? `*${inner.trim()}*` : '';
    case 'CODE':
      return inner.trim() ? `\`${inner.trim()}\`` : '';
    case 'A': {
      const href = element.getAttribute('href') ?? '';
      return href ? `[${inner.trim()}](${href})` : inner;
    }
    default:
      return inner;
  }
}

export function htmlToMarkdown(html: string): string {
  const container = document.createElement('div');
  container.innerHTML = html ?? '';
  const blocks: string[] = [];

  const walk = (nodes: NodeListOf<ChildNode> | ChildNode[]) => {
    for (const node of Array.from(nodes)) {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = (node.textContent ?? '').trim();
        if (text) blocks.push(text);
        continue;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) continue;

      const element = node as HTMLElement;
      switch (element.tagName) {
        case 'H1':
        case 'H2':
          blocks.push(`## ${inlineToMarkdown(element).trim()}`);
          break;
        case 'H3':
        case 'H4':
          blocks.push(`### ${inlineToMarkdown(element).trim()}`);
          break;
        case 'UL':
          for (const li of Array.from(element.children)) {
            blocks.push(`- ${inlineToMarkdown(li).trim()}`);
          }
          break;
        case 'OL': {
          let index = 1;
          for (const li of Array.from(element.children)) {
            blocks.push(`${index++}. ${inlineToMarkdown(li).trim()}`);
          }
          break;
        }
        case 'BR':
          break;
        case 'DIV':
        case 'P': {
          const text = inlineToMarkdown(element).trim();
          if (text) blocks.push(text);
          // vnorene bloky (napr. zoznam v divi) spracuj samostatne
          const nested = Array.from(element.children).filter((child) =>
            ['UL', 'OL', 'H1', 'H2', 'H3', 'H4'].includes(child.tagName)
          );
          if (nested.length > 0) walk(nested as unknown as ChildNode[]);
          break;
        }
        default: {
          const text = inlineToMarkdown(element).trim();
          if (text) blocks.push(text);
        }
      }
    }
  };

  walk(container.childNodes);

  // zoznamove polozky drz pri sebe, ostatne bloky oddel prazdnym riadkom
  const result: string[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const current = blocks[i];
    const previous = blocks[i - 1];
    const isListItem = (value?: string) => !!value && /^(-|\d+\.)\s/.test(value);
    if (i > 0 && !(isListItem(current) && isListItem(previous))) result.push('');
    result.push(current);
  }
  return result.join('\n').trim();
}
