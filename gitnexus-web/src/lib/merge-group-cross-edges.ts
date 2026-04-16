import type { GraphNode, GraphRelationship } from 'gitnexus-shared';

/** One resolved contract edge; stored on aggregated RemoteSymbol for drill-down in the UI. */
export interface CrossGroupDetailItem {
  contractId: string;
  matchType: string;
  kind: 'used_by' | 'uses_external';
  remoteLabel: string;
  remoteSymbolUid: string;
  /** Local graph node this contract was anchored to (Route, File, Function, …). */
  localAnchorId: string;
  localFilePath: string;
  localSymbolName: string;
}

export interface RepoCrossEdgeDto {
  groupName: string;
  contractId: string;
  matchType: string;
  kind: 'used_by' | 'uses_external';
  localSymbolUid: string;
  localLabel: string;
  localFilePath: string;
  localSymbolName: string;
  remoteRepoName: string;
  remoteGroupPath: string;
  remoteSymbolUid: string;
  remoteLabel: string;
}

function normPath(p: string): string {
  const s = p.replace(/\\/g, '/').replace(/\/+$/, '');
  return s || '/';
}

/**
 * Same semantics as `normalizeHttpPath` in gitnexus group http-route-extractor:
 * contracts use normalized paths while Route nodes keep framework-native paths
 * (e.g. `/users/:id` vs `/users/{param}`).
 */
function normalizeHttpPathForCrossMatch(p: string): string {
  let s = p.trim().split('?')[0].toLowerCase().replace(/\/+$/, '');
  s = s.replace(/:\w+/g, '{param}');
  s = s.replace(/\{[^}]+\}/g, '{param}');
  s = s.replace(/\[[^\]]+\]/g, '{param}');
  return s;
}

/** Path segment of `http::METHOD::/path` contracts. */
function httpPathFromContractId(contractId: string): string | null {
  if (!contractId.toLowerCase().startsWith('http::')) return null;
  const rest = contractId.slice('http::'.length);
  const idx = rest.indexOf('::');
  if (idx < 0) return null;
  let pathPart = rest.slice(idx + 2).split('?')[0].trim();
  if (!pathPart.startsWith('/')) pathPart = `/${pathPart}`;
  return normPath(pathPart);
}

function findRouteNodeIdForContract(nodes: GraphNode[], contractId: string): string | null {
  const p = httpPathFromContractId(contractId);
  if (!p) return null;
  const normContract = normalizeHttpPathForCrossMatch(p);
  const candId = `Route:${p}`;

  for (const n of nodes) {
    if (n.label !== 'Route') continue;
    if (n.id === candId) return n.id;

    const name = String(n.properties?.name ?? '');
    if (name && normalizeHttpPathForCrossMatch(name) === normContract) return n.id;

    if (n.id.startsWith('Route:')) {
      const idPath = n.id.slice('Route:'.length);
      if (normalizeHttpPathForCrossMatch(idPath) === normContract) return n.id;
    }

    // Plain path equality (case-insensitive, trailing slash) when no param tokens differ
    const nm = normPath(name).toLowerCase();
    const lower = p.toLowerCase();
    if (nm === lower) return n.id;
  }
  return null;
}

/** When global path match fails (mounted routers, prefix drift), score routes in the provider file. */
function routePathMatchScore(normContract: string, routeNorm: string): number {
  if (!normContract || !routeNorm) return 0;
  if (normContract === routeNorm) return 10_000 + routeNorm.length;
  if (normContract.endsWith(routeNorm)) return 5_000 + routeNorm.length;
  if (routeNorm.endsWith(normContract)) return 4_000 + normContract.length;
  return 0;
}

/**
 * Prefer Route nodes declared in the same file as the provider symbol (group registry filePath).
 * Handles Express sub-routers vs consumer full paths, and multiple routes per file.
 */
function findRouteInProviderFileForContract(
  nodes: GraphNode[],
  localFilePath: string,
  contractId: string,
): string | null {
  if (!localFilePath) return null;
  const p = httpPathFromContractId(contractId);
  if (!p) return null;
  const normContract = normalizeHttpPathForCrossMatch(p);

  let bestId: string | null = null;
  let bestScore = 0;
  for (const n of nodes) {
    if (n.label !== 'Route') continue;
    const fp = String(n.properties?.filePath ?? '');
    if (!filePathsRoughMatch(fp, localFilePath)) continue;

    const name = String(n.properties?.name ?? '');
    const idPath = n.id.startsWith('Route:') ? n.id.slice('Route:'.length) : '';
    for (const cand of [name, idPath]) {
      if (!cand) continue;
      const routeNorm = normalizeHttpPathForCrossMatch(cand);
      const sc = routePathMatchScore(normContract, routeNorm);
      if (sc > bestScore) {
        bestScore = sc;
        bestId = n.id;
      }
    }
  }
  return bestId;
}

