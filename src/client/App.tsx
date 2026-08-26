import { Route, Routes } from "react-router";
import { HostProvider, useHost } from "./host.js";
import { Shell } from "./components/Shell.js";
import { Notice } from "./components/ui.js";
import { LoginPage } from "./pages/Login.js";
import { ProjectsPage } from "./pages/Projects.js";
import { ProjectDetailPage } from "./pages/ProjectDetail.js";
import { AnalysisPage } from "./pages/Analysis.js";
import { ActivityPage } from "./pages/Activity.js";
import { SettingsPage } from "./pages/Settings.js";
import { CommunityPage, InsightsPage } from "./pages/Placeholders.js";
import { StudioPage } from "./pages/Studio.js";
import { PublishPage } from "./pages/Publish.js";
import { VideoPage } from "./pages/Video.js";
import { StrategyPage } from "./pages/Strategy.js";
import { TasksPage } from "./pages/Tasks.js";
import { TimelinePage } from "./pages/Timeline.js";
import { ReviewPage } from "./pages/Review.js";
import { ProjectScoped } from "./pages/ProjectScoped.js";

function Gate() {
  const { info, loading, error } = useHost();
  if (loading) return <div className="mp-root mp-center"><span className="mp-label">Lade…</span></div>;
  if (error || !info) return <div className="mp-root mp-center"><Notice kind="bad">{error ?? "Host nicht erreichbar."}</Notice></div>;
  if (!info.user) return <div className="mp-root"><LoginPage /></div>;
  return (
    <div className="mp-root">
      <Routes>
        <Route element={<Shell />}>
          <Route index element={<ProjectsPage />} />
          <Route path="projects/:id" element={<ProjectDetailPage />} />
          <Route path="projects/:id/analysis" element={<AnalysisPage />} />
          <Route path="projects/:id/strategy" element={<StrategyPage />} />
          <Route path="projects/:id/tasks" element={<TasksPage />} />
          <Route path="projects/:id/timeline" element={<TimelinePage />} />
          <Route path="projects/:id/review" element={<ReviewPage />} />
          <Route path="projects/:id/studio" element={<StudioPage />} />
          <Route path="projects/:id/studio/video" element={<VideoPage />} />
          <Route path="projects/:id/publish/:pieceId" element={<PublishPage />} />
          <Route path="timeline" element={<ProjectScoped page="timeline" title="Timeline" />} />
          <Route path="tasks" element={<ProjectScoped page="tasks" title="Aufgaben" />} />
          <Route path="studio" element={<ProjectScoped page="studio" title="Content Studio" />} />
          <Route path="review" element={<ProjectScoped page="review" title="Freigaben" />} />
          <Route path="community" element={<CommunityPage />} />
          <Route path="insights" element={<InsightsPage />} />
          <Route path="activity" element={<ActivityPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<Notice kind="info">Seite nicht gefunden.</Notice>} />
        </Route>
      </Routes>
    </div>
  );
}

export function App() {
  return <HostProvider><Gate /></HostProvider>;
}
