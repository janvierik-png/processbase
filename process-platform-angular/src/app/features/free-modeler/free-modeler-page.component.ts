import { AfterViewInit, Component, ElementRef, HostListener, OnDestroy, ViewChild, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Title } from '@angular/platform-browser';
import { Router, RouterLink } from '@angular/router';
import { OrgPosition } from '../../core/models/user.model';
import { PositionService } from '../../core/services/position.service';
import { ProcessStoreService } from '../../core/services/process-store.service';
import BpmnModeler from 'bpmn-js/lib/Modeler';
import { BpmnPropertiesPanelModule, BpmnPropertiesProviderModule } from 'bpmn-js-properties-panel';
import camundaModdleDescriptors from 'camunda-bpmn-moddle/resources/camunda.json';
import { AuthService } from '../../core/services/auth.service';
import { Orientation, PaperSize, PrintMode, PrintPlan, planPrint, printDocument, printPages, svgBox, svgDataUrl } from '../../core/utils/diagram-print';

/** Najväčší súbor, ktorý modeler otvorí — väčšie diagramy prehliadač nezvládne plynulo. */
const MAX_FILE_BYTES = 10 * 1024 * 1024;
/** Rozpracovaný diagram len v tomto prehliadači — nič sa neposiela na server. */
const DRAFT_KEY = 'pbFreeModelerDraft';

type Draft = { xml: string; fileName: string; savedAt: string };

/**
 * Bezplatný BPMN modeler Process Base (#24 FREE-01).
 *
 * Verejná stránka bez účtu postavená na knižnici bpmn-js. Diagram sa otvára
 * a ukladá lokálne v prehliadači — obsah sa na server neposiela. Znak bpmn.io
 * musí podľa licencie bpmn-js zostať plne viditeľný a neprekrytý.
 *
 * Nie je to „Camunda Modeler" (samostatný produkt Camundy). Camunda moddle
 * je načítané len preto, aby sa pri uložení nestratili Camunda atribúty
 * z diagramov vytvorených inde.
 */
@Component({
  selector: 'pp-free-modeler-page',
  standalone: true,
  imports: [FormsModule, RouterLink],
  templateUrl: './free-modeler-page.component.html',
  styleUrl: './free-modeler-page.component.scss'
})
export class FreeModelerPageComponent implements AfterViewInit, OnDestroy {
  @ViewChild('canvas', { static: true }) canvasRef!: ElementRef<HTMLElement>;
  @ViewChild('properties', { static: true }) propertiesRef!: ElementRef<HTMLElement>;
  @ViewChild('fileInput', { static: true }) fileInputRef!: ElementRef<HTMLInputElement>;

  readonly fileName = signal('diagram.bpmn');
  readonly dirty = signal(false);
  readonly message = signal<{ kind: 'info' | 'warn' | 'error'; text: string } | null>(null);
  readonly propertiesOpen = signal(false);
  readonly dragOver = signal(false);
  readonly restoredAt = signal<string | null>(null);

  private modeler?: BpmnModeler;
  private importing = false;
  private draftTimer?: ReturnType<typeof setTimeout>;

  // --- #39 LINK-01: import do workspace ako návrh ---
  readonly importOpen = signal(false);
  readonly importError = signal('');
  readonly importing$ = signal(false);
  readonly positions = signal<OrgPosition[]>([]);
  importModel = { name: '', purpose: '', ownerPositionId: '', newPositionName: '' };
  /** text súboru tak, ako bol otvorený — kým sa nezmení, importuje sa bajt po bajte */
  private originalXml: string | null = null;

  constructor(
    private readonly title: Title,
    readonly auth: AuthService,
    private readonly router: Router,
    private readonly processes: ProcessStoreService,
    private readonly positionsApi: PositionService
  ) {
    this.title.setTitle('Bezplatný BPMN modeler | Process Base');
  }

