import re
import json
import os
from typing import Dict, Optional

_DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data')

_EMOJI_RE = re.compile(
    "["
    "\U0001F600-\U0001F64F"
    "\U0001F300-\U0001F5FF"
    "\U0001F680-\U0001F6FF"
    "\U0001F1E0-\U0001F1FF"
    "\U00002702-\U000027B0"
    "\U000024C2-\U0001F251"
    "\U0001F900-\U0001F9FF"
    "\U0001FA00-\U0001FA6F"
    "\U0001FA70-\U0001FAFF"
    "\U00002600-\U000026FF"
    "]+",
    flags=re.UNICODE,
)

_ACRONYM_RE = re.compile(r'\b([A-Z]{2,5})\b')
_CAMEL_RE   = re.compile(r'([a-z])([A-Z])')
_DIGITS_END = re.compile(r'\d+$')
_DIGITS_ANY = re.compile(r'\d+')
_REPEAT_UC  = re.compile(r'([A-Z])\1{2,}')
_SPECIAL_UC = re.compile(r'^[xX_\-\.\*#@!]+|[xX_\-\.\*#@!]+$')
_SPACES     = re.compile(r' {2,}')

_FR_UNITS = [
    'zero', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept',
    'huit', 'neuf', 'dix', 'onze', 'douze', 'treize', 'quatorze',
    'quinze', 'seize', 'dix-sept', 'dix-huit', 'dix-neuf',
]
_FR_TENS = [
    '', '', 'vingt', 'trente', 'quarante', 'cinquante',
    'soixante', 'soixante', 'quatre-vingt', 'quatre-vingt',
]


def _num_fr(n: int) -> str:
    if n < 0:
        return 'moins ' + _num_fr(-n)
    if n >= 1_000_000:
        m = n // 1_000_000
        r = n % 1_000_000
        s = ('un million' if m == 1 else _num_fr(m) + ' millions')
        return (s + ' ' + _num_fr(r)).strip() if r else s
    if n >= 1000:
        k = n // 1000
        r = n % 1000
        s = ('mille' if k == 1 else _num_fr(k) + ' mille')
        return (s + ' ' + _num_fr(r)).strip() if r else s
    if n >= 100:
        c = n // 100
        r = n % 100
        if c == 1:
            s = 'cent'
        else:
            s = _num_fr(c) + ' cent'
            if r == 0:
                s += 's'
        return (s + ' ' + _num_fr(r)).strip() if r else s
    if n < 20:
        return _FR_UNITS[n]
    tens = n // 10
    units = n % 10
    if tens in (7, 9):
        base = _FR_TENS[tens]
        rem = (10 if tens == 7 else 10) + units
        if rem == 11 and tens == 7:
            return base + ' et onze'
        return base + '-' + _FR_UNITS[rem]
    if units == 0:
        return 'quatre-vingts' if tens == 8 else _FR_TENS[tens]
    if units == 1 and tens in (2, 3, 4, 5, 6):
        return _FR_TENS[tens] + ' et un'
    return _FR_TENS[tens] + '-' + _FR_UNITS[units]


