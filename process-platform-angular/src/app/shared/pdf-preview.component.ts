import { Component, EventEmitter, HostListener, Input, OnDestroy, OnInit, Output, signal } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { DocumentService } from '../core/services/document.service';

/**
 * Náhľad PDF v modálnom okne — používa vstavaný prehliadač PDF v prehliadači.
 * Súbor sa načíta cez HttpClient (s prihlasovacím tokenom) a iframe dostane
 * blob URL — priame `src` na API by token neposlalo a skončilo by 401.
 */
@Component({
  selector: 'pp-pdf-preview',
  standalone: true,
  template: `
    <div class="preview-overlay" (click)="onOverlayClick($event)">
      <div class="preview-card" role="dialog" aria-modal="true" [attr.aria-label]="'Náhľad ' + fileName">
        <header class="preview-head">
          <h3>{{ fileName }}</h3>
          <div class="preview-actions">
            <button type="button" class="preview-btn" (click)="download()">Stiahnut</button>
            <button type="button" class="preview-btn" (click)="closed.emit()">Zavriet</button>
          </div>
        </header>
        @if (safeUrl(); as url) {
          <iframe [src]="url" title="Náhľad dokumentu"></iframe>
        } @else {
          <p class="preview-state">{{ error() || 'Načítavam náhľad...' }}</p>
        }
      </div>
    </div>
  `,
  styles: [`
    .preview-overlay {
      position: fixed;
      inset: 0;
      z-index: 200;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      background: rgba(22, 32, 46, .55);
    }

    .preview-card {
      display: flex;
      flex-direction: column;
      width: min(1100px, 100%);
      height: min(90vh, 100%);
      background: #fff;
      border-radius: var(--r-lg, 14px);
      box-shadow: 0 24px 64px rgba(22, 32, 46, .28);
      overflow: hidden;
    }

    .preview-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 12px 16px;
      border-bottom: 1px solid var(--line, #e2e7ef);
      flex-shrink: 0;
    }

    .preview-head h3 {
      margin: 0;
      font-size: 15px;
      font-weight: 620;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .preview-actions { display: flex; gap: 8px; flex-shrink: 0; }

    .preview-btn {
      display: inline-flex;
      align-items: center;
      min-height: 32px;
      padding: 0 12px;
      border: 1px solid var(--line-strong, #cdd5e1);
      border-radius: var(--r-sm, 6px);
      background: #fff;
      color: var(--ink-soft, #3d4a5c);
      font-size: 13px;
      text-decoration: none;
      cursor: pointer;
    }

    .preview-btn:hover { background: var(--surface-alt, #f8fafc); color: var(--ink, #16202e); }

    .preview-state {
      flex: 1;
      display: grid;
      place-items: center;
      margin: 0;
      color: var(--muted, #6b7789);
      background: var(--surface-alt, #f8fafc);
    }

    iframe {
      flex: 1;
      width: 100%;
      border: 0;
      background: var(--surface-alt, #f8fafc);
    }
  `]
})
export class PdfPreviewComponent implements OnInit, OnDestroy {
  @Input({ required: true }) fileName = '';
  @Input({ required: true }) documentId = '';

  @Output() closed = new EventEmitter<void>();

  readonly safeUrl = signal<SafeResourceUrl | null>(null);
  readonly error = signal('');
  private objectUrl: string | null = null;

  constructor(
    private readonly sanitizer: DomSanitizer,
    private readonly documents: DocumentService
  ) {}

  ngOnInit(): void {
    // ?inline=1 — server posle Content-Disposition inline, typ zostane application/pdf
    this.documents.fetchFile(this.documentId, true).subscribe({
      next: (blob) => {
        this.objectUrl = URL.createObjectURL(blob);
        this.safeUrl.set(this.sanitizer.bypassSecurityTrustResourceUrl(this.objectUrl));
      },
      error: () => this.error.set('Náhľad sa nepodarilo načítať.')
    });
  }

  ngOnDestroy(): void {
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
  }

  download(): void {
    this.documents.download(this.documentId, this.fileName).subscribe({
      error: () => this.error.set('Súbor sa nepodarilo stiahnuť.')
    });
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.closed.emit();
  }

  onOverlayClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) this.closed.emit();
  }
}
