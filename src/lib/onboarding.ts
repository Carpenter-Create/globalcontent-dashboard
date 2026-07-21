// Onboarding copy + feature highlights (content lives in lib/, not JSX). GC voice:
// declarative, no banned words. "Coming soon" items are clearly badged and must never
// read as usable today (brand rule: never invent/promise capabilities). Which items are
// live vs. coming-soon is a founder call — adjust `status` here, not in the component.

export const ONBOARDING_WELCOME = {
  eyebrow: "Global Content",
  title: "Welcome to Global Content",
  subtitle: "A few steps to set up your account. Here's what you'll be able to do.",
} as const;

export type Highlight = { title: string; body: string; status: "live" | "soon" };

export const ONBOARDING_HIGHLIGHTS: Highlight[] = [
  {
    title: "Turn in new titles",
    body: "Submit titles and upload platform-ready assets for distribution.",
    status: "live",
  },
  {
    title: "Dashboard",
    body: "See what needs your attention across your catalog.",
    status: "live",
  },
  {
    title: "Analytics",
    body: "Performance across platforms and territories.",
    status: "soon",
  },
  {
    title: "Globee AI assistant",
    body: "Answers about your catalog, rights, and deliveries.",
    status: "soon",
  },
  {
    title: "Company profile",
    body: "Manage your organization's details and account.",
    status: "soon",
  },
];
