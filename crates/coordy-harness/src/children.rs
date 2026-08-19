use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

static PIDS: OnceLock<Mutex<HashMap<String, u32>>> = OnceLock::new();

fn pids() -> &'static Mutex<HashMap<String, u32>> {
    PIDS.get_or_init(|| Mutex::new(HashMap::new()))
}

pub fn register_child(run_id: &str, pid: u32) {
    if let Ok(mut map) = pids().lock() {
        map.insert(run_id.to_string(), pid);
    }
}

pub fn unregister_child(run_id: &str) {
    if let Ok(mut map) = pids().lock() {
        map.remove(run_id);
    }
}

pub fn kill_child(run_id: &str) -> bool {
    let pid = pids().lock().ok().and_then(|mut map| map.remove(run_id));
    let Some(pid) = pid else {
        return false;
    };
    kill_pid(pid);
    true
}

fn kill_pid(pid: u32) {
    #[cfg(unix)]
    {
        let _ = std::process::Command::new("kill")
            .args(["-TERM", &pid.to_string()])
            .status();
    }
    #[cfg(windows)]
    {
        let _ = std::process::Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .status();
    }
}
