import os
import json
import hashlib
import threading
import time
from abc import ABC, abstractmethod
from typing import Optional, Dict, List, Any

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data')

_FR_UNITS = [
    "zero", "un", "deux", "trois", "quatre", "cinq", "six", "sept",
    "huit", "neuf", "dix", "onze", "douze", "treize", "quatorze",
    "quinze", "seize", "dix-sept", "dix-huit", "dix-neuf"
]
_FR_TENS = [
    "", "", "vingt", "trente", "quarante", "cinquante",
    "soixante", "soixante", "quatre-vingt", "quatre-vingt"
]

def _number_to_french(n: int) -> str:
    if n < 0 or n > 100:
        return str(n)
    if n == 100:
        return "cent"
    if n < 20:
        return _FR_UNITS[n]
    tens = n // 10
    units = n % 10
    if tens in (7, 9):
        base = _FR_TENS[tens]
        remainder = (10 if tens == 7 else 10) + units
        if remainder == 11:
            return f"{base} et onze" if tens == 7 else f"{base}-onze"
        return f"{base}-{_FR_UNITS[remainder]}"
    if units == 0:
        if tens == 8:
            return "quatre-vingts"
        return _FR_TENS[tens]
    if units == 1 and tens in (2, 3, 4, 5, 6):
        return f"{_FR_TENS[tens]} et un"
    return f"{_FR_TENS[tens]}-{_FR_UNITS[units]}"
AUDIO_DIR = os.path.join(DATA_DIR, 'audio')
CONFIG_PATH = os.path.join(DATA_DIR, 'audio_config.json')

SUPPORTED_LANGUAGES = [
    {"id": "fr-FR", "name": "Francais (France)"},
    {"id": "fr-CA", "name": "Francais (Canada)"},
    {"id": "en-US", "name": "English (US)"},
    {"id": "en-GB", "name": "English (UK)"},
    {"id": "es-ES", "name": "Espanol (Espana)"},
    {"id": "de-DE", "name": "Deutsch"},
    {"id": "it-IT", "name": "Italiano"},
    {"id": "pt-BR", "name": "Portugues (Brasil)"},
    {"id": "nl-NL", "name": "Nederlands"},
    {"id": "ja-JP", "name": "Nihongo"},
    {"id": "ko-KR", "name": "Hangugeo"},
    {"id": "zh-CN", "name": "Zhongwen"},
    {"id": "ar-SA", "name": "Arabiy"},
]

OPENAI_MODELS = [
    {"id": "gpt-4o-mini-tts", "name": "GPT-4o Mini TTS"},
    {"id": "tts-1", "name": "TTS-1"},
    {"id": "tts-1-hd", "name": "TTS-1 HD"},
]

ELEVENLABS_MODELS = [
    {"id": "eleven_v3", "name": "Eleven v3"},
    {"id": "eleven_multilingual_v2", "name": "Eleven Multilingual v2"},
    {"id": "eleven_flash_v2_5", "name": "Eleven Flash v2.5"},
]

DEFAULT_CONFIG = {
    "provider": "openai",
    "language": "fr-FR",
    "providers": {
        "openai": {
            "api_key": "",
            "model": "tts-1",
            "voice": "alloy",
            "speed": 1.0
        },
        "elevenlabs": {
            "api_key": "",
            "voice_id": "",
            "model_id": "eleven_multilingual_v2",
            "stability": 0.5,
            "similarity_boost": 0.75
        },
        "azure": {
            "api_key": "",
            "region": "westeurope",
            "voice_name": "fr-FR-DeniseNeural"
        }
    },
    "number_range": {"start": 0, "end": 100},
    "texts": {
        "words": {
            "question_numero": "Question numero",
            "sur": "sur",
            "vous_avez": "Vous avez",
            "secondes": "secondes",
            "la_bonne_reponse_etait": "La bonne reponse etait",
            "les_gagnants_sont": "Les gagnants sont",
            "le_gagnant_est": "Le gagnant est",
            "aucun_gagnant": "Aucun gagnant pour cette question",
            "le_plus_rapide": "Le joueur le plus rapide est",
            "et": "et",
            "autres_joueurs": "autres joueurs",
            "prochaine_question_dans": "Prochaine question dans",
            "felicitations": "Felicitations",
            "nous_avons": "Nous avons",
            "gagnants": "gagnants",
            "top_cest_parti": "Top, c'est parti!"
        },
        "phrases": {
            "intro": "Le quiz commence! Bonne chance a tous!",
            "transition": "Prochain questionnaire",
            "fin": "Fin du quiz! Merci d'avoir joue!",
            "fin_gagnant": "Fin du quiz! Le grand gagnant est",
            "x2_open": "Attention! C'est le moment du double ou rien! Tapez X2 dans le chat pour tenter de doubler vos points!",
            "x2_nobody": "Personne n'a tente le double ou rien. On continue!",
            "x2_registered": "Nous avons",
            "x2_registered_suffix": "joueurs qui tentent",
            "x2_registered_suffix2": "le double ou rien!",
            "x2_success": "Bravo aux joueurs qui ont reussi le double ou rien! Leurs points sont doubles!",
            "x2_fail": "Dommage! Les joueurs du double ou rien ont perdu leurs points sur cette question!"
        }
    },
    "text_hashes": {},
    "generation_status": {
        "numbers": {"generated": False, "count": 0, "last_generated": None},
        "words": {"generated": False, "count": 0, "last_generated": None},
        "phrases": {"generated": False, "count": 0, "last_generated": None}
    }
}