class TTSPreprocessor:
    CONTEXTS = ('question', 'choice', 'answer', 'player_name', 'winner_announce', 'system')

    def __init__(self, language: str = 'fr-FR'):
        self._language = language
        self._rules: Dict = {}
        self._load_rules(language)

    def _load_rules(self, language: str):
        lang_prefix = language.split('-')[0].lower()
        path = os.path.join(_DATA_DIR, f'tts_rules_{lang_prefix}.json')
        if os.path.exists(path):
            try:
                with open(path, 'r', encoding='utf-8') as f:
                    self._rules = json.load(f)
            except (json.JSONDecodeError, IOError):
                self._rules = {}
        else:
            self._rules = {}

    def preprocess(self, text: str, context: str, language: Optional[str] = None) -> str:
        if not text:
            return text
        lang = language or self._language

        text = self._strip_emojis(text)
        text = self._clean_special_chars(text, context)

        if context == 'player_name':
            text = self._clean_player_name(text)

        text = self._expand_acronyms(text, lang)
        text = self._fix_pronunciation(text, lang)

        if context in ('question', 'answer'):
            text = self._normalize_numbers(text, context, lang)

        text = self._normalize_punctuation(text, context)
        text = self._final_cleanup(text, context)
        return text

    def _strip_emojis(self, text: str) -> str:
        return _EMOJI_RE.sub(' ', text).strip()

    def _clean_special_chars(self, text: str, context: str) -> str:
        text = text.replace('\r\n', ' ').replace('\r', ' ').replace('\n', ' ')
        text = re.sub(r'[\x00-\x1F\x7F]', '', text)
        if context in ('player_name', 'winner_announce'):
            text = re.sub(r'[^\w\s\-]', ' ', text, flags=re.UNICODE)
        text = _SPACES.sub(' ', text).strip()
        return text

    def _clean_player_name(self, text: str) -> str:
        filters = self._rules.get('pseudo_filters', ['xx', 'xX', 'Xx', '___'])
        for f in filters:
            text = text.replace(f, ' ')

        text = _SPECIAL_UC.sub('', text)
        text = _REPEAT_UC.sub(r'\1', text)
        text = text.replace('_', ' ').replace('.', ' ').replace('-', ' ')
        text = _CAMEL_RE.sub(r'\1 \2', text)

        digits_match = _DIGITS_END.search(text.rstrip())
        if digits_match:
            num_str = digits_match.group()
            text_base = text[:digits_match.start()].strip()
            try:
                num_word = _num_fr(int(num_str))
                text = (text_base + ' ' + num_word).strip()
            except ValueError:
                text = text_base

        text = _SPACES.sub(' ', text).strip()

        if len(text) < 2:
            return 'un joueur'
        return text

    def _expand_acronyms(self, text: str, language: str) -> str:
        if not language.startswith('fr'):
            return text

        acronym_dict: Dict[str, str] = self._rules.get('acronyms', {})

        def replace_acronym(m: re.Match) -> str:
            word = m.group(1)
            if word in acronym_dict:
                return acronym_dict[word]
            return ' '.join(word)

        return _ACRONYM_RE.sub(replace_acronym, text)

    def _fix_pronunciation(self, text: str, language: str) -> str:
        subs: Dict[str, str] = self._rules.get('substitutions', {})
        for src, dst in subs.items():
            text = re.sub(r'\b' + re.escape(src) + r'\b', dst, text, flags=re.IGNORECASE)
        return text

    def _normalize_numbers(self, text: str, context: str, language: str) -> str:
        if not language.startswith('fr'):
            return text

        def replace_number(m: re.Match) -> str:
            try:
                n = int(m.group())
                if n > 9_999_999:
                    return m.group()
                return _num_fr(n)
            except ValueError:
                return m.group()

        return _DIGITS_ANY.sub(replace_number, text)

    def _normalize_punctuation(self, text: str, context: str) -> str:
        text = text.replace('\u2019', "'").replace('\u2018', "'")
        text = text.replace('\u201c', '"').replace('\u201d', '"')
        text = text.replace('\u2013', '-').replace('\u2014', ',')

        if context in ('player_name', 'winner_announce'):
            text = re.sub(r'[.!?,;:]', '', text)
            text = _SPACES.sub(' ', text).strip()
            return text

        text = text.replace('...', ',')
        text = re.sub(r':\s*$', ',', text)

        if context == 'question':
            q_words = ('quel', 'quelle', 'quels', 'quelles', 'combien', 'qui', 'lequel',
                       'laquelle', 'lesquels', 'lesquelles', 'ou', 'quand', 'comment', 'pourquoi')
            lower = text.lower()
            has_q = any(lower.startswith(w) or f' {w} ' in lower for w in q_words)
            text = text.rstrip('.')
            if has_q and not text.endswith('?'):
                text = text.rstrip(',;:') + '?'
            elif not text.endswith(('?', '!', '.')):
                text += '.'

        if context in ('choice', 'answer'):
            text = text.rstrip('.')

        return text

    def _final_cleanup(self, text: str, context: str) -> str:
        text = _SPACES.sub(' ', text).strip()
        if len(text) > 500:
            text = text[:497] + '...'
        if not text:
            if context == 'player_name':
                return 'un joueur'
            return ''
        return text
