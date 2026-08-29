import * as semver from "semver";
import type { ChangeEvent, Changes } from "../schemas/changes.js";
import type { ExternalDependency, ProjectSnapshot, Snapshot } from "../schemas/snapshot.js";

export function compareSnapshots(previous: Snapshot | null, current: Snapshot): Changes {
  if (previous === null) {
    return {
      schemaVersion: 1,
      from: null,
      to: current.scannedAt,
      baseline: true,
      projects: current.projects.map((project) => ({ id: project.id, events: [] })),
    };
  }

  const previousById = new Map(previous.projects.map((project) => [project.id, project]));
  return {
    schemaVersion: 1,
    from: previous.scannedAt,
    to: current.scannedAt,
    baseline: false,
    projects: current.projects.map((project) => ({
      id: project.id,
      events: compareProject(previousById.get(project.id), project),
    })),
  };
}

function compareProject(previous: ProjectSnapshot | undefined, current: ProjectSnapshot): ChangeEvent[] {
  const events: ChangeEvent[] = [];
  const previousDependencies = new Map((previous?.dependencies ?? []).map((dependency) => [dependency.name, dependency]));
  const currentDependencies = new Map(current.dependencies.map((dependency) => [dependency.name, dependency]));

  for (const [name, dependency] of currentDependencies) {
    const prior = previousDependencies.get(name);
    if (!prior) {
      events.push(...dependency.usages.map((usage) => ({
        type: "dependency-added" as const,
        package: name,
        workspaceId: usage.workspaceId,
        section: usage.section,
        resolved: usage.resolved,
      })));
      continue;
    }
    events.push(...compareDependency(prior, dependency));
  }

  for (const [name, dependency] of previousDependencies) {
    if (currentDependencies.has(name)) continue;
    events.push(...dependency.usages.map((usage) => ({
      type: "dependency-removed" as const,
      package: name,
      workspaceId: usage.workspaceId,
      section: usage.section,
      resolved: usage.resolved,
    })));
  }
  return events;
}

function compareDependency(previous: ExternalDependency, current: ExternalDependency): ChangeEvent[] {
  const events: ChangeEvent[] = [];
  const previousUsages = new Map(previous.usages.map((usage) => [usageKey(usage), usage]));
  const currentUsages = new Map(current.usages.map((usage) => [usageKey(usage), usage]));

  for (const [key, usage] of currentUsages) {
    const prior = previousUsages.get(key);
    if (!prior) {
      events.push({ type: "dependency-added", package: current.name, workspaceId: usage.workspaceId, section: usage.section, resolved: usage.resolved });
      continue;
    }
    if (prior.resolved && usage.resolved && prior.resolved !== usage.resolved) {
      events.push({
        type: versionChangeType(prior.resolved, usage.resolved),
        package: current.name,
        workspaceId: usage.workspaceId,
        section: usage.section,
        from: prior.resolved,
        to: usage.resolved,
      });
    }
    events.push(...securityEvents(current.name, usage, prior));
  }
  for (const [key, usage] of previousUsages) {
    if (currentUsages.has(key)) continue;
    events.push({ type: "dependency-removed", package: current.name, workspaceId: usage.workspaceId, section: usage.section, resolved: usage.resolved });
  }

  if (current.latest && current.latest !== previous.latest) {
    events.push({ type: "new-package-release", package: current.name, previousLatest: previous.latest, latest: current.latest });
  }
  if (!previous.versionMismatch.declared && current.versionMismatch.declared || !previous.versionMismatch.resolved && current.versionMismatch.resolved) {
    events.push({ type: "version-mismatch-introduced", package: current.name, ...current.versionMismatch });
  }
  if (previous.versionMismatch.declared && !current.versionMismatch.declared || previous.versionMismatch.resolved && !current.versionMismatch.resolved) {
    events.push({ type: "version-mismatch-resolved", package: current.name, ...previous.versionMismatch });
  }
  return events;
}

function securityEvents(
  packageName: string,
  current: ExternalDependency["usages"][number],
  previous: ExternalDependency["usages"][number],
): ChangeEvent[] {
  const currentIds = new Set(current.security?.advisories.map((advisory) => advisory.id) ?? []);
  const previousIds = new Set(previous.security?.advisories.map((advisory) => advisory.id) ?? []);
  const base = { package: packageName, workspaceId: current.workspaceId, section: current.section };
  return [
    ...[...currentIds].filter((id) => !previousIds.has(id)).map((advisoryId) => ({ type: "vulnerability-discovered" as const, ...base, advisoryId })),
    ...[...previousIds].filter((id) => !currentIds.has(id)).map((advisoryId) => ({ type: "vulnerability-resolved" as const, ...base, advisoryId })),
  ];
}

function versionChangeType(from: string, to: string): "dependency-updated" | "dependency-downgraded" {
  return semver.valid(from) && semver.valid(to) && semver.lt(to, from) ? "dependency-downgraded" : "dependency-updated";
}

function usageKey(usage: ExternalDependency["usages"][number]): string {
  return `${usage.workspaceId}:${usage.section}`;
}
