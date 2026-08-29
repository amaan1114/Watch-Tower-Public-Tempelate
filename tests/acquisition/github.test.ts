import { access } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { acquireGitHubRepository } from "@4bhiy/watchtower-core";

describe("acquireGitHubRepository", () => {
  it("uses a shallow authenticated clone and removes its temporary checkout", async () => {
    let arguments_: string[] = [];
    const checkout = await acquireGitHubRepository(
      { repositoryUrl: "https://github.com/example/project.git", ref: "main", token: "secret-token" },
      async (received) => { arguments_ = received; },
    );

    expect(arguments_.slice(0, 7)).toEqual([
      "-c",
      "http.extraheader=AUTHORIZATION: bearer secret-token",
      "clone",
      "--depth",
      "1",
      "--branch",
      "main",
    ]);
    expect(arguments_[7]).toBe("https://github.com/example/project.git");
    await expect(access(checkout.rootPath.replace(/\/repository$/, ""))).resolves.toBeUndefined();

    await checkout.cleanup();
    await expect(access(checkout.rootPath)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