class TTSProvider(ABC):
    @abstractmethod
    def generate(self, text: str, output_path: str) -> bool:
        pass

    @abstractmethod
    def test_connection(self) -> Dict[str, Any]:
        pass

    @abstractmethod
    def get_available_voices(self) -> List[Dict[str, str]]:
        pass


class OpenAITTSProvider(TTSProvider):
    def __init__(self, config: dict, language: str = "fr-FR"):
        cfg_key = (config.get("api_key") or "").strip()
        self.api_key = cfg_key or (os.getenv("OPENAI_API_KEY") or "").strip()
        self.model = config.get("model", "tts-1")
        self.voice = config.get("voice", "alloy")
        self.speed = config.get("speed", 1.0)
        self.language = language

    def _log_prefix(self) -> str:
        return f"[TTS] provider=openai model={self.model} voice={self.voice} lang={self.language} speed={self.speed}"

    def generate(self, text: str, output_path: str) -> bool:
        try:
            import requests
            print(f"{self._log_prefix()} output={output_path}")
            response = requests.post(
                "https://api.openai.com/v1/audio/speech",
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json"
                },
                json={
                    "model": self.model,
                    "input": text,
                    "voice": self.voice,
                    "speed": self.speed,
                    "response_format": "mp3"
                },
                timeout=30
            )
            if response.status_code == 200:
                os.makedirs(os.path.dirname(output_path), exist_ok=True)
                with open(output_path, 'wb') as f:
                    f.write(response.content)
                size = os.path.getsize(output_path)
                print(f"[TTS] openai generated: {output_path} ({size} bytes)")
                return size > 0
            print(f"[TTS] openai error {response.status_code}: {response.text[:200]}")
            return False
        except Exception as e:
            print(f"[TTS] openai generate error: {e}")
            return False

    def test_connection(self) -> Dict[str, Any]:
        if not self.api_key:
            return {"success": False, "message": "Cle API OpenAI manquante"}
        try:
            import requests
            print(f"{self._log_prefix()} TEST")
            response = requests.post(
                "https://api.openai.com/v1/audio/speech",
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json"
                },
                json={
                    "model": self.model,
                    "input": "test",
                    "voice": self.voice,
                    "response_format": "mp3"
                },
                timeout=15
            )
            if response.status_code == 200:
                return {"success": True, "message": f"OpenAI OK (model={self.model}, voice={self.voice})"}
            return {"success": False, "message": f"Erreur {response.status_code}: {response.text[:100]}"}
        except Exception as e:
            return {"success": False, "message": str(e)}

    def get_available_voices(self) -> List[Dict[str, str]]:
        return [
            {"id": "alloy", "name": "Alloy"},
            {"id": "ash", "name": "Ash"},
            {"id": "ballad", "name": "Ballad"},
            {"id": "coral", "name": "Coral"},
            {"id": "echo", "name": "Echo"},
            {"id": "fable", "name": "Fable"},
            {"id": "onyx", "name": "Onyx"},
            {"id": "nova", "name": "Nova"},
            {"id": "sage", "name": "Sage"},
            {"id": "shimmer", "name": "Shimmer"}
        ]


