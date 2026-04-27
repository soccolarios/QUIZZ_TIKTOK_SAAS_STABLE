import { api } from './client';
import type { Quiz, QuizQuestion } from './types';

interface QuestionPayload {
  text: string;
  choices: { A: string; B: string; C: string; D: string };
  correct_answer: 'A' | 'B' | 'C' | 'D';
  category?: string;
  difficulty?: number;
}

interface QuestionResponse {
  quiz: Quiz;
  question: QuizQuestion;
}

interface QuizResponse {
  quiz: Quiz;
}

export const quizzesApi = {
  list: (projectId?: string) => {
    const qs = projectId ? `?project_id=${projectId}` : '';
    return api.get<Quiz[]>(`/api/quizzes/${qs}`);
  },
  get: (id: string) => api.get<Quiz>(`/api/quizzes/${id}`),
  create: (data: {
    project_id: string;
    title: string;
    description?: string;
    data_json?: Record<string, unknown>;
  }) => api.post<Quiz>('/api/quizzes/', data),
  update: (
    id: string,
    data: { title?: string; description?: string; data_json?: Record<string, unknown> },
  ) => api.patch<Quiz>(`/api/quizzes/${id}`, data),
  delete: (id: string) => api.delete<{ message: string }>(`/api/quizzes/${id}`),

  addQuestion: (quizId: string, q: QuestionPayload) =>
    api.post<QuestionResponse>(`/api/quizzes/${quizId}/questions`, q),

  updateQuestion: (quizId: string, questionId: string, q: QuestionPayload) =>
    api.put<QuestionResponse>(`/api/quizzes/${quizId}/questions/${questionId}`, q),

  deleteQuestion: (quizId: string, questionId: string) =>
    api.delete<QuizResponse>(`/api/quizzes/${quizId}/questions/${questionId}`),

  reorderQuestions: (quizId: string, orderedIds: string[]) =>
    api.post<QuizResponse>(`/api/quizzes/${quizId}/questions/reorder`, { ordered_ids: orderedIds }),
};
