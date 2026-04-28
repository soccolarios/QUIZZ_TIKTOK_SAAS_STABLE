import { useState, useEffect, useCallback } from 'react';
import {
  Sparkles,
  ChevronDown,
  Check,
  X,
  RefreshCw,
  BookOpen,
  Save,
  AlertCircle,
  Loader2,
  Plus,
} from 'lucide-react';
import { aiApi } from '../api/ai';
import { quizzesApi } from '../api/quizzes';
import { projectsApi } from '../api/projects';
import type { QuizQuestion, Quiz, Project } from '../api/types';
import type { GenerateRequest } from '../api/ai';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Modal } from '../components/ui/Modal';
import { Spinner } from '../components/ui/Spinner';
import { toast } from '../components/layout/DashboardLayout';
import { ApiError } from '../api/client';
import { useAiDefaults } from '../context/PublicConfigContext';

const ANSWER_COLORS: Record<string, string> = {
  A: 'bg-blue-500',
  B: 'bg-emerald-500',
  C: 'bg-amber-500',
  D: 'bg-rose-500',
};

const ANSWER_CORRECT_BG: Record<string, string> = {
  A: 'bg-blue-50 border-blue-200 text-blue-800',
  B: 'bg-emerald-50 border-emerald-200 text-emerald-800',
  C: 'bg-amber-50 border-amber-200 text-amber-800',
  D: 'bg-rose-50 border-rose-200 text-rose-800',
};

const DIFFICULTY_BADGE: Record<number, string> = {
  1: 'bg-emerald-100 text-emerald-700',
  2: 'bg-amber-100 text-amber-700',
  3: 'bg-rose-100 text-rose-700',
};

// DIFFICULTY_LABEL built at render time from config

// ---------------------------------------------------------------------------
// Question preview card
// ---------------------------------------------------------------------------

interface QuestionCardProps {
  question: QuizQuestion;
  index: number;
  selected: boolean;
  onToggle: () => void;
}

