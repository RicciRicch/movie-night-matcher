import test from "node:test";
import assert from "node:assert/strict";
import { newRoom as emptyRoom, startRound, vote, undo, finishTurn, tally, restoreRoom, playerError, validMovies } from "../lib/room.ts";

// Synthetic movie data stays in tests; the application only uses TMDB responses.
const fixtures = [1, 2, 3].map((id) => ({ id, title: `Test movie ${id}`, details: "2026", description: "Test synopsis", poster: null, rating: 7 }));
function newRoom() { return { ...emptyRoom(), movies: fixtures }; }

function play(ballots, genre = "all") {
  const movies = genre === "all" ? fixtures : [fixtures[genre === "comedy" ? 1 : 2]];
  let room = startRound({ ...newRoom(), genre, movies, players: ballots.map((_, i) => `Voter ${i + 1}`) });
  for (const ballot of ballots) {
    assert.equal(room.stage, "handover");
    room = { ...room, stage: "voting" };
    for (const liked of ballot) room = vote(room, liked);
    room = finishTurn(room);
  }
  return room;
}

test("three voters only match when all three like the movie", () => {
  const room = play([[true, true, false], [true, false, true], [true, true, false]]);
  assert.equal(room.stage, "results");
  assert.deepEqual(tally(room).map(({ id, likes }) => [id, likes]), [[1, 3], [2, 2], [3, 1]]);
});

test("new rooms have no sample films and cannot start without discovery", () => {
  const room = { ...emptyRoom(), players: ["Alex", "Sam"] };
  assert.deepEqual(room.movies, []);
  assert.equal(startRound(room), room);
  assert.equal(validMovies([{ ...fixtures[0], poster: "https://untrusted.example/poster.jpg" }]), false);
  assert.equal(validMovies([fixtures[0], fixtures[0]]), false);
  assert.equal(restoreRoom({ ...newRoom(), version: 1, players: ["Alex", "Sam"], stage: "results" }).stage, "setup");
});

test("fallback ranks total likes and preserves ties; all-pass has no positive picks", () => {
  const room = play([[false, true, false], [false, true, true], [true, false, true]]);
  assert.deepEqual(tally(room).map(({ id, likes }) => [id, likes]), [[2, 2], [3, 2], [1, 1]]);
  assert.equal(tally(play([[false, false, false], [false, false, false]])).filter((m) => m.likes > 0).length, 0);
});

test("handover isolates voters, prevents early submission, and hides results", () => {
  let room = startRound({ ...newRoom(), players: ["Alex", "Sam", "Jo"] });
  assert.equal(vote(room, true), room);
  room = { ...room, stage: "voting" };
  assert.equal(finishTurn(room), room);
  for (const liked of [true, false, true]) room = vote(room, liked);
  room = undo(room);
  assert.deepEqual(room.votes, [[true, false], [], []]);
  room = finishTurn(vote(room, false));
  assert.equal(room.stage, "handover");
  assert.equal(room.playerIndex, 1);
  assert.deepEqual(tally(room), []);
  assert.equal(undo(room), room);
});

test("refresh restores setup, handover, partial votes, and results", () => {
  let room = startRound({ ...newRoom(), players: ["Alex", "Sam", "Jo"] });
  assert.deepEqual(restoreRoom(JSON.parse(JSON.stringify(room))), room);
  room = vote({ ...room, stage: "voting" }, true);
  assert.deepEqual(restoreRoom(JSON.parse(JSON.stringify(room))), room);
  const results = play([[true], [true], [false], [true]], "comedy");
  assert.deepEqual(restoreRoom(JSON.parse(JSON.stringify(results))), results);
  assert.equal(tally(results)[0].id, 2);
  assert.equal(tally(results)[0].likes, 3);
});

test("invalid storage resets votes while retaining valid preferences", () => {
  const valid = play([[true], [true]], "animation");
  assert.equal(restoreRoom({ ...valid, votes: [[true], []] }).stage, "setup");
  assert.equal(restoreRoom({ ...valid, playerIndex: 99 }).stage, "setup");
  assert.equal(restoreRoom({ ...valid, votes: [["yes"], [true]] }).stage, "setup");
  assert.equal(restoreRoom(null).stage, "setup");
  const migrated = restoreRoom({ nickname: "Alex", genre: "comedy", country: "DE", services: ["hbomax"], currentIndex: 1 });
  assert.deepEqual(migrated.players, ["Alex", ""]);
  assert.equal(migrated.genre, "comedy");
  assert.equal(migrated.stage, "setup");
});

test("names must be distinct and nonempty; restart clears all voter ballots", () => {
  assert.ok(playerError(["Alex", " alex "]));
  assert.ok(playerError(["Alex", "   "]));
  assert.ok(playerError(["Alex"]));
  const restarted = startRound(play([[true], [true], [false]], "comedy"));
  assert.equal(restarted.stage, "handover");
  assert.equal(restarted.playerIndex, 0);
  assert.deepEqual(restarted.votes, [[], [], []]);
});

test("a recommendation round keeps the group and replaces the movie list", () => {
  const finished = play([[true, false, true], [true, true, false]]);
  const recommendations = fixtures.map((item) => ({ ...item, id: item.id + 100, title: `Recommended ${item.id}` }));
  const nextRound = startRound(finished, recommendations);
  assert.equal(nextRound.stage, "handover");
  assert.deepEqual(nextRound.players, finished.players);
  assert.deepEqual(nextRound.movies, recommendations);
  assert.deepEqual(nextRound.votes, [[], []]);
  assert.equal(nextRound.playerIndex, 0);
});
