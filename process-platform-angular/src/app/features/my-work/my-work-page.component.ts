import { Component, OnInit, computed, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MyWork } from '../../core/models/process.model';
import { ProcessStoreService } from '../../core/services/process-store.service';

type WorkItem = MyWork['processes'][number];

/**
 * Moja práca (#33 UX-01a): postupy podľa miest, ktoré dnes zastávam — kto
 * nastúpi na miesto, vidí jeho procesy hneď, kto odíde, už nie. Pri každom
 * procese je zdroj zodpovednosti (miesto a rola).
 */
@Component({
  selector: 'pp-my-work-page',
  standalone: true,
  imports: [NgTemplateOutlet, RouterLink],
  templateUrl: './my-work-page.component.html',
  styleUrl: './my-work-page.component.scss'
})
export class MyWorkPageComponent implements OnInit {
  readonly work = signal<MyWork | null>(null);
  readonly error = signal('');

  /** zodpovedám = som vlastník procesu; vykonávam = len vykonávateľ */
  readonly owned = computed(() => (this.work()?.processes ?? []).filter((item) => item.roles.some((role) => role.role === 'OWNER')));
  readonly performed = computed(() => (this.work()?.processes ?? []).filter((item) => !item.roles.some((role) => role.role === 'OWNER')));
  readonly reviews = computed(() => this.owned().filter((item) => item.review));
  readonly unpublished = computed(() => this.owned().filter((item) => !item.effective));

  constructor(private readonly store: ProcessStoreService) {}

  ngOnInit(): void {
    this.store.myWork().subscribe({
      next: (work) => this.work.set(work),
      error: () => this.error.set('Prehľad sa nepodarilo načítať.')
    });
  }

  roleLabel(role: 'OWNER' | 'PERFORMER'): string {
    return role === 'OWNER' ? 'vlastník' : 'vykonávateľ';
  }

  sources(item: WorkItem): string {
    return item.roles.map((role) => `${role.positionName} (${this.roleLabel(role.role)})`).join(', ');
  }

  positionNames(): string {
    return (this.work()?.positions ?? []).map((position) => position.name).join(', ');
  }
}
