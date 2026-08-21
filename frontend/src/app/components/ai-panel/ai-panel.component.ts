// ============================================================
// Ahadi — AI Insights & Natural Language Query Panel
// Uses Groq qwen3.6-27b · Rich visualizations via ECharts
// ============================================================
import {
  Component,
  Input,
  OnChanges,
  SimpleChanges,
  inject,
  signal,
  computed,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { catchError } from 'rxjs/operators';
import { of } from 'rxjs';
import { environment } from '../../../environments/environment';
import { CountySummary } from '../../models/population.model';
import { ChartRendererComponent, classifyChart, ChartConfig } from '../chart-renderer/chart-renderer.component';

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
  imports: [CommonModule, FormsModule, ChartRendererComponent],
  template: `
    <div class="ai-panel">

      <!-- Header -->
      <div class="ai-header">
        <div class="ai-title">
          <span class="material-symbols-rounded ai-icon">auto_awesome</span>
          <div>
            <h3 class="ai-name">AI Insights</h3>
            <p class="ai-sub">Powered by Qwen 3 · Groq</p>
          </div>
        </div>
        <div class="ai-tabs">
          <button class="ai-tab" [class.active]="activeTab() === 'query'" (click)="setTab('query')">
            <span class="material-symbols-rounded">manage_search</span> Ask Data
          </button>
          <button class="ai-tab" [class.active]="activeTab() === 'insight'" (click)="setTab('insight')">
            <span class="material-symbols-rounded">lightbulb</span> Insights
          </button>
        </div>
      </div>

      <!-- ── Insight tab ─────────────────────────────────── -->
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

      <!-- ── NL Query tab ───────────────────────────────── -->
      @if (activeTab() === 'query') {
        <div class="query-body">

          <!-- Example chips -->
          <div class="example-row">
            <span class="example-label">Try:</span>
            @for (q of exampleQuestions; track q) {
              <button class="example-chip" (click)="setQuestion(q)">{{ q }}</button>
            }
          </div>

          <!-- Input row -->
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

          <!-- Loading skeleton -->
          @if (loadingQuery()) {
            <div class="loading-pulse">
              <span class="material-symbols-rounded spin">progress_activity</span>
              Analysing data…
            </div>
          }

          <!-- ── Results ──────────────────────────────── -->
          @if (queryResult() && !loadingQuery()) {
            <div class="query-result animate-fade-in">

              <!-- Answer + AI Insight -->
              @if (queryResult()!.answer) {
                <div class="answer-card">
                  <div class="answer-card-header">
                    <span class="material-symbols-rounded answer-icon">auto_awesome</span>
                    <span class="answer-card-title">AI Analysis</span>
                    <span class="answer-card-meta">{{ queryResult()!.sql }}</span>
                  </div>
                  <div class="answer-insight-body"
                       [innerHTML]="formatInsight(queryResult()!.answer!)">
                  </div>
                </div>
              }

              <!-- ── Visualisation ─────────────────── -->
              @if (chartConfig() && queryResult()!.results && queryResult()!.results.length > 0) {
                <div class="viz-section">
                  <app-chart-renderer
                    [config]="chartConfig()!"
                    [results]="queryResult()!.results">
                  </app-chart-renderer>
                </div>
              }

              <!-- ── Data Table ────────────────────── -->
              @if (queryResult()!.results && queryResult()!.results.length) {
                <div class="results-table-wrap">
                  <div class="table-header-row">
                    <span class="material-symbols-rounded">table_chart</span>
                    <span>
                      Data Table ·
                      {{ queryResult()!.results.length }} row{{ queryResult()!.results.length !== 1 ? 's' : '' }}
                    </span>
                    <span class="table-meta">{{ queryResult()!.sql }}</span>
                  </div>
                  <div class="table-scroll">
                    <table class="results-table">
                      <thead>
                        <tr>
                          <th class="rank-th">#</th>
                          @for (col of tableHeaders(); track col) {
                            <th>{{ formatHeader(col) }}</th>
                          }
                        </tr>
                      </thead>
                      <tbody>
                        @for (row of queryResult()!.results.slice(0, 20); track $index) {
                          <tr [class.highlight-row]="$index === 0">
                            <td class="rank-cell">{{ $index + 1 }}</td>
                            @for (col of tableHeaders(); track col) {
                              <td [class.county-cell]="col === 'county'"
                                  [class.num-cell]="isNumericCol(col)">
                                {{ formatCell(row[col]) }}
                              </td>
                            }
                          </tr>
                        }
                      </tbody>
                    </table>
                  </div>
                  @if (queryResult()!.results.length > 20) {
                    <p class="table-note">
                      Showing 20 of {{ queryResult()!.results.length }} rows
                    </p>
                  }
                </div>
              }

              <!-- Query intent badge -->
              @if (queryResult()!.sql) {
                <details class="sql-details">
                  <summary class="sql-summary">
                    <span class="material-symbols-rounded">info</span> Query Intent
                  </summary>
                  <pre class="sql-code">{{ queryResult()!.sql }}</pre>
                </details>
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

  readonly activeTab      = signal<'insight' | 'query'>('query');
  readonly loadingInsight = signal(false);
  readonly loadingQuery   = signal(false);
  readonly insightText    = signal<string | null>(null);
  readonly insightError   = signal<string | null>(null);
  readonly queryResult    = signal<NLQueryResult | null>(null);

  userQuestion = '';

  readonly exampleQuestions = [
    'All 47 counties ranked by total population 2025',
    'Top 10 most populous counties in 2025',
    'Counties with population over 1 million in 2025',
    'Population trend for Nairobi 2021 to 2025',
    'Counties where sex ratio exceeds 105 in 2025',
    'Average dependency ratio 2025',
  ];

  // ── Chart config derived from query results ──────────────
  readonly chartConfig = computed((): ChartConfig | null => {
    const r = this.queryResult();
    if (!r?.results?.length) return null;
    const intent = r.sql?.replace(/^\/\*\s*|\s*\*\//g, '').trim() ?? r.question ?? '';
    return classifyChart(intent, r.results);
  });

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['countyName'] || changes['year']) {
      this.insightText.set(null);
      this.insightError.set(null);
    }
  }

  setTab(tab: 'insight' | 'query'): void { this.activeTab.set(tab); }
  setQuestion(q: string): void { this.userQuestion = q; }

  // ── Load county insight ──────────────────────────────────
  loadCountyInsight(): void {
    if (!this.countyName) return;
    this.loadingInsight.set(true);
    this.insightError.set(null);
    this.insightText.set(null);

    this.http.get<AIInsightResponse>(
      `${environment.apiUrl}/api/ai/county-insight`,
      { params: { county: this.countyName, year: this.year } }
    ).pipe(catchError(err => {
      this.insightError.set(err?.error?.detail ?? 'AI insight unavailable. Ensure GROQ_API_KEY is configured.');
      this.loadingInsight.set(false);
      return of(null);
    })).subscribe(res => {
      if (res) this.insightText.set(res.insight);
      this.loadingInsight.set(false);
    });
  }

  // ── Load national insight ────────────────────────────────
  loadNationalInsight(): void {
    this.loadingInsight.set(true);
    this.insightError.set(null);
    this.insightText.set(null);

    this.http.get<AIInsightResponse>(
      `${environment.apiUrl}/api/ai/national-insight`,
      { params: { year: this.year } }
    ).pipe(catchError(err => {
      this.insightError.set(err?.error?.detail ?? 'AI insight unavailable.');
      this.loadingInsight.set(false);
      return of(null);
    })).subscribe(res => {
      if (res) this.insightText.set(res.insight);
      this.loadingInsight.set(false);
    });
  }

  // ── Submit NL query ──────────────────────────────────────
  submitQuery(): void {
    if (!this.userQuestion.trim()) return;
    this.loadingQuery.set(true);
    this.queryResult.set(null);

    this.http.post<NLQueryResult>(
      `${environment.apiUrl}/api/ai/query`,
      { question: this.userQuestion.trim() }
    ).pipe(catchError(err => of({
      question: this.userQuestion,
      sql: null,
      results: [],
      answer: null,
      error: err?.error?.detail ?? 'Query failed.',
    } as NLQueryResult))).subscribe(res => {
      this.queryResult.set(res);
      this.loadingQuery.set(false);
    });
  }

  // ── Table helpers ─────────────────────────────────────────
  tableHeaders(): string[] {
    const results = this.queryResult()?.results ?? [];
    if (!results.length) return [];
    return Object.keys(results[0]);
  }

  isNumericCol(col: string): boolean {
    const r = this.queryResult()?.results;
    if (!r?.length) return false;
    return typeof r[0][col] === 'number';
  }

  formatHeader(col: string): string {
    return col.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  formatCell(val: any): string {
    if (val === null || val === undefined) return '—';
    if (typeof val === 'number') {
      if (!isFinite(val)) return '—';
      return Math.abs(val) >= 1000
        ? val.toLocaleString('en-US', { maximumFractionDigits: 1 })
        : val.toFixed(2);
    }
    return String(val);
  }

  // ── Insight formatter (numbered cards — fully inline styled) ─
  // Must use inline styles because Angular's Emulated encapsulation
  // scopes SCSS classes and they won't match innerHTML-injected HTML.
  formatInsight(text: string): string {
    if (!text) return '';

    const clean = text
      .replace(/<think>[\s\S]*?<\/think>/gi, '')
      .replace(/<think>[\s\S]*/gi, '')
      .replace(/\*\*/g, '')
      .replace(/\*/g, '')
      .trim();

    const pointRegex = /(\d+)\.\s+([^-—\n]+?)\s*[-—–]+\s*([\s\S]*?)(?=\n\s*\d+\.\s+|$)/g;
    const points: Array<{num: string; title: string; body: string}> = [];
    let match;
    while ((match = pointRegex.exec(clean)) !== null) {
      points.push({
        num:   match[1],
        title: match[2].trim(),
        body:  match[3].trim().replace(/\n/g, ' '),
      });
    }

    if (points.length >= 2) {
      // Badge + border cycle through distinct colors; titles are always dark orange
      const palette = [
        { badge: '#00d4aa', tint: 'rgba(0,212,170,0.08)'   },
        { badge: '#a78bfa', tint: 'rgba(167,139,250,0.08)' },
        { badge: '#40c4ff', tint: 'rgba(64,196,255,0.08)'  },
        { badge: '#00e676', tint: 'rgba(0,230,118,0.08)'   },
        { badge: '#ff6b8a', tint: 'rgba(255,107,138,0.08)' },
      ];
      const TITLE_COLOR = '#e65c00'; // dark orange for all subheadings

      return points.map((p, i) => {
        const { badge, tint } = palette[i % palette.length];
        return `
<div style="
  border:1px solid rgba(255,255,255,0.08);
  border-left:4px solid ${badge};
  border-radius:12px;
  overflow:hidden;
  margin-bottom:10px;
  background:var(--surface,#0e1a2b);
">
  <div style="
    display:flex;
    align-items:center;
    gap:10px;
    padding:10px 16px;
    background:${tint};
    border-bottom:1px solid rgba(255,255,255,0.06);
  ">
    <span style="
      display:inline-flex;
      align-items:center;
      justify-content:center;
      width:24px;height:24px;min-width:24px;
      border-radius:50%;
      background:${badge};
      color:#0a0e27;
      font-size:0.74rem;
      font-weight:800;
      flex-shrink:0;
    ">${p.num}</span>
    <span style="
      font-size:0.92rem;
      font-weight:700;
      color:${TITLE_COLOR};
      letter-spacing:0.01em;
      line-height:1.3;
    ">${p.title}</span>
  </div>
  <p style="
    font-size:0.84rem;
    color:var(--text-secondary,#94a3b8);
    line-height:1.7;
    margin:0;
    padding:12px 16px;
  ">${p.body}</p>
</div>`.trim();
      }).join('\n');
    }

    // Fallback: plain paragraphs
    return clean
      .split(/\n\n+/)
      .map(p => `<p style="font-size:0.88rem;line-height:1.65;margin:0 0 8px;color:var(--text-secondary,#94a3b8)">${p.replace(/\n/g, '<br>')}</p>`)
      .join('');
  }
}
