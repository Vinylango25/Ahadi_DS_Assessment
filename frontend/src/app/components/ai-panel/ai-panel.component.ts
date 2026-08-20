// ============================================================
// Ahadi — AI Insights & Natural Language Query Panel
// Uses Groq LLaMA 3.1 (same model as WC project)
// ============================================================
import {
  Component,
  Input,
  OnChanges,
  SimpleChanges,
  inject,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { catchError } from 'rxjs/operators';
import { of } from 'rxjs';
import { environment } from '../../../environments/environment';
import { CountySummary } from '../../models/population.model';

interface NLQueryResult {
  question: string;
  sql:     string | null;
  results: Record<string, any>[];
  answer:  string | null;
  error:   string | null;
}

interface AIInsightResponse {
  county?:     string;
  year:        number;
  insight:     string;
  ai_powered:  boolean;
}

@Component({
  selector: 'app-ai-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="ai-panel">

      <!-- Header -->
      <div class="ai-header">
        <div class="ai-title">
          <span class="material-symbols-rounded ai-icon">auto_awesome</span>
          <div>
            <h3 class="ai-name">AI Insights</h3>
            <p class="ai-sub">Powered by LLaMA 3.1 · Groq</p>
          </div>
        </div>
        <div class="ai-tabs">
          <button class="ai-tab" [class.active]="activeTab() === 'insight'" (click)="setTab('insight')">
            <span class="material-symbols-rounded">lightbulb</span> Insights
          </button>
          <button class="ai-tab" [class.active]="activeTab() === 'query'" (click)="setTab('query')">
            <span class="material-symbols-rounded">manage_search</span> Ask Data
          </button>
        </div>
      </div>

      <!-- ── Insight tab ────────────────────────────────────── -->
      @if (activeTab() === 'insight') {
        <div class="insight-body">
          @if (countyName) {
            <button class="generate-btn" [disabled]="loadingInsight()" (click)="loadCountyInsight()">
              <span class="material-symbols-rounded">{{ loadingInsight() ? 'hourglass_top' : 'psychology' }}</span>
              {{ loadingInsight() ? 'Generating insight…' : 'Generate AI Insight for ' + countyName }}
            </button>
          } @else {
            <button class="generate-btn" [disabled]="loadingInsight()" (click)="loadNationalInsight()">
              <span class="material-symbols-rounded">{{ loadingInsight() ? 'hourglass_top' : 'public' }}</span>
              {{ loadingInsight() ? 'Generating insight…' : 'Generate National AI Insight' }}
            </button>
          }

          @if (insightText()) {
            <div class="insight-card animate-fade-in">
              <div class="insight-meta">
                <span class="material-symbols-rounded">auto_awesome</span>
                <span>{{ countyName ? countyName + ' · ' + year : 'Kenya · ' + year }}</span>
              </div>
              <div class="insight-text" [innerHTML]="formatInsight(insightText()!)"></div>
            </div>
          }

          @if (insightError()) {
            <div class="ai-error">
              <span class="material-symbols-rounded">error_outline</span>
              {{ insightError() }}
            </div>
          }
        </div>
      }

      <!-- ── NL Query tab ───────────────────────────────────── -->
      @if (activeTab() === 'query') {
        <div class="query-body">
          <!-- Example questions -->
          <div class="example-row">
            <span class="example-label">Try:</span>
            @for (q of exampleQuestions; track q) {
              <button class="example-chip" (click)="setQuestion(q)">{{ q }}</button>
            }
          </div>

          <!-- Input -->
          <div class="query-input-row">
            <input
              type="text"
              class="query-input"
              [(ngModel)]="userQuestion"
              placeholder="Ask anything about Kenya's population data…"
              (keydown.enter)="submitQuery()"
              [disabled]="loadingQuery()"
            />
            <button class="query-submit" [disabled]="!userQuestion || loadingQuery()" (click)="submitQuery()">
              <span class="material-symbols-rounded">
                {{ loadingQuery() ? 'hourglass_top' : 'send' }}
              </span>
            </button>
          </div>

          <!-- Result -->
          @if (queryResult()) {
            <div class="query-result animate-fade-in">

              <!-- Answer -->
              @if (queryResult()!.answer) {
                <div class="answer-card">
                  <span class="material-symbols-rounded answer-icon">chat_bubble</span>
                  <p class="answer-text">{{ queryResult()!.answer }}</p>
                </div>
              }

              <!-- SQL -->
              @if (queryResult()!.sql) {
                <details class="sql-details">
                  <summary class="sql-summary">
                    <span class="material-symbols-rounded">code</span> View SQL
                  </summary>
                  <pre class="sql-code">{{ queryResult()!.sql }}</pre>
                </details>
              }

              <!-- Table -->
              @if (queryResult()!.results?.length) {
                <div class="results-table-wrap">
                  <table class="results-table">
                    <thead>
                      <tr>
                        @for (col of tableHeaders(); track col) {
                          <th>{{ col }}</th>
                        }
                      </tr>
                    </thead>
                    <tbody>
                      @for (row of queryResult()!.results.slice(0,10); track $index) {
                        <tr>
                          @for (col of tableHeaders(); track col) {
                            <td>{{ formatCell(row[col]) }}</td>
                          }
                        </tr>
                      }
                    </tbody>
                  </table>
                  @if (queryResult()!.results.length > 10) {
                    <p class="table-note">Showing 10 of {{ queryResult()!.results.length }} results</p>
                  }
                </div>
              }

              <!-- Error -->
              @if (queryResult()!.error) {
                <div class="ai-error">
                  <span class="material-symbols-rounded">error_outline</span>
                  {{ queryResult()!.error }}
                </div>
              }
            </div>
          }
        </div>
      }
    </div>
  `,
  styleUrls: ['./ai-panel.component.scss'],
})
export class AIPanelComponent implements OnChanges {
  @Input() countyName = '';
  @Input() year = 2025;
  @Input() summary: CountySummary | null = null;

  private readonly http = inject(HttpClient);

  readonly activeTab     = signal<'insight' | 'query'>('insight');
  readonly loadingInsight = signal(false);
  readonly loadingQuery   = signal(false);
  readonly insightText    = signal<string | null>(null);
  readonly insightError   = signal<string | null>(null);
  readonly queryResult    = signal<NLQueryResult | null>(null);

  userQuestion = '';

  readonly exampleQuestions = [
    'Which county has the highest dependency ratio in 2025?',
    'Top 5 most populous counties in 2024',
    'Counties where sex ratio exceeds 105',
    'Average children under 5 across all counties in 2025',
  ];

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['countyName'] || changes['year']) {
      this.insightText.set(null);
      this.insightError.set(null);
    }
  }

  setTab(tab: 'insight' | 'query'): void { this.activeTab.set(tab); }

  setQuestion(q: string): void { this.userQuestion = q; }

  loadCountyInsight(): void {
    if (!this.countyName) return;
    this.loadingInsight.set(true);
    this.insightError.set(null);
    this.insightText.set(null);

    this.http.get<AIInsightResponse>(
      `${environment.apiUrl}/api/ai/county-insight`,
      { params: { county: this.countyName, year: this.year } }
    )
      .pipe(catchError(err => {
        const msg = err?.error?.detail ?? 'AI insight unavailable. Ensure GROQ_API_KEY is configured.';
        this.insightError.set(msg);
        this.loadingInsight.set(false);
        return of(null);
      }))
      .subscribe(res => {
        if (res) {
          this.insightText.set(res.insight);
        }
        this.loadingInsight.set(false);
      });
  }

  loadNationalInsight(): void {
    this.loadingInsight.set(true);
    this.insightError.set(null);
    this.insightText.set(null);

    this.http.get<AIInsightResponse>(
      `${environment.apiUrl}/api/ai/national-insight`,
      { params: { year: this.year } }
    )
      .pipe(catchError(err => {
        this.insightError.set(err?.error?.detail ?? 'AI insight unavailable.');
        this.loadingInsight.set(false);
        return of(null);
      }))
      .subscribe(res => {
        if (res) this.insightText.set(res.insight);
        this.loadingInsight.set(false);
      });
  }

  submitQuery(): void {
    if (!this.userQuestion.trim()) return;
    this.loadingQuery.set(true);
    this.queryResult.set(null);

    this.http.post<NLQueryResult>(
      `${environment.apiUrl}/api/ai/query`,
      { question: this.userQuestion.trim() }
    )
      .pipe(catchError(err => {
        return of({
          question: this.userQuestion,
          sql: null,
          results: [],
          answer: null,
          error: err?.error?.detail ?? 'Query failed.',
        } as NLQueryResult);
      }))
      .subscribe(res => {
        this.queryResult.set(res);
        this.loadingQuery.set(false);
      });
  }

  tableHeaders(): string[] {
    const results = this.queryResult()?.results ?? [];
    if (!results.length) return [];
    return Object.keys(results[0]);
  }

  formatCell(val: any): string {
    if (val === null || val === undefined) return '—';
    if (typeof val === 'number') {
      return Math.abs(val) >= 1000 ? val.toLocaleString('en-US', { maximumFractionDigits: 1 }) : String(val.toFixed(2));
    }
    return String(val);
  }

  formatInsight(text: string): string {
    // Convert newlines to paragraph breaks
    return text
      .split(/\n\n+/)
      .map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`)
      .join('');
  }
}
