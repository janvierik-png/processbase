import { AfterViewInit, Component, ElementRef, HostListener, OnDestroy, ViewChild, signal } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import BpmnModeler from 'bpmn-js/lib/Modeler';
import { BpmnPropertiesPanelModule, BpmnPropertiesProviderModule } from 'bpmn-js-properties-panel';
import camundaModdleDescriptors from 'camunda-bpmn-moddle/resources/camunda.json';
import { AuthService } from '../../core/services/auth.service';

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
  imports: [RouterLink],
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

  constructor(
    private readonly title: Title,
    readonly auth: AuthService
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
    this.dirty.set(false);
    this.restoredAt.set(null);
    this.clearDraft();
    this.message.set(null);
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

  renameFile(value: string): void {
    this.fileName.set(normalizeFileName(value));
  }

  toggleProperties(): void {
    this.propertiesOpen.update((open) => !open);
    // plátno zmenilo šírku — bpmn-js si ju musí prepočítať
    setTimeout(() => (this.modeler?.get('canvas') as { resized: () => void } | undefined)?.resized(), 0);
  }

  fitViewport(): void {
    (this.modeler?.get('canvas') as { zoom: (level: string) => void } | undefined)?.zoom('fit-viewport');
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
