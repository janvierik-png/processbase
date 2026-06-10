import { AfterViewInit, Component, ElementRef, EventEmitter, Input, OnChanges, Output, SimpleChanges, ViewChild } from '@angular/core';
import BpmnModeler from 'bpmn-js/lib/Modeler';
import {
  BpmnPropertiesPanelModule,
  BpmnPropertiesProviderModule,
  CamundaPlatformPropertiesProviderModule
} from 'bpmn-js-properties-panel';
import camundaModdleDescriptors from 'camunda-bpmn-moddle/resources/camunda.json';

type BpmnCanvas = {
  zoom: (value: string) => void;
};

@Component({
  selector: 'pp-bpmn-editor',
  standalone: true,
  template: `
    <section class="editor-layout" [class.properties-hidden]="!propertiesVisible">
      <div #canvas class="canvas"></div>
      <aside #properties class="properties"></aside>
    </section>
  `,
  styles: [`
    .editor-layout { display: grid; grid-template-columns: minmax(0, 1fr) 360px; gap: 16px; min-height: 560px; }
    .canvas, .properties { min-height: 560px; background: #fff; border: 1px solid var(--line); }
    .properties { overflow: auto; }
    .properties-hidden { grid-template-columns: minmax(0, 1fr) 0; gap: 0; }
    .properties-hidden .properties { width: 0; border: 0; overflow: hidden; }
  `]
})
export class BpmnEditorComponent implements AfterViewInit, OnChanges {
  @Input({ required: true }) xml = '';
  @Input() propertiesVisible = false;
  @Output() xmlChange = new EventEmitter<string>();
  @ViewChild('canvas', { static: true }) canvasRef!: ElementRef<HTMLElement>;
  @ViewChild('properties', { static: true }) propertiesRef!: ElementRef<HTMLElement>;

  private modeler?: BpmnModeler;
  private importing = false;

  ngAfterViewInit(): void {
    this.modeler = new BpmnModeler({
      container: this.canvasRef.nativeElement,
      propertiesPanel: { parent: this.propertiesRef.nativeElement },
      additionalModules: [
        BpmnPropertiesPanelModule,
        BpmnPropertiesProviderModule,
        CamundaPlatformPropertiesProviderModule
      ],
      moddleExtensions: {
        camunda: camundaModdleDescriptors
      }
    });

    this.modeler.on('commandStack.changed', async () => {
      if (this.importing || !this.modeler) return;
      const result = await this.modeler.saveXML({ format: true });
      this.xmlChange.emit(result.xml);
    });

    this.importXml();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['xml'] && this.modeler) this.importXml();
  }

  private async importXml(): Promise<void> {
    if (!this.modeler || !this.xml) return;
    this.importing = true;
    await this.modeler.importXML(this.xml);
    (this.modeler.get('canvas') as BpmnCanvas).zoom('fit-viewport');
    this.importing = false;
  }
}
