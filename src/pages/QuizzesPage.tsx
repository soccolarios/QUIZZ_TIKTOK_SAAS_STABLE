import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Plus,
  BookOpen,
  ChevronDown,
  Trash2,
  ArrowLeft,
  Pencil,
  PlusCircle,
  GripVertical,
  Upload,
  Download,
  Lock,
} from 'lucide-react';
import { quizzesApi } from '../api/quizzes';
import { projectsApi } from '../api/projects';
import type { Quiz, Project, QuizQuestion } from '../api/types';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Modal } from '../components/ui/Modal';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { Spinner } from '../components/ui/Spinner';
import { toast } from '../components/layout/DashboardLayout';
import { ApiError } from '../api/client';
import { QuestionRow } from '../components/quizzes/QuestionRow';
import { AnswerOptionEditor } from '../components/quizzes/AnswerOptionEditor';
import { QuizHeaderForm } from '../components/quizzes/QuizHeaderForm';
import { usePlanLimits } from '../context/UserConfigContext';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractQuestions(data_json: Record<string, unknown>): QuizQuestion[] {
  if (Array.isArray((data_json as Record<string, unknown>)['questionnaires'])) {
    const qnrs = (data_json['questionnaires'] as Record<string, unknown>[]);
    if (qnrs[0] && Array.isArray(qnrs[0]['questions'])) {
      return qnrs[0]['questions'] as QuizQuestion[];
    }
    return [];
  }
  return (data_json['questions'] as QuizQuestion[]) || [];
}

// ---------------------------------------------------------------------------
// Import helpers
// ---------------------------------------------------------------------------

interface ParsedImport {
  title: string;
  description: string;
  data_json: Record<string, unknown>;
  questionCount: number;
}

function parseImportFile(raw: unknown): ParsedImport {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error("Le fichier doit contenir un objet JSON.");
  }
  const obj = raw as Record<string, unknown>;

  // Detect format: wrapper ({ questionnaires: [...] }) or legacy ({ questions: [...] })
  let questions: unknown[];
  let title = '';
  let description = '';

  if (Array.isArray(obj['questionnaires'])) {
    const qnrs = obj['questionnaires'] as Record<string, unknown>[];
    if (!qnrs[0]) throw new Error("Le tableau 'questionnaires' est vide.");
    const first = qnrs[0];
    questions = Array.isArray(first['questions']) ? (first['questions'] as unknown[]) : [];
    title = String(first['name'] || first['title'] || '');
    description = String(first['description'] || '');
  } else if (Array.isArray(obj['questions'])) {
    questions = obj['questions'] as unknown[];
    title = String(obj['name'] || obj['title'] || '');
    description = String(obj['description'] || '');
  } else {
    throw new Error(
      "Format non reconnu. Le fichier doit contenir un champ 'questions' ou 'questionnaires'."
    );
  }

  if (questions.length === 0) {
    throw new Error("Aucune question trouvée dans le fichier.");
  }

  const ANSWER_KEYS = ['A', 'B', 'C', 'D'];
  questions.forEach((q, i) => {
    if (!q || typeof q !== 'object' || Array.isArray(q)) {
      throw new Error(`Question[${i}] n'est pas un objet valide.`);
    }
    const qo = q as Record<string, unknown>;
    if (!qo['text'] || typeof qo['text'] !== 'string' || !qo['text'].trim()) {
      throw new Error(`Question[${i}] : le champ 'text' est requis.`);
    }
    if (!qo['choices'] || typeof qo['choices'] !== 'object' || Array.isArray(qo['choices'])) {
      throw new Error(`Question[${i}] : le champ 'choices' doit être un objet.`);
    }
    const choices = qo['choices'] as Record<string, unknown>;
    for (const k of ANSWER_KEYS) {
      if (!choices[k] || typeof choices[k] !== 'string' || !(choices[k] as string).trim()) {
        throw new Error(`Question[${i}] : le choix '${k}' est requis.`);
      }
    }
    const ca = String(qo['correct_answer'] || '').trim().toUpperCase();
    if (!ANSWER_KEYS.includes(ca)) {
      throw new Error(
        `Question[${i}] : 'correct_answer' doit être A, B, C ou D (trouvé: "${qo['correct_answer']}").`
      );
    }
  });

  // Normalise to legacy format
  const data_json: Record<string, unknown> = {
    id: obj['id'] ?? 1,
    name: title,
    description,
    category: (obj['category'] as string) || 'general',
    active: true,
    order: (obj['order'] as number) || 1,
    questions,
  };

  return { title, description, data_json, questionCount: questions.length };
}

