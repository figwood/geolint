import { InspectionError } from '../errors.ts';
import type { TopologyLimits } from './contracts.ts';

export class TopologyBudget {
  private counts = { features: 0, positions: 0, candidates: 0, issues: 0 };
  private started: number;
  private limits: TopologyLimits;
  private signal?: AbortSignal;
  private now: () => number;
  constructor(limits: TopologyLimits, signal?: AbortSignal, now: () => number = () => performance.now()) {
    this.limits = limits; this.signal = signal; this.now = now; this.started = now();
  }
  checkpoint(): void {
    if (this.signal?.aborted) throw new InspectionError('TOPOLOGY_CANCELLED', 'Topology inspection was cancelled.');
    if (this.now() - this.started >= this.limits.durationMs) throw new InspectionError('TOPOLOGY_TIMEOUT', 'Topology inspection exceeded its time budget.');
  }
  reserve(kind: keyof typeof this.counts, count: number): void {
    this.checkpoint();
    if (!Number.isSafeInteger(count) || count < 0 || this.counts[kind] + count > this.limits[kind]) throw new InspectionError('TOPOLOGY_LIMIT_EXCEEDED', `Topology ${kind} limit exceeded.`);
    this.counts[kind] += count;
  }
}
