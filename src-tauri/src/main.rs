#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{env, path::{PathBuf, Path}, process::{Child, Command}, sync::Mutex, net::TcpStream};
use tauri::{Manager, WindowEvent};
use tauri::path::BaseDirectory;
mod public;

struct ServerState(Mutex<Option<Child>>);

fn resolve_server_dir(app: &tauri::App) -> PathBuf {
  // In production, resolve resources/server/** via PathResolver
  let candidate = app.path().resolve("server", BaseDirectory::Resource);
  if let Ok(path) = candidate {
    if path.exists() { return path; }
  }
  // In dev, project root ../server
  PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("server")
}

fn find_vendor_browser(server_dir: &Path) -> Option<PathBuf> {
  let vendor = server_dir.join("vendor");
  #[cfg(target_os = "macos")]
  {
    let cands = [
      vendor.join("Google Chrome.app/Contents/MacOS/Google Chrome"),
      vendor.join("Chromium.app/Contents/MacOS/Chromium"),
      vendor.join("Microsoft Edge.app/Contents/MacOS/Microsoft Edge"),
      vendor.join("Brave Browser.app/Contents/MacOS/Brave Browser"),
    ];
    for p in cands { if p.exists() { return Some(p); } }
  }
  #[cfg(target_os = "windows")]
  {
    let cands = [
      vendor.join("chrome-win\\chrome.exe"),
      vendor.join("chromium-win\\chrome.exe"),
      vendor.join("edge-win\\msedge.exe"),
      vendor.join("brave-win\\brave.exe"),
    ];
    for p in cands { if p.exists() { return Some(p); } }
  }
  #[cfg(target_os = "linux")]
  {
    let cands = [
      vendor.join("chrome-linux/chrome"),
      vendor.join("chromium-linux/chromium"),
      vendor.join("edge-linux/microsoft-edge"),
      vendor.join("brave-linux/brave-browser"),
    ];
    for p in cands { if p.exists() { return Some(p); } }
  }
  None
}

fn spawn_backend(server_dir: &Path) -> Option<Child> {
  // If port already in use (dev server running), skip spawning
  let port = env::var("PORT").ok().and_then(|p| p.parse::<u16>().ok()).unwrap_or(4000);
  if TcpStream::connect(("127.0.0.1", port)).is_ok() || TcpStream::connect(("::1", port)).is_ok() {
    return None;
  }
  let mut cmd = Command::new("node");
  cmd.current_dir(server_dir);
  cmd.arg("index.js");
  // inherit env; CHROME_PATH set by caller when available
  // optional: set PORT if you want override
  match cmd.spawn() {
    Ok(child) => Some(child),
    Err(_) => None,
  }
}

fn main() {
  tauri::Builder::default()
    .manage(ServerState(Mutex::new(None)))
    .invoke_handler(tauri::generate_handler![public::verify_license, public::get_hwid])
    .setup(|app| {
      let server_dir = resolve_server_dir(app);
      if let Some(vendor_browser) = find_vendor_browser(&server_dir) {
        if let Some(pstr) = vendor_browser.to_str() {
          env::set_var("CHROME_PATH", pstr);
        }
      }
      // spawn backend (avoid duplicate during dev if already running)
      if let Some(child) = spawn_backend(&server_dir) {
        let st = app.state::<ServerState>();
        *st.0.lock().unwrap() = Some(child);
      }
      Ok(())
    })
    .on_window_event(|win, e| {
      if let WindowEvent::CloseRequested { api, .. } = e {
        // graceful shutdown backend
        let app = win.app_handle();
        let st = app.state::<ServerState>();
        if let Some(mut child) = st.0.lock().unwrap().take() {
          let _ = child.kill();
        }
        api.prevent_close();
        app.exit(0);
      }
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}