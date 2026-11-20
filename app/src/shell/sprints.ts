import type { Sprint } from '../api/types';

// 目前 Sprint：starts_at <= 現在 < ends_at；下一期：開始時間在現在之後、最早的那一期。
export function currentSprint(sprints: readonly Sprint[], now: Date): Sprint | null {
  const t = now.getTime();
  return sprints.find((s) => Date.parse(s.starts_at) <= t && t < Date.parse(s.ends_at)) ?? null;
}

export function nextSprint(sprints: readonly Sprint[], now: Date): Sprint | null {
  const t = now.getTime();
  return [...sprints].filter((s) => Date.parse(s.starts_at) > t).sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))[0] ?? null;
}

export function sprintLabel(s: Sprint): string {
  return s.name !== null && s.name.trim() !== '' ? s.name : `Sprint ${String(s.number)}`;
}

// Project 色點：tokens 的 --project-1～10，依 id 輪流。
export function projectColorClass(id: number): string {
  return `pc-${String((id % 10) + 1)}`;
}
