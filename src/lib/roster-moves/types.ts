/**
 * Shared types for the NCAA roster-moves pipeline.
 * Mirrors the `roster_moves` table (migration 007) and the extraction
 * contract in the omni-hockey design doc (roster-moves-contract.md §3/§4).
 */

export type Direction =
  | 'commit'
  | 'transfer_in'
  | 'transfer_out'
  | 'departure'
  | 'pro_signing'
  | 'graduation';

export type Confidence = 'reported' | 'corroborated' | 'confirmed';

export type SourceType =
  | 'x_report'
  | 'season_diff'
  | 'official_roster'
  | 'manual'
  | 'portal'
  | 'commit_tracker';

/**
 * One move as emitted by the extractor (before entity resolution / DB shape).
 * A single tweet or tracker article can yield many of these.
 */
export interface ExtractedMove {
  direction: Direction;
  playerName: string;
  /** The school this move is about (gaining/losing the player), as named. */
  teamName: string;
  /** Origin school for a transfer, if named. */
  fromTeamName?: string | null;
  /** Destination school for a transfer, if named. */
  toTeamName?: string | null;
  position?: 'F' | 'D' | 'G' | null;
  classYear?: number | null;
}

/**
 * A sighting record appended to roster_moves.raw.sources on every upsert,
 * so provenance is auditable without storing verbatim tweet content.
 */
export interface MoveSighting {
  sourceType: SourceType;
  /** Tweet id, article url, or 'season-diff' — whatever points back to origin. */
  ref: string;
  /** X handle or 'season-diff', for quick human scanning. */
  by?: string;
  /** Model that produced the extraction, when LLM-derived. */
  model?: string;
  /** Free-form context (e.g. "grad transfer; 2 yrs eligibility"). */
  note?: string;
  /** ISO timestamp of the sighting. */
  seenAt: string;
}
