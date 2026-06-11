import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BackofficeAuthService } from '../../core/services/backoffice-auth.service';

@Component({
  selector: 'bo-login-page',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './login-page.component.html',
  styleUrl: './login-page.component.scss'
})
export class LoginPageComponent {
  model = { username: '', password: '' };

  constructor(readonly auth: BackofficeAuthService) {}

  login(): void {
    if (!this.model.username || !this.model.password) return;
    this.auth.login(this.model.username, this.model.password);
  }
}
