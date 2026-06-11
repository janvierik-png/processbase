import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { Invitation } from '../../core/models/user.model';
import { AuthService } from '../../core/services/auth.service';

type CheckState = 'idle' | 'checking' | 'available' | 'taken';

@Component({
  selector: 'pp-landing-page',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './landing-page.component.html',
  styleUrl: './landing-page.component.scss'
})
export class LandingPageComponent implements OnInit {
  readonly mode = signal<'register' | 'login' | 'invite'>('register');
  readonly invitation = signal<(Invitation & { organizationName: string; expired: boolean }) | null>(null);
  readonly invitationError = signal('');

  // R11: realtime validacia (debounced)
  readonly emailState = signal<CheckState>('idle');
  readonly orgNameState = signal<CheckState>('idle');
  private emailTimer: ReturnType<typeof setTimeout> | null = null;
  private orgNameTimer: ReturnType<typeof setTimeout> | null = null;

  registerModel = {
    organizationName: '',
    ownerName: '',
    email: '',
    password: ''
  };

  loginModel = {
    email: '',
    password: ''
  };

  inviteModel = {
    name: '',
    password: ''
  };

  private inviteToken = '';

  constructor(
    readonly auth: AuthService,
    private readonly route: ActivatedRoute
  ) {}

  ngOnInit(): void {
    this.route.queryParamMap.subscribe((params) => {
      const token = params.get('invite');
      if (!token) return;
      this.inviteToken = token;
      this.mode.set('invite');
      this.auth.invitationByToken(token).subscribe({
        next: (invitation) => {
          if (invitation.expired || invitation.status !== 'pending') {
            this.invitationError.set('Pozvanka uz nie je platna.');
            return;
          }
          this.invitation.set(invitation);
        },
        error: () => this.invitationError.set('Pozvanka neexistuje.')
      });
    });
  }

  emailChanged(value: string): void {
    if (this.emailTimer) clearTimeout(this.emailTimer);
    if (!value || !value.includes('@')) {
      this.emailState.set('idle');
      return;
    }
    this.emailState.set('checking');
    this.emailTimer = setTimeout(() => {
      this.auth.checkEmail(value).subscribe({
        next: (result) => this.emailState.set(result.available ? 'available' : 'taken'),
        error: () => this.emailState.set('idle')
      });
    }, 500);
  }

  orgNameChanged(value: string): void {
    if (this.orgNameTimer) clearTimeout(this.orgNameTimer);
    if (!value.trim()) {
      this.orgNameState.set('idle');
      return;
    }
    this.orgNameState.set('checking');
    this.orgNameTimer = setTimeout(() => {
      this.auth.checkOrgName(value).subscribe({
        next: (result) => this.orgNameState.set(result.available ? 'available' : 'taken'),
        error: () => this.orgNameState.set('idle')
      });
    }, 500);
  }

  registerBlocked(): boolean {
    return this.auth.loading() || this.emailState() === 'taken' || this.orgNameState() === 'taken' || this.emailState() === 'checking' || this.orgNameState() === 'checking';
  }

  register(): void {
    if (this.registerBlocked()) return;
    this.auth.registerOwner(this.registerModel);
  }

  login(): void {
    this.auth.login(this.loginModel.email, this.loginModel.password);
  }

  acceptInvite(): void {
    this.auth.acceptInvitation(this.inviteToken, this.inviteModel.name, this.inviteModel.password);
  }
}
