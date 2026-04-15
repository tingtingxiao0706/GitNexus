/**
 * Analyze / embed SSE: terminal event must not fire on pipeline mid-flight
 * `progress.phase === 'complete'` (see ingestion pipeline + embedding "ready" mapping).
 */
import { describe, it, expect, afterAll } from 'vitest';
import { JobManager } from '../../src/server/analyze-job.js';
import { shouldEndJobProgressStream } from '../../src/server/job-progress-sse.js';

describe('job progress SSE terminal detection', () => {
  it('does not end stream on pipeline graph "complete" while job is still analyzing', () => {
    const job = {
      status: 'analyzing' as const,
      repoName: undefined,
      error: undefined,
    };
    expect(
      shouldEndJobProgressStream(job, {
        phase: 'complete',
        percent: 100,
        message: 'Graph complete!',
      } as const),
    ).toBe(false);
  });

  it('does not end stream on embedding "ready" mapped to phase complete while analyzing', () => {
    const job = { status: 'analyzing' as const };
    expect(shouldEndJobProgressStream(job, { phase: 'complete' })).toBe(false);
  });

  it('ends stream when job is complete and progress phase is complete', () => {
    const job = { status: 'complete' as const, repoName: 'my-repo' };
    expect(shouldEndJobProgressStream(job, { phase: 'complete' })).toBe(true);
  });

  it('ends stream when job is failed and progress phase is failed', () => {
    const job = { status: 'failed' as const, error: 'boom' };
    expect(shouldEndJobProgressStream(job, { phase: 'failed' })).toBe(true);
  });

  it('does not end stream on arbitrary phase even if job is complete', () => {
    const job = { status: 'complete' as const };
    expect(shouldEndJobProgressStream(job, { phase: 'lbug' })).toBe(false);
  });

  it('does not end stream when job is undefined', () => {
    expect(shouldEndJobProgressStream(undefined, { phase: 'complete' })).toBe(false);
  });
});

describe('JobManager + SSE terminal policy (integration)', () => {
  const manager = new JobManager();

  afterAll(() => manager.dispose());

  it('mirrors analyze flow: mid-job pipeline complete then real job complete', () => {
    const job = manager.createJob({ repoUrl: 'https://github.com/example/repo' });
    const received: Array<{ close: boolean; phase: string }> = [];

    const unsubscribe = manager.onProgress(job.id, (progress) => {
      const j = manager.getJob(job.id);
      received.push({
        close: shouldEndJobProgressStream(j, progress),
        phase: progress.phase,
      });
    });

    manager.updateJob(job.id, {
      status: 'analyzing',
      repoPath: '/tmp/repo',
      progress: { phase: 'parsing', percent: 10, message: 'Parsing' },
    });
    // Same shape as pipeline.ts onProgress({ phase: 'complete', ... }) while still analyzing
    manager.updateJob(job.id, {
      status: 'analyzing',
      progress: {
        phase: 'complete',
        percent: 60,
        message: 'Graph complete! (mid-flight)',
      },
    });
    manager.updateJob(job.id, { status: 'complete', repoName: 'repo' });

    unsubscribe();

    expect(received).toEqual([
      { close: false, phase: 'parsing' },
      { close: false, phase: 'complete' },
      { close: true, phase: 'complete' },
    ]);
  });
});
