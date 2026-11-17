const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { safeId, safeHttpUrl, resolveInside, validateGame } = require("../src/validation");

const validGame = () => ({
  id: "sample-game",
  name: "Sample Game",
  repository: "ExampleStudio/sample-game",
  executable: "bin/game.exe",
  platformExecutables: { linux: "bin/game.x86_64" }
});

test("safeId accepts only bounded lowercase launcher IDs", () => {
  assert.equal(safeId("sample-game"), true);
  for (const value of ["", "A-game", "../game", "a", "bad id", "a".repeat(65), null]) {
    assert.equal(safeId(value), false, String(value));
  }
});

test("safeHttpUrl allows only HTTP and HTTPS URLs", () => {
  assert.equal(safeHttpUrl("https://example.com/art.png"), "https://example.com/art.png");
  assert.equal(safeHttpUrl("javascript:alert(1)"), "");
  assert.equal(safeHttpUrl("file:///etc/passwd"), "");
  assert.equal(safeHttpUrl("not a url"), "");
  assert.equal(safeHttpUrl(""), "");
});

test("resolveInside resolves valid relative paths", () => {
  assert.equal(resolveInside("/games/sample", "bin/game.exe"), path.join("/games/sample", "bin", "game.exe"));
});

test("resolveInside rejects absolute, traversal and empty paths", () => {
  for (const value of ["../outside", "bin/../../outside", "/etc/passwd", "", "bin//game"]) {
    assert.throws(() => resolveInside("/games/sample", value));
  }
});

test("validateGame normalizes a valid cross-platform catalog entry", () => {
  const game = validateGame(validGame());
  assert.equal(game.id, "sample-game");
  assert.equal(game.platformExecutables.linux, "bin/game.x86_64");
  assert.equal(game.channel, "stable");
});

test("validateGame rejects invalid identities and traversal executable paths", () => {
  assert.throws(() => validateGame({ ...validGame(), id: "../escape" }));
  assert.throws(() => validateGame({ ...validGame(), executable: "../../outside.exe" }));
  assert.throws(() => validateGame({ ...validGame(), platformExecutables: { macos: "../outside.app" } }));
  assert.throws(() => validateGame({ ...validGame(), repository: "not-a-repository" }));
});

test("validateGame strips unsafe URL schemes from artwork and website fields", () => {
  const game = validateGame({ ...validGame(), cover: "javascript:alert(1)", heroImage: "file:///tmp/x", itchUrl: "https://example.com" });
  assert.equal(game.cover, "");
  assert.equal(game.heroImage, "");
  assert.equal(game.itchUrl, "https://example.com/");
});
