import { LIGHT_LABEL, type Light } from "@avanceobra/engine";
import { Badge } from "@/components/ui";

export const LIGHT_TONE: Record<Light, "green" | "amber" | "red" | "neutral" | "blue"> = {
  green: "green",
  amber: "amber",
  red: "red",
  done: "blue",
  not_started: "neutral",
  no_plan: "neutral",
};
/** Forma además del color: el semáforo se entiende en blanco y negro y con daltonismo. */
const LIGHT_ICON: Record<Light, string> = { green: "●", amber: "▲", red: "■", done: "✓", not_started: "○", no_plan: "–" };
export const LIGHT_ORDER: Light[] = ["red", "amber", "green", "done", "not_started", "no_plan"];

export function LightBadge({ light }: { light: Light }) {
  return (
    <Badge tone={LIGHT_TONE[light]}>
      <span aria-hidden className="mr-1">
        {LIGHT_ICON[light]}
      </span>
      {LIGHT_LABEL[light]}
    </Badge>
  );
}
