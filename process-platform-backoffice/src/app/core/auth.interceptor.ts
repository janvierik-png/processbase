import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { BackofficeAuthService } from './services/backoffice-auth.service';

export const backofficeAuthInterceptor: HttpInterceptorFn = (request, next) => {
  const auth = inject(BackofficeAuthService);
  const token = auth.token();
  const isLogin = request.url.includes('/auth/login');

  const authorized = token && !isLogin
    ? request.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
    : request;

  return next(authorized).pipe(
    catchError((error: HttpErrorResponse) => {
      if (error.status === 401 && !isLogin) {
        auth.sessionExpired();
      }
      return throwError(() => error);
    })
  );
};
