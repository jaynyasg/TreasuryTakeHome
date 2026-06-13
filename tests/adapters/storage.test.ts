import { describe, expect, it } from "vitest";
import { createFakeStorage } from "@/lib/adapters/storage/fake";
import { runStorageContract } from "@/lib/adapters/storage/contractTest";

// The fake adapter must satisfy the shared StorageAdapter behavior contract.
// The real Vercel Blob adapter satisfies the same contract but is not run here:
// `verify` stays offline (no live Blob store), so only the fake is exercised.
runStorageContract("fake", createFakeStorage);

describe("createFakeStorage signed-url fallback", () => {
  it("returns null from getSignedUrl to force the app-mediated proxy path", async () => {
    const storage = createFakeStorage();
    await storage.put("f.txt", new TextEncoder().encode("x"), {
      contentType: "text/plain",
    });
    expect(await storage.getSignedUrl("f.txt", 60)).toBeNull();
  });
});
