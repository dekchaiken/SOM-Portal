// som-portal-v2/src/incident-launcher/webhook.test.ts
import { describe, it, expect } from "vitest";
import { validateWebhookUrl, substituteTemplate } from "./webhook";

describe("validateWebhookUrl", () => {
  it("accepts valid Google Chat webhook URLs", () => {
    expect(
      validateWebhookUrl(
        "https://chat.googleapis.com/v1/spaces/AAQ/messages?key=abc&token=xyz",
      ),
    ).toBe(true);
  });

  it("rejects non-Google Chat URLs", () => {
    expect(validateWebhookUrl("https://hooks.slack.com/services/T00/B00/xxx")).toBe(false);
    expect(validateWebhookUrl("https://example.com/webhook")).toBe(false);
    expect(validateWebhookUrl("http://chat.googleapis.com/v1/spaces/AAQ/messages")).toBe(false);
    expect(validateWebhookUrl("")).toBe(false);
  });
});

describe("substituteTemplate", () => {
  it("replaces {{var}} placeholders", () => {
    const tpl = "Incident {{key}}: {{summary}} at {{timestamp}}";
    const result = substituteTemplate(tpl, {
      key: "SMC-1234",
      summary: "Login down",
      timestamp: "2026-10-12 10:00",
    });
    expect(result).toBe("Incident SMC-1234: Login down at 2026-10-12 10:00");
  });

  it("replaces ${var} placeholders", () => {
    const tpl = "Issue ${key} is ${severity}";
    const result = substituteTemplate(tpl, { key: "SMC-999", severity: "critical" });
    expect(result).toBe("Issue SMC-999 is critical");
  });

  it("replaces multiple occurrences", () => {
    const tpl = "{{key}} - {{key}}";
    expect(substituteTemplate(tpl, { key: "X" })).toBe("X - X");
  });

  it("leaves unmatched placeholders unchanged", () => {
    const tpl = "Hello {{name}}, status is {{unknown}}";
    expect(substituteTemplate(tpl, { name: "World" })).toBe(
      "Hello World, status is {{unknown}}",
    );
  });
});
