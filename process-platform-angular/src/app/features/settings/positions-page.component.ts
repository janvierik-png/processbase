import { Component, OnInit, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { OrgPosition, OrgUnit, User } from '../../core/models/user.model';
import { AuthService } from '../../core/services/auth.service';
import { PositionService } from '../../core/services/position.service';

type UnitGroup = { unitId: string | null; unitName: string; positions: OrgPosition[] };

@Component({
  selector: 'pp-positions-page',
  standalone: true,
  imports: [FormsModule, RouterLink],
  templateUrl: './positions-page.component.html',
  styleUrl: './positions-page.component.scss'
})
export class PositionsPageComponent implements OnInit {
  readonly positions = signal<OrgPosition[]>([]);
  readonly units = signal<OrgUnit[]>([]);
  readonly users = signal<User[]>([]);
  readonly error = signal<string | null>(null);

  model = { name: '', description: '', unitId: '' };
  editingId: string | null = null;

  unitModel = { name: '', description: '' };
  editingUnitId: string | null = null;

  assignModel: Record<string, string> = {};

  // pozicie zoskupene podla organizacnej zlozky
  readonly groupedPositions = computed<UnitGroup[]>(() => {
    const groups: UnitGroup[] = this.units().map((unit) => ({
      unitId: unit.id,
      unitName: unit.name,
      positions: this.positions().filter((position) => position.unitId === unit.id)
    }));
    const unassigned = this.positions().filter((position) => !position.unitId);
    if (unassigned.length > 0) {
      groups.push({ unitId: null, unitName: 'Bez zaradenia', positions: unassigned });
    }
    return groups;
  });

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
    this.positionsApi.listUnits().subscribe({
      next: (units) => this.units.set(units),
      error: () => undefined
    });
    this.auth.organizationUsers().subscribe({
      next: (users) => this.users.set(users),
      error: () => undefined
    });
  }

  // --- organizacne zlozky ---

  saveUnit(): void {
    if (!this.unitModel.name.trim()) return;
    const done = () => {
      this.unitModel = { name: '', description: '' };
      this.editingUnitId = null;
      this.error.set(null);
      this.reload();
    };
    if (this.editingUnitId) {
      this.positionsApi.updateUnit(this.editingUnitId, this.unitModel).subscribe({
        next: done,
        error: (error) => this.error.set(error?.error?.message ?? 'Zlozku sa nepodarilo ulozit.')
      });
    } else {
      this.positionsApi.createUnit(this.unitModel.name, this.unitModel.description).subscribe({
        next: done,
        error: (error) => this.error.set(error?.error?.message ?? 'Zlozku sa nepodarilo vytvorit.')
      });
    }
  }

  editUnit(unit: OrgUnit): void {
    this.editingUnitId = unit.id;
    this.unitModel = { name: unit.name, description: unit.description };
  }

  cancelUnitEdit(): void {
    this.editingUnitId = null;
    this.unitModel = { name: '', description: '' };
  }

  removeUnit(unit: OrgUnit): void {
    const note = unit.positionCount > 0
      ? `\n\nPozicie (${unit.positionCount}) ostanu zachovane, len stratia zaradenie.`
      : '';
    if (!window.confirm(`Vymazat zlozku ${unit.name}?${note}`)) return;
    this.positionsApi.removeUnit(unit.id).subscribe({
      next: () => this.reload(),
      error: () => this.error.set('Zlozku sa nepodarilo vymazat.')
    });
  }

  // --- pozicie ---

  save(): void {
    if (!this.model.name.trim()) return;
    const done = () => {
      this.model = { name: '', description: '', unitId: '' };
      this.editingId = null;
      this.error.set(null);
      this.reload();
    };
    if (this.editingId) {
      this.positionsApi.update(this.editingId, {
        name: this.model.name,
        description: this.model.description,
        unitId: this.model.unitId || null
      }).subscribe({
        next: done,
        error: (error) => this.error.set(error?.error?.message ?? 'Poziciu sa nepodarilo ulozit.')
      });
    } else {
      this.positionsApi.create(this.model.name, this.model.description, this.model.unitId || null).subscribe({
        next: done,
        error: (error) => this.error.set(error?.error?.message ?? 'Poziciu sa nepodarilo vytvorit.')
      });
    }
  }

  edit(position: OrgPosition): void {
    this.editingId = position.id;
    this.model = { name: position.name, description: position.description, unitId: position.unitId ?? '' };
  }

  cancelEdit(): void {
    this.editingId = null;
    this.model = { name: '', description: '', unitId: '' };
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

  positionLabel(position: OrgPosition): string {
    return position.unitName ? `${position.unitName} — ${position.name}` : position.name;
  }
}
