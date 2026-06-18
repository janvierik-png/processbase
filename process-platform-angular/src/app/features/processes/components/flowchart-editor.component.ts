import {
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  OnInit,
  Output,
  SimpleChanges,
  ViewChild
} from '@angular/core';

@Component({
  selector: 'pp-flowchart-editor',
  standalone: true,
  template: `
    <div class="flowchart-wrap">
      <iframe
        #frame
        [src]="embedUrl"
        class="flowchart-frame"
        frameborder="0"
      ></iframe>
    </div>
  `,
  styles: [`
    .flowchart-wrap {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 560px;
    }
    .flowchart-frame {
      flex: 1;
      width: 100%;
      min-height: 560px;
      border: none;
    }
  `]
})
export class FlowchartEditorComponent implements OnInit, OnChanges, OnDestroy {
  @Input({ required: true }) xml = '';
  @Output() xmlChange = new EventEmitter<string>();
  @ViewChild('frame') frameRef!: ElementRef<HTMLIFrameElement>;

  readonly embedUrl = 'https://embed.diagrams.net/?embed=1&proto=json&spin=1&ui=atlas&noSaveBtn=0&saveAndExit=0&noExitBtn=1';

  private listener!: (event: MessageEvent) => void;
  private initialized = false;
  private pendingXml: string | null = null;

  ngOnInit(): void {
    this.listener = (event: MessageEvent) => {
      if (!event.data || typeof event.data !== 'string') return;
      let msg: any;
      try { msg = JSON.parse(event.data); } catch { return; }

      if (msg.event === 'init') {
        this.initialized = true;
        this.sendLoad(this.pendingXml ?? this.xml);
        this.pendingXml = null;
      } else if (msg.event === 'autosave' || msg.event === 'save') {
        if (msg.xml) this.xmlChange.emit(msg.xml);
      }
    };
    window.addEventListener('message', this.listener);
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['xml'] && !changes['xml'].firstChange) {
      if (this.initialized) {
        this.sendLoad(this.xml);
      } else {
        this.pendingXml = this.xml;
      }
    }
  }

  ngOnDestroy(): void {
    window.removeEventListener('message', this.listener);
  }

  private sendLoad(xml: string): void {
    const frame = this.frameRef?.nativeElement;
    if (!frame?.contentWindow) return;
    frame.contentWindow.postMessage(
      JSON.stringify({ action: 'load', xml: xml || '<mxGraphModel/>', autosave: 1 }),
      '*'
    );
  }
}
