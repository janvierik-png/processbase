import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { BackofficeAuthService } from '../services/backoffice-auth.service';

export const adminGuard: CanActivateFn = () => {
  const auth = inject(BackofficeAuthService);
  const router = inject(Router);

  if (auth.isAuthenticated()) return true;
  return router.createUrlTree(['/login']);
};
