import test from "node:test";
import assert from "node:assert/strict";
import { parseFilters, discoverQuery, normalizeMovie, discoverMovies, getProviders, watchProviders, apiError, parseRecommendationFilters, recommendMovies } from "../lib/tmdb.ts";

const filters = { country: "RS", genre: "comedy", services: ["8", "9"], limit: 5 };
const movie = { id: 123, title: "Test response", release_date: "2025-01-01", genre_ids: [35], overview: "An upstream synopsis.", poster_path: "/abc.jpg", vote_average: 7.2, vote_count: 200 };
const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

test("discovery uses regional subscription OR filters, not an intersection", () => {
  const query = discoverQuery(parseFilters(filters));
  assert.equal(query.get("with_watch_providers"), "8|9");
  assert.equal(query.get("watch_region"), "RS");
  assert.equal(query.get("with_genres"), "35");
  assert.equal(query.get("with_watch_monetization_types"), "flatrate");
  assert.equal(query.get("include_adult"), "false");
  assert.equal(discoverQuery({ ...filters, services: [], genre: "all" }).has("with_watch_providers"), false);
  assert.throws(() => parseFilters({ ...filters, country: "XX" }));
  assert.throws(() => parseFilters({ ...filters, genre: "unknown" }));
  assert.throws(() => parseFilters({ ...filters, limit: 999 }));
  assert.throws(() => parseFilters({ ...filters, services: ["8|9"] }));
});

test("movie normalization labels TMDB data and handles missing images, synopsis and ratings", () => {
  assert.deepEqual(normalizeMovie(movie), { id: 123, title: "Test response", details: "2025 · Comedy", description: "An upstream synopsis.", poster: "https://image.tmdb.org/t/p/w500/abc.jpg", rating: 7.2 });
  const missing = normalizeMovie({ ...movie, poster_path: null, overview: "", vote_count: 0 });
  assert.equal(missing.poster, null);
  assert.equal(missing.rating, null);
  assert.ok(missing.description.length);
  assert.equal(normalizeMovie({ ...movie, adult: true }), null);
  assert.equal(normalizeMovie({ ...movie, poster_path: "//evil.example/a" }).poster, null);
});

test("missing credentials and upstream failures return actionable errors without leaking credentials", async () => {
  const previous = process.env.TMDB_READ_ACCESS_TOKEN;
  try {
    delete process.env.TMDB_READ_ACCESS_TOKEN;
    await assert.rejects(getProviders("RS", () => { throw new Error("Must not fetch"); }), { code: "NOT_CONFIGURED" });
    process.env.TMDB_READ_ACCESS_TOKEN = "test-only-token";
    for (const [status, code] of [[401, "AUTH_FAILED"], [429, "RATE_LIMITED"], [500, "UNAVAILABLE"]]) {
      try { await getProviders("RS", async () => response({ private: "do not expose" }, status)); assert.fail(); }
      catch (error) {
        assert.equal(error.code, code);
        assert.ok(!(await apiError(error).text()).includes("test-only-token"));
      }
    }
    await assert.rejects(getProviders("RS", async () => { throw new Error("network"); }), { code: "UNAVAILABLE" });
  } finally {
    if (previous === undefined) delete process.env.TMDB_READ_ACCESS_TOKEN;
    else process.env.TMDB_READ_ACCESS_TOKEN = previous;
  }
});

test("successful discovery validates services, removes duplicates, and supports zero results", async () => {
  const previous = process.env.TMDB_READ_ACCESS_TOKEN;
  process.env.TMDB_READ_ACCESS_TOKEN = "test-only-token";
  const seen = [];
  const fetcher = async (url, options) => {
    seen.push(url);
    assert.equal(options.headers.Authorization, "Bearer test-only-token");
    assert.equal(options.cache, "no-store");
    return url.includes("watch/providers/movie") ? response({ results: [{ provider_id: 8, provider_name: "Service A" }, { provider_id: 9, provider_name: "Service B" }] }) : response({ results: [movie, movie, { ...movie, id: 456 }, { ...movie, id: 789, adult: true }] });
  };
  try {
    const movies = await discoverMovies(filters, fetcher);
    assert.equal(movies.length, 2);
    assert.deepEqual(movies.map((m) => m.id).sort(), [123, 456]);
    assert.equal(seen.length, 2);
    await assert.rejects(discoverMovies({ ...filters, services: ["9999"] }, fetcher), { code: "INVALID_FILTERS" });
    assert.deepEqual(await discoverMovies({ ...filters, services: [] }, async () => response({ results: [] })), []);
  } finally {
    if (previous === undefined) delete process.env.TMDB_READ_ACCESS_TOKEN;
    else process.env.TMDB_READ_ACCESS_TOKEN = previous;
  }
});

