import { Composer } from "./components/Composer";
import { Grid } from "./components/Grid";
import { Header } from "./components/Header";
import { ReviewPane } from "./components/ReviewPane";
import { SidePane } from "./components/SidePane";
import { Transcript } from "./components/Transcript";
import { useSession, useStore, type State } from "./store";

const selectLayout = (state: State) => `${state.view}:${state.sessionIds.join(",")}`;

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
