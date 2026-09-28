import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';

type Mode = 'verify' | 'forgot' | 'reset';
type State = 'idle' | 'working' | 'done' | 'error';

const MIN_PASSWORD = 10;

/**
 * Toky z e-mailových odkazov (#20): potvrdenie e-mailu, žiadosť o obnovu hesla
 * a nastavenie nového hesla. Token z odkazu sa hneď odstráni z adresy, aby
 * neostal v histórii prehliadača.
 */
@Component({
  selector: 'pp-account-flow-page',
  standalone: true,
  imports: [FormsModule, RouterLink],
  templateUrl: './account-flow-page.component.html',
  styleUrl: './account-flow-page.component.scss'
})
export class AccountFlowPageComponent implements OnInit {
  mode: Mode = 'verify';
  readonly state = signal<State>('idle');
  readonly message = signal('');

  email = '';
  password = '';
  passwordRepeat = '';
  private token = '';

  readonly minPassword = MIN_PASSWORD;

  constructor(
    private readonly route: ActivatedRoute,
    readonly auth: AuthService
  ) {}

  ngOnInit(): void {
    this.mode = (this.route.snapshot.data['mode'] as Mode) ?? 'verify';
    this.token = this.route.snapshot.queryParamMap.get('token') ?? '';
    if (this.token) {
      // token nepatrí do histórie prehliadača ani do Referer hlavičky
      history.replaceState(history.state, '', location.pathname);
    }
    if (this.mode === 'verify') this.verify();
    if (this.mode === 'reset' && !this.token) this.fail('Odkaz je neúplný. Otvorte ho znova z e-mailu.');
  }

  private fail(message: string): void {
    this.state.set('error');
    this.message.set(message);
  }

  private errorText(error: any, fallback: string): string {
    const status = error?.status;
    if (status === 410) return 'Platnosť odkazu vypršala. Vyžiadajte si nový.';
    if (status === 429) return error?.error?.message ?? 'Príliš veľa pokusov. Skúste to neskôr.';
    if (status === 400) return error?.error?.message?.includes('Heslo')
      ? `Heslo musí mať aspoň ${MIN_PASSWORD} znakov.`
      : 'Odkaz je neplatný alebo už bol použitý.';
    return fallback;
  }

  verify(): void {
    if (!this.token) {
      this.fail('Odkaz je neúplný. Otvorte ho znova z e-mailu.');
      return;
    }
    this.state.set('working');
    this.auth.verifyEmail(this.token).subscribe({
      next: () => {
        this.auth.markEmailVerified();
        this.state.set('done');
        this.message.set('E-mail je potvrdený. Ďakujeme.');
      },
      error: (error) => this.fail(this.errorText(error, 'E-mail sa nepodarilo potvrdiť.'))
    });
  }

  requestReset(): void {
    const email = this.email.trim();
    if (!email) return;
    this.state.set('working');
    this.auth.forgotPassword(email).subscribe({
      next: () => {
        this.state.set('done');
        // rovnaká odpoveď bez ohľadu na to, či účet existuje
        this.message.set(`Ak u nás existuje účet s adresou ${email}, poslali sme naň odkaz na nastavenie nového hesla. Platí 1 hodinu.`);
      },
      error: (error) => this.fail(this.errorText(error, 'Žiadosť sa nepodarilo odoslať.'))
    });
  }

  resetPassword(): void {
    if (this.password.length < MIN_PASSWORD) {
      this.message.set(`Heslo musí mať aspoň ${MIN_PASSWORD} znakov.`);
      return;
    }
    if (this.password !== this.passwordRepeat) {
      this.message.set('Heslá sa nezhodujú.');
      return;
    }
    this.state.set('working');
    this.auth.resetPassword(this.token, this.password).subscribe({
      next: () => {
        // server zrušil všetky relácie — aj túto
        this.auth.clearSession();
        this.state.set('done');
        this.message.set('Heslo je zmenené. Všade, kde ste boli prihlásení, ste boli odhlásení.');
      },
      error: (error) => this.fail(this.errorText(error, 'Heslo sa nepodarilo zmeniť.'))
    });
  }
}
