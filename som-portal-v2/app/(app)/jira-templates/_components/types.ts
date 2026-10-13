// Shared client types for the Jira Templates module.
export interface FieldDef {
  id: string;
  field_id: string;
  label: string;
  placeholder: string;
  field_type: "text" | "select" | "array" | "fault_start";
  enabled: boolean;
  order: number;
}

export type FieldOptionMap = Record<string, { label: string; type: string; options: string[] }>;

export interface TemplateRow {
  id: string;
  name: string;
  category: string;
  service_type_id: string;
  service_subtype_id: string;
  summary: string;
  fields: Record<string, unknown>;
  created_at: string;
  created_by: string;
  author_name: string;
  updated_at?: string;
  last_used_at?: string;
}
