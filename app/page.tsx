"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Image from "next/image";
import MovieCard, { Poster } from "../components/MovieCard";
import WatchOptions from "../components/WatchOptions";
import {
  countryNames, genreNames, newRoom, playerError, startRound, vote, undo,
  finishTurn, tally, restoreRoom, storageKey, validMovies, type Room, type Provider,
} from "../lib/room";

const subscribe = () => () => {};

function Brand() {
  return <div className="brand"><span className="brand-icon" aria-hidden="true">
    <svg viewBox="0 0 24 24" fill="none"><rect x="3" y="8" width="18" height="13" rx="3" stroke="currentColor" strokeWidth="1.7"/><path d="m3 8 17-4-1-3L2 5l1 3ZM8 4 11 7M14 2l3 3M10 12l5 3-5 3v-6Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"/></svg>
  </span><span>movie night<span className="brand-sub">MATCHER</span></span></div>;
}

export default function Home() {
  const isClient = useSyncExternalStore(subscribe, () => true, () => false);
  return <div className="site-shell">
    <header className="site-header"><Brand /><span className="device-badge"><span /> Made for your whole group</span></header>
    <main>{isClient ? <MovieRoom /> : <div className="loading-screen" role="status">Getting your movie night ready…</div>}</main>
    <footer className="site-footer"><span>A good movie. Better company.</span>
      <details><summary>Movie data & credits</summary><a href="https://www.themoviedb.org" target="_blank" rel="noreferrer"><Image className="tmdb-logo" src="/tmdb-logo.svg" alt="TMDB" width={55} height={40} /></a><p>Movie data and images by <a href="https://www.themoviedb.org" target="_blank" rel="noreferrer">TMDB</a>. Streaming availability by <a href="https://www.justwatch.com" target="_blank" rel="noreferrer">JustWatch</a>.</p><p>This product uses the TMDB API but is not endorsed or certified by TMDB.</p><p>TMDB logo by Travis Bell, unchanged, via <a href="https://commons.wikimedia.org/wiki/File:Tmdb.new.logo.svg" target="_blank" rel="noreferrer">Wikimedia Commons</a> · <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noreferrer">CC BY-SA 4.0</a>.</p></details>
    </footer>
  </div>;
}

