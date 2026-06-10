import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { Invitation } from '../../core/models/user.model';
import { AuthService } from '../../core/services/auth.service';

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

  register(): void {
    this.auth.registerOwner(this.registerModel);
  }

  login(): void {
    this.auth.login(this.loginModel.email, this.loginModel.password);
  }

  acceptInvite(): void {
    this.auth.acceptInvitation(this.inviteToken, this.inviteModel.name, this.inviteModel.password);
  }
}
