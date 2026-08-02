// Auto-detect heuristic for an unknown (doctor, device) pair.
// Per D-06 + CONTEXT.md Q-A: surfaces the matched regex group as audit metadata.
//
// SD patterns win over HD patterns. Anything else falls back to HD.

export type InferredPreset = 'sd' | 'hd';

export type MatchedPattern =
  | 'sd-pattern-EasyCap'
  | 'sd-pattern-USBVideo'
  | 'sd-pattern-USB2.0TV'
  | 'sd-pattern-CVBS'
  | 'sd-pattern-Composite'
  | 'sd-pattern-SVideo'
  | 'hd-pattern-HDMI'
  | 'hd-pattern-1080p'
  | 'hd-pattern-HD'
  | 'hd-pattern-Digital'
  | 'hd-pattern-DVI'
  | 'hd-pattern-UVC'
  | 'hd-pattern-fallback';

type SdPattern = {
  matched: Extract<
    MatchedPattern,
    | 'sd-pattern-EasyCap'
    | 'sd-pattern-USBVideo'
    | 'sd-pattern-USB2.0TV'
    | 'sd-pattern-CVBS'
    | 'sd-pattern-Composite'
    | 'sd-pattern-SVideo'
  >;
  re: RegExp;
};

const SD_PATTERNS: SdPattern[] = [
  { matched: 'sd-pattern-EasyCap', re: /EasyCap/i },
  { matched: 'sd-pattern-USBVideo', re: /USB\s*Video/i },
  { matched: 'sd-pattern-USB2.0TV', re: /USB\s*2\.0\s*TV/i },
  { matched: 'sd-pattern-CVBS', re: /CVBS/i },
  { matched: 'sd-pattern-Composite', re: /Composite/i },
  { matched: 'sd-pattern-SVideo', re: /S[-‐ー]?Video/i },
];

type HdPattern = {
  matched: Extract<
    MatchedPattern,
    | 'hd-pattern-HDMI'
    | 'hd-pattern-1080p'
    | 'hd-pattern-HD'
    | 'hd-pattern-Digital'
    | 'hd-pattern-DVI'
    | 'hd-pattern-UVC'
  >;
  re: RegExp;
};

const HD_PATTERNS: HdPattern[] = [
  { matched: 'hd-pattern-HDMI', re: /HDMI/i },
  { matched: 'hd-pattern-1080p', re: /1080p/i },
  { matched: 'hd-pattern-HD', re: /\bHD\b/i },
  { matched: 'hd-pattern-Digital', re: /Digital/i },
  { matched: 'hd-pattern-DVI', re: /DVI/i },
  { matched: 'hd-pattern-UVC', re: /UVC/i },
];

export function autoDetectPreset(canonicalName: string): {
  preset: InferredPreset;
  matched: MatchedPattern;
} {
  for (const p of SD_PATTERNS) {
    if (p.re.test(canonicalName)) return { preset: 'sd', matched: p.matched };
  }
  for (const p of HD_PATTERNS) {
    if (p.re.test(canonicalName)) return { preset: 'hd', matched: p.matched };
  }
  return { preset: 'hd', matched: 'hd-pattern-fallback' };
}

export const _internals = { SD_PATTERNS, HD_PATTERNS };
