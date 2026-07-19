import { useState, type FormEvent } from "react";
import { BRANDING, MAX_NAME_LENGTH } from "@tamasha/shared";
import { S } from "../ui/styles.css.js";

export interface JoinSubmit {
  code: string;
  name: string;
}

/** Presentational join form. Parent owns navigation/connection. */
export function JoinForm({
  initialCode = "",
  onSubmit,
}: {
  initialCode?: string;
  onSubmit: (v: JoinSubmit) => void;
}) {
  const [code, setCode] = useState(initialCode);
  const [name, setName] = useState("");

  const codeValid = /^[A-Za-z]{4}$/.test(code.trim());
  const nameValid = name.trim().length > 0;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (codeValid && nameValid) onSubmit({ code: code.trim().toUpperCase(), name: name.trim() });
  }

  return (
    <main style={S.page}>
      <h1 style={S.h1}>{BRANDING.platformName}</h1>
      <p style={{ textAlign: "center", maxWidth: "20rem" }}>
        {BRANDING.venueName} mein aapka swagat hai. Room code daalo aur naam likho.
      </p>
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", alignItems: "center", width: "100%" }}>
        <input
          aria-label="Room code"
          style={{ ...S.field, textTransform: "uppercase" }}
          value={code}
          onChange={(e) => setCode(e.target.value.slice(0, 4))}
          placeholder="CODE"
          autoCapitalize="characters"
          autoCorrect="off"
          inputMode="text"
          maxLength={4}
        />
        <input
          aria-label="Your name"
          style={{ ...S.field, marginTop: "0.75rem" }}
          value={name}
          onChange={(e) => setName(e.target.value.slice(0, MAX_NAME_LENGTH))}
          placeholder="Naam"
          maxLength={MAX_NAME_LENGTH}
        />
        <button type="submit" style={{ ...S.button, opacity: codeValid && nameValid ? 1 : 0.5 }} disabled={!codeValid || !nameValid}>
          Andar aao
        </button>
      </form>
    </main>
  );
}
