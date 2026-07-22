import { supabase } from '../supabase';
import { readArticle } from '../article-reader';
import { classifyLinks } from './sourcing';
import { extractMoves, EXTRACTOR_MODEL } from './extract';
import { resolveNcaaTeam, resolvePlayerId } from './resolve';
import { upsertMove, type UpsertOutcome } from './upsert';
import { currentMovesSeason } from './config';
import type { Direction, MoveSighting } from './types';
import type { AccountPoll, MoveSource } from './sources';
import { xApiSource } from './sources/x-api';
import { createFixtureSource } from './sources/fixture';

const INCOMING: ReadonlySet<Direction> = new Set(['commit', 'transfer_in']);

export interface ScanMovesResult {
  source: string;
  accountsPolled: number;
  tweetsSeen: number;
  movesExtracted: number;
  inserted: number;
  updated: number;
  errors: string[];
}

interface XAccountRow {
  id: string;
  handle: string;
  x_user_id: string | null;
  since_id: string | null;
}

/**
 * Choose the tweet source: fixture when ROSTER_MOVES_FIXTURE is set (local
 * testing), otherwise the live X API.
 */
export function resolveSource(): MoveSource {
  const fixture = process.env.ROSTER_MOVES_FIXTURE;
  if (fixture) return createFixtureSource(fixture);
  return xApiSource;
}

/** Assemble original-source material for one tweet per the sourcing policy. */
async function gatherArticleTexts(text: string): Promise<string[]> {
  const { fetchable } = classifyLinks(text);
  const texts: string[] = [];
  for (const url of fetchable) {
    try {
      const article = await readArticle(url);
      if (article.success && article.text.trim()) texts.push(article.text);
    } catch {
      // Best-effort; a failed fetch just means we lean on tweet text/image.
    }
  }
  return texts;
}

/**
 * Poll curated X accounts, extract NCAA roster moves from original-source
 * material, resolve entities, and upsert (dedup + confidence bump).
 */
export async function scanMoves(
  source: MoveSource = resolveSource(),
): Promise<ScanMovesResult> {
  const season = currentMovesSeason();
  const result: ScanMovesResult = {
    source: source.name,
    accountsPolled: 0,
    tweetsSeen: 0,
    movesExtracted: 0,
    inserted: 0,
    updated: 0,
    errors: [],
  };

  const { data: accounts, error } = await supabase
    .from('x_accounts')
    .select('id, handle, x_user_id, since_id')
    .eq('is_active', true)
    .order('handle');

  if (error) {
    result.errors.push(`Failed to load x_accounts: ${error.message}`);
    return result;
  }
  if (!accounts || accounts.length === 0) {
    result.errors.push('No active x_accounts configured (seed migration 008).');
    return result;
  }

  for (const account of accounts as XAccountRow[]) {
    result.accountsPolled++;
    const poll: AccountPoll = {
      handle: account.handle,
      xUserId: account.x_user_id,
      sinceId: account.since_id,
    };

    let polled;
    try {
      polled = await source.poll(poll);
    } catch (err) {
      result.errors.push(
        `@${account.handle}: ${err instanceof Error ? err.message : String(err)}`,
      );
      continue;
    }

    for (const tweet of polled.tweets) {
      result.tweetsSeen++;
      try {
        const articleTexts = await gatherArticleTexts(tweet.text);
        const moves = await extractMoves({
          tweetText: tweet.text,
          imageUrls: tweet.imageUrls,
          articleTexts,
        });

        for (const move of moves) {
          const primaryName =
            move.teamName ||
            (INCOMING.has(move.direction) ? move.toTeamName : move.fromTeamName);
          const primary = await resolveNcaaTeam(primaryName);
          if (!primary || !primary.teamSeo) continue; // not an NCAA move we can place

          result.movesExtracted++;

          const [playerId, fromTeam, toTeam] = await Promise.all([
            resolvePlayerId(move.playerName),
            resolveNcaaTeam(move.fromTeamName),
            resolveNcaaTeam(move.toTeamName),
          ]);

          const sighting: MoveSighting = {
            sourceType: 'x_report',
            ref: tweet.id,
            by: account.handle,
            model: EXTRACTOR_MODEL,
            seenAt: tweet.createdAt ?? new Date().toISOString(),
          };

          const up = await upsertMove({
            season,
            direction: move.direction,
            playerName: move.playerName,
            playerId,
            teamId: primary.teamId,
            teamSeo: primary.teamSeo,
            fromTeamId: fromTeam?.teamId ?? null,
            toTeamId: toTeam?.teamId ?? null,
            position: move.position ?? null,
            classYear: move.classYear ?? null,
            sourceType: 'x_report',
            baseConfidence: 'reported',
            sighting,
          });

          tally(result, up.outcome);
          if (up.outcome === 'error' && up.error) {
            result.errors.push(`upsert ${up.dedupKey}: ${up.error}`);
          }
        }
      } catch (err) {
        result.errors.push(
          `tweet ${tweet.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // Advance the cursor even when nothing new arrived (records last_polled_at).
    await supabase
      .from('x_accounts')
      .update({
        since_id: polled.newestId ?? account.since_id,
        x_user_id: polled.xUserId ?? account.x_user_id,
        last_polled_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', account.id);
  }

  return result;
}

function tally(result: ScanMovesResult, outcome: UpsertOutcome): void {
  if (outcome === 'inserted') result.inserted++;
  else if (outcome === 'updated') result.updated++;
}
