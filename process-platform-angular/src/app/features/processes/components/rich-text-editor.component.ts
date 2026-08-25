import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  ViewChild,
  signal
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { htmlToMarkdown, markdownToHtml } from '../../../core/utils/markdown';

type Mode = 'rich' | 'markdown';

/**
 * Editor dokumentácie procesu. Navonok pracuje vždy s Markdownom —
 * ten sa aj ukladá do databázy. Používateľ si môže vybrať, či text píše
 * formátovane (WYSIWYG) alebo priamo ako Markdown.
 */
@Component({
  selector: 'pp-rich-text-editor',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './rich-text-editor.component.html',
  styleUrl: './rich-text-editor.component.scss'
})
export class RichTextEditorComponent implements OnChanges, AfterViewInit {
  /** Obsah v Markdown formáte. */
  @Input() value = '';
  @Output() valueChange = new EventEmitter<string>();

  @ViewChild('editable') editableRef?: ElementRef<HTMLDivElement>;

  readonly mode = signal<Mode>('rich');

  /** Text v Markdown režime (textarea). */
  markdownDraft = '';

  /** Bránime prepísaniu obsahu, kým používateľ píše — inak by skákal kurzor. */
  private selfChange = false;

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes['value']) return;
    if (this.selfChange) {
      this.selfChange = false;
      return;
    }
    this.markdownDraft = this.value ?? '';
    // pri prvom volani este nemusi existovat ViewChild — doriesi ngAfterViewInit
    this.renderIntoEditable();
  }

  ngAfterViewInit(): void {
    this.renderIntoEditable();
  }

  setMode(mode: Mode): void {
    if (this.mode() === mode) return;

    if (mode === 'markdown') {
      // z WYSIWYG do zdrojaku — preved aktualny obsah
      this.markdownDraft = this.readEditableAsMarkdown();
    }
    this.mode.set(mode);

    if (mode === 'rich') {
      this.value = this.markdownDraft;
      setTimeout(() => this.renderIntoEditable());
    }
  }

  // --- WYSIWYG rezim ---

  format(command: string, argument?: string): void {
    this.editableRef?.nativeElement.focus();
    document.execCommand(command, false, argument);
    this.onEditableInput();
  }

  insertLink(): void {
    const url = window.prompt('Adresa odkazu', 'https://');
    if (!url) return;
    this.format('createLink', url);
  }

  onEditableInput(): void {
    const markdown = this.readEditableAsMarkdown();
    this.markdownDraft = markdown;
    this.emit(markdown);
  }

  /** Vloz cisty text — bez formatovania z Wordu ci webu. */
  onPaste(event: ClipboardEvent): void {
    event.preventDefault();
    const text = event.clipboardData?.getData('text/plain') ?? '';
    document.execCommand('insertText', false, text);
    this.onEditableInput();
  }

  // --- Markdown rezim ---

  onMarkdownInput(): void {
    this.emit(this.markdownDraft);
  }

  private emit(markdown: string): void {
    this.selfChange = true;
    this.value = markdown;
    this.valueChange.emit(markdown);
  }

  private readEditableAsMarkdown(): string {
    const element = this.editableRef?.nativeElement;
    return element ? htmlToMarkdown(element.innerHTML) : this.markdownDraft;
  }

  private renderIntoEditable(): void {
    const element = this.editableRef?.nativeElement;
    if (element) element.innerHTML = markdownToHtml(this.value ?? '');
  }
}
