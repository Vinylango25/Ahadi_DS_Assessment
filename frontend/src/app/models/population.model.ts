// ============================================================
// Ahadi Kenya Population Analytics — Data Models
// Aligned with backend schemas.py (Pydantic v2)
// ============================================================

// ── Reference / metadata ────────────────────────────────────

/** County reference — backend returns plain string list, this wraps it */
export interface County {
  name: string;
  code: string;    // same as name when backend returns strings
  region?: string;
}

/** Indicator metadata from GET /api/indicators */
export interface Indicator {
  id: string;          // maps to IndicatorMeta.key
  label: string;       // IndicatorMeta.label
  unit?: string;
  category?: string;
  description?: string;
}

/** Backend IndicatorsResponse wrapper */
export interface IndicatorsResponse {
  indicators: Array<{
    key: string;
    label: string;
    unit?: string;
    description?: string;
  }>;
}

// ── County summary ───────────────────────────────────────────

/** Matches backend CountySummary schema */
export interface CountySummary {
  county: string;
  year: number;
  total_population?: number | null;
  children_under_5?: number | null;
  working_age?: number | null;
  elderly_65plus?: number | null;
  sex_ratio?: number | null;
  dependency_ratio?: number | null;
  child_dependency_ratio?: number | null;
  elderly_dependency_ratio?: number | null;
  pct_children?: number | null;
  pct_elderly?: number | null;
  county_area_km2?: number | null;
  // Legacy compat fields
  indicators?: Record<string, number>;
  county_code?: string;
}

// ── Choropleth ───────────────────────────────────────────────

/** Single entry in the choropleth data — extracted from GeoJSON properties */
export interface ChoroplethEntry {
  county: string;
  value: number;
  rank?: number;
}

/** Frontend-constructed choropleth data after parsing GeoJSON features */
export interface ChoroplethData {
  year: number;
  indicator: string;
  unit?: string;
  label?: string;
  min: number;
  max: number;
  mean: number;
  entries: ChoroplethEntry[];
}

// ── Timeseries ───────────────────────────────────────────────

/** Matches backend TimeseriesPoint */
export interface TimeseriesPoint {
  year: number;
  value?: number | null;
}

/** Matches backend NationalTimeseries */
export interface TimeseriesData {
  scope: string;       // 'Kenya' or county name
  indicator: string;
  data: TimeseriesPoint[];
  // Alias for component compatibility
  series?: TimeseriesPoint[];
}

// ── Age pyramid ──────────────────────────────────────────────

/** Matches backend AgeGroup */
export interface AgePyramidRow {
  age_group: string;
  male: number;
  female: number;
  male_pct?: number;
  female_pct?: number;
}

/** Matches backend AgePyramid */
export interface AgePyramidData {
  county: string;
  year: number;
  age_groups: AgePyramidRow[];   // backend field name
  // Alias for component compatibility
  rows?: AgePyramidRow[];
  total_male?: number;
  total_female?: number;
  total_population?: number;
}

// ── Comparison ───────────────────────────────────────────────

/** Matches backend CountyIndicatorValue */
export interface ComparisonEntry {
  county: string;
  value?: number | null;
  rank?: number;
  change_from_prev?: number;
  county_code?: string;
}

/** Matches backend ComparisonResult */
export interface ComparisonData {
  year: number;
  indicator: string;
  unit?: string;
  label?: string;
  top: ComparisonEntry[];      // backend field
  bottom: ComparisonEntry[];   // backend field
  // Legacy: entries alias (top 10 merged for bar chart)
  n?: number;
  entries?: ComparisonEntry[];
}

// ── Generic ─────────────────────────────────────────────────

export interface ApiError {
  detail: string;
  status_code?: number;
}
