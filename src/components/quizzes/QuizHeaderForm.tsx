import React from 'react';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { Check, X } from 'lucide-react';

interface Props {
  title: string;
  description: string;
  onTitleChange: (v: string) => void;
  onDescChange: (v: string) => void;
  titleError?: string;
  onSave: () => void;
  onCancel: () => void;
  saving?: boolean;
}

export function QuizHeaderForm({
  title,
  description,
  onTitleChange,
  onDescChange,
  titleError,
  onSave,
  onCancel,
  saving,
}: Props) {
  return (
    <div className="flex flex-col gap-3 p-4 bg-gray-50 rounded-xl border border-gray-200">
      <Input
        label="Titre du quiz"
        value={title}
        onChange={(e) => onTitleChange(e.target.value)}
        placeholder="Mon super quiz"
        error={titleError}
        autoFocus
      />
      <Input
        label="Description (optionnel)"
        value={description}
        onChange={(e) => onDescChange(e.target.value)}
        placeholder="Une courte description"
      />
      <div className="flex items-center justify-end gap-2 pt-1">
        <Button variant="ghost" size="sm" icon={<X className="w-3.5 h-3.5" />} onClick={onCancel}>
          Annuler
        </Button>
        <Button size="sm" icon={<Check className="w-3.5 h-3.5" />} onClick={onSave} loading={saving}>
          Enregistrer
        </Button>
      </div>
    </div>
  );
}
