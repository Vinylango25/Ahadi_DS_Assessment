// ============================================================
// Ahadi — Pipeline Runner Component
// Lets users trigger the data pipeline from the dashboard
// and monitor each stage with animated progress bars.
// ============================================================
import {
  Component,
  OnInit,
  OnDestroy,
  inject,
  signal,
  computed,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { interval, Subject } from 'rxjs';
import { takeUntil, switchMap, catchError } from 'rxjs/operators';
import { of } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface PipelineStage {
  id: string;
  label: string;
  status: 'pending' | 'running' | 'completed' | 'error';
  progress: number;
  message: string;
}

export interface PipelineStatus {
  running: boolean;
  stage: string | null;
  stages: PipelineStage[];
  started_at: string | null;
  completed_at: string | null;
  error: string | null;
  log_tail: string[];
}

@Component({
  selector: 'app-pipeline-runner',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],
  template: `
    <div class="pipeline-page">

      <!-- Header -->
      <div class="pipe-header">
        <div class="pipe-title-row">
          <h2 class="pipe-title">
            <span class="material-symbols-rounded">settings_suggest</span>
            Data Pipeline Runner
          </h2>
          <div class="pipe-controls">
            <button class="pipe-btn run-btn"
                    [disabled]="status()?.running"
                    (click)="runPipeline()">
              <span class="material-symbols-rounded">
                {{ status()?.running ? 'hourglass_top' : 'play_circle' }}
              </span>
              {{ status()?.running ? 'Running…' : 'Run Pipeline' }}
            </button>
            <button class="pipe-btn reset-btn"
                    [disabled]="status()?.running"
                    (click)="resetPipeline()">
              <span class="material-symbols-rounded">refresh</span>
              Reset
            </button>
          </div>
        </div>
        <p class="pipe-sub">
          Trigger the full WorldPop data pipeline: download GeoTIFFs → validate →
          aggregate to counties → compute indicators → visualise → seed database.
        </p>
      </div>

      <!-- Overall progress -->
      @if (status()) {
        <div class="overall-bar">
          <div class="overall-label">
            <span>Overall Progress</span>
            <span class="overall-pct">{{ overallProgress() }}%</span>
          </div>
          <div class="progress-track">
            <div class="progress-fill overall"
                 [style.width.%]="overallProgress()"
                 [class.pulsing]="status()!.running">
            </div>
          </div>
          @if (status()!.started_at) {
            <div class="time-row">
              <span class="time-chip">
                <span class="material-symbols-rounded">schedule</span>
                Started {{ status()!.started_at | date:'HH:mm:ss' }}
              </span>
              @if (status()!.completed_at) {
                <span class="time-chip success">
                  <span class="material-symbols-rounded">check_circle</span>
                  Completed {{ status()!.completed_at | date:'HH:mm:ss' }}
                </span>
              }
            </div>
          }
        </div>

        <!-- Stage cards -->
        <div class="stages-grid">
          @for (stage of status()!.stages; track stage.id) {
            <div class="stage-card" [class]="'stage-' + stage.status">

              <!-- Stage icon -->
              <div class="stage-icon-wrap">
                <span class="material-symbols-rounded stage-icon">
                  {{ stageIcon(stage.id) }}
                </span>
                @if (stage.status === 'running') {
                  <div class="stage-spinner"></div>
                }
                @if (stage.status === 'completed') {
                  <span class="material-symbols-rounded stage-check">check_circle</span>
                }
                @if (stage.status === 'error') {
                  <span class="material-symbols-rounded stage-error-icon">error</span>
                }
              </div>

              <!-- Stage info -->
              <div class="stage-info">
                <div class="stage-name">{{ stage.label }}</div>
                @if (stage.message) {
                  <div class="stage-message">{{ stage.message }}</div>
                }
                <!-- Progress bar -->
                <div class="stage-progress-track">
                  <div class="stage-progress-fill"
                       [style.width.%]="stage.progress"
                       [class.pulsing]="stage.status === 'running'">
                  </div>
                </div>
                <div class="stage-pct">{{ stage.progress }}%</div>
              </div>

              <!-- Status badge -->
              <div class="stage-badge" [class]="'badge-' + stage.status">
                {{ stage.status | uppercase }}
              </div>
            </div>
          }
        </div>

        <!-- Error panel -->
        @if (status()!.error) {
          <div class="error-panel">
            <span class="material-symbols-rounded">error_outline</span>
            <div class="error-body">
              <strong>Pipeline Error</strong>
              <pre class="error-pre">{{ status()!.error }}</pre>
            </div>
          </div>
        }

        <!-- Log tail -->
        @if (status()!.log_tail?.length) {
          <div class="log-panel">
            <div class="log-header">
              <span class="material-symbols-rounded">terminal</span>
              Pipeline Log
              <span class="log-count">{{ status()!.log_tail!.length }} lines</span>
            </div>
            <div class="log-body">
              @for (line of status()!.log_tail; track $index) {
                <div class="log-line" [class.log-error]="isErrorLine(line)">{{ line }}</div>
              }
            </div>
          </div>
        }
      } @else {
        <div class="pipe-empty">
          <span class="material-symbols-rounded">pending</span>
          <p>Click <strong>Run Pipeline</strong> to start the WorldPop data download and processing.</p>
        </div>
      }
    </div>
  `,
  styleUrls: ['./pipeline-runner.component.scss'],
})
export class PipelineRunnerComponent implements OnInit, OnDestroy {
  private readonly http = inject(HttpClient);
  private readonly destroy$ = new Subject<void>();

  readonly status = signal<PipelineStatus | null>(null);

  readonly overallProgress = computed(() => {
    const stages = this.status()?.stages ?? [];
    if (!stages.length) return 0;
    const total = stages.reduce((sum, s) => sum + s.progress, 0);
    return Math.round(total / stages.length);
  });

  ngOnInit(): void {
    this.fetchStatus();
    // Poll every 1.5 seconds while running, every 5 seconds otherwise
    interval(1500)
      .pipe(
        takeUntil(this.destroy$),
        switchMap(() => this.http.get<PipelineStatus>(`${environment.apiUrl}/api/pipeline/status`)
          .pipe(catchError(() => of(null)))),
      )
      .subscribe(s => { if (s) this.status.set(s); });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  fetchStatus(): void {
    this.http.get<PipelineStatus>(`${environment.apiUrl}/api/pipeline/status`)
      .pipe(catchError(() => of(null)))
      .subscribe(s => { if (s) this.status.set(s); });
  }

  runPipeline(): void {
    this.http.post<any>(`${environment.apiUrl}/api/pipeline/run`, {})
      .pipe(catchError(() => of(null)))
      .subscribe(() => this.fetchStatus());
  }

  resetPipeline(): void {
    this.http.post<any>(`${environment.apiUrl}/api/pipeline/reset`, {})
      .pipe(catchError(() => of(null)))
      .subscribe(() => this.fetchStatus());
  }

  stageIcon(id: string): string {
    const icons: Record<string, string> = {
      download:   'cloud_download',
      validate:   'fact_check',
      aggregate:  'layers',
      indicators: 'calculate',
      visualize:  'bar_chart',
      seed_db:    'storage',
    };
    return icons[id] ?? 'circle';
  }

  isErrorLine(line: string): boolean {
    return /error|fail|exception/i.test(line);
  }
}
