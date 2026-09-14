import { Route, Routes } from "react-router";
import { lazy, Suspense } from "react";
import { HostProvider, useHost } from "./host.js";
import { Shell } from "./components/Shell.js";

/**
 * Nur Anmeldung, Projektliste und Startseite liegen im Hauptbündel; alles
 * andere wird geholt, wenn es gebraucht wird. Vorher lagen zwanzig Seiten
 * samt Diagrammen in einer Datei (478 KB).
 */
import { LoginPage } from "./pages/Login.js";
import { ProjectsPage } from "./pages/Projects.js";
import { TodayPage } from "./pages/Today.js";
const AnalysisPage = lazy(() => import("./pages/Analysis.js").then((m) => ({ default: m.AnalysisPage })));
const ActivityPage = lazy(() => import("./pages/Activity.js").then((m) => ({ default: m.ActivityPage })));
const SettingsPage = lazy(() => import("./pages/Settings.js").then((m) => ({ default: m.SettingsPage })));
const CommunityPage = lazy(() => import("./pages/Community.js").then((m) => ({ default: m.CommunityPage })));
const InsightsPage = lazy(() => import("./pages/Insights.js").then((m) => ({ default: m.InsightsPage })));
const UebersichtPage = lazy(() => import("./pages/Uebersicht.js").then((m) => ({ default: m.UebersichtPage })));
const StudioPage = lazy(() => import("./pages/Studio.js").then((m) => ({ default: m.StudioPage })));
const SeriesPage = lazy(() => import("./pages/Series.js").then((m) => ({ default: m.SeriesPage })));
const ChannelsPage = lazy(() => import("./pages/Channels.js").then((m) => ({ default: m.ChannelsPage })));
const PublishPage = lazy(() => import("./pages/Publish.js").then((m) => ({ default: m.PublishPage })));
const HandarbeitPage = lazy(() => import("./pages/Handarbeit.js").then((m) => ({ default: m.HandarbeitPage })));
const VideoPage = lazy(() => import("./pages/Video.js").then((m) => ({ default: m.VideoPage })));
const MusicPage = lazy(() => import("./pages/Music.js").then((m) => ({ default: m.MusicPage })));
const StrategyPage = lazy(() => import("./pages/Strategy.js").then((m) => ({ default: m.StrategyPage })));
const TasksPage = lazy(() => import("./pages/Tasks.js").then((m) => ({ default: m.TasksPage })));
const TimelinePage = lazy(() => import("./pages/Timeline.js").then((m) => ({ default: m.TimelinePage })));
const PipelinePage = lazy(() => import("./pages/Pipeline.js").then((m) => ({ default: m.PipelinePage })));
const ReviewPage = lazy(() => import("./pages/Review.js").then((m) => ({ default: m.ReviewPage })));
const StoragePage = lazy(() => import("./pages/Storage.js").then((m) => ({ default: m.StoragePage })));
const MediaPage = lazy(() => import("./pages/Media.js").then((m) => ({ default: m.MediaPage })));
import { Notice } from "./components/ui.js";
import { ProjectScoped } from "./pages/ProjectScoped.js";

function Gate() {
  const { info, loading, error } = useHost();
  if (loading) return <div className="mp-root mp-center"><span className="mp-label">Lade…</span></div>;
  if (error || !info) return <div className="mp-root mp-center"><Notice kind="bad">{error ?? "Host nicht erreichbar."}</Notice></div>;
  if (!info.user) return <div className="mp-root"><LoginPage /></div>;
  return (
    <div className="mp-root">
      <Suspense fallback={<div className="mp-main"><span className="mp-label">Lade…</span></div>}>
      <Routes>
        <Route element={<Shell />}>
          <Route index element={<ProjectsPage autoOpen />} />
          <Route path="projects" element={<ProjectsPage />} />
          <Route path="projects/:id" element={<TodayPage />} />
          <Route path="projects/:id/analysis" element={<AnalysisPage />} />
          <Route path="projects/:id/strategy" element={<StrategyPage />} />
          <Route path="projects/:id/tasks" element={<TasksPage />} />
          <Route path="projects/:id/timeline" element={<TimelinePage />} />
          <Route path="projects/:id/pipeline" element={<PipelinePage />} />
          <Route path="projects/:id/review" element={<ReviewPage />} />
          <Route path="projects/:id/series" element={<SeriesPage />} />
          <Route path="projects/:id/channels" element={<ChannelsPage />} />
          <Route path="projects/:id/publishing" element={<ChannelsPage />} />
          <Route path="projects/:id/studio" element={<StudioPage />} />
          <Route path="projects/:id/studio/video" element={<VideoPage />} />
          <Route path="projects/:id/handarbeit" element={<HandarbeitPage />} />
          <Route path="projects/:id/publish/:pieceId" element={<PublishPage />} />
          <Route path="heute" element={<ProjectScoped page="" title="Heute" />} />
          <Route path="handarbeit" element={<ProjectScoped page="handarbeit" title="Handarbeit" />} />
          <Route path="timeline" element={<ProjectScoped page="timeline" title="Timeline" />} />
          <Route path="pipeline" element={<ProjectScoped page="pipeline" title="Pipeline" />} />
          <Route path="tasks" element={<ProjectScoped page="tasks" title="Aufgaben" />} />
          <Route path="series" element={<ProjectScoped page="series" title="Serien" />} />
          <Route path="channels" element={<ProjectScoped page="channels" title="Kanäle" />} />
          <Route path="publishing" element={<ProjectScoped page="channels" title="Kanäle" />} />
          <Route path="studio" element={<ProjectScoped page="studio" title="Erstellen" />} />
          <Route path="review" element={<ProjectScoped page="review" title="Freigaben" />} />
          <Route path="projects/:id/community" element={<CommunityPage />} />
          <Route path="projects/:id/uebersicht" element={<UebersichtPage />} />
          <Route path="projects/:id/insights" element={<InsightsPage />} />
          <Route path="community" element={<ProjectScoped page="community" title="Community" />} />
          <Route path="uebersicht" element={<ProjectScoped page="uebersicht" title="Übersicht" />} />
          <Route path="insights" element={<ProjectScoped page="insights" title="Wochenbericht" />} />
          <Route path="activity" element={<ActivityPage />} />
          <Route path="storage" element={<StoragePage />} />
          <Route path="media" element={<MediaPage />} />
          <Route path="music" element={<MusicPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<Notice kind="info">Seite nicht gefunden.</Notice>} />
        </Route>
      </Routes>
      </Suspense>
    </div>
  );
}

export function App() {
  return <HostProvider><Gate /></HostProvider>;
}
