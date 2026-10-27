import { useState } from "react";
import { Alert, KeyboardAvoidingView, Platform } from "react-native";
import { isConfigured, supabase } from "../services/supabase";
import { BigButton, Body, Chips, Input, Label, Screen, Title } from "../ui/components";

type Method = "code" | "password";

/**
 * Inicio de sesión: código de un solo uso por correo (sin contraseñas que olvidar en obra)
 * o contraseña (útil para cuentas de prueba y cuando el correo tarda).
 * Se requiere señal solo la primera vez; después la sesión queda guardada en el teléfono.
 */
export default function Login() {
  // La contraseña primero: el código por correo solo llega si el proyecto tiene correo configurado
  const [method, setMethod] = useState<Method>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const normalized = email.trim().toLowerCase();

  async function sendCode() {
    setBusy(true);
    const { error } = await supabase.auth.signInWithOtp({ email: normalized, options: { shouldCreateUser: false } });
    setBusy(false);
    if (error) return Alert.alert("No se pudo enviar el código", error.message);
    setSent(true);
  }

  async function verify() {
    setBusy(true);
    const { error } = await supabase.auth.verifyOtp({ email: normalized, token: code.trim(), type: "email" });
    setBusy(false);
    if (error) Alert.alert("Código inválido", error.message);
  }

  async function signInWithPassword() {
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email: normalized, password });
    setBusy(false);
    if (error) Alert.alert("No se pudo entrar", error.message);
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Screen>
        <Title>AvanceObra</Title>
        <Body muted>Control de avance de obra en campo</Body>
        {!isConfigured ? <Body>⚠ Falta configurar Supabase y PowerSync (ver .env.example).</Body> : null}
        <Chips
          options={[
            { value: "password", label: "Contraseña" },
            { value: "code", label: "Código por correo" },
          ]}
          value={method}
          onChange={(m) => {
            setMethod(m);
            setSent(false);
          }}
        />
        <Label>Correo</Label>
        <Input
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
          placeholder="nombre@empresa.com"
          editable={!sent}
        />
        {method === "password" ? (
          <>
            <Label>Contraseña</Label>
            <Input value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoComplete="password" />
            <BigButton
              title="Entrar"
              variant="primary"
              large
              loading={busy}
              disabled={!normalized.includes("@") || password.length < 6}
              onPress={signInWithPassword}
            />
            <Body muted>¿Olvidaste tu contraseña? Pídele al administrador de tu obra que te genere una temporal (en la web: Equipo → Restablecer contraseña).</Body>
          </>
        ) : sent ? (
          <>
            <Label>Código recibido por correo</Label>
            <Input big value={code} onChangeText={setCode} keyboardType="number-pad" maxLength={8} placeholder="000000" />
            <BigButton title="Entrar" variant="primary" large loading={busy} disabled={code.length < 6} onPress={verify} />
            <BigButton title="Cambiar correo" onPress={() => setSent(false)} />
          </>
        ) : (
          <BigButton title="Enviar código" variant="primary" large loading={busy} disabled={!normalized.includes("@")} onPress={sendCode} />
        )}
      </Screen>
    </KeyboardAvoidingView>
  );
}
