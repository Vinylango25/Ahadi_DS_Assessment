// ============================================================
// Ahadi — App Shell Component
// Header: brand text (no logo until provided), nav tabs,
//         theme toggle, mobile drawer
// ============================================================
import {
  Component,
  OnInit,
  inject,
  signal,
  HostListener,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, RouterOutlet, Router, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs/operators';
import { ThemeService } from './core/theme.service';

interface NavItem {
  path: string;
  label: string;
  icon: string;
  desc: string;
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, RouterModule, RouterOutlet],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
})
export class AppComponent implements OnInit {
  readonly theme  = inject(ThemeService);
  private readonly router = inject(Router);

  readonly mobileMenuOpen = signal(false);
  readonly currentPath    = signal('/dashboard');

  readonly navItems: NavItem[] = [
    {
      path:  '/dashboard',
      label: 'Dashboard',
      icon:  'dashboard',
      desc:  'Interactive population analytics',
    },
    {
      path:  '/pipeline',
      label: 'Pipeline',
      icon:  'settings_suggest',
      desc:  'Run & monitor data pipeline',
    },
  ];

  ngOnInit(): void {
    this.router.events
      .pipe(filter(e => e instanceof NavigationEnd))
      .subscribe((e: any) => this.currentPath.set(e.urlAfterRedirects ?? '/dashboard'));
  }

  @HostListener('document:keydown.escape')
  closeMobileMenu(): void { this.mobileMenuOpen.set(false); }

  toggleMenu(): void { this.mobileMenuOpen.update(v => !v); }
  toggleTheme(): void { this.theme.toggleTheme(); }

  isActive(path: string): boolean {
    return this.currentPath().startsWith(path);
  }
}
