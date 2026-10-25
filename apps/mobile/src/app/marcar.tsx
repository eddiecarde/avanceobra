import { useLocalSearchParams } from "expo-router";
import { PlanScreen } from "../ui/PlanScreen";

/** Plano en modo marcado, apilado sobre la captura para no perder lo ya escrito. */
export default function Marcar() {
  const { activityId } = useLocalSearchParams<{ activityId: string }>();
  return <PlanScreen mode="select" activityId={activityId} />;
}