function MovieRoom() {
  const [room, setRoom] = useState<Room>(() => {
    try {
      const saved = localStorage.getItem(storageKey) ?? localStorage.getItem("movie-night-room-v1") ?? localStorage.getItem("movie-night-progress");
      return saved ? restoreRoom(JSON.parse(saved)) : newRoom();
    } catch { return newRoom(); }
  });
  const [step, setStep] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [recommendationBusy, setRecommendationBusy] = useState(false);
  const [recommendationError, setRecommendationError] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);
  const [providerState, setProviderState] = useState<{ country: string; options: Provider[]; error: string; code: string }>({ country: "", options: [], error: "", code: "" });
  const [retry, setRetry] = useState(0);
  const [showServices, setShowServices] = useState(false);
  const [serviceSearch, setServiceSearch] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  const requestLock = useRef(false);
  const currentVotes = room.votes[room.playerIndex];
  const movie = room.movies[currentVotes.length];
  const currentPlayer = room.players[room.playerIndex];
  const scores = tally(room);
  const matches = scores.filter((movie) => movie.likes === room.players.length);
  const shortlist = scores.filter((movie) => movie.likes > 0);
  const completed = room.stage === "results" ? room.players.length : room.playerIndex;
  const providersLoading = providerState.country !== room.country;
  const services = providerState.options.filter((provider) => provider.name.toLowerCase().includes(serviceSearch.toLowerCase()));

  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify(room)); }
    catch { /* A storage failure does not prevent voting. */ }
  }, [room]);
  useEffect(() => { heading.current?.focus(); }, [room.stage, room.playerIndex, step]);
  useEffect(() => {
    if (room.stage !== "setup") return;
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch("/api/providers?country=" + room.country, { signal: controller.signal });
        const data = await response.json();
        if (controller.signal.aborted) return;
        if (!response.ok) {
          setProviderState({ country: room.country, options: [], error: data.error || "Couldn’t load streaming services.", code: data.code || "" });
          return;
        }
        const options: Provider[] = Array.isArray(data.providers) ? data.providers : [];
        setProviderState({ country: room.country, options, error: "", code: "" });
        setRoom((previous) => ({ ...previous, services: previous.services.filter((id) => options.some((provider) => provider.id === id)) }));
      } catch {
        if (!controller.signal.aborted) setProviderState({ country: room.country, options: [], error: "We couldn’t connect to the movie library. Please try again.", code: "" });
      }
    }
    load();
    return () => controller.abort();
  }, [room.country, room.stage, retry]);

  function updatePreferences(changes: Partial<Room>) {
    setError(""); setRoom((previous) => ({ ...previous, ...changes }));
  }
  async function findMovies() {
    if (requestLock.current) return;
    const message = playerError(room.players);
    if (message) { setStep(0); setError(message); return; }
    requestLock.current = true; setBusy(true); setError("");
    try {
      const response = await fetch("/api/movies", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ country: room.country, genre: room.genre, services: room.services, limit: room.roundSize }),
        signal: AbortSignal.timeout(30000) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Couldn’t find movies. Please try again.");
      if (Array.isArray(data.movies) && !data.movies.length) throw new Error("No movies fit this combination. Try another genre or choose any streaming service.");
      if (!validMovies(data.movies)) throw new Error("The movie list couldn’t be loaded. Please try again.");
      setRoom(startRound(room, data.movies)); setConfirmReset(false);
    } catch (failure) { setError(failure instanceof Error && failure.name !== "TimeoutError" ? failure.message : "That took longer than expected. Please try again."); }
    finally { setBusy(false); requestLock.current = false; }
  }
  async function findSimilarMovies() {
    if (requestLock.current || !shortlist.length) return;
    requestLock.current = true; setRecommendationBusy(true); setRecommendationError("");
    try {
      const response = await fetch("/api/recommendations", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          seeds: shortlist.slice(0, 3).map((item) => item.id),
          exclude: room.movies.map((item) => item.id),
          country: room.country,
          services: room.services,
          limit: room.roundSize,
        }),
        signal: AbortSignal.timeout(30000) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Couldn’t find similar movies. Please try again.");
      if (Array.isArray(data.movies) && !data.movies.length)
        throw new Error(room.services.length ? "No new recommendations are included with your selected services. Try editing the room and choosing any service." : "TMDB didn’t find enough new recommendations from these likes. Try a different movie set.");
      if (!validMovies(data.movies)) throw new Error("The recommendation list couldn’t be loaded. Please try again.");
      setRoom(startRound(room, data.movies));
    } catch (failure) {
      setRecommendationError(failure instanceof Error && failure.name !== "TimeoutError" ? failure.message : "That took longer than expected. Please try again.");
    } finally { setRecommendationBusy(false); requestLock.current = false; }
  }
  function editRoom() {
    setRoom((previous) => ({ ...previous, stage: "setup", movies: [], playerIndex: 0, votes: previous.players.map(() => []) }));
    setStep(0); setConfirmReset(false); setError(""); setRecommendationError("");
  }

  if (room.stage === "setup") return <div className="setup-layout">
    <section className="intro">
      <span className="eyebrow"><span className="little-star" aria-hidden="true">✳</span> THE GROUP CHAT ENDS HERE</span>
      <h1>Less scrolling.<br />{" "}More <em>movie night.</em></h1>
      <p className="intro-copy">A few votes. A shared favorite.<br />{" "}Find something everyone wants to watch.</p>
      <div className="how-it-works">
        <div><span>01</span><p><strong>Bring your people</strong>Two friends or the whole sofa.</p></div>
        <div><span>02</span><p><strong>Vote your way</strong>Pass the device. Like it or leave it.</p></div>
        <div><span>03</span><p><strong>Meet your match</strong>Everyone’s yes is tonight’s movie.</p></div>
      </div>
      <div className="sofa-note"><div className="avatar-stack">{room.players.slice(0, 4).map((name, i) => <span key={i} className={"avatar tone-" + i}>{name.trim().slice(0, 1).toUpperCase() || ["J", "A", "M", "S"][i]}</span>)}</div><p>One device. Everyone gets a say.<small>No accounts needed to vote.</small></p></div>
    </section>
    <section className="setup-card">
      <div className="stepper" aria-label="Setup progress"><span className={step === 0 ? "current" : "done"}><b>{step === 0 ? "1" : "✓"}</b> Your people</span><i /><span className={step === 1 ? "current" : ""}><b>2</b> Your movie night</span></div>
      <form onSubmit={(event) => {
        event.preventDefault();
        if (step === 0) { const message = playerError(room.players); setError(message); if (!message) setStep(1); }
        else findMovies();
      }}>
        <fieldset disabled={busy} className="form-body">
          <div className="form-title"><p className="eyebrow">STEP {step + 1} OF 2</p><h2 ref={heading} tabIndex={-1}>{step === 0 ? "Who’s watching?" : "Set the mood."}</h2><p>{step === 0 ? "Add a nickname for everyone joining the room." : "We’ll find popular movies for your kind of night."}</p></div>
          {step === 0 ? <>
            <div className="players-list">{room.players.map((name, index) => <div className="player-row" key={index}>
              <span className={"avatar tone-" + index % 4} aria-hidden="true">{name.trim().slice(0, 1).toUpperCase() || index + 1}</span>
              <div className="player-input"><label htmlFor={"player-" + index}>Voter {index + 1}{index === 0 && <span> · you, perhaps?</span>}</label>
                <input id={"player-" + index} value={name} maxLength={20} required placeholder={index === 0 ? "Your nickname" : "Their nickname"}
                  onChange={(event) => updatePreferences({ players: room.players.map((player, i) => i === index ? event.target.value : player) })} /></div>
              {room.players.length > 2 && <button type="button" className="remove-player" aria-label={"Remove voter " + (index + 1)} onClick={() => updatePreferences({ players: room.players.filter((_, i) => i !== index), votes: room.votes.filter((_, i) => i !== index) })}>×</button>}
            </div>)}</div>
            <button type="button" className="add-player" onClick={() => updatePreferences({ players: [...room.players, ""], votes: [...room.votes, []] })}><span>＋</span> Add another person</button>
            <div className="setup-bottom"><span>{room.players.length} people, one great pick.</span><button className="button primary" type="submit">Next: the movies <span aria-hidden="true">→</span></button></div>
          </> : <>
            <div className="field-grid">
              <div><label htmlFor="country">Watching from</label><select id="country" value={room.country} onChange={(event) => { updatePreferences({ country: event.target.value, services: [] }); setServiceSearch(""); setShowServices(false); }}>
                {Object.entries(countryNames).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></div>
              <div><label htmlFor="round-size">Movies per person</label><select id="round-size" value={room.roundSize} onChange={(event) => updatePreferences({ roundSize: Number(event.target.value) })}><option value={5}>5 · Quick pick</option><option value={10}>10 · Just right</option><option value={15}>15 · More choice</option></select></div>
            </div>
            <fieldset className="choice-field"><legend>What sounds good?</legend><div className="chips">{Object.entries(genreNames).map(([id, name]) =>
              <button type="button" key={id} className={"chip " + (room.genre === id ? "selected" : "")} aria-pressed={room.genre === id} onClick={() => updatePreferences({ genre: id })}>{name}</button>)}</div></fieldset>
            <fieldset className="choice-field"><legend>Where do you watch? <span>Optional</span></legend><p className="field-hint">Choose any you have. We’ll look for included subscriptions.</p>
              {providersLoading ? <p role="status" className="field-hint">Loading services in {countryNames[room.country]}…</p> : providerState.error ? <div className="connection-note" role="status">
                <strong>{providerState.code === "NOT_CONFIGURED" ? "One little connection left." : "Movie library unavailable"}</strong><p>{providerState.error}</p>
                <button type="button" className="text-button" onClick={() => { setProviderState({ country: "", options: [], error: "", code: "" }); setRetry((value) => value + 1); }}>Try connection again ↻</button>
              </div> : <>
                <div className="chips"><button type="button" className={"chip " + (!room.services.length ? "selected" : "")} aria-pressed={!room.services.length} onClick={() => updatePreferences({ services: [] })}>Any service</button>
                  {(showServices ? services : services.slice(0, 10)).map((provider) => <button type="button" key={provider.id}
                    className={"chip " + (room.services.includes(provider.id) ? "selected" : "")} aria-pressed={room.services.includes(provider.id)}
                    onClick={() => updatePreferences({ services: room.services.includes(provider.id) ? room.services.filter((id) => id !== provider.id) : [...room.services, provider.id] })}>{provider.name}</button>)}</div>
                {providerState.options.length > 10 && <button type="button" className="text-button" onClick={() => setShowServices(!showServices)}>{showServices ? "Show fewer services" : "See all services +"}</button>}
                {showServices && <><label className="sr-only" htmlFor="service-search">Search services</label><input id="service-search" placeholder="Search services…" value={serviceSearch} onChange={(event) => setServiceSearch(event.target.value)} /></>}
                <p className="field-hint">{room.services.length ? room.services.length + " selected · available on at least one" : "Any service includes movies that may need rental or purchase."}</p>
              </>}
            </fieldset>
            <div className="setup-bottom"><button type="button" className="text-button" onClick={() => { setStep(0); setError(""); }}>← Your people</button>
              <button type="submit" className="button primary" disabled={providersLoading || !!providerState.error || busy}>{busy ? "Finding your movies…" : "Find our movies"} {!busy && <span aria-hidden="true">→</span>}</button></div>
          </>}
          {error && <p role="alert" className="error-message">{error}</p>}
        </fieldset>
      </form>
      <div className="card-footnote"><span aria-hidden="true">✦</span> {step === 0 ? "Pass-and-play. No invites or sign-ups." : "Fresh movie picks from TMDB, chosen when you start."}</div>
    </section>
  </div>;

  return <div className={"round-layout " + (room.stage === "results" ? "results-layout" : "")}>
    <div className="round-top"><span className="eyebrow">YOUR MOVIE NIGHT</span><button type="button" className="text-button" disabled={recommendationBusy} onClick={() => setConfirmReset(true)}>Edit room</button></div>
    <div className="room-strip"><div className="avatar-stack">{room.players.slice(0, 5).map((name, i) => <span key={i} className={"avatar tone-" + i % 4} title={name}>{name[0].toUpperCase()}</span>)}</div><div><strong>{room.players.length} people · {room.movies.length} movies</strong><p>{countryNames[room.country]} · {genreNames[room.genre]}</p></div><span className="finished-count" role="status">{completed}/{room.players.length} finished</span></div>

    {room.stage === "handover" && <section className="handover-card">
      <span className={"avatar hero-avatar tone-" + room.playerIndex % 4}>{currentPlayer[0].toUpperCase()}</span>
      <p className="eyebrow">VOTER {room.playerIndex + 1} OF {room.players.length}</p>
      <h1 ref={heading} tabIndex={-1}>You’re up, <em>{currentPlayer}.</em></h1>
      <p>Pass the device over. The next {room.movies.length} movies are yours to decide.<br />Everyone else’s votes stay under wraps.</p>
      <button type="button" className="button primary" onClick={() => setRoom((previous) => ({ ...previous, stage: "voting" }))}>Let’s find a favorite <span aria-hidden="true">→</span></button>
      <p className="fine-print">Same movies. Your own opinion.</p>
    </section>}

    {room.stage === "voting" && <>
      <div className="voting-heading"><h1 ref={heading} tabIndex={-1}>{currentPlayer}’s picks</h1><span aria-live="polite">{movie ? currentVotes.length + 1 : currentVotes.length} / {room.movies.length}</span></div>
      <div role="progressbar" aria-label="Movies voted on" aria-valuemin={0} aria-valuemax={room.movies.length} aria-valuenow={currentVotes.length} className="progress-track"><div style={{ width: currentVotes.length / room.movies.length * 100 + "%" }} /></div>
      {movie ? <MovieCard key={movie.id} movie={movie} onVote={(liked) => setRoom((previous) => vote(previous, liked))} /> : <section className="handover-card turn-done">
        <span className="success-mark" aria-hidden="true">✓</span><h2>That’s your part done.</h2><p>Happy with your picks? Submit them to finish your turn.</p>
        <button type="button" className="button primary" onClick={() => setRoom(finishTurn)}>{room.playerIndex === room.players.length - 1 ? "Reveal our matches" : "Submit & pass the device"} <span aria-hidden="true">→</span></button>
      </section>}
      {currentVotes.length > 0 && <div className="undo-row"><button type="button" onClick={() => setRoom(undo)} className="text-button">↶ Undo last vote</button><span>You can change your mind before submitting.</span></div>}
    </>}

    {room.stage === "results" && <>
      <div className="results-heading"><p className="eyebrow">{matches.length ? "THE GROUP HAS SPOKEN" : "A LITTLE COMPROMISE?"}</p><h1 ref={heading} tabIndex={-1}>{matches.length ? <>It’s a <em>match.</em></> : <>Your shared <em>shortlist.</em></>}</h1><p>{matches.length ? "Everyone said yes. All that’s left is the popcorn." : shortlist.length ? "No unanimous yes this time. These got the most love." : "No likes this round. Try a different mood and a fresh set of movies."}</p></div>
      <div className="results-grid">{(matches.length ? matches : shortlist).map((item) => <article key={item.id} className="result-card"><Poster movie={item} /><div className="result-copy"><span className="match-badge">{item.likes === room.players.length ? "♥ Everyone’s in" : item.likes + " of " + room.players.length + " liked"}</span><h2>{item.title}</h2><p className="movie-details">{item.details}</p>{item.rating !== null && <p className="rating">★ {item.rating.toFixed(1)} <span>on TMDB</span></p>}<WatchOptions id={item.id} country={room.country} /></div></article>)}</div>
      {!matches.length && shortlist.length > 1 && <p className="fine-print">Movies with equal votes are tied.</p>}
      <div className="results-actions">
        {shortlist.length > 0 && <div className="recommendation-action"><span aria-hidden="true">✦</span><div><strong>Want a closer match?</strong><p>Use the group’s likes to create a fresh second round.</p></div><button type="button" className="button primary" disabled={recommendationBusy} onClick={findSimilarMovies}>{recommendationBusy ? "Finding similar movies…" : "Find similar movies"} {!recommendationBusy && <span aria-hidden="true">→</span>}</button></div>}
        {recommendationError && <p role="alert" className="error-message recommendation-error">{recommendationError}</p>}
        <button type="button" className={"button " + (shortlist.length ? "secondary" : "primary")} disabled={recommendationBusy} onClick={editRoom}>Plan another movie night <span aria-hidden="true">→</span></button>
        <button type="button" className="text-button" disabled={recommendationBusy} onClick={() => { setRecommendationError(""); setRoom((previous) => startRound(previous)); }}>Vote on these movies again</button>
      </div>
    </>}

    {confirmReset && <div className="reset-panel" role="region" aria-label="Edit room confirmation"><h2>Back to planning?</h2><p>Your people and preferences will stay. This round’s votes will be cleared.</p><div><button type="button" className="button primary" onClick={editRoom}>Yes, edit the room</button><button type="button" className="button secondary" onClick={() => setConfirmReset(false)}>Keep this round</button></div></div>}
  </div>;
}
