/**
 * Tweet-source adapter seam.
 *
 * The orchestrator (scan-moves) owns x_accounts iteration and since_id
 * persistence; a MoveSource just turns "this account, since this id" into
 * tweets. Two implementations: the live X API and a fixture source for local
 * testing without spending X API budget.
 */

export interface Tweet {
  id: string;
  text: string;
  createdAt: string | null;
  authorHandle: string;
  /** Photo / preview image URLs attached to the tweet (for vision extract). */
  imageUrls: string[];
}

export interface AccountPoll {
  handle: string;
  /** Cached X numeric user id, if we've resolved it before. */
  xUserId: string | null;
  /** Only return tweets newer than this id. */
  sinceId: string | null;
}

export interface PolledTweets {
  tweets: Tweet[];
  /** Newest tweet id seen this poll — persist as the account's next since_id. */
  newestId: string | null;
  /** Resolved X user id (so we can cache it on the account). */
  xUserId: string | null;
}

export interface MoveSource {
  readonly name: string;
  poll(account: AccountPoll): Promise<PolledTweets>;
}