  async ngAfterViewInit(): Promise<void> {
    this.modeler = new BpmnModeler({
      container: this.canvasRef.nativeElement,
      propertiesPanel: { parent: this.propertiesRef.nativeElement },
      additionalModules: [BpmnPropertiesPanelModule, BpmnPropertiesProviderModule],
      moddleExtensions: { camunda: camundaModdleDescriptors }
    });

    this.modeler.on('commandStack.changed', () => {
      if (this.importing) return;
      this.originalXml = null; // diagram sa zmenil — importuje sa aktuálny stav
      this.dirty.set(true);
      this.scheduleDraft();
    });

    const draft = this.readDraft();
    if (draft) {
      const ok = await this.load(draft.xml, draft.fileName);
      if (ok) {
        this.restoredAt.set(draft.savedAt);
        this.dirty.set(true);
        return;
      }
    }
    await this.newDiagram(false);
  }

  ngOnDestroy(): void {
    clearTimeout(this.draftTimer);
    this.modeler?.destroy();
    this.title.setTitle('Processbase');
  }

  /** Neuložené zmeny — prehliadač sa pred zatvorením opýta. */
  @HostListener('window:beforeunload', ['$event'])
  onBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.dirty()) event.preventDefault();
  }

  // --- nový, otvoriť ---

  async newDiagram(confirmLoss = true): Promise<void> {
    if (confirmLoss && !this.confirmDiscard()) return;
    this.importing = true;
    try {
      await this.modeler!.createDiagram();
      this.fitViewport();
    } finally {
      this.importing = false;
    }
    this.fileName.set('diagram.bpmn');
    this.originalXml = null;
    this.dirty.set(false);
    this.restoredAt.set(null);
    this.clearDraft();
    this.message.set(null);
  }

  // --- #39 import do Process Base ---

  /**
   * Neprihlásený ide cez prihlásenie a vráti sa sem — diagram na neho počká
   * v tomto prehliadači. Prihlásený vyplní minimum a vznikne NÁVRH procesu.
   */
  async openImport(): Promise<void> {
    if (!this.auth.isAuthenticated()) {
      await this.saveDraftNow();
      this.dirty.set(false); // záloha je uložená, netreba sa pýtať pri odchode
      void this.router.navigate(['/'], { queryParams: { auth: 'login', return: '/bpmn-modeler' } });
      return;
    }
    if (!this.auth.can('process:write')) {
      this.message.set({ kind: 'warn', text: 'Na vytváranie procesov nemáte vo firme oprávnenie. Diagram si môžete stiahnuť ako .bpmn.' });
      return;
    }
    this.importError.set('');
    this.importModel = { name: this.diagramName(), purpose: '', ownerPositionId: '', newPositionName: '' };
    this.positionsApi.list().subscribe({ next: (positions) => this.positions.set(positions), error: () => this.positions.set([]) });
    this.importOpen.set(true);
  }

  get canCreatePosition(): boolean {
    return this.auth.can('organization:write');
  }

  async submitImport(): Promise<void> {
    const { name, purpose, ownerPositionId, newPositionName } = this.importModel;
    if (!name.trim() || !purpose.trim() || (!ownerPositionId && !newPositionName.trim())) {
      this.importError.set('Vyplňte názov, účel a vlastníka procesu.');
      return;
    }
    // nezmenený otvorený súbor ide bez zmeny; inak aktuálny stav modelera
    const bpmnXml = this.originalXml ?? (await this.modeler!.saveXML({ format: true })).xml ?? '';
    this.importing$.set(true);
    this.processes.importBpmn({
      bpmnXml,
      name: name.trim(),
      purpose: purpose.trim(),
      ownerPositionId: ownerPositionId || undefined,
      newPositionName: ownerPositionId ? undefined : newPositionName.trim(),
      sourceFileName: this.fileName()
    }).subscribe({
      next: (process) => {
        this.importing$.set(false);
        this.dirty.set(false);
        this.clearDraft();
        void this.router.navigate(['/app/processes', process.id]);
      },
      error: (error) => {
        this.importing$.set(false);
        this.importError.set(error?.error?.message ?? 'Proces sa nepodarilo vytvoriť.');
      }
    });
  }

  /** Návrh názvu: názov procesu alebo bazéna v diagrame, inak názov súboru. */
  private diagramName(): string {
    const definitions = (this.modeler as unknown as { getDefinitions: () => any })?.getDefinitions?.();
    const roots: any[] = definitions?.rootElements ?? [];
    const named = roots.find((root) => root.$type === 'bpmn:Process' && root.name)
      ?? roots.flatMap((root) => root.participants ?? []).find((participant: any) => participant.name);
    return (named?.name ?? this.fileName().replace(/\.(bpmn|xml)$/i, '')).trim();
  }

  private async saveDraftNow(): Promise<void> {
    const { xml } = await this.modeler!.saveXML();
    if (!xml) return;
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ xml, fileName: this.fileName(), savedAt: new Date().toISOString() } satisfies Draft));
    } catch {
      // bez úložiska sa diagram po prihlásení neobnoví — používateľ ho má stále ako súbor
    }
  }

  chooseFile(): void {
    this.fileInputRef.nativeElement.click();
  }

  async onFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) await this.openFile(file);
  }

  onDragOver(event: DragEvent): void {
    if (!event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault();
    this.dragOver.set(true);
  }

  onDragLeave(): void {
    this.dragOver.set(false);
  }

  async onDrop(event: DragEvent): Promise<void> {
    event.preventDefault();
    this.dragOver.set(false);
    const file = event.dataTransfer?.files?.[0];
    if (file) await this.openFile(file);
  }

  async openFile(file: File): Promise<void> {
    if (file.size > MAX_FILE_BYTES) {
      this.message.set({ kind: 'error', text: `Súbor má ${(file.size / 1024 / 1024).toFixed(1)} MB — modeler otvorí najviac 10 MB.` });
      return;
    }
    const text = await file.text();
    const problem = checkBpmnText(text);
    if (problem) {
      this.message.set({ kind: 'error', text: problem });
      return;
    }
    if (!this.confirmDiscard()) return;
    if (await this.load(text, file.name)) {
      this.originalXml = text;
      this.dirty.set(false);
      this.restoredAt.set(null);
      this.clearDraft();
    }
  }

  private async load(xml: string, fileName: string): Promise<boolean> {
    this.importing = true;
    try {
      const { warnings } = await this.modeler!.importXML(xml);
      this.fitViewport();
      this.fileName.set(normalizeFileName(fileName));
      this.message.set(warnings.length
        ? { kind: 'warn', text: `Diagram je otvorený, ${warnings.length} prvkov sa však nepodarilo zobraziť. Pri uložení zostanú v XML nezmenené, ak ich neupravíte.` }
        : null);
      return true;
    } catch (error) {
      this.message.set({ kind: 'error', text: `Súbor sa nepodarilo otvoriť ako BPMN 2.0: ${describeError(error)}` });
      return false;
    } finally {
      this.importing = false;
    }
  }

  // --- uložiť, exportovať ---

  async downloadBpmn(): Promise<void> {
    const { xml } = await this.modeler!.saveXML({ format: true });
    if (!xml) return;
    saveFile(new Blob([xml], { type: 'application/xml' }), this.fileName());
    this.dirty.set(false);
    this.message.set({ kind: 'info', text: `Uložené do počítača ako ${this.fileName()}.` });
  }

  async downloadSvg(): Promise<void> {
    const { svg } = await this.modeler!.saveSVG();
    saveFile(new Blob([svg], { type: 'image/svg+xml' }), this.fileName().replace(/\.(bpmn|xml)$/i, '') + '.svg');
  }

  // --- #25 FREE-02 tlač s voľbou orientácie a delením na strany ---

  readonly printOpen = signal(false);
  readonly printPlan = signal<PrintPlan | null>(null);
  /** strany ako obrázky (data URL) — náhľad aj tlač */
  readonly printPreview = signal<Array<{ url: string; widthPct: number }>>([]);
  printOptions: { paper: PaperSize; orientation: Orientation; mode: PrintMode } = { paper: 'A4', orientation: 'landscape', mode: 'auto' };
  private printSvg = '';
  private printPageSvgs: string[] = [];

  async openPrint(): Promise<void> {
    this.printSvg = (await this.modeler!.saveSVG()).svg;
    this.printOpen.set(true);
    this.updatePrint();
  }

  updatePrint(): void {
    if (!this.printSvg) return;
    const box = svgBox(this.printSvg);
    const plan = planPrint(box, this.printOptions.paper, this.printOptions.orientation, this.printOptions.mode);
    this.printPageSvgs = printPages(this.printSvg, plan, box);
    this.printPlan.set(plan);
    // náhľad v skutočnom pomere k strane — malý diagram sa nesmie tváriť, že vyplní celý papier
    const pageWidth = Math.round(box.width * plan.scale);
    this.printPreview.set(this.printPageSvgs.map((svg) => ({
      url: svgDataUrl(svg),
      widthPct: plan.columns * plan.rows > 1 ? 100 : Math.min(100, (pageWidth / plan.pageWidth) * 100)
    })));
  }

  pagesLabel(plan: PrintPlan): string {
    const count = plan.columns * plan.rows;
    if (count === 1) return '1 strana';
    return `${count} ${count <= 4 ? 'strany' : 'strán'} (${plan.rows} × ${plan.columns})`;
  }

  /** Tlač cez skrytý rámec bez skriptov — dialóg tlače prehliadača. */
  print(): void {
    const plan = this.printPlan();
    if (!plan) return;
    const frame = document.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-same-origin allow-modals');
    frame.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0;';
    frame.srcdoc = printDocument(this.printPageSvgs, plan, this.fileName().replace(/\.(bpmn|xml)$/i, ''), this.printOptions.paper, this.printOptions.orientation);
    frame.onload = () => {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
      setTimeout(() => frame.remove(), 60_000);
    };
    document.body.appendChild(frame);
  }

  renameFile(value: string): void {
    this.fileName.set(normalizeFileName(value));
  }

  toggleProperties(): void {
    this.propertiesOpen.update((open) => !open);
    // plátno zmenilo šírku — bpmn-js si ju musí prepočítať
    setTimeout(() => (this.modeler?.get('canvas') as { resized: () => void } | undefined)?.resized(), 0);
  }

  fitViewport(): void {
    try {
      (this.modeler?.get('canvas') as { zoom: (level: string) => void } | undefined)?.zoom('fit-viewport');
    } catch {
      // plátno ešte nemá rozmer (okno na pozadí, skrytá karta) — diagram je načítaný,
      // len sa neprispôsobil; nesmie to vyzerať ako chybný súbor
    }
  }

  discardRestored(): void {
    void this.newDiagram(false);
  }

  // --- lokálna záloha rozpracovaného diagramu ---

  private scheduleDraft(): void {
    clearTimeout(this.draftTimer);
    this.draftTimer = setTimeout(async () => {
      const { xml } = await this.modeler!.saveXML();
      if (!xml) return;
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify({ xml, fileName: this.fileName(), savedAt: new Date().toISOString() } satisfies Draft));
      } catch {
        // plné alebo zakázané úložisko — záloha je len pohodlie, diagram ostáva v okne
      }
    }, 800);
  }

  private readDraft(): Draft | null {
    try {
      const draft = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null') as Draft | null;
      return draft?.xml ? draft : null;
    } catch {
      return null;
    }
  }

  private clearDraft(): void {
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {
      // bez úložiska nie je čo mazať
    }
  }

  private confirmDiscard(): boolean {
    return !this.dirty() || window.confirm('Diagram má neuložené zmeny. Zahodiť ich?\n\nAk ich chcete zachovať, najprv ho stiahnite ako .bpmn.');
  }
}

/**
 * Rýchla kontrola pred parsovaním: BPMN 2.0 koreň a žiadne DTD/entity
 * (ochrana pred „XML bombou" — BPMN ich nepotrebuje).
 */
export function checkBpmnText(text: string): string | null {
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) return 'Súbor obsahuje DTD alebo entity — BPMN 2.0 ich nepoužíva, z bezpečnostných dôvodov sa neotvorí.';
  if (!/<([\w-]+:)?definitions[\s>]/.test(text)) return 'Súbor nevyzerá ako BPMN 2.0 (chýba koreňový prvok definitions).';
  if (!text.includes('http://www.omg.org/spec/BPMN/20100524/MODEL')) return 'Súbor nepoužíva menný priestor BPMN 2.0.';
  return null;
}

function normalizeFileName(value: string): string {
  const base = value.trim().replace(/[\\/:*?"<>|]+/g, '-').slice(0, 120) || 'diagram';
  return /\.(bpmn|xml)$/i.test(base) ? base : `${base}.bpmn`;
}

function describeError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.split('\n')[0].slice(0, 200);
}

function saveFile(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
