import {
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  OnChanges,
  OnDestroy,
  OnInit,
  Output,
  SimpleChanges,
  ViewChild,
  signal
} from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { ConsentService } from '../../../core/services/consent.service';

const EMBED_ORIGIN = 'https://embed.diagrams.net';

@Component({
  selector: 'pp-flowchart-editor',
  standalone: true,
  template: `
    <div class="flowchart-wrap" [class.fullscreen]="isFullscreen()">
      <div class="flowchart-toolbar">
        <span class="save-status" [class.saved]="saveStatus() === 'saved'" [class.saving]="saveStatus() === 'saving'">
          @if (saveStatus() === 'saving') { Ukladá sa... }
          @else if (saveStatus() === 'saved') { ✓ Uložené }
          @else { Neuložené zmeny }
        </span>
        <button type="button" class="fc-btn" (click)="manualSave()" [disabled]="saveStatus() === 'saved'">
          Uložiť
        </button>
        <button type="button" class="fc-btn fc-btn-icon" (click)="toggleFullscreen()" [title]="isFullscreen() ? 'Zatvoriť fullscreen' : 'Fullscreen'">
          @if (isFullscreen()) { ✕ Zatvoriť } @else { ⛶ Celá obrazovka }
        </button>
      </div>
      <!-- #21 — externá služba sa načíta až po súhlase (spojenie s diagrams.net) -->
      @if (consent.state().externalEmbeds || allowedOnce()) {
        <iframe
          #frame
          [src]="safeEmbedUrl"
          class="flowchart-frame"
          frameborder="0"
          allowfullscreen
        ></iframe>
      } @else {
        <div class="consent-gate">
          <strong>Editor flowchartov je externá služba diagrams.net</strong>
          <p>Pri jeho otvorení sa váš prehliadač spojí so serverom JGraph Ltd. (Spojené kráľovstvo) — uvidí napr. vašu IP adresu
            a môže si ukladať vlastné údaje. Diagram sa upravuje v prehliadači a ukladá sa do Process Base.
            Podrobnosti v <a href="/cookies" target="_blank">zásadách cookies</a>.</p>
          <label><input type="checkbox" [checked]="remember()" (change)="remember.set($any($event.target).checked)"> Zapamätať si moju voľbu</label>
          <button type="button" class="fc-btn primary" (click)="allowEmbed()">Načítať editor</button>
        </div>
      }
    </div>
  `,
  styles: [`
    .flowchart-wrap {
      display: flex;
      flex-direction: column;
      min-height: 560px;
      height: 100%;
    }
    .flowchart-wrap.fullscreen {
      position: fixed;
      inset: 0;
      z-index: 9999;
      background: #fff;
      min-height: 100dvh;
      height: 100dvh;
    }
    .flowchart-toolbar {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 10px;
      background: #f5f5f5;
      border-bottom: 1px solid #ddd;
      flex-shrink: 0;
    }
    .save-status {
      font-size: 12px;
      color: #888;
      margin-right: auto;
    }
    .save-status.saving { color: #f59e0b; }
    .save-status.saved  { color: #22c55e; }
    .fc-btn {
      padding: 4px 12px;
      font-size: 13px;
      border: 1px solid #ccc;
      border-radius: 4px;
      cursor: pointer;
      background: #fff;
    }
    .fc-btn:disabled { opacity: 0.45; cursor: default; }
    .fc-btn:not(:disabled):hover { background: #e8f4ff; }
    .flowchart-frame {
      flex: 1;
      width: 100%;
      border: none;
      min-height: 520px;
    }
    .consent-gate {
      display: grid;
      gap: 10px;
      align-content: center;
      justify-items: start;
      flex: 1;
      max-width: 620px;
      margin: 0 auto;
      padding: 24px;
      font-size: 13.5px;
      line-height: 1.5;
    }
    .consent-gate p { margin: 0; color: #555; }
    .consent-gate a { color: #0e6a78; }
    .consent-gate label { display: flex; gap: 6px; align-items: center; }
    .fc-btn.primary { background: #0e6a78; border-color: #0e6a78; color: #fff; }
  `]
})
export class FlowchartEditorComponent implements OnInit, OnChanges, OnDestroy {
  @Input({ required: true }) xml = '';
  @Output() xmlChange = new EventEmitter<string>();
  @ViewChild('frame') frameRef!: ElementRef<HTMLIFrameElement>;

  readonly safeEmbedUrl: SafeResourceUrl;
  readonly isFullscreen = signal(false);
  readonly saveStatus = signal<'idle' | 'saving' | 'saved'>('saved');

  private listener!: (event: MessageEvent) => void;
  private initialized = false;
  private pendingXml: string | null = null;
  private pendingSave: string | null = null;
  private saveTimer: any = null;

  /** #21 — súhlas len pre toto otvorenie (bez zapamätania) */
  readonly allowedOnce = signal(false);
  readonly remember = signal(true);

  constructor(sanitizer: DomSanitizer, readonly consent: ConsentService) {
    this.safeEmbedUrl = sanitizer.bypassSecurityTrustResourceUrl(`${EMBED_ORIGIN}/?embed=1&proto=json&spin=1&ui=atlas&noSaveBtn=1&saveAndExit=0&noExitBtn=1`);
  }

  allowEmbed(): void {
    if (this.remember()) this.consent.setExternalEmbeds(true);
    this.allowedOnce.set(true);
  }

  ngOnInit(): void {
    this.listener = (event: MessageEvent) => {
      // len správy z vloženého editora — inak by iné okno mohlo podstrčiť diagram na uloženie
      if (event.origin !== EMBED_ORIGIN || event.source !== this.frameRef?.nativeElement?.contentWindow) return;
      if (!event.data || typeof event.data !== 'string') return;
      let msg: any;
      try { msg = JSON.parse(event.data); } catch { return; }

      if (msg.event === 'init') {
        this.initialized = true;
        this.sendLoad(this.pendingXml ?? this.xml);
        this.pendingXml = null;
      } else if (msg.event === 'autosave') {
        if (msg.xml) this.queueSave(msg.xml);
      } else if (msg.event === 'save') {
        if (msg.xml) this.doSave(msg.xml);
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
    clearTimeout(this.saveTimer);
  }

  toggleFullscreen(): void {
    this.isFullscreen.set(!this.isFullscreen());
  }

  @HostListener('document:keydown.escape')
  onEsc(): void {
    if (this.isFullscreen()) this.isFullscreen.set(false);
  }

  manualSave(): void {
    if (this.pendingSave) {
      clearTimeout(this.saveTimer);
      this.doSave(this.pendingSave);
    }
  }

  private queueSave(xml: string): void {
    this.pendingSave = xml;
    this.saveStatus.set('saving');
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.doSave(xml), 1500);
  }

  private doSave(xml: string): void {
    clearTimeout(this.saveTimer);
    this.pendingSave = null;
    this.saveStatus.set('saving');
    this.xmlChange.emit(xml);
    setTimeout(() => this.saveStatus.set('saved'), 600);
  }

  private sendLoad(xml: string): void {
    const frame = this.frameRef?.nativeElement;
    if (!frame?.contentWindow) return;
    frame.contentWindow.postMessage(
      JSON.stringify({ action: 'load', xml: xml || '<mxGraphModel/>', autosave: 1 }),
      // obsah diagramu len editoru diagrams.net, nie inej stránke, keby rámec niekam presmeroval
      EMBED_ORIGIN
    );
    this.saveStatus.set('saved');
  }
}
