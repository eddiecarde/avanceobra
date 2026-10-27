import { useState } from "react";
import { Alert, KeyboardAvoidingView, Platform } from "react-native";
import { passwordProblem } from "../core/account";
import { supabase } from "../services/supabase";
import { useSession } from "../state/session";
import { BigButton, Body, Input, Label, Screen, Title } from "../ui/components";

/**
 * Primera entrada con una contraseña temporal (creada o restablecida por el administrador):
 * la persona crea la suya antes de usar la app. Requiere señal.
 */
export default function CambiarClave() {
  const { session } = useSession();
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    const problem = passwordProblem(password, again);
    if (problem) return Alert.alert("Revisa la contraseña", problem);
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password, data: { must_change_password: false } });
    setBusy(false);
    if (error) return Alert.alert("No se pudo cambiar", `${error.message}\n\nNecesitas señal para cambiar la contraseña.`);
    Alert.alert("Listo", "Tu contraseña quedó cambiada. Úsala también en la web.");
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Screen>
        <Title>Crea tu contraseña</Title>
        <Body muted>{`Entraste con una contraseña temporal (${session?.user.email ?? ""}). Crea la tuya para seguir: al menos 10 caracteres, con letras y números.`}</Body>
        <Label>Contraseña nueva</Label>
        <Input value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoComplete="new-password" accessibilityLabel="Contraseña nueva" />
        <Label>Repite la contraseña</Label>
        <Input value={again} onChangeText={setAgain} secureTextEntry autoCapitalize="none" autoComplete="new-password" accessibilityLabel="Repite la contraseña" />
        <BigButton title="Guardar contraseña" variant="primary" large loading={busy} disabled={!password || !again} onPress={() => void save()} />
        <BigButton title="Salir" onPress={() => void supabase.auth.signOut()} />
      </Screen>
    </KeyboardAvoidingView>
  );
}
