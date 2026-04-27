import os
import json
import threading
import time
from typing import Optional, List, Dict, Any

MUSIC_DIR = os.path.join(os.path.dirname(__file__), '..', 'data', 'music')
MUSIC_CONFIG_PATH = os.path.join(MUSIC_DIR, 'music_config.json')

DEFAULT_CONFIG = {
    "enabled": True,
    "volume": 0.4,
    "loop": True,
    "shuffle": False,
    "queue_mode": False,
    "resume_position": True,
    "auto_start": True,
    "auto_stop": True,
    "active_track": None,
    "ducking": {
        "enabled": True,
        "volume_during_speech": 0.08,
        "fade_down_ms": 300,
        "fade_up_ms": 600
    }
}


class MusicService:
    def __init__(self):
        os.makedirs(MUSIC_DIR, exist_ok=True)
        self._config: Dict[str, Any] = {}
        self._lock = threading.Lock()
        self._load_config()

    def _load_config(self):
        if os.path.exists(MUSIC_CONFIG_PATH):
            try:
                with open(MUSIC_CONFIG_PATH, 'r', encoding='utf-8') as f:
                    saved = json.load(f)
                self._config = {**DEFAULT_CONFIG, **saved}
                if 'ducking' in saved:
                    self._config['ducking'] = {**DEFAULT_CONFIG['ducking'], **saved['ducking']}
            except Exception:
                self._config = dict(DEFAULT_CONFIG)
        else:
            self._config = dict(DEFAULT_CONFIG)
            self._save_config()

    def _save_config(self):
        try:
            with open(MUSIC_CONFIG_PATH, 'w', encoding='utf-8') as f:
                json.dump(self._config, f, indent=2, ensure_ascii=False)
        except Exception as e:
            print(f"[Music] Failed to save config: {e}")

    def get_config(self) -> Dict[str, Any]:
        with self._lock:
            return dict(self._config)

    def update_config(self, data: Dict[str, Any]) -> Dict[str, Any]:
        with self._lock:
            allowed = {'enabled', 'volume', 'loop', 'shuffle', 'queue_mode',
                       'resume_position', 'auto_start', 'auto_stop', 'active_track'}
            for k, v in data.items():
                if k in allowed:
                    self._config[k] = v
            if 'ducking' in data and isinstance(data['ducking'], dict):
                ducking_allowed = {'enabled', 'volume_during_speech', 'fade_down_ms', 'fade_up_ms'}
                for k, v in data['ducking'].items():
                    if k in ducking_allowed:
                        self._config['ducking'][k] = v
            self._save_config()
            return dict(self._config)

    def list_tracks(self) -> List[Dict[str, Any]]:
        tracks = []
        try:
            for fname in sorted(os.listdir(MUSIC_DIR)):
                if fname.lower().endswith(('.mp3', '.ogg', '.wav', '.m4a', '.flac')):
                    fpath = os.path.join(MUSIC_DIR, fname)
                    tracks.append({
                        'filename': fname,
                        'size': os.path.getsize(fpath),
                        'active': self._config.get('active_track') == fname
                    })
        except Exception as e:
            print(f"[Music] Error listing tracks: {e}")
        return tracks

    def delete_track(self, filename: str) -> bool:
        safe = os.path.basename(filename)
        fpath = os.path.join(MUSIC_DIR, safe)
        if not os.path.exists(fpath):
            return False
        try:
            os.remove(fpath)
            with self._lock:
                if self._config.get('active_track') == safe:
                    self._config['active_track'] = None
                    self._save_config()
            return True
        except Exception as e:
            print(f"[Music] Error deleting track {safe}: {e}")
            return False

    def set_active_track(self, filename: Optional[str]) -> bool:
        if filename is not None:
            safe = os.path.basename(filename)
            fpath = os.path.join(MUSIC_DIR, safe)
            if not os.path.exists(fpath):
                return False
            with self._lock:
                self._config['active_track'] = safe
                self._save_config()
        else:
            with self._lock:
                self._config['active_track'] = None
                self._save_config()
        return True

    def save_upload(self, filename: str, data: bytes) -> Dict[str, Any]:
        safe = "".join(c if c.isalnum() or c in (' ', '.', '-', '_') else '_' for c in filename)
        safe = safe.strip()
        if not safe:
            safe = f"track_{int(time.time())}.mp3"
        fpath = os.path.join(MUSIC_DIR, safe)
        try:
            with open(fpath, 'wb') as f:
                f.write(data)
            return {'success': True, 'filename': safe, 'size': len(data)}
        except Exception as e:
            return {'success': False, 'message': str(e)}

    def get_track_path(self, filename: str) -> Optional[str]:
        safe = os.path.basename(filename)
        fpath = os.path.join(MUSIC_DIR, safe)
        if os.path.exists(fpath):
            return fpath
        return None

    def get_playback_config(self) -> Dict[str, Any]:
        with self._lock:
            cfg = dict(self._config)
        tracks = self.list_tracks()
        active = cfg.get('active_track')
        if active and not any(t['filename'] == active for t in tracks):
            active = tracks[0]['filename'] if tracks else None
            with self._lock:
                self._config['active_track'] = active
                self._save_config()
            cfg['active_track'] = active
        cfg['tracks'] = tracks
        return cfg
