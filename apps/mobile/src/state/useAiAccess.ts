import { useQuery } from "@powersync/react";
import { useSession } from "./session";

/** El administrador le activó el asistente con IA en la obra actual (el servidor lo vuelve a revisar). */
export function useAiAccess(): boolean {
  const { projectId, userId } = useSession();
  const { data } = useQuery<{ ai_enabled: number | null }>("SELECT ai_enabled FROM memberships WHERE user_id = ? AND project_id = ?", [userId ?? "", projectId ?? ""]);
  return data.some((m) => Number(m.ai_enabled) === 1);
}
