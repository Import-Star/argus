import { Composer } from "./components/Composer";
import { DetailsPane } from "./components/DetailsPane";
import { Grid } from "./components/Grid";
import { Header } from "./components/Header";
import { PlanPane } from "./components/PlanPane";
import { PreviewPane } from "./components/PreviewPane";
import { ReviewPane } from "./components/ReviewPane";
import { Transcript } from "./components/Transcript";
import { WorkflowPane } from "./components/WorkflowPane";
import { useSession, useStore, type State } from "./store";

const selectLayout = (state: State) => `${state.view}:${state.sessionIds.join(",")}`;

function SidePane({ sessionId }: { sessionId: string }) {
  const { ui } = useSession(sessionId);
  switch (ui.side) {
    case "plan":
      return <PlanPane sessionId={sessionId} />;
    case "workflow":
      return <WorkflowPane sessionId={sessionId} />;
    case "preview":
      return <PreviewPane sessionId={sessionId} />;
    default:
      return <DetailsPane sessionId={sessionId} />;
  }
}

function SessionView({ sessionId }: { sessionId: string }) {
  const { ui } = useSession(sessionId);
  return (
    <div class="chat">
      <Header sessionId={sessionId} />
      <div class={`chat-body side-${ui.side}`}>
        <main class="chat-main">
          <Transcript sessionId={sessionId} />
          <Composer key={sessionId} sessionId={sessionId} />
        </main>
        <aside class="chat-side">
          <SidePane sessionId={sessionId} />
        </aside>
      </div>
      {ui.side === "review" && <ReviewPane sessionId={sessionId} />}
    </div>
  );
}

export function App() {
  const [view, ids] = useStore(selectLayout).split(":");
  if (view === "grid") {
    return <Grid />;
  }
  return ids ? <SessionView sessionId={ids.split(",")[0]} /> : <div class="chat-empty">Loading…</div>;
}
