/**
 * Writing rules that go into EVERY text-generating prompt (plan, Shot 3).
 * Shot 3 adds the per-project voice profile on top; the ban list is fixed.
 * Shot 7 parametrisiert die Hashtag-Regel je Plattform (vorher global „max 2“).
 */
import type { HashtagPolicy } from "../../../shared/channels.js";
export const BANNED_PHRASES: readonly string[] = [
  "In der heutigen schnelllebigen Welt", "Game-Changer", "Lass uns eintauchen", "revolutionär",
  "Es ist wichtig zu beachten", "In today's fast-paced world", "game changer", "Let's dive in", "revolutionary",
  "It's important to note", "unlock", "elevate", "seamless", "nahtlos",
];

export function writingRules(opts: { language: string; community?: boolean; voiceProfile?: string | null; hashtags?: HashtagPolicy }): string {
  const de = opts.language.toLowerCase().startsWith("de");
  const tags = opts.hashtags
    ? `\n- Hashtags: ${opts.hashtags.max === 0 ? "none at all on this platform." : `${opts.hashtags.min || 1}-${opts.hashtags.max}, at the end of the caption, lowercase, no duplicates. ${opts.hashtags.note}`}`
    : "";
  const base = `WRITING RULES (mandatory):
- First person, concrete, with numbers, screenshots and things that went wrong. One thought per post.
- Write in ${de ? "German" : opts.language}. ${de ? "Use the address form (du/Sie) from the brief's tone." : ""}
- Forbidden: ${BANNED_PHRASES.map((p) => `"${p}"`).join(", ")}; a rhetorical question as opener followed by its answer; triple lists of staccato adjectives; emojis as bullets; hashtag walls; sentences starting with "It is important to note"; a closing summary of what was just said; em dashes as a stylistic tic.
- No invented facts, testimonials or numbers. If a claim needs a number you do not have, leave a [PLATZHALTER: …] the human fills in.${tags}`;
  const community = `
COMMUNITY REPLY RULES:
- Answer the actual question first and fully. Mention our own product at most in the last third, always with disclosure ("Ich bau das Tool selbst" / "I build this tool myself").
- No link if the community forbids links in comments; read and quote the community rules in the draft.
- Never post automatically - this is a draft for a human.`;
  const voice = opts.voiceProfile ? `\nVOICE PROFILE OF THE AUTHOR (match it - this is how the founder actually writes):\n${opts.voiceProfile}` : "\nNo voice profile yet: keep it plain and personal, avoid marketing register.";
  return base + voice + (opts.community ? community : "");
}