class ElevenLabsTTSProvider(TTSProvider):
    def __init__(self, config: dict, language: str = "fr-FR"):
        self.api_key = config.get("api_key", "")
        self.voice_id = config.get("voice_id", "")
        self.model_id = config.get("model_id", "eleven_multilingual_v2")
        self.stability = config.get("stability", 0.5)
        self.similarity_boost = config.get("similarity_boost", 0.75)
        self.language = language

    def _log_prefix(self) -> str:
        return f"[TTS] provider=elevenlabs model={self.model_id} voice={self.voice_id} lang={self.language}"

    def generate(self, text: str, output_path: str) -> bool:
        if not self.voice_id:
            print(f"{self._log_prefix()} ERROR: voice_id manquant")
            return False
        try:
            import requests
            print(f"{self._log_prefix()} output={output_path}")
            response = requests.post(
                f"https://api.elevenlabs.io/v1/text-to-speech/{self.voice_id}",
                headers={
                    "xi-api-key": self.api_key,
                    "Content-Type": "application/json",
                    "Accept": "audio/mpeg"
                },
                json={
                    "text": text,
                    "model_id": self.model_id,
                    "voice_settings": {
                        "stability": self.stability,
                        "similarity_boost": self.similarity_boost
                    }
                },
                timeout=30
            )
            if response.status_code == 200:
                os.makedirs(os.path.dirname(output_path), exist_ok=True)
                with open(output_path, 'wb') as f:
                    f.write(response.content)
                size = os.path.getsize(output_path)
                print(f"[TTS] elevenlabs generated: {output_path} ({size} bytes)")
                return size > 0
            print(f"[TTS] elevenlabs error {response.status_code}: {response.text[:200]}")
            return False
        except Exception as e:
            print(f"[TTS] elevenlabs generate error: {e}")
            return False

    def test_connection(self) -> Dict[str, Any]:
        if not self.api_key:
            return {"success": False, "message": "Cle API ElevenLabs manquante"}
        try:
            import requests
            print(f"{self._log_prefix()} TEST")
            response = requests.get(
                "https://api.elevenlabs.io/v1/voices",
                headers={"xi-api-key": self.api_key},
                timeout=15
            )
            if response.status_code == 200:
                return {"success": True, "message": f"ElevenLabs OK (model={self.model_id})"}
            return {"success": False, "message": f"Erreur {response.status_code}"}
        except Exception as e:
            return {"success": False, "message": str(e)}

    def get_available_voices(self) -> List[Dict[str, str]]:
        if not self.api_key:
            return []
        try:
            import requests
            response = requests.get(
                "https://api.elevenlabs.io/v1/voices",
                headers={"xi-api-key": self.api_key},
                timeout=15
            )
            if response.status_code == 200:
                data = response.json()
                return [
                    {"id": v["voice_id"], "name": v.get("name", v["voice_id"])}
                    for v in data.get("voices", [])
                ]
        except Exception:
            pass
        return []


