const CONFIG_DEFAULTS = {
    overlay: {
        min_result_duration_ms: 5000,
        min_leaderboard_duration_ms: 4000,
        reconnect_delay_ms: 2000,
        max_reconnect_attempts: 10,
        winner_pill_animation_base_delay: 0.6,
        winner_pill_animation_step: 0.08,
        leaderboard_item_animation_step: 0.1
    },
    websocket: {
        host: null,
        port: null
    },
    audio: {
        default_volume: 0.5,
        cooldown_ms: 100
    }
};

let _config = null;

async function loadConfig() {
    if (_config) return _config;

    const urls = ['/config.json', '../config.json'];
    let loaded = false;

    for (const url of urls) {
        try {
            const response = await fetch(url);
            if (response.ok) {
                _config = await response.json();
                console.log(`[Config] Loaded from ${url}`);
                loaded = true;
                break;
            }
        } catch (e) {
            continue;
        }
    }

    if (!loaded) {
        console.warn('[Config] config.json not found, using defaults');
        _config = CONFIG_DEFAULTS;
    }

    return _config;
}

function getConfig(section, key, defaultValue) {
    const cfg = _config || CONFIG_DEFAULTS;
    const sectionData = cfg[section] || {};
    const value = sectionData[key];
    return value !== undefined ? value : defaultValue;
}

function getSection(section) {
    const cfg = _config || CONFIG_DEFAULTS;
    return cfg[section] || CONFIG_DEFAULTS[section] || {};
}

window.GameConfig = { loadConfig, getConfig, getSection };
