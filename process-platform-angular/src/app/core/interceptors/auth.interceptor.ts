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
      // #32 — pri chybe servera ukázať ID požiadavky, podľa ktorého sa nájde v logu
      if (error instanceof HttpErrorResponse && error.status >= 500) {
        const body = error.error as { message?: unknown; requestId?: unknown } | null;
        if (body && typeof body.message === 'string' && typeof body.requestId === 'string' && !body.message.includes(body.requestId)) {
          body.message = `${body.message} (ID chyby: ${body.requestId})`;
        }
      }
      return throwError(() => error);
    })
  );
};
