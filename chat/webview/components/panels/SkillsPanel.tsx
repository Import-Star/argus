import type { SkillsPanelData } from "../../../../src/chat/panels/skills";
import "./usagePanels.css";

export function SkillsPanel({ data }: { sessionId: string; data: SkillsPanelData }) {
  if (data.skills.length === 0) {
    return <p class="cmdp-empty">No skills loaded.</p>;
  }
  return (
    <>
      {!data.hasTokens && <p class="muted up-note">Context cost unavailable.</p>}
      <ul class="up-skills">
        {data.skills.map((skill) => (
          <li key={`${skill.source}:${skill.name}`}>
            <div class="up-skill-head">
              <strong>{skill.name}</strong>
              <span class="muted">{skill.source}</span>
              {skill.tokens !== undefined && <span class="up-num">{skill.tokens.toLocaleString()} tokens</span>}
            </div>
            {skill.description && <div class="muted up-desc">{skill.description}</div>}
          </li>
        ))}
      </ul>
    </>
  );
}
