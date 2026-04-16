/**
 * Aggregate cross-repo contract edges from all groups for the Web graph overlay.
 */

import { loadGroupConfig } from '../core/group/config-parser.js';
import {
  getDefaultGitnexusDir,
  getGroupDir,
  listGroups,
  readContractRegistry,
} from '../core/group/storage.js';

export type RepoCrossEdgeKind = 'used_by' | 'uses_external';

export interface RepoCrossEdge {
  groupName: string;
  contractId: string;
  matchType: string;
  kind: RepoCrossEdgeKind;
  /** Symbol id in the currently opened repo's graph (may be empty for HTTP providers). */
  localSymbolUid: string;
  localLabel: string;
  /** Local endpoint file/symbol (for Web to match Route or Function when uid is missing). */
  localFilePath: string;
  localSymbolName: string;
  /** Indexed repo name of the other member (from group.yaml repos map). */
  remoteRepoName: string;
  remoteGroupPath: string;
  remoteSymbolUid: string;
  remoteLabel: string;
}

/**
 * For an indexed repo name, collect all crossLinks from any group where this repo
 * participates, with symbol UIDs on both endpoints when present.
 */
export async function collectCrossEdgesForIndexedRepo(repoName: string): Promise<RepoCrossEdge[]> {
  const trimmed = repoName.trim();
  if (!trimmed) return [];

  const groups = await listGroups();
  const out: RepoCrossEdge[] = [];

  for (const groupName of groups) {
    const groupDir = getGroupDir(getDefaultGitnexusDir(), groupName);
    let config;
    try {
      config = await loadGroupConfig(groupDir);
    } catch {
      continue;
    }
    const registry = await readContractRegistry(groupDir);
    if (!registry?.crossLinks?.length) continue;

    const groupPathsForRepo = Object.entries(config.repos)
      .filter(([, regName]) => regName === trimmed)
      .map(([path]) => path);
    if (groupPathsForRepo.length === 0) continue;

    for (const cl of registry.crossLinks) {
      // Local repo is HTTP/gRPC provider: other member consumes → edge from local to remote.
      if (groupPathsForRepo.includes(cl.to.repo) && cl.from.repo !== cl.to.repo) {
        const remoteName = config.repos[cl.from.repo] ?? cl.from.repo;
        out.push({
          groupName,
          contractId: cl.contractId,
          matchType: cl.matchType,
          kind: 'used_by',
          localSymbolUid: cl.to.symbolUid,
          localLabel: cl.to.symbolRef?.name || cl.to.symbolUid || cl.contractId,
          localFilePath: cl.to.symbolRef?.filePath ?? '',
          localSymbolName: cl.to.symbolRef?.name ?? '',
          remoteRepoName: remoteName,
          remoteGroupPath: cl.from.repo,
          remoteSymbolUid: cl.from.symbolUid,
          remoteLabel: cl.from.symbolRef?.name || cl.from.symbolUid || '',
        });
      }
      // Local repo is consumer: edge from local consumer to external provider.
      if (groupPathsForRepo.includes(cl.from.repo) && cl.from.repo !== cl.to.repo) {
        const remoteName = config.repos[cl.to.repo] ?? cl.to.repo;
        out.push({
          groupName,
          contractId: cl.contractId,
          matchType: cl.matchType,
          kind: 'uses_external',
          localSymbolUid: cl.from.symbolUid,
          localLabel: cl.from.symbolRef?.name || cl.from.symbolUid || cl.contractId,
          localFilePath: cl.from.symbolRef?.filePath ?? '',
          localSymbolName: cl.from.symbolRef?.name ?? '',
          remoteRepoName: remoteName,
          remoteGroupPath: cl.to.repo,
          remoteSymbolUid: cl.to.symbolUid,
          remoteLabel: cl.to.symbolRef?.name || cl.to.symbolUid || '',
        });
      }
    }
  }

  return out;
}