const WEAK_SYMBOL_NAMES = new Set(['', 'handler', 'route', 'anonymous', '<anonymous>']);

function isWeakLocalSymbolName(name: string): boolean {
  const t = name.trim();
  if (!t) return true;
  if (WEAK_SYMBOL_NAMES.has(t.toLowerCase())) return true;
  return false;
}

/** Single obvious code symbol in a file (Express anonymous handlers, manifest-only refs). */
function findSingletonCodeSymbolInFile(nodes: GraphNode[], filePath: string): string | null {
  if (!filePath) return null;
  const labels = new Set(['Function', 'Method', 'Class', 'Interface']);
  const hits: GraphNode[] = [];
  for (const n of nodes) {
    if (!labels.has(n.label)) continue;
    const fp = String(n.properties?.filePath ?? '');
    if (!filePathsRoughMatch(fp, filePath)) continue;
    hits.push(n);
  }
  if (hits.length !== 1) return null;
  return hits[0]!.id;
}

function findFileNodeIdForPath(nodes: GraphNode[], filePath: string): string | null {
  if (!filePath) return null;
  for (const n of nodes) {
    if (n.label !== 'File') continue;
    const fp = String(n.properties?.filePath ?? '');
    if (filePathsRoughMatch(fp, filePath)) return n.id;
  }
  return null;
}

function filePathsRoughMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  const na = normPath(a);
  const nb = normPath(b);
  if (na === nb) return true;
  return na.endsWith(nb) || nb.endsWith(na);
}

/** Match Function/Method/Class… by file path + symbol name when uid is missing or mismatched. */
function findNodeByFileAndName(nodes: GraphNode[], filePath: string, symName: string): string | null {
  if (!filePath || !symName) return null;
  for (const n of nodes) {
    if (n.label === 'Route' || n.label === 'Community' || n.label === 'Process') continue;
    const fp = String(n.properties?.filePath ?? '');
    const nm = String(n.properties?.name ?? '');
    if (!fp || !nm) continue;
    if (!filePathsRoughMatch(fp, filePath)) continue;
    if (nm === symName || nm.endsWith(`.${symName}`) || nm.endsWith(symName)) return n.id;
  }
  return null;
}

/**
 * Resolve an anchor node id in the **current** repo graph for this cross-link.
 * Order: explicit uid → HTTP Route (global path) → file+name (non-weak) → Route in same file
 * (suffix / mount drift) → singleton symbol when name is weak (`handler`, empty) → File node.
 */
function resolveLocalAnchor(edge: RepoCrossEdgeDto, nodeIdSet: Set<string>, nodes: GraphNode[]): string | null {
  if (edge.localSymbolUid && nodeIdSet.has(edge.localSymbolUid)) return edge.localSymbolUid;

  if (edge.kind === 'used_by') {
    const routeId = findRouteNodeIdForContract(nodes, edge.contractId);
    if (routeId && nodeIdSet.has(routeId)) return routeId;
  }

  if (!isWeakLocalSymbolName(edge.localSymbolName)) {
    const byFile = findNodeByFileAndName(nodes, edge.localFilePath, edge.localSymbolName);
    if (byFile && nodeIdSet.has(byFile)) return byFile;
  }

  if (edge.kind === 'used_by' && edge.localFilePath && httpPathFromContractId(edge.contractId)) {
    const routeInFile = findRouteInProviderFileForContract(nodes, edge.localFilePath, edge.contractId);
    if (routeInFile && nodeIdSet.has(routeInFile)) return routeInFile;
  }

  if (edge.localFilePath && isWeakLocalSymbolName(edge.localSymbolName)) {
    const single = findSingletonCodeSymbolInFile(nodes, edge.localFilePath);
    if (single && nodeIdSet.has(single)) return single;
  }

  if (edge.localFilePath) {
    const fileId = findFileNodeIdForPath(nodes, edge.localFilePath);
    if (fileId && nodeIdSet.has(fileId)) return fileId;
  }

  return null;
}

