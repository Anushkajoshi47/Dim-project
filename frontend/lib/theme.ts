/**
 * Chart palette.
 *
 * Dark-mode-only mission console. The four categorical series slots are used in
 * this fixed order and never cycled; the order itself is the colour-vision-
 * deficiency safety mechanism, and it was validated with the dataviz validator
 * against this console's chart surface (#111820):
 *
 *   lightness band PASS · chroma floor PASS · worst adjacent CVD ΔE 8.4 (protan)
 *   · worst adjacent normal-vision ΔE 19.8 · contrast vs surface PASS
 *
 * Status colours are reserved for spacecraft state and event severity. They are
 * never used as a series colour, and never carry meaning without an
 * accompanying label. The UI accent is chrome only (active borders, selected
 * controls) and never appears as a data mark.
 */

/** Categorical series slots — assign in order, never cycle. */
export const SERIES = ['#3987e5', '#d95926', '#199e70', '#c98500'] as const;

/** Reserved state colours. Always paired with a text label. */
export const STATUS = {
  good: '#0ca30c',
  warning: '#fab219',
  serious: '#ec835a',
  critical: '#d03b3b',
} as const;

/** Chart chrome. */
export const CHROME = {
  surface: '#111820',
  grid: '#1e2833',
  axis: '#2b3947',
  muted: '#7d8b9c',
  secondary: '#a9b6c4',
  primary: '#e8eef5',
  accent: '#34d3c0',
} as const;

/** Named thermal sensors mapped to fixed series slots, so a colour never moves. */
export const THERMAL_COLORS: Record<string, string> = {
  TEMP_BAT: SERIES[0],
  TEMP_OBC: SERIES[1],
  TEMP_RF: SERIES[2],
  TEMP_STR: SERIES[3],
};

export const SEVERITY_COLOR: Record<string, string> = {
  INFO: CHROME.secondary,
  SUCCESS: STATUS.good,
  WARN: STATUS.warning,
  CRITICAL: STATUS.critical,
};

export const STATUS_COLOR: Record<string, string> = {
  NOMINAL: STATUS.good,
  DEGRADED: STATUS.warning,
  ANOMALY: STATUS.critical,
};