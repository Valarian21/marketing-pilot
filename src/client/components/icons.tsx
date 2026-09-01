/** Inline stroke icons for the navigation. 18px, currentColor. */
const base = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };

export const Icons = {
  projects: () => <svg {...base}><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M3 10h18" /></svg>,
  timeline: () => <svg {...base}><path d="M3 6h18M3 12h12M3 18h8" /></svg>,
  tasks: () => <svg {...base}><path d="M5 12l4 4L19 6" /></svg>,
  studio: () => <svg {...base}><path d="M12 3l1.8 4.6L18 9l-4.2 1.4L12 15l-1.8-4.6L6 9l4.2-1.4z" /><path d="M5 19h14" /></svg>,
  review: () => <svg {...base}><circle cx="12" cy="12" r="8" /><path d="M9 12l2 2 4-4" /></svg>,
  community: () => <svg {...base}><path d="M4 5h16v10H9l-5 4z" /></svg>,
  insights: () => <svg {...base}><path d="M4 19V9M10 19V5M16 19v-8M22 19H2" /></svg>,
  activity: () => <svg {...base}><path d="M3 12h4l3-7 4 14 3-7h4" /></svg>,
  media: () => <svg {...base}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 15l5-5 4 4 3-3 6 6" /><circle cx="16" cy="9" r="1.5" /></svg>,
  storage: () => <svg {...base}><ellipse cx="12" cy="6" rx="8" ry="3" /><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" /></svg>,
  settings: () => <svg {...base}><circle cx="12" cy="12" r="3" /><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" /></svg>,
  series: () => <svg {...base}><path d="M4 7h10M4 12h10M4 17h10" /><circle cx="19" cy="7" r="1.6" /><circle cx="19" cy="12" r="1.6" /><circle cx="19" cy="17" r="1.6" /></svg>,
  back: () => <svg {...base}><path d="M15 6l-6 6 6 6" /></svg>,
  plus: () => <svg {...base}><path d="M12 5v14M5 12h14" /></svg>,
  leaf: () => <svg {...base} width={22} height={22}><path d="M5 19c0-8 5-13 14-14-1 9-6 14-14 14z" /><path d="M5 19c3-4 6-7 10-10" /></svg>,
};
export type IconName = keyof typeof Icons;
