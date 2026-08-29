import path from "node:path";
import * as vscode from "vscode";
import {
  NpmRegistryClient,
  scanNodeProject,
  updateDependency,
  type DependencyUsage,
  type ExternalDependency,
  type ProjectSnapshot,
  type Workspace,
} from "@4bhiy/watchtower-core";

const registry = new NpmRegistryClient();

export function activate(context: vscode.ExtensionContext): void {
  const provider = new WatchtowerTreeProvider();
  const treeView = vscode.window.createTreeView("watchtower.projects", { treeDataProvider: provider, showCollapseAll: true });
  context.subscriptions.push(treeView);
  void vscode.commands.executeCommand("setContext", "watchtower.hasScan", false);
  provider.onDidScan((snapshot) => {
    const issues = snapshot.summary.vulnerableUsageCount + snapshot.summary.deprecatedUsageCount;
    const updates = snapshot.summary.majorUpdateCount + snapshot.summary.routineUpdateCount;
    treeView.badge = issues + updates > 0 ? { value: issues + updates, tooltip: `${issues} issue${issues === 1 ? "" : "s"}, ${updates} update${updates === 1 ? "" : "s"}` } : undefined;
    treeView.message = undefined;
    void vscode.commands.executeCommand("setContext", "watchtower.hasScan", true);
  });
  context.subscriptions.push(
    vscode.commands.registerCommand("watchtower.scanCurrentProject", () => scanCurrentProject(provider)),
    vscode.commands.registerCommand("watchtower.refresh", () => scanCurrentProject(provider)),
    vscode.commands.registerCommand("watchtower.openManifest", (node: DependencyNode) => openManifest(provider, node)),
    vscode.commands.registerCommand("watchtower.updateDependency", (node: DependencyNode) => chooseAndUpdate(provider, node)),
  );
}

class WatchtowerTreeProvider implements vscode.TreeDataProvider<WatchtowerNode> {
  readonly #changed = new vscode.EventEmitter<WatchtowerNode | undefined>();
  readonly #scanned = new vscode.EventEmitter<ProjectSnapshot>();
  readonly onDidChangeTreeData = this.#changed.event;
  readonly onDidScan = this.#scanned.event;
  snapshot: ProjectSnapshot | undefined;
  rootPath: string | undefined;
  scannedAt: Date | undefined;

  refresh(): void {
    this.#changed.fire(undefined);
  }

  setSnapshot(snapshot: ProjectSnapshot, rootPath: string): void {
    this.snapshot = snapshot;
    this.rootPath = rootPath;
    this.scannedAt = new Date();
    this.#scanned.fire(snapshot);
    this.refresh();
  }

  getTreeItem(node: WatchtowerNode): vscode.TreeItem {
    return node;
  }

  getChildren(node?: WatchtowerNode): WatchtowerNode[] {
    if (!this.snapshot || !this.rootPath) return [];
    if (!node) return [new ProjectNode(this.snapshot)];
    if (node instanceof ProjectNode) return projectGroups(this.snapshot);
    if (node instanceof GroupNode) return groupChildren(this.snapshot, node);
    if (node instanceof WorkspaceNode) return dependencyNodesForWorkspace(this.snapshot, node.workspace);
    return [];
  }
}

async function scanCurrentProject(provider: WatchtowerTreeProvider): Promise<void> {
  const folder = currentWorkspaceFolder();
  if (!folder) {
    void vscode.window.showErrorMessage("Open a repository folder before running Watchtower.");
    return;
  }
  await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: "Watchtower: scanning current project" }, async () => {
    try {
      const rootPath = folder.uri.fsPath;
      const snapshot = await scanNodeProject({
        rootPath,
        id: slug(path.basename(rootPath)),
        name: path.basename(rootPath),
      });
      provider.setSnapshot(snapshot, rootPath);
      const message = snapshot.scan.status === "success"
        ? `Watchtower scanned ${snapshot.name}.`
        : `Watchtower scanned ${snapshot.name} with partial results.`;
      void vscode.window.showInformationMessage(message);
    } catch (error) {
      void vscode.window.showErrorMessage(`Watchtower could not scan this project: ${message(error)}`);
    }
  });
}

async function openManifest(provider: WatchtowerTreeProvider, node: DependencyNode | undefined): Promise<void> {
  if (!node || !provider.rootPath) return;
  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(provider.rootPath, node.workspace.manifestPath)));
  await vscode.window.showTextDocument(document, { preview: false });
}

