import type { AnalyzeJob, AnalyzeJobProgress } from './analyze-job.js';

/**
 * Whether an analyze/embed job SSE stream should send a terminal `event:` and close.
 *
 * The ingestion pipeline reports `progress.phase === 'complete'` when the parse graph
 * finishes — still mid-job (LadybugDB, registry, backend reload). Embedding maps
 * `ready` → `progress.phase === 'complete'` before `job.status` flips to `complete`.
 * Only {@link AnalyzeJob.status} is authoritative for closing the stream.
 */
export function shouldEndJobProgressStream(
  job: Pick<AnalyzeJob, 'status'> | undefined,
  progress: Pick<AnalyzeJobProgress, 'phase'>,
): boolean {
  const jobTerminal = job?.status === 'complete' || job?.status === 'failed';
  const progressLooksTerminal = progress.phase === 'complete' || progress.phase === 'failed';
  return progressLooksTerminal && jobTerminal;
}
