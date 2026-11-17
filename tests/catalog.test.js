const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("catalog contains unique game IDs and valid GitHub repositories", () => {
  const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "catalog.json"), "utf8"));
  assert.ok(Array.isArray(catalog.games));
  const ids = catalog.games.map(game => game.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const game of catalog.games) {
    assert.match(game.id, /^[a-z0-9][a-z0-9-]{1,63}$/);
    assert.match(game.repository, /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
    assert.ok(game.assetPattern);
    assert.ok(game.executable.endsWith(".exe"));
  }
});
