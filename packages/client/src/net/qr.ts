import QRCode from "qrcode";

/** Render a join URL as an inline SVG string for the host screen (§4.5). */
export async function qrSvg(text: string): Promise<string> {
  return QRCode.toString(text, {
    type: "svg",
    margin: 1,
    color: { dark: "#1a0508", light: "#e8dcc4" },
    errorCorrectionLevel: "M",
  });
}

/** The URL a player types/scans to join a given room. */
export function joinUrl(origin: string, code: string): string {
  const base = origin.replace(/\/$/, "");
  return `${base}/?code=${encodeURIComponent(code)}`;
}
