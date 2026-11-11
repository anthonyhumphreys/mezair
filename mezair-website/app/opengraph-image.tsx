import { cardContentType, cardSize, renderCard } from "./_og/card";

export const alt = "Mezair, an open-source desktop app for Codex, Claude Code, Cursor, Devin and other coding agents, with a screenshot of a finished Codex run.";
export const size = cardSize;
export const contentType = cardContentType;

export default function Image() {
  return renderCard({
    title: "One set of reins.",
    description: "The free, open-source desktop app for Codex, Claude Code, Cursor and Devin. Sign in with the plans you already pay for.",
    label: "mezair.dev",
    facts: ["Free", "MIT", "macOS · Windows · Linux"],
    image: { file: "desktop.jpg", width: 1400, height: 875, top: 150 }
  });
}
