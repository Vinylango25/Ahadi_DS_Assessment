// ============================================================
// Ahadi — Interpretation / Insights Panel Component
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

export interface InsightSection {
  id: string;
  title: string;
  icon: string;
  content: string[];
  open: boolean;
}

@Component({
  selector: 'app-interpretation',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],
  templateUrl: './interpretation.component.html',
  styleUrls: ['./interpretation.component.scss'],
})
export class InterpretationComponent implements OnChanges {
  @Input() countyName = '';
  @Input() summary: CountySummary | null = null;
  @Input() year = 2019;
  @Input() indicatorId = 'total_population';
  @Input() indicatorLabel = 'Total Population';

  private readonly cdr = inject(ChangeDetectorRef);

  sections = signal<InsightSection[]>([]);

  ngOnChanges(_: SimpleChanges): void {
    this.buildSections();
    this.cdr.markForCheck();
  }

  toggleSection(id: string): void {
    this.sections.update(sections =>
      sections.map(s => s.id === id ? { ...s, open: !s.open } : s)
    );
  }

  private buildSections(): void {
    const s = this.summary;
    const county = this.countyName || 'Kenya';
    const indicators = s?.indicators ?? {};

    // Dynamic insights
    const dynamicInsights = this.generateDynamicInsights(s, county);

    const depRatio = s?.dependency_ratio ?? indicators['dependency_ratio'];
    const sexRatio = s?.sex_ratio ?? indicators['sex_ratio'];
    const growthRate = null; // not in backend schema
    const density = null; // not in backend schema

    this.sections.set([
      {
        id: 'dynamic',
        title: `${county} Insights`,
        icon: 'lightbulb',
        content: dynamicInsights,
        open: true,
      },
      {
        id: 'dependency',
        title: 'Dependency Ratio Explained',
        icon: 'balance',
        content: [
          'The dependency ratio measures the proportion of dependants (children under 15 and elderly 65+) relative to the working-age population (15–64).',
          depRatio != null
            ? `${county}'s dependency ratio of ${depRatio.toFixed(1)}% means that for every 100 working-age people, there are approximately ${depRatio.toFixed(0)} dependants.`
            : 'Kenya typically has a high dependency ratio driven by its young population structure — approximately 40% of the population is under 15.',
          'A high dependency ratio strains social services, healthcare budgets, and economic productivity. It indicates the need for robust child health programmes and investment in education.',
          'As the youth population grows into working age, a "demographic dividend" may emerge — a period of accelerated economic growth if adequate employment opportunities exist.',
        ],
        open: false,
      },
      {
        id: 'age-structure',
        title: 'Age Structure & Health Planning',
        icon: 'elderly',
        content: [
          'Population age structure directly determines the disease burden and the mix of health services required at county level.',
          'A young population (under-5 and under-15 bulge) demands strong maternal and child health (MCH) services, immunisation programmes, and nutrition interventions.',
          'Kenya\'s 2019 census showed a median age of approximately 20 years nationally, indicating a predominantly young population.',
          'Counties with older age structures face growing non-communicable disease (NCD) burdens: hypertension, diabetes, and cancer require long-term chronic disease management capacity.',
          density != null
            ? `${county}'s population density informs spatial planning for health facility distribution.`
            : 'Population density varies widely across Kenya — from dense urban counties like Nairobi and Mombasa to sparse arid counties in the north.',
        ],
        open: false,
      },
      {
        id: 'sex-ratio',
        title: 'Sex Ratio & Gender Equity',
        icon: 'wc',
        content: [
          'The sex ratio (males per 100 females) reflects underlying biological, social, and migration patterns.',
          sexRatio != null
            ? `${county}'s sex ratio of ${sexRatio.toFixed(1)} indicates ${sexRatio > 100 ? 'more males than females' : sexRatio < 100 ? 'more females than males' : 'near parity'} — ${this.sexRatioContext(sexRatio)}`
            : 'Nationally, Kenya\'s sex ratio is approximately 97–99 males per 100 females, indicating near parity with slight female majority.',
          'Divergent sex ratios often signal rural-urban migration patterns: males migrate to cities for employment, inflating urban sex ratios and depleting rural working-age male populations.',
          'Gender-equitable health planning must address distinct needs: maternal health for women, occupational health and injury for male-dominated industries.',
        ],
        open: false,
      },
      {
        id: 'policy',
        title: 'Policy Implications',
        icon: 'policy',
        content: [
          '🏥 Health Facilities: Population growth projections should drive facility construction and staffing targets in the Kenya Health Sector Strategic Plan.',
          '💊 Medicine Supply: Estimated population by age-sex cohort informs quantification of essential medicines, particularly for reproductive health, paediatrics, and geriatric care.',
          '📚 Education: Under-15 population size determines school infrastructure requirements; tracking cohort sizes helps anticipate future workforce entry.',
          growthRate != null
            ? `📈 Growth Rate: ${county} is growing. ${this.growthContext(growthRate)}`
            : '📈 Growth Rate: Kenya\'s national growth rate of ~2.2% per year (2019) means doubling time of ~32 years, requiring systematic long-term infrastructure planning.',
          '🌍 Climate Resilience: Arid and semi-arid counties with sparse populations face distinct climate-health challenges requiring tailored interventions beyond national averages.',
        ],
        open: false,
      },
      {
        id: 'data-notes',
        title: 'Data Notes',
        icon: 'info',
        content: [
          'Population data is sourced from Kenya National Bureau of Statistics (KNBS) census records (2009, 2019) and intercensal projections.',
          'Indicators are calculated from raw age-sex tabulations using standard demographic methods.',
          'County boundaries follow the 2010 Constitution of Kenya administrative units (47 counties).',
          'Some indicators may show \'—\' where data was not collected, suppressed for confidentiality, or not yet ingested into the system.',
        ],
        open: false,
      },
    ]);
  }

