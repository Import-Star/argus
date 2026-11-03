import { useSession } from "../store";
import { CommandPanel } from "./panels/CommandPanel";
import { DetailsPane } from "./DetailsPane";
import { PlanPane } from "./PlanPane";
import { WorkflowPane } from "./WorkflowPane";

export function SidePane({ sessionId }: { sessionId: string }) {
  const { ui } = useSession(sessionId);
  switch (ui.side) {
    case "plan":
      return <PlanPane sessionId={sessionId} />;
    case "workflow":
      return <WorkflowPane sessionId={sessionId} />;
    case "panel":
      return <CommandPanel sessionId={sessionId} />;
    default:
      return <DetailsPane sessionId={sessionId} />;
  }
}
