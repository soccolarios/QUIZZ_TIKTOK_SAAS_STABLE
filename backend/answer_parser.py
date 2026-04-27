import re
from typing import Optional, Tuple

EMOJI_PATTERN = re.compile(
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
    "\U0000FE00-\U0000FE0F"
    "\U0000200D"
    "\U00002B50"
    "\U00002B55"
    "\U000023E9-\U000023F3"
    "\U000023F8-\U000023FA"
    "\U0000200B-\U0000200F"
    "\U0000FFF0-\U0000FFFF"
    "\U0001F004"
    "\U0001F0CF"
    "]+",
    flags=re.UNICODE,
)

_NOISE_WORDS = frozenset([
    'ABANDONNER', 'ABANDON', 'ALLER', 'AVEC', 'BIEN', 'BONJOUR', 'BONSOIR',
    'BRAVO', 'COOL', 'COMPTE', 'CLASSE', 'DISCORD', 'DEFAUT',
    'BONNE', 'AUCUN', 'CHANGER', 'DIFFICILE', 'DEBUT',
    'ACCORD', 'ALORS', 'ALLEZ', 'AU', 'AUX', 'AVANT', 'AUCUNE',
    'CHAT', 'CERTAIN', 'CHOSE', 'CONNAIS', 'COMMENCER',
    'DEUX', 'DEMAIN', 'DONC', 'DEJA', 'DIRECT', 'DEBUT',
])


def strip_emojis(text: str) -> str:
    return EMOJI_PATTERN.sub(' ', text).strip()


class AnswerParser:
    VALID_ANSWERS = {'A', 'B', 'C', 'D'}

    def __init__(self):
        pass

    def parse(self, message: str) -> Optional[str]:
        if not message or not isinstance(message, str):
            return None

        cleaned = strip_emojis(message.strip())

        if not cleaned:
            return None

        if len(cleaned) > 100:
            return None

        upper = cleaned.upper()

        if len(upper) == 1 and upper in self.VALID_ANSWERS:
            return upper

        simple_match = re.match(r'^([ABCD])[\s!.,;:?]*$', upper)
        if simple_match:
            return simple_match.group(1)

        paren_match = re.match(r'^\(?([ABCD])\)?[\s!.,;:?]*$', upper)
        if paren_match:
            return paren_match.group(1)

        prefix_patterns = [
            r'^(?:REPONSE|RÉPONSE|ANSWER|CHOIX|CHOICE|OPTION|LETTRE|LETTER)\s*:?\s*([ABCD])[\s!.,;:?]*$',
            r'^(?:JE\s+DIS|C\'?EST|LA|LE|MON\s+CHOIX)\s+([ABCD])[\s!.,;:?]*$',
            r'^([ABCD])\s+(?:FINAL|SVP|STP|PLS)[\s!.,;:?]*$',
        ]

        for pattern in prefix_patterns:
            match = re.match(pattern, upper)
            if match:
                return match.group(1)

        if upper in _NOISE_WORDS:
            return None

        words = re.findall(r'(?<!\w)([ABCD])(?!\w)', upper)
        if len(words) == 1:
            return words[0]

        if len(words) > 1:
            unique = list(dict.fromkeys(words))
            if len(unique) == 1:
                return unique[0]

        tokens = re.split(r'[\s!.,;:?()]+', upper)
        if tokens and tokens[0] in self.VALID_ANSWERS and len(tokens[0]) == 1:
            remaining = [t for t in tokens[1:] if t]
            if not remaining or all(t not in self.VALID_ANSWERS for t in remaining):
                if not any(tokens[0] in w and len(w) > 1 for w in tokens[1:]):
                    return tokens[0]

        return None

    def is_valid_answer(self, answer: str) -> bool:
        if not answer:
            return False
        return answer.upper() in self.VALID_ANSWERS

    def extract_all_answers(self, message: str) -> list:
        if not message:
            return []

        upper = strip_emojis(message).upper()
        found = re.findall(r'(?<!\w)([ABCD])(?!\w)', upper)
        return list(dict.fromkeys(found))

    def get_answer_confidence(self, message: str) -> Tuple[Optional[str], float]:
        if not message:
            return None, 0.0

        cleaned = strip_emojis(message.strip())

        if not cleaned:
            return None, 0.0

        if len(cleaned) == 1 and cleaned.upper() in self.VALID_ANSWERS:
            return cleaned.upper(), 1.0

        answer = self.parse(cleaned)
        if answer:
            return answer, 0.9

        return None, 0.0
