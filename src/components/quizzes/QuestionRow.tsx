import React, { useState } from 'react';
import { GripVertical, Pencil, Trash2, Check, X, ChevronDown, ChevronUp } from 'lucide-react';
import type { QuizQuestion } from '../../api/types';
import { AnswerOptionEditor } from './AnswerOptionEditor';
import { Button } from '../ui/Button';

interface Props {
  question: QuizQuestion;
  index: number;
  total: number;
  onSave: (updated: QuizQuestion) => Promise<void>;
  onDelete: () => Promise<void>;
  onMoveUp: () => void;
  onMoveDown: () => void;
  dragHandleProps?: React.HTMLAttributes<HTMLDivElement>;
}

type AnswerKey = 'A' | 'B' | 'C' | 'D';

const CORRECT_BADGE: Record<AnswerKey, string> = {
  A: 'bg-blue-100 text-blue-700',
  B: 'bg-emerald-100 text-emerald-700',
  C: 'bg-amber-100 text-amber-700',
  D: 'bg-rose-100 text-rose-700',
};

export function QuestionRow({ question, index, total, onSave, onDelete, onMoveUp, onMoveDown, dragHandleProps }: Props) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const [draftText, setDraftText] = useState(question.text);
  const [draftChoices, setDraftChoices] = useState<QuizQuestion['choices']>({ ...question.choices });
  const [draftCorrect, setDraftCorrect] = useState<AnswerKey>(question.correct_answer as AnswerKey);
  const [textError, setTextError] = useState('');

  const openEdit = () => {
    setDraftText(question.text);
    setDraftChoices({ ...question.choices });
    setDraftCorrect(question.correct_answer as AnswerKey);
    setTextError('');
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
    setTextError('');
  };

  const handleSave = async () => {
    const trimmed = draftText.trim();
    if (!trimmed) { setTextError('Le texte est requis'); return; }
    for (const k of ['A', 'B', 'C', 'D'] as AnswerKey[]) {
      if (!draftChoices[k]?.trim()) { setTextError(`L'option ${k} est requise`); return; }
    }
    setTextError('');
    setSaving(true);
    try {
      await onSave({ ...question, text: trimmed, choices: draftChoices, correct_answer: draftCorrect });
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await onDelete();
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  const correct = question.correct_answer as AnswerKey;

  return (
    <div className={`group rounded-xl border transition-all ${editing ? 'border-blue-300 shadow-md shadow-blue-50' : 'border-gray-200 hover:border-gray-300 bg-white'}`}>
      {/* Collapsed / display row */}
      {!editing && (
        <div className="flex items-start gap-2 p-3">
          {/* drag handle */}
          <div
            {...dragHandleProps}
            className="flex-shrink-0 mt-0.5 p-1 text-gray-300 hover:text-gray-500 cursor-grab active:cursor-grabbing rounded"
            title="Réordonner"
          >
            <GripVertical className="w-4 h-4" />
          </div>

          {/* number badge */}
          <span className="flex-shrink-0 w-6 h-6 rounded-full bg-gray-100 text-gray-500 text-xs font-semibold flex items-center justify-center mt-0.5">
            {index + 1}
          </span>

          {/* question content */}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-900 leading-snug">{question.text}</p>
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {(['A', 'B', 'C', 'D'] as AnswerKey[]).map((k) => (
                <span
                  key={k}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ${
                    k === correct ? CORRECT_BADGE[k] + ' font-semibold' : 'bg-gray-100 text-gray-500'
                  }`}
                >
                  <span className="font-bold">{k}.</span> {question.choices[k]}
                </span>
              ))}
            </div>
          </div>

          {/* actions */}
          <div className="flex-shrink-0 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={() => onMoveUp()}
              disabled={index === 0}
              title="Monter"
              className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 disabled:opacity-20 disabled:cursor-not-allowed"
            >
              <ChevronUp className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => onMoveDown()}
              disabled={index === total - 1}
              title="Descendre"
              className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 disabled:opacity-20 disabled:cursor-not-allowed"
            >
              <ChevronDown className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={openEdit}
              title="Éditer"
              className="p-1.5 rounded hover:bg-blue-50 text-gray-400 hover:text-blue-600"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
            {confirmDelete ? (
              <span className="flex items-center gap-1 text-xs text-red-600">
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="px-2 py-0.5 bg-red-600 text-white rounded text-xs hover:bg-red-700 disabled:opacity-50"
                >
                  {deleting ? '…' : 'Oui'}
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded text-xs hover:bg-gray-200"
                >
                  Non
                </button>
              </span>
            ) : (
              <button
                onClick={() => setConfirmDelete(true)}
                title="Supprimer"
                className="p-1.5 rounded hover:bg-red-50 text-gray-400 hover:text-red-500"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Expanded / edit state */}
      {editing && (
        <div className="p-4 flex flex-col gap-3">
          <div className="flex items-center gap-2 mb-1">
            <span className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 text-xs font-semibold flex items-center justify-center">
              {index + 1}
            </span>
            <span className="text-xs font-semibold text-blue-700 uppercase tracking-wide">Édition</span>
          </div>

          {/* Question text */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-600">Question</label>
            <textarea
              value={draftText}
              onChange={(e) => { setDraftText(e.target.value); setTextError(''); }}
              rows={2}
              placeholder="Tapez la question…"
              className={`w-full px-3 py-2 text-sm border rounded-lg bg-white text-gray-900 resize-none placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent ${textError ? 'border-red-400' : 'border-gray-300'}`}
            />
            {textError && <p className="text-xs text-red-600">{textError}</p>}
          </div>

          {/* Answer options */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-600">
              Options — cliquez sur une lettre pour marquer la bonne réponse
            </label>
            <AnswerOptionEditor
              choices={draftChoices}
              correctAnswer={draftCorrect}
              onChange={(c, a) => { setDraftChoices(c); setDraftCorrect(a); }}
            />
          </div>

          {/* Action bar */}
          <div className="flex items-center justify-end gap-2 pt-1 border-t border-gray-100">
            <Button variant="ghost" size="sm" icon={<X className="w-3.5 h-3.5" />} onClick={cancelEdit}>
              Annuler
            </Button>
            <Button size="sm" icon={<Check className="w-3.5 h-3.5" />} onClick={handleSave} loading={saving}>
              Enregistrer
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
