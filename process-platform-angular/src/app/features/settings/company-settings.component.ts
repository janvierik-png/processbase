import { Component, OnInit, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DEFAULT_ROLES } from '../../core/data/default-data';
import { Invitation, RoleId, User } from '../../core/models/user.model';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'pp-company-settings',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './company-settings.component.html',
  styleUrl: './company-settings.component.scss'
})
export class CompanySettingsComponent implements OnInit {
  readonly organization = computed(() => this.auth.currentOrganization());
  readonly users = signal<User[]>([]);
  readonly invitations = signal<Invitation[]>([]);
  readonly error = signal<string | null>(null);
  readonly roles = DEFAULT_ROLES;
  companyName = this.organization()?.name ?? '';
  invite = { email: '', roleId: 'approver' as RoleId };

  constructor(readonly auth: AuthService) {}

  ngOnInit(): void {
    this.auth.organizationUsers().subscribe({
      next: (users) => this.users.set(users),
      error: () => this.error.set('Pouzivatelov sa nepodarilo nacitat.')
    });
    this.auth.invitations().subscribe({
      next: (invitations) => this.invitations.set(invitations),
      error: () => this.error.set('Pozvanky sa nepodarilo nacitat.')
    });
  }

  saveCompanyName(): void {
    this.auth.updateOrganizationName(this.companyName);
  }

  sendInvite(): void {
    if (!this.invite.email) return;
    this.auth.createInvitation(this.invite.email, this.invite.roleId).subscribe({
      next: (invitation) => {
        this.invitations.update((items) => [invitation, ...items]);
        this.invite.email = '';
        this.error.set(null);
      },
      error: () => this.error.set('Pozvanku sa nepodarilo vytvorit.')
    });
  }

  inviteLink(invitation: Invitation): string {
    return `${location.origin}/?invite=${invitation.token}`;
  }

  copyInviteLink(invitation: Invitation): void {
    navigator.clipboard?.writeText(this.inviteLink(invitation));
  }
}
