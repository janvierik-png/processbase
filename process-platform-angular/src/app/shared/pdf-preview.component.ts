import { Component, EventEmitter, HostListener, Input, Output } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';

/**
 * Náhľad PDF v modálnom okne — používa vstavaný prehliadač PDF v prehliadači.
 * Súbor sa ťahá z `/api/documents/:id/download?inline=1`, takže sa zobrazí
 * priamo namiesto stiahnutia.
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
            <a class="preview-btn" [href]="downloadUrl" [attr.download]="fileName">Stiahnut</a>
            <button type="button" class="preview-btn" (click)="closed.emit()">Zavriet</button>
          </div>
        </header>
        <iframe [src]="safeUrl" title="Náhľad dokumentu"></iframe>
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

    iframe {
      flex: 1;
      width: 100%;
      border: 0;
      background: var(--surface-alt, #f8fafc);
    }
  `]
})
export class PdfPreviewComponent {
  @Input({ required: true }) fileName = '';
  @Input({ required: true }) downloadUrl = '';

  /** URL s ?inline=1 — bez neho by prehliadač súbor stiahol namiesto zobrazenia. */
  @Input({ required: true })
  set previewUrl(value: string) {
    this.safeUrl = this.sanitizer.bypassSecurityTrustResourceUrl(value);
  }

  @Output() closed = new EventEmitter<void>();

  safeUrl: SafeResourceUrl | null = null;

  constructor(private readonly sanitizer: DomSanitizer) {}

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.closed.emit();
  }

  onOverlayClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) this.closed.emit();
  }
}
