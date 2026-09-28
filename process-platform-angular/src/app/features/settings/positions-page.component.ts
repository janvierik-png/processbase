import { Component, OnInit, computed, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { JobDescriptionVersion, JobProfile, JobVersionStatus, OrgPosition, OrgUnit, Person, PositionHolder } from '../../core/models/user.model';
import { OrganizationService } from '../../core/services/organization.service';
import { PositionService } from '../../core/services/position.service';
import { markdownToHtml } from '../../core/utils/markdown';
import { flattenTree, subtreeIds } from '../../core/utils/tree';
import { RichTextEditorComponent } from '../processes/components/rich-text-editor.component';

type Tab = 'structure' | 'people' | 'profiles';

// miestny den pouzivatela (toISOString by dal UTC — po polnoci este vcerajsok)
const todayIso = () => new Date().toLocaleDateString('sv-SE');

const VERSION_LABELS: Record<JobVersionStatus, string> = {
  draft: 'Návrh',
  current: 'Platná',
  planned: 'Plánovaná',
  superseded: 'Nahradená'
};

/**
 * Organizácia (#12–#16): strom zložiek a pracovných miest, adresár osôb
 * s obsadením miest v čase a profily práce s verziami popisu.
 * Nič z toho nie je povinné — prvý proces sa dá založiť aj bez schémy.
 */
@Component({
  selector: 'pp-positions-page',
  standalone: true,
  imports: [FormsModule, NgTemplateOutlet, RouterLink, RichTextEditorComponent],
  templateUrl: './positions-page.component.html',
  styleUrl: './positions-page.component.scss'
})
export class PositionsPageComponent implements OnInit {
  readonly tab = signal<Tab>('structure');

  readonly units = signal<OrgUnit[]>([]);
  readonly positions = signal<OrgPosition[]>([]);
  readonly people = signal<Person[]>([]);
  readonly profiles = signal<JobProfile[]>([]);

  readonly error = signal<string | null>(null);
  readonly notice = signal<string | null>(null);

  // --- štruktúra ---
  unitModel = { name: '', description: '', parentId: '' };
  editingUnitId: string | null = null;

  positionModel = { name: '', description: '', unitId: '', reportsToId: '', jobProfileId: '' };
  editingPositionId: string | null = null;

  /** Miesto, ku ktorému sa práve vyberá osoba. */
  assigningPositionId: string | null = null;
  assignModel = { personId: '', validFrom: todayIso() };

  /** Obsadenie, ktoré sa práve ukončuje. */
  endingAssignmentId: string | null = null;
  endDate = todayIso();

  readonly unitRows = computed(() => flattenTree(this.units(), (unit) => unit.parentId));

  /** Zložky, pod ktoré sa dá upravovaná zložka presunúť (nie pod seba ani potomka). */
  readonly unitParentOptions = computed(() => {
    const blocked = this.editingUnitSignal()
      ? subtreeIds(this.units(), (unit) => unit.parentId, this.editingUnitSignal()!)
      : new Set<string>();
    return this.unitRows().filter((row) => !blocked.has(row.item.id));
  });

  readonly reportsToOptions = computed(() => {
    const blocked = this.editingPositionSignal()
      ? subtreeIds(this.positions(), (position) => position.reportsToId, this.editingPositionSignal()!)
      : new Set<string>();
    return this.positions().filter((position) => !blocked.has(position.id));
  });

  readonly unassignedPositions = computed(() => this.positions().filter((position) => !position.unitId));
  readonly vacantCount = computed(() => this.positions().filter((position) => position.vacant).length);
  readonly activePeople = computed(() => this.people().filter((person) => person.active));

  private readonly editingUnitSignal = signal<string | null>(null);
  private readonly editingPositionSignal = signal<string | null>(null);

  // --- ľudia ---
  personModel = { name: '', email: '', phone: '', note: '' };
  editingPersonId: string | null = null;
  leavingPersonId: string | null = null;
  leaveDate = todayIso();
  readonly expandedPersonId = signal<string | null>(null);
  readonly accountCount = computed(() => this.people().filter((person) => person.hasAccount).length);

  // --- profily práce ---
  profileModel = { name: '', summary: '' };
  editingProfileId: string | null = null;
  readonly selectedProfile = signal<JobProfile | null>(null);
  draftContent = '';
  publishDate = todayIso();

  constructor(
    private readonly positionsApi: PositionService,
    private readonly orgApi: OrganizationService
  ) {}

  ngOnInit(): void {
    this.reload();
  }

  setTab(tab: Tab): void {
    this.tab.set(tab);
    this.error.set(null);
    this.notice.set(null);
  }

  reload(): void {
    this.positionsApi.list().subscribe({
      next: (positions) => this.positions.set(positions),
      error: () => this.error.set('Pracovné miesta sa nepodarilo načítať.')
    });
    this.positionsApi.listUnits().subscribe({ next: (units) => this.units.set(units), error: () => undefined });
    this.orgApi.people().subscribe({ next: (people) => this.people.set(people), error: () => undefined });
    this.orgApi.jobProfiles().subscribe({ next: (profiles) => this.profiles.set(profiles), error: () => undefined });
  }

  private fail(fallback: string) {
    return (error: any) => this.error.set(error?.error?.message ?? fallback);
  }

  private done(message?: string) {
    return () => {
      this.error.set(null);
      this.notice.set(message ?? null);
      this.reload();
    };
  }

  // --- zložky ---

  saveUnit(): void {
    const name = this.unitModel.name.trim();
    if (!name) return;
    const payload = { name, description: this.unitModel.description, parentId: this.unitModel.parentId || null };
    const request = this.editingUnitId
      ? this.positionsApi.updateUnit(this.editingUnitId, payload)
      : this.positionsApi.createUnit(payload);
    request.subscribe({
      next: () => {
        this.cancelUnitEdit();
        this.done()();
      },
      error: this.fail('Zložku sa nepodarilo uložiť.')
    });
  }

  editUnit(unit: OrgUnit): void {
    this.editingUnitId = unit.id;
    this.editingUnitSignal.set(unit.id);
    this.unitModel = { name: unit.name, description: unit.description, parentId: unit.parentId ?? '' };
  }

  cancelUnitEdit(): void {
    this.editingUnitId = null;
    this.editingUnitSignal.set(null);
    this.unitModel = { name: '', description: '', parentId: '' };
  }

  removeUnit(unit: OrgUnit): void {
    const note = unit.positionCount > 0 ? `\n\nMiesta (${unit.positionCount}) ostanú, len stratia zaradenie.` : '';
    if (!window.confirm(`Vymazať zložku ${unit.name}?\nPodriadené zložky sa posunú o úroveň vyššie.${note}`)) return;
    this.positionsApi.removeUnit(unit.id).subscribe({ next: this.done(), error: this.fail('Zložku sa nepodarilo vymazať.') });
  }

  positionsOf(unitId: string): OrgPosition[] {
    return this.positions().filter((position) => position.unitId === unitId);
  }

  // --- pracovné miesta ---

  savePosition(): void {
    const name = this.positionModel.name.trim();
    if (!name) return;
    const payload = {
      name,
      description: this.positionModel.description,
      unitId: this.positionModel.unitId || null,
      reportsToId: this.positionModel.reportsToId || null,
      jobProfileId: this.positionModel.jobProfileId || null
    };
    const request = this.editingPositionId
      ? this.positionsApi.update(this.editingPositionId, payload)
      : this.positionsApi.create(payload);
    request.subscribe({
      next: () => {
        this.cancelPositionEdit();
        this.done()();
      },
      error: this.fail('Miesto sa nepodarilo uložiť.')
    });
  }

  editPosition(position: OrgPosition): void {
    this.tab.set('structure');
    this.editingPositionId = position.id;
    this.editingPositionSignal.set(position.id);
    this.positionModel = {
      name: position.name,
      description: position.description,
      unitId: position.unitId ?? '',
      reportsToId: position.reportsToId ?? '',
      jobProfileId: position.jobProfileId ?? ''
    };
  }

  cancelPositionEdit(): void {
    this.editingPositionId = null;
    this.editingPositionSignal.set(null);
    this.positionModel = { name: '', description: '', unitId: '', reportsToId: '', jobProfileId: '' };
  }

  removePosition(position: OrgPosition): void {
    if (!window.confirm(`Vymazať miesto ${position.name}?\nZmaže sa aj história jeho obsadenia a väzby na procesy.`)) return;
    this.positionsApi.remove(position.id).subscribe({ next: this.done(), error: this.fail('Miesto sa nepodarilo vymazať.') });
  }

  // --- obsadenie ---

  startAssign(position: OrgPosition): void {
    this.assigningPositionId = position.id;
    this.assignModel = { personId: '', validFrom: todayIso() };
  }

  assign(position: OrgPosition): void {
    if (!this.assignModel.personId) return;
    this.positionsApi.assign(position.id, this.assignModel.personId, this.assignModel.validFrom).subscribe({
      next: () => {
        this.assigningPositionId = null;
        this.done()();
      },
      error: this.fail('Obsadenie sa nepodarilo uložiť.')
    });
  }

  startEnd(holder: PositionHolder): void {
    this.endingAssignmentId = holder.assignmentId;
    this.endDate = todayIso();
  }

  endAssignment(position: OrgPosition, holder: PositionHolder): void {
    this.positionsApi.endAssignment(holder.assignmentId, this.endDate).subscribe({
      next: () => {
        this.endingAssignmentId = null;
        this.done(`Obsadenie miesta ${position.name} osobou ${holder.name} ukončené k ${this.endDate}. Zostáva v histórii.`)();
      },
      error: this.fail('Obsadenie sa nepodarilo ukončiť.')
    });
  }

  // --- ľudia ---

  savePerson(): void {
    const name = this.personModel.name.trim();
    if (!name) return;
    const payload = { ...this.personModel, name };
    const request = this.editingPersonId
      ? this.orgApi.updatePerson(this.editingPersonId, payload)
      : this.orgApi.createPerson(payload);
    request.subscribe({
      next: () => {
        this.cancelPersonEdit();
        this.done()();
      },
      error: this.fail('Osobu sa nepodarilo uložiť.')
    });
  }

  editPerson(person: Person): void {
    this.editingPersonId = person.id;
    this.personModel = { name: person.name, email: person.email, phone: person.phone, note: person.note };
  }

  cancelPersonEdit(): void {
    this.editingPersonId = null;
    this.personModel = { name: '', email: '', phone: '', note: '' };
  }

  currentAssignments(person: Person) {
    return person.assignments.filter((assignment) => assignment.current);
  }

  toggleHistory(person: Person): void {
    this.expandedPersonId.update((id) => (id === person.id ? null : person.id));
  }

  startLeave(person: Person): void {
    this.leavingPersonId = person.id;
    this.leaveDate = todayIso();
  }

  confirmLeave(person: Person): void {
    this.orgApi.leave(person.id, this.leaveDate).subscribe({
      next: (result) => {
        this.leavingPersonId = null;
        const vacated = result.vacatedPositions.map((position) => position.name);
        this.done(
          `Odchod osoby ${person.name} zaznamenaný k ${this.leaveDate}. ` +
          (vacated.length
            ? `Po ${this.leaveDate} ostanú neobsadené: ${vacated.join(', ')} — určte nástupcu v záložke Štruktúra.`
            : 'Všetky jej miesta majú ďalšieho držiteľa.')
        )();
      },
      error: this.fail('Odchod sa nepodarilo zaznamenať.')
    });
  }

  reactivate(person: Person): void {
    this.orgApi.updatePerson(person.id, { active: true }).subscribe({ next: this.done(), error: this.fail('Zmena sa nepodarila.') });
  }

  removePerson(person: Person): void {
    if (!window.confirm(`Vymazať osobu ${person.name} z adresára?`)) return;
    this.orgApi.deletePerson(person.id).subscribe({ next: this.done(), error: this.fail('Osobu sa nepodarilo vymazať.') });
  }

  // --- profily práce ---

  saveProfile(): void {
    const name = this.profileModel.name.trim();
    if (!name) return;
    const request = this.editingProfileId
      ? this.orgApi.updateJobProfile(this.editingProfileId, { name, summary: this.profileModel.summary })
      : this.orgApi.createJobProfile(name, this.profileModel.summary);
    request.subscribe({
      next: (profile) => {
        this.cancelProfileEdit();
        this.done()();
        this.openProfile(profile);
      },
      error: this.fail('Profil sa nepodarilo uložiť.')
    });
  }

  editProfile(profile: JobProfile): void {
    this.editingProfileId = profile.id;
    this.profileModel = { name: profile.name, summary: profile.summary };
  }

  cancelProfileEdit(): void {
    this.editingProfileId = null;
    this.profileModel = { name: '', summary: '' };
  }

  removeProfile(profile: JobProfile): void {
    if (!window.confirm(`Vymazať profil ${profile.name}?`)) return;
    this.orgApi.deleteJobProfile(profile.id).subscribe({
      next: () => {
        if (this.selectedProfile()?.id === profile.id) this.selectedProfile.set(null);
        this.done()();
      },
      error: this.fail('Profil sa nepodarilo vymazať.')
    });
  }

  openProfile(profile: JobProfile): void {
    this.orgApi.jobProfile(profile.id).subscribe({
      next: (full) => {
        this.selectedProfile.set(full);
        this.draftContent = full.draftVersion?.content ?? '';
        this.publishDate = todayIso();
      },
      error: this.fail('Profil sa nepodarilo načítať.')
    });
  }

  private refreshProfile(message?: string): void {
    const profile = this.selectedProfile();
    if (profile) this.openProfile(profile);
    this.done(message)();
  }

  /** Nová verzia začína textom platnej verzie — mení sa len to, čo treba. */
  newDraft(): void {
    const profile = this.selectedProfile();
    if (!profile) return;
    const base = profile.currentVersion?.content ?? profile.versions.find((version) => version.status !== 'draft')?.content ?? '';
    this.orgApi.createDraft(profile.id, base).subscribe({
      next: () => this.refreshProfile(),
      error: this.fail('Návrh sa nepodarilo vytvoriť.')
    });
  }

  saveDraft(): void {
    const draft = this.selectedProfile()?.draftVersion;
    if (!draft) return;
    this.orgApi.saveDraft(draft.id, this.draftContent).subscribe({
      next: () => this.refreshProfile('Návrh uložený.'),
      error: this.fail('Návrh sa nepodarilo uložiť.')
    });
  }

  publishDraft(): void {
    const draft = this.selectedProfile()?.draftVersion;
    if (!draft) return;
    if (!window.confirm(`Publikovať verziu ${draft.version} s účinnosťou od ${this.publishDate}?\nPublikovanú verziu už nemožno meniť.`)) return;
    // najprv uložiť rozpísaný text, potom publikovať
    this.orgApi.saveDraft(draft.id, this.draftContent).subscribe({
      next: () => this.orgApi.publish(draft.id, this.publishDate).subscribe({
        next: () => this.refreshProfile(`Verzia ${draft.version} publikovaná.`),
        error: this.fail('Verziu sa nepodarilo publikovať.')
      }),
      error: this.fail('Návrh sa nepodarilo uložiť.')
    });
  }

  deleteDraft(): void {
    const draft = this.selectedProfile()?.draftVersion;
    if (!draft || !window.confirm('Zahodiť rozpracovaný návrh?')) return;
    this.orgApi.deleteDraft(draft.id).subscribe({ next: () => this.refreshProfile(), error: this.fail('Návrh sa nepodarilo zmazať.') });
  }

  versionLabel(version: JobDescriptionVersion): string {
    return VERSION_LABELS[version.status];
  }

  renderMarkdown(content?: string): string {
    return markdownToHtml(content ?? '');
  }
}