// ---------------------------------------------------------------------------
// Export helper
// ---------------------------------------------------------------------------

function exportQuiz(quiz: Quiz) {
  const questions = extractQuestions(quiz.data_json);
  const payload = {
    name: quiz.title,
    description: quiz.description || '',
    category: (quiz.data_json['category'] as string) || 'general',
    active: true,
    order: 1,
    questions,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const slug = quiz.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  a.href = url;
  a.download = `quiz-${slug}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Import quiz modal
// ---------------------------------------------------------------------------

interface ImportModalProps {
  open: boolean;
  projects: Project[];
  onClose: () => void;
  onImported: (quiz: Quiz) => void;
}

function ImportQuizModal({ open, projects, onClose, onImported }: ImportModalProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [projectId, setProjectId] = useState('');
  const [parsed, setParsed] = useState<ParsedImport | null>(null);
  const [parseError, setParseError] = useState('');
  const [fileName, setFileName] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setProjectId(projects[0]?.id || '');
      setParsed(null);
      setParseError('');
      setFileName('');
    }
  }, [open, projects]);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setParsed(null);
    setParseError('');
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const raw = JSON.parse(ev.target?.result as string);
        const result = parseImportFile(raw);
        setParsed(result);
      } catch (err) {
        setParseError(err instanceof Error ? err.message : 'Fichier invalide.');
      }
    };
    reader.readAsText(file);
  };

  const handleImport = async () => {
    if (!parsed) return;
    if (!projectId) { toast('Sélectionnez un projet', 'error'); return; }
    setSaving(true);
    try {
      const quiz = await quizzesApi.create({
        project_id: projectId,
        title: parsed.title || fileName.replace(/\.json$/i, '') || 'Quiz importé',
        description: parsed.description || undefined,
        data_json: parsed.data_json,
      });
      onImported(quiz);
      onClose();
      toast(`Quiz importé — ${parsed.questionCount} question${parsed.questionCount !== 1 ? 's' : ''}`, 'success');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Échec de l'import", 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Importer un quiz" size="md">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700">Projet</label>
          <div className="relative">
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white text-gray-900 appearance-none focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Sélectionner un projet</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700">Fichier JSON</label>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="flex items-center gap-2 px-4 py-2.5 border-2 border-dashed border-gray-300 rounded-lg text-sm text-gray-500 hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50 transition-all text-left"
          >
            <Upload className="w-4 h-4 flex-shrink-0" />
            <span className="truncate">{fileName || 'Choisir un fichier .json…'}</span>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={handleFile}
          />
        </div>

        {parseError && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2.5">
            <p className="text-xs font-semibold text-red-700 mb-0.5">Fichier invalide</p>
            <p className="text-xs text-red-600">{parseError}</p>
          </div>
        )}

        {parsed && !parseError && (
          <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2.5 flex items-start gap-2">
            <BookOpen className="w-4 h-4 text-emerald-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-semibold text-emerald-800">{parsed.title || '(sans titre)'}</p>
              <p className="text-xs text-emerald-700 mt-0.5">
                {parsed.questionCount} question{parsed.questionCount !== 1 ? 's' : ''} prête{parsed.questionCount !== 1 ? 's' : ''} à importer
              </p>
            </div>
          </div>
        )}

        <p className="text-xs text-gray-400 leading-relaxed">
          Formats acceptés : objet JSON avec un champ <code className="bg-gray-100 px-1 rounded">questions</code> ou{' '}
          <code className="bg-gray-100 px-1 rounded">questionnaires</code>. Chaque question doit avoir{' '}
          <code className="bg-gray-100 px-1 rounded">text</code>,{' '}
          <code className="bg-gray-100 px-1 rounded">choices</code> (A–D) et{' '}
          <code className="bg-gray-100 px-1 rounded">correct_answer</code>.
        </p>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose}>Annuler</Button>
          <Button
            icon={<Upload className="w-3.5 h-3.5" />}
            onClick={handleImport}
            loading={saving}
            disabled={!parsed || !!parseError || !projectId}
          >
            Importer
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// New-quiz creation modal
// ---------------------------------------------------------------------------

interface CreateModalProps {
  open: boolean;
  projects: Project[];
  onClose: () => void;
  onCreate: (quiz: Quiz) => void;
}

function CreateQuizModal({ open, projects, onClose, onCreate }: CreateModalProps) {
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [projectId, setProjectId] = useState('');
  const [titleError, setTitleError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setTitle('');
      setDesc('');
      setProjectId(projects[0]?.id || '');
      setTitleError('');
    }
  }, [open, projects]);

  const handleCreate = async () => {
    if (!title.trim()) { setTitleError('Le titre est requis'); return; }
    if (!projectId) { toast('Sélectionnez un projet', 'error'); return; }
    setSaving(true);
    try {
      const quiz = await quizzesApi.create({
        project_id: projectId,
        title: title.trim(),
        description: desc.trim() || undefined,
      });
      onCreate(quiz);
      onClose();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Échec de la création', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Nouveau quiz" size="md">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-700">Projet</label>
          <div className="relative">
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white text-gray-900 appearance-none focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Sélectionner un projet</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
          </div>
        </div>
        <Input
          label="Titre"
          value={title}
          onChange={(e) => { setTitle(e.target.value); setTitleError(''); }}
          placeholder="Mon super quiz"
          error={titleError}
          autoFocus
        />
        <Input
          label="Description (optionnel)"
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          placeholder="Une courte description"
        />
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose}>Annuler</Button>
          <Button onClick={handleCreate} loading={saving}>Créer</Button>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Add-question panel
// ---------------------------------------------------------------------------

type AnswerKey = 'A' | 'B' | 'C' | 'D';

interface AddQuestionPanelProps {
  quizId: string;
  onAdded: (updatedQuiz: Quiz) => void;
  onCancel: () => void;
}

function AddQuestionPanel({ quizId, onAdded, onCancel }: AddQuestionPanelProps) {
  const [text, setText] = useState('');
  const [choices, setChoices] = useState<QuizQuestion['choices']>({ A: '', B: '', C: '', D: '' });
  const [correct, setCorrect] = useState<AnswerKey>('A');
  const [textError, setTextError] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    const trimmed = text.trim();
    if (!trimmed) { setTextError('Le texte est requis'); return; }
    for (const k of ['A', 'B', 'C', 'D'] as AnswerKey[]) {
      if (!choices[k]?.trim()) { setTextError(`L'option ${k} est requise`); return; }
    }
    setTextError('');
    setSaving(true);
    try {
      const res = await quizzesApi.addQuestion(quizId, {
        text: trimmed,
        choices,
        correct_answer: correct,
      });
      onAdded(res.quiz);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Échec de l'ajout", 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border-2 border-dashed border-blue-300 bg-blue-50/40 p-4 flex flex-col gap-3">
      <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide">Nouvelle question</p>

      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-gray-600">Question</label>
        <textarea
          value={text}
          onChange={(e) => { setText(e.target.value); setTextError(''); }}
          rows={2}
          placeholder="Tapez la question…"
          autoFocus
          className={`w-full px-3 py-2 text-sm border rounded-lg bg-white text-gray-900 resize-none placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent ${textError ? 'border-red-400' : 'border-gray-300'}`}
        />
        {textError && <p className="text-xs text-red-600">{textError}</p>}
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-gray-600">
          Options — cliquez sur une lettre pour marquer la bonne réponse
        </label>
        <AnswerOptionEditor
          choices={choices}
          correctAnswer={correct}
          onChange={(c, a) => { setChoices(c); setCorrect(a); }}
        />
      </div>

      <div className="flex items-center justify-end gap-2 pt-1 border-t border-blue-200">
        <Button variant="ghost" size="sm" onClick={onCancel}>Annuler</Button>
        <Button size="sm" icon={<Plus className="w-3.5 h-3.5" />} onClick={handleSave} loading={saving}>
          Ajouter
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Quiz Editor (full-page drill-down)
// ---------------------------------------------------------------------------

interface EditorProps {
  quiz: Quiz;
  projectName: string;
  onBack: () => void;
  onQuizUpdated: (q: Quiz) => void;
  onQuizDeleted: () => void;
}

function QuizEditor({ quiz, projectName, onBack, onQuizUpdated, onQuizDeleted }: EditorProps) {
  const [editingHeader, setEditingHeader] = useState(false);
  const [headerTitle, setHeaderTitle] = useState(quiz.title);
  const [headerDesc, setHeaderDesc] = useState(quiz.description || '');
  const [headerTitleError, setHeaderTitleError] = useState('');
  const [headerSaving, setHeaderSaving] = useState(false);
  const [addingQuestion, setAddingQuestion] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const questions = extractQuestions(quiz.data_json);

  const openHeader = () => {
    setHeaderTitle(quiz.title);
    setHeaderDesc(quiz.description || '');
    setHeaderTitleError('');
    setEditingHeader(true);
  };

  const saveHeader = async () => {
    if (!headerTitle.trim()) { setHeaderTitleError('Le titre est requis'); return; }
    setHeaderSaving(true);
    try {
      const updated = await quizzesApi.update(quiz.id, {
        title: headerTitle.trim(),
        description: headerDesc.trim() || undefined,
      });
      onQuizUpdated(updated);
      setEditingHeader(false);
      toast('Quiz mis à jour', 'success');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Échec de la sauvegarde', 'error');
    } finally {
      setHeaderSaving(false);
    }
  };

  const handleSaveQuestion = async (updated: QuizQuestion) => {
    const res = await quizzesApi.updateQuestion(quiz.id, String(updated.id), {
      text: updated.text,
      choices: updated.choices,
      correct_answer: updated.correct_answer,
      category: updated.category,
      difficulty: updated.difficulty,
    });
    onQuizUpdated(res.quiz);
    toast('Question enregistrée', 'success');
  };

  const handleDeleteQuestion = async (questionId: string) => {
    const res = await quizzesApi.deleteQuestion(quiz.id, questionId);
    onQuizUpdated(res.quiz);
    toast('Question supprimée', 'success');
  };

  const handleMoveQuestion = async (fromIndex: number, toIndex: number) => {
    const ids = questions.map((q) => String(q.id));
    const moved = [...ids];
    const [item] = moved.splice(fromIndex, 1);
    moved.splice(toIndex, 0, item);
    try {
      const res = await quizzesApi.reorderQuestions(quiz.id, moved);
      onQuizUpdated(res.quiz);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Échec du réordonnancement', 'error');
    }
  };

  const handleDeleteQuiz = async () => {
    setDeleting(true);
    try {
      await quizzesApi.delete(quiz.id);
      onQuizDeleted();
      toast('Quiz supprimé', 'success');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Échec de la suppression', 'error');
    } finally {
      setDeleting(false);
      setDeleteConfirmOpen(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {/* breadcrumb */}
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Quizzes
        </button>
        <span className="text-gray-300">/</span>
        <span className="text-sm font-medium text-gray-900 truncate">{quiz.title}</span>
      </div>

      {/* header card */}
      {editingHeader ? (
        <QuizHeaderForm
          title={headerTitle}
          description={headerDesc}
          onTitleChange={(v) => { setHeaderTitle(v); setHeaderTitleError(''); }}
          onDescChange={setHeaderDesc}
          titleError={headerTitleError}
          onSave={saveHeader}
          onCancel={() => setEditingHeader(false)}
          saving={headerSaving}
        />
      ) : (
        <div className="flex items-start justify-between gap-4 p-4 bg-white rounded-xl border border-gray-200 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 bg-emerald-50 rounded-xl flex items-center justify-center flex-shrink-0">
              <BookOpen className="w-5 h-5 text-emerald-600" />
            </div>
            <div>
              <h2 className="text-base font-bold text-gray-900">{quiz.title}</h2>
              {quiz.description && (
                <p className="text-sm text-gray-500 mt-0.5">{quiz.description}</p>
              )}
              <p className="text-xs text-gray-400 mt-1">
                {projectName} &middot; {questions.length} question{questions.length !== 1 ? 's' : ''}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <Button
              variant="ghost"
              size="sm"
              icon={<Download className="w-3.5 h-3.5" />}
              onClick={() => { exportQuiz(quiz); toast('Quiz exporté', 'success'); }}
            >
              Exporter
            </Button>
            <Button
              variant="ghost"
              size="sm"
              icon={<Pencil className="w-3.5 h-3.5" />}
              onClick={openHeader}
            >
              Éditer
            </Button>
            <Button
              variant="ghost"
              size="sm"
              icon={<Trash2 className="w-3.5 h-3.5 text-red-400" />}
              onClick={() => setDeleteConfirmOpen(true)}
              className="text-red-500 hover:bg-red-50"
            >
              Supprimer
            </Button>
          </div>
        </div>
      )}

      {/* questions */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-700">
            Questions
            <span className="ml-2 text-xs font-normal text-gray-400">
              {questions.length === 0 ? 'Aucune question' : `${questions.length} au total`}
            </span>
          </h3>
          {!addingQuestion && (
            <Button
              size="sm"
              variant="secondary"
              icon={<PlusCircle className="w-4 h-4" />}
              onClick={() => setAddingQuestion(true)}
            >
              Ajouter une question
            </Button>
          )}
        </div>

        {questions.length === 0 && !addingQuestion && (
          <div className="flex flex-col items-center justify-center py-12 rounded-xl border-2 border-dashed border-gray-200 text-center">
            <div className="w-10 h-10 bg-gray-100 rounded-xl flex items-center justify-center mb-3">
              <BookOpen className="w-5 h-5 text-gray-400" />
            </div>
            <p className="text-sm text-gray-500 mb-3">Ce quiz ne contient pas encore de questions.</p>
            <Button
              size="sm"
              icon={<PlusCircle className="w-4 h-4" />}
              onClick={() => setAddingQuestion(true)}
            >
              Ajouter la première question
            </Button>
          </div>
        )}

        {questions.length > 0 && (
          <div className="flex flex-col gap-2">
            {questions.map((q, i) => (
              <QuestionRow
                key={String(q.id)}
                question={q}
                index={i}
                total={questions.length}
                onSave={handleSaveQuestion}
                onDelete={() => handleDeleteQuestion(String(q.id))}
                onMoveUp={() => handleMoveQuestion(i, i - 1)}
                onMoveDown={() => handleMoveQuestion(i, i + 1)}
                dragHandleProps={{}}
              />
            ))}
          </div>
        )}

        {addingQuestion && (
          <AddQuestionPanel
            quizId={quiz.id}
            onAdded={(updated) => {
              onQuizUpdated(updated);
              setAddingQuestion(false);
              toast('Question ajoutée', 'success');
            }}
            onCancel={() => setAddingQuestion(false)}
          />
        )}
      </div>

      <ConfirmDialog
        open={deleteConfirmOpen}
        onClose={() => setDeleteConfirmOpen(false)}
        onConfirm={handleDeleteQuiz}
        title="Supprimer le quiz"
        message={`Supprimer "${quiz.title}" et toutes ses questions ? Cette action est irréversible.`}
        confirmLabel="Supprimer"
        loading={deleting}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main QuizzesPage
// ---------------------------------------------------------------------------

export function QuizzesPage() {
  const limits = usePlanLimits();
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [filterProjectId, setFilterProjectId] = useState('');
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [activeQuiz, setActiveQuiz] = useState<Quiz | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [qData, pData] = await Promise.all([
        quizzesApi.list(filterProjectId || undefined),
        projectsApi.list(),
      ]);
      setQuizzes(qData);
      setProjects(pData);
    } catch {
      toast('Échec du chargement des quizzes', 'error');
    } finally {
      setLoading(false);
    }
  }, [filterProjectId]);

  useEffect(() => { load(); }, [load]);

  // Keep activeQuiz in sync after list refresh
  useEffect(() => {
    if (activeQuiz) {
      const refreshed = quizzes.find((q) => q.id === activeQuiz.id);
      if (refreshed) setActiveQuiz(refreshed);
    }
  }, [quizzes]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleQuizCreated = (quiz: Quiz) => {
    setQuizzes((prev) => [quiz, ...prev]);
    setActiveQuiz(quiz);
  };

  const handleQuizImported = (quiz: Quiz) => {
    setQuizzes((prev) => [quiz, ...prev]);
    setActiveQuiz(quiz);
  };

  const handleQuizUpdated = (updated: Quiz) => {
    setQuizzes((prev) => prev.map((q) => (q.id === updated.id ? updated : q)));
    setActiveQuiz(updated);
  };

  const handleQuizDeleted = () => {
    setQuizzes((prev) => prev.filter((q) => q.id !== activeQuiz?.id));
    setActiveQuiz(null);
  };

  const pName = (id: string) => projects.find((p) => p.id === id)?.name || id;
  const fmtDate = (s: string) =>
    new Date(s).toLocaleDateString('fr-FR', { month: 'short', day: 'numeric', year: 'numeric' });

  const filteredQuizCount = filterProjectId
    ? quizzes.filter((q) => q.project_id === filterProjectId).length
    : quizzes.length;
  const atQuota = !loading && !!filterProjectId && filteredQuizCount >= limits.maxQuizzesPerProject;

  if (activeQuiz) {
    return (
      <QuizEditor
        quiz={activeQuiz}
        projectName={pName(activeQuiz.project_id)}
        onBack={() => setActiveQuiz(null)}
        onQuizUpdated={handleQuizUpdated}
        onQuizDeleted={handleQuizDeleted}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Quizzes</h1>
          <p className="text-sm text-gray-500 mt-0.5">Gérez votre contenu de quiz</p>
        </div>
        <div className="flex items-center gap-2">
          {atQuota && (
            <span className="flex items-center gap-1 text-xs text-amber-600 font-medium">
              <Lock className="w-3.5 h-3.5" />
              {filteredQuizCount}/{limits.maxQuizzesPerProject} quizzes
            </span>
          )}
          <Button
            variant="secondary"
            icon={<Upload className="w-4 h-4" />}
            onClick={() => setImportOpen(true)}
            disabled={projects.length === 0 || atQuota}
          >
            Importer
          </Button>
          <Button
            icon={<Plus className="w-4 h-4" />}
            onClick={() => setCreateOpen(true)}
            disabled={projects.length === 0 || atQuota}
          >
            Nouveau quiz
          </Button>
        </div>
      </div>

      {projects.length > 0 && (
        <div className="flex items-center gap-2">
          <div className="relative">
            <select
              value={filterProjectId}
              onChange={(e) => setFilterProjectId(e.target.value)}
              className="pl-3 pr-8 py-1.5 text-sm border border-gray-300 rounded-lg bg-white text-gray-700 appearance-none focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Tous les projets</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : quizzes.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 bg-white rounded-xl border border-gray-200 text-center">
          <div className="w-12 h-12 bg-gray-100 rounded-xl flex items-center justify-center mb-3">
            <BookOpen className="w-6 h-6 text-gray-400" />
          </div>
          <p className="text-gray-500 text-sm mb-4">
            {projects.length === 0 ? 'Créez un projet en premier' : "Aucun quiz pour l'instant"}
          </p>
          {projects.length > 0 && !atQuota && (
            <div className="flex items-center gap-2">
              <Button variant="secondary" icon={<Upload className="w-4 h-4" />} onClick={() => setImportOpen(true)}>
                Importer
              </Button>
              <Button icon={<Plus className="w-4 h-4" />} onClick={() => setCreateOpen(true)}>
                Créer un quiz
              </Button>
            </div>
          )}
          {atQuota && (
            <p className="text-sm text-amber-600">
              You've reached the quiz limit for this project ({limits.maxQuizzesPerProject}).
              Upgrade your plan to add more.
            </p>
          )}
        </div>
      ) : (
        <div className="grid gap-2">
          {quizzes.map((q) => {
            const qCount = extractQuestions(q.data_json).length;
            return (
              <div
                key={q.id}
                className="w-full text-left bg-white rounded-xl border border-gray-200 shadow-sm p-4 hover:border-blue-300 hover:shadow-md transition-all group flex items-center gap-3 cursor-pointer"
                onClick={() => setActiveQuiz(q)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && setActiveQuiz(q)}
              >
                <div className="w-9 h-9 bg-emerald-50 rounded-lg flex items-center justify-center flex-shrink-0 group-hover:bg-emerald-100 transition-colors">
                  <BookOpen className="w-4 h-4 text-emerald-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 group-hover:text-blue-700 transition-colors">
                    {q.title}
                  </p>
                  {q.description && (
                    <p className="text-xs text-gray-500 mt-0.5 truncate">{q.description}</p>
                  )}
                  <p className="text-xs text-gray-400 mt-1">
                    {pName(q.project_id)} &middot; {fmtDate(q.created_at)} &middot;{' '}
                    <span className={qCount === 0 ? 'text-amber-500' : ''}>
                      {qCount} question{qCount !== 1 ? 's' : ''}
                    </span>
                  </p>
                </div>
                <button
                  type="button"
                  title="Exporter le quiz"
                  onClick={(e) => { e.stopPropagation(); exportQuiz(q); toast('Quiz exporté', 'success'); }}
                  className="flex-shrink-0 p-1.5 rounded-lg text-gray-300 hover:text-blue-500 hover:bg-blue-50 transition-colors opacity-0 group-hover:opacity-100"
                >
                  <Download className="w-4 h-4" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      <CreateQuizModal
        open={createOpen}
        projects={projects}
        onClose={() => setCreateOpen(false)}
        onCreate={handleQuizCreated}
      />

      <ImportQuizModal
        open={importOpen}
        projects={projects}
        onClose={() => setImportOpen(false)}
        onImported={handleQuizImported}
      />
    </div>
  );
}
