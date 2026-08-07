export const supportedLocales = ["zh-CN", "en", "ja", "ko"] as const;
export type Locale = (typeof supportedLocales)[number];

export type Messages = {
  meta: {
    title: string;
    description: string;
    ogTitle: string;
    ogDescription: string;
  };
  nav: {
    story: string;
    belief: string;
    join: string;
    language: string;
    primary: string;
    menu: string;
  };
  hero: {
    title: string;
    body: string;
    note: string;
    continue: string;
    imageAlt: string;
  };
  manifesto: {
    eyebrow: string;
    title: string;
    muted: string;
    body: string[];
  };
  moment: {
    eyebrow: string;
    quote: string;
    detail: string;
    body: string;
    conclusion: string[];
    imageAlt: string;
    ruleLabels: [string, string, string];
    stages: Array<{ label: string; text: string }>;
  };
  change: { title: string[]; edits: string[]; body: string };
  ownership: {
    eyebrow: string;
    title: string[];
    stages: Array<{ time: string; title: string; body: string }>;
  };
  vision: {
    eyebrow: string;
    title: string[];
    emphasis: string;
    body: string[];
  };
  waitlist: {
    title: string[];
    body: string;
    name: string;
    email: string;
    persona: string;
    personas: Record<"idea" | "creator" | "investor", string>;
    submit: string;
    submitting: string;
    successTitle: string;
    duplicateTitle: string;
    errorTitle: string;
    success: string;
    duplicate: string;
    error: string;
    close: string;
    privacy: string;
  };
};
