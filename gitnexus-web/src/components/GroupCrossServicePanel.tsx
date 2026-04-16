import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { Loader2, RefreshCw, Share2 } from '@/lib/lucide-icons';
import {
  BackendError,
  fetchGroups,
  fetchGroupRegistry,
  type GroupContractRegistry,
  type GroupCrossLink,
} from '../services/backend-client';

const MATCH_COLORS: Record<string, string> = {
  exact: '#22c55e',
  manifest: '#a78bfa',
  bm25: '#f59e0b',
  embedding: '#38bdf8',
};

/**
 * Left panel: cross-service links from the GitNexus group contract registry
 * (GET /api/groups, GET /api/group/:name/registry). Read-only.
 */
export function GroupCrossServicePanel() {
  const [groups, setGroups] = useState<string[]>([]);
  const [groupName, setGroupName] = useState('');
  const [registry, setRegistry] = useState<GroupContractRegistry | null>(null);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingRegistry, setLoadingRegistry] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadGroups = useCallback(async () => {
    setLoadingList(true);
    setError(null);
    try {
      const g = await fetchGroups();
      setGroups(g);
      setGroupName((prev) => (prev && g.includes(prev) ? prev : (g[0] ?? '')));
    } catch (e) {
      setError(e instanceof BackendError ? e.message : 'Failed to list groups');
      setGroups([]);
    } finally {
      setLoadingList(false);
    }
  }, []);

  const loadRegistry = useCallback(async (name: string) => {
    if (!name.trim()) {
      setRegistry(null);
      return;
    }
    setLoadingRegistry(true);
    setError(null);
    try {
      const r = await fetchGroupRegistry(name.trim());
      setRegistry(r);
    } catch (e) {
      setRegistry(null);
      if (e instanceof BackendError && e.status === 404) {
        setError(`No contracts.json for group "${name}". Run: gitnexus group sync ${name}`);
      } else {
        setError(e instanceof BackendError ? e.message : 'Failed to load registry');
      }
    } finally {
      setLoadingRegistry(false);
    }
  }, []);

  useEffect(() => {
    void loadGroups();
  }, [loadGroups]);

  useEffect(() => {
    if (groupName) void loadRegistry(groupName);
  }, [groupName, loadRegistry]);

  const links = registry?.crossLinks ?? [];

  return (
    <div className="scrollbar-thin flex flex-1 flex-col overflow-hidden">
      <div className="border-b border-border-subtle p-3">
        <div className="mb-2 flex items-center gap-2">
          <Share2 className="h-3.5 w-3.5 text-accent" />
          <h3 className="text-xs font-medium tracking-wide text-text-secondary uppercase">
            Cross-service
          </h3>
        </div>
        <p className="mb-3 text-[11px] leading-snug text-text-muted">
          主画布：连接仓库后，若该仓库在某一组里且已 <code className="text-[10px]">group sync</code>，则每个<strong>远程服务</strong>合并为
          一个粉点 <span className="text-fuchsia-300">RemoteSymbol</span>（洋红 <code className="text-[10px]">CROSS_GROUP</code> 边连到当前项目）；
          点击该节点后在左侧 Code 面板查看<strong>具体依赖点</strong>列表。此处为契约总览。更新后请刷新或重新连接 server。
        </p>

        <div className="flex gap-2">
          <select
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
            disabled={loadingList || groups.length === 0}
            className="min-w-0 flex-1 rounded border border-border-subtle bg-void px-2 py-1.5 text-xs text-text-primary outline-none focus:border-accent"
          >
            {groups.length === 0 ? (
              <option value="">（无组）</option>
            ) : (
              groups.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))
            )}
          </select>
          <button
            type="button"
            onClick={() => {
              void loadGroups();
              if (groupName) void loadRegistry(groupName);
            }}
            disabled={loadingList || loadingRegistry}
            className="flex shrink-0 items-center justify-center rounded border border-border-subtle bg-elevated p-1.5 text-text-secondary hover:bg-hover hover:text-text-primary disabled:opacity-50"
            title="Refresh groups and registry"
          >
            {loadingList || loadingRegistry ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
          </button>
        </div>

        {error && (
          <p className="mt-2 text-[11px] leading-snug text-amber-400" role="alert">
            {error}
          </p>
        )}

        {registry && !error && (
          <p className="mt-2 text-[10px] text-text-muted">
            Registry v{registry.version} · {new Date(registry.generatedAt).toLocaleString()} ·{' '}
            {registry.crossLinks.length} cross-links · {registry.contracts?.length ?? 0} contracts
          </p>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {loadingRegistry && !registry ? (
          <div className="flex justify-center py-8 text-text-muted">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : registry ? (
          <>
            <CrossLinksSvgGraph links={links} />
            <div className="mt-4">
              <h4 className="mb-2 text-[10px] font-medium uppercase tracking-wide text-text-secondary">
                Links
              </h4>
              <div className="max-h-48 overflow-auto rounded border border-border-subtle">
                <table className="w-full text-left text-[10px]">
                  <thead className="sticky top-0 bg-elevated text-text-muted">
                    <tr>
                      <th className="px-2 py-1.5 font-medium">From</th>
                      <th className="px-2 py-1.5 font-medium">To</th>
                      <th className="px-2 py-1.5 font-medium">Match</th>
                      <th className="px-2 py-1.5 font-medium">Contract</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-subtle text-text-primary">
                    {links.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-2 py-3 text-center text-text-muted">
                          No cross-links yet. Run sync and ensure repos share matching contracts.
                        </td>
                      </tr>
                    ) : (
                      links.map((row, i) => (
                        <tr key={i} className="hover:bg-hover/50">
                          <td className="max-w-[72px] truncate px-2 py-1 font-mono" title={row.from.repo}>
                            {row.from.repo}
                          </td>
                          <td className="max-w-[72px] truncate px-2 py-1 font-mono" title={row.to.repo}>
                            {row.to.repo}
                          </td>
                          <td className="whitespace-nowrap px-2 py-1">
                            <span
                              className="rounded px-1 py-0.5 font-medium"
                              style={{
                                backgroundColor: `${MATCH_COLORS[row.matchType] ?? '#64748b'}22`,
                                color: MATCH_COLORS[row.matchType] ?? '#94a3b8',
                              }}
                            >
                              {row.matchType}
                            </span>
                          </td>
                          <td
                            className="max-w-[100px] truncate px-2 py-1 font-mono text-text-secondary"
                            title={row.contractId}
                          >
                            {row.contractId}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {Object.keys(registry.repoSnapshots).length > 0 && (
              <div className="mt-4">
                <h4 className="mb-2 text-[10px] font-medium uppercase tracking-wide text-text-secondary">
                  Repo snapshots
                </h4>
                <ul className="space-y-1 text-[10px] text-text-muted">
                  {Object.entries(registry.repoSnapshots).map(([path, snap]) => (
                    <li key={path} className="font-mono">
                      <span className="text-text-secondary">{path}</span>
                      <span className="mx-1 text-border-subtle">·</span>
                      <span title={snap.lastCommit}>{snap.lastCommit?.slice(0, 7) || '—'}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}

function CrossLinksSvgGraph({ links }: { links: GroupCrossLink[] }) {
  const markerId = useId().replace(/:/g, '');
  const { repos, positions } = useMemo(() => {
    const s = new Set<string>();
    for (const l of links) {
      s.add(l.from.repo);
      s.add(l.to.repo);
    }
    const repoList = [...s].sort();
    const w = 260;
    const h = 200;
    const cx = w / 2;
    const cy = h / 2;
    const r = Math.min(w, h) * 0.34;
    const map = new Map<string, { x: number; y: number }>();
    repoList.forEach((repo, i) => {
      const a = (2 * Math.PI * i) / Math.max(repoList.length, 1) - Math.PI / 2;
      map.set(repo, { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
    });
    return { repos: repoList, positions: map };
  }, [links]);

  if (links.length === 0) {
    return (
      <div className="rounded border border-dashed border-border-subtle py-6 text-center text-[11px] text-text-muted">
        No graph edges
      </div>
    );
  }

  const w = 260;
  const h = 200;

  return (
    <div className="rounded border border-border-subtle bg-void/80 p-2">
      <p className="mb-1 text-[10px] text-text-muted">Consumer → provider (by repo path)</p>
      <svg width={w} height={h} className="mx-auto block" viewBox={`0 0 ${w} ${h}`}>
        <defs>
          <marker id={markerId} markerWidth="6" markerHeight="5" refX="18" refY="2.5" orient="auto">
            <polygon points="0 0, 6 2.5, 0 5" fill="#64748b" />
          </marker>
        </defs>
        {links.map((l, i) => {
          const p0 = positions.get(l.from.repo);
          const p1 = positions.get(l.to.repo);
          if (!p0 || !p1) return null;
          const color = MATCH_COLORS[l.matchType] ?? '#94a3b8';
          return (
            <line
              key={i}
              x1={p0.x}
              y1={p0.y}
              x2={p1.x}
              y2={p1.y}
              stroke={color}
              strokeWidth={1.5}
              strokeOpacity={0.85}
              markerEnd={`url(#${markerId})`}
            />
          );
        })}
        {repos.map((repo) => {
          const p = positions.get(repo);
          if (!p) return null;
          return (
            <g key={repo}>
              <circle cx={p.x} cy={p.y} r={10} fill="#1e293b" stroke="#475569" strokeWidth={1} />
              <text
                x={p.x}
                y={p.y + 22}
                textAnchor="middle"
                fill="#94a3b8"
                fontSize="8"
                className="select-none"
              >
                {repo.length > 16 ? `${repo.slice(0, 14)}…` : repo}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
