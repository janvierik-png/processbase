import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { AuthService } from '../services/auth.service';

/**
 * Pridáva token relácie do každej požiadavky na API (#1, #2).
 * Pri 401 vyčistí lokálny stav a presmeruje na úvodnú stránku — relácia
 * mohla vypršať alebo byť zneplatnená na serveri.
 */
export const authInterceptor: HttpInterceptorFn = (request, next) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  const token = auth.token();
  const authorized = token
    ? request.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
    : request;

  return next(authorized).pipe(
    catchError((error: unknown) => {
      if (error instanceof HttpErrorResponse && error.status === 401) {
        auth.clearSession();
        // na verejných stránkach presmerovanie netreba
        if (router.url.startsWith('/app')) router.navigateByUrl('/');
      }
      return throwError(() => error);
    })
  );
};
