'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { AppNav } from '@/components/app-nav';

interface Article {
  id: number;
  title: string;
  url: string;
  excerpt: string;
  published_at: string;
  author: string | null;
  category: string | null;
  relevance_score: number | null;
  time_sensitivity: string | null;
  event_date: string | null;
  full_content_used: boolean;
  is_game_recap: boolean;
  source: { name: string; short_name: string } | null;
  article_teams: { team: { id: string; place_name: string; nickname: string; league: string } }[];
  article_players: { player: { id: string; first_name: string; last_name: string } }[];
  article_leagues: { league: { id: string; name: string } }[];
}

interface LeagueData {
  id: string;
  name: string;
  parent_league_id: string | null;
  country: string | null;
}

interface Filters {
  teams: { id: string; place_name: string; nickname: string; league: string }[];
  leagues: LeagueData[];
  players: { id: string; first_name: string; last_name: string }[];
  categories: string[];
}

function teamDisplayName(placeName: string, nickname: string): string {
  if (placeName.toLowerCase().includes(nickname.toLowerCase())) {
    return placeName;
  }
  return `${placeName} ${nickname}`;
}

// League group definitions — maps league names to display groups
const LEAGUE_GROUPS: { label: string; leagues: string[] }[] = [
  { label: 'Professional', leagues: ['NHL'] },
  { label: 'College', leagues: ['NCAA', 'Hockey East', 'ECAC', 'CCHA', 'Big Ten', 'AHA', 'NCHC'] },
  { label: 'Junior', leagues: ['CHL', 'OHL', 'WHL', 'QMJHL', 'USHL', 'NAHL', 'USNTDP'] },
  { label: 'Minor Pro', leagues: ['AHL', 'ECHL', 'SPHL'] },
  {
    label: 'Europe',
    leagues: ['SHL', 'KHL', 'Liiga', 'Czech Extraliga', 'DEL', 'National League'],
  },
];

function groupLeagues(leagues: LeagueData[]) {
  const leagueMap = new Map(leagues.map((l) => [l.name, l]));
  const grouped: { label: string; items: LeagueData[] }[] = [];
  const used = new Set<string>();

  for (const group of LEAGUE_GROUPS) {
    const items: LeagueData[] = [];
    for (const name of group.leagues) {
      const league = leagueMap.get(name);
      if (league) {
        items.push(league);
        used.add(league.id);
      }
    }
    if (items.length > 0) {
      grouped.push({ label: group.label, items });
    }
  }

  // Any leagues not in a defined group go into "Other"
  const other = leagues.filter((l) => !used.has(l.id));
  if (other.length > 0) {
    grouped.push({ label: 'Other', items: other });
  }

  return grouped;
}

// Collect all league names in a group (including the selected league itself)
function getLeagueNamesForFilter(
  selectedLeagueId: string,
  leagues: LeagueData[],
): string[] {
  const selected = leagues.find((l) => l.id === selectedLeagueId);
  if (!selected) return [];

  // Get the selected league + any child leagues (e.g. selecting NCAA includes conferences)
  const names = [selected.name];
  for (const l of leagues) {
    if (l.parent_league_id === selectedLeagueId) {
      names.push(l.name);
    }
  }
  return names;
}

function RelevanceBadge({ score }: { score: number | null }) {
  if (score === null) return <Badge variant="outline">Unscored</Badge>;
  if (score >= 90) return <Badge className="bg-red-600 text-white">Critical {score}</Badge>;
  if (score >= 70) return <Badge className="bg-orange-500 text-white">High {score}</Badge>;
  if (score >= 50) return <Badge className="bg-yellow-500 text-black">Medium {score}</Badge>;
  if (score >= 30) return <Badge variant="secondary">Low {score}</Badge>;
  return <Badge variant="outline">Minor {score}</Badge>;
}

function TimeBadge({ sensitivity, eventDate }: { sensitivity: string | null; eventDate: string | null }) {
  if (!sensitivity) return null;
  const label = eventDate
    ? `${sensitivity} (${new Date(eventDate).toLocaleDateString()})`
    : sensitivity;
  return (
    <Badge variant="outline" className="text-xs">
      {label}
    </Badge>
  );
}

