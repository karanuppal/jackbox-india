import { useState, type FormEvent } from "react";
import { BRANDING, MAX_NAME_LENGTH } from "@tamasha/shared";
import { S } from "../ui/styles.css.js";

export interface JoinSubmit {
  code: string;
  name: string;
  password?: string;
}

// A visible name must contain at least one printable glyph — mirrors the
// server's sanitizeName so the button isn't enabled for a name the server
// will reject (UT-M1-7). Zero-width/combining-only names fail this.
const NAME_HAS_GLYPH = /[\p{L}\p{N}\p{P}\p{S}]/u;

/** Presentational join form. Parent owns navigation/connection. */
export function JoinForm({
  initialCode = "",
  askPassword = false,
  notice,
  onSubmit,
}: {
  initialCode?: string;
  askPassword?: boolean;
  notice?: string;
  onSubmit: (v: JoinSubmit) => void;
}) {
  const [code, setCode] = useState(initialCode);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");

  const codeValid = /^[A-Za-z]{4}$/.test(code.trim());
  const nameValid = NAME_HAS_GLYPH.test(name.normalize("NFC"));
  const passwordValid = !askPassword || password.length > 0;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (codeValid && nameValid && passwordValid) {
      onSubmit({
        code: code.trim().toUpperCase(),
        name: name.trim(),
        ...(askPassword ? { password } : {}),
      });
    }
  }

  return (
    <main style={S.page}>
      <h1 style={S.h1}>{BRANDING.platformName}</h1>
      <p style={{ textAlign: "center", maxWidth: "20rem" }}>
        {BRANDING.venueName} mein aapka swagat hai. Room code daalo aur naam likho.
      </p>
      {notice !== undefined && <p style={S.error}>{notice}</p>}
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
        {askPassword && (
          <input
            aria-label="Room password"
            type="password"
            style={{ ...S.field, marginTop: "0.75rem" }}
            value={password}
            onChange={(e) => setPassword(e.target.value.slice(0, 32))}
            placeholder="Password"
            maxLength={32}
          />
        )}
        <button
          type="submit"
          style={{ ...S.button, opacity: codeValid && nameValid && passwordValid ? 1 : 0.5 }}
          disabled={!codeValid || !nameValid || !passwordValid}
        >
          Andar aao
        </button>
      </form>
    </main>
  );
}
