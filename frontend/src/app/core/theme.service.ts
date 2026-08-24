import { effect, inject, Injectable, signal } from '@angular/core';
import { DOCUMENT } from '@angular/common';

const THEME_KEY = 'ahadi_theme';
const DARK_CLASS = 'dark-theme';
const LIGHT_CLASS = 'light-theme';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly document = inject(DOCUMENT);

  /**
   * Signal: true → dark theme is active (default).
   */
  readonly isDark = signal<boolean>(this._loadPreference());

  constructor() {
    // Apply theme class whenever the signal changes
    effect(() => {
      this._applyTheme(this.isDark());
    });
  }

  /**
   * Toggle between dark and light themes.
   */
  toggleTheme(): void {
    this.isDark.update((dark) => !dark);
    this._savePreference(this.isDark());
  }

  /**
   * Explicitly set dark (true) or light (false) theme.
   */
  setDark(dark: boolean): void {
    this.isDark.set(dark);
    this._savePreference(dark);
  }

  // ── Private helpers ──────────────────────────────────────────

  private _loadPreference(): boolean {
    // Dark mode is always the default — ignore stored or OS preference
    return true;
  }

  private _savePreference(dark: boolean): void {
    try {
      localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light');
    } catch {
      // Ignore write failures
    }
  }

  private _applyTheme(dark: boolean): void {
    const root = this.document.documentElement;
    if (dark) {
      root.classList.remove(LIGHT_CLASS);
      root.classList.add(DARK_CLASS);
    } else {
      root.classList.remove(DARK_CLASS);
      root.classList.add(LIGHT_CLASS);
    }
  }
}