test("watch availability separates subscriptions, rental and purchase by country", async () => {
  const previous = process.env.TMDB_READ_ACCESS_TOKEN;
  process.env.TMDB_READ_ACCESS_TOKEN = "test-only-token";
  try {
    const result = await watchProviders(123, "RS", async () => response({ results: {
      RS: { flatrate: [{ provider_name: "Service A" }], rent: [{ provider_name: "Rental B" }], buy: [] },
      US: { flatrate: [{ provider_name: "US only" }] },
    } }));
    assert.deepEqual(result.subscription, ["Service A"]);
    assert.deepEqual(result.rent, ["Rental B"]);
    assert.deepEqual(result.buy, []);
    assert.equal(result.link, "https://www.themoviedb.org/movie/123/watch?locale=RS");
  } finally {
    if (previous === undefined) delete process.env.TMDB_READ_ACCESS_TOKEN;
    else process.env.TMDB_READ_ACCESS_TOKEN = previous;
  }
});

test("group recommendations combine seed lists, rank overlap, and remove shown or unreleased movies", async () => {
  const previous = process.env.TMDB_READ_ACCESS_TOKEN;
  process.env.TMDB_READ_ACCESS_TOKEN = "test-only-token";
  const makeMovie = (id, title = `Movie ${id}`) => ({ ...movie, id, title });
  const filters = parseRecommendationFilters({ seeds: [1, 2], exclude: [123], country: "RS", services: [], limit: 5 });
  const seen = [];
  try {
    const movies = await recommendMovies(filters, async (url) => {
      seen.push(url);
      if (url.includes("/movie/1/recommendations")) return response({ results: [
        makeMovie(123, "Already shown"), makeMovie(900, "Shared suggestion"), makeMovie(901),
        { ...makeMovie(903), release_date: "2999-01-01" }, { ...makeMovie(904), adult: true },
      ] });
      return response({ results: [makeMovie(902), makeMovie(900, "Shared suggestion")] });
    });
    assert.deepEqual(movies.map((item) => item.id), [900, 901, 902]);
    assert.equal(seen.length, 2);
    assert.ok(seen.every((url) => url.includes("/recommendations?language=en-US&page=1")));
    assert.throws(() => parseRecommendationFilters({ ...filters, seeds: [] }));
    assert.throws(() => parseRecommendationFilters({ ...filters, seeds: [1, 2, 3, 4] }));
  } finally {
    if (previous === undefined) delete process.env.TMDB_READ_ACCESS_TOKEN;
    else process.env.TMDB_READ_ACCESS_TOKEN = previous;
  }
});

test("second-round recommendations honor selected subscription services", async () => {
  const previous = process.env.TMDB_READ_ACCESS_TOKEN;
  process.env.TMDB_READ_ACCESS_TOKEN = "test-only-token";
  const makeMovie = (id) => ({ ...movie, id, title: `Movie ${id}` });
  const filters = parseRecommendationFilters({ seeds: [1], exclude: [1], country: "RS", services: ["8"], limit: 5 });
  try {
    const movies = await recommendMovies(filters, async (url) => {
      if (url.includes("watch/providers/movie")) return response({ results: [{ provider_id: 8, provider_name: "Service A" }] });
      if (url.includes("/recommendations")) return response({ results: [makeMovie(900), makeMovie(901)] });
      if (url.includes("/movie/900/watch/providers")) return response({ results: { RS: { flatrate: [{ provider_id: 9 }] } } });
      if (url.includes("/movie/901/watch/providers")) return response({ results: { RS: { flatrate: [{ provider_id: 8 }] } } });
      throw new Error(`Unexpected URL: ${url}`);
    });
    assert.deepEqual(movies.map((item) => item.id), [901]);
  } finally {
    if (previous === undefined) delete process.env.TMDB_READ_ACCESS_TOKEN;
    else process.env.TMDB_READ_ACCESS_TOKEN = previous;
  }
});
