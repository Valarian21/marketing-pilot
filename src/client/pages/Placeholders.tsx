import { EmptyState, PageHeader } from "../components/ui.js";

const make = (label: string, title: string, text: string, shot: number) => function Page() {
  return (<><PageHeader label={label} title={title} /><EmptyState title={title} text={text} shot={shot} /></>);
};

export const CommunityPage = make("Radar", "Community", "Threads nach Persona-Schmerzpunkten gescort, Antwortentwürfe – nie automatisch gepostet.", 5);
export const InsightsPage = make("Messung", "Insights", "Signups pro Kanal und Woche, beste Stücke, GEO-Sichtbarkeit im Verlauf.", 5);
