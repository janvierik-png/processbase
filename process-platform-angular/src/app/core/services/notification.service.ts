import { HttpClient } from '@angular/common/http';
import { Injectable, signal } from '@angular/core';
import { Observable, tap } from 'rxjs';
import { API_BASE_URL } from './api-url';

/** #38 — upozornenie v aplikácii (z doménovej udalosti). */
export interface AppNotification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  read: boolean;
  createdAt: string;
}

@Injectable({ providedIn: 'root' })
export class NotificationService {
  readonly items = signal<AppNotification[]>([]);
  readonly unread = signal(0);

  constructor(private readonly http: HttpClient) {}

  refresh(): void {
    this.http.get<{ unread: number; items: AppNotification[] }>(`${API_BASE_URL}/me/notifications`).subscribe({
      next: (result) => {
        this.items.set(result.items);
        this.unread.set(result.unread);
      },
      // upozornenia nie sú kritické — výpadok nesmie rozbiť stránku
      error: () => undefined
    });
  }

  markRead(ids?: string[]): Observable<{ marked: number }> {
    return this.http
      .post<{ marked: number }>(`${API_BASE_URL}/me/notifications/read`, ids ? { ids } : { all: true })
      .pipe(tap(() => this.refresh()));
  }
}