function ArticleCard({ article }: { article: Article }) {
  const teams = article.article_teams?.map((at) => at.team).filter(Boolean) ?? [];
  const players = article.article_players?.map((ap) => ap.player).filter(Boolean) ?? [];
  const leagues = article.article_leagues?.map((al) => al.league).filter(Boolean) ?? [];
  const source = Array.isArray(article.source)
    ? (article.source as unknown as { short_name: string }[])[0]
    : article.source;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1.5">
            <a
              href={article.url}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:underline"
            >
              <CardTitle className="text-base leading-snug">
                {article.title}
              </CardTitle>
            </a>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              {source && <span>{source.short_name}</span>}
              <span>{new Date(article.published_at).toLocaleDateString()}</span>
              {article.author && <span>by {article.author}</span>}
            </div>
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            <RelevanceBadge score={article.relevance_score} />
            {article.category && (
              <Badge variant="secondary" className="text-xs">
                {article.category}
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {article.excerpt && (
          <p className="text-sm text-muted-foreground leading-relaxed">
            {article.excerpt}
          </p>
        )}

        <div className="flex flex-wrap gap-1.5">
          {teams.map((t) => (
            <Badge key={t.id} variant="default" className="text-xs">
              {teamDisplayName(t.place_name, t.nickname)}
            </Badge>
          ))}
          {players.map((p) => (
            <Badge key={p.id} className="bg-blue-600 text-white text-xs">
              {p.first_name} {p.last_name}
            </Badge>
          ))}
          {leagues.map((l) => (
            <Badge key={l.id} variant="outline" className="text-xs">
              {l.name}
            </Badge>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <TimeBadge
            sensitivity={article.time_sensitivity}
            eventDate={article.event_date}
          />
          {article.full_content_used && (
            <Badge variant="outline" className="text-xs text-green-500 border-green-500/30">
              Full content
            </Badge>
          )}
          {article.is_game_recap && (
            <Badge variant="outline" className="text-xs">
              Game recap
            </Badge>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function ArticleSkeleton() {
  return (
    <Card>
      <CardHeader className="pb-3">
        <Skeleton className="h-5 w-3/4" />
        <Skeleton className="h-4 w-1/3 mt-2" />
      </CardHeader>
      <CardContent>
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-2/3 mt-2" />
        <div className="flex gap-2 mt-3">
          <Skeleton className="h-5 w-20" />
          <Skeleton className="h-5 w-16" />
        </div>
      </CardContent>
    </Card>
  );
}

export default function ArticlesPage() {
  const [articles, setArticles] = useState<Article[]>([]);
  const [filters, setFilters] = useState<Filters | null>(null);
  const [loading, setLoading] = useState(true);

  const [selectedGroup, setSelectedGroup] = useState<string>('');
  const [selectedLeague, setSelectedLeague] = useState<string>('');
  const [selectedTeam, setSelectedTeam] = useState<string>('');
  const [selectedPlayer, setSelectedPlayer] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<string>('');

  const fetchArticles = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (selectedTeam) params.set('teamId', selectedTeam);
    if (selectedLeague) params.set('leagueId', selectedLeague);
    if (selectedPlayer) params.set('playerId', selectedPlayer);
    if (selectedCategory) params.set('category', selectedCategory);

    const res = await fetch(`/api/articles?${params}`);
    const data = await res.json();
    setArticles(data.articles ?? []);
    setLoading(false);
  }, [selectedTeam, selectedLeague, selectedPlayer, selectedCategory]);

  useEffect(() => {
    fetch('/api/articles/filters')
      .then((r) => r.json())
      .then(setFilters);
  }, []);

  useEffect(() => {
    fetchArticles();
  }, [fetchArticles]);

  // Group leagues for the group dropdown
  const groupedLeagues = useMemo(
    () => (filters ? groupLeagues(filters.leagues) : []),
    [filters],
  );

  // Leagues filtered by selected group
  const leaguesInGroup = useMemo(() => {
    if (!selectedGroup) return filters?.leagues ?? [];
    const group = groupedLeagues.find((g) => g.label === selectedGroup);
    return group?.items ?? [];
  }, [selectedGroup, groupedLeagues, filters]);

  // All league names that match the selected league (including children)
  const leagueNamesForTeamFilter = useMemo(() => {
    if (!selectedLeague || !filters) return null;
    return getLeagueNamesForFilter(selectedLeague, filters.leagues);
  }, [selectedLeague, filters]);

  // All league names in the selected group (for team filtering when group selected but no league)
  const leagueNamesForGroupFilter = useMemo(() => {
    if (!selectedGroup || selectedLeague) return null;
    return leaguesInGroup.map((l) => l.name);
  }, [selectedGroup, selectedLeague, leaguesInGroup]);

  // Teams filtered by league or group
  const filteredTeams = useMemo(() => {
    if (!filters) return [];
    if (leagueNamesForTeamFilter) {
      return filters.teams.filter((t) => leagueNamesForTeamFilter.includes(t.league));
    }
    if (leagueNamesForGroupFilter) {
      return filters.teams.filter((t) => leagueNamesForGroupFilter.includes(t.league));
    }
    return filters.teams;
  }, [filters, leagueNamesForTeamFilter, leagueNamesForGroupFilter]);

  // Cascade clears: group change clears league and team, league change clears team
  function handleGroupChange(group: string) {
    setSelectedGroup(group);
    setSelectedLeague('');
    setSelectedTeam('');
  }

  function handleLeagueChange(league: string) {
    setSelectedLeague(league);
    setSelectedTeam('');
  }

  // Display names
  const selectedLeagueName = useMemo(() => {
    if (!selectedLeague || !filters) return undefined;
    return filters.leagues.find((l) => l.id === selectedLeague)?.name;
  }, [selectedLeague, filters]);

  const selectedTeamName = useMemo(() => {
    if (!selectedTeam || !filters) return undefined;
    const team = filters.teams.find((t) => t.id === selectedTeam);
    return team ? teamDisplayName(team.place_name, team.nickname) : undefined;
  }, [selectedTeam, filters]);

  const selectedPlayerName = useMemo(() => {
    if (!selectedPlayer || !filters) return undefined;
    const player = filters.players.find((p) => p.id === selectedPlayer);
    return player ? `${player.first_name} ${player.last_name}` : undefined;
  }, [selectedPlayer, filters]);

  const hasFilters = selectedGroup || selectedLeague || selectedTeam || selectedPlayer || selectedCategory;

  return (
    <div className="flex flex-1 flex-col">
      <AppNav />
      <div className="px-6 py-4">
        <h1 className="text-xl font-semibold">Articles</h1>
        <p className="text-sm text-muted-foreground">
          {loading ? 'Loading...' : `${articles.length} articles`}
        </p>
      </div>

      <div className="flex flex-1">
        {/* Filters sidebar */}
        <div className="w-64 shrink-0 border-r p-4 space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Group</label>
            <Select
              value={selectedGroup || 'all'}
              onValueChange={(v) => handleGroupChange(v === 'all' ? '' : v ?? '')}
            >
              <SelectTrigger>
                <SelectValue>
                  {selectedGroup || 'All groups'}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All groups</SelectItem>
                {groupedLeagues.map((g) => (
                  <SelectItem key={g.label} value={g.label}>
                    {g.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">League</label>
            <Select
              value={selectedLeague || 'all'}
              onValueChange={(v) => handleLeagueChange(v === 'all' ? '' : v ?? '')}
            >
              <SelectTrigger>
                <SelectValue>
                  {selectedLeagueName || 'All leagues'}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">
                  {selectedGroup ? `All ${selectedGroup}` : 'All leagues'}
                </SelectItem>
                {leaguesInGroup.map((l) => (
                  <SelectItem key={l.id} value={l.id}>
                    {l.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Team</label>
            <Select
              value={selectedTeam || 'all'}
              onValueChange={(v) => setSelectedTeam(v === 'all' ? '' : v ?? '')}
            >
              <SelectTrigger>
                <SelectValue>
                  {selectedTeamName || 'All teams'}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All teams</SelectItem>
                {filteredTeams.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {teamDisplayName(t.place_name, t.nickname)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Separator />

          <div className="space-y-2">
            <label className="text-sm font-medium">Player</label>
            <Select
              value={selectedPlayer || 'all'}
              onValueChange={(v) => setSelectedPlayer(v === 'all' ? '' : v ?? '')}
            >
              <SelectTrigger>
                <SelectValue>
                  {selectedPlayerName || 'All players'}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All players</SelectItem>
                {filters?.players.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.first_name} {p.last_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Category</label>
            <Select
              value={selectedCategory || 'all'}
              onValueChange={(v) => setSelectedCategory(v === 'all' ? '' : v ?? '')}
            >
              <SelectTrigger>
                <SelectValue>
                  {selectedCategory || 'All categories'}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                {filters?.categories.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {hasFilters && (
            <button
              onClick={() => {
                setSelectedGroup('');
                setSelectedLeague('');
                setSelectedTeam('');
                setSelectedPlayer('');
                setSelectedCategory('');
              }}
              className="text-sm text-muted-foreground hover:text-foreground underline"
            >
              Clear all filters
            </button>
          )}
        </div>

        {/* Articles list */}
        <div className="flex-1 p-6 space-y-4 overflow-auto">
          {loading ? (
            <>
              <ArticleSkeleton />
              <ArticleSkeleton />
              <ArticleSkeleton />
            </>
          ) : articles.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                No articles found. Try adjusting your filters or run the agent to
                fetch some articles.
              </CardContent>
            </Card>
          ) : (
            articles.map((article) => (
              <ArticleCard key={article.id} article={article} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
