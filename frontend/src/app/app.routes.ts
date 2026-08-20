import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    redirectTo: '/dashboard',
    pathMatch: 'full',
  },
  {
    path: 'dashboard',
    loadComponent: () =>
      import('./features/dashboard/dashboard.component').then(m => m.DashboardComponent),
    title: 'Dashboard — Ahadi Analytics',
  },
  {
    path: 'pipeline',
    loadComponent: () =>
      import('./features/pipeline-runner/pipeline-runner.component').then(m => m.PipelineRunnerComponent),
    title: 'Pipeline Runner — Ahadi Analytics',
  },
  {
    path: '**',
    redirectTo: '/dashboard',
  },
];
