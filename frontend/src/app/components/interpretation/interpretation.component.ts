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
    const isNational = !this.countyName;
    const indicators = s?.indicators ?? {};

    const dynamicInsights = this.generateDynamicInsights(s, county, isNational);

    const depRatio = s?.dependency_ratio ?? indicators['dependency_ratio'];
    const sexRatio = s?.sex_ratio ?? indicators['sex_ratio'];

    this.sections.set([
      {
        id: 'dynamic',
        title: isNational ? 'Kenya National Overview' : `${county} Insights`,
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
            ? `${county}'s dependency ratio of ${depRatio.toFixed(1)} means for every 100 working-age people, there are approximately ${depRatio.toFixed(0)} dependants — placing direct pressure on health financing and social services.`
            : 'Kenya typically has a high dependency ratio driven by its young population structure — approximately 40% of the population is under 15.',
          'A high dependency ratio strains healthcare budgets and economic productivity. It signals the need for robust child health programmes, nutrition interventions, and investment in education.',
          'As the youth population matures into working age, a "demographic dividend" may emerge — a period of accelerated economic growth if adequate employment and health infrastructure exist.',
        ],
        open: false,
      },
      {
        id: 'age-structure',
        title: 'Age Structure & Health Planning',
        icon: 'elderly',
        content: [
          'Population age structure directly determines the disease burden and the mix of health services required at county level.',
          'A young population (high under-5 proportion) demands strong maternal and child health (MCH) services, immunisation programmes, and nutrition interventions.',
          s?.children_under_5 != null && s?.total_population
            ? `${county}'s under-5 population represents ${((s.children_under_5 / s.total_population) * 100).toFixed(1)}% of the total — ${s.children_under_5 / s.total_population > 0.15 ? 'a significant child health burden requiring prioritised paediatric investment' : 'a moderate child share with manageable MCH demands'}.`
            : 'Counties with a high proportion of children under 5 require expanded immunisation outreach, nutrition programmes, and skilled birth attendant coverage.',
          'Counties with older age structures face growing non-communicable disease (NCD) burdens: hypertension, diabetes, and cancer requiring long-term chronic disease management capacity.',
          'Population density varies widely across Kenya — from dense urban counties like Nairobi and Mombasa to sparse arid counties in the north — requiring different service delivery models.',
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
            : 'Nationally, Kenya\'s sex ratio is approximately 97–99 males per 100 females, indicating near parity with a slight female majority.',
          'Divergent sex ratios often signal rural-urban migration patterns: males migrate to cities for employment, inflating urban sex ratios and depleting rural working-age male populations.',
          'Gender-equitable health planning must address distinct needs: maternal and reproductive health for women, occupational health and injury prevention for male-dominated industries.',
        ],
        open: false,
      },
      {
        id: 'policy',
        title: 'Policy Implications',
        icon: 'policy',
        content: [
          '🏥 Health Facilities: Population projections (2021–2025) should drive facility construction and staffing targets in the Kenya Health Sector Strategic Plan.',
          '💊 Medicine Supply: Age-sex cohort estimates inform quantification of essential medicines — particularly for reproductive health, paediatrics, and geriatric care.',
          '📚 Education: Under-15 population size determines school infrastructure requirements; tracking cohort sizes helps anticipate future workforce entry.',
          '📈 Growth Trend: WorldPop 2021–2025 projections show continued population growth across all counties, requiring systematic long-term infrastructure investment.',
          '🌍 Climate Resilience: Arid and semi-arid counties (ASAL) with sparse populations face distinct climate-health challenges requiring mobile outreach and community health worker models.',
        ],
        open: false,
      },
      {
        id: 'data-notes',
        title: 'Data Notes',
        icon: 'info',
        content: [
          'Population data is sourced from WorldPop Global Project 2025 (R2025A) — high-resolution gridded population estimates at 1km resolution.',
          'Indicators are calculated from age-sex specific raster files covering 21 age bands (0–1, 1–4, 5–9 … 80+) for both male and female populations.',
          'Data covers projection years 2021–2025, aggregated to Kenya\'s 47 county boundaries using the GADM administrative boundary dataset.',
          'County boundaries follow the 2010 Constitution of Kenya administrative units (47 counties).',
          'Derived indicators (dependency ratio, sex ratio, pct_children, pct_elderly) are computed from the WorldPop age-sex counts using standard demographic formulae.',
        ],
        open: false,
      },
    ]);
  }

  private generateDynamicInsights(s: CountySummary | null, county: string, isNational: boolean): string[] {
    if (!s || (!s.total_population && !s.dependency_ratio)) {
      return [
        `Select a county on the map to view tailored demographic insights for that county.`,
        `The insights panel will automatically populate with context-sensitive analysis based on the county's population structure, dependency ratio, and growth trends.`,
        `Data is sourced from WorldPop 2021–2025 high-resolution gridded population estimates covering all 47 Kenya counties.`,
      ];
    }

    const insights: string[] = [];
    const indicators = s.indicators ?? {};
    const depRatio  = s.dependency_ratio ?? indicators['dependency_ratio'];
    const sexRatio  = s.sex_ratio        ?? indicators['sex_ratio'];
    const childPop  = s.children_under_5 ?? indicators['children_under_5'];
    const elderly   = s.elderly_65plus   ?? indicators['elderly_65plus'];
    const totalPop  = s.total_population ?? indicators['total_population'];

    // 1. Population size
    if (totalPop) {
      insights.push(
        isNational
          ? `Kenya's estimated total population is ${this.fmtLarge(totalPop)} in ${s.year} (WorldPop R2025A). Sustained growth requires proportional expansion of health facilities, water, and sanitation infrastructure across all 47 counties.`
          : `${county} had an estimated population of ${this.fmtLarge(totalPop)} in ${s.year}. ${totalPop > 1_000_000 ? 'As a high-population county, facility capacity and staff-to-patient ratios require close monitoring.' : 'Resource allocation should reflect the county\'s population size relative to national totals.'}`
      );
    }

    // 2. Children under 5
    if (childPop && totalPop) {
      const pct = (childPop / totalPop * 100).toFixed(1);
      insights.push(
        `Children under 5 number ${this.fmtLarge(childPop)} (${pct}% of population). ${Number(pct) > 15 ? 'This high share demands prioritised investment in immunisation coverage, growth monitoring, and skilled birth attendants.' : 'Continued investment in MCH services is essential to sustain child survival gains.'}`
      );
    }

    // 3. Dependency ratio
    if (depRatio != null) {
      if (depRatio > 80) {
        insights.push(`High dependency ratio (${depRatio.toFixed(1)}) — for every 100 workers, ${depRatio.toFixed(0)} are dependants. This places heavy fiscal pressure on health and social services, demanding efficient public spending.`);
      } else if (depRatio < 50) {
        insights.push(`Low dependency ratio (${depRatio.toFixed(1)}) — a large working-age population creates a window for demographic dividend. Investing in youth health, skills, and employment maximises this opportunity.`);
      } else {
        insights.push(`Moderate dependency ratio (${depRatio.toFixed(1)}) — a reasonably balanced age structure. Sustained investment in preventive health and education will preserve this advantage.`);
      }
    }

    // 4. Elderly population
    if (elderly && totalPop) {
      const pct = (elderly / totalPop * 100).toFixed(1);
      insights.push(
        `The elderly population (65+) stands at ${this.fmtLarge(elderly)} (${pct}%). ${Number(pct) > 4 ? 'Growing elderly numbers signal rising demand for NCD management (hypertension, diabetes, arthritis) and elder care services.' : 'While the elderly share is currently modest, proactive NCD screening programmes should be established now before the burden grows.'}`
      );
    }

    // 5. Sex ratio
    if (sexRatio != null) {
      insights.push(
        sexRatio > 105
          ? `Sex ratio of ${sexRatio.toFixed(1)} males per 100 females indicates male in-migration — likely driven by economic activity. Health services should address occupational health, male reproductive health, and injury prevention.`
          : sexRatio < 95
          ? `Sex ratio of ${sexRatio.toFixed(1)} males per 100 females suggests male out-migration. The higher female share increases demand for maternal health, gender-based violence services, and female-headed household support.`
          : `Sex ratio of ${sexRatio.toFixed(1)} males per 100 females is near parity — health planning should maintain gender-balanced service provision covering both maternal health and male-specific health needs.`
      );
    }

    return insights;
  }

  private sexRatioContext(ratio: number): string {
    if (ratio > 110) return 'strongly male-dominated, possibly due to mining, construction, or security sector employment.';
    if (ratio > 105) return 'slightly male-dominated, consistent with urban economic migration patterns.';
    if (ratio < 90)  return 'strongly female-dominated, may indicate high male out-migration.';
    if (ratio < 95)  return 'slightly female-dominated within the normal demographic range.';
    return 'near perfect demographic parity.';
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

