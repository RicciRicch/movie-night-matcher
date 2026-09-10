export const countryNames: Record<string, string> = {
  RS: "Serbia", GB: "United Kingdom", US: "United States", DE: "Germany", FR: "France",
};
export const genreNames: Record<string, string> = {
  all: "A little of everything", "sci-fi": "Sci-fi", comedy: "Comedy", animation: "Animation",
  action: "Action", drama: "Drama", thriller: "Thriller", romance: "Romance", horror: "Horror",
};
export type Provider = { id: string; name: string };
export type Movie = {
  id: number; title: string; details: string; description: string;
  poster: string | null; rating: number | null;
};
export function validMovies(value: unknown): value is Movie[] {
  return Array.isArray(value) && value.length > 0 && value.length <= 20 &&
    value.every((movie) => record(movie) && Number.isInteger(movie.id) &&
      typeof movie.id === "number" && movie.id > 0 &&
      typeof movie.title === "string" && movie.title.length > 0 &&
      typeof movie.details === "string" && typeof movie.description === "string" &&
      (movie.poster === null || (typeof movie.poster === "string" && /^https:\/\/image\.tmdb\.org\/t\/p\/w500\/[a-zA-Z0-9_.-]+$/.test(movie.poster))) &&
      (movie.rating === null || (typeof movie.rating === "number" && Number.isFinite(movie.rating) && movie.rating >= 0 && movie.rating <= 10))) &&
    new Set(value.map((movie) => movie.id)).size === value.length;
}

export type Room = {
  version: 2;
  movies: Movie[];
  roundSize: number;
  players: string[];
  country: string;
  genre: string;
  services: string[];
  stage: "setup" | "handover" | "voting" | "results";
  playerIndex: number;
  votes: boolean[][];
};
export const storageKey = "movie-night-room-v2";
export function newRoom(): Room {
  return { version: 2, movies: [], roundSize: 10, players: ["", ""], country: "RS", genre: "all", services: [],
    stage: "setup", playerIndex: 0, votes: [[], []] };
}
export function roomMovies(room: Room) {
  return room.movies;
}
export function playerError(players: string[]) {
  if (players.length < 2) return "Add at least two voters.";
  const names = players.map((name) => name.trim());
  if (names.some((name) => !name || name.length > 20)) return "Give every voter a nickname of 1–20 characters.";
  if (new Set(names.map((name) => name.toLowerCase())).size !== names.length)
    return "Use a different nickname for each voter.";
  return "";
}
export function startRound(room: Room, selectedMovies: Movie[] = room.movies): Room {
  if (playerError(room.players) || !validMovies(selectedMovies)) return room;
  return { ...room, movies: selectedMovies, players: room.players.map((name) => name.trim()),
    votes: room.players.map(() => []), playerIndex: 0, stage: "handover" };
}
export function vote(room: Room, liked: boolean): Room {
  if (room.stage !== "voting") return room;
  const current = room.votes[room.playerIndex];
  if (current.length >= roomMovies(room).length) return room;
  return { ...room, votes: room.votes.map((votes, index) =>
    index === room.playerIndex ? [...votes, liked] : votes) };
}
export function undo(room: Room): Room {
  if (room.stage !== "voting") return room;
  return { ...room, votes: room.votes.map((votes, index) =>
    index === room.playerIndex ? votes.slice(0, -1) : votes) };
}
export function finishTurn(room: Room): Room {
  if (room.stage !== "voting" || room.votes[room.playerIndex].length !== roomMovies(room).length) return room;
  if (room.playerIndex === room.players.length - 1) return { ...room, stage: "results" };
  return { ...room, playerIndex: room.playerIndex + 1, stage: "handover" };
}
export function tally(room: Room) {
  // Results are never exposed before every voter has submitted their turn.
  if (room.stage !== "results") return [];
  return roomMovies(room).map((movie, index) => ({ ...movie,
    likes: room.votes.filter((votes) => votes[index] === true).length,
  })).sort((a, b) => b.likes - a.likes || a.id - b.id);
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function restoreRoom(value: unknown): Room {
  const fresh = newRoom();
  if (!record(value)) return fresh;
  if (typeof value.country === "string" && Object.hasOwn(countryNames, value.country)) fresh.country = value.country;
  if (typeof value.genre === "string" && Object.hasOwn(genreNames, value.genre)) fresh.genre = value.genre;
  if (Array.isArray(value.services)) fresh.services = [...new Set(value.services.filter(
    (id): id is string => typeof id === "string" && /^\d{1,6}$/.test(id)
  ))].slice(0, 30);
  if ([5, 10, 15].includes(Number(value.roundSize))) fresh.roundSize = Number(value.roundSize);
  if (Array.isArray(value.players) && value.players.length >= 2 &&
      value.players.every((name) => typeof name === "string" && name.length <= 20)) {
    fresh.players = value.players as string[];
  } else if (typeof value.nickname === "string") {
    // Keep preferences from the older solo prototype, but begin a new group round.
    fresh.players[0] = value.nickname.slice(0, 20);
  }
  fresh.votes = fresh.players.map(() => []);
  if (value.version !== 2 || value.stage === "setup" || playerError(fresh.players) || !validMovies(value.movies)) return fresh;
  fresh.movies = value.movies;
  if (!["handover", "voting", "results"].includes(String(value.stage))) return fresh;
  if (!Number.isInteger(value.playerIndex) || typeof value.playerIndex !== "number" ||
      value.playerIndex < 0 || value.playerIndex >= fresh.players.length) return fresh;
  const count = roomMovies(fresh).length;
  if (!Array.isArray(value.votes) || value.votes.length !== fresh.players.length ||
      !value.votes.every((votes) => Array.isArray(votes) && votes.length <= count &&
        votes.every((vote) => typeof vote === "boolean"))) return fresh;
  const votes = value.votes as boolean[][];
  const index = value.playerIndex;
  if (votes.some((v, i) => (i < index && v.length !== count) || (i > index && v.length !== 0))) return fresh;
  if (value.stage === "handover" && votes[index].length !== 0) return fresh;
  if (value.stage === "results" && (index !== fresh.players.length - 1 || votes[index].length !== count)) return fresh;
  return { ...fresh, stage: value.stage as Room["stage"], playerIndex: index, votes };
}
