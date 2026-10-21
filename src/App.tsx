import { useEffect, useMemo, useState } from "react";
import { Game, addGame, isTauri, launchGame, listGames, onGameExit, pickExe, removeGame, renameGame } from "./api";
import "./App.css";

type Sort = "recent" | "playtime" | "name";

function fmtHours(sec: number) {
  if (sec < 60) return "не запускалась";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h ? `${h} ч ${m} мин` : `${m} мин`;
}

function fmtAgo(ts: number | null) {
  if (!ts) return "ещё не играл";
  const d = Math.floor(Date.now() / 1000) - ts;
  if (d < 3600) return "только что";
  if (d < 86400) return `${Math.floor(d / 3600)} ч назад`;
  if (d < 86400 * 30) return `${Math.floor(d / 86400)} дн назад`;
  return new Date(ts * 1000).toLocaleDateString("ru-RU");
}

// обложка из названия: стабильный цвет + инициалы
function cover(name: string) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  return {
    initials,
    style: { background: `linear-gradient(135deg, hsl(${h} 70% 45%), hsl(${(h + 50) % 360} 75% 25%))` },
  };
}

function baseName(path: string) {
  const file = path.split(/[\\/]/).pop() || "";
  return file.replace(/\.(exe|lnk|bat|url)$/i, "").replace(/[_-]+/g, " ");
}

export default function App() {
  const [games, setGames] = useState<Game[]>([]);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("recent");
  const [running, setRunning] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState("");
  const [adding, setAdding] = useState(false);
  const [menu, setMenu] = useState<string | null>(null);

  const reload = () => listGames().then(setGames);

  useEffect(() => {
    reload();
    return onGameExit((id, secs) => {
      setRunning((r) => { const n = new Set(r); n.delete(id); return n; });
      notify(`Сессия: ${fmtHours(secs)}`);
      reload();
    });
  }, []);

  useEffect(() => {
    const close = () => setMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, []);

  function notify(t: string) {
    setToast(t);
    setTimeout(() => setToast(""), 3000);
  }

  async function play(g: Game) {
    try {
      await launchGame(g.id);
      setRunning((r) => new Set(r).add(g.id));
      notify(`Запускаю ${g.name}…`);
    } catch (e) {
      notify(String(e));
    }
  }

  async function remove(g: Game) {
    if (!confirm(`Убрать «${g.name}» из библиотеки? Сама игра не удалится.`)) return;
    await removeGame(g.id);
    reload();
  }

  async function rename(g: Game) {
    const name = prompt("Новое название", g.name);
    if (!name || !name.trim()) return;
    await renameGame(g.id, name);
    reload();
  }

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    const l = games.filter((g) => g.name.toLowerCase().includes(q));
    if (sort === "name") l.sort((a, b) => a.name.localeCompare(b.name));
    if (sort === "playtime") l.sort((a, b) => b.playtime_sec - a.playtime_sec);
    if (sort === "recent") l.sort((a, b) => (b.last_played || 0) - (a.last_played || 0) || b.added_at - a.added_at);
    return l;
  }, [games, query, sort]);

  const total = games.reduce((s, g) => s + g.playtime_sec, 0);
  const top = [...games].sort((a, b) => b.playtime_sec - a.playtime_sec)[0];
  const last = [...games].filter((g) => g.last_played).sort((a, b) => (b.last_played || 0) - (a.last_played || 0))[0];

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <img src="/logo.svg" alt="" />
          <div>
            <b>Ultra Launcher</b>
            <span>{isTauri ? "твоя библиотека" : "демо-режим (браузер)"}</span>
          </div>
        </div>
        <input className="search" placeholder="Поиск по играм…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
          <option value="recent">Недавние</option>
          <option value="playtime">Больше всего часов</option>
          <option value="name">По алфавиту</option>
        </select>
        <button className="btn primary" onClick={() => setAdding(true)}>+ Добавить игру</button>
      </header>

      {last && (
        <section className="hero">
          <div className="hero-cover" style={cover(last.name).style}>{cover(last.name).initials}</div>
          <div className="hero-info">
            <span className="kicker">Продолжить</span>
            <h1>{last.name}</h1>
            <p>{fmtHours(last.playtime_sec)} • {fmtAgo(last.last_played)}</p>
          </div>
          <button className="btn play big" disabled={running.has(last.id)} onClick={() => play(last)}>
            {running.has(last.id) ? "Запущено" : "▶ Играть"}
          </button>
        </section>
      )}

      <section className="stats">
        <div><b>{games.length}</b><span>игр в библиотеке</span></div>
        <div><b>{Math.round(total / 3600)} ч</b><span>всего наиграно</span></div>
        <div><b>{top && top.playtime_sec ? top.name : "—"}</b><span>любимая игра</span></div>
        <div><b>{games.reduce((s, g) => s + g.launches, 0)}</b><span>запусков</span></div>
      </section>

      {list.length === 0 ? (
        <div className="empty">
          {games.length ? "Ничего не нашлось" : <>Библиотека пустая. <a onClick={() => setAdding(true)}>Добавь первую игру</a> — укажи .exe, дальше лаунчер сам посчитает часы.</>}
        </div>
      ) : (
        <section className="grid">
          {list.map((g) => {
            const c = cover(g.name);
            const isRun = running.has(g.id);
            return (
              <article key={g.id} className={"card" + (isRun ? " running" : "")}>
                <div className="cover" style={c.style}>
                  <span>{c.initials}</span>
                  {isRun && <i className="live">● в игре</i>}
                  <button className="dots" onClick={(e) => { e.stopPropagation(); setMenu(menu === g.id ? null : g.id); }}>⋯</button>
                  {menu === g.id && (
                    <div className="menu" onClick={(e) => e.stopPropagation()}>
                      <button onClick={() => { setMenu(null); rename(g); }}>Переименовать</button>
                      <button className="danger" onClick={() => { setMenu(null); remove(g); }}>Убрать из библиотеки</button>
                    </div>
                  )}
                </div>
                <div className="body">
                  <h3 title={g.exe_path}>{g.name}</h3>
                  <p>{fmtHours(g.playtime_sec)}</p>
                  <small>{fmtAgo(g.last_played)}</small>
                  <button className="btn play" disabled={isRun} onClick={() => play(g)}>{isRun ? "Запущено" : "▶ Играть"}</button>
                </div>
              </article>
            );
          })}
        </section>
      )}

      {adding && <AddModal onClose={() => setAdding(false)} onAdded={(g) => { setAdding(false); notify(`${g.name} добавлена`); reload(); }} />}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function AddModal({ onClose, onAdded }: { onClose: () => void; onAdded: (g: Game) => void }) {
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [err, setErr] = useState("");

  async function pick() {
    const p = await pickExe();
    if (!p) return;
    setPath(p);
    if (!name) setName(baseName(p));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    try {
      onAdded(await addGame(name, path));
    } catch (e) {
      setErr(String(e));
    }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2>Новая игра</h2>
        <label>Файл запуска</label>
        <div className="row">
          <input value={path} placeholder="C:\Games\...\game.exe" onChange={(e) => setPath(e.target.value)} />
          <button type="button" className="btn" onClick={pick}>Выбрать…</button>
        </div>
        <label>Название</label>
        <input value={name} placeholder="Как назвать в библиотеке" onChange={(e) => setName(e.target.value)} />
        {err && <div className="err">{err}</div>}
        <div className="actions">
          <button type="button" className="btn ghost" onClick={onClose}>Отмена</button>
          <button className="btn primary" disabled={!path || !name.trim()}>Добавить</button>
        </div>
      </form>
    </div>
  );
}
