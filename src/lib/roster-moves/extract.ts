import { generateText, Output, gateway } from 'ai';
import { z } from 'zod';
import type { ExtractedMove } from './types';

export const EXTRACTOR_MODEL = 'anthropic/claude-haiku-4.5';

const moveSchema = z.object({
  direction: z
    .enum([
      'commit',
      'transfer_in',
      'transfer_out',
      'departure',
      'pro_signing',
      'graduation',
    ])
    .describe(
      'commit: a recruit/incoming player committing to a school. transfer_in: a player transferring INTO the school this row is about. transfer_out: transferring OUT. departure: leaving with no known destination. pro_signing: signing an NHL/pro contract. graduation: finishing eligibility.',
    ),
  playerName: z.string().describe('Player full name exactly as reported.'),
  teamName: z
    .string()
    .describe(
      'The NCAA school this move is ABOUT — the one gaining the player (commit/transfer_in) or losing them (transfer_out/departure). Use the school name as written.',
    ),
  fromTeamName: z
    .string()
    .nullable()
    .describe('For a transfer, the ORIGIN school if named; else null.'),
  toTeamName: z
    .string()
    .nullable()
    .describe('For a transfer, the DESTINATION school if named; else null.'),
  position: z
    .enum(['F', 'D', 'G'])
    .nullable()
    .describe('Forward / Defense / Goalie if stated; else null.'),
  classYear: z
    .number()
    .int()
    .min(1)
    .max(5)
    .nullable()
    .describe('Class year 1..5 if stated; else null.'),
});

const extractionSchema = z.object({
  moves: z
    .array(moveSchema)
    .describe(
      'Every distinct roster move supported by the provided material. A multi-move tracker yields many; a bare pointer with no actual movement yields an empty array.',
    ),
});

const SYSTEM = `You extract NCAA Division I men's hockey OFFSEASON roster moves from source material (a tweet, its image, and/or an original-source article we fetched).

Rules:
- Extract ONLY movement explicitly supported by the material. Never guess or infer players/schools not present.
- One move per player-per-school. A "tracker" article listing many commits/transfers yields many moves.
- Distinguish direction carefully. For a transfer, set teamName to the school the row is ABOUT and also fill fromTeamName/toTeamName when both are named.
- If the material is just a pointer/headline with no concrete movement, return an empty moves array.
- Only NCAA D1 men's hockey. Ignore women's, junior, pro-only, and other-sport content.`;

export interface ExtractInput {
  /** The tweet's own text. */
  tweetText: string;
  /** Image URLs from the tweet (commitment graphics, cards) — read via vision. */
  imageUrls?: string[];
  /** Text of original-source articles we were allowed to fetch (contract §4). */
  articleTexts?: string[];
}

/**
 * Run the multimodal Claude extractor over one tweet's material.
 * Returns the structured moves (possibly empty). Never throws on empty output.
 */
export async function extractMoves(
  input: ExtractInput,
): Promise<ExtractedMove[]> {
  const parts: Array<
    { type: 'text'; text: string } | { type: 'image'; image: string }
  > = [];

  parts.push({ type: 'text', text: `Tweet text:\n${input.tweetText}` });

  for (const article of input.articleTexts ?? []) {
    if (article.trim()) {
      parts.push({
        type: 'text',
        text: `Linked original-source article:\n${article}`,
      });
    }
  }

  for (const url of input.imageUrls ?? []) {
    parts.push({ type: 'image', image: url });
  }

  const { output } = await generateText({
    model: gateway(EXTRACTOR_MODEL),
    system: SYSTEM,
    output: Output.object({ schema: extractionSchema }),
    messages: [{ role: 'user', content: parts }],
  });

  return output?.moves ?? [];
}
