import { describe, expect, it } from "vitest";
import { signLink, verifyLink } from "../src/core/links";

const SECRET = "n-baie-lang-geheim-vir-toetse";

describe("signLink / verifyLink", () => {
  it("round-trips a payload", async () => {
    const token = await signLink({ draftId: "d-42", kind: "upload" }, SECRET);
    const payload = await verifyLink(token, SECRET);
    expect(payload).toEqual({ draftId: "d-42", kind: "upload" });
  });

  it("preserves the preview kind", async () => {
    const token = await signLink({ draftId: "d-7", kind: "preview" }, SECRET);
    expect(await verifyLink(token, SECRET)).toEqual({ draftId: "d-7", kind: "preview" });
  });

  it("rejects a tampered signature", async () => {
    const token = await signLink({ draftId: "d-42", kind: "upload" }, SECRET);
    const [payload, signature] = token.split(".");
    const flipped = signature[0] === "A" ? "B" : "A";
    const tampered = `${payload}.${flipped}${signature.slice(1)}`;
    expect(await verifyLink(tampered, SECRET)).toBeNull();
  });

  it("rejects a tampered payload (draftId swapped for another draft)", async () => {
    const token = await signLink({ draftId: "d-42", kind: "upload" }, SECRET);
    const signature = token.split(".")[1];
    const forgedPayload = btoa(JSON.stringify({ draftId: "d-999", kind: "upload" }))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replaceAll("=", "");
    expect(await verifyLink(`${forgedPayload}.${signature}`, SECRET)).toBeNull();
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await signLink({ draftId: "d-42", kind: "upload" }, SECRET);
    expect(await verifyLink(token, "n-ander-geheim")).toBeNull();
  });

  it("rejects malformed tokens", async () => {
    expect(await verifyLink("", SECRET)).toBeNull();
    expect(await verifyLink("geen-punt-nie", SECRET)).toBeNull();
    expect(await verifyLink(".", SECRET)).toBeNull();
    expect(await verifyLink("a.", SECRET)).toBeNull();
    expect(await verifyLink(".b", SECRET)).toBeNull();
  });

  it("produces different signatures for different drafts", async () => {
    const a = await signLink({ draftId: "d-1", kind: "upload" }, SECRET);
    const b = await signLink({ draftId: "d-2", kind: "upload" }, SECRET);
    expect(a).not.toBe(b);
  });
});
