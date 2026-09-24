import * as vscode from "vscode";
import { ChangeKind, FileChange, SCHEME, WorkspaceFileSystem } from "./fileSystem";
import { basename, dirname } from "./paths";

/**
 * A minimal stand-in for git: the Source Control view lists files that differ
 * from the original exercise, with diffs, gutter change markers and revert.
 */

/** Read-only documents holding the original exercise files. */
export const ORIGINAL_SCHEME = "todo-original";
const PROVIDER_ID = "todoIde";

const LABELS: Record<ChangeKind, { letter: string; tooltip: string; color: string }> = {
  modified: { letter: "M", tooltip: "Modified", color: "todoIde.modifiedResourceForeground" },
  added: { letter: "A", tooltip: "Added", color: "todoIde.addedResourceForeground" },
  deleted: { letter: "D", tooltip: "Deleted", color: "todoIde.deletedResourceForeground" },
};

interface ChangeState extends vscode.SourceControlResourceState {
  change: FileChange;
}

const decoder = new TextDecoder();

export class ChangesController implements vscode.Disposable, vscode.FileDecorationProvider {
  private readonly sourceControl: vscode.SourceControl;
  private readonly group: vscode.SourceControlResourceGroup;
  private readonly decorationsEmitter = new vscode.EventEmitter<vscode.Uri[]>();
  readonly onDidChangeFileDecorations = this.decorationsEmitter.event;
  private readonly disposables: vscode.Disposable[] = [];
  private changes = new Map<string, FileChange>();
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly fs: WorkspaceFileSystem) {
    this.sourceControl = vscode.scm.createSourceControl(PROVIDER_ID, "Exercise", fs.root);
    this.sourceControl.inputBox.visible = false;
    this.sourceControl.quickDiffProvider = {
      provideOriginalResource: (uri) =>
        uri.scheme === SCHEME && fs.originalSync(fs.toPath(uri)) ? this.toOriginal(uri) : undefined,
    };
    this.group = this.sourceControl.createResourceGroup("changes", "Changes");
    this.group.hideWhenEmpty = false;

    this.disposables.push(
      this.sourceControl,
      this.decorationsEmitter,
      vscode.workspace.registerTextDocumentContentProvider(ORIGINAL_SCHEME, {
        provideTextDocumentContent: (uri) => {
          const original = fs.originalSync(fs.toPath(uri.with({ scheme: SCHEME })));
          return original ? decoder.decode(original) : "";
        },
      }),
      vscode.window.registerFileDecorationProvider(this),
      fs.onDidChangeFile(() => this.scheduleRefresh()),
      vscode.commands.registerCommand("todoIde.changes.open", (state: ChangeState) => this.open(state.change)),
      vscode.commands.registerCommand("todoIde.changes.openFile", (...args: unknown[]) =>
        this.openFiles(this.statesFrom(args)),
      ),
      vscode.commands.registerCommand("todoIde.changes.revert", (...args: unknown[]) =>
        this.revert(this.statesFrom(args).map((s) => s.change)),
      ),
      vscode.commands.registerCommand("todoIde.changes.revertAll", () => this.revert([...this.changes.values()])),
    );

    void fs.ready.then(() => this.refresh());
  }

  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    if (uri.scheme !== SCHEME) return undefined;
    const change = this.changes.get(this.fs.toPath(uri));
    if (!change) return undefined;
    const label = LABELS[change.kind];
    const decoration = new vscode.FileDecoration(label.letter, label.tooltip, new vscode.ThemeColor(label.color));
    // Parent folders get the color too, like git
    decoration.propagate = true;
    return decoration;
  }

  private toOriginal(uri: vscode.Uri): vscode.Uri {
    return uri.with({ scheme: ORIGINAL_SCHEME });
  }

  private scheduleRefresh(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.refresh(), 50);
  }

  private refresh(): void {
    const previous = this.changes;
    this.changes = new Map(this.fs.changes().map((c) => [c.path, c]));

    this.group.resourceStates = [...this.changes.values()].map((change): ChangeState => {
      const label = LABELS[change.kind];
      return {
        change,
        resourceUri: this.fs.toUri(change.path),
        contextValue: change.kind,
        command: { command: "todoIde.changes.open", title: "Open Changes", arguments: [{ change }] },
        decorations: {
          tooltip: label.tooltip,
          strikeThrough: change.kind === "deleted",
          faded: change.kind === "deleted",
        },
      };
    });
    this.sourceControl.count = this.changes.size;

    const updated = new Set([...previous.keys(), ...this.changes.keys()]);
    this.decorationsEmitter.fire([...updated].map((path) => this.fs.toUri(path)));
  }

  /** Resource commands get the clicked state, plus the whole selection when several are selected. */
  private statesFrom(args: unknown[]): ChangeState[] {
    const states = args.flat().filter((a): a is ChangeState => !!a && typeof a === "object" && "change" in a);
    const unique = new Map(states.map((s) => [s.change.path, s]));
    return [...unique.values()];
  }

  private async open(change: FileChange): Promise<void> {
    const uri = this.fs.toUri(change.path);
    const name = basename(change.path);
    if (change.kind === "modified") {
      await vscode.commands.executeCommand("vscode.diff", this.toOriginal(uri), uri, `${name} (Original ↔ Yours)`);
    } else if (change.kind === "added") {
      await vscode.commands.executeCommand("vscode.open", uri);
    } else {
      await vscode.commands.executeCommand("vscode.open", this.toOriginal(uri));
    }
  }

  private async openFiles(states: ChangeState[]): Promise<void> {
    for (const { change } of states.filter((s) => s.change.kind !== "deleted")) {
      await vscode.commands.executeCommand("vscode.open", this.fs.toUri(change.path));
    }
  }

  private async revert(changes: FileChange[]): Promise<void> {
    if (changes.length === 0) {
      void vscode.window.showInformationMessage("There are no changes to revert.");
      return;
    }
    const message =
      changes.length === 1
        ? `Revert your changes to ${basename(changes[0].path)}?`
        : `Revert your changes to ${changes.length} files?`;
    const detail = changes.some((c) => c.kind === "added")
      ? "Files you added will be deleted. This cannot be undone."
      : "The files will go back to how they were at the start of the exercise.";
    const choice = await vscode.window.showWarningMessage(message, { modal: true, detail }, "Revert");
    if (choice !== "Revert") return;

    for (const change of changes) {
      await this.revertFile(change);
    }
  }

  private async revertFile(change: FileChange): Promise<void> {
    const uri = this.fs.toUri(change.path);
    const original = this.fs.originalSync(change.path);
    if (!original) {
      await vscode.workspace.fs.delete(uri, { recursive: false, useTrash: false });
      return;
    }
    const document = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
    if (document && !document.isClosed && change.kind !== "deleted") {
      // Edit the open document rather than the file, so it isn't left with conflicting unsaved changes
      const edit = new vscode.WorkspaceEdit();
      const fullRange = new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length));
      edit.replace(uri, fullRange, decoder.decode(original));
      await vscode.workspace.applyEdit(edit);
      await document.save();
      return;
    }
    await vscode.workspace.fs.createDirectory(this.fs.toUri(dirname(change.path)));
    await vscode.workspace.fs.writeFile(uri, original);
  }

  dispose(): void {
    clearTimeout(this.timer);
    vscode.Disposable.from(...this.disposables).dispose();
  }
}
