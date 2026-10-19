export const INSTAGRAM_HANDLE = "mithilesh_lifts";
export const INSTAGRAM_URL = `https://www.instagram.com/${INSTAGRAM_HANDLE}/`;
export const INSTAGRAM_DM_URL = `https://ig.me/m/${INSTAGRAM_HANDLE}`;

export const socials = [
  { name: "Instagram", href: INSTAGRAM_URL },
  { name: "X", href: `https://x.com/${INSTAGRAM_HANDLE}` },
  { name: "Threads", href: `https://www.threads.com/@${INSTAGRAM_HANDLE}` },
  // TODO: add YouTube channel once confirmed
];

export type ClientResult = {
  name: string;
  image: string;
  width: number;
  height: number;
  alt: string;
  delta: string;
  unit?: string;
  detail: string;
};

export const results: ClientResult[] = [
  {
    name: "Koti",
    image: "/results/koti.jpg",
    width: 1100,
    height: 1100,
    alt: "Koti before and after: 88 kg to 77.1 kg, front view",
    delta: "−10.9",
    unit: "kg",
    detail: "88 → 77.1 kg",
  },
  {
    name: "Yogesh Agarwal",
    image: "/results/yogesh-agarwal.jpg",
    width: 733,
    height: 1100,
    alt: "Yogesh Agarwal before and after: 91.5 kg to 83.6 kg, front view",
    delta: "−7.9",
    unit: "kg",
    detail: "91.5 → 83.6 kg",
  },
  {
    name: "Sai Teja",
    image: "/results/sai-teja.jpg",
    width: 946,
    height: 1100,
    alt: "Sai Teja before and after: leaner waist and visibly bigger arms and shoulders",
    delta: "Recomp",
    detail: "Leaner waist, bigger arms and shoulders",
  },
  {
    name: "Rajashekhar",
    image: "/results/rajashekhar.jpg",
    width: 1200,
    height: 800,
    alt: "Rajashekhar back view at week 1, 71 kg, and week 6, 68.7 kg",
    delta: "6",
    unit: "weeks",
    detail: "71 → 68.7 kg, wider back",
  },
];

export const BRAND = "Coach Scale Systems";
export const COACH_NAME = "Mithilesh Reddy";
/** Public brand — matches his Instagram handle so ManyChat leads recognise it. */
export const BRAND_NAME = "mithilesh_lifts";

/** Mithilesh's own words (client-supplied; lightly copy-edited). */
export const quote = {
  full: "I transformed from obese to skinny to muscular through science-based lifting. I had no coach during my transformation. I figured everything out myself, then got certified in fitness and nutrition. I've transformed 150+ clients so far.",
  short: "I had no coach during my transformation. I figured everything out myself.",
};

export type Stage = { key: string; step: string; label: string; image: string; width: number; height: number; alt: string };

/** His own transformation, in order. */
export const stages: Stage[] = [
  {
    key: "heavy",
    step: "01",
    label: "Obese",
    image: "/mithilesh/stage-heavy.jpg",
    width: 1200,
    height: 1600,
    alt: "Mithilesh at his heaviest, smiling outdoors in a loose striped T-shirt",
  },
  {
    key: "skinny",
    step: "02",
    label: "Skinny",
    image: "/mithilesh/stage-skinny.jpg",
    width: 1200,
    height: 1600,
    alt: "Mithilesh in his skinny phase, standing in a gym in a vest and shorts",
  },
  {
    key: "muscular",
    step: "03",
    label: "Muscular",
    image: "/mithilesh/stage-muscular.jpg",
    width: 1200,
    height: 1594,
    alt: "Mithilesh today, shirtless in the gym with a muscular, lean physique",
  },
];

export const portrait = {
  image: "/mithilesh/portrait.jpg",
  width: 1086,
  height: 1600,
  alt: "Mithilesh Reddy in a side pose in a dimly lit gym, showing his arms, chest and back",
};

export const backPose = {
  image: "/mithilesh/back-pose.jpg",
  width: 1200,
  height: 1594,
  alt: "Mithilesh from behind, flexing a back double-biceps pose in the gym",
};

export const facts = [
  { label: "Clients transformed", value: "150+" },
  { label: "Certified in", value: "Fitness & nutrition" },
  { label: "Instagram", value: "251K followers" },
  { label: "Television", value: "Bigg Boss Telugu 10" },
];

export const navLinks = [
  { key: "home", href: "/", label: "Home" },
  { key: "results", href: "/results", label: "Results" },
  { key: "bigg-boss", href: "/bigg-boss", label: "Bigg Boss" },
  { key: "about", href: "/about", label: "About" },
] as const;

export type NavKey = (typeof navLinks)[number]["key"] | "book" | "none";

/** Shown on content pages (no session there). TODO: keep in sync with Settings.callMinutes (default 30). */
export const DEFAULT_CALL_MINUTES = 30;
