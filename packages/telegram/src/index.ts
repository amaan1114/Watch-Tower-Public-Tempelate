import type { Changes, DependencyUsage, ProjectSnapshot, Snapshot } from "@4bhiy/watchtower-core";

const MAX_MESSAGE_LENGTH = 4000;
const MAX_ITEMS_PER_SECTION = 5;

export function formatTelegramReport(input: { snapshot: Snapshot; changes: Changes; dashboardUrl?: string }): string {
  const lines = ["🛡️ <b>WATCHTOWER DAILY REPORT</b>", `<i>${formatDate(input.snapshot.scannedAt)}</i>`];

  for (const project of input.snapshot.projects) {
    lines.push("", `📦 <b>${escape(project.name)}</b>`);
    lines.push(...formatChanges(project, input.changes));
    lines.push(...formatCurrentState(project));
  }

  if (input.dashboardUrl) lines.push("", `🔗 <a href=\"${escapeAttribute(input.dashboardUrl)}\"><b>Open dashboard</b> →</a>`);
  return truncate(lines.join("\n"));
}

export async function sendTelegramMessage(input: { token: string; chatId: string; text: string }): Promise<void> {
  if (!input.token || !input.chatId) throw new Error("TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are required.");
  const response = await fetch(`https://api.telegram.org/bot${input.token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: input.chatId, text: input.text, parse_mode: "HTML", disable_web_page_preview: true }),
  });
  if (!response.ok) throw new Error(`Telegram sendMessage failed (${response.status}): ${await response.text()}`);
}

function formatChanges(project: ProjectSnapshot, changes: Changes): string[] {
  if (changes.baseline) return ["🧭 <b>Changes</b>", "• Baseline recorded; future reports will show changes."];
  const events = changes.projects.find((entry) => entry.id === project.id)?.events ?? [];
  if (events.length === 0) return ["🧭 <b>Changes</b>", "• No changes since the previous scan."];

  const labels = events.slice(0, MAX_ITEMS_PER_SECTION).map((event) => {
    switch (event.type) {
      case "dependency-updated": return `${event.package} ${event.from} → ${event.to}`;
      case "dependency-downgraded": return `${event.package} downgraded ${event.from} → ${event.to}`;
      case "dependency-added": return `${event.package} added`;
      case "dependency-removed": return `${event.package} removed`;
      case "new-package-release": return `${event.package} released ${event.latest}`;
      case "vulnerability-discovered": return `${event.package}: vulnerability ${event.advisoryId} discovered`;
      case "vulnerability-resolved": return `${event.package}: vulnerability ${event.advisoryId} resolved`;
      case "version-mismatch-introduced": return `${event.package}: version mismatch introduced`;
      case "version-mismatch-resolved": return `${event.package}: version mismatch resolved`;
    }
  });
  return [`🧭 <b>Changes</b> · ${events.length}`, ...labels.map((label) => `• ${escape(label)}`), ...(events.length > labels.length ? [`• +${events.length - labels.length} more`] : [])];
}

function formatCurrentState(project: ProjectSnapshot): string[] {
  const lines: string[] = [];
  const vulnerabilities = project.dependencies.flatMap((dependency) => dependency.usages.flatMap((usage) =>
    usage.security?.vulnerable ? [{ dependency: dependency.name, usage }] : [],
  ));
  if (vulnerabilities.length > 0) {
    lines.push("", `🚨 <b>SECURITY ISSUES</b> · ${vulnerabilities.length}`);
    lines.push(...vulnerabilities.slice(0, MAX_ITEMS_PER_SECTION).map(({ dependency, usage }) => {
      const advisory = usage.security?.advisories[0];
      const fixed = advisory?.fixedVersion ? ` → <code>${escape(advisory.fixedVersion)}</code>` : "";
      return `• <b>${escape(dependency)}</b> <code>${escape(usage.resolved ?? "unknown")}</code>${fixed}${workspaceSuffix(project, usage)}`;
    }));
    lines.push(...moreItems(vulnerabilities.length));
  }

  const majorUpdates = updates(project, (usage) => usage.update?.type === "major");
  if (majorUpdates.length > 0) {
    lines.push("", `⬆️ <b>MAJOR UPDATES</b> · ${majorUpdates.length}`);
    lines.push(...majorUpdates.slice(0, MAX_ITEMS_PER_SECTION).map(formatUpdate(project)));
    lines.push(...moreItems(majorUpdates.length));
  }

  const routineUpdates = updates(project, (usage) => usage.update !== null && usage.update.type !== "major" && !usage.security?.vulnerable);
  if (routineUpdates.length > 0) {
    lines.push("", `✨ <b>ROUTINE UPDATES</b> · ${routineUpdates.length}`);
    lines.push(...routineUpdates.slice(0, MAX_ITEMS_PER_SECTION).map(formatUpdate(project)));
    lines.push(...moreItems(routineUpdates.length));
  }

  const deprecations = project.dependencies.flatMap((dependency) => dependency.usages.flatMap((usage) =>
    usage.deprecation?.isDeprecated ? [{ dependency: dependency.name, usage }] : [],
  ));
  if (deprecations.length > 0) {
    lines.push("", `⚠️ <b>DEPRECATED PACKAGES</b> · ${deprecations.length}`);
    lines.push(...deprecations.slice(0, MAX_ITEMS_PER_SECTION).map(({ dependency, usage }) =>
      `• <b>${escape(dependency)}</b> <code>${escape(usage.resolved ?? "unknown")}</code>${workspaceSuffix(project, usage)}`,
    ));
    lines.push(...moreItems(deprecations.length));
  }

  return lines.length > 0 ? lines : ["", "✅ <b>ALL CLEAR</b>", "• No current updates, security issues, or deprecations."];
}

function updates(project: ProjectSnapshot, predicate: (usage: DependencyUsage) => boolean): Array<{ dependency: string; usage: DependencyUsage }> {
  return project.dependencies.flatMap((dependency) => dependency.usages.flatMap((usage) => predicate(usage) ? [{ dependency: dependency.name, usage }] : []));
}

function formatUpdate(project: ProjectSnapshot): (item: { dependency: string; usage: DependencyUsage }) => string {
  return ({ dependency, usage }) => `• <b>${escape(dependency)}</b> <code>${escape(usage.resolved ?? "unknown")}</code> → <code>${escape(usage.update?.firstNewerVersion ?? "latest")}</code>${workspaceSuffix(project, usage)}`;
}

function workspaceSuffix(project: ProjectSnapshot, usage: DependencyUsage): string {
  return project.workspaces.length > 1 ? ` <i>· ${escape(usage.workspaceId)}</i>` : "";
}

function moreItems(total: number): string[] {
  return total > MAX_ITEMS_PER_SECTION ? [`• <i>+${total - MAX_ITEMS_PER_SECTION} more in dashboard</i>`] : [];
}

function formatDate(scannedAt: string): string {
  return new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }).format(new Date(scannedAt));
}

function truncate(message: string): string {
  return message.length <= MAX_MESSAGE_LENGTH ? message : `${message.slice(0, MAX_MESSAGE_LENGTH - 18)}\n… report truncated`;
}

function escape(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function escapeAttribute(value: string): string {
  return escape(value).replaceAll('"', "&quot;");
}