async function chooseAndUpdate(provider: WatchtowerTreeProvider, node: DependencyNode | undefined): Promise<void> {
  if (!node || !provider.snapshot || !provider.rootPath) return;
  try {
    const catalog = await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: `Watchtower: loading ${node.dependency.name} versions` }, () =>
      registry.getStableVersionCatalog(node.dependency.name),
    );
    const selected = await vscode.window.showQuickPick(versionItems(node, catalog), {
      placeHolder: `Choose a stable ${node.dependency.name} version`,
      matchOnDescription: true,
      matchOnDetail: true,
    });
    if (!selected) return;

    const confirmed = await vscode.window.showWarningMessage(
      `Update ${node.dependency.name} in ${node.workspace.name ?? node.workspace.path} from ${node.usage.resolved ?? node.usage.declared} to ${selected.version}?`,
      { modal: true },
      "Update",
    );
    if (confirmed !== "Update") return;

    const result = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Watchtower: updating ${node.dependency.name}` }, () =>
      updateDependency({
        rootPath: provider.rootPath!,
        projectId: provider.snapshot!.id,
        projectName: provider.snapshot!.name,
        workspaceId: node.workspace.id,
        packageName: node.dependency.name,
        section: node.usage.section,
        version: selected.version,
      }),
    );
    provider.setSnapshot(result.after, provider.rootPath);
    void vscode.window.showInformationMessage(`Updated ${node.dependency.name} to ${selected.version}.`);
  } catch (error) {
    void vscode.window.showErrorMessage(`Watchtower could not update ${node?.dependency.name ?? "dependency"}: ${message(error)}`);
  }
}

function projectGroups(snapshot: ProjectSnapshot): GroupNode[] {
  const groups = [
    new GroupNode("security", "Security issues", countUsages(snapshot, (usage) => usage.security?.vulnerable === true)),
    new GroupNode("major", "Major updates", countUsages(snapshot, (usage) => usage.update?.type === "major")),
    new GroupNode("routine", "Routine updates", countUsages(snapshot, (usage) => usage.update !== null && usage.update.type !== "major" && !usage.security?.vulnerable)),
    new GroupNode("deprecated", "Deprecated packages", countUsages(snapshot, (usage) => usage.deprecation?.isDeprecated === true)),
  ].filter((group) => group.count > 0);
  return [...groups, new GroupNode("workspaces", "Workspaces", snapshot.workspaces.length)];
}

function groupChildren(snapshot: ProjectSnapshot, group: GroupNode): WatchtowerNode[] {
  if (group.kind === "workspaces") return snapshot.workspaces.map((workspace) => new WorkspaceNode(workspace));
  const predicate: Record<Exclude<GroupKind, "workspaces">, (usage: DependencyUsage) => boolean> = {
    security: (usage) => usage.security?.vulnerable === true,
    major: (usage) => usage.update?.type === "major",
    routine: (usage) => usage.update !== null && usage.update.type !== "major" && !usage.security?.vulnerable,
    deprecated: (usage) => usage.deprecation?.isDeprecated === true,
  };
  return dependencyNodes(snapshot, predicate[group.kind], true);
}

function dependencyNodesForWorkspace(snapshot: ProjectSnapshot, workspace: Workspace): DependencyNode[] {
  return dependencyNodes(snapshot, (usage) => usage.workspaceId === workspace.id, false);
}

function dependencyNodes(snapshot: ProjectSnapshot, predicate: (usage: DependencyUsage) => boolean, showWorkspace: boolean): DependencyNode[] {
  return snapshot.dependencies.flatMap((dependency) => dependency.usages
    .filter(predicate)
    .map((usage) => {
      const workspace = snapshot.workspaces.find((candidate) => candidate.id === usage.workspaceId);
      return workspace ? new DependencyNode(dependency, usage, workspace, showWorkspace) : undefined;
    })
    .filter((node): node is DependencyNode => node !== undefined))
    .sort((left, right) => left.dependency.name.localeCompare(right.dependency.name));
}

function countUsages(snapshot: ProjectSnapshot, predicate: (usage: DependencyUsage) => boolean): number {
  return snapshot.dependencies.reduce((total, dependency) => total + dependency.usages.filter(predicate).length, 0);
}

type GroupKind = "security" | "major" | "routine" | "deprecated" | "workspaces";
type VersionItem = vscode.QuickPickItem & { version: string };

function versionItems(node: DependencyNode, catalog: Awaited<ReturnType<NpmRegistryClient["getStableVersionCatalog"]>>): VersionItem[] {
  const current = node.usage.resolved;
  const fixed = node.usage.security?.advisories.map((advisory) => advisory.fixedVersion).find((version): version is string => version !== null) ?? null;
  const priority = [
    ...(current ? [{ version: current, description: "● Installed", detail: "Current resolved version" }] : []),
    ...(fixed && fixed !== current ? [{ version: fixed, description: "🛡 Latest safe", detail: "Fixes the reported security issue" }] : []),
    ...(catalog.latest && catalog.latest !== current && catalog.latest !== fixed ? [{ version: catalog.latest, description: "★ Latest stable", detail: "Latest stable npm release" }] : []),
  ];
  const prioritized = new Set(priority.map((item) => item.version));
  return [
    ...priority.map((item) => ({ label: item.version, ...item })),
    ...catalog.versions
      .filter((item) => !prioritized.has(item.version))
      .map((item) => ({
        label: item.version,
        version: item.version,
        description: item.deprecation ? "Deprecated" : "Stable release",
        detail: item.publishedAt ? `Published ${new Date(item.publishedAt).toLocaleDateString()}` : undefined,
      })),
  ];
}

class ProjectNode extends vscode.TreeItem {
  constructor(snapshot: ProjectSnapshot) {
    super(snapshot.name, vscode.TreeItemCollapsibleState.Expanded);
    const summary = snapshot.summary;
    const actionable = summary.vulnerableUsageCount + summary.deprecatedUsageCount + summary.majorUpdateCount + summary.routineUpdateCount;
    this.description = snapshot.node
      ? actionable > 0 ? `${snapshot.node.packageManager} · ${actionable} action${actionable === 1 ? "" : "s"}` : `${snapshot.node.packageManager} · all clear`
      : "unsupported project";
    this.tooltip = `${snapshot.name}\n${snapshot.workspaces.length} workspace${snapshot.workspaces.length === 1 ? "" : "s"}\n${actionable === 0 ? "No security issues, updates, or deprecations." : "Expand a section to inspect findings."}`;
    this.iconPath = new vscode.ThemeIcon(actionable === 0 ? "pass-filled" : "shield", actionable === 0 ? new vscode.ThemeColor("testing.iconPassed") : undefined);
  }
}

class GroupNode extends vscode.TreeItem {
  constructor(readonly kind: GroupKind, label: string, readonly count: number) {
    super(label, count > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
    this.description = `${count}`;
    const appearance: Record<GroupKind, { icon: string; color?: string }> = {
      security: { icon: "shield", color: "problemsErrorIcon.foreground" },
      major: { icon: "arrow-up", color: "problemsWarningIcon.foreground" },
      routine: { icon: "sync" },
      deprecated: { icon: "warning", color: "problemsWarningIcon.foreground" },
      workspaces: { icon: "package" },
    };
    const item = appearance[kind];
    this.iconPath = new vscode.ThemeIcon(item.icon, item.color ? new vscode.ThemeColor(item.color) : undefined);
  }
}

class WorkspaceNode extends vscode.TreeItem {
  constructor(readonly workspace: Workspace) {
    super(workspace.name ?? workspace.path, vscode.TreeItemCollapsibleState.Collapsed);
    this.description = workspace.path;
    this.iconPath = new vscode.ThemeIcon("package");
  }
}

class DependencyNode extends vscode.TreeItem {
  constructor(readonly dependency: ExternalDependency, readonly usage: DependencyUsage, readonly workspace: Workspace, showWorkspace: boolean) {
    super(dependency.name, vscode.TreeItemCollapsibleState.None);
    this.contextValue = "dependency";
    const version = `${usage.resolved ?? usage.declared}${usage.update ? ` → ${usage.update.firstNewerVersion}` : ""}`;
    this.description = showWorkspace ? `${workspace.name ?? workspace.path} · ${version}` : version;
    this.tooltip = `${dependency.name}\nDeclared: ${usage.declared}\nResolved: ${usage.resolved ?? "unknown"}\nLatest stable: ${dependency.latest ?? "unknown"}`;
    this.iconPath = new vscode.ThemeIcon(usage.security?.vulnerable ? "warning" : usage.update ? "arrow-up" : usage.deprecation?.isDeprecated ? "alert" : "check");
  }
}

type WatchtowerNode = ProjectNode | GroupNode | WorkspaceNode | DependencyNode;

function currentWorkspaceFolder(): vscode.WorkspaceFolder | undefined {
  const activeDocument = vscode.window.activeTextEditor?.document;
  return activeDocument ? vscode.workspace.getWorkspaceFolder(activeDocument.uri) ?? vscode.workspace.workspaceFolders?.[0] : vscode.workspace.workspaceFolders?.[0];
}

function slug(value: string): string {
  return value.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-").replaceAll(/(^-|-$)/g, "") || "project";
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
