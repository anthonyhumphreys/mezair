import assert from "node:assert/strict";
import test from "node:test";
import { publicAnalyticsUrl, downloadPlatform } from "../lib/analytics-policy.ts";

test("public page views discard query strings and fragment credentials", () => {
  assert.equal(publicAnalyticsUrl("https://mezair.dev/docs/desktop?email=private@example.com#k=secret"), "https://mezair.dev/docs/desktop");
  assert.equal(publicAnalyticsUrl("https://mezair.dev/?token=secret"), "https://mezair.dev/");
});

test("account, auth, shared artifacts and local review pages never enter analytics", () => {
  for (const path of ["/artifacts", "/artifacts/share_123#k=secret", "/artifacts/share_123/sign-in", "/account", "/account/security", "/auth/callback?code=secret", "/callback", "/invite", "/docs/workspace-review-local", "/unknown-private-route"]) {
    assert.equal(publicAnalyticsUrl(`https://mezair.dev${path}`), null, path);
  }
  assert.equal(publicAnalyticsUrl("not a URL"), null);
});

test("download events contain only a known platform, never the target URL", () => {
  const base = "https://github.com/anthonyhumphreys/mezair/releases/latest";
  assert.equal(downloadPlatform(`${base}/download/Mezair-latest-arm64.dmg`), "mac");
  assert.equal(downloadPlatform(`${base}/download/Mezair.exe`), "windows");
  assert.equal(downloadPlatform(`${base}/download/Mezair.AppImage`), "linux");
  assert.equal(downloadPlatform(base), "releases");
  assert.equal(downloadPlatform("https://example.com/private-file.dmg"), null);
  assert.equal(downloadPlatform("https://github.com/someone/other/releases/latest"), null);
});
