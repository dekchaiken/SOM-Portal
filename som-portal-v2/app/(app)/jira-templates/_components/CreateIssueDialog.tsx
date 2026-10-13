"use client";
// Create-Issue form. Field rows are driven entirely by jira_config.json
// (field_id / label / placeholder / field_type), prefilled from the template's
// stored `fields` map — same contract as v1 jira-templates.js.
import * as React from "react";
import { Icon } from "@/icons";
import { Button } from "@/ui/shadcn/button";
import { Modal } from "./Modal";
import type { FieldDef, FieldOptionMap, TemplateRow } from "./types";

const FAULT_LEGACY = "customfield_17026";

function faultFieldId(defs: FieldDef[]): string {
  return defs.find((d) => d.field_type === "fault_start")?.field_id ?? FAULT_LEGACY;
}

function localDatetimeValue(d = new Date()): string {
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60_000).toISOString().slice(0, 16);
}

export function CreateIssueDialog({
  template,
  fieldDefs,
  fieldOptions,
  onClose,
  onCreated,
  onError,
}: {
  template: TemplateRow;
  fieldDefs: FieldDef[];
  fieldOptions: FieldOptionMap;
  onClose: () => void;
  onCreated: (issue: { issue_key: string; issue_url: string }) => void;
  onError: (msg: string) => void;
}) {
  const faultId = faultFieldId(fieldDefs);
  const storedFault = String(template.fields[faultId] ?? template.fields[FAULT_LEGACY] ?? "auto");
  const [autoTime, setAutoTime] = React.useState(storedFault !== "manual");
  const [manualTime, setManualTime] = React.useState(() =>
    storedFault && storedFault !== "auto" && storedFault !== "manual"
      ? storedFault.slice(0, 16)
      : localDatetimeValue(),
  );
  const [values, setValues] = React.useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const d of fieldDefs) {
      if (d.field_type === "fault_start") continue;
      init[d.field_id] = String(template.fields[d.field_id] ?? "");
    }
    return init;
  });
  const [issuetype, setIssuetype] = React.useState(
    String(template.fields["issuetype"] ?? "Task"),
  );
  const [description, setDescription] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      const overrides: Record<string, unknown> = { ...values, issuetype };
      overrides[faultId] = autoTime
        ? "auto"
        : manualTime
          ? new Date(manualTime).toISOString()
          : "auto";
      const res = await fetch("/v2/api/v1/jira/create-issue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          templateId: template.id,
          summary: template.summary,
          description,
          overrides,
        }),
      });
      const json = (await res.json()) as
        | { ok: true; data: { issue_key: string; issue_url: string } }
        | { ok: false; error: string };
      if (json.ok) {
        onCreated(json.data);
      } else {
        onError(json.error || "Failed to create ticket");
      }
    } catch (e) {
      onError(e instanceof Error ? e.message : "Network error");
    } finally {
      setBusy(false);
    }
  };

  const groups: { key: string; label: string; defs: FieldDef[] }[] = [
    {
      key: "options",
      label: "Option fields",
      defs: fieldDefs.filter((d) => d.field_type === "select" || d.field_type === "array"),
    },
    { key: "text", label: "Text fields", defs: fieldDefs.filter((d) => d.field_type === "text") },
  ].filter((g) => g.defs.length > 0);

  return (
    <Modal
      open
      onClose={onClose}
      title={template.name || template.summary}
      subtitle={template.summary}
      width={720}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" onClick={submit} disabled={busy} data-testid="submit-create-issue">
            {busy ? <Icon name="loader" size={14} className="animate-spin" /> : <Icon name="plus" size={14} />}
            {busy ? "Creating…" : "Create Ticket"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {/* Summary (required, highlighted) */}
        <div>
          <Label required>Summary (ticket title)</Label>
          <div
            className="rounded-[var(--radius-sm)] border px-3 py-2 text-[13px] font-medium"
            style={{
              borderColor: "var(--accent)",
              background: "color-mix(in oklab, var(--accent) 7%, transparent)",
            }}
          >
            {template.summary}
          </div>
        </div>

        <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr))]">
          <div>
            <Label required>Work Type (issuetype)</Label>
            <input
              value={issuetype}
              onChange={(e) => setIssuetype(e.target.value)}
              data-testid="field-issuetype"
              className="w-full rounded-[var(--radius-sm)] border bg-[var(--bg-raised)] px-3 py-2 text-[13px]"
              style={{ borderColor: "var(--border)", fontFamily: "inherit" }}
            />
          </div>
          <div>
            <Label>Fault start</Label>
            <div className="flex items-center gap-2">
              <label className="inline-flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
                <input
                  type="checkbox"
                  checked={autoTime}
                  onChange={(e) => setAutoTime(e.target.checked)}
                  data-testid="field-fault-auto"
                />
                Current time (auto)
              </label>
              {!autoTime ? (
                <input
                  type="datetime-local"
                  value={manualTime}
                  onChange={(e) => setManualTime(e.target.value)}
                  className="flex-1 rounded-[var(--radius-sm)] border bg-[var(--bg-raised)] px-2 py-1.5 text-xs"
                  style={{ borderColor: "var(--border)", fontFamily: "inherit" }}
                />
              ) : null}
            </div>
          </div>
        </div>

        {groups.map((g) => (
          <section key={g.key}>
            <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--text-subtle)]">
              {g.label}
            </p>
            <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr))]">
              {g.defs.map((d) => {
                const opts = fieldOptions[d.field_id]?.options ?? [];
                return (
                  <div key={d.field_id}>
                    <Label>
                      {d.label}
                      {d.field_type === "array" ? (
                        <span className="ml-1 font-normal normal-case text-[var(--text-subtle)]">
                          (comma-separated)
                        </span>
                      ) : null}
                    </Label>
                    <input
                      list={opts.length ? `opt-${d.field_id}` : undefined}
                      value={values[d.field_id] ?? ""}
                      placeholder={d.placeholder}
                      onChange={(e) =>
                        setValues((v) => ({ ...v, [d.field_id]: e.target.value }))
                      }
                      data-testid={`field-${d.field_id}`}
                      className="w-full rounded-[var(--radius-sm)] border bg-[var(--bg-raised)] px-3 py-2 text-[13px]"
                      style={{ borderColor: "var(--border)", fontFamily: "inherit" }}
                    />
                    {opts.length ? (
                      <datalist id={`opt-${d.field_id}`}>
                        {opts.map((o) => (
                          <option key={o} value={o} />
                        ))}
                      </datalist>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>
        ))}

        <div>
          <Label>Description (optional)</Label>
          <textarea
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Extra context sent to Jira as ADF paragraphs"
            className="w-full rounded-[var(--radius-sm)] border bg-[var(--bg-raised)] px-3 py-2 text-[13px]"
            style={{ borderColor: "var(--border)", fontFamily: "inherit" }}
          />
        </div>
      </div>
    </Modal>
  );
}

function Label({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.07em] text-[var(--text-muted)]">
      {children}
      {required ? <span style={{ color: "var(--state-danger)" }}> *</span> : null}
    </p>
  );
}