class AzureTTSProvider(TTSProvider):
    VOICES_BY_LANG = {
        "fr-FR": [
            {"id": "fr-FR-DeniseNeural", "name": "Denise (FR)"},
            {"id": "fr-FR-HenriNeural", "name": "Henri (FR)"},
            {"id": "fr-FR-EloiseNeural", "name": "Eloise (FR)"},
            {"id": "fr-FR-RemyMultilingualNeural", "name": "Remy Multilingual (FR)"},
        ],
        "fr-CA": [
            {"id": "fr-CA-SylvieNeural", "name": "Sylvie (CA)"},
            {"id": "fr-CA-JeanNeural", "name": "Jean (CA)"},
            {"id": "fr-CA-AntoineNeural", "name": "Antoine (CA)"},
        ],
        "en-US": [
            {"id": "en-US-JennyNeural", "name": "Jenny (US)"},
            {"id": "en-US-GuyNeural", "name": "Guy (US)"},
            {"id": "en-US-AriaNeural", "name": "Aria (US)"},
        ],
        "en-GB": [
            {"id": "en-GB-SoniaNeural", "name": "Sonia (GB)"},
            {"id": "en-GB-RyanNeural", "name": "Ryan (GB)"},
        ],
        "es-ES": [
            {"id": "es-ES-ElviraNeural", "name": "Elvira (ES)"},
            {"id": "es-ES-AlvaroNeural", "name": "Alvaro (ES)"},
        ],
        "de-DE": [
            {"id": "de-DE-KatjaNeural", "name": "Katja (DE)"},
            {"id": "de-DE-ConradNeural", "name": "Conrad (DE)"},
        ],
        "it-IT": [
            {"id": "it-IT-ElsaNeural", "name": "Elsa (IT)"},
            {"id": "it-IT-DiegoNeural", "name": "Diego (IT)"},
        ],
    }

    def __init__(self, config: dict, language: str = "fr-FR"):
        self.api_key = config.get("api_key", "")
        self.region = config.get("region", "westeurope")
        self.voice_name = config.get("voice_name", "fr-FR-DeniseNeural")
        self.language = language

    def _log_prefix(self) -> str:
        return f"[TTS] provider=azure voice={self.voice_name} region={self.region} lang={self.language}"

    def _validate_voice_language(self) -> Optional[str]:
        voice_lang = self.voice_name.split("-")[0] + "-" + self.voice_name.split("-")[1] if "-" in self.voice_name else ""
        config_lang = self.language.split("-")[0] if self.language else ""
        voice_base = voice_lang.split("-")[0] if voice_lang else ""
        if config_lang and voice_base and config_lang != voice_base:
            return f"Langue incompatible: voix {self.voice_name} ({voice_lang}) mais langue configuree {self.language}"
        return None

    def generate(self, text: str, output_path: str) -> bool:
        lang_error = self._validate_voice_language()
        if lang_error:
            print(f"{self._log_prefix()} ERROR: {lang_error}")
            return False
        try:
            import requests
            print(f"{self._log_prefix()} output={output_path}")
            token_url = f"https://{self.region}.api.cognitive.microsoft.com/sts/v1.0/issueToken"
            token_resp = requests.post(
                token_url,
                headers={"Ocp-Apim-Subscription-Key": self.api_key},
                timeout=10
            )
            if token_resp.status_code != 200:
                print(f"[TTS] azure token error {token_resp.status_code}")
                return False

            voice_lang = self.voice_name.split("-")[0] + "-" + self.voice_name.split("-")[1] if "-" in self.voice_name else "fr-FR"
            token = token_resp.text
            ssml_text = text.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;').replace('"', '&quot;')
            ssml = (
                f'<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis"'
                f' xmlns:mstts="http://www.w3.org/2001/mstts" xml:lang="{voice_lang}">'
                f'<voice name="{self.voice_name}">'
                f'<lang xml:lang="{voice_lang}">{ssml_text}</lang>'
                f'</voice></speak>'
            )
            tts_url = f"https://{self.region}.tts.speech.microsoft.com/cognitiveservices/v1"
            response = requests.post(
                tts_url,
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/ssml+xml",
                    "X-Microsoft-OutputFormat": "audio-16khz-128kbitrate-mono-mp3"
                },
                data=ssml.encode('utf-8'),
                timeout=30
            )
            if response.status_code == 200:
                os.makedirs(os.path.dirname(output_path), exist_ok=True)
                with open(output_path, 'wb') as f:
                    f.write(response.content)
                size = os.path.getsize(output_path)
                print(f"[TTS] azure generated: {output_path} ({size} bytes)")
                return size > 0
            print(f"[TTS] azure error {response.status_code}")
            return False
        except Exception as e:
            print(f"[TTS] azure generate error: {e}")
            return False

    def test_connection(self) -> Dict[str, Any]:
        if not self.api_key:
            return {"success": False, "message": "Cle API Azure manquante"}
        lang_error = self._validate_voice_language()
        if lang_error:
            return {"success": False, "message": lang_error}
        try:
            import requests
            print(f"{self._log_prefix()} TEST")
            url = f"https://{self.region}.api.cognitive.microsoft.com/sts/v1.0/issueToken"
            response = requests.post(
                url,
                headers={"Ocp-Apim-Subscription-Key": self.api_key},
                timeout=10
            )
            if response.status_code == 200:
                return {"success": True, "message": f"Azure OK (voice={self.voice_name}, region={self.region})"}
            return {"success": False, "message": f"Erreur {response.status_code}"}
        except Exception as e:
            return {"success": False, "message": str(e)}

    def get_available_voices(self) -> List[Dict[str, str]]:
        lang_prefix = self.language.split("-")[0] if self.language else "fr"
        voices = []
        for lang_key, lang_voices in self.VOICES_BY_LANG.items():
            if lang_key.startswith(lang_prefix):
                voices.extend(lang_voices)
        if not voices:
            for lang_voices in self.VOICES_BY_LANG.values():
                voices.extend(lang_voices)
        return voices


PROVIDER_MAP = {
    "openai": OpenAITTSProvider,
    "elevenlabs": ElevenLabsTTSProvider,
    "azure": AzureTTSProvider,
}


