import json
import os

_config = None
_config_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'config.json')


def load_config():
    global _config
    if _config is not None:
        return _config

    try:
        with open(_config_path, 'r', encoding='utf-8') as f:
            _config = json.load(f)
        print(f"[Config] Loaded from {os.path.abspath(_config_path)}")
    except FileNotFoundError:
        print(f"[Config] config.json not found at {_config_path}, using defaults")
        _config = {}
    except json.JSONDecodeError as e:
        print(f"[Config] Error parsing config.json: {e}, using defaults")
        _config = {}

    return _config


def get(section, key, default=None):
    cfg = load_config()
    return cfg.get(section, {}).get(key, default)


def get_section(section):
    cfg = load_config()
    return cfg.get(section, {})


def reload():
    global _config
    _config = None
    return load_config()
