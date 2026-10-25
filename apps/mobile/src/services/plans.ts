import { OfflineManager } from "@maplibre/maplibre-react-native";
import { Directory, File, Paths } from "expo-file-system";
import { db } from "../db/database";
import { nowIso } from "./ids";
import { config, supabase } from "./supabase";

/**
 * Planos georreferenciados offline. El administrador sube el plano (PDF convertido a
 * imagen o PNG/JPG) con sus 4 esquinas; el móvil lo descarga una vez y lo muestra
 * sobre el mapa como ImageSource, sin necesitar señal.
 */

export const plansDir = () => new Directory(Paths.document, "plans");

export interface SitePlan {
  id: string;
  name: string;
  version: number;
  storage_path: string;
  corners: string | null;
  local_uri: string | null;
  local_version: number | null;
}

export async function downloadPlan(plan: SitePlan): Promise<string> {
  const dir = plansDir();
  if (!dir.exists) dir.create({ intermediates: true });
  const ext = plan.storage_path.split(".").pop() ?? "png";
  const target = new File(dir, `${plan.id}-v${plan.version}.${ext}`);
  const { data, error } = await supabase.storage.from("plans").download(plan.storage_path);
  if (error) throw error;
  target.write(new Uint8Array(await data.arrayBuffer()));
  await db.execute(
    "INSERT OR REPLACE INTO plan_files (id, local_uri, version, downloaded_at) VALUES (?, ?, ?, ?)",
    [plan.id, target.uri, plan.version, nowIso()],
  );
  return target.uri;
}

/** Descarga los planos nuevos o actualizados del proyecto (se llama al abrir el plano con señal). */
export async function syncPlans(projectId: string) {
  const plans = await db.getAll<SitePlan>(
    `SELECT s.id, s.name, s.version, s.storage_path, s.corners, f.local_uri, f.version AS local_version
     FROM site_plans s LEFT JOIN plan_files f ON f.id = s.id WHERE s.project_id = ?`,
    [projectId],
  );
  for (const p of plans) {
    if (p.local_uri && p.local_version === p.version && new File(p.local_uri).exists) continue;
    await downloadPlan(p);
  }
}

/**
 * Caché del mapa base por zona: descarga los tiles del área del proyecto para verlo sin señal.
 */
export async function downloadBaseMap(
  name: string,
  bounds: [number, number, number, number],
  onProgress: (pct: number) => void,
): Promise<void> {
  // Margen de ~300 m alrededor de la obra
  const m = 0.003;
  const padded: [number, number, number, number] = [bounds[0] - m, bounds[1] - m, bounds[2] + m, bounds[3] + m];
  await new Promise<void>((resolve, reject) => {
    OfflineManager.createPack(
      { mapStyle: config.mapStyleUrl, bounds: padded, minZoom: 12, maxZoom: 19, metadata: { name } },
      (_pack, status) => {
        onProgress(status.percentage);
        if (status.percentage >= 100) resolve();
      },
      (_pack, err) => reject(new Error(err.message)),
    ).catch(reject);
  });
}
