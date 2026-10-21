use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Serialize, Deserialize, Clone)]
pub struct Game {
    pub id: String,
    pub name: String,
    pub exe_path: String,
    pub playtime_sec: u64,
    pub last_played: Option<u64>,
    pub launches: u32,
    pub added_at: u64,
}

#[derive(Serialize, Clone)]
struct ExitEvent {
    id: String,
    seconds: u64,
}

// библиотека в памяти + путь до json в app data
struct Library {
    games: Mutex<Vec<Game>>,
    file: PathBuf,
}

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

fn load(file: &Path) -> Vec<Game> {
    fs::read_to_string(file)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save(file: &Path, games: &[Game]) -> Result<(), String> {
    if let Some(dir) = file.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(games).map_err(|e| e.to_string())?;
    // пишем во временный и переименовываем, чтобы не убить файл при краше
    let tmp = file.with_extension("json.tmp");
    fs::write(&tmp, json).map_err(|e| e.to_string())?;
    fs::rename(&tmp, file).map_err(|e| e.to_string())
}

#[tauri::command]
fn list_games(lib: State<Library>) -> Vec<Game> {
    lib.games.lock().unwrap().clone()
}

#[tauri::command]
fn add_game(name: String, exe_path: String, lib: State<Library>) -> Result<Game, String> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("Введи название".into());
    }
    let p = Path::new(&exe_path);
    if !p.is_file() {
        return Err("Файл не найден".into());
    }
    let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
    if !["exe", "lnk", "bat", "url"].contains(&ext.as_str()) {
        return Err("Нужен .exe / .lnk / .bat / .url".into());
    }

    let mut games = lib.games.lock().unwrap();
    if games.iter().any(|g| g.exe_path.eq_ignore_ascii_case(&exe_path)) {
        return Err("Эта игра уже в библиотеке".into());
    }
    let game = Game {
        id: format!("{:x}", now() * 1000 + games.len() as u64),
        name,
        exe_path,
        playtime_sec: 0,
        last_played: None,
        launches: 0,
        added_at: now(),
    };
    games.push(game.clone());
    save(&lib.file, &games)?;
    Ok(game)
}

#[tauri::command]
fn remove_game(id: String, lib: State<Library>) -> Result<(), String> {
    let mut games = lib.games.lock().unwrap();
    games.retain(|g| g.id != id);
    save(&lib.file, &games)
}

#[tauri::command]
fn rename_game(id: String, name: String, lib: State<Library>) -> Result<(), String> {
    let mut games = lib.games.lock().unwrap();
    let g = games.iter_mut().find(|g| g.id == id).ok_or("Игра не найдена")?;
    g.name = name.trim().to_string();
    save(&lib.file, &games)
}

// запускаем игру и ждём выход в отдельном потоке, чтобы UI не висел
#[tauri::command]
fn launch_game(id: String, app: AppHandle, lib: State<Library>) -> Result<(), String> {
    let exe = {
        let games = lib.games.lock().unwrap();
        games.iter().find(|g| g.id == id).ok_or("Игра не найдена")?.exe_path.clone()
    };
    let path = Path::new(&exe);
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();

    // .lnk/.url сами не запускаются — через cmd start (время тогда не ловим точно)
    let mut cmd = if ext == "exe" {
        let mut c = Command::new(path);
        if let Some(dir) = path.parent() {
            c.current_dir(dir); // многие игры ищут файлы рядом с exe
        }
        c
    } else {
        let mut c = Command::new("cmd");
        c.args(["/C", "start", "", exe.as_str()]);
        c
    };
    let mut child = cmd.spawn().map_err(|e| format!("Не запустилось: {e}"))?;

    std::thread::spawn(move || {
        let started = Instant::now();
        let _ = child.wait();
        let secs = started.elapsed().as_secs();

        let lib = app.state::<Library>();
        let mut games = lib.games.lock().unwrap();
        if let Some(g) = games.iter_mut().find(|g| g.id == id) {
            g.playtime_sec += secs;
            g.launches += 1;
            g.last_played = Some(now());
        }
        let _ = save(&lib.file, &games);
        drop(games);
        let _ = app.emit("game-exited", ExitEvent { id, seconds: secs });
    });
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let file = app.path().app_data_dir()?.join("library.json");
            app.manage(Library { games: Mutex::new(load(&file)), file });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_games,
            add_game,
            remove_game,
            rename_game,
            launch_game
        ])
        .run(tauri::generate_context!())
        .expect("Ошибка запуска приложения");
}
