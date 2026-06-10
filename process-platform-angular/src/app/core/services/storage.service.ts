import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class StorageService {
  read<T>(key: string, fallback: T): T {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }

  write<T>(key: string, value: T): void {
    localStorage.setItem(key, JSON.stringify(value));
  }

  readString(key: string, fallback = ''): string {
    return localStorage.getItem(key) ?? fallback;
  }

  writeString(key: string, value: string): void {
    localStorage.setItem(key, value);
  }

  remove(key: string): void {
    localStorage.removeItem(key);
  }
}
