import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";

export type Game = {
  id: string;
  name: string;
  exe_path: string;
  playtime_sec: number;
  last_played: number | null;
  launches: number;
  added_at: number;
};

// в обычном браузере (vite dev без tauri) крутимся на демо-данных
export const isTauri = "__TAURI_INTERNALS__" in window;

const now = () => Math.floor(Date.now() / 1000);
let demo: Game[] = [
  { id: "1", name: "Counter-Strike 2", exe_path: "C:\\Games\\cs2\\cs2.exe", playtime_sec: 412 * 3600, last_played: now() - 3600 * 5, launches: 318, added_at: now() - 86400 * 200 },
  { id: "2", name: "Dota 2", exe_path: "C:\\Games\\dota2\\dota2.exe", playtime_sec: 96 * 3600, last_played: now() - 86400 * 3, launches: 71, added_at: now() - 86400 * 150 },
  { id: "3", name: "Hollow Knight", exe_path: "D:\\Games\\Hollow Knight\\hollow_knight.exe", playtime_sec: 41 * 3600 + 1200, last_played: now() - 86400 * 12, launches: 29, added_at: now() - 86400 * 90 },
  { id: "4", name: "Stardew Valley", exe_path: "D:\\Games\\Stardew Valley\\Stardew Valley.exe", playtime_sec: 27 * 3600, last_played: now() - 86400 * 40, launches: 18, added_at: now() - 86400 * 80 },
  { id: "5", name: "Hades", exe_path: "D:\\Games\\Hades\\Hades.exe", playtime_sec: 15 * 3600 + 900, last_played: now() - 86400 * 9, launches: 9, added_at: now() - 86400 * 30 },
  { id: "6", name: "Celeste", exe_path: "D:\\Games\\Celeste\\Celeste.exe", playtime_sec: 0, last_played: null, launches: 0, added_at: now() - 86400 },
];
const demoExit: ((id: string, s: number) => void)[] = [];

export async function listGames(): Promise<Game[]> {
  if (!isTauri) return [...demo];
  return invoke("list_games");
}

export async function addGame(name: string, exePath: string): Promise<Game> {
  if (!isTauri) {
    const g = { id: String(Date.now()), name, exe_path: exePath, playtime_sec: 0, last_played: null, launches: 0, added_at: now() };
    demo.push(g);
    return g;
  }
  return invoke("add_game", { name, exePath });
}

export async function removeGame(id: string) {
  if (!isTauri) { demo = demo.filter((g) => g.id !== id); return; }
  await invoke("remove_game", { id });
}

export async function renameGame(id: string, name: string) {
  if (!isTauri) { demo = demo.map((g) => (g.id === id ? { ...g, name } : g)); return; }
  await invoke("rename_game", { id, name });
}

export async function launchGame(id: string) {
  if (!isTauri) {
    // демо: "играем" 3 сек, засчитываем как 25 мин
    setTimeout(() => {
      demo = demo.map((g) => g.id === id ? { ...g, playtime_sec: g.playtime_sec + 1500, launches: g.launches + 1, last_played: now() } : g);
      demoExit.forEach((cb) => cb(id, 1500));
    }, 3000);
    return;
  }
  await invoke("launch_game", { id });
}

export function onGameExit(cb: (id: string, seconds: number) => void): () => void {
  if (!isTauri) {
    demoExit.push(cb);
    return () => { demoExit.splice(demoExit.indexOf(cb), 1); };
  }
  let off = () => {};
  listen<{ id: string; seconds: number }>("game-exited", (e) => cb(e.payload.id, e.payload.seconds)).then((u) => (off = u));
  return () => off();
}

export async function pickExe(): Promise<string | null> {
  if (!isTauri) return "C:\\Games\\NewGame\\game.exe";
  const res = await open({ multiple: false, filters: [{ name: "Игры", extensions: ["exe", "lnk", "bat", "url"] }] });
  return typeof res === "string" ? res : null;
}