function QuestionCard({ question, index, selected, onToggle }: QuestionCardProps) {
  const [expanded, setExpanded] = useState(false);
  const correct = question.correct_answer;

  return (
    <div
      className={`rounded-xl border transition-all ${
        selected
          ? 'border-blue-300 shadow-sm shadow-blue-50'
          : 'border-gray-200 opacity-60'
      } bg-white`}
    >
      <div className="flex items-start gap-3 p-3">
        {/* selection checkbox */}
        <button
          onClick={onToggle}
          className={`flex-shrink-0 mt-0.5 w-5 h-5 rounded border-2 flex items-center justify-center transition-all ${
            selected
              ? 'bg-blue-600 border-blue-600'
              : 'border-gray-300 hover:border-blue-400'
          }`}
        >
          {selected && <Check className="w-3 h-3 text-white" />}
        </button>

        {/* number */}
        <span className="flex-shrink-0 w-6 h-6 rounded-full bg-gray-100 text-gray-500 text-xs font-semibold flex items-center justify-center mt-0.5">
          {index + 1}
        </span>

        {/* question text */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-900 leading-snug">{question.text}</p>

          {/* collapsed answer hint */}
          {!expanded && (
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {(['A', 'B', 'C', 'D'] as const).map((k) => (
                <span
                  key={k}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ${
                    k === correct
                      ? ANSWER_CORRECT_BG[k] + ' border font-semibold'
                      : 'bg-gray-100 text-gray-500 border border-transparent'
                  }`}
                >
                  <span className="font-bold">{k}.</span> {question.choices[k]}
                </span>
              ))}
            </div>
          )}

          {/* expanded detailed view */}
          {expanded && (
            <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {(['A', 'B', 'C', 'D'] as const).map((k) => (
                <div
                  key={k}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm ${
                    k === correct
                      ? ANSWER_CORRECT_BG[k] + ' border font-medium'
                      : 'bg-gray-50 border-gray-200 text-gray-700'
                  }`}
                >
                  <span
                    className={`flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white ${ANSWER_COLORS[k]}`}
                  >
                    {k}
                  </span>
                  {question.choices[k]}
                  {k === correct && <Check className="w-3.5 h-3.5 ml-auto flex-shrink-0" />}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* difficulty badge + expand */}
        <div className="flex-shrink-0 flex flex-col items-end gap-1.5">
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${DIFFICULTY_BADGE[question.difficulty] || DIFFICULTY_BADGE[2]}`}>
            {DIFFICULTY_LABEL[question.difficulty] || 'Moyen'}
          </span>
          <button
            onClick={() => setExpanded((v) => !v)}
            className="text-[10px] text-gray-400 hover:text-gray-600 transition-colors"
          >
            {expanded ? 'Réduire' : 'Détails'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Save-to-quiz modal
// ---------------------------------------------------------------------------

interface SaveModalProps {
  open: boolean;
  questions: QuizQuestion[];
  projects: Project[];
  onClose: () => void;
  onSaved: (quiz: Quiz) => void;
  suggestedTheme: string;
}

type SaveMode = 'new' | 'existing';

function SaveModal({ open, questions, projects, onClose, onSaved, suggestedTheme }: SaveModalProps) {
  const [mode, setMode] = useState<SaveMode>('new');
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newProjectId, setNewProjectId] = useState('');
  const [existingQuizId, setExistingQuizId] = useState('');
  const [existingQuizzes, setExistingQuizzes] = useState<Quiz[]>([]);
  const [loadingQuizzes, setLoadingQuizzes] = useState(false);
  const [titleError, setTitleError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setMode('new');
      setNewTitle(`Quiz IA — ${suggestedTheme}`);
      setNewDesc('');
      setNewProjectId(projects[0]?.id || '');
      setExistingQuizId('');
      setTitleError('');
    }
  }, [open, suggestedTheme, projects]);

  useEffect(() => {
    if (open && mode === 'existing') {
      setLoadingQuizzes(true);
      quizzesApi.list().then((qs) => {
        setExistingQuizzes(qs);
        setExistingQuizId(qs[0]?.id || '');
      }).catch(() => {
        toast('Impossible de charger les quizzes', 'error');
      }).finally(() => setLoadingQuizzes(false));
    }
  }, [open, mode]);

  const handleSave = async () => {
    setSaving(true);
    try {
      let quiz: Quiz;

      if (mode === 'new') {
        if (!newTitle.trim()) { setTitleError('Le titre est requis'); setSaving(false); return; }
        if (!newProjectId) { toast('Sélectionnez un projet', 'error'); setSaving(false); return; }

        // Create the quiz first (empty)
        quiz = await quizzesApi.create({
          project_id: newProjectId,
          title: newTitle.trim(),
          description: newDesc.trim() || undefined,
        });
      } else {
        if (!existingQuizId) { toast('Sélectionnez un quiz', 'error'); setSaving(false); return; }
        quiz = await quizzesApi.get(existingQuizId);
      }

      // Add each question sequentially
      for (const q of questions) {
        const res = await quizzesApi.addQuestion(quiz.id, {
          text: q.text,
          choices: q.choices,
          correct_answer: q.correct_answer,
          category: q.category,
          difficulty: q.difficulty,
        });
        quiz = res.quiz;
      }

      onSaved(quiz);
      onClose();
      toast(`${questions.length} question${questions.length > 1 ? 's' : ''} sauvegardée${questions.length > 1 ? 's' : ''}`, 'success');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Échec de la sauvegarde', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Sauvegarder les questions" size="md">
      <div className="flex flex-col gap-4">
        <p className="text-sm text-gray-500">
          {questions.length} question{questions.length > 1 ? 's' : ''} sélectionnée{questions.length > 1 ? 's' : ''} à sauvegarder.
        </p>

        {/* mode selector */}
        <div className="flex rounded-lg overflow-hidden border border-gray-200">
          {(['new', 'existing'] as SaveMode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`flex-1 py-2 text-sm font-medium transition-colors ${
                mode === m
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              {m === 'new' ? 'Nouveau quiz' : 'Quiz existant'}
            </button>
          ))}
        </div>

        {mode === 'new' && (
          <>
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-gray-700">Projet</label>
              <div className="relative">
                <select
                  value={newProjectId}
                  onChange={(e) => setNewProjectId(e.target.value)}
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
              label="Titre du quiz"
              value={newTitle}
              onChange={(e) => { setNewTitle(e.target.value); setTitleError(''); }}
              error={titleError}
              autoFocus
            />
            <Input
              label="Description (optionnel)"
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              placeholder="Généré par IA"
            />
          </>
        )}

        {mode === 'existing' && (
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-gray-700">Quiz de destination</label>
            {loadingQuizzes ? (
              <div className="flex items-center gap-2 py-2 text-sm text-gray-400">
                <Loader2 className="w-4 h-4 animate-spin" /> Chargement…
              </div>
            ) : existingQuizzes.length === 0 ? (
              <p className="text-sm text-gray-500 italic">Aucun quiz disponible. Créez-en un d'abord.</p>
            ) : (
              <div className="relative">
                <select
                  value={existingQuizId}
                  onChange={(e) => setExistingQuizId(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white text-gray-900 appearance-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {existingQuizzes.map((q) => (
                    <option key={q.id} value={q.id}>{q.title}</option>
                  ))}
                </select>
                <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
              </div>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose}>Annuler</Button>
          <Button
            onClick={handleSave}
            loading={saving}
            icon={<Save className="w-4 h-4" />}
            disabled={mode === 'existing' && existingQuizzes.length === 0}
          >
            Sauvegarder
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export function AIGeneratorPage() {
  const aiCfg = useAiDefaults();
  const PRESETS = aiCfg.categories.map((c) => ({ id: c.code, label: c.label, emoji: c.emoji, theme: c.theme, category: c.category }));
  const DIFFICULTIES = aiCfg.difficultyLevels.map((d, i) => ({
    value: d.value as 1 | 2 | 3,
    label: d.label,
    desc: d.description,
    color: ['text-emerald-600 bg-emerald-50 border-emerald-200 ring-emerald-300',
            'text-amber-600 bg-amber-50 border-amber-200 ring-amber-300',
            'text-rose-600 bg-rose-50 border-rose-200 ring-rose-300'][i] ?? '',
  }));
  const QUESTION_COUNTS = aiCfg.questionCounts;
  const STYLES = aiCfg.questionStyles;
  const DIFFICULTY_LABEL: Record<number, string> = Object.fromEntries(
    aiCfg.difficultyLevels.map((d) => [d.value, d.label]),
  );

  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(true);

  const [selectedPreset, setSelectedPreset] = useState<string>(PRESETS[0]?.id ?? 'culture');
  const [customTheme, setCustomTheme] = useState('');
  const [useCustomTheme, setUseCustomTheme] = useState(false);
  const [difficulty, setDifficulty] = useState<1 | 2 | 3>(2);
  const [questionCount, setQuestionCount] = useState(QUESTION_COUNTS[1] ?? 10);
  const [language, setLanguage] = useState(aiCfg.defaultLanguage);
  const [style, setStyle] = useState(STYLES[0]?.id ?? 'standard');

  // generation state
  const [generating, setGenerating] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [generatedQuestions, setGeneratedQuestions] = useState<QuizQuestion[] | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lastTheme, setLastTheme] = useState('');

  // save modal
  const [saveOpen, setSaveOpen] = useState(false);

  useEffect(() => {
    projectsApi.list().then((ps) => setProjects(ps)).finally(() => setProjectsLoading(false));
  }, []);

  const activePreset = PRESETS.find((p) => p.id === selectedPreset);
  const effectiveTheme = useCustomTheme ? customTheme.trim() : (activePreset?.theme || '');
  const effectiveCategory = useCustomTheme ? customTheme.trim() : (activePreset?.category || 'general');

  const canGenerate = effectiveTheme.length > 0 && !generating;

  const handleGenerate = useCallback(async () => {
    if (!canGenerate) return;
    setGenerating(true);
    setGenerationError(null);
    setGeneratedQuestions(null);
    setLastTheme(effectiveTheme);

    const req: GenerateRequest = {
      theme: effectiveTheme,
      category: effectiveCategory,
      difficulty,
      question_count: questionCount,
      language,
      audience: 'general',
      style,
    };

    try {
      const res = await aiApi.generate(req);
      setGeneratedQuestions(res.questions);
      setSelectedIds(new Set(res.questions.map((q) => q.id)));
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'La génération a échoué. Veuillez réessayer.';
      setGenerationError(msg);
    } finally {
      setGenerating(false);
    }
  }, [canGenerate, effectiveTheme, effectiveCategory, difficulty, questionCount, language, style]);

  const toggleQuestion = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => setSelectedIds(new Set(generatedQuestions?.map((q) => q.id) ?? []));
  const deselectAll = () => setSelectedIds(new Set());

  const selectedQuestions = (generatedQuestions ?? []).filter((q) => selectedIds.has(q.id));

  return (
    <div className="flex flex-col gap-8">
      {/* Page header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-cyan-400 rounded-lg flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <h1 className="text-xl font-bold text-gray-900">Générateur IA</h1>
          </div>
          <p className="text-sm text-gray-500">
            Générez des questions de quiz en quelques secondes grâce à l'intelligence artificielle.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ── Left column: configuration ── */}
        <div className="lg:col-span-1 flex flex-col gap-5">
          {/* Theme / preset */}
          <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-col gap-3">
            <h2 className="text-sm font-semibold text-gray-800">Thème</h2>

            <div className="grid grid-cols-2 gap-2">
              {PRESETS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => { setSelectedPreset(p.id); setUseCustomTheme(false); }}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition-all text-left ${
                    !useCustomTheme && selectedPreset === p.id
                      ? 'border-blue-400 bg-blue-50 text-blue-700 ring-1 ring-blue-300'
                      : 'border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  <span className="text-base leading-none">{p.emoji}</span>
                  <span className="truncate">{p.label}</span>
                </button>
              ))}
            </div>

            <div className="relative">
              <button
                onClick={() => setUseCustomTheme((v) => !v)}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-all ${
                  useCustomTheme
                    ? 'border-blue-400 bg-blue-50 text-blue-700 ring-1 ring-blue-300'
                    : 'border-dashed border-gray-300 text-gray-400 hover:border-gray-400'
                }`}
              >
                <Plus className="w-4 h-4 flex-shrink-0" />
                Thème personnalisé
              </button>
            </div>

            {useCustomTheme && (
              <Input
                value={customTheme}
                onChange={(e) => setCustomTheme(e.target.value)}
                placeholder="Ex: Astronomie, Gastronomie, NFL…"
                autoFocus
              />
            )}
          </div>

          {/* Difficulty */}
          <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-col gap-3">
            <h2 className="text-sm font-semibold text-gray-800">Difficulté</h2>
            <div className="flex flex-col gap-2">
              {DIFFICULTIES.map((d) => (
                <button
                  key={d.value}
                  onClick={() => setDifficulty(d.value)}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border text-left transition-all ${
                    difficulty === d.value
                      ? `${d.color} ring-1 border`
                      : 'border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                    difficulty === d.value ? '' : 'bg-gray-300'
                  } ${d.value === 1 ? 'bg-emerald-400' : d.value === 2 ? 'bg-amber-400' : 'bg-rose-400'}`} />
                  <div className="min-w-0">
                    <p className="text-sm font-medium leading-none mb-0.5">{d.label}</p>
                    <p className="text-xs text-gray-400">{d.desc}</p>
                  </div>
                  {difficulty === d.value && <Check className="w-4 h-4 ml-auto flex-shrink-0" />}
                </button>
              ))}
            </div>
          </div>

          {/* Count + style */}
          <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <h2 className="text-sm font-semibold text-gray-800">Nombre de questions</h2>
              <div className="flex gap-2">
                {QUESTION_COUNTS.map((c) => (
                  <button
                    key={c}
                    onClick={() => setQuestionCount(c)}
                    className={`flex-1 py-2 rounded-lg border text-sm font-medium transition-all ${
                      questionCount === c
                        ? 'border-blue-400 bg-blue-50 text-blue-700 ring-1 ring-blue-300'
                        : 'border-gray-200 text-gray-600 hover:border-gray-300'
                    }`}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <h2 className="text-sm font-semibold text-gray-800">Style</h2>
              <div className="grid grid-cols-2 gap-2">
                {STYLES.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setStyle(s.id)}
                    className={`flex flex-col px-3 py-2 rounded-lg border text-left transition-all ${
                      style === s.id
                        ? 'border-blue-400 bg-blue-50 ring-1 ring-blue-300'
                        : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    <span className={`text-xs font-semibold ${style === s.id ? 'text-blue-700' : 'text-gray-700'}`}>
                      {s.label}
                    </span>
                    <span className="text-[11px] text-gray-400 mt-0.5">{s.desc}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <h2 className="text-sm font-semibold text-gray-800">Langue</h2>
              <div className="relative">
                <select
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white text-gray-900 appearance-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="fr">Français</option>
                  <option value="en">English</option>
                  <option value="es">Español</option>
                  <option value="de">Deutsch</option>
                  <option value="it">Italiano</option>
                  <option value="pt">Português</option>
                </select>
                <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
              </div>
            </div>
          </div>

          {/* Generate button */}
          <button
            onClick={handleGenerate}
            disabled={!canGenerate || generating}
            className={`w-full flex items-center justify-center gap-2.5 py-3 rounded-xl text-sm font-semibold transition-all focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 ${
              canGenerate && !generating
                ? 'bg-gradient-to-r from-blue-600 to-cyan-500 text-white shadow-md hover:shadow-lg hover:from-blue-700 hover:to-cyan-600'
                : 'bg-gray-100 text-gray-400 cursor-not-allowed'
            }`}
          >
            {generating ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Génération en cours…
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                Générer {questionCount} question{questionCount > 1 ? 's' : ''}
              </>
            )}
          </button>
        </div>

        {/* ── Right column: results ── */}
        <div className="lg:col-span-2 flex flex-col gap-4">
          {/* idle state */}
          {!generating && !generatedQuestions && !generationError && (
            <div className="flex flex-col items-center justify-center h-full min-h-64 rounded-xl border-2 border-dashed border-gray-200 text-center p-8">
              <div className="w-14 h-14 bg-gradient-to-br from-blue-50 to-cyan-50 rounded-2xl flex items-center justify-center mb-4 border border-blue-100">
                <Sparkles className="w-7 h-7 text-blue-400" />
              </div>
              <p className="text-sm font-medium text-gray-700 mb-1">Prêt à générer</p>
              <p className="text-xs text-gray-400">
                Choisissez un thème et une difficulté, puis cliquez sur Générer.
              </p>
            </div>
          )}

          {/* loading state */}
          {generating && (
            <div className="flex flex-col items-center justify-center h-full min-h-64 rounded-xl border border-gray-200 bg-white text-center p-8 gap-4">
              <div className="relative w-14 h-14">
                <div className="absolute inset-0 rounded-full bg-gradient-to-br from-blue-500 to-cyan-400 opacity-20 animate-ping" />
                <div className="relative w-14 h-14 bg-gradient-to-br from-blue-500 to-cyan-400 rounded-2xl flex items-center justify-center">
                  <Sparkles className="w-7 h-7 text-white" />
                </div>
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-800">L'IA génère vos questions…</p>
                <p className="text-xs text-gray-400 mt-1">Cela prend généralement 5 à 15 secondes.</p>
              </div>
              <div className="flex gap-1.5">
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className="w-2 h-2 rounded-full bg-blue-400 animate-bounce"
                    style={{ animationDelay: `${i * 0.15}s` }}
                  />
                ))}
              </div>
            </div>
          )}

          {/* error state */}
          {generationError && !generating && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-5 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-semibold text-red-700">Échec de la génération</p>
                <p className="text-sm text-red-600 mt-1">{generationError}</p>
              </div>
              <Button variant="ghost" size="sm" onClick={handleGenerate} icon={<RefreshCw className="w-3.5 h-3.5" />}>
                Réessayer
              </Button>
            </div>
          )}

          {/* results */}
          {generatedQuestions && !generating && (
            <>
              {/* results header */}
              <div className="flex items-center justify-between bg-white rounded-xl border border-gray-200 px-4 py-3">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-emerald-50 rounded-lg flex items-center justify-center">
                    <BookOpen className="w-4 h-4 text-emerald-600" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-gray-900">
                      {generatedQuestions.length} question{generatedQuestions.length > 1 ? 's' : ''} générée{generatedQuestions.length > 1 ? 's' : ''}
                    </p>
                    <p className="text-xs text-gray-400">
                      {lastTheme} &middot; {selectedIds.size} sélectionnée{selectedIds.size > 1 ? 's' : ''}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={selectedIds.size === generatedQuestions.length ? deselectAll : selectAll}
                    className="text-xs text-blue-600 hover:text-blue-700 font-medium"
                  >
                    {selectedIds.size === generatedQuestions.length ? 'Tout désélectionner' : 'Tout sélectionner'}
                  </button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleGenerate}
                    icon={<RefreshCw className="w-3.5 h-3.5" />}
                  >
                    Regénérer
                  </Button>
                  <Button
                    size="sm"
                    icon={<Save className="w-3.5 h-3.5" />}
                    onClick={() => setSaveOpen(true)}
                    disabled={selectedIds.size === 0 || projectsLoading || projects.length === 0}
                  >
                    Sauvegarder ({selectedIds.size})
                  </Button>
                </div>
              </div>

              {projects.length === 0 && !projectsLoading && (
                <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-700">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  Créez un projet avant de pouvoir sauvegarder des questions.
                </div>
              )}

              {/* question list */}
              <div className="flex flex-col gap-2">
                {generatedQuestions.map((q, i) => (
                  <QuestionCard
                    key={q.id}
                    question={q}
                    index={i}
                    selected={selectedIds.has(q.id)}
                    onToggle={() => toggleQuestion(q.id)}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      <SaveModal
        open={saveOpen}
        questions={selectedQuestions}
        projects={projects}
        onClose={() => setSaveOpen(false)}
        onSaved={() => {}}
        suggestedTheme={lastTheme}
      />
    </div>
  );
}
