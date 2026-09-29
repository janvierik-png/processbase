import { Component, OnDestroy, OnInit, signal } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { AppNotification, NotificationService } from '../../core/services/notification.service';
import { StorageService } from '../../core/services/storage.service';
import { TranslationService } from '../../core/services/translation.service';
import { LanguageCode } from '../../core/models/translation.model';

@Component({
  selector: 'pp-workspace-shell',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './workspace-shell.component.html',
  styleUrl: './workspace-shell.component.scss'
})
export class WorkspaceShellComponent implements OnInit, OnDestroy {
  readonly collapsed = signal(this.storage.readString('ngNavCollapsed', '0') === '1');
  readonly resendState = signal<'idle' | 'sending' | 'sent'>('idle');
  /** #38 — panel upozornení */
  readonly notificationsOpen = signal(false);
  private notificationTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    readonly auth: AuthService,
    readonly i18n: TranslationService,
    readonly notifications: NotificationService,
    private readonly storage: StorageService,
    private readonly router: Router
  ) {}

  ngOnInit(): void {
    this.notifications.refresh();
    // bez push kanála: raz za minútu stačí (udalosti nie sú urgentné)
    this.notificationTimer = setInterval(() => this.notifications.refresh(), 60_000);
  }

  ngOnDestroy(): void {
    if (this.notificationTimer) clearInterval(this.notificationTimer);
  }

  toggleNotifications(): void {
    const open = !this.notificationsOpen();
    this.notificationsOpen.set(open);
    if (open) this.notifications.refresh();
  }

  openNotification(item: AppNotification): void {
    this.notificationsOpen.set(false);
    if (!item.read) this.notifications.markRead([item.id]).subscribe({ error: () => undefined });
    // odkaz je vždy cesta v aplikácii (zostavuje ho server), nie cudzia adresa
    if (item.link?.startsWith('/app/')) this.router.navigateByUrl(item.link);
  }

  markAllRead(): void {
    this.notifications.markRead().subscribe({ error: () => undefined });
  }

  /** #35 — hľadanie z hornej lišty vedie na stránku výsledkov (bez odoslania formulára). */
  search(event: Event, query: string): void {
    event.preventDefault();
    const q = query.trim();
    if (q) this.router.navigate(['/app/hladat'], { queryParams: { q } });
  }

  localDay(iso: string): string {
    return new Date(iso).toLocaleDateString('sv-SE');
  }

  setLanguage(value: string): void {
    this.i18n.setLanguage(value as LanguageCode);
  }

  /** #20 — nový overovací odkaz (predchádzajúci tým prestane platiť). */
  resendVerification(): void {
    this.resendState.set('sending');
    this.auth.resendVerification().subscribe({
      next: (result) => {
        if (result.alreadyVerified) this.auth.markEmailVerified();
        this.resendState.set('sent');
      },
      error: () => this.resendState.set('idle')
    });
  }

  toggleCollapse(): void {
    const next = !this.collapsed();
    this.collapsed.set(next);
    this.storage.writeString('ngNavCollapsed', next ? '1' : '0');
  }

  userInitials(): string {
    const name = this.auth.currentUser()?.name ?? '';
    return name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('') || '?';
  }
}