class AudioService:
    def __init__(self):
        self._lock = threading.Lock()
        self._config = None
        self._generation_jobs: Dict[str, Dict] = {}
        self._load_config()

    def _load_config(self):
        if os.path.exists(CONFIG_PATH):
            try:
                with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
                    self._config = json.load(f)
                if "language" not in self._config:
                    self._config["language"] = DEFAULT_CONFIG["language"]
                    self._save_config()
                print(f"[AudioService] Config loaded from {CONFIG_PATH}")
            except (json.JSONDecodeError, IOError) as e:
                print(f"[AudioService] Error loading config: {e}")
                self._config = json.loads(json.dumps(DEFAULT_CONFIG))
        else:
            self._config = json.loads(json.dumps(DEFAULT_CONFIG))
            self._save_config()
            print("[AudioService] Created default config")

    def _save_config(self):
        os.makedirs(os.path.dirname(CONFIG_PATH), exist_ok=True)
        with open(CONFIG_PATH, 'w', encoding='utf-8') as f:
            json.dump(self._config, f, indent=2, ensure_ascii=False)

    def _ensure_dirs(self):
        dirs = [
            os.path.join(AUDIO_DIR, 'system', 'numbers'),
            os.path.join(AUDIO_DIR, 'system', 'words'),
            os.path.join(AUDIO_DIR, 'system', 'phrases'),
            os.path.join(AUDIO_DIR, 'questionnaires'),
        ]
        for d in dirs:
            os.makedirs(d, exist_ok=True)

    def _generation_hash(self, text: str) -> str:
        provider = self._config.get("provider", "openai")
        language = self._config.get("language", "fr-FR")
        pcfg = self._config.get("providers", {}).get(provider, {})
        voice = pcfg.get("voice") or pcfg.get("voice_id") or pcfg.get("voice_name") or ""
        model = pcfg.get("model") or pcfg.get("model_id") or ""
        composite = f"{text}|{provider}|{voice}|{model}|{language}"
        return hashlib.md5(composite.encode('utf-8')).hexdigest()

    def _audio_path(self, category: str, key: str) -> str:
        if category == "numbers":
            return os.path.join(AUDIO_DIR, 'system', 'numbers', f'{key}.mp3')
        elif category == "words":
            return os.path.join(AUDIO_DIR, 'system', 'words', f'{key}.mp3')
        elif category == "phrases":
            return os.path.join(AUDIO_DIR, 'system', 'phrases', f'{key}.mp3')
        elif category.startswith("questionnaire_"):
            qn_id = category.replace("questionnaire_", "")
            return os.path.join(AUDIO_DIR, 'questionnaires', qn_id, f'{key}.mp3')
        return os.path.join(AUDIO_DIR, f'{category}', f'{key}.mp3')

    def audio_exists(self, category: str, key: str) -> bool:
        return os.path.exists(self._audio_path(category, key))

    def get_config(self) -> dict:
        with self._lock:
            safe = json.loads(json.dumps(self._config))
            for pname, pcfg in safe.get("providers", {}).items():
                if "api_key" in pcfg and pcfg["api_key"]:
                    k = pcfg["api_key"]
                    pcfg["api_key"] = k[:4] + "..." + k[-4:] if len(k) > 8 else "***"
            return safe

    def get_raw_config(self) -> dict:
        with self._lock:
            return json.loads(json.dumps(self._config))

    def update_config(self, data: dict) -> dict:
        with self._lock:
            if "provider" in data:
                old_provider = self._config.get("provider", "openai")
                new_provider = data["provider"]
                if new_provider not in PROVIDER_MAP:
                    print(f"[AudioService] update_config: REJECTED unknown provider '{new_provider}'")
                else:
                    self._config["provider"] = new_provider
                    print(f"[AudioService] update_config: provider '{old_provider}' -> '{new_provider}'")

            if "language" in data and data["language"]:
                old_lang = self._config.get("language", "fr-FR")
                self._config["language"] = data["language"]
                print(f"[AudioService] update_config: language '{old_lang}' -> '{data['language']}'")

            if "number_range" in data:
                self._config["number_range"] = data["number_range"]
            if "texts" in data:
                for cat in ("words", "phrases"):
                    if cat in data["texts"]:
                        if "texts" not in self._config:
                            self._config["texts"] = {}
                        if cat not in self._config["texts"]:
                            self._config["texts"][cat] = {}
                        self._config["texts"][cat].update(data["texts"][cat])
            if "providers" in data:
                if "providers" not in self._config:
                    self._config["providers"] = {}
                for pname, pcfg in data["providers"].items():
                    if pname not in self._config["providers"]:
                        self._config["providers"][pname] = {}
                    for k, v in pcfg.items():
                        if k == "api_key" and ("..." in str(v) or v == "***"):
                            continue
                        if isinstance(v, str) and v == "" and k in ("voice", "voice_id", "voice_name", "model", "model_id"):
                            continue
                        self._config["providers"][pname][k] = v
            self._save_config()
            return self.get_config()

    def set_api_key(self, provider: str, api_key: str) -> bool:
        with self._lock:
            if provider not in self._config.get("providers", {}):
                return False
            self._config["providers"][provider]["api_key"] = api_key
            self._save_config()
            return True

    def get_provider(self, provider_name: str = None) -> Optional[TTSProvider]:
        name = provider_name or self._config.get("provider", "openai")
        provider_cls = PROVIDER_MAP.get(name)
        if not provider_cls:
            print(f"[AudioService] get_provider: UNKNOWN provider '{name}' (available: {list(PROVIDER_MAP.keys())})")
            return None
        provider_config = self._config.get("providers", {}).get(name, {})
        language = self._config.get("language", "fr-FR")
        print(f"[AudioService] get_provider: provider='{name}' lang='{language}'")
        return provider_cls(provider_config, language=language)

    def test_provider(self, provider_name: str) -> Dict[str, Any]:
        provider = self.get_provider(provider_name)
        if not provider:
            return {"success": False, "message": f"Provider inconnu: {provider_name}"}
        return provider.test_connection()

    def get_voices(self, provider_name: str = None) -> List[Dict[str, str]]:
        provider = self.get_provider(provider_name)
        if not provider:
            return []
        return provider.get_available_voices()

    def get_models(self, provider_name: str = None) -> List[Dict[str, str]]:
        name = provider_name or self._config.get("provider", "openai")
        if name == "openai":
            return OPENAI_MODELS
        elif name == "elevenlabs":
            return ELEVENLABS_MODELS
        elif name == "azure":
            return [{"id": "azure-cognitive", "name": "Azure Cognitive Services"}]
        return []

    def get_languages(self) -> List[Dict[str, str]]:
        return SUPPORTED_LANGUAGES

    def _is_cached(self, category: str, key: str, text: str) -> bool:
        path = self._audio_path(category, key)
        if not os.path.exists(path):
            return False
        hashes = self._config.get("text_hashes", {})
        stored_hash = hashes.get(f"{category}/{key}")
        return stored_hash == self._generation_hash(text)

    def _mark_generated(self, category: str, key: str, text: str):
        if "text_hashes" not in self._config:
            self._config["text_hashes"] = {}
        self._config["text_hashes"][f"{category}/{key}"] = self._generation_hash(text)

    def generate_single(self, category: str, key: str, text: str, force: bool = False) -> Dict[str, Any]:
        if not force and self._is_cached(category, key, text):
            return {"status": "cached", "key": key}

        self._ensure_dirs()
        provider = self.get_provider()
        if not provider:
            return {"status": "error", "key": key, "message": "Aucun provider configure"}

        path = self._audio_path(category, key)
        success = provider.generate(text, path)

        if success:
            with self._lock:
                self._mark_generated(category, key, text)
                self._save_config()
            return {"status": "generated", "key": key}

        return {"status": "error", "key": key, "message": "Echec de generation"}

    def _run_generation(self, category: str, items: Dict[str, str], job_id: str = None, force: bool = False) -> Dict[str, Any]:
        self._ensure_dirs()
        total = len(items)
        generated = 0
        cached = 0
        errors = 0
        error_messages = []

        provider_name = self._config.get("provider", "openai")
        language = self._config.get("language", "fr-FR")
        provider = self.get_provider()
        if not provider:
            msg = f"Aucun provider configure (provider={provider_name})"
            print(f"[AudioService] generate_{category} FAILED: {msg}")
            return {"status": "error", "message": msg}

        print(f"[AudioService] generate_{category} START: provider={provider_name}, lang={language}, total={total}, force={force}")

        if job_id:
            self._generation_jobs[job_id]["total"] = total

        for idx, (key, text) in enumerate(items.items()):
            if job_id and self._generation_jobs.get(job_id, {}).get("cancelled"):
                print(f"[AudioService] generate_{category} CANCELLED at {idx}/{total}")
                break

            if not force and self._is_cached(category, key, text):
                cached += 1
            else:
                path = self._audio_path(category, key)
                try:
                    success = provider.generate(text, path)
                except Exception as e:
                    print(f"[AudioService] EXCEPTION generating {category}/{key}: {e}")
                    success = False
                    error_messages.append(f"{category}_{key}: {e}")

                if success:
                    if os.path.exists(path) and os.path.getsize(path) > 0:
                        with self._lock:
                            self._mark_generated(category, key, text)
                        generated += 1
                    else:
                        errors += 1
                        msg = f"{category}_{key}: file missing or empty after generate"
                        print(f"[AudioService] {msg}")
                        error_messages.append(msg)
                else:
                    errors += 1
                    msg = f"{category}_{key}: provider returned False"
                    print(f"[AudioService] {msg}")
                    error_messages.append(msg)

                if errors >= 5 and generated == 0 and cached == 0:
                    msg = f"Arret apres {errors} erreurs consecutives sans succes"
                    print(f"[AudioService] generate_{category} ABORT: {msg}")
                    error_messages.append(msg)
                    break

            if job_id:
                progress = int(((idx + 1) / total) * 100) if total > 0 else 0
                self._generation_jobs[job_id].update({
                    "progress": progress,
                    "generated": generated,
                    "cached": cached,
                    "errors": errors,
                    "total": total
                })

            time.sleep(0.05)

        with self._lock:
            self._config.setdefault("generation_status", {})[category] = {
                "generated": (generated + cached) > 0,
                "count": generated + cached,
                "last_generated": time.strftime('%Y-%m-%d %H:%M:%S')
            }
            self._save_config()

        final_status = "completed" if generated + cached > 0 else ("error" if errors > 0 else "completed")
        result = {
            "status": final_status,
            "total": total,
            "generated": generated,
            "cached": cached,
            "errors": errors
        }
        if error_messages:
            result["error_details"] = error_messages[:10]
            result["message"] = f"{errors} erreur(s) sur {total}"
        print(f"[AudioService] generate_{category} END: {result['status']} - generated={generated}, cached={cached}, errors={errors}")
        return result

    def generate_numbers(self, job_id: str = None, force: bool = False) -> Dict[str, Any]:
        nr = self._config.get("number_range", {"start": 0, "end": 100})
        start = nr.get("start", 0)
        end = nr.get("end", 100)
        items = {str(i): _number_to_french(i) for i in range(start, end + 1)}
        return self._run_generation("numbers", items, job_id=job_id, force=force)

    def generate_words(self, job_id: str = None, force: bool = False) -> Dict[str, Any]:
        words = self._config.get("texts", {}).get("words", {})
        return self._run_generation("words", words, job_id=job_id, force=force)

    def generate_phrases(self, job_id: str = None, force: bool = False) -> Dict[str, Any]:
        phrases = self._config.get("texts", {}).get("phrases", {})
        return self._run_generation("phrases", phrases, job_id=job_id, force=force)

    def start_generation_job(self, category: str, force: bool = False) -> str:
        job_id = f"{category}_{int(time.time())}"
        provider_name = self._config.get("provider", "openai")
        language = self._config.get("language", "fr-FR")
        self._generation_jobs[job_id] = {
            "category": category,
            "status": "running",
            "progress": 0,
            "generated": 0,
            "cached": 0,
            "errors": 0,
            "total": 0,
            "cancelled": False,
            "provider": provider_name,
            "language": language,
            "started_at": time.strftime('%Y-%m-%d %H:%M:%S'),
            "message": ""
        }

        print(f"[AudioService] JOB CREATED: {job_id} category={category} provider={provider_name} lang={language} force={force}")

        def run():
            try:
                if category == "numbers":
                    result = self.generate_numbers(job_id=job_id, force=force)
                elif category == "words":
                    result = self.generate_words(job_id=job_id, force=force)
                elif category == "phrases":
                    result = self.generate_phrases(job_id=job_id, force=force)
                else:
                    result = {"status": "error", "message": f"Categorie inconnue: {category}"}

                final_status = result.get("status", "completed")
                job = self._generation_jobs[job_id]
                job["status"] = final_status
                job["generated"] = result.get("generated", job.get("generated", 0))
                job["cached"] = result.get("cached", job.get("cached", 0))
                job["errors"] = result.get("errors", job.get("errors", 0))
                job["total"] = result.get("total", job.get("total", 0))

                if final_status == "error":
                    job["message"] = result.get("message", "Erreur inconnue")
                elif final_status == "completed":
                    job["progress"] = 100

                job["finished_at"] = time.strftime('%Y-%m-%d %H:%M:%S')
                print(f"[AudioService] JOB FINISHED: {job_id} status={final_status} generated={job['generated']} cached={job['cached']} errors={job['errors']}")

            except Exception as e:
                print(f"[AudioService] JOB EXCEPTION: {job_id} {e}")
                self._generation_jobs[job_id]["status"] = "error"
                self._generation_jobs[job_id]["message"] = str(e)
                self._generation_jobs[job_id]["finished_at"] = time.strftime('%Y-%m-%d %H:%M:%S')

        thread = threading.Thread(target=run, daemon=True)
        thread.start()
        return job_id

    def cancel_job(self, job_id: str) -> bool:
        if job_id in self._generation_jobs:
            self._generation_jobs[job_id]["cancelled"] = True
            return True
        return False

    def get_job_status(self, job_id: str) -> Optional[Dict]:
        return self._generation_jobs.get(job_id)

    def get_all_jobs(self) -> Dict[str, Dict]:
        return dict(self._generation_jobs)

    def get_generation_status(self) -> Dict[str, Any]:
        status = {}
        nr = self._config.get("number_range", {"start": 0, "end": 100})
        total_numbers = nr.get("end", 100) - nr.get("start", 0) + 1
        existing_numbers = 0
        for i in range(nr.get("start", 0), nr.get("end", 100) + 1):
            if os.path.exists(self._audio_path("numbers", str(i))):
                existing_numbers += 1

        status["numbers"] = {
            "total": total_numbers,
            "existing": existing_numbers,
            "complete": existing_numbers == total_numbers,
            **self._config.get("generation_status", {}).get("numbers", {})
        }

        words = self._config.get("texts", {}).get("words", {})
        existing_words = sum(1 for k in words if os.path.exists(self._audio_path("words", k)))
        status["words"] = {
            "total": len(words),
            "existing": existing_words,
            "complete": existing_words == len(words),
            **self._config.get("generation_status", {}).get("words", {})
        }

        phrases = self._config.get("texts", {}).get("phrases", {})
        existing_phrases = sum(1 for k in phrases if os.path.exists(self._audio_path("phrases", k)))
        status["phrases"] = {
            "total": len(phrases),
            "existing": existing_phrases,
            "complete": existing_phrases == len(phrases),
            **self._config.get("generation_status", {}).get("phrases", {})
        }

        return status

    def get_modified_texts(self) -> Dict[str, List[str]]:
        modified = {"words": [], "phrases": []}
        hashes = self._config.get("text_hashes", {})

        for cat in ("words", "phrases"):
            texts = self._config.get("texts", {}).get(cat, {})
            for key, text in texts.items():
                hash_key = f"{cat}/{key}"
                stored = hashes.get(hash_key)
                current = self._generation_hash(text)
                if stored and stored != current:
                    modified[cat].append(key)
                elif not stored and not os.path.exists(self._audio_path(cat, key)):
                    modified[cat].append(key)

        return modified

    def get_audio_file_path(self, relative_path: str) -> Optional[str]:
        full = os.path.join(AUDIO_DIR, relative_path)
        if os.path.exists(full) and os.path.isfile(full):
            return full
        return None

    def list_audio_files(self) -> Dict[str, List[str]]:
        result = {"numbers": [], "words": [], "phrases": []}
        for cat, subdir in [("numbers", "system/numbers"), ("words", "system/words"), ("phrases", "system/phrases")]:
            d = os.path.join(AUDIO_DIR, subdir)
            if os.path.isdir(d):
                result[cat] = sorted([f for f in os.listdir(d) if f.endswith('.mp3')])
        return result

    def delete_category(self, category: str) -> Dict[str, Any]:
        if category == "numbers":
            d = os.path.join(AUDIO_DIR, 'system', 'numbers')
        elif category == "words":
            d = os.path.join(AUDIO_DIR, 'system', 'words')
        elif category == "phrases":
            d = os.path.join(AUDIO_DIR, 'system', 'phrases')
        else:
            return {"success": False, "message": "Categorie inconnue"}

        count = 0
        if os.path.isdir(d):
            for f in os.listdir(d):
                if f.endswith('.mp3'):
                    os.remove(os.path.join(d, f))
                    count += 1

        with self._lock:
            hashes = self._config.get("text_hashes", {})
            to_remove = [k for k in hashes if k.startswith(f"{category}/")]
            for k in to_remove:
                del hashes[k]
            self._config.setdefault("generation_status", {})[category] = {
                "generated": False, "count": 0, "last_generated": None
            }
            self._save_config()

        return {"success": True, "deleted": count}
