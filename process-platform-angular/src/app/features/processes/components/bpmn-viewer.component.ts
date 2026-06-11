import { AfterViewInit, Component, ElementRef, Input, OnChanges, SimpleChanges, ViewChild } from '@angular/core';
import NavigatedViewer from 'bpmn-js/lib/NavigatedViewer';

type BpmnCanvas = {
  zoom: (value: string) => void;
};

// Read-only zobrazenie BPMN diagramu (historicke revizie) — pan/zoom bez editacie.
@Component({
  selector: 'pp-bpmn-viewer',
  standalone: true,
  template: '<div #canvas class="viewer-canvas"></div>',
  styles: [`
    .viewer-canvas { min-height: 420px; background: #fff; border: 1px solid var(--line); }
  `]
})
export class BpmnViewerComponent implements AfterViewInit, OnChanges {
  @Input({ required: true }) xml = '';
  @ViewChild('canvas', { static: true }) canvasRef!: ElementRef<HTMLElement>;

  private viewer?: NavigatedViewer;

  ngAfterViewInit(): void {
    this.viewer = new NavigatedViewer({ container: this.canvasRef.nativeElement });
    this.importXml();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['xml'] && this.viewer) this.importXml();
  }

  private async importXml(): Promise<void> {
    if (!this.viewer || !this.xml) return;
    await this.viewer.importXML(this.xml);
    (this.viewer.get('canvas') as BpmnCanvas).zoom('fit-viewport');
  }
}
