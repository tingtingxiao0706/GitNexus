/**
 * Convert group.yaml manifest `links` into CrossLinks and merge with exact-match results.
 * OpenSpec / inferred sources are out of scope here.
 */

import type { CrossLink, GroupManifestLink, StoredContract } from './types.js';
import { normalizeContractId } from './matching.js';

const EMPTY_REF = { filePath: '', name: '' };

/** Build canonical contract id string from a manifest link (aligns with extractors + normalizeContractId). */
export function manifestContractId(link: GroupManifestLink): string {
  const c = link.contract.trim();
  const lower = c.toLowerCase();
  if (
    lower.startsWith('http::') ||
    lower.startsWith('grpc::') ||
    lower.startsWith('topic::') ||
    lower.startsWith('lib::') ||
    lower.startsWith('custom::')
  ) {
    return normalizeContractId(c);
  }
  return normalizeContractId(`${link.type}::${c}`);
}

/** Consumer repo → provider repo (internal convention matches runExactMatch). */
export function consumerProviderRepos(link: GroupManifestLink): { consumer: string; provider: string } {
  if (link.role === 'consumer') {
    return { consumer: link.from, provider: link.to };
  }
  return { consumer: link.to, provider: link.from };
}

function pickContract(
  contracts: StoredContract[],
  repo: string,
  role: 'consumer' | 'provider',
  normalizedId: string,
): StoredContract | null {
  const matches = contracts.filter(
    (c) => c.repo === repo && c.role === role && normalizeContractId(c.contractId) === normalizedId,
  );
  if (matches.length === 0) return null;
  matches.sort((a, b) => a.symbolUid.localeCompare(b.symbolUid));
  return matches[0];
}

function crossLinkTriple(link: CrossLink): string {
  return `${link.from.repo}|${link.to.repo}|${normalizeContractId(link.contractId)}`;
}

/**
 * Emit one CrossLink per distinct manifest declaration (consumer, provider, contract).
 * Symbol endpoints are filled when a matching StoredContract exists; otherwise empty uid/ref.
 */
export function manifestLinksToCrossLinks(
  links: GroupManifestLink[],
  contracts: StoredContract[],
): CrossLink[] {
  const seen = new Set<string>();
  const out: CrossLink[] = [];

  for (const link of links) {
    const { consumer, provider } = consumerProviderRepos(link);
    const canonicalId = manifestContractId(link);
    const norm = normalizeContractId(canonicalId);
    const dedupKey = `${consumer}|${provider}|${norm}`;
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);

    const cons = pickContract(contracts, consumer, 'consumer', norm);
    const prov = pickContract(contracts, provider, 'provider', norm);
    const contractId = cons?.contractId ?? prov?.contractId ?? canonicalId;

    out.push({
      from: {
        repo: consumer,
        service: cons?.service,
        symbolUid: cons?.symbolUid ?? '',
        symbolRef: cons?.symbolRef ?? EMPTY_REF,
      },
      to: {
        repo: provider,
        service: prov?.service,
        symbolUid: prov?.symbolUid ?? '',
        symbolRef: prov?.symbolRef ?? EMPTY_REF,
      },
      type: link.type,
      contractId,
      matchType: 'manifest',
      confidence: 1.0,
    });
  }

  return out;
}

/** Keep all exact links; add manifest links only when no exact link covers the same triple. */
export function mergeManifestWithExact(exact: CrossLink[], manifest: CrossLink[]): CrossLink[] {
  const exactTriples = new Set<string>();
  for (const e of exact) {
    exactTriples.add(crossLinkTriple(e));
  }
  const out = [...exact];
  for (const m of manifest) {
    if (exactTriples.has(crossLinkTriple(m))) continue;
    out.push(m);
  }
  return out;
}
