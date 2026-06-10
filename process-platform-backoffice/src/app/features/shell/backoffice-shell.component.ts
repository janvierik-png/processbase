import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

@Component({
  selector: 'bo-shell',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './backoffice-shell.component.html',
  styleUrl: './backoffice-shell.component.scss'
})
export class BackofficeShellComponent {}