  private generateDynamicInsights(s: CountySummary | null, county: string): string[] {
    if (!s) {
      return [
        `Select a county on the map to view tailored demographic insights for that county.`,
        `The insights panel will automatically populate with context-sensitive analysis based on the county's population structure, dependency ratio, and growth trends.`,
        `National-level data for Kenya (2019 census) covers all 47 counties with indicators including age-sex structure, population density, and dependency ratios.`,
      ];
    }

    const insights: string[] = [];
    const indicators = s.indicators ?? {};
    const depRatio = s.dependency_ratio ?? indicators['dependency_ratio'];
    const sexRatio = s.sex_ratio ?? indicators['sex_ratio'];
    const growthRate = null; // not in backend schema

    insights.push(`${county} had a total population of ${this.fmtLarge(s.total_population ?? 0)} in ${s.year}.`);

    if (depRatio != null) {
      if (depRatio > 80) {
        insights.push(`High dependency ratio (${depRatio.toFixed(1)}%) — significant pressure on working-age population to support dependants.`);
      } else if (depRatio < 50) {
        insights.push(`Low dependency ratio (${depRatio.toFixed(1)}%) — relatively large working-age population, potential for demographic dividend.`);
      } else {
        insights.push(`Moderate dependency ratio (${depRatio.toFixed(1)}%) — balanced age structure with manageable social support demands.`);
      }
    }

    if (sexRatio != null) {
      if (sexRatio > 105) {
        insights.push(`Male-skewed sex ratio (${sexRatio.toFixed(1)}) — may reflect male in-migration for economic activity.`);
      } else if (sexRatio < 95) {
        insights.push(`Female-skewed sex ratio (${sexRatio.toFixed(1)}) — may reflect male out-migration or higher male mortality.`);
      }
    }

    // growthRate not in backend schema — skip
    // population_density not in backend schema — skip

    return insights;
  }

  private sexRatioContext(ratio: number): string {
    if (ratio > 110) return 'strongly male-dominated, possibly due to mining, construction, or security sector employment.';
    if (ratio > 105) return 'slightly male-dominated, consistent with urban economic migration patterns.';
    if (ratio < 90)  return 'strongly female-dominated, may indicate high male out-migration.';
    if (ratio < 95)  return 'slightly female-dominated within the normal demographic range.';
    return 'near perfect demographic parity.';
  }

  private growthContext(rate: number): string {
    if (rate > 3.0) return 'Very rapid growth: infrastructure and services face significant expansion pressure.';
    if (rate > 2.0) return 'Above-average growth: sustained investment in health, education, and housing required.';
    if (rate > 1.0) return 'Moderate growth: manageable with consistent planning and investment.';
    if (rate > 0)   return 'Slow growth: stable population — focus on quality of services.';
    return 'Population decline or stabilisation — potential economic concerns.';
  }

  private densityContext(density: number): string {
    if (density > 1000) return 'Very high density — urban county requiring intensive urban health services.';
    if (density > 200)  return 'High density — significant urbanisation with mixed urban-rural service needs.';
    if (density > 50)   return 'Moderate density — balanced rural-urban service delivery.';
    if (density > 10)   return 'Low density — rural county requiring outreach services.';
    return 'Very sparse — ASAL county requiring mobile and outreach health solutions.';
  }

  private fmtLarge(n: number): string {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
    if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
    return n.toLocaleString();
  }

  trackById(_: number, s: InsightSection): string {
    return s.id;
  }
}

