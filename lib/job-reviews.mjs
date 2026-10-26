import { createHash } from 'node:crypto';

export function reviewFingerprint(job) {
  return createHash('sha256').update(JSON.stringify([job.t, job.l, job.country || '', job.description || ''])).digest('hex');
}
export function reviewedJob(job, reviews) {
  const review = reviews[job.u];
  // A changed job description must be reviewed again before displaying an old assessment.
  if (!review || review.fingerprint !== reviewFingerprint(job)) return job;
  const { fingerprint, ...note } = review;
  return { ...job, review: note };
}