function remoteServiceGroupKey(edge: RepoCrossEdgeDto): string {
  return `${edge.kind}|${edge.groupName}|${edge.remoteGroupPath}|${edge.remoteRepoName}`;
}

function remoteServiceNodeId(key: string): string {
  return `gitnexus-cross-svc:${encodeURIComponent(key)}`;
}

function preferStructuralRootAnchor(nodes: GraphNode[], nodeIdSet: Set<string>): string | null {
  const pick = (label: GraphNode['label']): string | null => {
    const ids = nodes
      .filter((n) => n.label === label && nodeIdSet.has(n.id))
      .map((n) => n.id)
      .sort();
    return ids[0] ?? null;
  };
  return pick('Project') ?? pick('Package') ?? pick('Module');
}

function pickCanonicalLocalAnchor(anchors: string[]): string | null {
  if (anchors.length === 0) return null;
  const counts = new Map<string, number>();
  for (const a of anchors) counts.set(a, (counts.get(a) ?? 0) + 1);
  const entries = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return entries[0]![0];
}

/**
 * Inject one RemoteSymbol per remote service (same group + remote path + repo + edge kind),
 * with a single CROSS_GROUP edge from a structural root (Project / Package / Module) or the
 * most common resolved local anchor. Details for each underlying contract are in
 * `properties.crossGroupDetailJson` for the Code panel drill-down.
 */
export function mergeGroupCrossEdges(
  nodes: GraphNode[],
  relationships: GraphRelationship[],
  edges: RepoCrossEdgeDto[],
): { nodes: GraphNode[]; relationships: GraphRelationship[] } {
  const nodeIdSet = new Set(nodes.map((n) => n.id));
  const extraNodes: GraphNode[] = [];
  const extraRels: GraphRelationship[] = [];

  const groups = new Map<string, RepoCrossEdgeDto[]>();
  for (const edge of edges) {
    const k = remoteServiceGroupKey(edge);
    const list = groups.get(k) ?? [];
    list.push(edge);
    groups.set(k, list);
  }

  for (const groupEdges of groups.values()) {
    const first = groupEdges[0];
    if (!first) continue;

    const details: CrossGroupDetailItem[] = [];
    const anchorsResolved: string[] = [];
    for (const edge of groupEdges) {
      const localAnchor = resolveLocalAnchor(edge, nodeIdSet, nodes);
      if (!localAnchor) continue;
      anchorsResolved.push(localAnchor);
      details.push({
        contractId: edge.contractId,
        matchType: edge.matchType,
        kind: edge.kind,
        remoteLabel: edge.remoteLabel,
        remoteSymbolUid: edge.remoteSymbolUid,
        localAnchorId: localAnchor,
        localFilePath: edge.localFilePath,
        localSymbolName: edge.localSymbolName,
      });
    }
    if (details.length === 0) continue;

    const key = remoteServiceGroupKey(first);
    const synId = remoteServiceNodeId(key);

    const root = preferStructuralRootAnchor(nodes, nodeIdSet);
    const edgeSource = root ?? pickCanonicalLocalAnchor(anchorsResolved);
    if (!edgeSource || !nodeIdSet.has(edgeSource)) continue;

    const remoteTitle = first.remoteRepoName;
    const n = details.length;
    const nameLabel =
      first.kind === 'used_by'
        ? `↩ ${remoteTitle}（${n} 处依赖当前服务）`
        : `→ ${remoteTitle}（${n} 处调用）`;

    extraNodes.push({
      id: synId,
      label: 'RemoteSymbol',
      properties: {
        name: nameLabel,
        filePath: '',
        description: `组 ${first.groupName} · ${first.remoteGroupPath}`,
        crossGroupDetailJson: JSON.stringify(details),
        crossGroupEdgeCount: n,
      },
    });

    const relBase = `${edgeSource}_CROSS_GROUP_${synId}`;
    const conf =
      details.every((d) => d.matchType === 'exact' || d.matchType === 'manifest') ? 1 : 0.95;
    extraRels.push({
      id: relBase,
      sourceId: edgeSource,
      targetId: synId,
      type: 'CROSS_GROUP',
      confidence: conf,
      reason:
        first.kind === 'used_by'
          ? `Used by ${remoteTitle} (${n} site${n > 1 ? 's' : ''})`
          : `Uses ${remoteTitle} (${n} site${n > 1 ? 's' : ''})`,
    });
  }

  return {
    nodes: [...nodes, ...extraNodes],
    relationships: [...relationships, ...extraRels],
  };
}
