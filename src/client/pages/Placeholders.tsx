import { EmptyState, PageHeader } from "../components/ui.js";

const make = (label: string, title: string, text: string, shot: number) => function Page() {
  return (<><PageHeader label={label} title={title} /><EmptyState title={title} text={text} shot={shot} /></>);
};

export const TimelinePage = make("Planung", "Timeline", "12 Wochen, Kanäle als Zeilen, veröffentlichte Stücke gefüllt, geplante gestrichelt.", 2);
export const TasksPage = make("Planung", "Aufgaben", "Aufgaben nach Woche, abhakbar, Agent-Aufgaben mit „Jetzt ausführen“.", 2);
export const StudioPage = make("Produktion", "Content Studio", "Texte, Carousels, Pins, Directory-Einträge, GEO-Artikel – mit Voice-Profil und AI-Tell-Prüfer.", 3);
export const ReviewPage = make("Freigabe", "Freigaben", "Stücke nacheinander prüfen, editieren, freigeben – dann Publish-Paket.", 3);
export const CommunityPage = make("Radar", "Community", "Threads nach Persona-Schmerzpunkten gescort, Antwortentwürfe – nie automatisch gepostet.", 5);
export const InsightsPage = make("Messung", "Insights", "Signups pro Kanal und Woche, beste Stücke, GEO-Sichtbarkeit im Verlauf.", 5);
