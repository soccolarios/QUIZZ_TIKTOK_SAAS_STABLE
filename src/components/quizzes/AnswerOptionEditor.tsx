import React from 'react';
import type { QuizQuestion } from '../../api/types';

type AnswerKey = 'A' | 'B' | 'C' | 'D';

interface Props {
  choices: QuizQuestion['choices'];
  correctAnswer: AnswerKey;
  onChange: (choices: QuizQuestion['choices'], correctAnswer: AnswerKey) => void;
  disabled?: boolean;
}

const KEY_COLORS: Record<AnswerKey, string> = {
  A: 'bg-blue-500',
  B: 'bg-emerald-500',
  C: 'bg-amber-500',
  D: 'bg-rose-500',
};

const KEY_CORRECT_RING: Record<AnswerKey, string> = {
  A: 'ring-blue-400',
  B: 'ring-emerald-400',
  C: 'ring-amber-400',
  D: 'ring-rose-400',
};

export function AnswerOptionEditor({ choices, correctAnswer, onChange, disabled }: Props) {
  const keys: AnswerKey[] = ['A', 'B', 'C', 'D'];

  const handleText = (key: AnswerKey, value: string) => {
    onChange({ ...choices, [key]: value }, correctAnswer);
  };

  const handleCorrect = (key: AnswerKey) => {
    onChange(choices, key);
  };

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      {keys.map((key) => {
        const isCorrect = correctAnswer === key;
        return (
          <div
            key={key}
            className={`flex items-center gap-2 rounded-lg border px-3 py-2 transition-all ${
              isCorrect
                ? `border-transparent ring-2 ${KEY_CORRECT_RING[key]} bg-white`
                : 'border-gray-200 bg-gray-50'
            }`}
          >
            <button
              type="button"
              onClick={() => !disabled && handleCorrect(key)}
              title={isCorrect ? 'Bonne réponse' : 'Marquer comme bonne réponse'}
              disabled={disabled}
              className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white transition-all focus:outline-none ${
                KEY_COLORS[key]
              } ${isCorrect ? 'ring-2 ring-offset-1 ' + KEY_CORRECT_RING[key] : 'opacity-50 hover:opacity-80'} disabled:cursor-not-allowed`}
            >
              {key}
            </button>
            <input
              type="text"
              value={choices[key]}
              onChange={(e) => handleText(key, e.target.value)}
              disabled={disabled}
              placeholder={`Option ${key}`}
              className="flex-1 min-w-0 text-sm bg-transparent text-gray-900 placeholder-gray-400 focus:outline-none disabled:text-gray-400"
            />
            {isCorrect && (
              <span className="flex-shrink-0 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                correct
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
