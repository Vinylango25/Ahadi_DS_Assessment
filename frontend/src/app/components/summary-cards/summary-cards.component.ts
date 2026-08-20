// ============================================================
// Ahadi — Summary Cards Component
// ============================================================
import {
  Component,
  Input,
  OnChanges,
  SimpleChanges,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { CountySummary } from '../../models/population.model';

export interface MetricCard {
  id: string;
  icon: string;
  label: string;
  description: string;
  value: number | null;
  formatted: string;
  unit?: string;
  accentClass: string;
}

@Component({
  selector: 'app-summary-cards',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],
  templateUrl: './summary-cards.component.html',
  styleUrls: ['./summary-cards.component.scss'],
})
export class SummaryCardsComponent implements OnChanges {
  @Input() summary: CountySummary | null = null;
  @Input() year = 2019;
  @Input() county = '';

  private readonly cdr = inject(ChangeDetectorRef);

  cards = signal<MetricCard[]>([]);

  ngOnChanges(_: SimpleChanges): void {
    this.buildCards();
    this.cdr.markForCheck();
  }

  private buildCards(): void {
    const s = this.summary;
    const indicators = s?.indicators ?? {};

    const totalPop = s?.total_population ?? indicators['total_population'] ?? null;
    const depRatio = s?.dependency_ratio ?? indicators['dependency_ratio'] ?? null;
    const childrenU5 = indicators['children_under_5'] ?? null;
    const elderly = indicators['elderly_65plus'] ?? null;
    const sexRatio = s?.sex_ratio ?? indicators['sex_ratio'] ?? null;

    this.cards.set([
      {
        id: 'total_population',
        icon: 'groups',
        label: 'Total Population',
        description: this.county ? `${this.county} · ${this.year}` : `Kenya · ${this.year}`,
        value: totalPop,
        formatted: totalPop !== null ? this.fmtLarge(totalPop) : '—',
        accentClass: 'accent-primary',
      },
      {
        id: 'dependency_ratio',
        icon: 'balance',
        label: 'Dependency Ratio',
        description: 'Dependants per 100 working-age',
        value: depRatio,
        formatted: depRatio !== null ? depRatio.toFixed(1) : '—',
        unit: '%',
        accentClass: 'accent-secondary',
      },
      {
        id: 'children_under_5',
        icon: 'child_care',
        label: 'Children Under 5',
        description: 'Under-five population',
        value: childrenU5,
        formatted: childrenU5 !== null ? this.fmtLarge(childrenU5) : '—',
        accentClass: 'accent-teal',
      },
      {
        id: 'elderly_65plus',
        icon: 'elderly',
        label: 'Elderly (65+)',
        description: 'Population aged 65 and above',
        value: elderly,
        formatted: elderly !== null ? this.fmtLarge(elderly) : '—',
        accentClass: 'accent-purple',
      },
      {
        id: 'sex_ratio',
        icon: 'wc',
        label: 'Sex Ratio',
        description: 'Males per 100 females',
        value: sexRatio,
        formatted: sexRatio !== null ? sexRatio.toFixed(1) : '—',
        unit: 'M/100F',
        accentClass: 'accent-gold',
      },
    ]);
  }

  private fmtLarge(n: number): string {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
    if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
    return n.toLocaleString();
  }

  trackById(_: number, card: MetricCard): string {
    return card.id;
  }
}
