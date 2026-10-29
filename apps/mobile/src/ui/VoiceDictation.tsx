import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from "expo-speech-recognition";
import { useState } from "react";
import { Alert } from "react-native";
import { Body, BigButton } from "./components";

const ERROR_TEXT: Record<string, string> = {
  network: "Sin señal para reconocer la voz. Escribe el parte o inténtalo cuando haya señal.",
  "not-allowed": "La app no tiene permiso para usar el micrófono. Actívalo en los ajustes del teléfono.",
  "service-not-allowed": "El reconocimiento de voz del teléfono está desactivado.",
  "language-not-supported": "El teléfono no tiene el español para reconocer la voz. Instálalo en los ajustes de Google.",
};

/**
 * Botón de micrófono: el reconocimiento de voz del teléfono (español) escribe lo que se dice.
 * Cada frase terminada se agrega con onText; mientras se habla se muestra lo que va entendiendo.
 */
export function VoiceDictation({ onText }: { onText: (text: string) => void }) {
  const [available] = useState(() => {
    try {
      return ExpoSpeechRecognitionModule.isRecognitionAvailable();
    } catch {
      return false;
    }
  });
  const [listening, setListening] = useState(false);
  const [partial, setPartial] = useState("");

  useSpeechRecognitionEvent("start", () => setListening(true));
  useSpeechRecognitionEvent("end", () => {
    setListening(false);
    setPartial("");
  });
  useSpeechRecognitionEvent("result", (e) => {
    const text = e.results[0]?.transcript?.trim() ?? "";
    if (e.isFinal) {
      if (text) onText(text);
      setPartial("");
    } else setPartial(text);
  });
  useSpeechRecognitionEvent("error", (e) => {
    setListening(false);
    setPartial("");
    if (e.error === "no-speech" || e.error === "aborted" || e.error === "speech-timeout") return;
    Alert.alert("No se pudo escuchar", ERROR_TEXT[e.error] ?? e.message ?? "Inténtalo de nuevo.");
  });

  async function start() {
    const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!perm.granted) return Alert.alert("Falta el permiso del micrófono", ERROR_TEXT["not-allowed"]!);
    ExpoSpeechRecognitionModule.start({ lang: "es-CO", interimResults: true, continuous: true, addsPunctuation: true });
  }

  if (available === false) return <Body muted>Este teléfono no tiene reconocimiento de voz: usa el micrófono del teclado o escribe.</Body>;
  return (
    <>
      <BigButton
        title={listening ? "■ Detener" : "🎙 Hablar"}
        variant={listening ? "danger" : "primary"}
        large
        onPress={() => (listening ? ExpoSpeechRecognitionModule.stop() : void start())}
      />
      {listening ? <Body muted>{partial ? `Escuchando… «${partial}»` : "Escuchando… cuenta el día con calma."}</Body> : null}
    </>
  );
}
