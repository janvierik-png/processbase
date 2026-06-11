import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { OrgPosition, User } from '../../core/models/user.model';
import { AuthService } from '../../core/services/auth.service';
import { PositionService } from '../../core/services/position.service';

@Component({
  selector: 'pp-positions-page',
  standalone: true,
  imports: [FormsModule, RouterLink],
  templateUrl: './positions-page.component.html',
  styleUrl: './positions-page.component.scss'
})
export class PositionsPageComponent implements OnInit {
  readonly positions = signal<OrgPosition[]>([]);
  readonly users = signal<User[]>([]);
  readonly error = signal<string | null>(null);

  model = { name: '', description: '' };
  editingId: string | null = null;
  assignModel: Record<string, string> = {};

  constructor(
    private readonly positionsApi: PositionService,
    private readonly auth: AuthService
  ) {}

  ngOnInit(): void {
    this.reload();
  }

  reload(): void {
    this.positionsApi.list().subscribe({
      next: (positions) => this.positions.set(positions),
      error: () => this.error.set('Pozicie sa nepodarilo nacitat.')
    });
    this.auth.organizationUsers().subscribe({
      next: (users) => this.users.set(users),
      error: () => undefined
    });
  }

  save(): void {
    if (!this.model.name.trim()) return;
    const done = () => {
      this.model = { name: '', description: '' };
      this.editingId = null;
      this.reload();
    };
    if (this.editingId) {
      this.positionsApi.update(this.editingId, this.model).subscribe({
        next: done,
        error: (error) => this.error.set(error?.error?.message ?? 'Poziciu sa nepodarilo ulozit.')
      });
    } else {
      this.positionsApi.create(this.model.name, this.model.description).subscribe({
        next: done,
        error: (error) => this.error.set(error?.error?.message ?? 'Poziciu sa nepodarilo vytvorit.')
      });
    }
  }

  edit(position: OrgPosition): void {
    this.editingId = position.id;
    this.model = { name: position.name, description: position.description };
  }

  remove(position: OrgPosition): void {
    if (!window.confirm(`Vymazat poziciu ${position.name}?`)) return;
    this.positionsApi.remove(position.id).subscribe({
      next: () => this.reload(),
      error: () => this.error.set('Poziciu sa nepodarilo vymazat.')
    });
  }

  assign(user: User): void {
    const positionId = this.assignModel[user.id];
    if (!positionId) return;
    this.positionsApi.assign(user.id, positionId).subscribe({
      next: () => {
        this.assignModel[user.id] = '';
        this.reload();
      },
      error: () => this.error.set('Priradenie sa nepodarilo.')
    });
  }

  unassign(user: User, positionId: string): void {
    this.positionsApi.unassign(user.id, positionId).subscribe({
      next: () => this.reload(),
      error: () => this.error.set('Odobratie pozicie sa nepodarilo.')
    });
  }

  availablePositions(user: User): OrgPosition[] {
    const assigned = new Set((user.positions ?? []).map((position) => position.id));
    return this.positions().filter((position) => !assigned.has(position.id));
  }
}
