import {
  useRef,
  useEffect,
  useId,
  cloneElement,
  isValidElement,
  type ReactNode,
} from "react";
import { diffWords } from "diff";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import {
  BookOpen,
  FileText,
  Folder,
  ShieldCheck,
  Database,
  GitCompareArrows,
  CheckCheck,
  Inbox,
  LoaderCircle,
  X,
} from "lucide-react";
import { label } from "./api";
const icons: Record<string, any> = {
  regulation: BookOpen,
  requirement: GitCompareArrows,
  policy: FileText,
  process: Folder,
  control: ShieldCheck,
  record: Database,
  action: CheckCheck,
};
export function Mark({ small = false }: { small?: boolean }) {
  return (
    <span className={"mark " + (small ? "small" : "")} aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}
export function Chip({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: string;
}) {
  return <span className={"chip " + tone}>{children}</span>;
}
export function Status({ value }: { value: string }) {
  const good = [
    "ready",
    "deployed",
    "succeeded",
    "accepted",
    "done",
    "complete",
    "satisfied",
  ];
  const bad = [
    "failed",
    "analysis_failed",
    "requires_review",
    "rejected",
    "review",
  ];
  return (
    <Chip
      tone={
        good.includes(value.toLowerCase())
          ? "green"
          : bad.includes(value.toLowerCase())
            ? "amber"
            : value === "analyzing"
              ? "violet"
              : "neutral"
      }
    >
      <span className="dot" />
      {label(value)}
    </Chip>
  );
}
export function Empty({
  icon: Icon = Inbox,
  title,
  children,
  action,
}: {
  icon?: any;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Icon size={22} />
      </span>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}
export function Button({
  children,
  onClick,
  primary = false,
  disabled = false,
  className = "",
  type = "button",
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  primary?: boolean;
  disabled?: boolean;
  className?: string;
  type?: "button" | "submit";
  title?: string;
}) {
  return (
    <button
      title={title}
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={"btn " + (primary ? "primary " : "") + className}
    >
      {children}
    </button>
  );
}
export function Field({
  label: caption,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{caption}</label>
      {isValidElement(children)
        ? cloneElement(children as any, { id })
        : children}
    </div>
  );
}
export function Modal({
  title,
  children,
  close,
  onSubmit,
  busy = false,
  submit = "Save",
  wide = false,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
  onSubmit?: (f: FormData) => Promise<void>;
  busy?: boolean;
  submit?: string;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
    return () => ref.current?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={"modal " + (wide ? "wide" : "")}
      onCancel={close}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          await onSubmit?.(new FormData(e.currentTarget));
        }}
      >
        <header>
          <h3>{title}</h3>
          <button
            type="button"
            className="icon-btn"
            aria-label="Close dialog"
            onClick={close}
          >
            <X size={17} />
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {onSubmit && (
          <footer>
            <Button onClick={close}>Cancel</Button>
            <Button type="submit" primary disabled={busy}>
              {busy ? <LoaderCircle size={14} className="spin" /> : null}
              {submit}
            </Button>
          </footer>
        )}
      </form>
    </dialog>
  );
}
export function DiffText({
  oldText,
  newText,
  side,
}: {
  oldText: string;
  newText: string;
  side: "old" | "new";
}) {
  return (
    <>
      {diffWords(oldText, newText).map((part, i) =>
        (part.added && side === "old") ||
        (part.removed && side === "new") ? null : (
          <span
            key={i}
            className={part.added ? "added" : part.removed ? "removed" : ""}
          >
            {part.value}
          </span>
        ),
      )}
    </>
  );
}
export function GraphNode({ data, selected }: NodeProps) {
  const Icon = icons[String(data.kind)] || FileText;
  return (
    <div
      className={
        "graph-node " +
        (selected ? "selected" : "") +
        (data.impacted ? " impacted" : "")
      }
    >
      <Handle type="target" position={Position.Left} />
      <div>
        <span className="node-icon">
          <Icon size={15} />
        </span>
        <small>{String(data.kind)}</small>
      </div>
      <strong>{String(data.label)}</strong>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
export const nodeTypes = { riften: GraphNode };

export function EvaluationMetrics({ result }: { result: Record<string, any> }) {
  const aligned = result?.model?.metrics,
    baseline = result?.baseline?.metrics;
  if (!aligned || !baseline) return null;
  const metrics = [
    ...new Set(
      [...Object.keys(aligned), ...Object.keys(baseline)].filter((k) =>
        k.endsWith("_mean"),
      ),
    ),
  ];
  return (
    <div className="evaluation-metrics">
      <div className="notice amber">
        Provider-reported results. A generated benchmark and model judge do not
        establish legal correctness.
      </div>
      <table>
        <thead>
          <tr>
            <th>Metric</th>
            <th>Aligned</th>
            <th>Base</th>
            <th>Valid judgments</th>
          </tr>
        </thead>
        <tbody>
          {metrics.map((key) => (
            <tr key={key}>
              <td>{label(key.replace(/_mean$/, ""))}</td>
              <td>{aligned[key] ?? "Not returned"}</td>
              <td>{baseline[key] ?? "Not returned"}</td>
              <td>
                {aligned[key.replace("_mean", "_valid_count")] ?? "Unknown"} /{" "}
                {baseline[key.replace("_mean", "_valid_count")] ?? "Unknown"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="fine-print">
        Valid judgments are shown as aligned / base. Missing scores are not
        treated as zero.
      </p>
    </div>
  );
}
