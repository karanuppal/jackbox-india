import type { ServerErrorCode } from "@tamasha/shared";

// In-voice Hinglish for every server error code (UT-M1-1, §5.4). The client
// renders these — never the server's raw English `message`.
const TEXT: Record<ServerErrorCode, string> = {
  ROOM_NOT_FOUND: "Yeh room code nahi mila. Dobara check karo.",
  ROOM_FULL: "Room bhar gaya, yaar. Thodi der mein audience mein try karo.",
  ROOM_LOCKED: "Room abhi band hai.",
  BAD_PASSWORD: "Password galat hai. Host se poocho.",
  BAD_NAME: "Yeh naam nahi chalega. Koi aur naam likho.",
  BAD_MESSAGE: "Kuch gadbad ho gayi. Dobara try karo.",
  NOT_ALLOWED: "Yeh aap nahi kar sakte.",
  KICKED: "Moderator ne aapko room se nikaal diya. 🙏 Shanti se wapas aana.",
  RATE_LIMITED: "Arre, itni jaldi kya hai! Zara ruko.",
};

export function errorText(code: string): string {
  return TEXT[code as ServerErrorCode] ?? "Kuch gadbad ho gayi. Dobara try karo.";
}
