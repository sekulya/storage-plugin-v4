import type { PluginJobDelivery } from '@erxes/core-contract';

interface Job {
  /** A cron schedule in UTC: core runs the job for each organisation that has the plugin. */
  cron?: string;
  /** Throws to retry. A job can run more than once, so make it safe to repeat. */
  run: (job: PluginJobDelivery) => Promise<void>;
}

/**
 * The plugin's jobs, by name. Core POSTs each to `/api/jobs/<name>` and
 * retries until it answers 2xx. Queue one in a procedure's transaction:
 * `await enqueueJob(context.tx, { orgId, name: '<job>', payload: {} })`. Storage has none yet.
 */
const JOBS: Record<string, Job> = {};

/** The manifest's `jobs`. */
export const manifestJobs = Object.entries(JOBS).map(([name, { cron }]) =>
  cron ? { name, cron } : { name },
);

export const runJob = async (job: PluginJobDelivery) => {
  const found = JOBS[job.name];

  if (!found) throw new Error(`No job ${job.name}`);

  await found.run(job);
};
