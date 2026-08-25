import {
  AfterViewInit,
  Component,
  ElementRef,
  Input,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  ViewChild
} from '@angular/core';
import NavigatedViewer from 'bpmn-js/lib/NavigatedViewer';

type BpmnCanvas = {
  zoom: (value: string | number, center?: string | { x: number; y: number }) => number;
  /** Oznami bpmn-js, ze kontajner zmenil rozmery — bez toho pocita fit zo starych hodnot. */
  resized: () => void;
};

/** Nad tuto mierku sa maly diagram uz nezvacsuje — inak by bol neprirodzene rozmazany. */
const MAX_SCALE = 1.2;

// Read-only zobrazenie BPMN diagramu — pan/zoom bez editacie.
@Component({
  selector: 'pp-bpmn-viewer',
  standalone: true,
  template: '<div #canvas class="viewer-canvas"></div>',
  styles: [`
    /* Bez display:block by sa host zmrstil na obsah a diagram by sa fitol
       do male plochy v rohu namiesto celej karty. */
    :host {
      display: block;
      width: 100%;
      height: 100%;
      min-height: 420px;
    }

    .viewer-canvas {
      width: 100%;
      height: 100%;
      min-height: 420px;
      background: #fff;
      border: 1px solid var(--line);
      border-radius: var(--r-sm, 6px);
      overflow: hidden;
    }
  `]
})
export class BpmnViewerComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input({ required: true }) xml = '';
  @ViewChild('canvas', { static: true }) canvasRef!: ElementRef<HTMLElement>;

  private viewer?: NavigatedViewer;
  private resizeObserver?: ResizeObserver;
  private refitTimer: ReturnType<typeof setTimeout> | null = null;

  ngAfterViewInit(): void {
    this.viewer = new NavigatedViewer({ container: this.canvasRef.nativeElement });
    this.importXml();

    // Karta moze menit sirku (zbalenie stromu, zmena okna) — diagram sa musi prisposobit.
    this.resizeObserver = new ResizeObserver(() => this.scheduleFit());
    this.resizeObserver.observe(this.canvasRef.nativeElement);

    // Poistka pre pripad, ze ResizeObserver nedobehne (napr. skryta zalozka).
    window.addEventListener('resize', this.onWindowResize);
  }

  private readonly onWindowResize = () => this.scheduleFit();

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['xml'] && this.viewer) this.importXml();
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
    window.removeEventListener('resize', this.onWindowResize);
    if (this.refitTimer) clearTimeout(this.refitTimer);
    this.viewer?.destroy?.();
  }

  private async importXml(): Promise<void> {
    if (!this.viewer || !this.xml) return;
    await this.viewer.importXML(this.xml);
    this.fitToViewport();
  }

  private scheduleFit(): void {
    if (this.refitTimer) clearTimeout(this.refitTimer);
    this.refitTimer = setTimeout(() => this.fitToViewport(), 80);
  }

  /** Zobrazi cely diagram vycentrovany v dostupnej ploche. */
  private fitToViewport(): void {
    if (!this.viewer) return;
    const element = this.canvasRef.nativeElement;
    // pokial este nema rozmery, fit by vysiel nezmyselne — pockaj na dalsi resize
    if (element.clientWidth === 0 || element.clientHeight === 0) return;

    try {
      const canvas = this.viewer.get('canvas') as BpmnCanvas;
      // bez resized() pocita fit-viewport z rozmerov zapamatanych pri inicializacii
      canvas.resized();
      const scale = canvas.zoom('fit-viewport', 'auto');
      if (typeof scale === 'number' && scale > MAX_SCALE) {
        canvas.zoom(MAX_SCALE, 'auto');
      }
    } catch {
      // diagram este nie je nacitany — dalsi pokus pride pri resize
    }
  }
}
