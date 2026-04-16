export interface Article {
  title: string;
  url: string;
  source: string;
  excerpt: string;
  publishedAt: string;
  author?: string;
  imageUrl?: string;
  isGameRecap?: boolean;
  isGlobal?: boolean;
}

export interface ExtractedEntities {
  players: string[];
  teams: string[];
}

export interface ResolvedEntities {
  playerIds: string[];
  teamIds: string[];
  leagueIds: string[];
  unresolvedPlayers: string[];
  unresolvedTeams: string[];
  unresolvedLeagues: string[];
}

export interface AgentConfig {
  name: string;
  description: string;
}
