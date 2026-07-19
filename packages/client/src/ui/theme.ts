// M1 art direction (PLAN.md §5.1). Palette lives here; screens consume it.
export const COLORS = {
  ink: "#1a0508",
  plaster: "#e8dcc4",
  blood: "#c0182b",
  marigold: "#f5a623",
  ghost: "#7fd8d8",
  cream: "#f3ead5",
} as const;

// Eight fixed avatars (wedding-guest wardrobe), referenced by index (§5.1).
export const AVATARS = [
  "Safari-suit Uncle",
  "Kanjeevaram Aunty",
  "Gym Bhaiya",
  "Shaadi Photographer",
  "Sanskaari Beti",
  "Startup Bro",
  "Padosan",
  "Chacha Ji",
] as const;

export function avatarLabel(i: number): string {
  return AVATARS[i % AVATARS.length]!;
}
