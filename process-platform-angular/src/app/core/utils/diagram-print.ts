/**
 * #25 FREE-02 — tlač BPMN diagramu. Kým sa diagram zmestí na stranu čitateľne,
 * vytlačí sa na jednu; inak sa rozdelí na strany v mierke 100 % s malým
 * prekryvom — veľký diagram sa neoreže ani nezmenší na nečitateľnosť.
 *
 * Strany sú samostatné SVG obrázky (data URL v <img>) — obsah diagramu sa
 * nikdy nevkladá ako HTML a nič z neho sa nespustí.
 */
export type PaperSize = 'A4' | 'A3';
export type Orientation = 'portrait' | 'landscape';
export type PrintMode = 'auto' | 'fit' | 'tile';

export interface SvgBox { x: number; y: number; width: number; height: number }

export interface PrintPlan {
  scale: number;
  columns: number;
  rows: number;
  /** oblasť strany na obsah (CSS px) */
  pageWidth: number;
  pageHeight: number;
  /** text diagramu ostane čitateľný */
  readable: boolean;
}

const MM = 96 / 25.4;
const PAPER: Record<PaperSize, [number, number]> = { A4: [210, 297], A3: [297, 420] };
const MARGIN_MM = 10;
const HEADER_MM = 8;
const OVERLAP_PX = 24;
/** pod touto mierkou je text BPMN (11 px) menší ako ~5 pt */
export const MIN_READABLE_SCALE = 0.6;

export function printableArea(paper: PaperSize, orientation: Orientation): { width: number; height: number } {
  let [width, height] = PAPER[paper];
  if (orientation === 'landscape') [width, height] = [height, width];
  return { width: (width - 2 * MARGIN_MM) * MM, height: (height - 2 * MARGIN_MM - HEADER_MM) * MM };
}

export function planPrint(box: Pick<SvgBox, 'width' | 'height'>, paper: PaperSize, orientation: Orientation, mode: PrintMode): PrintPlan {
  const area = printableArea(paper, orientation);
  const fit = Math.min(area.width / box.width, area.height / box.height, 1);
  const tile = mode === 'tile' || (mode === 'auto' && fit < MIN_READABLE_SCALE);
  if (!tile) {
    return { scale: fit, columns: 1, rows: 1, pageWidth: area.width, pageHeight: area.height, readable: fit >= MIN_READABLE_SCALE };
  }
  const stepWidth = area.width - OVERLAP_PX;
  const stepHeight = area.height - OVERLAP_PX;
  return {
    scale: 1,
    columns: Math.max(1, Math.ceil((box.width - OVERLAP_PX) / stepWidth)),
    rows: Math.max(1, Math.ceil((box.height - OVERLAP_PX) / stepHeight)),
    pageWidth: area.width,
    pageHeight: area.height,
    readable: true
  };
}

/** Rozmery diagramu z viewBox (bpmn-js ho pri saveSVG vždy nastaví), inak z width/height. */
export function svgBox(svg: string): SvgBox {
  const root = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement;
  const view = (root.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/).map(Number);
  if (view.length === 4 && view.every(Number.isFinite) && view[2] > 0 && view[3] > 0) {
    return { x: view[0], y: view[1], width: view[2], height: view[3] };
  }
  return { x: 0, y: 0, width: parseFloat(root.getAttribute('width') ?? '0') || 1, height: parseFloat(root.getAttribute('height') ?? '0') || 1 };
}

/** Jednotlivé strany ako samostatné SVG (výrez diagramu cez viewBox). */
export function printPages(svg: string, plan: PrintPlan, box: SvgBox): string[] {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const root = doc.documentElement;
  const serializer = new XMLSerializer();
  // obsah strany v súradniciach diagramu
  const viewWidth = plan.columns === 1 && plan.rows === 1 ? box.width : plan.pageWidth / plan.scale;
  const viewHeight = plan.columns === 1 && plan.rows === 1 ? box.height : plan.pageHeight / plan.scale;
  const stepWidth = plan.columns === 1 ? 0 : (plan.pageWidth - OVERLAP_PX) / plan.scale;
  const stepHeight = plan.rows === 1 ? 0 : (plan.pageHeight - OVERLAP_PX) / plan.scale;
  const pages: string[] = [];
  for (let row = 0; row < plan.rows; row++) {
    for (let column = 0; column < plan.columns; column++) {
      const page = root.cloneNode(true) as Element;
      page.setAttribute('viewBox', `${box.x + column * stepWidth} ${box.y + row * stepHeight} ${viewWidth} ${viewHeight}`);
      page.setAttribute('width', String(Math.round(viewWidth * plan.scale)));
      page.setAttribute('height', String(Math.round(viewHeight * plan.scale)));
      page.setAttribute('preserveAspectRatio', 'xMinYMin meet');
      pages.push(serializer.serializeToString(page));
    }
  }
  return pages;
}

export function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}

/** Dokument na tlač: strana = obrázok SVG, hlavička s názvom a poradím strany. */
export function printDocument(pages: string[], plan: PrintPlan, title: string, paper: PaperSize, orientation: Orientation): string {
  const total = pages.length;
  const body = pages.map((page, index) => {
    const row = Math.floor(index / plan.columns) + 1;
    const column = (index % plan.columns) + 1;
    const position = total > 1 ? ` · strana ${index + 1} z ${total} (riadok ${row}, stĺpec ${column})` : '';
    return `<section class="page"><header>${escapeHtml(title)}${position}</header><img alt="" src="${svgDataUrl(page)}"></section>`;
  }).join('');
  return `<!doctype html><html lang="sk"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>
@page { size: ${paper} ${orientation}; margin: ${MARGIN_MM}mm; }
html, body { margin: 0; font: 9pt Arial, sans-serif; color: #333; }
.page { break-after: page; page-break-after: always; }
.page:last-child { break-after: auto; page-break-after: auto; }
header { height: ${HEADER_MM - 2}mm; margin-bottom: 2mm; border-bottom: 0.3mm solid #ccc; }
img { display: block; max-width: 100%; }
</style></head><body>${body}</body></html>`;
}
